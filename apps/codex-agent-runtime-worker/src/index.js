'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  CodexAppServerClient,
  CodexAppServerError,
  safeLoginStateDiagnostic,
  safeRpcDiagnostic,
} = require('./appServerClient');

const PORT = Number(process.env.CODEX_RUNTIME_CONTROL_PORT || 4219);
const MCP_URL = process.env.CODEX_MANAGED_MCP_URL || 'http://skycommand-codex-mcp-gateway:3981/mcp';
const CONTROL_BIND_HOST = 'codex-agent-runtime-worker-runtime-control';
const CONTROL_TOKEN_FILE = process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE || '/run/codex-runtime-control/runtime-control-token';
const MCP_PROTOCOL_VERSION = '2025-11-25';
const FORBIDDEN_ENV_KEYS = [
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'DATABASE_URL',
  'SKYCOMMAND_INTERNAL_API_TOKEN', 'SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN',
  'SKYCOMMAND_SUPERVISOR_GRANT_SECRET', 'SKYCOMMAND_ASSISTANT_API_TOKEN',
  'GITHUB_TOKEN', 'SKYCOMMAND_GITHUB_TOKEN_FILE', 'HOST_AGENT_TOKEN',
  'SUPERVISOR_TOKEN', 'API_KEY',
];
const MANAGED_HOME_MOUNT_TARGET = '/var/lib/codex';
const MANAGED_RUNTIME_CONTROL_MOUNT_TARGET = '/run/codex-runtime-control';
const DOCKER_INIT_MOUNT_TARGET = '/usr/sbin/docker-init';
// Docker/Linux masks these proc entries with tmpfs; exact targets plus source/root keep this from becoming a /proc-wide exception.
const PROC_RUNTIME_TMPFS_MOUNT_TARGETS = new Set([
  '/proc/acpi',
  '/proc/interrupts',
  '/proc/kcore',
  '/proc/keys',
  '/proc/latency_stats',
  '/proc/scsi',
  '/proc/timer_list',
]);
// Docker masks these proc files with /dev/null mounts. Mountinfo exposes the tmpfs
// superblock root as /null and may report the VFS mount options as RW; constrain that
// structure to the exact observed targets instead of trusting access mode here.
const PROC_RUNTIME_NULL_MASK_MOUNT_TARGETS = new Set([
  '/proc/interrupts',
  '/proc/kcore',
  '/proc/keys',
  '/proc/latency_stats',
  '/proc/timer_list',
]);
const DOCKER_MANAGED_FILE_MOUNT_TARGETS = new Set([
  '/etc/hosts',
  '/etc/hostname',
  '/etc/resolv.conf',
]);

const client = new CodexAppServerClient();
let lastProviderContactAt = null;
let controlToken = null;

function providerReachabilityState() {
  return {
    providerReachability: lastProviderContactAt ? 'CURRENT' : 'UNKNOWN',
    providerLastVerifiedAt: lastProviderContactAt,
  };
}

async function restoreProviderReachability(runtimeClient = client) {
  try {
    const account = await runtimeClient.readAccount();
    lastProviderContactAt = account?.authenticated === true ? new Date().toISOString() : null;
  } catch (_error) {
    lastProviderContactAt = null;
  }
  return providerReachabilityState();
}

function runtimeControlBindingError() {
  return Object.assign(new Error('Runtime-control network binding is unavailable.'), {
    code: 'CODEX_RUNTIME_CONTROL_BINDING_UNAVAILABLE',
  });
}

async function resolveRuntimeControlAddress({ lookup = dns.lookup, networkInterfaces = os.networkInterfaces() } = {}) {
  let records;
  try {
    records = await lookup(CONTROL_BIND_HOST, { all: true, verbatim: true });
  } catch (_error) {
    throw runtimeControlBindingError();
  }
  if (!Array.isArray(records) || records.length !== 1) throw runtimeControlBindingError();
  const [record] = records;
  if (![4, 'IPv4'].includes(record?.family) || !net.isIPv4(record?.address) || record.address === '0.0.0.0') {
    throw runtimeControlBindingError();
  }
  const localAssignments = Object.values(networkInterfaces || {}).flatMap((items) => (Array.isArray(items) ? items : []))
    .filter((item) => item?.family === 'IPv4' || item?.family === 4)
    .filter((item) => item?.internal === false && item.address === record.address);
  if (localAssignments.length !== 1) throw runtimeControlBindingError();
  return record.address;
}

