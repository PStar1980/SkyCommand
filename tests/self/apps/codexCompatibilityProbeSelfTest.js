'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough, Writable } = require('node:stream');
const {
  CONTRACT,
  ACTIVE_CONTRACT_PROFILE,
  CONTRACT_PROFILE_IDS,
  ProbeError,
  compareSchemaBundles,
  hasSchemaSurface,
  installedArtifactSha256,
  isProbeRpcMethodAllowed,
  isValidSha512Integrity,
  loadContractProfile,
  packageArchiveIntegrityMismatchAlgorithm,
  projectAccountRead,
  validateContract,
  validateProbeContainment,
  validateRpcEnvelope,
  verifyPackageLock,
  verifyTarballBytes,
} = require('../../../docker/codex-compat-probe/contract');
const { installedPackageArtifactSha256 } = require('../../../apps/codex-agent-runtime-worker/src/packageArtifactAttestation');
const {
  createRpcProcess,
  isWithinSchemaRoot,
  inspectA0SchemaSurface,
  performReadOnlyHandshake,
  readSchemaTree,
} = require('../../../docker/codex-compat-probe/probe');
const { projectSafeFailure } = require('../../../docker/codex-compat-probe/packageSetup');

function packageLockFixture(identity, includeRoot = true) {
  const packages = {
    'node_modules/@openai/codex': {
      version: identity.wrapperVersion,
      resolved: `https://registry.npmjs.org/@openai/codex/-/codex-${identity.wrapperVersion}.tgz`,
      integrity: identity.wrapperIntegrity,
      optionalDependencies: { [identity.platformAlias]: identity.optionalDependencySpec
        || `npm:@openai/codex@${identity.platformVersion}` },
    },
  };
  packages[`node_modules/${identity.platformAlias}`] = {
    name: '@openai/codex',
    version: identity.platformVersion,
    resolved: `https://registry.npmjs.org/@openai/codex/-/codex-${identity.platformVersion}.tgz`,
    integrity: identity.platformIntegrity,
    os: ['linux'],
    cpu: ['x64'],
  };
  if (includeRoot) packages[''] = { dependencies: { '@openai/codex': identity.wrapperVersion } };
  return { lockfileVersion: 3, packages };
}

async function artifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-compat-attest-'));
  const wrapper = path.join(root, 'node_modules/@openai/codex');
  const platform = path.join(root, 'node_modules/@openai/codex-linux-x64');
  fs.mkdirSync(wrapper, { recursive: true });
  fs.mkdirSync(platform, { recursive: true });
  fs.writeFileSync(path.join(wrapper, 'package.json'), '{"version":"fixture"}\n');
  fs.writeFileSync(path.join(platform, 'codex'), 'fixture-binary\n');
  return { root, platformPath: path.join(platform, 'codex') };
}

function writeJson(filePath, document = {}) {
  fs.writeFileSync(filePath, `${JSON.stringify(document)}\n`);
}

function writeJsonAtExactSize(filePath, size) {
  const prefix = '{"payload":"';
  const suffix = '"}';
  const payloadLength = size - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  assert.ok(payloadLength >= 0);
  fs.writeFileSync(filePath, `${prefix}${'x'.repeat(payloadLength)}${suffix}`);
  assert.equal(fs.statSync(filePath).size, size);
}

function createMinimalSchemaTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-schema-tree-'));
  fs.mkdirSync(path.join(root, 'v1'));
  fs.mkdirSync(path.join(root, 'v2'));
  writeJson(path.join(root, 'codex_app_server_protocol.schemas.json'), {
    methods: ['account/read', 'account/login/start'],
  });
  writeJson(path.join(root, 'codex_app_server_protocol.v2.schemas.json'), { version: 2 });
  return root;
}

function createObservedSchemaTree({ versionDirectoryFiles, largestFileBytes }) {
  const root = createMinimalSchemaTree();
  writeJsonAtExactSize(path.join(root, 'codex_app_server_protocol.schemas.json'), largestFileBytes);
  for (let index = 0; index < 43; index += 1) {
    writeJson(path.join(root, `top-${String(index).padStart(3, '0')}.json`), { index });
  }
  const firstDirectoryCount = Math.floor(versionDirectoryFiles / 2);
  for (let index = 0; index < versionDirectoryFiles; index += 1) {
    const directory = index < firstDirectoryCount ? 'v1' : 'v2';
    const localIndex = directory === 'v1' ? index : index - firstDirectoryCount;
    writeJson(path.join(root, directory, `schema-${String(localIndex).padStart(3, '0')}.json`), { index });
  }
  return root;
}

function fakeDirent(name, kind) {
  return {
    name,
    isSymbolicLink: () => kind === 'symlink',
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
  };
}

