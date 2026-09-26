'use strict';

const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const {
  CONTRACT,
  ProbeError,
  compareSchemaBundles,
  hasSchemaSurface,
  installedArtifactSha256,
  isProbeRpcMethodAllowed,
  projectAccountRead,
  sha256,
  validateContract,
  validateProbeContainment,
  validateRpcEnvelope,
  verifyPackageLock,
} = require('./contract');

const execFileAsync = promisify(execFile);
const ROOT = '/opt/codex-compat-probe';
const STAGES = ['baseline', 'candidate'];
const REQUEST_IDS = Object.freeze({ initialize: 101, accountRead: 102 });
const AUTH_AB_RPC_PROFILE = 'AUTH_AB';
const AUTH_AB_RPC_REQUEST_METHODS = Object.freeze(['initialize', 'account/read', 'account/login/start']);
const A0_SCHEMA_SURFACES = Object.freeze({
  initialize: Object.freeze({ method: 'initialize' }),
  initializedNotification: Object.freeze({ method: 'initialized' }),
  accountRead: Object.freeze({ method: 'account/read' }),
  deviceCodeLoginStart: Object.freeze({ method: 'account/login/start', discriminator: 'chatgptDeviceCode' }),
  accountLoginCompleted: Object.freeze({ method: 'account/login/completed' }),
  accountUpdated: Object.freeze({ method: 'account/updated' }),
  accountLogout: Object.freeze({ method: 'account/logout' }),
  accountRateLimitsRead: Object.freeze({ method: 'account/rateLimits/read' }),
  accountUsageRead: Object.freeze({ method: 'account/usage/read' }),
  threadStart: Object.freeze({ method: 'thread/start' }),
  threadResume: Object.freeze({ method: 'thread/resume' }),
  turnStart: Object.freeze({ method: 'turn/start' }),
  turnInterrupt: Object.freeze({ method: 'turn/interrupt' }),
});

function isRpcMethodAllowedForProfile(method, profile = null) {
  if (profile === null) return isProbeRpcMethodAllowed(method);
  return profile === AUTH_AB_RPC_PROFILE && AUTH_AB_RPC_REQUEST_METHODS.includes(method);
}

function inspectA0SchemaSurface(schemas) {
  return Object.fromEntries(Object.entries(A0_SCHEMA_SURFACES).map(([name, surface]) => [
    name,
    hasSchemaSurface(schemas, surface.method, surface.discriminator || null),
  ]));
}
const SCHEMA_LIMITS = Object.freeze({
  maxDepth: 1,
  maxTopLevelEntries: 64,
  maxJsonFiles: 512,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
});
const SAFE_FAILURES = new Set([
  'PROBE_CONTRACT_INVALID', 'PROBE_PROFILE_INVALID', 'ATTESTATION_INVALID', 'ATTESTATION_MISMATCH',
  'PACKAGE_LOCK_UNAVAILABLE', 'PACKAGE_LOCK_IDENTITY_MISMATCH', 'PACKAGE_MANIFEST_INVALID',
  'INSTALLED_ARTIFACT_MISMATCH', 'CLI_VERSION_COMMAND_FAILED', 'CLI_VERSION_MISMATCH',
  'SCHEMA_GENERATION_FAILED', 'SCHEMA_BUNDLE_INVALID', 'REQUIRED_SCHEMA_SURFACE_MISSING',
  'APP_SERVER_START_FAILED', 'APP_SERVER_EXITED', 'APP_SERVER_STDIO_INVALID',
  'INITIALIZE_TIMEOUT', 'INITIALIZE_RPC_ERROR', 'INITIALIZE_ENVELOPE_INVALID', 'INITIALIZE_RESULT_INVALID',
  'ACCOUNT_READ_TIMEOUT', 'ACCOUNT_READ_RPC_ERROR', 'ACCOUNT_READ_ENVELOPE_INVALID',
  'ACCOUNT_READ_RESULT_INVALID', 'UNEXPECTED_AUTHENTICATED_ACCOUNT', 'ISOLATION_INVARIANT_FAILED',
]);

function probeEnv(home, authAb = false) {
  const environment = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: home,
    CODEX_HOME: home,
    CODEX_DISABLE_AUTOUPDATE: '1',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
  };
  if (authAb) {
    environment.SKYCOMMAND_AUTH_AB_EXECUTION_DISABLED = '1';
    environment.HTTP_PROXY = 'http://codex-auth-ab-egress:3128';
    environment.HTTPS_PROXY = 'http://codex-auth-ab-egress:3128';
    environment.http_proxy = environment.HTTP_PROXY;
    environment.https_proxy = environment.HTTPS_PROXY;
    environment.NO_PROXY = 'localhost,127.0.0.1,codex-auth-ab-egress';
    environment.no_proxy = environment.NO_PROXY;
  }
  return environment;
}