function listenOnRuntimeControlAddress(server, address, port = PORT) {
  if (!net.isIPv4(address) || address === '0.0.0.0' || address.startsWith('127.')) throw runtimeControlBindingError();
  server.listen(port, address);
}

function readControlToken() {
  const token = fs.readFileSync(CONTROL_TOKEN_FILE, 'utf8').trim();
  if (token.length < 40) throw new Error('Runtime control credential is invalid.');
  return token;
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function mcpProbe() {
  const baseHeaders = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
  };
  const initialize = await fetch(MCP_URL, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'skycommand-codex-bootstrap-probe', version: '19.3A0' } } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!initialize.ok) return { status: 'UNREACHABLE', reason: `HTTP_${initialize.status}`, tools: [] };
  const initializeBody = await initialize.json();
  if (!initializeBody?.result?.protocolVersion) return { status: 'UNREACHABLE', reason: 'MCP_INITIALIZE_INVALID', tools: [] };

  const sessionId = initialize.headers.get('mcp-session-id');
  const initialized = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...baseHeaders, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    signal: AbortSignal.timeout(8000),
  });
  if (!initialized.ok && initialized.status !== 202) return { status: 'UNREACHABLE', reason: `HTTP_${initialized.status}`, tools: [] };

  const list = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...baseHeaders, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(8000),
  });
  if (!list.ok) return { status: 'UNREACHABLE', reason: `HTTP_${list.status}`, tools: [] };
  const body = await list.json();
  const names = Array.isArray(body?.result?.tools) ? body.result.tools.map((tool) => String(tool.name || '')).filter(Boolean) : [];
  if (names.length !== 1 || names[0] !== 'skycommand_browser_automation_run') {
    return { status: 'BLOCKED', reason: 'MCP_TOOL_SURFACE_MISMATCH', tools: names.slice(0, 8) };
  }
  return { status: 'CURRENT', reason: null, tools: names, observedAt: new Date().toISOString() };
}

function parseMountInfo(mountInfo) {
  return String(mountInfo || '').split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(' - ');
    if (separator < 0) return [];
    const mountFields = line.slice(0, separator).split(' ');
    const filesystemFields = line.slice(separator + 3).split(' ');
    if (mountFields.length < 6 || !mountFields[4] || filesystemFields.length < 2) return [];
    return [{
      target: mountFields[4].replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8))),
      mountRoot: mountFields[3],
      options: new Set(mountFields[5].split(',')),
      filesystemType: filesystemFields[0],
      mountSource: filesystemFields[1],
    }];
  });
}

function isWithinMountTree(target, root) {
  return target === root || target.startsWith(`${root}/`);
}

function isReadOnlyMount(options) {
  return options.has('ro') && !options.has('rw');
}

function isKernelRuntimeMount({ target, mountRoot, filesystemType, mountSource }) {
  if (isWithinMountTree(target, '/proc')) {
    if (filesystemType === 'proc') return true;
    if (!PROC_RUNTIME_TMPFS_MOUNT_TARGETS.has(target) || filesystemType !== 'tmpfs' || mountSource !== 'tmpfs') return false;
    if (PROC_RUNTIME_NULL_MASK_MOUNT_TARGETS.has(target)) {
      return mountRoot === '/null';
    }
    return mountRoot === '/';
  }
  if (isWithinMountTree(target, '/sys')) {
    return ['sysfs', 'cgroup', 'cgroup2', 'tmpfs'].includes(filesystemType);
  }
  if (isWithinMountTree(target, '/dev')) {
    return ['devtmpfs', 'devpts', 'tmpfs', 'mqueue'].includes(filesystemType);
  }
  return target === '/tmp' && filesystemType === 'tmpfs';
}

function isDockerInitRuntimeMount({ target, filesystemType, options }) {
  // Docker's init helper is injected as a read-only overlay mount when init: true is enabled.
  return target === DOCKER_INIT_MOUNT_TARGET
    && filesystemType === 'overlay'
    && isReadOnlyMount(options);
}

function isExpectedMount(mount) {
  if (mount.target === '/' || mount.target === MANAGED_HOME_MOUNT_TARGET
    || mount.target === MANAGED_RUNTIME_CONTROL_MOUNT_TARGET
    || DOCKER_MANAGED_FILE_MOUNT_TARGETS.has(mount.target)) return true;
  return isKernelRuntimeMount(mount) || isDockerInitRuntimeMount(mount);
}