function schemaFilesystemWithEntry(root, name, kind, resolvedPath = null) {
  const extraPath = path.resolve(root, name);
  const fakeStat = {
    size: 2,
    isSymbolicLink: () => kind === 'symlink',
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
  };
  return new Proxy(fs.promises, {
    get(target, property) {
      if (property === 'readdir') {
        return async (directory, options) => {
          const entries = await target.readdir(directory, options);
          return path.resolve(directory) === path.resolve(root)
            ? [...entries, fakeDirent(name, kind)] : entries;
        };
      }
      if (property === 'lstat') {
        return async (entryPath) => (path.resolve(entryPath) === extraPath ? fakeStat : target.lstat(entryPath));
      }
      if (property === 'realpath' && resolvedPath) {
        return async (entryPath) => (path.resolve(entryPath) === extraPath
          ? resolvedPath : target.realpath(entryPath));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function mockAppServerSpawn(wireMessages, initializeResult) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        let message;
        try { message = JSON.parse(chunk.toString('utf8')); }
        catch (error) { callback(error); return; }
        wireMessages.push(message);
        let response = null;
        if (message.method === 'initialize') response = { id: message.id, result: initializeResult };
        if (message.method === 'account/read') {
          response = { id: message.id, result: { account: null, requiresOpenaiAuth: false } };
        }
        if (response) setImmediate(() => child.stdout.write(`${JSON.stringify(response)}\n`));
        callback();
      },
    });
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('exit', 0, null));
      return true;
    };
    return child;
  };
}