function canonicalDigest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function parsedVersion(text) {
  const match = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/.exec(String(text || ''));
  return match?.[0] || null;
}

async function runSafeExec(file, args, options, failureCode, timeout = 60000) {
  try {
    return await execFileAsync(file, args, {
      ...options,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (_error) {
    throw new ProbeError(failureCode);
  }
}

async function readJson(filePath, failureCode) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch (_error) {
    throw new ProbeError(failureCode);
  }
}

function isWithinSchemaRoot(rootPath, resolvedPath) {
  const relative = path.relative(rootPath, resolvedPath);
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function invalidSchemaBundle() {
  throw new ProbeError('SCHEMA_BUNDLE_INVALID');
}

async function readSchemaTree(schemaRoot, io = fs.promises) {
  try {
    const rootStat = await io.lstat(schemaRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) invalidSchemaBundle();
    const rootRealPath = await io.realpath(schemaRoot);
    const topLevelEntries = await io.readdir(rootRealPath, { withFileTypes: true });
    if (topLevelEntries.length > SCHEMA_LIMITS.maxTopLevelEntries) invalidSchemaBundle();

    const files = [];
    const topLevelDirectories = [];
    const topLevelFiles = new Set();
    let totalBytes = 0;
    let largestFileBytes = 0;
    let maxRecursionDepth = 0;

    async function visitDirectory(directoryPath, directoryDepth, relativeDirectory) {
      const entries = await io.readdir(directoryPath, { withFileTypes: true });
      entries.sort((left, right) => (left.name < right.name ? -1 : (left.name > right.name ? 1 : 0)));
      for (const entry of entries) {
        if (typeof entry.name !== 'string' || !entry.name || entry.name.includes('/')
          || entry.name.includes('\\') || entry.name === '.' || entry.name === '..') invalidSchemaBundle();
        const entryPath = path.resolve(directoryPath, entry.name);
        if (!isWithinSchemaRoot(rootRealPath, entryPath)) invalidSchemaBundle();
        const stat = await io.lstat(entryPath);
        if (stat.isSymbolicLink()) invalidSchemaBundle();
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;

        if (stat.isDirectory()) {
          const depth = directoryDepth + 1;
          if (depth > SCHEMA_LIMITS.maxDepth) invalidSchemaBundle();
          if (directoryDepth === 0) topLevelDirectories.push(entry.name);
          const resolvedDirectory = await io.realpath(entryPath);
          if (!isWithinSchemaRoot(rootRealPath, resolvedDirectory)) invalidSchemaBundle();
          maxRecursionDepth = Math.max(maxRecursionDepth, depth);
          await visitDirectory(resolvedDirectory, depth, relativePath);
          continue;
        }

        if (!stat.isFile() || !entry.name.endsWith('.json')
          || stat.size > SCHEMA_LIMITS.maxFileBytes) invalidSchemaBundle();
        const resolvedFile = await io.realpath(entryPath);
        if (!isWithinSchemaRoot(rootRealPath, resolvedFile)) invalidSchemaBundle();
        if (files.length >= SCHEMA_LIMITS.maxJsonFiles) invalidSchemaBundle();
        totalBytes += stat.size;
        largestFileBytes = Math.max(largestFileBytes, stat.size);
        if (totalBytes > SCHEMA_LIMITS.maxTotalBytes) invalidSchemaBundle();
        const bytes = await io.readFile(resolvedFile);
        if (bytes.length !== stat.size) invalidSchemaBundle();
        let document;
        try {
          document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch (_error) {
          invalidSchemaBundle();
        }
        if (directoryDepth === 0) topLevelFiles.add(entry.name);
        files.push({ name: relativePath, document, sha256: canonicalDigest(bytes) });
      }
    }

    await visitDirectory(rootRealPath, 0, '');
    topLevelDirectories.sort();
    if (topLevelDirectories.length !== 2
      || topLevelDirectories[0] !== 'v1' || topLevelDirectories[1] !== 'v2'
      || !topLevelFiles.has('codex_app_server_protocol.schemas.json')
      || !topLevelFiles.has('codex_app_server_protocol.v2.schemas.json')) invalidSchemaBundle();

    files.sort((left, right) => (left.name < right.name ? -1 : (left.name > right.name ? 1 : 0)));
    return {
      files,
      summary: {
        topLevelEntries: topLevelEntries.length,
        recursiveJsonFiles: files.length,
        directoryNames: topLevelDirectories,
        maxRecursionDepth,
        aggregateBytes: totalBytes,
        largestFileBytes,
      },
    };
  } catch (error) {
    if (error instanceof ProbeError && error.code === 'SCHEMA_BUNDLE_INVALID') throw error;
    throw new ProbeError('SCHEMA_BUNDLE_INVALID');
  }
}

async function schemaBundle(codexJsPath, home, stage) {
  const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `codex-schema-${stage}-`));
  try {
    await runSafeExec(process.execPath, [codexJsPath, 'app-server', 'generate-json-schema', '--experimental', '--out', outputDir], {
      cwd: '/tmp', env: probeEnv(home),
    }, 'SCHEMA_GENERATION_FAILED');
    return await readSchemaTree(outputDir);
  } finally {
    await fs.promises.rm(outputDir, { recursive: true, force: true });
  }
}

function createRpcProcess(codexJsPath, home, spawnImpl = spawn, profile = null) {
  if (profile !== null && profile !== AUTH_AB_RPC_PROFILE) throw new ProbeError('PROBE_RPC_PROFILE_NOT_ALLOWED');
  const authAb = profile === AUTH_AB_RPC_PROFILE;
  let child;
  let buffer = '';
  let closed = false;
  let protocolFailed = false;
  const pending = new Map();
  const notifications = [];
  const notificationEvents = [];

  function rejectPending(code) {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new ProbeError(code));
    }
    pending.clear();
  }

  function failProtocol() {
    protocolFailed = true;
    rejectPending('APP_SERVER_STDIO_INVALID');
  }

  function consume(chunk) {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > 2 * 1024 * 1024) return failProtocol();
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch (_error) { return failProtocol(); }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return failProtocol();
      if (Number.isSafeInteger(message.id) && pending.has(message.id)) {
        const item = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(item.timer);
        item.resolve(message);
      } else if (!Object.hasOwn(message, 'id') && typeof message.method === 'string') {
        if (['account/updated', 'account/login/completed'].includes(message.method)) {
          notifications.push(message.method);
          if (notifications.length > 8) notifications.shift();
          notificationEvents.push({ type: message.method, observedAt: new Date().toISOString() });
          if (notificationEvents.length > 8) notificationEvents.shift();
        }
      } else {
        return failProtocol();
      }
    }
  }

  function writeLine(value) {
    if (!child || closed || protocolFailed || child.killed) throw new ProbeError('APP_SERVER_STDIO_INVALID');
    try { child.stdin.write(`${JSON.stringify(value)}\n`); }
    catch (_error) { throw new ProbeError('APP_SERVER_STDIO_INVALID'); }
  }

  function request(method, params, id, timeoutMs, timeoutCode) {
    return new Promise((resolve, reject) => {
      if (!isRpcMethodAllowedForProfile(method, profile)) {
        return reject(new ProbeError('PROBE_RPC_METHOD_NOT_ALLOWED'));
      }
      if (closed || protocolFailed || pending.has(id)) return reject(new ProbeError('APP_SERVER_STDIO_INVALID'));
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new ProbeError(timeoutCode));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { writeLine({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function notify(method, params) {
    if (method !== 'initialized') throw new ProbeError('PROBE_RPC_METHOD_NOT_ALLOWED');
    writeLine({ method, params });
  }

  async function start() {
    try {
      child = spawnImpl(process.execPath, [codexJsPath, 'app-server', '--listen', 'stdio://'], {
        cwd: '/tmp', env: probeEnv(home, authAb), stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (_error) {
      throw new ProbeError('APP_SERVER_START_FAILED');
    }
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', () => { /* Intentionally discard all app-server stderr. */ });
    child.stdout.on('data', consume);
    child.once('error', () => rejectPending('APP_SERVER_START_FAILED'));
    child.once('exit', () => {
      closed = true;
      rejectPending('APP_SERVER_EXITED');
    });
    if (child.stdin.destroyed || child.stdout.destroyed) throw new ProbeError('APP_SERVER_START_FAILED');
  }

  async function stop() {
    if (!child || closed) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1200)),
    ]);
    closed = true;
    rejectPending('APP_SERVER_EXITED');
  }

  return { start, request, notify, stop, notifications, notificationEvents };
}

function decodeMountField(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function readMountSnapshot() {
  const contents = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  return contents.split('\n').filter(Boolean).map((line) => {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    if (separator < 6 || fields.length < separator + 4) return null;
    return {
      target: decodeMountField(fields[4]),
      options: fields[5].split(','),
      fsType: fields[separator + 1],
    };
  }).filter(Boolean);
}

function probeContainment() {
  let status = '';
  try { status = fs.readFileSync('/proc/self/status', 'utf8'); }
  catch (_error) { throw new ProbeError('ISOLATION_INVARIANT_FAILED'); }
  const capEff = /^CapEff:\s*([a-f0-9]+)$/im.exec(status)?.[1]?.toLowerCase().padStart(16, '0') || null;
  const mounts = readMountSnapshot();
  const root = mounts.find((mount) => mount.target === '/');
  const homeMount = mounts.find((mount) => mount.target === '/probe-home');
  const tmpMount = mounts.find((mount) => mount.target === '/tmp');
  const interfaces = fs.readdirSync('/sys/class/net').sort();
  const routes = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1)
    .filter((row) => row.trim()).map((row) => row.trim().split(/\s+/));
  const defaultRoutes = routes.filter((row) => row[1] === '00000000' && row[0] !== 'lo').length;
  const suspiciousEnv = Object.keys(process.env).some((key) => /(?:TOKEN|SECRET|CREDENTIAL|PASSWORD|AUTHORIZATION|API[_-]?KEY|COOKIE)/i.test(key));
  let secretFiles = [];
  try { secretFiles = fs.readdirSync('/run/secrets'); }
  catch (_error) { /* absent is the expected state */ }
  const snapshot = {
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    capabilitiesEffective: capEff,
    rootReadOnly: Boolean(root?.options.includes('ro')),
    homeIsTmpfs: homeMount?.fsType === 'tmpfs',
    tempIsTmpfs: tmpMount?.fsType === 'tmpfs',
    interfaces,
    defaultRoutes,
    mountTargets: mounts.map((mount) => mount.target),
    executionDisabled: process.env.SKYCOMMAND_PROBE_EXECUTION_DISABLED === '1'
      && process.env.CODEX_DISABLE_AUTOUPDATE === '1',
    productionCredentialsPresent: suspiciousEnv || secretFiles.length > 0,
  };
  return { snapshot, result: validateProbeContainment(snapshot) };
}

async function performReadOnlyHandshake(rpc) {
  try {
    await rpc.start();
    const initialized = validateRpcEnvelope(
      await rpc.request('initialize', {
        clientInfo: { name: 'skycommand-isolated-codex-compat-probe', title: 'SkyCommand Compatibility Probe', version: '1' },
        capabilities: {},
      }, REQUEST_IDS.initialize, 20000, 'INITIALIZE_TIMEOUT'),
      REQUEST_IDS.initialize,
    );
    if (!initialized.valid) throw new ProbeError('INITIALIZE_ENVELOPE_INVALID');
    if (initialized.kind === 'ERROR') throw new ProbeError('INITIALIZE_RPC_ERROR');
    const initializeResult = initialized.result;
    const initializeStringFields = ['userAgent', 'codexHome', 'platformFamily', 'platformOs'];
    if (!initializeResult || typeof initializeResult !== 'object' || Array.isArray(initializeResult)
      || !initializeStringFields.every((field) => typeof initializeResult[field] === 'string'
        && initializeResult[field].trim().length > 0 && initializeResult[field].length <= 4096)) {
      throw new ProbeError('INITIALIZE_RESULT_INVALID');
    }
    rpc.notify('initialized', {});
    const response = await rpc.request('account/read', { refreshToken: false }, REQUEST_IDS.accountRead, 30000, 'ACCOUNT_READ_TIMEOUT');
    const envelope = validateRpcEnvelope(response, REQUEST_IDS.accountRead);
    if (!envelope.valid) throw new ProbeError('ACCOUNT_READ_ENVELOPE_INVALID');
    if (envelope.kind === 'ERROR') {
      return { outcome: 'JSON_RPC_ERROR', rpcCode: envelope.code, requestId: envelope.id, parseable: true };
    }
    const projected = projectAccountRead(envelope.result);
    if (!projected.parseable) throw new ProbeError('ACCOUNT_READ_RESULT_INVALID');
    if (projected.accountState === 'ACCOUNT_PRESENT') throw new ProbeError('UNEXPECTED_AUTHENTICATED_ACCOUNT');
    return {
      outcome: 'RESULT',
      requestId: envelope.id,
      accountState: projected.accountState,
      requiresOpenaiAuth: projected.requiresOpenaiAuth,
      parseable: true,
    };
  } catch (error) {
    if (error instanceof ProbeError && SAFE_FAILURES.has(error.code)) throw error;
    throw new ProbeError('APP_SERVER_STDIO_INVALID');
  } finally {
    await rpc.stop();
  }
}

async function inspectStage(stage, identity, packageAttestation, options = {}) {
  const packageRoot = path.join(ROOT, 'packages', stage);
  const codexJsPath = path.join(packageRoot, 'node_modules/@openai/codex/bin/codex.js');
  const wrapper = await readJson(path.join(packageRoot, 'node_modules/@openai/codex/package.json'), 'PACKAGE_MANIFEST_INVALID');
  const platform = await readJson(path.join(packageRoot, `node_modules/${identity.platformAlias}/package.json`), 'PACKAGE_MANIFEST_INVALID');
  const rootManifest = await readJson(path.join(packageRoot, 'package.json'), 'PACKAGE_MANIFEST_INVALID');
  const sourceLockBytes = await fs.promises.readFile(path.join(packageRoot, 'package-lock.json')).catch(() => null);
  if (!sourceLockBytes || canonicalDigest(sourceLockBytes) !== packageAttestation.packageLockSha256) {
    throw new ProbeError('PACKAGE_LOCK_IDENTITY_MISMATCH');
  }
  verifyPackageLock(JSON.parse(sourceLockBytes.toString('utf8')), identity);
  if (rootManifest.dependencies?.['@openai/codex'] !== identity.wrapperVersion) throw new ProbeError('PACKAGE_MANIFEST_INVALID');
  if (wrapper.name !== '@openai/codex' || wrapper.version !== identity.wrapperVersion
    || platform.name !== '@openai/codex' || platform.version !== identity.platformVersion) {
    throw new ProbeError('PACKAGE_MANIFEST_INVALID');
  }

  const lock = await readJson(path.join(packageRoot, 'node_modules/.package-lock.json'), 'PACKAGE_LOCK_UNAVAILABLE');
  verifyPackageLock(lock, identity, { requireRootDependency: false, requireAliasDependency: false });
  const actualArtifactSha256 = await installedArtifactSha256(packageRoot);
  if (actualArtifactSha256 !== packageAttestation.installedArtifactSha256) throw new ProbeError('INSTALLED_ARTIFACT_MISMATCH');

  const home = path.join('/probe-home', `${stage}-home`);
  await fs.promises.mkdir(home, { recursive: false, mode: 0o700 });
  const version = await runSafeExec(process.execPath, [codexJsPath, '--version'], {
    cwd: '/tmp', env: probeEnv(home),
  }, 'CLI_VERSION_COMMAND_FAILED', 15000);
  const observedVersion = parsedVersion(version.stdout);
  if (observedVersion !== identity.wrapperVersion) throw new ProbeError('CLI_VERSION_MISMATCH');

  const generatedSchemas = await schemaBundle(codexJsPath, home, stage);
  const schemas = generatedSchemas.files;
  const schemaSurface = inspectA0SchemaSurface(schemas);
  if (!schemaSurface.accountRead || !schemaSurface.deviceCodeLoginStart) {
    throw new ProbeError('REQUIRED_SCHEMA_SURFACE_MISSING');
  }

  const accountRead = options.skipRpcHandshake
    ? null
    : await performReadOnlyHandshake(createRpcProcess(codexJsPath, home));

  const result = {
    expectedVersion: identity.wrapperVersion,
    observedVersion,
    expectedPackageIntegrity: identity.platformIntegrity,
    installedArtifactSha256: actualArtifactSha256,
    packageLockSha256: packageAttestation.packageLockSha256,
    schemaTree: generatedSchemas.summary,
    schemaFiles: schemas.map(({ name, sha256: schemaSha256 }) => ({ name, sha256: schemaSha256 })),
    schemaSurface: {
      ...schemaSurface,
      accountReadAvailable: schemaSurface.accountRead,
      deviceAuthStartAvailable: schemaSurface.deviceCodeLoginStart,
      initializedNotificationSent: !options.skipRpcHandshake,
    },
    initialize: options.skipRpcHandshake
      ? { outcome: 'NOT_RUN' }
      : { outcome: 'SUCCEEDED', requestId: REQUEST_IDS.initialize },
    accountRead,
    rpcMethodsUsed: ['initialize', 'account/read'],
    deviceAuthRequests: 0,
    runtimeGeneration: crypto.randomUUID(),
  };
  Object.defineProperty(result, '_schemaDocuments', { value: schemas, enumerable: false });
  return result;
}

async function emptyFreshProbeHome() {
  const entries = await fs.promises.readdir('/probe-home');
  if (entries.length) throw new ProbeError('ISOLATION_INVARIANT_FAILED');
  for (const stage of STAGES) {
    try {
      await fs.promises.lstat(path.join('/probe-home', `${stage}-home`));
      throw new ProbeError('ISOLATION_INVARIANT_FAILED');
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      if (error.code !== 'ENOENT') throw new ProbeError('ISOLATION_INVARIANT_FAILED');
    }
  }
}

async function runProbe() {
  validateContract();
  const { snapshot, result: containment } = probeContainment();
  if (!containment.passed) throw new ProbeError('ISOLATION_INVARIANT_FAILED');
  await emptyFreshProbeHome();
  const attestations = await readJson(path.join(ROOT, 'package-attestations.json'), 'ATTESTATION_INVALID');
  if (attestations.schema !== 'SKYCOMMAND_CODEX_COMPAT_PROBE_PACKAGE_ATTESTATIONS_V1') throw new ProbeError('ATTESTATION_INVALID');

  const stageResults = {};
  for (const stage of STAGES) {
    const identity = CONTRACT[stage];
    const packageAttestation = attestations[stage];
    if (!packageAttestation
      || packageAttestation.wrapperVersion !== identity.wrapperVersion
      || packageAttestation.wrapperIntegrity !== identity.wrapperIntegrity
      || packageAttestation.platformVersion !== identity.platformVersion
      || packageAttestation.platformIntegrity !== identity.platformIntegrity
      || !/^[A-F0-9]{64}$/.test(packageAttestation.installedArtifactSha256)
      || !/^[A-F0-9]{64}$/.test(packageAttestation.packageLockSha256)) {
      throw new ProbeError('ATTESTATION_INVALID');
    }
    stageResults[stage] = await inspectStage(stage, identity, packageAttestation);
  }

  const schemaDiff = compareSchemaBundles(
    stageResults.baseline._schemaDocuments,
    stageResults.candidate._schemaDocuments,
    200,
  );
  const candidateProbe = stageResults.candidate;
  const baselineProbe = stageResults.baseline;
  return {
    schema: 'SKYCOMMAND_CODEX_COMPAT_PROBE_RESULT_V1',
    outcome: 'PASS',
    baseline: baselineProbe,
    candidate: candidateProbe,
    schemaComparison: {
      baselineSchemaDigests: baselineProbe.schemaFiles,
      candidateSchemaDigests: candidateProbe.schemaFiles,
      differences: schemaDiff.changes,
      truncated: schemaDiff.truncated,
    },
    containment: {
      passed: containment.passed,
      nonRoot: snapshot.uid > 0,
      capabilitiesDropped: snapshot.capabilitiesEffective === '0000000000000000',
      rootReadOnly: snapshot.rootReadOnly,
      disposableHomeTmpfs: snapshot.homeIsTmpfs,
      tempTmpfs: snapshot.tempIsTmpfs,
      networkDisabled: snapshot.interfaces.length === 1 && snapshot.interfaces[0] === 'lo' && snapshot.defaultRoutes === 0,
      productionCredentialsAbsent: !snapshot.productionCredentialsPresent,
      executionDisabled: snapshot.executionDisabled,
    },
    authenticationRequests: 0,
    agentExecutionRequests: 0,
  };
}

if (require.main === module) {
  runProbe().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    const code = error instanceof ProbeError && SAFE_FAILURES.has(error.code)
      ? error.code
      : 'PROBE_FAILED';
    process.stdout.write(`${JSON.stringify({
      schema: 'SKYCOMMAND_CODEX_COMPAT_PROBE_RESULT_V1',
      outcome: 'FAIL',
      failureCode: code,
      authenticationRequests: 0,
      agentExecutionRequests: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createRpcProcess,
  isRpcMethodAllowedForProfile,
  isWithinSchemaRoot,
  performReadOnlyHandshake,
  probeContainment,
  readSchemaTree,
  runProbe,
  inspectStage,
  inspectA0SchemaSurface,
  schemaBundle,
};