function evaluateContainment({
  processStatus = '',
  mountInfo = '',
  effectiveUid = typeof process.getuid === 'function' ? process.getuid() : null,
  forbiddenEnvironmentKeys = FORBIDDEN_ENV_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(process.env, key)),
  dockerSocketPresent = fs.existsSync('/var/run/docker.sock'),
  gitAvailable = fs.existsSync('/usr/bin/git') || fs.existsSync('/usr/local/bin/git'),
  browserStatePresent = ['/root/.config/google-chrome', '/home/node/.config/google-chrome', '/var/lib/codex/.config/google-chrome', '/var/lib/codex/browser'].some((item) => fs.existsSync(item)),
} = {}) {
  const mounts = parseMountInfo(mountInfo);
  const statusValue = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(processStatus)?.[1]?.trim() || null;
  const rootMountOptions = mounts.find((mount) => mount.target === '/')?.options || new Set();
  const managedHomeMounts = mounts.filter((mount) => mount.target === MANAGED_HOME_MOUNT_TARGET);
  const runtimeControlMounts = mounts.filter((mount) => mount.target === MANAGED_RUNTIME_CONTROL_MOUNT_TARGET);
  const managedRuntimeControlMountPresent = runtimeControlMounts.length === 1;
  const managedRuntimeControlMountReadOnly = managedRuntimeControlMountPresent
    && isReadOnlyMount(runtimeControlMounts[0].options);
  const extraMounts = mounts.filter((mount) => !isExpectedMount(mount)).map((mount) => mount.target);
  const uid = statusValue('Uid')?.split(/\s+/).map(Number) || [];
  const capabilities = statusValue('CapEff');
  return {
    nonRoot: Number.isInteger(effectiveUid) && effectiveUid !== 0 && uid[1] !== 0,
    noNewPrivileges: statusValue('NoNewPrivs') === '1',
    allLinuxCapabilitiesDropped: capabilities === '0000000000000000',
    readOnlyRootFilesystem: isReadOnlyMount(rootMountOptions),
    managedHomeVolumeOnly: managedHomeMounts.length === 1,
    managedRuntimeControlMountPresent,
    managedRuntimeControlMountReadOnly,
    liveCheckoutMount: mounts.some(({ target }) => /(?:^|\/)workspace(?:\/|$)|worktree|host-workspace/i.test(target)),
    arbitraryHostPathMount: extraMounts.length > 0,
    unexpectedMountTargets: extraMounts,
    dockerSocket: dockerSocketPresent,
    gitAvailable,
    browserState: browserStatePresent,
    prohibitedCredentials: forbiddenEnvironmentKeys.length === 0,
    forbiddenEnvironmentKeys,
    nativeTurnStartExposed: false,
    nativeThreadStartExposed: false,
    nativeCommandExecExposed: false,
    nativeProcessSpawnExposed: false,
    nativeGoalsOrPluginsExposed: false,
  };
}

function containment() {
  let processStatus = '';
  let mountInfo = '';
  try {
    processStatus = fs.readFileSync('/proc/self/status', 'utf8');
    mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  } catch (_error) {
    processStatus = '';
    mountInfo = '';
  }
  return evaluateContainment({ processStatus, mountInfo });
}

function isContainmentCompatible(constraints) {
  return firstContainmentFailureCode(constraints) === null;
}

const CONTAINMENT_FAILURE_CODES = Object.freeze([
  ['nonRoot', true, 'CODEX_CONTAINMENT_NON_ROOT_REQUIRED'],
  ['noNewPrivileges', true, 'CODEX_CONTAINMENT_NO_NEW_PRIVILEGES_REQUIRED'],
  ['allLinuxCapabilitiesDropped', true, 'CODEX_CONTAINMENT_CAPABILITIES_NOT_DROPPED'],
  ['readOnlyRootFilesystem', true, 'CODEX_CONTAINMENT_ROOT_FILESYSTEM_NOT_READ_ONLY'],
  ['managedHomeVolumeOnly', true, 'CODEX_CONTAINMENT_MANAGED_HOME_MISSING'],
  ['managedRuntimeControlMountPresent', true, 'CODEX_CONTAINMENT_RUNTIME_CONTROL_MOUNT_MISSING'],
  ['managedRuntimeControlMountReadOnly', true, 'CODEX_CONTAINMENT_RUNTIME_CONTROL_MOUNT_NOT_READ_ONLY'],
  ['liveCheckoutMount', false, 'CODEX_CONTAINMENT_LIVE_CHECKOUT_MOUNT_PRESENT'],
  ['arbitraryHostPathMount', false, 'CODEX_CONTAINMENT_UNEXPECTED_MOUNT_PRESENT'],
  ['dockerSocket', false, 'CODEX_CONTAINMENT_DOCKER_SOCKET_PRESENT'],
  ['gitAvailable', false, 'CODEX_CONTAINMENT_GIT_AVAILABLE'],
  ['browserState', false, 'CODEX_CONTAINMENT_BROWSER_STATE_PRESENT'],
  ['prohibitedCredentials', true, 'CODEX_CONTAINMENT_PROHIBITED_CONFIGURATION_PRESENT'],
]);