async function main() {
  assert.equal(validateContract(), true);
  assert.equal(ACTIVE_CONTRACT_PROFILE, 'codex-0.156.1');
  assert.deepEqual(CONTRACT_PROFILE_IDS, ['codex-0.156.1', 'codex-0.154.0']);
  assert.equal(CONTRACT.baseline.wrapperVersion, '0.155.0-alpha.9.2');
  assert.equal(CONTRACT.candidate.wrapperVersion, '0.156.1');
  assert.equal(CONTRACT.candidate.platformVersion, '0.156.1-linux-x64');
  assert.equal(CONTRACT.candidate.wrapperIntegrity,
    'sha512-nI1iVl/n2SO2lSvlwEsJx63zdSI4C4Me2gR7AG0OWMJiGSakz2tY2hx43E39Zq5aEoeB5bZjJXzp5Sqhog6vyA==');
  assert.equal(CONTRACT.candidate.platformIntegrity,
    'sha512-2ePo0wgOcnONKsuzp8vBjOmNY+IdsKaouaDDIdiKq9HOWNuV/GI22OeXft2A/1GaoL71ictO0/pLAsCEnQ6wew==');
  assert.equal(isValidSha512Integrity(CONTRACT.baseline.platformIntegrity), true);
  assert.equal(isValidSha512Integrity(CONTRACT.candidate.wrapperIntegrity), true);
  assert.equal(isValidSha512Integrity(CONTRACT.candidate.platformIntegrity), true);
  assert.equal(Buffer.from(CONTRACT.candidate.wrapperIntegrity.slice('sha512-'.length), 'base64').length, 64);
  assert.equal(Buffer.from(CONTRACT.candidate.platformIntegrity.slice('sha512-'.length), 'base64').length, 64);
  assert.equal(CONTRACT.candidate.wrapperShasum, '21a6a1f6226562c56ccece8f7ebea5bda1fe3768');
  assert.match(CONTRACT.candidate.wrapperShasum, /^[a-f0-9]{40}$/i);
  assert.equal(CONTRACT.candidate.platformShasum, '04927933fda85cbe2ad2cdd5b62f92875a8ab8b2');
  assert.match(CONTRACT.candidate.platformShasum, /^[a-f0-9]{40}$/i);
  assert.equal(CONTRACT.candidate.optionalDependencySpec, 'npm:@openai/codex@0.156.1-linux-x64');
  assert.throws(() => validateContract({ ...CONTRACT, candidate: { ...CONTRACT.candidate, wrapperVersion: '0.156.2' } }),
    (error) => error instanceof ProbeError && error.code === 'PROBE_CONTRACT_INVALID');

  const candidate0154 = loadContractProfile('codex-0.154.0');
  assert.equal(validateContract(candidate0154, 'codex-0.154.0'), true);
  assert.equal(candidate0154.baseline.wrapperVersion, '0.155.0-alpha.9.2');
  assert.equal(candidate0154.candidate.wrapperVersion, '0.154.0');
  assert.equal(candidate0154.candidate.platformVersion, '0.154.0-linux-x64');
  assert.equal(candidate0154.candidate.wrapperIntegrity,
    'sha512-FV/x1OHXYv/ifjf3mXj9ThTTAWcUZN6cGIRQRhRxkKNOPuImu1WW0c8ev1vUkE9XGH90dEnYG1tBjIkxRikg0w==');
  assert.equal(candidate0154.candidate.wrapperShasum, 'eb1ec011cca427c606ef6cd4814014e59a1c3d70');
  assert.equal(candidate0154.candidate.platformIntegrity,
    'sha512-a4FI3A8sGtwGrOqltrPbrS2hajrHQG591EwmRfiRoLMb10VxdBtUGW4gu6IJVYENiYGA7k3P4jlRHEoCZU/s9Q==');
  assert.equal(candidate0154.candidate.platformShasum, '9e93bbf0906338c2d1ebbeb9de3b0a4ef7123e55');
  assert.equal(candidate0154.candidate.optionalDependencySpec, 'npm:@openai/codex@0.154.0-linux-x64');
  for (const integrity of [candidate0154.candidate.wrapperIntegrity, candidate0154.candidate.platformIntegrity]) {
    assert.equal(isValidSha512Integrity(integrity), true);
    assert.equal(Buffer.from(integrity.slice('sha512-'.length), 'base64').length, 64);
  }
  assert.match(candidate0154.candidate.wrapperShasum, /^[a-f0-9]{40}$/i);
  assert.match(candidate0154.candidate.platformShasum, /^[a-f0-9]{40}$/i);
  assert.throws(() => loadContractProfile('codex-0.154.1'),
    (error) => error instanceof ProbeError && error.code === 'PROBE_PROFILE_INVALID');
  for (const identity of [candidate0154.baseline, candidate0154.candidate]) {
    assert.equal(verifyPackageLock(packageLockFixture(identity), identity), true);
    const changedLock = packageLockFixture(identity);
    changedLock.packages[`node_modules/${identity.platformAlias}`].integrity = 'invalid';
    assert.throws(() => verifyPackageLock(changedLock, identity),
      (error) => error instanceof ProbeError && error.code === 'PACKAGE_LOCK_IDENTITY_MISMATCH');
  }
  const candidate0154File = JSON.parse(fs.readFileSync(path.join(
    __dirname, '../../../docker/codex-compat-probe/candidates/codex-0.154.0/contract.json'), 'utf8'));
  assert.equal(candidate0154File.candidate.wrapperIntegrity, candidate0154.candidate.wrapperIntegrity);
  assert.equal(candidate0154File.candidate.platformIntegrity, candidate0154.candidate.platformIntegrity);

  const testCandidate = {
    ...CONTRACT.candidate,
    platformIntegrity: `sha512-${crypto.createHash('sha512').update(Buffer.alloc(64)).digest('base64')}`,
  };
  for (const identity of [CONTRACT.baseline, testCandidate]) {
    assert.equal(verifyPackageLock(packageLockFixture(identity), identity), true);
    assert.equal(verifyPackageLock(packageLockFixture(identity, false), identity, { requireRootDependency: false }), true);
    assert.throws(() => verifyPackageLock(packageLockFixture(identity, false), identity),
      (error) => error instanceof ProbeError && error.code === 'PACKAGE_LOCK_IDENTITY_MISMATCH');
    const changed = packageLockFixture(identity);
    changed.packages[`node_modules/${identity.platformAlias}`].integrity = CONTRACT.baseline.platformIntegrity;
    if (identity === CONTRACT.baseline) changed.packages[`node_modules/${identity.platformAlias}`].integrity = 'invalid';
    assert.throws(() => verifyPackageLock(changed, identity),
      (error) => error instanceof ProbeError && error.code === 'PACKAGE_LOCK_IDENTITY_MISMATCH');
  }

  const bytes = Buffer.from('registry archive fixture\n');
  const archiveIdentity = {
    integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`,
    shasum: crypto.createHash('sha1').update(bytes).digest('hex'),
  };
  assert.equal(verifyTarballBytes(bytes, archiveIdentity), true);
  assert.equal(isValidSha512Integrity(archiveIdentity.integrity), true);
  assert.equal(verifyTarballBytes(Buffer.from('altered'), archiveIdentity), false);
  assert.equal(verifyTarballBytes(bytes, { integrity: archiveIdentity.integrity, shasum: '0'.repeat(40) }), false);
  assert.equal(verifyTarballBytes(bytes, { integrity: CONTRACT.candidate.platformIntegrity }), false);
  assert.equal(packageArchiveIntegrityMismatchAlgorithm(bytes, archiveIdentity), null);
  assert.equal(packageArchiveIntegrityMismatchAlgorithm(bytes, {
    integrity: `sha512-${crypto.createHash('sha512').update(Buffer.from('other archive')).digest('base64')}`,
  }), 'SHA512');
  assert.equal(packageArchiveIntegrityMismatchAlgorithm(bytes, {
    integrity: archiveIdentity.integrity,
    shasum: '0'.repeat(40),
  }), 'SHA1');

  for (const packageRole of ['baseline-wrapper', 'baseline-platform', 'candidate-wrapper', 'candidate-platform']) {
    const projectedFailure = projectSafeFailure(new ProbeError('PACKAGE_ARCHIVE_INTEGRITY_MISMATCH', {
      packageRole,
      packageName: '@openai/codex',
      expectedPackageVersion: packageRole.startsWith('baseline') ? '0.155.0-alpha.9.2' : '0.156.1-linux-x64',
      integrityAlgorithm: 'SHA512',
      expectedDigest: 'PRIVATE_EXPECTED_DIGEST',
      observedDigest: 'PRIVATE_OBSERVED_DIGEST',
      archiveContents: 'PRIVATE_ARCHIVE_CONTENTS',
      npmOutput: 'https://registry.npmjs.org/private?token=PRIVATE_TOKEN',
    }));
    assert.deepEqual(projectedFailure, {
      packageRole,
      packageName: '@openai/codex',
      expectedPackageVersion: packageRole.startsWith('baseline') ? '0.155.0-alpha.9.2' : '0.156.1-linux-x64',
      integrityAlgorithm: 'SHA512',
      failureCode: 'PACKAGE_ARCHIVE_INTEGRITY_MISMATCH',
    });
    for (const secret of [
      'PRIVATE_EXPECTED_DIGEST', 'PRIVATE_OBSERVED_DIGEST', 'PRIVATE_ARCHIVE_CONTENTS',
      'PRIVATE_TOKEN', 'registry.npmjs.org',
    ]) {
      assert.equal(JSON.stringify(projectedFailure).includes(secret), false);
    }
  }
  assert.deepEqual(projectSafeFailure(new ProbeError('PACKAGE_ARCHIVE_INTEGRITY_MISMATCH', {
    packageRole: 'unexpected-role',
    packageName: 'untrusted-package',
    expectedPackageVersion: 'untrusted-version',
    integrityAlgorithm: 'UNKNOWN',
  })), { failureCode: 'PACKAGE_ARCHIVE_INTEGRITY_MISMATCH' });

  const artifact = await artifactFixture();
  try {
    const firstDigest = await installedArtifactSha256(artifact.root);
    assert.match(firstDigest, /^[A-F0-9]{64}$/);
    assert.equal(await installedArtifactSha256(artifact.root), firstDigest, 'same installed tree hashes deterministically');
    assert.equal(await installedPackageArtifactSha256(artifact.root), firstDigest,
      'probe artifact digest matches the managed runtime attestation algorithm');
    fs.appendFileSync(artifact.platformPath, 'changed');
    assert.notEqual(await installedArtifactSha256(artifact.root), firstDigest, 'artifact changes alter the installed SHA-256');
  } finally {
    fs.rmSync(artifact.root, { recursive: true, force: true });
  }

  assert.equal(isProbeRpcMethodAllowed('initialize'), true);
  assert.equal(isProbeRpcMethodAllowed('account/read'), true);
  assert.equal(isProbeRpcMethodAllowed('account/login/start'), false);
  assert.equal(isProbeRpcMethodAllowed('turn/start'), false);
  const initializeResult = {
    userAgent: 'codex-cli/0.156.1',
    codexHome: '/probe-home/candidate-home',
    platformFamily: 'unix',
    platformOs: 'linux',
  };
  assert.deepEqual(validateRpcEnvelope({ id: 101, result: initializeResult }, 101), {
    valid: true, kind: 'RESULT', id: 101, result: initializeResult,
  });
  assert.deepEqual(validateRpcEnvelope({ id: 102, error: { code: -32603, message: 'never returned' } }, 102), {
    valid: true, kind: 'ERROR', id: 102, code: -32603,
  });
  assert.equal(validateRpcEnvelope({ id: 102, result: {} }, 101).failureCode, 'RPC_RESPONSE_ID_MISMATCH');
  assert.equal(validateRpcEnvelope({ id: 101, result: {}, error: {} }, 101).failureCode, 'RPC_ENVELOPE_INVALID');
  assert.equal(validateRpcEnvelope({ id: 101, error: { code: '-32603' } }, 101).failureCode, 'RPC_ERROR_ENVELOPE_INVALID');
  assert.equal(validateRpcEnvelope({ id: 101, error: [] }, 101).failureCode, 'RPC_ERROR_ENVELOPE_INVALID');
  assert.equal(validateRpcEnvelope({ id: 101, result: {} }, 101).valid, true,
    'Codex app-server responses do not require a jsonrpc member');
  const secretRpcError = {
    id: 102,
    error: {
      code: -32603,
      message: 'Bearer access-token device-code https://auth.invalid/?token=private',
      data: { refreshToken: 'private-refresh-token', nested: { cookie: 'private-cookie' } },
    },
  };
  const safeRpcError = validateRpcEnvelope(secretRpcError, 102);
  assert.deepEqual(safeRpcError, { valid: true, kind: 'ERROR', id: 102, code: -32603 });
  for (const secret of ['access-token', 'device-code', 'auth.invalid', 'private-refresh-token', 'private-cookie']) {
    assert.equal(JSON.stringify(safeRpcError).includes(secret), false);
  }

  async function mockHandshake(accountResponse, initializeResponse = { id: 101, result: initializeResult }) {
    const calls = [];
    const notifications = [];
    const events = [];
    let stopped = false;
    const rpc = {
      async start() { calls.push({ kind: 'start' }); events.push({ kind: 'start' }); },
      async request(method, params, id, timeoutMs, timeoutCode) {
        calls.push({ kind: 'request', method, params, id, timeoutMs, timeoutCode });
        events.push({ kind: 'request', method });
        if (method === 'initialize') return initializeResponse;
        return accountResponse;
      },
      notify(method, params) {
        notifications.push({ method, params });
        events.push({ kind: 'notification', method });
      },
      async stop() { stopped = true; },
    };
    return { outcome: await performReadOnlyHandshake(rpc), calls, notifications, events, wasStopped: () => stopped };
  }
  const successfulHandshake = await mockHandshake({
    id: 102, result: { account: null, requiresOpenaiAuth: false },
  });
  assert.deepEqual(successfulHandshake.outcome, {
    outcome: 'RESULT', requestId: 102, accountState: 'ACCOUNT_NULL', requiresOpenaiAuth: false, parseable: true,
  });
  assert.deepEqual(successfulHandshake.calls.filter((call) => call.kind === 'request').map((call) => call.method),
    ['initialize', 'account/read']);
  assert.deepEqual(successfulHandshake.calls.filter((call) => call.kind === 'request').map((call) => call.id), [101, 102]);
  assert.deepEqual(successfulHandshake.calls[2].params, { refreshToken: false });
  assert.deepEqual(successfulHandshake.notifications, [{ method: 'initialized', params: {} }]);
  assert.deepEqual(successfulHandshake.events, [
    { kind: 'start' },
    { kind: 'request', method: 'initialize' },
    { kind: 'notification', method: 'initialized' },
    { kind: 'request', method: 'account/read' },
  ]);
  assert.equal(successfulHandshake.wasStopped(), true);

  const failedHandshake = await mockHandshake({
    id: 102,
    error: { code: -32603, message: 'private access-token device-code https://auth.invalid', data: { token: 'secret' } },
  });
  assert.deepEqual(failedHandshake.outcome, { outcome: 'JSON_RPC_ERROR', rpcCode: -32603, requestId: 102, parseable: true });
  for (const secret of ['access-token', 'device-code', 'auth.invalid', 'secret']) {
    assert.equal(JSON.stringify(failedHandshake.outcome).includes(secret), false);
  }
  await assert.rejects(mockHandshake({ id: 102, result: { account: null, requiresOpenaiAuth: false } }, {
    id: 999, result: initializeResult,
  }), (error) => error instanceof ProbeError && error.code === 'INITIALIZE_ENVELOPE_INVALID');
  await assert.rejects(mockHandshake({ id: 102, result: { account: null, requiresOpenaiAuth: false } }, {
    id: 101, result: { serverInfo: { name: 'obsolete synthetic shape' } },
  }), (error) => error instanceof ProbeError && error.code === 'INITIALIZE_RESULT_INVALID');
  await assert.rejects(mockHandshake({
    id: 102, result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: false },
  }), /UNEXPECTED_AUTHENTICATED_ACCOUNT/);
  const timeoutRpc = {
    async start() {},
    async request(method) {
      if (method === 'initialize') return { id: 101, result: initializeResult };
      throw new ProbeError('ACCOUNT_READ_TIMEOUT');
    },
    notify() {},
    async stop() {},
  };
  await assert.rejects(performReadOnlyHandshake(timeoutRpc),
    (error) => error instanceof ProbeError && error.code === 'ACCOUNT_READ_TIMEOUT');

  const wireMessages = [];
  const wireHandshake = await performReadOnlyHandshake(createRpcProcess(
    'fixture-codex.js', '/probe-home/test-home', mockAppServerSpawn(wireMessages, initializeResult),
  ));
  assert.deepEqual(wireHandshake, {
    outcome: 'RESULT', requestId: 102, accountState: 'ACCOUNT_NULL', requiresOpenaiAuth: false, parseable: true,
  });
  assert.deepEqual(wireMessages, [
    {
      id: 101,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'skycommand-isolated-codex-compat-probe',
          title: 'SkyCommand Compatibility Probe',
          version: '1',
        },
        capabilities: {},
      },
    },
    { method: 'initialized', params: {} },
    { id: 102, method: 'account/read', params: { refreshToken: false } },
  ]);
  assert.ok(wireMessages.every((message) => !Object.hasOwn(message, 'jsonrpc')));

  const safeAccount = projectAccountRead({
    account: { type: 'chatgpt', email: 'private@example.invalid', accessToken: 'secret-token' },
    requiresOpenaiAuth: true,
  });
  assert.deepEqual(safeAccount, { parseable: true, accountState: 'ACCOUNT_PRESENT', requiresOpenaiAuth: true });
  assert.equal(JSON.stringify(safeAccount).includes('private@example.invalid'), false);
  assert.equal(JSON.stringify(safeAccount).includes('secret-token'), false);
  assert.equal(projectAccountRead({ account: null, requiresOpenaiAuth: false }).parseable, true);
  assert.equal(projectAccountRead({ account: 'invalid', requiresOpenaiAuth: true }).parseable, false);

  const schemas = [{ name: 'server.json', document: {
    methods: [
      'initialize', 'initialized', 'account/read', 'account/login/start',
      'account/login/completed', 'account/updated', 'account/logout',
      'account/rateLimits/read', 'account/usage/read', 'thread/start',
      'thread/resume', 'turn/start', 'turn/interrupt',
    ],
    authType: { enum: ['chatgptDeviceCode'] },
  } }];
  assert.equal(hasSchemaSurface(schemas, 'account/read'), true);
  assert.equal(hasSchemaSurface(schemas, 'account/login/start', 'chatgptDeviceCode'), true);
  assert.equal(hasSchemaSurface(schemas, 'turn/start'), true);
  assert.equal(hasSchemaSurface(schemas, 'account/login/start', 'password'), false);
  assert.deepEqual(inspectA0SchemaSurface(schemas), {
    initialize: true,
    initializedNotification: true,
    accountRead: true,
    deviceCodeLoginStart: true,
    accountLoginCompleted: true,
    accountUpdated: true,
    accountLogout: true,
    accountRateLimitsRead: true,
    accountUsageRead: true,
    threadStart: true,
    threadResume: true,
    turnStart: true,
    turnInterrupt: true,
  });
  assert.deepEqual(inspectA0SchemaSurface([{ name: 'empty.json', document: {} }]), {
    initialize: false,
    initializedNotification: false,
    accountRead: false,
    deviceCodeLoginStart: false,
    accountLoginCompleted: false,
    accountUpdated: false,
    accountLogout: false,
    accountRateLimitsRead: false,
    accountUsageRead: false,
    threadStart: false,
    threadResume: false,
    turnStart: false,
    turnInterrupt: false,
  });
  const schemaDiff = compareSchemaBundles(
    [{ name: 'server.json', document: { result: { oldField: 'SECRET_OLD_VALUE' } } }],
    [{ name: 'server.json', document: { result: { newField: 'SECRET_NEW_VALUE' } } }],
    10,
  );
  assert.ok(schemaDiff.changes.some((change) => change.path === '/result/newField' && change.change === 'ADDED'));
  assert.equal(JSON.stringify(schemaDiff).includes('SECRET_OLD_VALUE'), false);
  assert.equal(JSON.stringify(schemaDiff).includes('SECRET_NEW_VALUE'), false);

  const schemaRoots = [];
  const freshSchemaTree = () => {
    const root = createMinimalSchemaTree();
    schemaRoots.push(root);
    return root;
  };
  const observedBaselineRoot = createObservedSchemaTree({ versionDirectoryFiles: 390, largestFileBytes: 852623 });
  const observedCandidateRoot = createObservedSchemaTree({ versionDirectoryFiles: 391, largestFileBytes: 854945 });
  schemaRoots.push(observedBaselineRoot, observedCandidateRoot);
  const schemaInvalid = (error) => error instanceof ProbeError && error.code === 'SCHEMA_BUNDLE_INVALID';
  try {
    const observedBaseline = await readSchemaTree(observedBaselineRoot);
    const observedCandidate = await readSchemaTree(observedCandidateRoot);
    assert.equal(observedBaseline.summary.topLevelEntries, 47);
    assert.equal(observedBaseline.summary.recursiveJsonFiles, 435);
    assert.deepEqual(observedBaseline.summary.directoryNames, ['v1', 'v2']);
    assert.equal(observedBaseline.summary.maxRecursionDepth, 1);
    assert.equal(observedBaseline.summary.largestFileBytes, 852623);
    assert.ok(observedBaseline.summary.aggregateBytes <= 8 * 1024 * 1024);
    assert.equal(observedCandidate.summary.topLevelEntries, 47);
    assert.equal(observedCandidate.summary.recursiveJsonFiles, 436);
    assert.deepEqual(observedCandidate.summary.directoryNames, ['v1', 'v2']);
    assert.equal(observedCandidate.summary.maxRecursionDepth, 1);
    assert.equal(observedCandidate.summary.largestFileBytes, 854945);
    assert.ok(observedCandidate.summary.aggregateBytes <= 8 * 1024 * 1024);
    for (const schemaTree of [observedBaseline, observedCandidate]) {
      assert.ok(schemaTree.files.some((file) => file.name === 'codex_app_server_protocol.schemas.json'));
      assert.ok(schemaTree.files.some((file) => file.name === 'codex_app_server_protocol.v2.schemas.json'));
      assert.ok(schemaTree.files.every((file) => /^[A-F0-9]{64}$/.test(file.sha256)));
    }
    const baselineRepeat = await readSchemaTree(observedBaselineRoot);
    assert.deepEqual(
      baselineRepeat.files.map(({ name, sha256 }) => ({ name, sha256 })),
      observedBaseline.files.map(({ name, sha256 }) => ({ name, sha256 })),
      'recursive schema artifact ordering and digests are deterministic',
    );

    const additionalSchemaRoot = freshSchemaTree();
    writeJson(path.join(additionalSchemaRoot, 'additional-valid-schema.json'), { schema: true });
    const additionalSchema = await readSchemaTree(additionalSchemaRoot);
    assert.equal(additionalSchema.files.length, 3);
    assert.ok(additionalSchema.files.some((file) => file.name === 'additional-valid-schema.json'));

    const missingCanonicalRoot = freshSchemaTree();
    fs.unlinkSync(path.join(missingCanonicalRoot, 'codex_app_server_protocol.v2.schemas.json'));
    await assert.rejects(readSchemaTree(missingCanonicalRoot), schemaInvalid);

    const unexpectedDirectoryRoot = freshSchemaTree();
    fs.mkdirSync(path.join(unexpectedDirectoryRoot, 'v3'));
    await assert.rejects(readSchemaTree(unexpectedDirectoryRoot), schemaInvalid);

    const nestedDirectoryRoot = freshSchemaTree();
    fs.mkdirSync(path.join(nestedDirectoryRoot, 'v1', 'nested'));
    writeJson(path.join(nestedDirectoryRoot, 'v1', 'nested', 'too-deep.json'));
    await assert.rejects(readSchemaTree(nestedDirectoryRoot), schemaInvalid);

    const nonJsonRoot = freshSchemaTree();
    fs.writeFileSync(path.join(nonJsonRoot, 'README.txt'), '{}');
    await assert.rejects(readSchemaTree(nonJsonRoot), schemaInvalid);

    const malformedJsonRoot = freshSchemaTree();
    fs.writeFileSync(path.join(malformedJsonRoot, 'malformed.json'), '{"broken":');
    await assert.rejects(readSchemaTree(malformedJsonRoot), schemaInvalid);

    const oversizedFileRoot = freshSchemaTree();
    writeJsonAtExactSize(path.join(oversizedFileRoot, 'oversized.json'), 1024 * 1024 + 1);
    await assert.rejects(readSchemaTree(oversizedFileRoot), schemaInvalid);

    const excessiveBytesRoot = freshSchemaTree();
    for (let index = 0; index < 10; index += 1) {
      writeJsonAtExactSize(path.join(excessiveBytesRoot, `large-${index}.json`), 900000);
    }
    await assert.rejects(readSchemaTree(excessiveBytesRoot), schemaInvalid);

    const excessiveFilesRoot = freshSchemaTree();
    for (let index = 0; index < 511; index += 1) {
      writeJson(path.join(excessiveFilesRoot, 'v1', `extra-${String(index).padStart(3, '0')}.json`));
    }
    await assert.rejects(readSchemaTree(excessiveFilesRoot), schemaInvalid);

    const topEntryBoundaryRoot = freshSchemaTree();
    for (let index = 0; index < 60; index += 1) {
      writeJson(path.join(topEntryBoundaryRoot, `top-${String(index).padStart(3, '0')}.json`));
    }
    assert.equal((await readSchemaTree(topEntryBoundaryRoot)).summary.topLevelEntries, 64);
    writeJson(path.join(topEntryBoundaryRoot, 'one-too-many.json'));
    await assert.rejects(readSchemaTree(topEntryBoundaryRoot), schemaInvalid);

    const symlinkRoot = freshSchemaTree();
    await assert.rejects(readSchemaTree(symlinkRoot,
      schemaFilesystemWithEntry(symlinkRoot, 'linked.json', 'symlink')), schemaInvalid);

    const nonRegularRoot = freshSchemaTree();
    await assert.rejects(readSchemaTree(nonRegularRoot,
      schemaFilesystemWithEntry(nonRegularRoot, 'special-entry', 'other')), schemaInvalid);

    const escapeRoot = freshSchemaTree();
    const escapedPath = path.resolve(escapeRoot, '..', 'escaped-schema.json');
    await assert.rejects(readSchemaTree(escapeRoot,
      schemaFilesystemWithEntry(escapeRoot, 'escaped.json', 'file', escapedPath)), schemaInvalid);
    assert.equal(isWithinSchemaRoot(escapeRoot, escapedPath), false);
    assert.equal(isWithinSchemaRoot(escapeRoot, path.join(escapeRoot, 'inside.json')), true);
  } finally {
    for (const schemaRoot of schemaRoots) fs.rmSync(schemaRoot, { recursive: true, force: true });
  }

  const safeIsolation = {
    uid: 10001,
    capabilitiesEffective: '0000000000000000',
    rootReadOnly: true,
    homeIsTmpfs: true,
    tempIsTmpfs: true,
    interfaces: ['lo'],
    defaultRoutes: 0,
    mountTargets: ['/', '/tmp', '/probe-home', '/proc', '/sys'],
    executionDisabled: true,
    productionCredentialsPresent: false,
  };
  assert.equal(validateProbeContainment(safeIsolation).passed, true);
  for (const change of [
    { rootReadOnly: false },
    { homeIsTmpfs: false },
    { capabilitiesEffective: '0000000000000001' },
    { interfaces: ['eth0', 'lo'] },
    { defaultRoutes: 1 },
    { mountTargets: ['/', '/workspace/SkyCommand'] },
    { mountTargets: ['/', '/run/codex-runtime-control'] },
    { executionDisabled: false },
    { productionCredentialsPresent: true },
  ]) assert.equal(validateProbeContainment({ ...safeIsolation, ...change }).passed, false);

  const repoRoot = path.resolve(__dirname, '../../../');
  const prodPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docker/codex-agent-runtime/package.json'), 'utf8'));
  const prodLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docker/codex-agent-runtime/package-lock.json'), 'utf8'));
  const prodCertification = prodPackage.skycommandRuntimeCertification;
  assert.equal(prodPackage.dependencies['@openai/codex'], '0.154.0');
  assert.equal(prodLock.packages['node_modules/@openai/codex'].version, '0.154.0');
  assert.equal(prodLock.packages['node_modules/@openai/codex'].integrity, prodCertification.wrapperPackageIntegrity);
  assert.equal(prodLock.packages['node_modules/@openai/codex-linux-x64'].version, '0.154.0-linux-x64');
  assert.equal(prodLock.packages['node_modules/@openai/codex-linux-x64'].integrity, prodCertification.linuxX64PackageIntegrity);

  const compose = fs.readFileSync(path.join(repoRoot, 'docker/codex-compat-probe/compose.yaml'), 'utf8');
  const candidateCompose = fs.readFileSync(path.join(repoRoot, 'docker/codex-compat-probe/compose-0.154.0.yaml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'docker/codex-compat-probe/Dockerfile'), 'utf8');
  const runner = fs.readFileSync(path.join(repoRoot, 'docker/codex-compat-probe/probe.js'), 'utf8');
  const setup = fs.readFileSync(path.join(repoRoot, 'docker/codex-compat-probe/packageSetup.js'), 'utf8');
  assert.match(compose, /network_mode:\s*none/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:\s*\["ALL"\]/);
  assert.match(compose, /\/probe-home:rw,noexec,nosuid,nodev/);
  assert.match(candidateCompose, /network_mode:\s*none/);
  assert.match(candidateCompose, /read_only:\s*true/);
  assert.match(candidateCompose, /cap_drop:\s*\["ALL"\]/);
  assert.match(candidateCompose, /user:\s*"10001:10001"/);
  assert.match(candidateCompose, /\/probe-home:rw,noexec,nosuid,nodev/);
  assert.match(candidateCompose, /SKYCOMMAND_CODEX_COMPAT_PROFILE:\s*codex-0\.154\.0/);
  assert.doesNotMatch(candidateCompose, /^\s*(?:volumes|ports|env_file|secrets):/m);
  assert.doesNotMatch(candidateCompose, /docker\.sock|codex_runtime_control|provider_internal|mcp_internal/i);
  assert.match(dockerfile, /ARG SKYCOMMAND_CODEX_COMPAT_PROFILE=codex-0\.156\.1/);
  assert.match(dockerfile, /candidates\/codex-0\.154\.0\/contract\.json/);
  assert.doesNotMatch(compose, /^\s*(?:volumes|ports|env_file|secrets):/m);
  assert.doesNotMatch(compose, /docker\.sock|codex_runtime_control|provider_internal|mcp_internal/i);
  assert.doesNotMatch(dockerfile, /VOLUME\s|COPY\s+\.\s|\.env|docker\.sock/i);
  assert.match(setup, /--ignore-scripts/);
  assert.match(setup, /verifyTarballBytes\(bytes, expected\)/);
  assert.doesNotMatch(runner, /rpc\.request\(\s*['"]account\/login\/start/);
  assert.doesNotMatch(runner, /rpc\.request\(\s*['"]turn\/start/);
  assert.match(runner, /isProbeRpcMethodAllowed/);

  process.stdout.write('Codex compatibility probe self-test passed; recursive schema bounds and isolation verified; candidate was not downloaded, installed, or executed.\n');
}

main().catch((error) => {
  process.stderr.write(`Codex compatibility probe self-test failed: ${error.message}\n`);
  process.exitCode = 1;
});