function firstContainmentFailureCode(constraints = {}) {
  const failed = CONTAINMENT_FAILURE_CODES.find(([key, expected]) => constraints[key] !== expected);
  return failed?.[2] || null;
}

function firstIdentityFailure(identity = {}) {
  if (!identity.observedCodexVersion) return 'CODEX_OBSERVED_VERSION_UNAVAILABLE';
  if (identity.observedCodexVersion !== identity.expectedCodexVersion) return 'CODEX_VERSION_MISMATCH';
  if (!identity.observedWrapperPackageIntegrity) return 'CODEX_OBSERVED_WRAPPER_PACKAGE_INTEGRITY_UNAVAILABLE';
  if (identity.observedWrapperPackageIntegrity !== identity.expectedWrapperPackageIntegrity) return 'CODEX_WRAPPER_PACKAGE_INTEGRITY_MISMATCH';
  if (!identity.observedPackageIntegrity) return 'CODEX_OBSERVED_PACKAGE_INTEGRITY_UNAVAILABLE';
  if (identity.observedPackageIntegrity !== identity.expectedPackageIntegrity) return 'CODEX_PACKAGE_INTEGRITY_MISMATCH';
  if (!/^[0-9A-F]{64}$/i.test(String(identity.expectedProtocolSchemaDigest || ''))) {
    return 'CODEX_PROTOCOL_SCHEMA_DIGEST_EXPECTED_MISSING';
  }
  if (!identity.observedProtocolSchemaDigest) return 'CODEX_PROTOCOL_SCHEMA_DIGEST_MISSING';
  if (identity.observedProtocolSchemaDigest !== identity.expectedProtocolSchemaDigest.toUpperCase()) {
    return 'CODEX_PROTOCOL_SCHEMA_DIGEST_MISMATCH';
  }
  if (!identity.observedInstalledArtifactSha256 || !identity.expectedInstalledArtifactSha256) {
    return 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_UNAVAILABLE';
  }
  if (identity.observedInstalledArtifactSha256 !== identity.expectedInstalledArtifactSha256) {
    return 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED';
  }
  const mismatchFields = Array.isArray(identity.identityMismatchFields) ? identity.identityMismatchFields : [];
  if (mismatchFields.includes('observedCodexVersion')) return 'CODEX_VERSION_MISMATCH';
  if (mismatchFields.includes('observedPackageIntegrity')) return 'CODEX_PACKAGE_INTEGRITY_MISMATCH';
  if (mismatchFields.includes('observedInstalledArtifactSha256')) return 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED';
  if (mismatchFields.some((field) => ['installedPackageManifest', 'installedPackageLock', 'artifactAttestation'].includes(field))) {
    return 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED';
  }
  if (identity.identityAttestation !== 'VERIFIED') {
    return identity.identityAttestation === 'FAILED'
      ? 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED'
      : 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_UNAVAILABLE';
  }
  return null;
}

function evaluateHealthReadiness({ identityInitialized, identity, constraints, proxyStatus, mcpStatus } = {}) {
  if (identityInitialized !== true) {
    return { ok: false, readiness: 'INSTALLATION_UNCERTIFIED', readinessCode: 'CODEX_APP_SERVER_NOT_INITIALIZED', failedCondition: 'APP_SERVER_INITIALIZATION' };
  }
  const identityFailureCode = firstIdentityFailure(identity);
  if (identityFailureCode) {
    return { ok: false, readiness: 'PROTOCOL_INCOMPATIBLE', readinessCode: identityFailureCode, failedCondition: 'CODEX_IDENTITY' };
  }
  const containmentFailureCode = firstContainmentFailureCode(constraints);
  if (containmentFailureCode) {
    return { ok: false, readiness: 'RUNTIME_INCOMPATIBLE', readinessCode: containmentFailureCode, failedCondition: 'CONTAINMENT' };
  }
  if (proxyStatus !== 'CURRENT') {
    return { ok: false, readiness: 'PROVIDER_UNREACHABLE', readinessCode: 'CODEX_EGRESS_PROXY_UNAVAILABLE', failedCondition: 'EGRESS_PROXY' };
  }
  if (mcpStatus !== 'CURRENT') {
    return { ok: false, readiness: 'MCP_UNREACHABLE', readinessCode: 'CODEX_MANAGED_MCP_UNAVAILABLE', failedCondition: 'MANAGED_MCP' };
  }
  return { ok: true, readiness: 'CURRENT', readinessCode: 'CODEX_RUNTIME_CURRENT', failedCondition: null };
}

async function buildHealth(runtimeClient = client, options = {}) {
  const fetcher = options.fetcher || fetch;
  const probeMcp = options.mcpProbe || mcpProbe;
  const identity = runtimeClient.identity();
  const identityMismatchFields = new Set(Array.isArray(identity.identityMismatchFields) ? identity.identityMismatchFields : []);
  const expectedProtocolDigestValid = /^[0-9A-F]{64}$/i.test(String(identity.expectedProtocolSchemaDigest || ''));
  if (!expectedProtocolDigestValid) identityMismatchFields.add('expectedProtocolSchemaDigest');
  if (!identity.observedProtocolSchemaDigest
    || !expectedProtocolDigestValid
    || identity.observedProtocolSchemaDigest !== identity.expectedProtocolSchemaDigest.toUpperCase()) {
    identityMismatchFields.add('observedProtocolSchemaDigest');
  }
  const assessedIdentity = { ...identity, identityMismatchFields: [...identityMismatchFields] };
  let proxy = { status: 'UNREACHABLE', policyDigest: null, allowedHostCount: null, observedDestinations: [] };
  try {
    const result = await fetcher('http://skycommand-codex-egress-proxy:3128/healthz', { signal: AbortSignal.timeout(3000) });
    const body = await result.json();
    let observedDestinations = [];
    try {
      const diagnostics = await fetcher('http://skycommand-codex-egress-proxy:3128/diagnostics', { signal: AbortSignal.timeout(3000) });
      const record = await diagnostics.json();
      observedDestinations = Array.isArray(record.events)
        ? record.events.slice(-80).map((item) => ({
          host: String(item.host || '').toLowerCase().slice(0, 253),
          decision: String(item.decision || '').slice(0, 16),
          reason: String(item.reason || '').slice(0, 48),
          observedAt: item.observedAt || null,
        }))
        : [];
    } catch (_error) { /* proxy health remains independently represented */ }
    proxy = { status: result.ok && body.ok ? 'CURRENT' : 'UNREACHABLE', policyDigest: body.policyDigest || null, allowedHostCount: Number.isInteger(body.allowedHostCount) ? body.allowedHostCount : null, observedDestinations };
  } catch (_error) { /* safe status only */ }

  let mcp = { status: 'UNREACHABLE', reason: 'MCP_PROBE_NOT_COMPLETED', tools: [] };
  try { mcp = await probeMcp(); } catch (_error) { mcp = { status: 'UNREACHABLE', reason: 'MCP_PROBE_FAILED', tools: [] }; }

  const constraints = containment();
  const readiness = evaluateHealthReadiness({
    identityInitialized: assessedIdentity.initialized,
    identity: assessedIdentity,
    constraints,
    proxyStatus: proxy.status,
    mcpStatus: mcp.status,
  });
  return {
    ok: readiness.ok,
    service: 'SkyCommand Managed Codex Runtime Worker',
    runtimeKind: identity.runtimeKind,
    codexVersion: identity.codexVersion,
    observedCodexVersion: identity.observedCodexVersion,
    expectedCodexVersion: identity.expectedCodexVersion,
    packageIntegrity: identity.packageIntegrity,
    observedPackageIntegrity: identity.observedPackageIntegrity,
    expectedPackageIntegrity: identity.expectedPackageIntegrity,
    observedWrapperPackageIntegrity: identity.observedWrapperPackageIntegrity,
    expectedWrapperPackageIntegrity: identity.expectedWrapperPackageIntegrity,
    observedPlatformPackageVersion: identity.observedPlatformPackageVersion,
    expectedPlatformPackageVersion: identity.expectedPlatformPackageVersion,
    observedPackageLockSha256: identity.observedPackageLockSha256,
    expectedPackageLockSha256: identity.expectedPackageLockSha256,
    observedInstalledArtifactSha256: identity.observedInstalledArtifactSha256,
    expectedInstalledArtifactSha256: identity.expectedInstalledArtifactSha256,
    identityAttestation: identity.identityAttestation,
    identityMismatchFields: assessedIdentity.identityMismatchFields,
    imageBuildId: process.env.CODEX_RUNTIME_BUILD_ID || 'UNSET',
    hostname: os.hostname(),
    runtimeGeneration: identity.runtimeGeneration,
    processId: identity.processId,
    processStartedAt: identity.processStartedAt,
    protocolSchemaDigest: identity.protocolSchemaDigest,
    observedProtocolSchemaDigest: identity.observedProtocolSchemaDigest,
    expectedProtocolSchemaDigest: identity.expectedProtocolSchemaDigest,
    protocolSchemaV2Digest: identity.protocolSchemaV2Digest,
    expectedProtocolSchemaV2Digest: identity.expectedProtocolSchemaV2Digest,
    loginStateDiagnostic: safeLoginStateDiagnostic(
      typeof runtimeClient.loginStateDiagnostic === 'function' ? runtimeClient.loginStateDiagnostic() : {},
    ),
    configurationDigest: identity.configurationDigest,
    networkPolicyDigest: proxy.policyDigest,
    observedProviderDestinations: proxy.observedDestinations,
    ...providerReachabilityState(),
    mcpReachability: mcp.status,
    mcpFailureReason: mcp.reason || null,
    mcpTools: mcp.tools,
    managedHomeReference: 'docker-volume:skycommand_codex_managed_home',
    executionEnabled: false,
    containment: constraints,
    readiness: readiness.readiness,
    readinessCode: readiness.readinessCode,
    failedCondition: readiness.failedCondition,
    observedAt: new Date().toISOString(),
  };
}

async function readRecentProviderEgressDenials(sinceMs, fetcher = fetch) {
  try {
    const response = await fetcher('http://skycommand-codex-egress-proxy:3128/diagnostics', {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return (Array.isArray(payload.events) ? payload.events : [])
      .filter((event) => event.decision === 'DENY'
        && event.reason === 'HOST_NOT_ALLOWLISTED'
        && Date.parse(event.observedAt) >= sinceMs - 5000
        && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(event.host || '')))
      .slice(-20)
      .map((event) => ({
        host: String(event.host).toLowerCase(),
        decision: 'DENY',
        reason: 'HOST_NOT_ALLOWLISTED',
        observedAt: event.observedAt,
      }));
  } catch (_error) {
    return [];
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw Object.assign(new Error('Request too large.'), { code: 'REQUEST_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_error) { throw Object.assign(new Error('Invalid JSON.'), { code: 'INVALID_JSON' }); }
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function createControlServer(options = {}) {
  const token = options.token || controlToken || readControlToken();
  const runtimeClient = options.client || client;
  const healthBuilder = options.buildHealth || (() => buildHealth(runtimeClient));
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://runtime.local').pathname;
    if (req.method === 'GET' && pathname === '/health') {
      try { return send(res, 200, await healthBuilder()); }
      catch (_error) {
        return send(res, 503, {
          ok: false,
          readiness: 'RUNTIME_OFFLINE',
          readinessCode: 'CODEX_HEALTH_EVALUATION_FAILED',
          failedCondition: 'HEALTH_EVALUATION',
        });
      }
    }
    const supplied = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
    if (!constantTimeEqual(supplied, token)) return send(res, 401, { ok: false, code: 'CODEX_RUNTIME_CONTROL_UNAUTHORIZED' });
    try {
      const body = await readBody(req);
      if (req.method === 'POST' && pathname === '/enrollment/start') {
        if (!/^[0-9a-f-]{36}$/i.test(String(body.operationId || ''))) return send(res, 400, { ok: false, code: 'ENROLLMENT_OPERATION_ID_INVALID' });
        const startedAt = Date.now();
        try {
          const result = await runtimeClient.startDeviceCodeLogin(body.operationId);
          lastProviderContactAt = new Date().toISOString();
          return send(res, 200, { ok: true, enrollment: result, providerReachability: 'CURRENT' });
        } catch (error) {
          const observedProviderDestinations = await readRecentProviderEgressDenials(startedAt);
          if (observedProviderDestinations.length) {
            return send(res, 503, {
              ok: false,
              code: 'CODEX_PROVIDER_EGRESS_BLOCKED',
              message: 'Pinned Codex app-server provider traffic was denied by the managed egress policy.',
              details: { observedProviderDestinations },
            });
          }
          throw error;
        }
      }
      if (req.method === 'POST' && pathname === '/enrollment/reconcile') {
        if (!/^[0-9a-f-]{36}$/i.test(String(body.operationId || ''))) return send(res, 400, { ok: false, code: 'ENROLLMENT_OPERATION_ID_INVALID' });
        const result = await runtimeClient.reconcileLogin(body.operationId);
        if (result.account?.authenticated) lastProviderContactAt = new Date().toISOString();
        return send(res, 200, { ok: true, enrollment: result });
      }
      if (req.method === 'POST' && pathname === '/account/read') {
        const account = await runtimeClient.readAccount();
        if (account.authenticated) lastProviderContactAt = new Date().toISOString();
        return send(res, 200, { ok: true, account });
      }
      if (req.method === 'POST' && pathname === '/account/metadata') {
        const account = await runtimeClient.readAccount();
        if (!account.authenticated) return send(res, 409, { ok: false, code: 'ACCOUNT_UNENROLLED', account });
        lastProviderContactAt = new Date().toISOString();
        const [rateLimits, usage] = await Promise.all([runtimeClient.readRateLimits(), runtimeClient.readUsage()]);
        return send(res, 200, { ok: true, account, rateLimits, usage, source: 'CODEX_APP_SERVER', observedAt: new Date().toISOString() });
      }
      if (req.method === 'POST' && pathname === '/account/logout') {
        const account = await runtimeClient.logout();
        lastProviderContactAt = null;
        return send(res, 200, { ok: true, account, executionEnabled: false });
      }
      if (req.method === 'POST' && pathname === '/enrollment/cancel') {
        const loginId = String(body.loginId || '');
        if (!loginId || loginId !== runtimeClient.loginState?.loginId) return send(res, 409, { ok: false, code: 'ENROLLMENT_LOGIN_ID_MISMATCH' });
        await runtimeClient.cancelLogin(loginId);
        return send(res, 200, { ok: true, state: 'CANCELLED' });
      }
      return send(res, 404, { ok: false, code: 'CODEX_RUNTIME_ROUTE_NOT_FOUND' });
    } catch (error) {
      const candidateCode = error instanceof CodexAppServerError ? error.code : error?.code;
      const code = typeof candidateCode === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(candidateCode)
        ? candidateCode
        : 'CODEX_RUNTIME_OPERATION_FAILED';
      const rpcDiagnostic = safeRpcDiagnostic(error?.details?.rpcDiagnostic);
      return send(res, error.code === 'CODEX_LOGIN_ALREADY_PENDING' ? 409 : 503, {
        ok: false,
        code,
        ...(rpcDiagnostic ? { details: { rpcDiagnostic } } : {}),
      });
    }
  });
}

async function start() {
  const bindAddress = await resolveRuntimeControlAddress();
  controlToken = readControlToken();
  await client.start();
  await restoreProviderReachability(client);
  const server = createControlServer();
  listenOnRuntimeControlAddress(server, bindAddress);
  const close = async () => {
    server.close();
    await client.stop();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

if (require.main === module) {
  start().catch((error) => {
    const code = String(error?.code || 'CODEX_RUNTIME_START_FAILED');
    process.stderr.write(`${JSON.stringify({ service: 'codex-agent-runtime-worker', status: 'FAILED', code })}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildHealth,
  containment,
  createControlServer,
  evaluateHealthReadiness,
  evaluateContainment,
  firstIdentityFailure,
  firstContainmentFailureCode,
  isContainmentCompatible,
  listenOnRuntimeControlAddress,
  mcpProbe,
  resolveRuntimeControlAddress,
  readBody,
  readRecentProviderEgressDenials,
  providerReachabilityState,
  restoreProviderReachability,
  start,
};
