#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const yaml = require('yaml');

const repositoryRoot = path.resolve(__dirname, '../../..');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), quiet: true });

const {
  CODEX_LINUX_X64_INTEGRITY,
  CODEX_WRAPPER_INTEGRITY,
  CODEX_VERSION,
  CodexAppServerClient,
  CodexAppServerError,
  readPackageIdentity,
  readRuntimeCertification,
  safeLoginStateDiagnostic: safeWorkerLoginStateDiagnostic,
  safeRpcDiagnostic: safeWorkerRpcDiagnostic,
  safeAccountResult,
  SAFE_RPC_METHODS,
} = require(path.join(
  repositoryRoot,
  'apps/codex-agent-runtime-worker/src/appServerClient',
));
const { installedPackageArtifactSha256, writeBuildAttestation } = require(path.join(
  repositoryRoot,
  'apps/codex-agent-runtime-worker/src/packageArtifactAttestation',
));
const {
  buildHealth,
  evaluateHealthReadiness,
  firstIdentityFailure,
  evaluateContainment,
  firstContainmentFailureCode,
  isContainmentCompatible,
  createControlServer: createWorkerControlServer,
  listenOnRuntimeControlAddress,
  readRecentProviderEgressDenials,
  providerReachabilityState,
  restoreProviderReachability,
  resolveRuntimeControlAddress,
} = require(path.join(
  repositoryRoot,
  'apps/codex-agent-runtime-worker/src/index',
));
const { runHealthcheck, safeReadinessDetails } = require(path.join(
  repositoryRoot,
  'apps/codex-agent-runtime-worker/src/healthcheck',
));
const { addressIsPublic, hostAllowed } = require(path.join(
  repositoryRoot,
  'apps/codex-egress-proxy/src/policy',
));
const {
  assessRuntimeIdentity,
  bootstrapSourceConfigurationFingerprint,
  expectedCertification,
  callBridge,
  enrollmentRuntimeReadiness,
  persistRuntimeObservation,
  safeManagedStatus,
  safeLoginStateDiagnostic: safeApiLoginStateDiagnostic,
  safeRpcDiagnostic: safeApiRpcDiagnostic,
  safeProviderDestinations,
  reconcileEnrollment,
  logoutManagedAccount,
  validateDeviceResponse,
} = require(path.join(
  repositoryRoot,
  'apps/api/src/services/managedCodexBootstrapService',
));
const assistantIntegrationService = require(path.join(repositoryRoot, 'apps/api/src/services/assistantIntegrationService'));
const authService = require(path.join(repositoryRoot, 'apps/api/src/services/authService'));
const {
  API_CONTROL_BIND_HOST,
  PORT: CONTROL_BRIDGE_PORT,
  WORKER_URL: CONTROL_BRIDGE_WORKER_URL,
  createServer: createControlBridgeServer,
  listenOnApiControlAddress,
  resolveApiControlAddress,
  safeLoginStateDiagnostic: safeBridgeLoginStateDiagnostic,
  safeRpcDiagnostic: safeBridgeRpcDiagnostic,
  safeWorkerErrorPayload,
} = require(path.join(repositoryRoot, 'apps/codex-control-bridge/src/index'));
const { getCapabilities } = assistantIntegrationService;
const { CODEX_BOOTSTRAP_REBUILD_SERVICES } = require(path.join(repositoryRoot, 'packages/supervisor/src/config'));
const managedCodexBootstrapService = require(path.join(repositoryRoot, 'apps/api/src/services/managedCodexBootstrapService'));
const { getManagedCodexLifecycle, startManagedCodexLifecycle } = managedCodexBootstrapService;
const protocolCertification = readRuntimeCertification();
assert.ok(protocolCertification, 'the source-controlled Codex protocol certification is valid');
const EXPECTED_INSTALLED_ARTIFACT_SHA256 = protocolCertification.installedArtifactSha256;
const EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST = protocolCertification.primaryProtocolSchemaDigest;
const EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST = protocolCertification.protocolSchemaV2Digest;

const matchingWorkerIdentity = {
  observedCodexVersion: CODEX_VERSION,
  expectedCodexVersion: CODEX_VERSION,
  observedPackageIntegrity: CODEX_LINUX_X64_INTEGRITY,
  expectedPackageIntegrity: CODEX_LINUX_X64_INTEGRITY,
  observedWrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
  expectedWrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
  observedProtocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
  expectedProtocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
  protocolSchemaV2Digest: EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST,
  expectedProtocolSchemaV2Digest: EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST,
  observedInstalledArtifactSha256: EXPECTED_INSTALLED_ARTIFACT_SHA256,
  expectedInstalledArtifactSha256: EXPECTED_INSTALLED_ARTIFACT_SHA256,
  identityAttestation: 'VERIFIED',
  identityMismatchFields: [],
};

assert.equal(safeAccountResult({ account: { type: 'chatgpt', email: 'hidden@example.test' }, requiresOpenaiAuth: true }).authenticated, true);
assert.equal(safeAccountResult({ account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: false }).authenticated, true);
assert.equal(safeAccountResult({ account: null, requiresOpenaiAuth: true }).authenticated, false);
assert.equal(safeAccountResult({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }).authenticated, false);
assert.equal(JSON.stringify(safeAccountResult({ account: { type: 'chatgpt', email: 'hidden@example.test' }, requiresOpenaiAuth: true })).includes('hidden@example.test'), false);
assert.equal(SAFE_RPC_METHODS.has('turn/start'), false);
assert.equal(SAFE_RPC_METHODS.has('thread/start'), false);

async function testProviderReachabilityRestoreAfterRestart() {
  const restored = await restoreProviderReachability({
    readAccount: async () => ({ authenticated: true, accountType: 'chatgpt' }),
  });
  assert.equal(restored.providerReachability, 'CURRENT');
  assert.match(String(restored.providerLastVerifiedAt || ''), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(providerReachabilityState().providerReachability, 'CURRENT');

  const unenrolled = await restoreProviderReachability({
    readAccount: async () => ({ authenticated: false }),
  });
  assert.deepEqual(unenrolled, { providerReachability: 'UNKNOWN', providerLastVerifiedAt: null });

  const unavailable = await restoreProviderReachability({
    readAccount: async () => { throw new Error('provider unavailable'); },
  });
  assert.deepEqual(unavailable, { providerReachability: 'UNKNOWN', providerLastVerifiedAt: null });
}

assert.equal(hostAllowed('api.openai.com', ['api.openai.com']), true);
assert.equal(hostAllowed('sub.api.openai.com', ['api.openai.com']), false);
assert.equal(addressIsPublic('127.0.0.1'), false);
assert.equal(addressIsPublic('10.1.2.3'), false);
assert.equal(addressIsPublic('2001:1::1'), false);
assert.equal(addressIsPublic('2001:1ff::1'), false);
assert.equal(addressIsPublic('2001:200::1'), true);
assert.equal(addressIsPublic('1.1.1.1'), true);

const containmentStatus = [
  'Uid:\t1000\t1000\t1000\t1000',
  'NoNewPrivs:\t1',
  'CapEff:\t0000000000000000',
].join('\n');
const mountInfoLine = (
  id,
  target,
  options,
  filesystemType = 'ext4',
  source = `/dev/volume-${id}`,
  root = '/',
) => `${id} 1 0:${id} ${root} ${target} ${options} - ${filesystemType} ${source} rw`;
const managedMounts = [
  mountInfoLine(1, '/', 'ro,relatime', 'overlay', 'overlay'),
  mountInfoLine(2, '/var/lib/codex', 'rw,relatime', 'ext4', '/dev/volume-managed-home'),
  mountInfoLine(3, '/run/codex-runtime-control', 'ro,relatime', 'ext4', '/dev/volume-runtime-control'),
].join('\n');
const procNullMaskTargets = [
  '/proc/interrupts',
  '/proc/kcore',
  '/proc/keys',
  '/proc/latency_stats',
  '/proc/timer_list',
];
const normalRuntimeMounts = [
  mountInfoLine(4, '/proc', 'rw,nosuid,nodev,noexec,relatime', 'proc', 'proc'),
  mountInfoLine(5, '/proc/sys', 'ro,nosuid,nodev,noexec,relatime', 'proc', 'proc'),
  mountInfoLine(17, '/proc/acpi', 'ro,nosuid,nodev', 'tmpfs', 'tmpfs'),
  ...procNullMaskTargets.map((target, index) => mountInfoLine(18 + index, target, 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/null')),
  mountInfoLine(23, '/proc/scsi', 'ro,nosuid,nodev', 'tmpfs', 'tmpfs'),
  mountInfoLine(6, '/sys', 'ro,nosuid,nodev,noexec,relatime', 'sysfs', 'sysfs'),
  mountInfoLine(7, '/sys/fs/cgroup', 'ro,nosuid,nodev,noexec,relatime', 'cgroup2', 'cgroup'),
  mountInfoLine(8, '/dev', 'rw,nosuid', 'tmpfs', 'tmpfs'),
  mountInfoLine(9, '/dev/pts', 'rw,nosuid,noexec', 'devpts', 'devpts'),
  mountInfoLine(10, '/dev/shm', 'rw,nosuid,nodev', 'tmpfs', 'shm'),
  mountInfoLine(11, '/dev/mqueue', 'rw,nosuid,nodev,noexec', 'mqueue', 'mqueue'),
  mountInfoLine(12, '/tmp', 'rw,nosuid,nodev,noexec', 'tmpfs', 'tmpfs'),
  mountInfoLine(13, '/usr/sbin/docker-init', 'ro,relatime', 'overlay', 'overlay'),
  mountInfoLine(14, '/etc/hosts', 'rw,relatime', 'ext4', '/dev/docker-hosts'),
  mountInfoLine(15, '/etc/hostname', 'rw,relatime', 'ext4', '/dev/docker-hostname'),
  mountInfoLine(16, '/etc/resolv.conf', 'rw,relatime', 'ext4', '/dev/docker-resolv'),
].join('\n');
const containmentSnapshot = {
  processStatus: containmentStatus,
  mountInfo: `${managedMounts}\n${normalRuntimeMounts}`,
  effectiveUid: 1000,
  forbiddenEnvironmentKeys: [],
  dockerSocketPresent: false,
  gitAvailable: false,
  browserStatePresent: false,
};
const managedMountContainment = evaluateContainment(containmentSnapshot);
assert.equal(managedMountContainment.managedHomeVolumeOnly, true);
assert.equal(managedMountContainment.managedRuntimeControlMountPresent, true);
assert.equal(managedMountContainment.managedRuntimeControlMountReadOnly, true);
assert.equal(managedMountContainment.arbitraryHostPathMount, false);
assert.equal(isContainmentCompatible(managedMountContainment), true);
for (const [index, target] of procNullMaskTargets.entries()) {
  const exactProcNullMask = evaluateContainment({
    ...containmentSnapshot,
    mountInfo: `${managedMounts}\n${mountInfoLine(40 + index, target, 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/null')}`,
  });
  assert.equal(exactProcNullMask.arbitraryHostPathMount, false, `${target} should match the observed RW null-mask structure`);
}

const procTmpfsBindMount = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(24, '/proc/acpi', 'ro,nosuid,nodev', 'tmpfs', 'tmpfs', '/host/private')}`,
});
assert.equal(procTmpfsBindMount.arbitraryHostPathMount, true);
assert.equal(procTmpfsBindMount.unexpectedMountTargets.includes('/proc/acpi'), true);

const unexpectedProcTmpfsMount = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(25, '/proc/private', 'ro,nosuid,nodev', 'tmpfs', 'tmpfs')}`,
});
assert.equal(unexpectedProcTmpfsMount.arbitraryHostPathMount, true);
assert.equal(unexpectedProcTmpfsMount.unexpectedMountTargets.includes('/proc/private'), true);

const unexpectedProcNullMaskTarget = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(26, '/proc/private', 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/null')}`,
});
assert.deepEqual(unexpectedProcNullMaskTarget.unexpectedMountTargets, ['/proc/private']);

const unexpectedNullMaskOutsideProc = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(27, '/run/private', 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/null')}`,
});
assert.deepEqual(unexpectedNullMaskOutsideProc.unexpectedMountTargets, ['/run/private']);

const unexpectedProcNullMaskChildPath = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(28, '/proc/interrupts/child', 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/null')}`,
});
assert.deepEqual(unexpectedProcNullMaskChildPath.unexpectedMountTargets, ['/proc/interrupts/child']);

const unexpectedProcNullMaskRoot = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(29, '/proc/interrupts', 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/host/null')}`,
});
assert.equal(unexpectedProcNullMaskRoot.arbitraryHostPathMount, true);
assert.equal(unexpectedProcNullMaskRoot.unexpectedMountTargets.includes('/proc/interrupts'), true);

const unexpectedProcNullMaskSource = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(30, '/proc/kcore', 'rw,nosuid,nodev', 'tmpfs', '/dev/null', '/null')}`,
});
assert.equal(unexpectedProcNullMaskSource.arbitraryHostPathMount, true);
assert.equal(unexpectedProcNullMaskSource.unexpectedMountTargets.includes('/proc/kcore'), true);

const unexpectedProcNullMaskFilesystem = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(33, '/proc/keys', 'rw,nosuid,nodev', 'ext4', 'tmpfs', '/null')}`,
});
assert.equal(unexpectedProcNullMaskFilesystem.arbitraryHostPathMount, true);
assert.equal(unexpectedProcNullMaskFilesystem.unexpectedMountTargets.includes('/proc/keys'), true);

const unexpectedProcNullMaskDirectoryRoot = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(31, '/proc/keys', 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/')}`,
});
assert.equal(unexpectedProcNullMaskDirectoryRoot.arbitraryHostPathMount, true);
assert.equal(unexpectedProcNullMaskDirectoryRoot.unexpectedMountTargets.includes('/proc/keys'), true);

const unexpectedArbitraryRwTmpfs = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(34, '/run/arbitrary', 'rw,nosuid,nodev', 'tmpfs', 'tmpfs', '/')}`,
});
assert.equal(unexpectedArbitraryRwTmpfs.arbitraryHostPathMount, true);
assert.equal(unexpectedArbitraryRwTmpfs.unexpectedMountTargets.includes('/run/arbitrary'), true);

const unexpectedMountContainment = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(20, '/host/secret', 'ro,relatime', 'ext4', '/dev/host-filesystem', '/host/config')}`,
});
assert.equal(unexpectedMountContainment.arbitraryHostPathMount, true);
assert.deepEqual(unexpectedMountContainment.unexpectedMountTargets, ['/host/secret']);
assert.equal(isContainmentCompatible(unexpectedMountContainment), false);
assert.equal(firstContainmentFailureCode(unexpectedMountContainment), 'CODEX_CONTAINMENT_UNEXPECTED_MOUNT_PRESENT');

const unexpectedVolumeContainment = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(21, '/opt/agent-data', 'rw,relatime', 'ext4', '/dev/volume-unexpected')}`,
});
assert.deepEqual(unexpectedVolumeContainment.unexpectedMountTargets, ['/opt/agent-data']);
assert.equal(isContainmentCompatible(unexpectedVolumeContainment), false);

const structuralMountSpoofContainment = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${containmentSnapshot.mountInfo}\n${mountInfoLine(22, '/dev/shm', 'rw,relatime', 'ext4', '/dev/unexpected-bind', '/host/shm')}`,
});
assert.deepEqual(structuralMountSpoofContainment.unexpectedMountTargets, ['/dev/shm']);
assert.equal(isContainmentCompatible(structuralMountSpoofContainment), false);

const unexpectedDockerInitMount = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: `${managedMounts}\n${normalRuntimeMounts.replace(
    mountInfoLine(13, '/usr/sbin/docker-init', 'ro,relatime', 'overlay', 'overlay'),
    mountInfoLine(13, '/usr/sbin/docker-init', 'ro,relatime', 'ext4', '/dev/host-init', '/host/docker-init'),
  )}`,
});
assert.deepEqual(unexpectedDockerInitMount.unexpectedMountTargets, ['/usr/sbin/docker-init']);
assert.equal(isContainmentCompatible(unexpectedDockerInitMount), false);

const writableDockerInitMount = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: containmentSnapshot.mountInfo.replace(
    mountInfoLine(13, '/usr/sbin/docker-init', 'ro,relatime', 'overlay', 'overlay'),
    mountInfoLine(13, '/usr/sbin/docker-init', 'rw,relatime', 'overlay', 'overlay'),
  ),
});
assert.deepEqual(writableDockerInitMount.unexpectedMountTargets, ['/usr/sbin/docker-init']);
assert.equal(isContainmentCompatible(writableDockerInitMount), false);

const writableRuntimeControlContainment = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: managedMounts.replace('/run/codex-runtime-control ro,relatime', '/run/codex-runtime-control rw,relatime'),
});
assert.equal(writableRuntimeControlContainment.managedRuntimeControlMountPresent, true);
assert.equal(writableRuntimeControlContainment.managedRuntimeControlMountReadOnly, false);
assert.equal(isContainmentCompatible(writableRuntimeControlContainment), false);

const missingRuntimeControlContainment = evaluateContainment({
  ...containmentSnapshot,
  mountInfo: managedMounts.split('\n').filter((line) => !line.includes('/run/codex-runtime-control')).join('\n'),
});
assert.equal(missingRuntimeControlContainment.managedRuntimeControlMountPresent, false);
assert.equal(isContainmentCompatible(missingRuntimeControlContainment), false);
assert.equal(firstContainmentFailureCode(missingRuntimeControlContainment), 'CODEX_CONTAINMENT_RUNTIME_CONTROL_MOUNT_MISSING');

assert.deepEqual(evaluateHealthReadiness({
  identityInitialized: false,
  identity: matchingWorkerIdentity,
  constraints: managedMountContainment,
  proxyStatus: 'UNREACHABLE',
  mcpStatus: 'UNREACHABLE',
}), {
  ok: false,
  readiness: 'INSTALLATION_UNCERTIFIED',
  readinessCode: 'CODEX_APP_SERVER_NOT_INITIALIZED',
  failedCondition: 'APP_SERVER_INITIALIZATION',
});
assert.deepEqual(evaluateHealthReadiness({
  identityInitialized: true,
  identity: matchingWorkerIdentity,
  constraints: managedMountContainment,
  proxyStatus: 'UNREACHABLE',
  mcpStatus: 'UNREACHABLE',
}), {
  ok: false,
  readiness: 'PROVIDER_UNREACHABLE',
  readinessCode: 'CODEX_EGRESS_PROXY_UNAVAILABLE',
  failedCondition: 'EGRESS_PROXY',
});
assert.deepEqual(evaluateHealthReadiness({
  identityInitialized: true,
  identity: matchingWorkerIdentity,
  constraints: managedMountContainment,
  proxyStatus: 'CURRENT',
  mcpStatus: 'BLOCKED',
}), {
  ok: false,
  readiness: 'MCP_UNREACHABLE',
  readinessCode: 'CODEX_MANAGED_MCP_UNAVAILABLE',
  failedCondition: 'MANAGED_MCP',
});
assert.deepEqual(evaluateHealthReadiness({
  identityInitialized: true,
  identity: { ...matchingWorkerIdentity, observedCodexVersion: '0.155.0-alpha.9.2' },
  constraints: managedMountContainment,
  proxyStatus: 'CURRENT',
  mcpStatus: 'CURRENT',
}), {
  ok: false,
  readiness: 'PROTOCOL_INCOMPATIBLE',
  readinessCode: 'CODEX_VERSION_MISMATCH',
  failedCondition: 'CODEX_IDENTITY',
});
assert.equal(firstIdentityFailure({
  ...matchingWorkerIdentity,
  expectedProtocolSchemaDigest: null,
}), 'CODEX_PROTOCOL_SCHEMA_DIGEST_EXPECTED_MISSING');
assert.equal(firstIdentityFailure({
  ...matchingWorkerIdentity,
  observedProtocolSchemaDigest: 'F'.repeat(64),
}), 'CODEX_PROTOCOL_SCHEMA_DIGEST_MISMATCH');
assert.equal(evaluateHealthReadiness({
  identityInitialized: true,
  identity: { ...matchingWorkerIdentity, expectedProtocolSchemaDigest: null },
  constraints: managedMountContainment,
  proxyStatus: 'CURRENT',
  mcpStatus: 'CURRENT',
}).readiness, 'PROTOCOL_INCOMPATIBLE');
assert.deepEqual(safeReadinessDetails({
  readiness: 'PROTOCOL_INCOMPATIBLE',
  readinessCode: 'CODEX_VERSION_MISMATCH',
  failedCondition: 'CODEX_IDENTITY',
  identityMismatchFields: ['observedCodexVersion', 'private-state'],
}), {
  readiness: 'PROTOCOL_INCOMPATIBLE',
  readinessCode: 'CODEX_VERSION_MISMATCH',
  failedCondition: 'CODEX_IDENTITY',
  identityMismatchFields: ['observedCodexVersion'],
});

async function captureHealthcheck(options) {
  let output = '';
  const exitCode = await runHealthcheck({
    address: '172.24.0.3',
    output: { write: (chunk) => { output += chunk; } },
    ...options,
  });
  return { exitCode, output };
}

async function testRuntimeControlNetworkBinding() {
  const networkInterfaces = {
    eth0: [{ address: '172.21.0.3', family: 'IPv4', internal: false }],
    eth1: [{ address: '172.22.0.3', family: 'IPv4', internal: false }],
    eth2: [{ address: '172.20.0.2', family: 'IPv4', internal: false }],
  };
  let resolvedHostname = null;
  const lookup = async (hostname, options) => {
    resolvedHostname = hostname;
    assert.deepEqual(options, { all: true, verbatim: true });
    return [{ address: '172.20.0.2', family: 4 }];
  };
  const controlAddress = await resolveRuntimeControlAddress({ lookup, networkInterfaces });
  assert.equal(resolvedHostname, 'codex-agent-runtime-worker-runtime-control');
  assert.equal(controlAddress, '172.20.0.2');
  assert.notEqual(controlAddress, networkInterfaces.eth0[0].address, 'provider-facing eth0 must not receive the control listener');
  assert.notEqual(controlAddress, networkInterfaces.eth1[0].address, 'MCP-facing interface must not receive the control listener');

  const listenCalls = [];
  listenOnRuntimeControlAddress({ listen: (...args) => listenCalls.push(args) }, controlAddress, 4219);
  assert.deepEqual(listenCalls, [[4219, '172.20.0.2']], 'the listener must bind the runtime-control network endpoint');
  assert.throws(
    () => listenOnRuntimeControlAddress({ listen: (...args) => listenCalls.push(args) }, '0.0.0.0', 4219),
    (error) => error.code === 'CODEX_RUNTIME_CONTROL_BINDING_UNAVAILABLE',
  );
  assert.equal(listenCalls.length, 1, 'invalid binding must not start a wildcard listener');

  await assert.rejects(
    resolveRuntimeControlAddress({ lookup: async () => { throw new Error('not found'); }, networkInterfaces }),
    (error) => error.code === 'CODEX_RUNTIME_CONTROL_BINDING_UNAVAILABLE',
  );
  await assert.rejects(
    resolveRuntimeControlAddress({
      lookup: async () => [
        { address: '172.20.0.2', family: 4 },
        { address: '172.21.0.3', family: 4 },
      ],
      networkInterfaces,
    }),
    (error) => error.code === 'CODEX_RUNTIME_CONTROL_BINDING_UNAVAILABLE',
    'ambiguous role-alias answers must fail closed',
  );
  await assert.rejects(
    resolveRuntimeControlAddress({
      lookup: async () => [{ address: '172.20.0.99', family: 4 }],
      networkInterfaces,
    }),
    (error) => error.code === 'CODEX_RUNTIME_CONTROL_BINDING_UNAVAILABLE',
    'an address not assigned to this worker must fail closed',
  );

  const compose = fs.readFileSync(path.join(repositoryRoot, 'compose.yaml'), 'utf8');
  const workerService = /^  codex-agent-runtime-worker:\r?\n([\s\S]*?)(?=^  codex-control-bridge:)/m.exec(compose)?.[1];
  assert.ok(workerService, 'worker Compose service must exist');
  assert.match(workerService, /\n    networks:\r?\n      codex_runtime_control:\r?\n        aliases:\r?\n          - codex-agent-runtime-worker-runtime-control\r?\n      codex_mcp_internal: \{\}\r?\n      codex_provider_internal: \{\}/);
  assert.doesNotMatch(workerService, /CODEX_RUNTIME_CONTROL_INTERFACE|eth0/);
  const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'docker/codex-agent-runtime/Dockerfile'), 'utf8');
  assert.doesNotMatch(dockerfile, /CODEX_RUNTIME_CONTROL_INTERFACE|eth0/);
  assert.match(
    dockerfile,
    /tls\.rootCertificates/,
    'Codex runtime trust bootstrap must derive its CA bundle from Node embedded roots',
  );
  assert.match(
    dockerfile,
    /SSL_CERT_FILE=\/etc\/ssl\/certs\/ca-certificates\.crt/,
    'Codex runtime must expose the generated CA bundle through SSL_CERT_FILE',
  );
  assert.doesNotMatch(
    dockerfile,
    /apt-get|deb\.debian\.org/,
    'Codex runtime trust bootstrap must not depend on Debian package-repository network access',
  );

  let probedUrl = null;
  const healthcheckOnControlNetwork = await captureHealthcheck({
    address: undefined,
    resolveAddress: async () => controlAddress,
    fetcher: async (url) => {
      probedUrl = url;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  assert.equal(healthcheckOnControlNetwork.exitCode, 0);
  assert.equal(probedUrl, 'http://172.20.0.2:4219/health', 'health must probe the same control-network endpoint');

  const unreachableControlHealthcheck = await captureHealthcheck({
    address: undefined,
    resolveAddress: async () => controlAddress,
    fetcher: async (url) => {
      assert.equal(url, 'http://172.20.0.2:4219/health');
      throw Object.assign(new Error('connection refused'), { cause: { code: 'ECONNREFUSED' } });
    },
  });
  assert.deepEqual(JSON.parse(unreachableControlHealthcheck.output), {
    service: 'codex-agent-runtime-worker',
    probe: 'healthcheck',
    ok: false,
    code: 'CODEX_HEALTH_ENDPOINT_UNREACHABLE',
    transportCode: 'ECONNREFUSED',
  });

  const missingBindingHealthcheck = await captureHealthcheck({
    address: undefined,
    resolveAddress: async () => { throw Object.assign(new Error('private resolver details'), { code: 'CODEX_RUNTIME_CONTROL_BINDING_UNAVAILABLE' }); },
    fetcher: async () => { throw new Error('fetch must not run without a resolved control binding'); },
  });
  assert.deepEqual(JSON.parse(missingBindingHealthcheck.output), {
    service: 'codex-agent-runtime-worker',
    probe: 'healthcheck',
    ok: false,
    code: 'CODEX_HEALTHCHECK_CONTROL_BINDING_UNAVAILABLE',
  });
  assert.equal(missingBindingHealthcheck.output.includes('private resolver details'), false);
}

async function testHealthcheckDiagnostics() {
const healthcheckFailure = await captureHealthcheck({
  fetcher: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      readiness: 'PROVIDER_UNREACHABLE',
      readinessCode: 'CODEX_EGRESS_PROXY_UNAVAILABLE',
      failedCondition: 'EGRESS_PROXY',
      token: 'must-never-be-logged',
      privateProviderState: 'must-never-be-logged',
    }),
  }),
});
assert.equal(healthcheckFailure.exitCode, 1);
assert.deepEqual(JSON.parse(healthcheckFailure.output), {
  service: 'codex-agent-runtime-worker',
  probe: 'healthcheck',
  ok: false,
  code: 'CODEX_HEALTHCHECK_READINESS_FAILED',
  httpStatus: 200,
  readiness: 'PROVIDER_UNREACHABLE',
  readinessCode: 'CODEX_EGRESS_PROXY_UNAVAILABLE',
  failedCondition: 'EGRESS_PROXY',
});
assert.equal(healthcheckFailure.output.includes('must-never-be-logged'), false);

const healthcheckUnexpectedMountFailure = await captureHealthcheck({
  fetcher: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      readiness: 'RUNTIME_INCOMPATIBLE',
      readinessCode: 'CODEX_CONTAINMENT_UNEXPECTED_MOUNT_PRESENT',
      failedCondition: 'CONTAINMENT',
      containment: {
        unexpectedMountTargets: ['/usr/sbin/docker-init', '/host/private', '/bad/../secret', 'relative/path'],
        mountSources: ['/host/private/source'],
        credential: 'must-never-be-logged',
      },
    }),
  }),
});
assert.deepEqual(JSON.parse(healthcheckUnexpectedMountFailure.output), {
  service: 'codex-agent-runtime-worker',
  probe: 'healthcheck',
  ok: false,
  code: 'CODEX_HEALTHCHECK_READINESS_FAILED',
  httpStatus: 200,
  readiness: 'RUNTIME_INCOMPATIBLE',
  readinessCode: 'CODEX_CONTAINMENT_UNEXPECTED_MOUNT_PRESENT',
  failedCondition: 'CONTAINMENT',
  unexpectedMountTargets: ['/usr/sbin/docker-init', '/host/private'],
});
assert.equal(healthcheckUnexpectedMountFailure.output.includes('source'), false);
assert.equal(healthcheckUnexpectedMountFailure.output.includes('must-never-be-logged'), false);

const healthcheckTransportFailure = await captureHealthcheck({
  fetcher: async () => { throw Object.assign(new Error('secret-bearing error text'), { cause: { code: 'ECONNREFUSED' } }); },
});
assert.deepEqual(JSON.parse(healthcheckTransportFailure.output), {
  service: 'codex-agent-runtime-worker',
  probe: 'healthcheck',
  ok: false,
  code: 'CODEX_HEALTH_ENDPOINT_UNREACHABLE',
  transportCode: 'ECONNREFUSED',
});
assert.equal(healthcheckTransportFailure.output.includes('secret-bearing'), false);

const healthcheckNoAddress = await captureHealthcheck({ address: null });
assert.deepEqual(JSON.parse(healthcheckNoAddress.output), {
  service: 'codex-agent-runtime-worker',
  probe: 'healthcheck',
  ok: false,
  code: 'CODEX_HEALTHCHECK_CONTROL_BINDING_UNAVAILABLE',
});
const healthcheckSuccess = await captureHealthcheck({
  fetcher: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
});
assert.equal(healthcheckSuccess.exitCode, 0);
assert.equal(healthcheckSuccess.output, '');
}

async function testControlBridgeHealthFailsClosed() {
  const checkBridgeHealth = async (fetcher) => {
    const server = createControlBridgeServer({ token: 't'.repeat(48), fetcher });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
      return { status: response.status, payload: await response.json() };
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };

  const unavailable = await checkBridgeHealth(async () => {
    throw Object.assign(new Error('worker endpoint unavailable'), { code: 'CODEX_RUNTIME_UNAVAILABLE' });
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.payload.ok, false);
  assert.equal(unavailable.payload.code, 'CODEX_RUNTIME_UNAVAILABLE');

  const unready = await checkBridgeHealth(async () => ({
    status: 200,
    payload: { ok: false, readiness: 'RUNTIME_OFFLINE', code: 'CODEX_RUNTIME_UNAVAILABLE' },
  }));
  assert.equal(unready.status, 503);
  assert.equal(unready.payload.ok, false, 'a 200 response with ok=false must not invert bridge readiness');
}

async function testControlBridgeNetworkBinding() {
  const networkInterfaces = {
    eth0: [{ address: '172.20.0.2', family: 'IPv4', internal: false }], // runtime-control
    eth1: [{ address: '172.19.0.3', family: 'IPv4', internal: false }], // API-control
  };
  let resolvedHostname = null;
  const apiAddress = await resolveApiControlAddress({
    lookup: async (hostname, options) => {
      resolvedHostname = hostname;
      assert.deepEqual(options, { all: true, verbatim: true });
      return [{ address: '172.19.0.3', family: 4 }];
    },
    networkInterfaces,
  });
  assert.equal(API_CONTROL_BIND_HOST, 'codex-control-bridge-api-control');
  assert.equal(resolvedHostname, API_CONTROL_BIND_HOST);
  assert.equal(apiAddress, '172.19.0.3');
  assert.notEqual(apiAddress, networkInterfaces.eth0[0].address, 'runtime-control-facing address must not receive the bridge listener');

  const listenCalls = [];
  listenOnApiControlAddress({ listen: (...args) => listenCalls.push(args) }, apiAddress, CONTROL_BRIDGE_PORT);
  assert.deepEqual(listenCalls, [[4220, '172.19.0.3']], 'bridge must bind only the API-control role address on port 4220');
  for (const invalidAddress of ['0.0.0.0', '127.0.0.1', '::', undefined]) {
    assert.throws(
      () => listenOnApiControlAddress({ listen: (...args) => listenCalls.push(args) }, invalidAddress, CONTROL_BRIDGE_PORT),
      (error) => error.code === 'CODEX_CONTROL_BRIDGE_BINDING_UNAVAILABLE',
    );
  }
  assert.equal(listenCalls.length, 1, 'invalid wildcard, loopback, or non-IPv4 addresses must never start a listener');

  const bindingError = (error) => error.code === 'CODEX_CONTROL_BRIDGE_BINDING_UNAVAILABLE';
  await assert.rejects(
    resolveApiControlAddress({ lookup: async () => { throw new Error('private resolver detail'); }, networkInterfaces }),
    bindingError,
  );
  await assert.rejects(
    resolveApiControlAddress({ lookup: async () => [], networkInterfaces }),
    bindingError,
  );
  await assert.rejects(
    resolveApiControlAddress({
      lookup: async () => [
        { address: '172.19.0.3', family: 4 },
        { address: '172.20.0.2', family: 4 },
      ],
      networkInterfaces,
    }),
    bindingError,
    'ambiguous API-control alias resolution must fail closed',
  );
  for (const invalidRecord of [
    { address: '172.19.0.99', family: 4 },
    { address: '0.0.0.0', family: 4 },
    { address: '127.0.0.1', family: 4 },
    { address: '172.19.0.3', family: 6 },
    { family: 4 },
  ]) {
    await assert.rejects(
      resolveApiControlAddress({ lookup: async () => [invalidRecord], networkInterfaces }),
      bindingError,
      'non-local, wildcard, loopback, and non-IPv4 role answers must fail closed',
    );
  }
  await assert.rejects(
    resolveApiControlAddress({
      lookup: async () => [{ address: '172.19.0.3', family: 4 }],
      networkInterfaces: { ...networkInterfaces, eth2: [{ address: '172.19.0.3', family: 'IPv4', internal: false }] },
    }),
    bindingError,
    'a role address assigned ambiguously to multiple interfaces must fail closed',
  );

  assert.equal(CONTROL_BRIDGE_WORKER_URL, 'http://codex-agent-runtime-worker-runtime-control:4219');
  const composeText = fs.readFileSync(path.join(repositoryRoot, 'compose.yaml'), 'utf8');
  const compose = yaml.parse(composeText);
  const bridge = compose.services['codex-control-bridge'];
  const api = compose.services.api;
  const worker = compose.services['codex-agent-runtime-worker'];
  assert.deepEqual(Object.keys(bridge.networks).sort(), ['codex_api_control', 'codex_runtime_control']);
  assert.deepEqual(bridge.networks.codex_api_control.aliases, ['codex-control-bridge-api-control']);
  assert.deepEqual(bridge.networks.codex_runtime_control, {}, 'bridge remains on runtime-control only for outbound worker calls');
  assert.deepEqual(Object.keys(api.networks).sort(), ['codex_api_control', 'default']);
  for (const forbiddenNetwork of ['codex_runtime_control', 'codex_mcp_internal', 'codex_provider_internal']) {
    assert.equal(api.networks[forbiddenNetwork], undefined, `API must not join ${forbiddenNetwork}`);
  }
  assert.deepEqual(worker.networks.codex_runtime_control.aliases, ['codex-agent-runtime-worker-runtime-control']);
  assert.equal(bridge.environment.CODEX_CONTROL_BRIDGE_PORT, 4220);
  assert.equal(bridge.environment.CODEX_RUNTIME_WORKER_URL, CONTROL_BRIDGE_WORKER_URL);
  assert.equal(api.environment.CODEX_CONTROL_BRIDGE_URL, 'http://codex-control-bridge-api-control:4220');
  assert.ok(bridge.volumes.includes('codex_runtime_control_token:/run/codex-runtime-control:ro'));
  assert.ok(bridge.volumes.includes('codex_api_bridge_token:/run/codex-api-bridge:ro'));
  assert.ok(api.volumes.includes('codex_api_bridge_token:/run/codex-api-bridge:ro'));

  const healthcheckCommand = bridge.healthcheck.test.at(-1);
  assert.match(healthcheckCommand, /http:\/\/codex-control-bridge-api-control:4220\/healthz/);
  assert.match(healthcheckCommand, /r\.status!==200\|\|p\.ok!==true/);
  assert.doesNotMatch(composeText, /CODEX_CONTROL_BRIDGE_BIND_INTERFACE|codex-control-bridge:4190|codex-agent-runtime-worker:4219/);
  const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'docker/codex-control-bridge.Dockerfile'), 'utf8');
  assert.match(dockerfile, /CODEX_CONTROL_BRIDGE_PORT=4220/);
  assert.match(dockerfile, /EXPOSE 4220/);
  assert.doesNotMatch(dockerfile, /BIND_INTERFACE|eth0|codex-agent-runtime-worker:4219/);

  const previousBridgeUrl = process.env.CODEX_CONTROL_BRIDGE_URL;
  delete process.env.CODEX_CONTROL_BRIDGE_URL;
  let apiClientUrl = null;
  try {
    await callBridge('/v1/runtime/health', 'GET', {}, {
      token: 't'.repeat(48),
      fetcher: async (url) => {
        apiClientUrl = String(url);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    });
  } finally {
    if (previousBridgeUrl === undefined) delete process.env.CODEX_CONTROL_BRIDGE_URL;
    else process.env.CODEX_CONTROL_BRIDGE_URL = previousBridgeUrl;
  }
  assert.equal(apiClientUrl, 'http://codex-control-bridge-api-control:4220/v1/runtime/health');

  const fetchProbe = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve, reject) => {
    fetchProbe.once('error', reject);
    fetchProbe.listen(4220, '127.0.0.1', resolve);
  });
  try {
    const response = await fetch('http://127.0.0.1:4220/healthz');
    assert.equal(response.status, 200, 'Node Fetch must accept and reach the selected internal bridge port');
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await new Promise((resolve, reject) => fetchProbe.close((error) => (error ? reject(error) : resolve())));
  }
}

const certifiedRuntime = {
  installation: { installation_id: 'pilot-installation' },
  health: {
    ok: true,
    ...matchingWorkerIdentity,
    observedPlatformPackageVersion: `${CODEX_VERSION}-linux-x64`,
    expectedPlatformPackageVersion: `${CODEX_VERSION}-linux-x64`,
    observedPackageLockSha256: 'E'.repeat(64),
    expectedPackageLockSha256: 'C'.repeat(64),
    protocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
    protocolSchemaV2Digest: EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST,
    configurationDigest: 'CONFIG',
    networkPolicyDigest: 'NETWORK',
    mcpReachability: 'CURRENT',
    containment: {
      nonRoot: true,
      noNewPrivileges: true,
      allLinuxCapabilitiesDropped: true,
      readOnlyRootFilesystem: true,
      managedHomeVolumeOnly: true,
      liveCheckoutMount: false,
      arbitraryHostPathMount: false,
      dockerSocket: false,
      gitAvailable: false,
      browserState: false,
      prohibitedCredentials: true,
    },
    providerReachability: 'UNKNOWN',
  },
  certification: {
    packageVersion: CODEX_VERSION,
    wrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
    packageIntegrity: CODEX_LINUX_X64_INTEGRITY,
    packageLockSha256: 'C'.repeat(64),
    installedArtifactSha256: EXPECTED_INSTALLED_ARTIFACT_SHA256,
    protocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
    protocolSchemaV2Digest: EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST,
    configurationDigest: 'CONFIG',
    networkPolicyDigest: 'NETWORK',
  },
};
assert.deepEqual(assessRuntimeIdentity(certifiedRuntime.health, certifiedRuntime.certification).mismatchFields, []);
assert.deepEqual(assessRuntimeIdentity(certifiedRuntime.health, certifiedRuntime.certification).observed, {
  codexVersion: CODEX_VERSION,
  packageIntegrity: CODEX_LINUX_X64_INTEGRITY,
  wrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
  platformPackageVersion: `${CODEX_VERSION}-linux-x64`,
  packageLockSha256: 'E'.repeat(64),
  protocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
  protocolSchemaV2Digest: EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST,
  configurationDigest: 'CONFIG',
  networkPolicyDigest: 'NETWORK',
  installedArtifactSha256: EXPECTED_INSTALLED_ARTIFACT_SHA256,
});
assert.equal(assessRuntimeIdentity({
  ...certifiedRuntime.health,
  observedPackageIntegrity: CODEX_LINUX_X64_INTEGRITY.replace('a4FI3', 'b4FI3'),
}, certifiedRuntime.certification).readinessCode, 'CODEX_PACKAGE_INTEGRITY_MISMATCH');
assert.equal(assessRuntimeIdentity({
  ...certifiedRuntime.health,
  observedWrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY.replace('FV/x1', 'GV/x1'),
}, certifiedRuntime.certification).readinessCode, 'CODEX_WRAPPER_PACKAGE_INTEGRITY_MISMATCH');
assert.equal(assessRuntimeIdentity({
  ...certifiedRuntime.health,
  observedCodexVersion: '0.155.0-alpha.9.2',
}, certifiedRuntime.certification).readinessCode, 'CODEX_VERSION_MISMATCH');
assert.equal(assessRuntimeIdentity({
  ...certifiedRuntime.health,
  observedProtocolSchemaDigest: null,
}, certifiedRuntime.certification).readinessCode, 'CODEX_PROTOCOL_SCHEMA_DIGEST_MISSING');
assert.equal(assessRuntimeIdentity(certifiedRuntime.health, {
  ...certifiedRuntime.certification,
  protocolSchemaDigest: null,
}).readinessCode, 'CODEX_PROTOCOL_SCHEMA_DIGEST_EXPECTED_MISSING');
assert.equal(assessRuntimeIdentity({
  ...certifiedRuntime.health,
  observedProtocolSchemaDigest: 'F'.repeat(64),
}, certifiedRuntime.certification).readinessCode, 'CODEX_PROTOCOL_SCHEMA_DIGEST_MISMATCH');
assert.equal(assessRuntimeIdentity({
  ...certifiedRuntime.health,
  observedPackageIntegrity: null,
}, certifiedRuntime.certification).readinessCode, 'CODEX_OBSERVED_PACKAGE_INTEGRITY_UNAVAILABLE');
assert.equal(assessRuntimeIdentity({
  ...certifiedRuntime.health,
  observedInstalledArtifactSha256: 'F'.repeat(64),
}, certifiedRuntime.certification).readinessCode, 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED');
const apiWorkerIdentityMismatch = assessRuntimeIdentity({
  ...certifiedRuntime.health,
  expectedCodexVersion: '0.155.0-alpha.9.2',
}, certifiedRuntime.certification);
assert.equal(apiWorkerIdentityMismatch.readinessCode, 'CODEX_API_WORKER_IDENTITY_MISMATCH');
assert.ok(apiWorkerIdentityMismatch.mismatchFields.includes('workerExpectedIdentity'));
assert.equal(enrollmentRuntimeReadiness(certifiedRuntime).ready, true);
assert.equal(enrollmentRuntimeReadiness({ ...certifiedRuntime, health: { ...certifiedRuntime.health, ok: false } }).ready, false);
assert.equal(enrollmentRuntimeReadiness({ ...certifiedRuntime, health: { ...certifiedRuntime.health, mcpReachability: 'UNREACHABLE' } }).readiness, 'MCP_UNREACHABLE');
assert.equal(enrollmentRuntimeReadiness({ ...certifiedRuntime, health: { ...certifiedRuntime.health, configurationDigest: 'DRIFTED' } }).readiness, 'CONFIG_DRIFT');

async function testManagedCodexRpcDiagnostics() {
  // Pinned 0.154.0 wire envelopes consumed by the worker: JSON-RPC
  // response {id,error:{code,message,data?}} and account notification method/params.
  const pinnedCodexLock = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'docker/codex-agent-runtime/package-lock.json'),
    'utf8',
  ));
  assert.equal(pinnedCodexLock.packages['node_modules/@openai/codex'].version, CODEX_VERSION);
  async function captureRpcError(method, error) {
    const client = new CodexAppServerClient();
    client.initialized = true;
    client.process = {
      exitCode: null,
      stdin: {
        write(wire) {
          const request = JSON.parse(wire);
          assert.equal(request.method, method);
          setImmediate(() => client.handleProtocolMessage({
            jsonrpc: '2.0',
            id: request.id,
            error,
          }));
        },
      },
    };
    let capturedError;
    const request = method === 'account/read'
      ? client.readAccount()
      : client.startDeviceCodeLogin('a446d25f-3519-4ee6-983a-224b314292e0');
    await assert.rejects(request, (candidate) => {
      capturedError = candidate;
      return candidate.code === 'CODEX_RPC_ERROR';
    });
    return { client, error: capturedError, diagnostic: capturedError.details.rpcDiagnostic };
  }

  function expectedDiagnosticDigest(value) {
    const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex').toUpperCase();
  }

  const pinnedJsonRpcError = {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: -32603,
      message: 'provider response must not escape: Bearer private-access-token',
      data: {
        type: 'internal_error',
        reason: 'workspace_routing_unavailable',
        accessToken: 'private-access-token',
        refreshToken: 'private-refresh-token',
        userCode: 'PRIVATE-CODE',
        verificationUrl: 'https://auth.openai.com/codex/device?private=value',
        providerPayload: { authorization: 'Bearer private-access-token' },
      },
    },
  };
  const rpcClient = new CodexAppServerClient();
  rpcClient.initialized = true;
  rpcClient.process = {
    exitCode: null,
    stdin: {
      write(wire) {
        const request = JSON.parse(wire);
        assert.equal(request.method, 'account/read', 'the failing flow must identify account/read explicitly');
        setImmediate(() => rpcClient.handleProtocolMessage({ ...pinnedJsonRpcError, id: request.id }));
      },
    },
  };
  let rpcError;
  await assert.rejects(rpcClient.readAccount(), (error) => {
    rpcError = error;
    return error.code === 'CODEX_RPC_ERROR';
  });
  assert.equal(rpcError.details.rpcDiagnostic.method, 'account/read');
  assert.equal(rpcError.details.rpcDiagnostic.requestId, 1);
  assert.equal(rpcError.details.rpcDiagnostic.rpcCode, -32603);
  assert.equal(rpcError.details.rpcDiagnostic.type, 'INTERNAL_ERROR');
  assert.equal(rpcError.details.rpcDiagnostic.reason, 'WORKSPACE_ROUTING_UNAVAILABLE');
  assert.equal(rpcError.details.rpcDiagnostic.accountReadClassification, 'ACCOUNT_READ_INTERNAL_ERROR',
    'an unrecognized account/read message collapses to the generic safe classification');
  assert.equal(rpcError.details.rpcDiagnostic.stage, 'ACCOUNT_READ');
  assert.equal(rpcError.details.rpcDiagnostic.outcome, 'JSON_RPC_ERROR');
  assert.ok(Date.parse(rpcError.details.rpcDiagnostic.observedAt));
  const workerDiagnostic = rpcError.details.rpcDiagnostic;
  assert.equal(workerDiagnostic.messagePresent, true);
  assert.equal(workerDiagnostic.dataKind, 'OBJECT');
  assert.equal(workerDiagnostic.messageDigest, expectedDiagnosticDigest(pinnedJsonRpcError.error.message));
  assert.deepEqual(workerDiagnostic.messageSignals, {
    workspace: false,
    routing: false,
    discovery: false,
    duplicate: false,
    timeout: false,
    unauthorized: false,
    unavailable: false,
    account: false,
    auth: false,
  });
  assert.equal(workerDiagnostic.dataDigest, null);
  assert.equal(workerDiagnostic.dataSignals, null,
    'object error.data is classified but its contents are not fingerprinted or traversed');
  assert.deepEqual(safeWorkerRpcDiagnostic(workerDiagnostic), workerDiagnostic);
  assert.deepEqual(safeBridgeRpcDiagnostic(workerDiagnostic), workerDiagnostic);
  assert.deepEqual(safeApiRpcDiagnostic(workerDiagnostic), workerDiagnostic);
  const errorJson = JSON.stringify(rpcError.details);
  for (const secret of ['private-access-token', 'private-refresh-token', 'PRIVATE-CODE', 'verificationUrl', 'providerPayload', 'Bearer']) {
    assert.equal(errorJson.includes(secret), false, `RPC diagnostics must not include ${secret}`);
  }

  const normalizedOne = '  Workspace routing\r\n discovery   timed out  ';
  const normalizedTwo = 'Workspace routing discovery timed out';
  const normalizedDifferent = 'Workspace routing discovery is timed out';
  const normalizedOneDiagnostic = (await captureRpcError('account/read', { code: -32603, message: normalizedOne })).diagnostic;
  const normalizedTwoDiagnostic = (await captureRpcError('account/read', { code: -32603, message: normalizedTwo })).diagnostic;
  const normalizedDifferentDiagnostic = (await captureRpcError('account/read', { code: -32603, message: normalizedDifferent })).diagnostic;
  assert.equal(normalizedOneDiagnostic.messageDigest, expectedDiagnosticDigest(normalizedTwo));
  assert.equal(normalizedOneDiagnostic.messageDigest, normalizedTwoDiagnostic.messageDigest,
    'messages with identical deterministic normalization produce the same digest');
  assert.notEqual(normalizedOneDiagnostic.messageDigest, normalizedDifferentDiagnostic.messageDigest,
    'different normalized messages produce different digests');
  assert.equal(normalizedOneDiagnostic.messageSignals.timeout, true,
    'the bounded timeout signal recognizes the pinned “timed out” wording');
  const upperCaseSignalDiagnostic = (await captureRpcError('account/read', {
    code: -32603,
    message: 'WORKSPACE ROUTING DISCOVERY DUPLICATE TIMEOUT UNAUTHORIZED UNAVAILABLE ACCOUNT AUTH',
  })).diagnostic;
  const lowerCaseSignalDiagnostic = (await captureRpcError('account/read', {
    code: -32603,
    message: 'workspace routing discovery duplicate timeout unauthorized unavailable account auth',
  })).diagnostic;
  assert.deepEqual(upperCaseSignalDiagnostic.messageSignals, lowerCaseSignalDiagnostic.messageSignals,
    'lexical signals are case-insensitive');
  assert.deepEqual(upperCaseSignalDiagnostic.messageSignals, {
    workspace: true,
    routing: true,
    discovery: true,
    duplicate: true,
    timeout: true,
    unauthorized: true,
    unavailable: true,
    account: true,
    auth: true,
  });

  const secretDataString = 'Workspace routing discovery unauthorized; Bearer data-secret-token; device code DATA-CODE; https://example.test/path?secret=value';
  const stringDataError = await captureRpcError('account/read', {
    code: -32603,
    message: 'An unclassified internal failure',
    data: secretDataString,
  });
  assert.equal(stringDataError.diagnostic.accountReadClassification, 'ACCOUNT_READ_INTERNAL_ERROR',
    'error.data lexical evidence does not affect the existing message-only classification');
  assert.equal(stringDataError.diagnostic.dataKind, 'STRING');
  assert.equal(stringDataError.diagnostic.dataDigest, expectedDiagnosticDigest(secretDataString));
  assert.deepEqual(stringDataError.diagnostic.dataSignals, {
    workspace: true,
    routing: true,
    discovery: true,
    duplicate: false,
    timeout: false,
    unauthorized: true,
    unavailable: false,
    account: false,
    auth: false,
  });
  assert.deepEqual(safeBridgeRpcDiagnostic(stringDataError.diagnostic), stringDataError.diagnostic);
  assert.deepEqual(safeApiRpcDiagnostic(stringDataError.diagnostic), stringDataError.diagnostic);
  for (const serialized of [
    JSON.stringify(stringDataError.error),
    JSON.stringify(stringDataError.error.details),
    JSON.stringify(safeBridgeRpcDiagnostic(stringDataError.diagnostic)),
    JSON.stringify(safeApiRpcDiagnostic(stringDataError.diagnostic)),
  ]) {
    for (const secret of ['data-secret-token', 'DATA-CODE', 'secret=value', 'Bearer', 'Workspace routing discovery unauthorized']) {
      assert.equal(serialized.includes(secret), false, `string error.data diagnostics must not include ${secret}`);
    }
  }

  const objectData = { type: 'internal_error', reason: 'routing_unavailable' };
  Object.defineProperty(objectData, 'nested', { enumerable: true, get() { throw new Error('nested error.data must not be inspected'); } });
  objectData.self = objectData;
  objectData.toJSON = () => { throw new Error('object error.data must not be serialized'); };
  const objectDataDiagnostic = (await captureRpcError('account/read', {
    code: -32603,
    message: 'opaque error',
    data: objectData,
  })).diagnostic;
  assert.equal(objectDataDiagnostic.dataKind, 'OBJECT');
  assert.equal(objectDataDiagnostic.dataDigest, null);
  assert.equal(objectDataDiagnostic.dataSignals, null);
  assert.equal(JSON.stringify(objectDataDiagnostic).includes('nested'), false);

  const arrayData = [];
  Object.defineProperty(arrayData, 'nested', { enumerable: true, get() { throw new Error('array error.data must not be inspected'); } });
  arrayData.push({ token: 'must-not-traverse' });
  arrayData.toJSON = () => { throw new Error('array error.data must not be serialized'); };
  const arrayDataDiagnostic = (await captureRpcError('account/read', {
    code: -32603,
    message: 'opaque error',
    data: arrayData,
  })).diagnostic;
  assert.equal(arrayDataDiagnostic.dataKind, 'ARRAY');
  assert.equal(arrayDataDiagnostic.dataDigest, null);
  assert.equal(arrayDataDiagnostic.dataSignals, null);
  assert.equal(JSON.stringify(arrayDataDiagnostic).includes('must-not-traverse'), false);
  assert.equal((await captureRpcError('account/read', { code: -32603, message: 'no data', data: null })).diagnostic.dataKind, 'NULL');
  assert.equal((await captureRpcError('account/read', { code: -32603, message: 'other data', data: 17 })).diagnostic.dataKind, 'OTHER');
  const absentMessageDiagnostic = (await captureRpcError('account/read', { code: -32603 })).diagnostic;
  assert.equal(absentMessageDiagnostic.messagePresent, false);
  assert.equal(absentMessageDiagnostic.messageDigest, null);
  assert.ok(Object.values(absentMessageDiagnostic.messageSignals).every((signal) => signal === false));

  const nonAccountReadError = await captureRpcError('account/login/start', {
    code: -32603,
    message: 'login response includes private-token and https://example.test/?token=value',
    data: 'workspace routing',
  });
  assert.equal(nonAccountReadError.diagnostic.method, 'account/login/start');
  assert.equal(nonAccountReadError.diagnostic.accountReadClassification, undefined);
  assert.equal(nonAccountReadError.client.loginState, null,
    'diagnostic collection does not create or mutate an enrollment login state');
  for (const field of ['messagePresent', 'dataKind', 'messageDigest', 'messageSignals', 'dataDigest', 'dataSignals']) {
    assert.equal(Object.hasOwn(nonAccountReadError.diagnostic, field), false,
      `non-account/read diagnostics remain unchanged (${field})`);
  }

  const workspaceRoutingCases = [
    ['duplicate workspace in routing discovery', 'WORKSPACE_ROUTING_DUPLICATE'],
    ['workspace routing discovery timed out', 'WORKSPACE_ROUTING_TIMEOUT'],
    ['workspace routing discovery unauthorized', 'WORKSPACE_ROUTING_UNAUTHORIZED'],
    ['Workspace ROUTING discovery failed with an unclassified internal condition', 'WORKSPACE_ROUTING_DISCOVERY_ERROR'],
    ['Unrelated account operation failed internally', 'ACCOUNT_READ_INTERNAL_ERROR'],
    ['Workspace routing is unavailable', 'WORKSPACE_ROUTING_UNAVAILABLE'],
  ];
  let classifiedDiagnostic = null;
  for (const [message, expectedClassification] of workspaceRoutingCases) {
    const classifiedClient = new CodexAppServerClient();
    classifiedClient.initialized = true;
    classifiedClient.process = {
      exitCode: null,
      stdin: {
        write(wire) {
          const request = JSON.parse(wire);
          assert.equal(request.method, 'account/read');
          setImmediate(() => classifiedClient.handleProtocolMessage({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32603, message },
          }));
        },
      },
    };
    let classifiedError;
    await assert.rejects(classifiedClient.readAccount(), (error) => {
      classifiedError = error;
      return error.code === 'CODEX_RPC_ERROR';
    });
    classifiedDiagnostic = classifiedError.details.rpcDiagnostic;
    assert.equal(classifiedDiagnostic.accountReadClassification, expectedClassification, message);
    assert.equal(JSON.stringify(classifiedError.details).includes(message), false,
      'the raw JSON-RPC error message must not survive worker sanitization');
    assert.deepEqual(safeBridgeRpcDiagnostic(classifiedDiagnostic), classifiedDiagnostic);
    assert.deepEqual(safeApiRpcDiagnostic(classifiedDiagnostic), classifiedDiagnostic);
  }

  const secretBearingRecognizedMessage = 'Workspace routing discovery failed; Bearer secret-token; device code PRIVATE-CODE; https://auth.openai.com/codex/device?secret=value';
  const secretMessageClient = new CodexAppServerClient();
  secretMessageClient.initialized = true;
  secretMessageClient.process = {
    exitCode: null,
    stdin: {
      write(wire) {
        const request = JSON.parse(wire);
        setImmediate(() => secretMessageClient.handleProtocolMessage({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32603, message: secretBearingRecognizedMessage },
        }));
      },
    },
  };
  let secretMessageError;
  await assert.rejects(secretMessageClient.readAccount(), (error) => {
    secretMessageError = error;
    return error.code === 'CODEX_RPC_ERROR';
  });
  assert.equal(secretMessageError.details.rpcDiagnostic.accountReadClassification, 'WORKSPACE_ROUTING_DISCOVERY_ERROR');
  assert.equal(secretMessageClient.loginStateDiagnostic().latestRpc.accountReadClassification, 'WORKSPACE_ROUTING_DISCOVERY_ERROR');
  for (const serialized of [
    JSON.stringify(secretMessageError),
    JSON.stringify(secretMessageError.details),
    JSON.stringify(secretMessageClient.loginStateDiagnostic()),
  ]) {
    for (const secret of ['Workspace routing is unavailable', 'secret-token', 'PRIVATE-CODE', 'secret=value', 'Bearer']) {
      assert.equal(serialized.includes(secret), false, `sanitized diagnostics must not include ${secret}`);
    }
  }
  assert.equal(safeWorkerRpcDiagnostic({
    ...workerDiagnostic,
    accountReadClassification: 'WORKSPACE_ROUTING_UNAVAILABLE_BEARER_SECRET',
  }).accountReadClassification, 'ACCOUNT_READ_INTERNAL_ERROR',
  'unrecognized classification input collapses to the generic safe classification');
  assert.equal(safeWorkerRpcDiagnostic({
    ...workerDiagnostic,
    method: 'account/login/start',
    stage: 'DEVICE_CODE_LOGIN_START',
    accountReadClassification: 'WORKSPACE_ROUTING_UNAVAILABLE',
  }).accountReadClassification, undefined,
  'account/read classification is not applied to other methods');

  assert.equal(safeWorkerRpcDiagnostic({
    ...workerDiagnostic,
    reason: 'private_access_token_value',
  }).reason, null, 'code-like fields containing credential markers are suppressed');
  assert.equal(safeWorkerRpcDiagnostic({
    ...workerDiagnostic,
    method: 'turn/start',
  }), null, 'methods outside the bootstrap allowlist cannot enter diagnostics');
  assert.equal(safeWorkerRpcDiagnostic({
    ...workerDiagnostic,
    requestId: '1',
  }), null, 'non-numeric/untrusted request identifiers are suppressed');

  const successfulClient = new CodexAppServerClient();
  successfulClient.initialized = true;
  successfulClient.process = {
    exitCode: null,
    stdin: {
      write(wire) {
        const request = JSON.parse(wire);
        setImmediate(() => successfulClient.handleProtocolMessage({
          jsonrpc: '2.0',
          id: request.id,
          result: { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: false },
        }));
      },
    },
  };
  assert.deepEqual(await successfulClient.readAccount(), {
    accountType: 'chatgpt',
    authMode: 'chatgpt',
    planType: 'plus',
    requiresOpenaiAuth: false,
    authenticated: true,
  }, 'successful account/read mapping remains unchanged');
  assert.equal(successfulClient.loginStateDiagnostic().latestRpc.method, 'account/read');
  assert.equal(successfulClient.loginStateDiagnostic().latestRpc.outcome, 'SUCCEEDED');
  assert.equal(successfulClient.loginStateDiagnostic().latestRpc.accountReadClassification, undefined,
    'successful account/read results do not carry an error classification');
  for (const field of ['messagePresent', 'dataKind', 'messageDigest', 'messageSignals', 'dataDigest', 'dataSignals']) {
    assert.equal(Object.hasOwn(successfulClient.loginStateDiagnostic().latestRpc, field), false,
      `successful account/read behavior remains unchanged (${field})`);
  }

  const timeoutClient = new CodexAppServerClient();
  timeoutClient.initialized = true;
  timeoutClient.process = { exitCode: null, stdin: { write() {} } };
  await assert.rejects(timeoutClient.readAccount({ timeoutMs: 5 }), (error) => {
    assert.equal(error.code, 'CODEX_RPC_TIMEOUT');
    assert.equal(error.details.rpcDiagnostic.outcome, 'TIMEOUT');
    assert.equal(error.details.rpcDiagnostic.rpcCode, null);
    assert.equal(error.details.rpcDiagnostic.failureCode, 'CODEX_RPC_TIMEOUT');
    return true;
  });
  const timeoutDiagnostic = timeoutClient.loginStateDiagnostic().latestRpc;
  assert.equal(timeoutDiagnostic.accountReadClassification, undefined,
    'timeouts remain distinct from JSON-RPC account/read classifications');
  for (const field of ['messagePresent', 'dataKind', 'messageDigest', 'messageSignals', 'dataDigest', 'dataSignals']) {
    assert.equal(Object.hasOwn(timeoutDiagnostic, field), false,
      `timeouts do not receive JSON-RPC message evidence (${field})`);
  }
  assert.deepEqual(safeWorkerErrorPayload({
    ok: false,
    code: 'CODEX_RPC_TIMEOUT',
    message: 'must-not-be-forwarded',
    details: { rpcDiagnostic: timeoutDiagnostic, rawProviderResponse: 'private' },
  }), { ok: false, code: 'CODEX_RPC_TIMEOUT', details: { rpcDiagnostic: timeoutDiagnostic } });
  await assert.rejects(callBridge('/v1/enrollment/reconcile', 'POST', { operationId: 'a446d25f-3519-4ee6-983a-224b314292e0' }, {
    token: 't'.repeat(48),
    fetcher: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, code: 'CODEX_RPC_TIMEOUT', details: { rpcDiagnostic: timeoutDiagnostic } }),
    }),
  }), (error) => {
    assert.equal(error.code, 'CODEX_RPC_TIMEOUT');
    assert.equal(error.details.rpcDiagnostic.outcome, 'TIMEOUT');
    assert.equal(error.details.rpcDiagnostic.rpcCode, null);
    return true;
  });

  const enrollmentId = 'a446d25f-3519-4ee6-983a-224b314292e0';
  const notificationClient = new CodexAppServerClient();
  notificationClient.generation = 'phase19-3a0-generation-0123456789abcdef';
  notificationClient.loginState = {
    operationId: enrollmentId,
    loginId: 'private-login-reference',
    verificationUrl: 'https://auth.openai.com/codex/device?private=value',
    userCode: 'PRIVATE-USER-CODE',
    state: 'PENDING_USER',
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  notificationClient.latestRpcDiagnostic = classifiedDiagnostic;
  notificationClient.handleProtocolMessage({
    method: 'account/updated',
    params: { authMode: 'chatgpt', planType: 'plus' },
  });
  assert.equal(notificationClient.loginStateDiagnostic().state, 'PENDING_USER',
    'account/updated alone must not complete or authorize a login');
  notificationClient.handleProtocolMessage({
    method: 'account/login/completed',
    params: {
      loginId: 'private-login-reference',
      success: true,
      error: 'provider response with private-access-token',
    },
  });
  const loginProjection = notificationClient.loginStateDiagnostic();
  assert.equal(loginProjection.enrollmentOperationId, enrollmentId);
  assert.equal(loginProjection.appServerGeneration, notificationClient.generation);
  assert.equal(loginProjection.state, 'COMPLETED');
  assert.equal(loginProjection.latestNotificationType, 'account/login/completed');
  assert.equal(loginProjection.latestRpc.method, 'account/read');
  assert.equal(loginProjection.latestRpc.accountReadClassification, 'WORKSPACE_ROUTING_UNAVAILABLE',
    'the safe login-state projection preserves the account/read classification');
  assert.ok(Date.parse(loginProjection.timestamps.loginStartedAt));
  assert.ok(Date.parse(loginProjection.timestamps.loginCompletedAt));
  assert.equal(Object.hasOwn(loginProjection, 'authenticated'), false,
    'a completion notification is not an account authorization assertion');
  const loginProjectionJson = JSON.stringify(loginProjection);
  for (const secret of ['private-login-reference', 'PRIVATE-USER-CODE', 'private=value', 'private-access-token', 'verificationUrl', 'userCode']) {
    assert.equal(loginProjectionJson.includes(secret), false, `login-state projection must not include ${secret}`);
  }

  const unsafeRpc = {
    ...workerDiagnostic,
    rawMessage: 'must-not-survive',
    headers: { authorization: 'Bearer private-access-token' },
    type: 'eyJhbGciOi-secret',
  };
  const bridgeSafeError = safeWorkerErrorPayload({
    ok: false,
    code: 'CODEX_RPC_ERROR',
    message: 'Bearer private-access-token',
    details: { rpcDiagnostic: unsafeRpc, providerResponse: { userCode: 'PRIVATE-CODE' } },
  });
  assert.deepEqual(bridgeSafeError, {
    ok: false,
    code: 'CODEX_RPC_ERROR',
    details: { rpcDiagnostic: { ...workerDiagnostic, type: null } },
  });
  assert.equal(JSON.stringify(bridgeSafeError).includes('private-access-token'), false);

  const runtimeToken = 'r'.repeat(48);
  const bridgeToken = 'b'.repeat(48);
  const worker = createWorkerControlServer({
    token: runtimeToken,
    client: {
      reconcileLogin: async () => {
        throw new CodexAppServerError('CODEX_RPC_ERROR', 'never-forward-this-message', {
          rpcDiagnostic: { ...classifiedDiagnostic, headers: { authorization: 'Bearer private-access-token' } },
          rawError: 'private provider data',
        });
      },
    },
  });
  await new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.listen(0, '127.0.0.1', resolve);
  });
  const workerUrl = `http://127.0.0.1:${worker.address().port}`;
  const bridge = createControlBridgeServer({
    token: bridgeToken,
    fetcher: async (method, routePath, body) => {
      const response = await fetch(`${workerUrl}${routePath}`, {
        method,
        headers: { authorization: `Bearer ${runtimeToken}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, payload: await response.json() };
    },
  });
  await new Promise((resolve, reject) => {
    bridge.once('error', reject);
    bridge.listen(0, '127.0.0.1', resolve);
  });
  try {
    const bridgeBase = `http://127.0.0.1:${bridge.address().port}`;
    const workerResponse = await fetch(`${workerUrl}/enrollment/reconcile`, {
      method: 'POST',
      headers: { authorization: `Bearer ${runtimeToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: enrollmentId }),
    });
    const workerPayload = await workerResponse.json();
    assert.equal(workerPayload.code, 'CODEX_RPC_ERROR');
    assert.deepEqual(workerPayload.details.rpcDiagnostic, classifiedDiagnostic);
    assert.equal(Object.hasOwn(workerPayload, 'message'), false, 'worker errors must not relay raw message text');

    await assert.rejects(callBridge('/v1/enrollment/reconcile', 'POST', { operationId: enrollmentId }, {
      baseUrl: bridgeBase,
      token: bridgeToken,
      fetcher: fetch,
      timeoutMs: 5000,
    }), (error) => {
      assert.equal(error.code, 'CODEX_RPC_ERROR');
      assert.deepEqual(error.details.rpcDiagnostic, classifiedDiagnostic);
      assert.equal(JSON.stringify(error.details).includes('private-access-token'), false);
      assert.equal(JSON.stringify(error.details).includes('never-forward-this-message'), false);
      return true;
    }, 'the API should receive bounded diagnostics through the bridge without raw provider text');
  } finally {
    await Promise.all([
      new Promise((resolve, reject) => bridge.close((error) => (error ? reject(error) : resolve()))),
      new Promise((resolve, reject) => worker.close((error) => (error ? reject(error) : resolve()))),
    ]);
  }

  const projected = safeApiLoginStateDiagnostic({
    ...loginProjection,
    loginReference: 'private-login-reference',
    userCode: 'PRIVATE-USER-CODE',
    verificationUrl: 'https://auth.openai.com/codex/device?private=value',
    accessToken: 'private-access-token',
  });
  assert.deepEqual(projected, loginProjection);
  assert.deepEqual(safeBridgeLoginStateDiagnostic({ ...loginProjection, userCode: 'PRIVATE-USER-CODE' }), loginProjection);

  const healthBridgeToken = 'h'.repeat(48);
  const healthBridge = createControlBridgeServer({
    token: healthBridgeToken,
    fetcher: async () => ({
      status: 200,
      payload: { ok: true, loginStateDiagnostic: {
        ...loginProjection,
        loginReference: 'private-login-reference',
        userCode: 'PRIVATE-USER-CODE',
        verificationUrl: 'https://auth.openai.com/codex/device?private=value',
        latestRpc: { ...classifiedDiagnostic, providerPayload: 'private' },
      } },
    }),
  });
  await new Promise((resolve, reject) => {
    healthBridge.once('error', reject);
    healthBridge.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${healthBridge.address().port}/v1/runtime/health`, {
      headers: { authorization: `Bearer ${healthBridgeToken}` },
    });
    const payload = await response.json();
    assert.deepEqual(safeApiLoginStateDiagnostic(payload.health.loginStateDiagnostic), loginProjection,
      'bridge and API retain only the safe login-state projection');
    assert.equal(JSON.stringify(payload.health.loginStateDiagnostic).includes('PRIVATE-USER-CODE'), false);
  } finally {
    await new Promise((resolve, reject) => healthBridge.close((error) => (error ? reject(error) : resolve())));
  }

  const safeStatus = safeManagedStatus({
    installation: { installation_id: 'pilot-installation' },
    account: null,
    activeOperation: null,
    health: { ...certifiedRuntime.health, loginStateDiagnostic: { ...loginProjection, userCode: 'PRIVATE-USER-CODE' } },
    certification: { ...certifiedRuntime.certification, installed: true },
  });
  assert.deepEqual(safeStatus.runtime.loginStateDiagnostic, loginProjection);
  assert.equal(safeStatus.runtime.loginStateDiagnostic.latestRpc.accountReadClassification, 'WORKSPACE_ROUTING_UNAVAILABLE',
    'managed-status exposes only the safe account/read classification');

  let observation;
  await persistRuntimeObservation(
    { installation_id: 'pilot-installation' },
    { ...certifiedRuntime.health, loginStateDiagnostic: {
      ...loginProjection,
      latestRpc: { ...classifiedDiagnostic, rawMessage: secretBearingRecognizedMessage },
    } },
    certifiedRuntime.certification,
    async (sql, values) => { observation = { sql, metadata: JSON.parse(values[11]) }; return { rowCount: 1 }; },
  );
  assert.match(observation.sql, /UPDATE core\.agent_runtime_installations/);
  assert.equal(/UPDATE core\.agent_runtime_(?:accounts|enrollment_operations)/.test(observation.sql), false);
  assert.equal(Object.hasOwn(observation.metadata, 'loginStateDiagnostic'), false,
    'the diagnostic projection remains response-only and is not persisted');
  assert.equal(JSON.stringify(observation.metadata).includes(secretBearingRecognizedMessage), false,
    'raw app-server messages are never persisted in runtime observations');

  const enrollmentRow = {
    enrollment_id: enrollmentId,
    installation_id: 'pilot-installation',
    account_binding_id: 'pilot-account',
    account_code: 'phase19-3a0-managed-account',
    operation_state: 'PENDING_USER',
    auth_mode: 'chatgptDeviceCode',
    provider_attempt_count: 2,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    owner_user_id: 'owner-1',
    account_state: 'UNCONFIGURED',
    account_metadata: {},
  };
  let enrollmentSelectCount = 0;
  const beforeEnrollment = structuredClone(enrollmentRow);
  await assert.rejects(reconcileEnrollment(enrollmentId, { user: { userId: 'owner-1', roleCodes: [] } }, {
    queryExecutor: async (sql) => {
      assert.match(sql, /^\s*SELECT e\.\*/);
      enrollmentSelectCount += 1;
      return { rowCount: 1, rows: [enrollmentRow] };
    },
    bridge: async () => {
      const error = new Error('fixed test transport');
      error.code = 'CODEX_RPC_ERROR';
      error.details = { rpcDiagnostic: workerDiagnostic };
      throw error;
    },
  }), (error) => error.code === 'CODEX_RPC_ERROR');
  assert.equal(enrollmentSelectCount, 1);
  assert.equal(enrollmentRow.operation_state, beforeEnrollment.operation_state);
  assert.equal(enrollmentRow.provider_attempt_count, beforeEnrollment.provider_attempt_count,
    'diagnostic propagation alone must not mutate enrollment state or provider attempt count');

  const diagnosticHealth = await buildHealth({
    identity: () => ({
      runtimeKind: 'CODEX_APP_SERVER_BOOTSTRAP',
      runtimeGeneration: 'phase19-3a0-generation-0123456789abcdef',
      processId: 7,
      processStartedAt: new Date().toISOString(),
      initialized: true,
      identityMismatchFields: [],
      identityAttestation: 'VERIFIED',
      observedProtocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
      expectedProtocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
      protocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
    }),
    loginStateDiagnostic: () => ({ ...loginProjection, userCode: 'PRIVATE-USER-CODE' }),
  }, {
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      json: async () => url.endsWith('/healthz')
        ? { ok: true, policyDigest: 'POLICY', allowedHostCount: 1 }
        : { events: [] },
    }),
    mcpProbe: async () => ({ status: 'CURRENT', reason: null, tools: ['skycommand_browser_automation_run'] }),
  });
  assert.deepEqual(diagnosticHealth.loginStateDiagnostic, loginProjection,
    'worker health exposes only the safe login-state projection');
}

async function testInstalledArtifactAttestation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-codex-identity-'));
  const packageRoot = path.join(root, 'node_modules', '@openai');
  const wrapperPath = path.join(packageRoot, 'codex');
  const linuxPath = path.join(packageRoot, 'codex-linux-x64');
  const linuxVersion = `${CODEX_VERSION}-linux-x64`;
  const sourceLock = {
    lockfileVersion: 3,
    packages: {
      'node_modules/@openai/codex': { version: CODEX_VERSION, integrity: CODEX_WRAPPER_INTEGRITY },
      'node_modules/@openai/codex-linux-x64': { version: linuxVersion, integrity: CODEX_LINUX_X64_INTEGRITY },
    },
  };
  const installedLock = {
    lockfileVersion: 3,
    packages: {
      'node_modules/@openai/codex': { version: CODEX_VERSION, integrity: CODEX_WRAPPER_INTEGRITY },
      'node_modules/@openai/codex-linux-x64': { version: linuxVersion, integrity: CODEX_LINUX_X64_INTEGRITY },
    },
  };
  const writeJson = (filePath, value) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
  };
  try {
    writeJson(path.join(root, 'docker/codex-agent-runtime/package-lock.json'), sourceLock);
    writeJson(path.join(root, 'node_modules/.package-lock.json'), installedLock);
    writeJson(path.join(wrapperPath, 'package.json'), { name: '@openai/codex', version: CODEX_VERSION });
    writeJson(path.join(linuxPath, 'package.json'), { name: '@openai/codex', version: linuxVersion });
    fs.mkdirSync(path.join(wrapperPath, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(linuxPath, 'vendor'), { recursive: true });
    fs.writeFileSync(path.join(wrapperPath, 'bin/codex.js'), 'runtime wrapper bytes');
    const binaryPath = path.join(linuxPath, 'vendor/codex');
    fs.writeFileSync(binaryPath, 'deployed codex runtime bytes');
    const fixtureArtifactSha256 = await installedPackageArtifactSha256(root);
    writeJson(path.join(root, 'docker/codex-agent-runtime/package.json'), {
      name: 'skycommand-codex-agent-runtime',
      dependencies: { '@openai/codex': CODEX_VERSION },
      skycommandRuntimeCertification: {
        schema: 'SKYCOMMAND_CODEX_RUNTIME_CERTIFICATION_V1',
        packageVersion: CODEX_VERSION,
        wrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
        linuxX64PackageIntegrity: CODEX_LINUX_X64_INTEGRITY,
        installedArtifactSha256: fixtureArtifactSha256,
        primaryProtocolSchemaDigest: EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST,
        versionedProtocolSchemaDigests: { v2: EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST },
      },
    });
    const attestation = await writeBuildAttestation(root);
    const options = {
      rootPath: root,
      runVersionCommand: async () => ({ stdout: `codex ${CODEX_VERSION}\n` }),
    };
    const actual = await readPackageIdentity(options);
    assert.equal(actual.observedCodexVersion, CODEX_VERSION);
    assert.equal(actual.expectedCodexVersion, CODEX_VERSION);
    assert.equal(actual.observedPackageIntegrity, CODEX_LINUX_X64_INTEGRITY);
    assert.equal(actual.expectedPackageIntegrity, CODEX_LINUX_X64_INTEGRITY);
    assert.equal(actual.observedWrapperPackageIntegrity, CODEX_WRAPPER_INTEGRITY);
    assert.equal(actual.expectedWrapperPackageIntegrity, CODEX_WRAPPER_INTEGRITY);
    assert.equal(actual.expectedProtocolSchemaDigest, EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST);
    assert.equal(actual.expectedProtocolSchemaV2Digest, EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST);
    assert.equal(actual.observedInstalledArtifactSha256, attestation.installedArtifactSha256);
    assert.equal(actual.expectedInstalledArtifactSha256, attestation.installedArtifactSha256);
    assert.equal(actual.identityAttestation, 'VERIFIED');
    assert.deepEqual(actual.identityMismatchFields, []);

    fs.writeFileSync(binaryPath, 'changed deployed Codex runtime bytes');
    const changed = await readPackageIdentity(options);
    assert.notEqual(changed.observedInstalledArtifactSha256, changed.expectedInstalledArtifactSha256);
    assert.equal(changed.identityAttestation, 'FAILED');
    assert.ok(changed.identityMismatchFields.includes('observedInstalledArtifactSha256'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testIdentityFallbackIsPrevented() {
  const health = {
    ...certifiedRuntime.health,
    observedCodexVersion: null,
    observedPackageIntegrity: null,
    observedWrapperPackageIntegrity: null,
    observedProtocolSchemaDigest: null,
    observedInstalledArtifactSha256: null,
    codexVersion: CODEX_VERSION,
    packageIntegrity: CODEX_LINUX_X64_INTEGRITY,
    protocolSchemaDigest: 'A'.repeat(64),
    installedArtifactSha256: 'D'.repeat(64),
    identityAttestation: 'UNAVAILABLE',
    identityMismatchFields: [],
  };
  const assessment = assessRuntimeIdentity(health, certifiedRuntime.certification);
  assert.equal(assessment.observed.codexVersion, null);
  assert.equal(assessment.observed.packageIntegrity, null);
  assert.equal(assessment.observed.wrapperPackageIntegrity, null);
  assert.equal(assessment.observed.protocolSchemaDigest, null);
  assert.equal(assessment.observed.installedArtifactSha256, null);
  assert.equal(assessment.expected.codexVersion, CODEX_VERSION);
  assert.equal(assessment.expected.packageIntegrity, CODEX_LINUX_X64_INTEGRITY);
  assert.equal(assessment.expected.wrapperPackageIntegrity, CODEX_WRAPPER_INTEGRITY);
  assert.equal(assessment.expected.protocolSchemaDigest, EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST);
  assert.equal(assessment.expected.protocolSchemaV2Digest, EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST);
  assert.equal(assessment.expected.installedArtifactSha256, EXPECTED_INSTALLED_ARTIFACT_SHA256);

  const status = safeManagedStatus({
    installation: { installation_id: 'pilot-installation' },
    account: null,
    activeOperation: null,
    health,
    certification: { ...certifiedRuntime.certification, installed: true },
  });
  assert.equal(status.runtime.version, null);
  assert.equal(status.runtime.packageIntegrity, null);
  assert.equal(status.runtime.wrapperPackageIntegrity, null);
  assert.equal(status.runtime.protocolSchemaDigest, null);
  assert.equal(status.runtime.installedArtifactSha256, null);
  assert.equal(status.runtime.expectedPackageVersion, CODEX_VERSION);
  assert.equal(status.runtime.expectedPackageIntegrity, CODEX_LINUX_X64_INTEGRITY);
  assert.equal(status.runtime.expectedWrapperPackageIntegrity, CODEX_WRAPPER_INTEGRITY);
  assert.equal(status.runtime.expectedProtocolSchemaDigest, EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST);
  assert.equal(status.runtime.expectedProtocolSchemaV2Digest, EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST);
  assert.equal(status.runtime.expectedInstalledArtifactSha256, EXPECTED_INSTALLED_ARTIFACT_SHA256);

  let captured;
  await persistRuntimeObservation(
    { installation_id: 'pilot-installation' },
    health,
    certifiedRuntime.certification,
    async (sql, values) => { captured = { sql, values }; return { rowCount: 1 }; },
  );
  assert.ok(captured.sql.includes('UPDATE core.agent_runtime_installations'));
  const persisted = JSON.parse(captured.values[11]);
  assert.equal(persisted.runtimeIdentity.observed.codexVersion, null);
  assert.equal(persisted.runtimeIdentity.observed.packageIntegrity, null);
  assert.equal(persisted.runtimeIdentity.observed.protocolSchemaDigest, null);
  assert.equal(persisted.runtimeIdentity.observed.installedArtifactSha256, null);
  assert.equal(persisted.runtimeIdentity.expected.codexVersion, CODEX_VERSION);
  assert.equal(persisted.runtimeIdentity.expected.packageIntegrity, CODEX_LINUX_X64_INTEGRITY);
  assert.equal(persisted.runtimeIdentity.expected.protocolSchemaDigest, EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST);
  assert.equal(captured.values[3], null);
}

async function testManagedCodexLogoutFixture() {
  const accountBindingId = 'fixture-managed-codex-account';
  const installationId = 'fixture-managed-codex-installation';
  const ownerUserId = 'fixture-owner';
  const request = {
    user: { userId: ownerUserId, roleCodes: [] },
    session: { appCode: 'SKYSERVER_ADMIN' },
    ip: '127.0.0.1',
    get: () => 'managed-codex-logout-fixture',
  };
  const installation = {
    installation_id: installationId,
    installation_code: 'phase19-3a0-managed-codex',
    certification_state: 'CERTIFIED',
    freshness_status: 'CURRENT',
    enabled: true,
  };
  const account = {
    account_binding_id: accountBindingId,
    installation_id: installationId,
    account_code: 'phase19-3a0-managed-account',
    account_alias: 'Managed Codex Fixture',
    account_state: 'CONFIGURED',
    owner_user_id: ownerUserId,
    metadata: { authMode: 'chatgptDeviceCode', accountType: 'chatgpt', planType: 'plus' },
  };
  const activeOperation = {
    enrollment_id: '123e4567-e89b-42d3-a456-426614174099',
    account_binding_id: accountBindingId,
    operation_state: 'PENDING_USER',
    auth_mode: 'chatgptDeviceCode',
    verification_url: 'https://auth.openai.com/codex/device',
    user_code: 'FIXTURE-CODE',
    created_at: '2026-09-26T00:00:00.000Z',
  };
  let selectCount = 0;
  const queryExecutor = async (sql, values) => {
    if (/FROM core\.agent_runtime_installations i/.test(sql)) {
      selectCount += 1;
      assert.deepEqual(values, ['OPENAI_CODEX_APP_SERVER', 'phase19-3a0-managed-codex']);
      return { rowCount: 1, rows: [installation] };
    }
    if (/FROM core\.agent_runtime_accounts/.test(sql)) {
      selectCount += 1;
      assert.deepEqual(values, [installationId, 'phase19-3a0-managed-account']);
      return { rowCount: 1, rows: [account] };
    }
    if (/FROM core\.agent_runtime_enrollment_operations/.test(sql)) {
      selectCount += 1;
      assert.equal(values[0], accountBindingId);
      return { rowCount: 1, rows: [activeOperation] };
    }
    throw new Error(`Unexpected fixture query: ${sql}`);
  };

  const transactionStatements = [];
  let released = false;
  const client = {
    async query(sql, values = []) {
      transactionStatements.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
    release() { released = true; },
  };
  const bridgeCalls = [];
  const auditEvents = [];
  const originalRecordAuditEvent = authService.recordAuditEvent;
  authService.recordAuditEvent = async (event) => { auditEvents.push(event); };
  try {
    const result = await logoutManagedAccount(request, {
      queryExecutor,
      bridge: async (route, method, body) => {
        bridgeCalls.push({ route, method, body });
        return { ok: true };
      },
      poolRef: { connect: async () => client },
    });

    assert.deepEqual(result, { ok: true, accountState: 'REVOKED', executionEnabled: false });
    assert.equal(selectCount, 3, 'logout fixture must resolve the registered installation, account, and active enrollment');
    assert.deepEqual(bridgeCalls, [{ route: '/v1/account/logout', method: 'POST', body: {} }]);
    assert.equal(transactionStatements[0].sql, 'BEGIN');
    assert.match(transactionStatements[1].sql, /SET account_state = 'REVOKED'/);
    assert.match(transactionStatements[1].sql, /executionEnabled', FALSE/);
    assert.deepEqual(transactionStatements[1].values, [accountBindingId, 'OPENAI_CODEX', 'chatgptDeviceCode', ownerUserId]);
    assert.match(transactionStatements[2].sql, /SET operation_state = 'REVOKED'/);
    assert.match(transactionStatements[2].sql, /verification_url = NULL, user_code = NULL/);
    assert.deepEqual(transactionStatements[2].values[0], accountBindingId);
    assert.equal(transactionStatements[3].sql, 'COMMIT');
    assert.equal(released, true, 'logout transaction client must always be released');
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].action, 'revoke_managed_codex_enrollment');
    assert.equal(auditEvents[0].resourceId, accountBindingId);
    assert.equal(auditEvents[0].success, true);
    assert.equal(auditEvents[0].metadata.enrollmentState, 'REVOKED');
    assert.equal(auditEvents[0].metadata.executionEnabled, false);

    const revokedStatus = safeManagedStatus({
      installation,
      account: { ...account, account_state: 'REVOKED', metadata: { authMode: 'chatgptDeviceCode' } },
      activeOperation: null,
      health: { ...certifiedRuntime.health, providerReachability: 'CURRENT' },
      certification: { ...certifiedRuntime.certification, installed: true },
    });
    assert.equal(revokedStatus.account.accountState, 'REVOKED');
    assert.equal(revokedStatus.account.executionEnabled, false);
    assert.equal(revokedStatus.runtime.readiness, 'ACCOUNT_UNENROLLED',
      'revoked managed Codex bindings must fail readiness closed');
    assert.equal(revokedStatus.runtime.executionEnabled, false);
  } finally {
    authService.recordAuditEvent = originalRecordAuditEvent;
  }
}

const now = Date.now();
const diagnostics = [
  { host: 'auth.openai.com', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED', observedAt: new Date(now).toISOString() },
  { host: 'api.openai.com', decision: 'ALLOW', reason: 'PUBLIC_ALLOWLISTED_TLS', observedAt: new Date(now).toISOString() },
  { host: 'old.example.com', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED', observedAt: new Date(now - 60_000).toISOString() },
  { host: 'bad host/path', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED', observedAt: new Date(now).toISOString() },
];
readRecentProviderEgressDenials(now - 100, async (url) => {
  assert.match(url, /\/diagnostics$/);
  return { ok: true, json: async () => ({ events: diagnostics }) };
}).then(async (observed) => {
  await testInstalledArtifactAttestation();
  await testManagedCodexRpcDiagnostics();
  await testManagedCodexLogoutFixture();
  await testIdentityFallbackIsPrevented();
  await testProviderReachabilityRestoreAfterRestart();
  await testRuntimeControlNetworkBinding();
  await testHealthcheckDiagnostics();
  await testControlBridgeHealthFailsClosed();
  await testControlBridgeNetworkBinding();
  assert.deepEqual(observed.map((item) => item.host), ['auth.openai.com']);
  assert.deepEqual(safeProviderDestinations([
    ...observed,
    { host: 'auth.openai.com/path', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED' },
  ]), observed);

  const accepted = validateDeviceResponse({
    verificationUrl: 'https://auth.openai.com/codex/device',
    userCode: 'ABCD-EFGH',
    loginId: 'safe-reference-123',
  });
  assert.equal(accepted.loginReference, 'safe-reference-123');
  assert.throws(() => validateDeviceResponse({
    verificationUrl: 'https://example.com/codex/device', userCode: 'ABCD-EFGH', loginId: 'x',
  }), /unexpected device verification address/i);
  assert.deepEqual(safeProviderDestinations([
    { host: 'auth.openai.com', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED' },
    { host: 'auth.openai.com/path', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED' },
    { host: 'api.openai.com', decision: 'ALLOW', reason: 'PUBLIC_ALLOWLISTED_TLS' },
  ]), [{ host: 'auth.openai.com', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED', observedAt: null }]);

  const capability = getCapabilities({
    agentId: 'codex-local',
    permissionCodes: ['MANAGED_CODEX_READ', 'MANAGED_CODEX_ENROLL', 'MANAGED_CODEX_LIFECYCLE'],
  });
  assert.equal(capability.managedCodexBootstrap.enabled, true);
  assert.equal(capability.managedCodexBootstrap.executionEnabled, false);
  assert.equal(capability.managedCodexBootstrap.permissions.lifecycle, true);

  const originalGetManagedCodex = managedCodexBootstrapService.getManagedCodex;
  const originalStartManagedCodexLifecycle = managedCodexBootstrapService.startManagedCodexLifecycle;
  const managedPermissions = [
    { permissionCode: 'MANAGED_CODEX_READ' },
    { permissionCode: 'MANAGED_CODEX_LIFECYCLE' },
  ];
  let statusRequest;
  let assistantLifecycleRequest;
  managedCodexBootstrapService.getManagedCodex = async (request) => {
    statusRequest = request;
    return { runtime: { readiness: 'RUNTIME_OFFLINE' } };
  };
  managedCodexBootstrapService.startManagedCodexLifecycle = async (operationId, request) => {
    assistantLifecycleRequest = { operationId, request };
    return { ok: true, lifecycle: { operationId } };
  };
  try {
    const status = await assistantIntegrationService.getManagedCodexStatus({
      permissions: managedPermissions,
      agentId: 'codex-local',
    });
    assert.equal(status.runtime.readiness, 'RUNTIME_OFFLINE');
    assert.deepEqual(statusRequest.permissions, managedPermissions);

    const lifecycleRequestId = '123e4567-e89b-12d3-a456-426614174000';
    const lifecycleStart = await assistantIntegrationService.startManagedCodexLifecycle({
      body: { operationId: lifecycleRequestId },
      permissions: managedPermissions,
      agentId: 'codex-local',
    });
    assert.equal(lifecycleStart.lifecycle.operationId, lifecycleRequestId);
    assert.equal(assistantLifecycleRequest.operationId, lifecycleRequestId);
    assert.deepEqual(assistantLifecycleRequest.request.permissions, managedPermissions);
  } finally {
    managedCodexBootstrapService.getManagedCodex = originalGetManagedCodex;
    managedCodexBootstrapService.startManagedCodexLifecycle = originalStartManagedCodexLifecycle;
  }

  const managedCodexServicePath = path.join(repositoryRoot, 'apps/api/src/services/managedCodexBootstrapService.js');
  const fingerprintFilesystem = ({ stat, readTransform, targetPath = managedCodexServicePath, missing = false, rootStat, rootRealPath } = {}) => ({
    lstatSync(filePath) {
      if (path.resolve(filePath) === path.resolve(repositoryRoot) && rootStat) return rootStat;
      if (path.resolve(filePath) === path.resolve(targetPath)) {
        if (missing) throw new Error('test input unavailable');
        if (stat) return stat;
      }
      return fs.lstatSync(filePath);
    },
    realpathSync(filePath) {
      if (path.resolve(filePath) === path.resolve(repositoryRoot) && rootRealPath) return rootRealPath;
      return fs.realpathSync(filePath);
    },
    readFileSync(filePath) {
      const contents = fs.readFileSync(filePath);
      if (path.resolve(filePath) === path.resolve(targetPath) && readTransform) {
        return readTransform(contents);
      }
      return contents;
    },
  });

  const previousFingerprintCandidateRoot = process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
  try {
    process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = repositoryRoot;
    const baselineFingerprint = bootstrapSourceConfigurationFingerprint();
    assert.match(baselineFingerprint, /^[0-9A-F]{64}$/);
    assert.equal(bootstrapSourceConfigurationFingerprint(), baselineFingerprint);
    const changedManagedCodexServiceFingerprint = bootstrapSourceConfigurationFingerprint(fingerprintFilesystem({
      readTransform: (contents) => Buffer.concat([contents, Buffer.from('\0fingerprint-test-change')]),
    }));
    assert.notEqual(changedManagedCodexServiceFingerprint, baselineFingerprint);
    const protocolCertificationPath = path.join(repositoryRoot, 'docker/codex-agent-runtime/package.json');
    const changedProtocolCertificationFingerprint = bootstrapSourceConfigurationFingerprint(fingerprintFilesystem({
      targetPath: protocolCertificationPath,
      readTransform: (contents) => Buffer.concat([contents, Buffer.from('\0protocol-certification-test-change')]),
    }));
    assert.notEqual(changedProtocolCertificationFingerprint, baselineFingerprint,
      'changing the source-controlled expected protocol digest changes bootstrap identity');

    const unavailableFingerprint = (error) => error.code === 'MANAGED_CODEX_FINGERPRINT_UNAVAILABLE';
    assert.throws(
      () => bootstrapSourceConfigurationFingerprint(fingerprintFilesystem({ missing: true })),
      unavailableFingerprint,
    );
    assert.throws(
      () => bootstrapSourceConfigurationFingerprint(fingerprintFilesystem({
        stat: { isFile: () => false, isSymbolicLink: () => false },
      })),
      unavailableFingerprint,
    );
    assert.throws(
      () => bootstrapSourceConfigurationFingerprint(fingerprintFilesystem({
        stat: { isFile: () => true, isSymbolicLink: () => true },
      })),
      unavailableFingerprint,
    );

    for (const invalidRoot of [
      undefined,
      '',
      'relative/candidate',
      `${repositoryRoot}${path.sep}..${path.sep}SkyCommand`,
      path.join(os.tmpdir(), `codex-candidate-root-missing-${process.pid}-${Date.now()}`),
      path.parse(repositoryRoot).root,
    ]) {
      if (invalidRoot === undefined) delete process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
      else process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = invalidRoot;
      assert.throws(
        () => bootstrapSourceConfigurationFingerprint(),
        (error) => error.code === 'MANAGED_CODEX_CANDIDATE_SOURCE_ROOT_INVALID',
        `candidate root must reject missing, non-absolute, non-canonical, absent, or root-level configuration: ${String(invalidRoot)}`,
      );
    }

    process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = repositoryRoot;
    assert.throws(
      () => bootstrapSourceConfigurationFingerprint(fingerprintFilesystem({
        rootStat: { isDirectory: () => true, isSymbolicLink: () => true },
      })),
      (error) => error.code === 'MANAGED_CODEX_CANDIDATE_SOURCE_ROOT_INVALID',
      'candidate root symlinks must fail closed',
    );
    assert.throws(
      () => bootstrapSourceConfigurationFingerprint(fingerprintFilesystem({
        rootStat: { isDirectory: () => true, isSymbolicLink: () => false },
        rootRealPath: path.join(repositoryRoot, 'redirected'),
      })),
      (error) => error.code === 'MANAGED_CODEX_CANDIDATE_SOURCE_ROOT_INVALID',
      'candidate roots whose canonical path differs must fail closed',
    );
  } finally {
    if (previousFingerprintCandidateRoot === undefined) delete process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
    else process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = previousFingerprintCandidateRoot;
  }

  const compose = yaml.parse(fs.readFileSync(path.join(repositoryRoot, 'compose.yaml'), 'utf8'));
  const apiCompose = compose.services.api;
  const candidateRoot = apiCompose.environment.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
  const workspaceMount = apiCompose.volumes.find((volume) => volume?.type === 'bind' && volume.target === '/workspace/SkyEco System');
  assert.ok(workspaceMount, 'the configured candidate root must live beneath the existing mounted workspace bind');
  assert.equal(workspaceMount.source, '${SKYCOMMAND_DOCKER_WORKSPACE_ROOT:-.}',
    'the candidate path must resolve relative to the Docker-local workspace checkout bind');
  assert.equal(path.posix.relative(workspaceMount.target, candidateRoot), 'SkyCommand System/SkyCommand');
  assert.equal(candidateRoot, '/workspace/SkyEco System/SkyCommand System/SkyCommand',
    'The source identity used to authorize a rebuild must describe the source the Supervisor will build, not merely the source bytes of the API currently authorizing it.');
  assert.equal(apiCompose.volumes.some((volume) => volume?.type === 'bind' && volume.target === '/app'), false,
    'the candidate checkout must remain distinct from the API image source mounted at /app');
  const certificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-candidate-certification-'));
  try {
    fs.mkdirSync(path.join(certificationRoot, 'docker/codex-agent-runtime'), { recursive: true });
    fs.copyFileSync(
      path.join(repositoryRoot, 'docker/codex-agent-runtime/package-lock.json'),
      path.join(certificationRoot, 'docker/codex-agent-runtime/package-lock.json'),
    );
    fs.copyFileSync(
      path.join(repositoryRoot, 'docker/codex-agent-runtime/package.json'),
      path.join(certificationRoot, 'docker/codex-agent-runtime/package.json'),
    );
    fs.writeFileSync(path.join(certificationRoot, 'docker/codex-agent-runtime/config.toml'), 'candidate runtime config\n');
    fs.writeFileSync(path.join(certificationRoot, 'docker/codex-provider-allowlist.txt'), 'candidate.example\n');
    const previousCandidateRoot = process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
    process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = certificationRoot;
    try {
      assert.deepEqual(expectedCertification(), expectedCertification(repositoryRoot),
        'deployed runtime certification must remain rooted at the API source, not candidate configuration');
      assert.equal(expectedCertification(repositoryRoot).protocolSchemaDigest, EXPECTED_PRIMARY_PROTOCOL_SCHEMA_DIGEST);
      assert.equal(expectedCertification(repositoryRoot).protocolSchemaV2Digest, EXPECTED_PROTOCOL_SCHEMA_V2_DIGEST);
      assert.equal(expectedCertification(repositoryRoot).installedArtifactSha256, EXPECTED_INSTALLED_ARTIFACT_SHA256);
      assert.notEqual(
        expectedCertification(certificationRoot).configurationDigest,
        expectedCertification(repositoryRoot).configurationDigest,
        'candidate configuration changes must not silently redirect runtime certification reads',
      );
      const invalidProtocolPackagePath = path.join(certificationRoot, 'docker/codex-agent-runtime/package.json');
      const invalidProtocolPackage = JSON.parse(fs.readFileSync(invalidProtocolPackagePath, 'utf8'));
      delete invalidProtocolPackage.skycommandRuntimeCertification.primaryProtocolSchemaDigest;
      fs.writeFileSync(invalidProtocolPackagePath, `${JSON.stringify(invalidProtocolPackage)}\n`);
      const missingExpectedDigest = expectedCertification(certificationRoot);
      assert.equal(missingExpectedDigest.protocolSchemaDigest, null);
      assert.equal(assessRuntimeIdentity(certifiedRuntime.health, missingExpectedDigest).readinessCode,
        'CODEX_PROTOCOL_SCHEMA_DIGEST_EXPECTED_MISSING',
        'a missing expected digest blocks readiness rather than accepting any observed digest');
    } finally {
      if (previousCandidateRoot === undefined) delete process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
      else process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = previousCandidateRoot;
    }
  } finally {
    fs.rmSync(certificationRoot, { recursive: true, force: true });
  }

  const lifecycleRequest = {
    assistantIntegration: { agentId: 'codex-local' },
    permissions: [{ permissionCode: 'MANAGED_CODEX_LIFECYCLE' }],
    user: { userId: null },
    session: { appCode: 'SKYSERVER_ADMIN' },
    headers: {},
    get: () => '',
  };

  const priorOperationId = '123e4567-e89b-12d3-a456-426614174000';
  const replacementOperationId = '223e4567-e89b-42d3-a456-426614174001';
  const stillDifferentOperationId = '323e4567-e89b-42d3-a456-426614174002';
  const oldFingerprint = 'A'.repeat(64);
  const correctedFingerprint = 'B'.repeat(64);
  const completedAt = '2026-09-23T10:00:00.000Z';
  const priorHistoryEntry = {
    priorOperationId: '423e4567-e89b-42d3-a456-426614174003',
    attemptCount: 2,
    terminalState: 'FAILED',
    sourceConfigurationFingerprint: 'C'.repeat(64),
    completedAt: '2026-09-22T10:00:00.000Z',
    supersededAt: '2026-09-22T11:00:00.000Z',
    replacementOperationId: '523e4567-e89b-42d3-a456-426614174004',
    priorLifecycle: {
      operationId: '423e4567-e89b-42d3-a456-426614174003', state: 'FAILED', attemptCount: 2,
      sourceConfigurationFingerprint: 'C'.repeat(64), completedAt: '2026-09-22T10:00:00.000Z',
    },
  };
  const lifecycleCertification = managedCodexBootstrapService.expectedCertification();
  const lifecycleReadyHealth = {
    ok: true,
    observedCodexVersion: CODEX_VERSION,
    expectedCodexVersion: CODEX_VERSION,
    observedPackageIntegrity: CODEX_LINUX_X64_INTEGRITY,
    expectedPackageIntegrity: CODEX_LINUX_X64_INTEGRITY,
    observedWrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
    expectedWrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
    observedPackageLockSha256: 'E'.repeat(64),
    expectedPackageLockSha256: lifecycleCertification.packageLockSha256,
    observedInstalledArtifactSha256: lifecycleCertification.installedArtifactSha256,
    expectedInstalledArtifactSha256: lifecycleCertification.installedArtifactSha256,
    identityAttestation: 'VERIFIED',
    identityMismatchFields: [],
    observedProtocolSchemaDigest: lifecycleCertification.protocolSchemaDigest,
    expectedProtocolSchemaDigest: lifecycleCertification.protocolSchemaDigest,
    protocolSchemaDigest: lifecycleCertification.protocolSchemaDigest,
    protocolSchemaV2Digest: lifecycleCertification.protocolSchemaV2Digest,
    expectedProtocolSchemaV2Digest: lifecycleCertification.protocolSchemaV2Digest,
    configurationDigest: lifecycleCertification.configurationDigest,
    networkPolicyDigest: lifecycleCertification.networkPolicyDigest,
    mcpReachability: 'CURRENT',
    providerReachability: 'UNKNOWN',
    containment: {
      nonRoot: true,
      noNewPrivileges: true,
      allLinuxCapabilitiesDropped: true,
      readOnlyRootFilesystem: true,
      managedHomeVolumeOnly: true,
      liveCheckoutMount: false,
      arbitraryHostPathMount: false,
      dockerSocket: false,
      gitAvailable: false,
      browserState: false,
      prohibitedCredentials: true,
    },
  };

  function createLifecycleHarness({ lifecycle = null, history = [], fingerprint = oldFingerprint, supervisor = { operation: null, lastOperation: null, services: [] } } = {}) {
    const harness = { lifecycle, history: structuredClone(history), fingerprint, supervisor: structuredClone(supervisor), authorized: [], dispatched: [] };
    harness.queryExecutor = async (sql, params) => {
      if (sql.includes('SELECT installation_id, metadata')) {
        return {
          rowCount: 1,
          rows: [{ installation_id: 'installation-1', metadata: { bootstrapLifecycle: harness.lifecycle, bootstrapLifecycleHistory: harness.history } }],
        };
      }
      if (sql.includes('FROM core.agent_runtime_installations i')) {
        return { rowCount: 1, rows: [{ installation_id: 'installation-1', certification_state: 'UNVERIFIED' }] };
      }
      if (sql.includes('FROM core.agent_runtime_accounts')) return { rowCount: 0, rows: [] };
      if (sql.includes('UPDATE core.agent_runtime_installations') && sql.includes('SET certification_state = $2')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('IS NOT DISTINCT FROM')) {
        const expected = JSON.parse(params[3]);
        if (JSON.stringify(harness.lifecycle) !== JSON.stringify(expected)) return { rowCount: 0, rows: [] };
        harness.lifecycle = JSON.parse(params[1]);
        harness.history = JSON.parse(params[2]);
        return { rowCount: 1, rows: [{ installation_id: 'installation-1' }] };
      }
      if (sql.includes("jsonb_build_object('bootstrapLifecycle'")) {
        harness.lifecycle = JSON.parse(params[1]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected lifecycle-test query: ${sql.slice(0, 90)}`);
    };
    harness.dependencies = {
      queryExecutor: harness.queryExecutor,
      bridge: async () => ({ health: structuredClone(lifecycleReadyHealth) }),
      getBootstrapSourceConfigurationFingerprint: () => harness.fingerprint,
      authorize: async (request) => {
        harness.authorized.push(request);
        return { authorization: { grant: 'synthetic-test-grant' } };
      },
      fetcher: async (url, options = {}) => {
        if (options.method === 'POST') {
          harness.dispatched.push({ url, options });
          return { ok: true, json: async () => ({ ok: true, operation: { operationId: JSON.parse(options.body || '{}').operationId || harness.authorized.at(-1)?.operationId } }) };
        }
        return { ok: true, json: async () => ({ ok: true, ...structuredClone(harness.supervisor) }) };
      },
    };
    return harness;
  }

  const firstOperation = createLifecycleHarness({ fingerprint: oldFingerprint });
  const initialStart = await startManagedCodexLifecycle(priorOperationId, {
    ...lifecycleRequest,
    body: { operationId: priorOperationId, sourceConfigurationFingerprint: 'F'.repeat(64), attemptCount: 0 },
  }, firstOperation.dependencies);
  assert.equal(initialStart.lifecycle.state, 'DISPATCHED');
  assert.equal(initialStart.lifecycle.operationId, priorOperationId);
  assert.deepEqual(initialStart.lifecycle.services, CODEX_BOOTSTRAP_REBUILD_SERVICES);
  assert.equal(initialStart.lifecycle.attemptCount, 1);
  assert.equal(initialStart.lifecycle.sourceConfigurationFingerprint, oldFingerprint);
  assert.equal(initialStart.lifecycle.lifecycleSchemaVersion, 2);
  assert.equal(initialStart.lifecycle.sourceConfigurationFingerprintStatus, 'BOUND');
  assert.equal(firstOperation.authorized[0].action, 'REBUILD_CODEX_BOOTSTRAP');
  assert.equal(firstOperation.authorized[0].operationId, priorOperationId);
  assert.match(firstOperation.dispatched[0].url, /\/runtime\/rebuild-codex-bootstrap$/);
  assert.equal(firstOperation.dispatched[0].options.method, 'POST');
  assert.equal(firstOperation.dispatched[0].options.body, '{}');

  firstOperation.supervisor = {
    operation: null,
    lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt },
    services: [],
  };
  const liveFailureReconciliation = await getManagedCodexLifecycle(priorOperationId, lifecycleRequest, firstOperation.dependencies);
  assert.equal(liveFailureReconciliation.lifecycle.state, 'FAILED');
  assert.equal(liveFailureReconciliation.lifecycle.completedAt, completedAt);
  assert.ok(liveFailureReconciliation.lifecycle.terminalReconciledAt);
  assert.equal(Object.hasOwn(liveFailureReconciliation.lifecycle, 'terminalReconciliationBasis'), false,
    'same-operation Supervisor failure remains the normal live reconciliation path');
  const secondAttempt = await startManagedCodexLifecycle(priorOperationId, lifecycleRequest, firstOperation.dependencies);
  assert.equal(secondAttempt.lifecycle.attemptCount, 2, `same operation may use only its second authorized attempt: ${JSON.stringify(secondAttempt)}`);
  assert.equal(secondAttempt.lifecycle.lifecycleSchemaVersion, 2);
  assert.equal(firstOperation.lifecycle.attemptCount, 2);
  assert.equal(firstOperation.lifecycle.sourceConfigurationFingerprint, oldFingerprint);

  const changedInterfaceRequest = {
    ...lifecycleRequest,
    user: { userId: 'different-user' },
    session: { appCode: 'OTHER_INTERFACE' },
    body: { operationId: priorOperationId, attemptCount: 0, sourceConfigurationFingerprint: correctedFingerprint },
  };
  await assert.rejects(
    startManagedCodexLifecycle(priorOperationId, changedInterfaceRequest, firstOperation.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_ATTEMPTS_EXHAUSTED',
  );
  assert.equal(firstOperation.lifecycle.attemptCount, 2, 'interface or caller body changes cannot reset the durable attempt budget');
  assert.equal(firstOperation.dispatched.length, 2);

  await assert.rejects(
    startManagedCodexLifecycle(stillDifferentOperationId, lifecycleRequest, firstOperation.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNCHANGED',
  );
  assert.equal(firstOperation.dispatched.length, 2, 'unchanged fingerprint must not dispatch a replacement');

  firstOperation.fingerprint = correctedFingerprint;
  firstOperation.history = [structuredClone(priorHistoryEntry)];
  const replacement = await startManagedCodexLifecycle(replacementOperationId, lifecycleRequest, firstOperation.dependencies);
  assert.equal(replacement.lifecycle.operationId, replacementOperationId);
  assert.equal(replacement.lifecycle.attemptCount, 1, 'replacement receives a fresh operation budget, not attempt three');
  assert.equal(replacement.lifecycle.sourceConfigurationFingerprint, correctedFingerprint);
  assert.equal(replacement.lifecycle.sourceConfigurationFingerprintStatus, 'BOUND');
  assert.equal(replacement.lifecycle.lifecycleSchemaVersion, 2);
  assert.equal(replacement.lifecycle.supersedesOperationId, priorOperationId);
  assert.equal(replacement.lifecycleHistory.length, 2);
  assert.equal(replacement.lifecycleHistory[0].priorOperationId, priorHistoryEntry.priorOperationId, 'existing supersession evidence must not be overwritten');
  assert.equal(replacement.lifecycleHistory[0].replacementOperationId, priorHistoryEntry.replacementOperationId);
  assert.equal(replacement.lifecycleHistory[0].supersededAt, priorHistoryEntry.supersededAt);
  assert.equal(replacement.lifecycleHistory[0].priorLifecycle.sourceConfigurationFingerprint, priorHistoryEntry.priorLifecycle.sourceConfigurationFingerprint);
  assert.equal(replacement.lifecycleHistory[1].priorOperationId, priorOperationId);
  assert.equal(replacement.lifecycleHistory[1].attemptCount, 2);
  assert.equal(replacement.lifecycleHistory[1].terminalState, 'FAILED');
  assert.equal(replacement.lifecycleHistory[1].sourceConfigurationFingerprint, oldFingerprint);
  assert.equal(replacement.lifecycleHistory[1].sourceConfigurationFingerprintStatus, 'BOUND');
  assert.equal(replacement.lifecycleHistory[1].eventType, 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED');
  assert.equal(replacement.lifecycleHistory[1].completedAt, completedAt);
  assert.equal(replacement.lifecycleHistory[1].replacementOperationId, replacementOperationId);
  assert.equal(replacement.lifecycleHistory[1].priorLifecycle.operationId, priorOperationId);
  assert.equal(replacement.lifecycleHistory[1].priorLifecycle.attemptCount, 2);
  assert.equal(firstOperation.history[0].priorOperationId, priorHistoryEntry.priorOperationId);
  assert.equal(firstOperation.history[1].priorLifecycle.sourceConfigurationFingerprint, oldFingerprint);
  firstOperation.supervisor = {
    operation: null,
    lastOperation: { operationId: replacementOperationId, status: 'FAILED', completedAt },
    services: [],
  };
  const replacementRetry = await startManagedCodexLifecycle(replacementOperationId, lifecycleRequest, firstOperation.dependencies);
  assert.equal(replacementRetry.lifecycle.attemptCount, 2, 'a current operation recorded as a prior replacement can use its own remaining attempt');
  assert.equal(replacementRetry.lifecycle.lifecycleSchemaVersion, 2);
  await assert.rejects(
    startManagedCodexLifecycle(priorOperationId, lifecycleRequest, firstOperation.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_ID_REUSED',
  );

  const successfulPriorOperationId = '823e4567-e89b-42d3-a456-426614174008';
  const successfulSuccessorOperationId = '923e4567-e89b-42d3-a456-426614174009';
  const successfulServices = ['api', 'codex-egress-proxy', 'codex-mcp-gateway', 'codex-agent-runtime-worker', 'codex-control-bridge']
    .map((service) => ({ service, state: 'RUNNING', running: true, health: 'HEALTHY' }));
  const successfulRuntimeServices = successfulServices.map(({ service, state, health }) => ({ service, state, health }));
  const successfulSupervisor = {
    operation: null,
    lastOperation: { operationId: successfulPriorOperationId, status: 'SUCCEEDED', completedAt },
    services: successfulServices,
  };
  const successfulPriorLifecycle = {
    operationId: successfulPriorOperationId,
    state: 'SUCCEEDED',
    attemptCount: 1,
    requestedAt: '2026-09-23T09:30:00.000Z',
    acceptedAt: '2026-09-23T09:31:00.000Z',
    completedAt,
    terminalReconciledAt: '2026-09-23T10:01:00.000Z',
    supervisorOperationId: successfulPriorOperationId,
    services: [...CODEX_BOOTSTRAP_REBUILD_SERVICES],
    runtimeGeneration: null,
    readiness: null,
    readinessReason: null,
    runtimeServices: successfulRuntimeServices,
    sourceConfigurationFingerprint: oldFingerprint,
    sourceConfigurationFingerprintStatus: 'BOUND',
    lifecycleSchemaVersion: 2,
  };

  const unchangedSuccess = createLifecycleHarness({
    lifecycle: structuredClone(successfulPriorLifecycle),
    fingerprint: oldFingerprint,
    supervisor: structuredClone(successfulSupervisor),
  });
  await assert.rejects(
    startManagedCodexLifecycle(successfulSuccessorOperationId, lifecycleRequest, unchangedSuccess.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNCHANGED',
  );
  assert.equal(unchangedSuccess.dispatched.length, 0, 'an unchanged successful fingerprint must not dispatch another rebuild');
  const sameSuccessfulOperation = await startManagedCodexLifecycle(successfulPriorOperationId, lifecycleRequest, unchangedSuccess.dependencies);
  assert.equal(sameSuccessfulOperation.reused, true, 'same UUID and fingerprint remains idempotent');
  assert.equal(sameSuccessfulOperation.lifecycle.state, 'SUCCEEDED');
  assert.equal(unchangedSuccess.dispatched.length, 0);
  unchangedSuccess.fingerprint = correctedFingerprint;
  await assert.rejects(
    startManagedCodexLifecycle(successfulPriorOperationId, lifecycleRequest, unchangedSuccess.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_CHANGED',
  );
  assert.equal(unchangedSuccess.dispatched.length, 0, 'same UUID must not claim a prior success covers a changed fingerprint');

  const unboundSuccessfulLifecycle = { ...structuredClone(successfulPriorLifecycle) };
  delete unboundSuccessfulLifecycle.sourceConfigurationFingerprint;
  delete unboundSuccessfulLifecycle.sourceConfigurationFingerprintStatus;
  const unboundSuccessful = createLifecycleHarness({
    lifecycle: unboundSuccessfulLifecycle,
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(successfulSupervisor),
  });
  await assert.rejects(
    startManagedCodexLifecycle(successfulSuccessorOperationId, lifecycleRequest, unboundSuccessful.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNAVAILABLE',
  );
  assert.equal(unboundSuccessful.dispatched.length, 0);

  const successfulSuccessor = createLifecycleHarness({
    lifecycle: structuredClone(successfulPriorLifecycle),
    history: [structuredClone(priorHistoryEntry)],
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(successfulSupervisor),
  });
  const successfulSuccessorResult = await startManagedCodexLifecycle(
    successfulSuccessorOperationId,
    lifecycleRequest,
    successfulSuccessor.dependencies,
  );
  assert.equal(successfulSuccessorResult.lifecycle.operationId, successfulSuccessorOperationId);
  assert.equal(successfulSuccessorResult.lifecycle.state, 'DISPATCHED');
  assert.equal(successfulSuccessorResult.lifecycle.attemptCount, 1);
  assert.equal(successfulSuccessorResult.lifecycle.sourceConfigurationFingerprint, correctedFingerprint);
  assert.equal(successfulSuccessorResult.lifecycle.lifecycleSchemaVersion, 2);
  assert.equal(successfulSuccessorResult.lifecycle.successorOfOperationId, successfulPriorOperationId);
  assert.equal(Object.hasOwn(successfulSuccessorResult.lifecycle, 'supersedesOperationId'), false);
  assert.equal(successfulSuccessorResult.lifecycleHistory.length, 2);
  assert.equal(successfulSuccessorResult.lifecycleHistory[0].priorOperationId, priorHistoryEntry.priorOperationId);
  const successfulHistory = successfulSuccessorResult.lifecycleHistory[1];
  assert.equal(successfulHistory.eventType, 'MANAGED_CODEX_LIFECYCLE_SUCCESSOR_CREATED');
  assert.equal(successfulHistory.priorOperationId, successfulPriorOperationId);
  assert.equal(successfulHistory.terminalState, 'SUCCEEDED');
  assert.equal(successfulHistory.sourceConfigurationFingerprint, oldFingerprint);
  assert.equal(successfulHistory.completedAt, completedAt);
  assert.equal(successfulHistory.terminalReconciledAt, successfulPriorLifecycle.terminalReconciledAt);
  assert.equal(successfulHistory.successorOperationId, successfulSuccessorOperationId);
  assert.ok(successfulHistory.successorCreatedAt);
  assert.equal(Object.hasOwn(successfulHistory, 'supersededAt'), false);
  assert.equal(Object.hasOwn(successfulHistory, 'replacementOperationId'), false);
  assert.deepEqual(successfulHistory.priorLifecycle, successfulPriorLifecycle, 'the successful prior payload remains immutable evidence');
  assert.equal(successfulSuccessor.dispatched.length, 1);
  await assert.rejects(
    startManagedCodexLifecycle(successfulPriorOperationId, lifecycleRequest, successfulSuccessor.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_ID_REUSED',
  );

  const candidateSuccessorOperationId = 'b23e4567-e89b-42d3-a456-426614174011';
  const secondCandidateSuccessorOperationId = 'c23e4567-e89b-42d3-a456-426614174012';
  const previousCandidateRoot = process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
  try {
    process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = repositoryRoot;
    const candidateFingerprint = bootstrapSourceConfigurationFingerprint();
    assert.match(candidateFingerprint, /^[0-9A-F]{64}$/);
    assert.notEqual(candidateFingerprint, oldFingerprint);

    const candidatePredecessor = {
      ...structuredClone(successfulPriorLifecycle),
      sourceConfigurationFingerprint: oldFingerprint,
    };
    const candidateSuccessor = createLifecycleHarness({
      lifecycle: candidatePredecessor,
      fingerprint: candidateFingerprint,
      supervisor: structuredClone(successfulSupervisor),
    });
    delete candidateSuccessor.dependencies.getBootstrapSourceConfigurationFingerprint;
    const candidateRequestWithUntrustedRoot = {
      ...lifecycleRequest,
      body: {
        operationId: candidateSuccessorOperationId,
        candidateSourceRoot: path.join(os.tmpdir(), 'untrusted-codex-source'),
        sourceConfigurationFingerprint: oldFingerprint,
      },
    };
    const candidateSuccessorResult = await startManagedCodexLifecycle(
      candidateSuccessorOperationId,
      candidateRequestWithUntrustedRoot,
      candidateSuccessor.dependencies,
    );
    assert.equal(candidateSuccessorResult.lifecycle.state, 'DISPATCHED');
    assert.equal(candidateSuccessorResult.lifecycle.attemptCount, 1);
    assert.equal(candidateSuccessorResult.lifecycle.sourceConfigurationFingerprint, candidateFingerprint,
      'The source identity used to authorize a rebuild must describe the source the Supervisor will build, not merely the source bytes of the API currently authorizing it.');
    assert.equal(candidateSuccessorResult.lifecycle.successorOfOperationId, successfulPriorOperationId);
    assert.equal(candidateSuccessor.dispatched.length, 1);
    assert.equal(candidateSuccessor.authorized.length, 1);

    await assert.rejects(
      startManagedCodexLifecycle(secondCandidateSuccessorOperationId, lifecycleRequest, candidateSuccessor.dependencies),
      (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
      'a single changed candidate fingerprint may admit only one new lifecycle before that lifecycle terminates',
    );
    assert.equal(candidateSuccessor.dispatched.length, 1, 'a second candidate successor must not dispatch');

    const unchangedCandidatePredecessor = {
      ...structuredClone(successfulPriorLifecycle),
      sourceConfigurationFingerprint: candidateFingerprint,
    };
    const unchangedCandidate = createLifecycleHarness({
      lifecycle: unchangedCandidatePredecessor,
      fingerprint: oldFingerprint,
      supervisor: structuredClone(successfulSupervisor),
    });
    delete unchangedCandidate.dependencies.getBootstrapSourceConfigurationFingerprint;
    await assert.rejects(
      startManagedCodexLifecycle(successfulSuccessorOperationId, lifecycleRequest, unchangedCandidate.dependencies),
      (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNCHANGED',
    );
    assert.equal(unchangedCandidate.dispatched.length, 0,
      'candidate fingerprint A must not cause a rebuild when the prior successful lifecycle is already bound to A');

    for (const invalidCandidateRoot of [undefined, 'relative/candidate-root']) {
      if (invalidCandidateRoot === undefined) delete process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
      else process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = invalidCandidateRoot;
      const invalidRootHarness = createLifecycleHarness({
        lifecycle: structuredClone(candidatePredecessor),
        history: [structuredClone(priorHistoryEntry)],
        supervisor: structuredClone(successfulSupervisor),
      });
      delete invalidRootHarness.dependencies.getBootstrapSourceConfigurationFingerprint;
      const lifecycleBefore = structuredClone(invalidRootHarness.lifecycle);
      const historyBefore = structuredClone(invalidRootHarness.history);
      await assert.rejects(
        startManagedCodexLifecycle(candidateSuccessorOperationId, lifecycleRequest, invalidRootHarness.dependencies),
        (error) => error.code === 'MANAGED_CODEX_CANDIDATE_SOURCE_ROOT_INVALID',
      );
      assert.deepEqual(invalidRootHarness.lifecycle, lifecycleBefore, 'invalid candidate roots must not mutate lifecycle state');
      assert.deepEqual(invalidRootHarness.history, historyBefore, 'invalid candidate roots must not mutate lifecycle history');
      assert.equal(invalidRootHarness.authorized.length, 0, 'invalid candidate roots must not obtain a Supervisor grant');
      assert.equal(invalidRootHarness.dispatched.length, 0, 'invalid candidate roots must not dispatch');
    }
  } finally {
    if (previousCandidateRoot === undefined) delete process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT;
    else process.env.SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT = previousCandidateRoot;
  }

  const laterSupervisorOperationId = 'a23e4567-e89b-42d3-a456-426614174010';
  const laterSupervisorState = {
    ...structuredClone(successfulSupervisor),
    lastOperation: { operationId: laterSupervisorOperationId, status: 'SUCCEEDED', completedAt: '2026-09-23T11:00:00.000Z' },
  };
  const durableSuccessor = createLifecycleHarness({
    lifecycle: structuredClone(successfulPriorLifecycle),
    fingerprint: correctedFingerprint,
    supervisor: laterSupervisorState,
  });
  const durableSuccessorResult = await startManagedCodexLifecycle(
    successfulSuccessorOperationId,
    lifecycleRequest,
    durableSuccessor.dependencies,
  );
  assert.equal(durableSuccessorResult.lifecycle.successorOfOperationId, successfulPriorOperationId);
  assert.equal(durableSuccessorResult.lifecycle.attemptCount, 1, 'a durable successful predecessor permits a fresh lifecycle budget');
  assert.equal(durableSuccessor.dispatched.length, 1, 'an unrelated later Supervisor operation must not erase reconciled success');

  const durableSuccessBlockedCases = [
    {
      label: 'missing prior terminal reconciliation timestamp',
      lifecycle: (() => {
        const value = structuredClone(successfulPriorLifecycle);
        delete value.terminalReconciledAt;
        return value;
      })(),
      supervisor: laterSupervisorState,
    },
    {
      label: 'invalid bound source fingerprint',
      lifecycle: { ...structuredClone(successfulPriorLifecycle), sourceConfigurationFingerprint: 'not-a-valid-fingerprint' },
      supervisor: laterSupervisorState,
    },
    {
      label: 'missing bound source fingerprint',
      lifecycle: (() => {
        const value = structuredClone(successfulPriorLifecycle);
        delete value.sourceConfigurationFingerprint;
        delete value.sourceConfigurationFingerprintStatus;
        return value;
      })(),
      supervisor: laterSupervisorState,
    },
    {
      label: 'active unrelated Supervisor operation',
      lifecycle: structuredClone(successfulPriorLifecycle),
      supervisor: {
        ...structuredClone(laterSupervisorState),
        operation: { operationId: laterSupervisorOperationId, action: 'REBUILD_BACKEND' },
      },
    },
    {
      label: 'same-operation nonterminal Supervisor evidence',
      lifecycle: structuredClone(successfulPriorLifecycle),
      supervisor: {
        ...structuredClone(successfulSupervisor),
        lastOperation: { operationId: successfulPriorOperationId, status: 'WAITING_READINESS' },
      },
    },
  ];
  for (const blocked of durableSuccessBlockedCases) {
    const harness = createLifecycleHarness({
      lifecycle: blocked.lifecycle,
      fingerprint: correctedFingerprint,
      supervisor: blocked.supervisor,
    });
    await assert.rejects(
      startManagedCodexLifecycle(successfulSuccessorOperationId, lifecycleRequest, harness.dependencies),
      (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
      blocked.label,
    );
    assert.equal(harness.dispatched.length, 0, `${blocked.label} must not dispatch a successor`);
  }

  const firstTimeSuccessLifecycle = {
    ...structuredClone(successfulPriorLifecycle),
    state: 'DISPATCHED',
    completedAt: null,
  };
  delete firstTimeSuccessLifecycle.terminalReconciledAt;
  const firstTimeSuccess = createLifecycleHarness({
    lifecycle: firstTimeSuccessLifecycle,
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(successfulSupervisor),
  });
  const firstTimeSuccessResult = await startManagedCodexLifecycle(
    successfulSuccessorOperationId,
    lifecycleRequest,
    firstTimeSuccess.dependencies,
  );
  assert.equal(firstTimeSuccessResult.lifecycle.successorOfOperationId, successfulPriorOperationId);
  assert.equal(firstTimeSuccessResult.lifecycleHistory[0].priorLifecycle.state, 'SUCCEEDED', 'live same-operation Supervisor success is reconciled before successor creation');
  assert.ok(firstTimeSuccessResult.lifecycleHistory[0].priorLifecycle.terminalReconciledAt);
  assert.equal(firstTimeSuccess.dispatched.length, 1);

  const unconfirmedFirstTimeSuccess = createLifecycleHarness({
    lifecycle: firstTimeSuccessLifecycle,
    fingerprint: correctedFingerprint,
    supervisor: laterSupervisorState,
  });
  await assert.rejects(
    startManagedCodexLifecycle(successfulSuccessorOperationId, lifecycleRequest, unconfirmedFirstTimeSuccess.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
    'an unconfirmed first-time success must not borrow the durable-history exception',
  );
  assert.equal(unconfirmedFirstTimeSuccess.lifecycle.state, 'DISPATCHED');
  assert.equal(unconfirmedFirstTimeSuccess.dispatched.length, 0);

  const successfulBlockedCases = [
    {
      label: 'active prior successful Supervisor operation',
      supervisor: {
        ...structuredClone(successfulSupervisor),
        operation: { operationId: successfulPriorOperationId, action: 'REBUILD_CODEX_BOOTSTRAP' },
      },
    },
    {
      label: 'uncertain prior successful Supervisor outcome',
      supervisor: {
        operation: null,
        lastOperation: { operationId: successfulPriorOperationId, status: 'UNKNOWN', completedAt },
        services: successfulServices,
      },
    },
    {
      label: 'missing authoritative inactive-operation evidence',
      supervisor: {
        lastOperation: { operationId: successfulPriorOperationId, status: 'SUCCEEDED', completedAt },
        services: successfulServices,
      },
    },
  ];
  for (const blocked of successfulBlockedCases) {
    const harness = createLifecycleHarness({
      lifecycle: structuredClone(successfulPriorLifecycle),
      fingerprint: correctedFingerprint,
      supervisor: blocked.supervisor,
    });
    await assert.rejects(
      startManagedCodexLifecycle(successfulSuccessorOperationId, lifecycleRequest, harness.dependencies),
      (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
      blocked.label,
    );
    assert.equal(harness.dispatched.length, 0, `${blocked.label} must not dispatch`);
  }
  const fullSuccessfulHistory = Array.from({ length: 8 }, (_unused, index) => {
    const priorId = `${String(index + 30).padStart(8, '0')}-489b-42d3-a456-426614174000`;
    const successorId = `${String(index + 30).padStart(8, '0')}-489b-42d3-a456-426614174001`;
    const lifecycle = {
      ...structuredClone(successfulPriorLifecycle),
      operationId: priorId,
    };
    return {
      eventType: 'MANAGED_CODEX_LIFECYCLE_SUCCESSOR_CREATED',
      priorOperationId: priorId,
      attemptCount: lifecycle.attemptCount,
      terminalState: 'SUCCEEDED',
      sourceConfigurationFingerprintStatus: 'BOUND',
      sourceConfigurationFingerprint: oldFingerprint,
      completedAt: lifecycle.completedAt,
      terminalReconciledAt: lifecycle.terminalReconciledAt,
      successorCreatedAt: lifecycle.terminalReconciledAt,
      successorOperationId: successorId,
      priorLifecycle: lifecycle,
    };
  });
  const fullSuccessfulHistoryHarness = createLifecycleHarness({
    lifecycle: structuredClone(successfulPriorLifecycle),
    history: fullSuccessfulHistory,
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(successfulSupervisor),
  });
  await assert.rejects(
    startManagedCodexLifecycle(successfulSuccessorOperationId, lifecycleRequest, fullSuccessfulHistoryHarness.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_HISTORY_LIMIT',
  );
  assert.equal(fullSuccessfulHistoryHarness.history.length, 8, 'successful successor history must remain bounded without evicting prior evidence');
  assert.equal(fullSuccessfulHistoryHarness.dispatched.length, 0);

  const blockedCases = [
    {
      label: 'uncertain persisted outcome',
      lifecycle: { operationId: priorOperationId, state: 'UNKNOWN', attemptCount: 2, sourceConfigurationFingerprint: oldFingerprint },
      supervisor: { operation: null, lastOperation: null, services: [] },
    },
    {
      label: 'requested outcome',
      lifecycle: { operationId: priorOperationId, state: 'REQUESTED', attemptCount: 2, sourceConfigurationFingerprint: oldFingerprint },
      supervisor: { operation: null, lastOperation: null, services: [] },
    },
    {
      label: 'dispatched outcome without terminal Supervisor evidence',
      lifecycle: { operationId: priorOperationId, state: 'DISPATCHED', attemptCount: 2, sourceConfigurationFingerprint: oldFingerprint },
      supervisor: { operation: null, lastOperation: null, services: [] },
    },
    {
      label: 'waiting-readiness outcome',
      lifecycle: { operationId: priorOperationId, state: 'WAITING_READINESS', attemptCount: 2, sourceConfigurationFingerprint: oldFingerprint },
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'SUCCEEDED', completedAt }, services: [] },
    },
    {
      label: 'active Supervisor operation',
      lifecycle: { operationId: priorOperationId, state: 'FAILED', attemptCount: 2, completedAt, sourceConfigurationFingerprint: oldFingerprint },
      supervisor: { operation: { operationId: '623e4567-e89b-42d3-a456-426614174005', action: 'START' }, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
    },
    {
      label: 'contradictory successful Supervisor outcome',
      lifecycle: { operationId: priorOperationId, state: 'FAILED', attemptCount: 2, completedAt, sourceConfigurationFingerprint: oldFingerprint },
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'SUCCEEDED', completedAt }, services: [] },
    },
    {
      label: 'missing explicit no-active-operation evidence',
      lifecycle: { operationId: priorOperationId, state: 'FAILED', attemptCount: 2, completedAt, sourceConfigurationFingerprint: oldFingerprint },
      supervisor: { lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
    },
    {
      label: 'attempt budget remains for unchanged fingerprint',
      lifecycle: { operationId: priorOperationId, state: 'FAILED', attemptCount: 1, completedAt, sourceConfigurationFingerprint: oldFingerprint },
      fingerprint: oldFingerprint,
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_ATTEMPTS_REMAIN',
    },
    {
      label: 'versioned failure without a bound fingerprint',
      lifecycle: { operationId: priorOperationId, state: 'FAILED', attemptCount: 2, completedAt, lifecycleSchemaVersion: 2 },
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNAVAILABLE',
    },
  ];
  for (const blocked of blockedCases) {
    const harness = createLifecycleHarness({
      lifecycle: blocked.lifecycle,
      fingerprint: blocked.fingerprint || correctedFingerprint,
      supervisor: blocked.supervisor,
    });
    await assert.rejects(
      startManagedCodexLifecycle(replacementOperationId, lifecycleRequest, harness.dependencies),
      (error) => error.code === (blocked.expectedCode || 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL'),
      blocked.label,
    );
    assert.equal(harness.dispatched.length, 0, `${blocked.label} must not dispatch`);
  }

  const earlySupersessionOperationId = 'd23e4567-e89b-42d3-a456-426614174014';
  const earlySupersessionLifecycle = {
    operationId: priorOperationId,
    state: 'FAILED',
    attemptCount: 1,
    requestedAt: '2026-09-23T09:00:00.000Z',
    acceptedAt: '2026-09-23T09:01:00.000Z',
    completedAt,
    terminalReconciledAt: '2026-09-23T10:01:00.000Z',
    supervisorOperationId: priorOperationId,
    services: [...CODEX_BOOTSTRAP_REBUILD_SERVICES],
    runtimeGeneration: null,
    readiness: null,
    readinessReason: null,
    runtimeServices: [],
    sourceConfigurationFingerprint: oldFingerprint,
    sourceConfigurationFingerprintStatus: 'BOUND',
    lifecycleSchemaVersion: 2,
  };
  const earlySupersessionHarness = createLifecycleHarness({
    lifecycle: structuredClone(earlySupersessionLifecycle),
    fingerprint: correctedFingerprint,
    supervisor: {
      operation: null,
      lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt },
      services: [],
    },
  });
  const earlySupersession = await startManagedCodexLifecycle(
    earlySupersessionOperationId,
    lifecycleRequest,
    earlySupersessionHarness.dependencies,
  );
  assert.equal(earlySupersession.lifecycle.operationId, earlySupersessionOperationId);
  assert.equal(earlySupersession.lifecycle.attemptCount, 1,
    'a changed fingerprint receives a fresh operation budget without spending the stale operation retry');
  assert.equal(earlySupersession.lifecycle.sourceConfigurationFingerprint, correctedFingerprint);
  assert.equal(earlySupersession.lifecycle.supersedesOperationId, priorOperationId);
  assert.equal(earlySupersession.lifecycleHistory.length, 1);
  assert.equal(earlySupersession.lifecycleHistory[0].eventType, 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED');
  assert.equal(earlySupersession.lifecycleHistory[0].priorOperationId, priorOperationId);
  assert.equal(earlySupersession.lifecycleHistory[0].attemptCount, 1,
    'supersession evidence preserves the unused stale-operation retry rather than fabricating exhaustion');
  assert.equal(earlySupersession.lifecycleHistory[0].sourceConfigurationFingerprint, oldFingerprint);
  assert.equal(earlySupersession.lifecycleHistory[0].replacementOperationId, earlySupersessionOperationId);
  assert.equal(earlySupersessionHarness.dispatched.length, 1);

  earlySupersessionHarness.supervisor = {
    operation: { operationId: earlySupersessionOperationId, action: 'REBUILD_CODEX_BOOTSTRAP' },
    lastOperation: null,
    services: [],
  };
  const earlySupersessionReplay = await startManagedCodexLifecycle(
    earlySupersessionOperationId,
    lifecycleRequest,
    earlySupersessionHarness.dependencies,
  );
  assert.equal(earlySupersessionReplay.reused, true,
    'an early supersession history entry with attemptCount 1 must remain safely readable/idempotent');
  assert.equal(earlySupersessionReplay.lifecycleHistory.length, 1);
  assert.equal(earlySupersessionReplay.lifecycleHistory[0].attemptCount, 1);
  assert.equal(earlySupersessionHarness.dispatched.length, 1,
    'idempotent replay of the fresh successor must not dispatch a second Supervisor operation');

  const legacyReplacementOperationId = '723e4567-e89b-42d3-a456-426614174006';
  const legacyPriorLifecycle = {
    operationId: priorOperationId,
    state: 'FAILED',
    attemptCount: 2,
    requestedAt: '2026-09-23T09:00:00.000Z',
    acceptedAt: '2026-09-23T09:01:00.000Z',
    completedAt,
    terminalReconciledAt: '2026-09-23T10:01:00.000Z',
    supervisorOperationId: priorOperationId,
    services: [...CODEX_BOOTSTRAP_REBUILD_SERVICES],
    runtimeGeneration: 'runtime-generation-safe-id',
    readiness: 'RUNTIME_INCOMPATIBLE',
    readinessReason: 'CODEX_CONTAINMENT_UNEXPECTED_MOUNT_PRESENT',
    runtimeServices: [],
  };

  const legacyUnreconciledFailure = structuredClone(legacyPriorLifecycle);
  delete legacyUnreconciledFailure.terminalReconciledAt;
  const laterSuccessfulSupervisorOperation = {
    operation: null,
    lastOperation: {
      operationId: 'a23e4567-e89b-42d3-a456-426614174010',
      status: 'SUCCEEDED',
      completedAt: '2026-09-23T11:00:00.000Z',
    },
    services: [],
  };
  const legacyCompatibilityReplacementId = 'a33e4567-e89b-42d3-a456-426614174011';
  const legacyCompatibility = createLifecycleHarness({
    lifecycle: structuredClone(legacyUnreconciledFailure),
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(laterSuccessfulSupervisorOperation),
  });
  const legacyCompatibilityStatus = await getManagedCodexLifecycle(
    priorOperationId,
    lifecycleRequest,
    legacyCompatibility.dependencies,
  );
  assert.equal(legacyCompatibilityStatus.lifecycle.state, 'FAILED');
  assert.equal(legacyCompatibilityStatus.lifecycle.operationId, legacyUnreconciledFailure.operationId);
  assert.equal(legacyCompatibilityStatus.lifecycle.supervisorOperationId, priorOperationId);
  assert.equal(legacyCompatibilityStatus.lifecycle.attemptCount, 2);
  assert.equal(legacyCompatibilityStatus.lifecycle.completedAt, completedAt, 'legacy reconciliation must preserve the original completion time');
  assert.ok(legacyCompatibilityStatus.lifecycle.terminalReconciledAt);
  assert.notEqual(legacyCompatibilityStatus.lifecycle.terminalReconciledAt, completedAt);
  assert.equal(legacyCompatibilityStatus.lifecycle.terminalReconciliationBasis, 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY');
  assert.equal(Object.hasOwn(legacyCompatibilityStatus.lifecycle, 'sourceConfigurationFingerprint'), false,
    'legacy reconciliation must not fabricate a historical fingerprint');
  assert.equal(legacyCompatibility.lifecycle.completedAt, completedAt);
  assert.equal(legacyCompatibility.lifecycle.attemptCount, 2);
  assert.equal(legacyCompatibility.lifecycle.state, 'FAILED');
  assert.equal(legacyCompatibility.lifecycle.terminalReconciliationBasis, 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY');

  const legacyCompatibilityReplacement = await startManagedCodexLifecycle(
    legacyCompatibilityReplacementId,
    lifecycleRequest,
    legacyCompatibility.dependencies,
  );
  assert.equal(legacyCompatibilityReplacement.lifecycle.state, 'DISPATCHED');
  assert.equal(legacyCompatibilityReplacement.lifecycle.attemptCount, 1);
  assert.equal(legacyCompatibilityReplacement.lifecycle.sourceConfigurationFingerprint, correctedFingerprint);
  assert.equal(legacyCompatibilityReplacement.lifecycleHistory.length, 1);
  assert.equal(legacyCompatibilityReplacement.lifecycleHistory[0].terminalReconciliationBasis,
    'LEGACY_PERSISTED_FAILURE_COMPATIBILITY');
  assert.equal(legacyCompatibilityReplacement.lifecycleHistory[0].priorLifecycle.terminalReconciliationBasis,
    'LEGACY_PERSISTED_FAILURE_COMPATIBILITY');
  assert.equal(legacyCompatibilityReplacement.lifecycleHistory[0].priorLifecycle.completedAt, completedAt);
  assert.equal(Object.hasOwn(legacyCompatibilityReplacement.lifecycleHistory[0], 'sourceConfigurationFingerprint'), false);
  assert.equal(legacyCompatibility.dispatched.length, 1);
  const legacyCompatibilityReplacementStatus = await getManagedCodexLifecycle(
    legacyCompatibilityReplacementId,
    lifecycleRequest,
    legacyCompatibility.dependencies,
  );
  assert.equal(legacyCompatibilityReplacementStatus.lifecycleHistory[0].terminalReconciliationBasis,
    'LEGACY_PERSISTED_FAILURE_COMPATIBILITY', 'safe lifecycle history must retain the legacy reconciliation basis');

  const boundLegacyCompatibility = createLifecycleHarness({
    lifecycle: {
      ...structuredClone(legacyUnreconciledFailure),
      sourceConfigurationFingerprint: oldFingerprint,
      sourceConfigurationFingerprintStatus: 'BOUND',
    },
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(laterSuccessfulSupervisorOperation),
  });
  const boundLegacyStatus = await getManagedCodexLifecycle(priorOperationId, lifecycleRequest, boundLegacyCompatibility.dependencies);
  assert.equal(boundLegacyStatus.lifecycle.sourceConfigurationFingerprint, oldFingerprint,
    'compatibility reconciliation must preserve an existing valid historical fingerprint unchanged');
  assert.equal(boundLegacyStatus.lifecycle.terminalReconciliationBasis, 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY');

  const compatibilityBlockedCases = [
    ...['REQUESTED', 'DISPATCHED', 'WAITING_READINESS', 'UNKNOWN', 'SUCCEEDED'].map((state) => ({
      label: `${state} lifecycle state`,
      lifecycle: { ...structuredClone(legacyUnreconciledFailure), state },
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    })),
    {
      label: 'active Supervisor operation',
      lifecycle: structuredClone(legacyUnreconciledFailure),
      supervisor: {
        ...structuredClone(laterSuccessfulSupervisorOperation),
        operation: { operationId: 'b23e4567-e89b-42d3-a456-426614174012', action: 'REBUILD_BACKEND' },
      },
    },
    {
      label: 'same-operation nonterminal Supervisor outcome',
      lifecycle: structuredClone(legacyUnreconciledFailure),
      supervisor: {
        operation: null,
        lastOperation: { operationId: priorOperationId, status: 'WAITING_READINESS' },
        services: [],
      },
    },
    {
      label: 'non-exhausted persisted failure',
      lifecycle: { ...structuredClone(legacyUnreconciledFailure), attemptCount: 1 },
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    },
    {
      label: 'missing completion timestamp',
      lifecycle: (() => { const value = structuredClone(legacyUnreconciledFailure); delete value.completedAt; return value; })(),
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    },
    {
      label: 'invalid completion timestamp',
      lifecycle: { ...structuredClone(legacyUnreconciledFailure), completedAt: 'not-a-timestamp' },
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    },
    {
      label: 'invalid existing terminal reconciliation timestamp',
      lifecycle: { ...structuredClone(legacyUnreconciledFailure), terminalReconciledAt: 'not-a-timestamp' },
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    },
    {
      label: 'malformed Supervisor operation identity',
      lifecycle: { ...structuredClone(legacyUnreconciledFailure), supervisorOperationId: 'not-a-uuid' },
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    },
    {
      label: 'malformed existing bound fingerprint',
      lifecycle: { ...structuredClone(legacyUnreconciledFailure), sourceConfigurationFingerprint: 'not-a-digest' },
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    },
    {
      label: 'versioned record missing its bound fingerprint',
      lifecycle: { ...structuredClone(legacyUnreconciledFailure), lifecycleSchemaVersion: 2 },
      supervisor: structuredClone(laterSuccessfulSupervisorOperation),
    },
  ];
  for (const blocked of compatibilityBlockedCases) {
    const harness = createLifecycleHarness({
      lifecycle: blocked.lifecycle,
      fingerprint: correctedFingerprint,
      supervisor: blocked.supervisor,
    });
    await getManagedCodexLifecycle(priorOperationId, lifecycleRequest, harness.dependencies);
    assert.equal(harness.lifecycle.terminalReconciliationBasis, undefined, `${blocked.label} must not receive the legacy basis`);
    assert.equal(harness.lifecycle.terminalReconciledAt, blocked.lifecycle.terminalReconciledAt,
      `${blocked.label} must not be compatibility-reconciled or have existing evidence rewritten`);
    assert.equal(harness.dispatched.length, 0, `${blocked.label} must not dispatch`);
  }

  const sameOperationSuccessCompatibility = createLifecycleHarness({
    lifecycle: structuredClone(legacyUnreconciledFailure),
    fingerprint: correctedFingerprint,
    supervisor: {
      operation: null,
      lastOperation: { operationId: priorOperationId, status: 'SUCCEEDED', completedAt },
      services: structuredClone(successfulServices),
    },
  });
  const sameOperationSuccessStatus = await getManagedCodexLifecycle(
    priorOperationId,
    lifecycleRequest,
    sameOperationSuccessCompatibility.dependencies,
  );
  assert.equal(sameOperationSuccessStatus.lifecycle.state, 'SUCCEEDED',
    'same-operation Supervisor success remains on the existing live-success reconciliation path');
  assert.equal(Object.hasOwn(sameOperationSuccessStatus.lifecycle, 'terminalReconciliationBasis'), false,
    'same-operation Supervisor success must not be mislabeled as legacy failure compatibility');

  const invalidCompatibilityHistory = createLifecycleHarness({
    lifecycle: structuredClone(legacyUnreconciledFailure),
    history: [{ eventType: 'UNRECOGNIZED_LIFECYCLE_EVENT' }],
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(laterSuccessfulSupervisorOperation),
  });
  await getManagedCodexLifecycle(priorOperationId, lifecycleRequest, invalidCompatibilityHistory.dependencies);
  assert.equal(invalidCompatibilityHistory.lifecycle.terminalReconciliationBasis, undefined,
    'invalid lifecycle history must block compatibility reconciliation');
  assert.equal(invalidCompatibilityHistory.lifecycle.terminalReconciledAt, undefined);
  await assert.rejects(
    startManagedCodexLifecycle(legacyCompatibilityReplacementId, lifecycleRequest, invalidCompatibilityHistory.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_HISTORY_INVALID',
  );

  const alreadySupersededWithoutMarker = createLifecycleHarness({
    lifecycle: structuredClone(legacyUnreconciledFailure),
    history: [{
      eventType: 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED',
      priorOperationId,
      attemptCount: 2,
      terminalState: 'FAILED',
      sourceConfigurationFingerprintStatus: 'LEGACY_UNBOUND_PRE_FINGERPRINT',
      completedAt,
      supersededAt: '2026-09-23T10:02:00.000Z',
      replacementOperationId: 'c23e4567-e89b-42d3-a456-426614174013',
      priorLifecycle: structuredClone(legacyUnreconciledFailure),
    }],
    fingerprint: correctedFingerprint,
    supervisor: structuredClone(laterSuccessfulSupervisorOperation),
  });
  await assert.rejects(
    startManagedCodexLifecycle(legacyCompatibilityReplacementId, lifecycleRequest, alreadySupersededWithoutMarker.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_ALREADY_SUPERSEDED',
  );
  assert.equal(alreadySupersededWithoutMarker.lifecycle.terminalReconciledAt, undefined);
  assert.equal(alreadySupersededWithoutMarker.lifecycle.terminalReconciliationBasis, undefined);

  const legacyHarness = createLifecycleHarness({
    lifecycle: structuredClone(legacyPriorLifecycle),
    fingerprint: correctedFingerprint,
    supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
  });
  const legacyReplacement = await startManagedCodexLifecycle(legacyReplacementOperationId, {
    ...lifecycleRequest,
    body: { operationId: legacyReplacementOperationId, sourceConfigurationFingerprint: oldFingerprint },
  }, legacyHarness.dependencies);
  assert.equal(legacyReplacement.lifecycle.operationId, legacyReplacementOperationId);
  assert.equal(legacyReplacement.lifecycle.attemptCount, 1);
  assert.equal(legacyReplacement.lifecycle.lifecycleSchemaVersion, 2);
  assert.equal(legacyReplacement.lifecycle.sourceConfigurationFingerprint, correctedFingerprint);
  assert.equal(legacyReplacement.lifecycle.sourceConfigurationFingerprintStatus, 'BOUND');
  assert.equal(legacyReplacement.lifecycleHistory.length, 1);
  const legacyEvidence = legacyReplacement.lifecycleHistory[0];
  assert.equal(legacyEvidence.eventType, 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED');
  assert.equal(legacyEvidence.priorOperationId, priorOperationId);
  assert.equal(legacyEvidence.attemptCount, 2);
  assert.equal(legacyEvidence.terminalState, 'FAILED');
  assert.equal(legacyEvidence.sourceConfigurationFingerprintStatus, 'LEGACY_UNBOUND_PRE_FINGERPRINT');
  assert.equal(Object.hasOwn(legacyEvidence, 'sourceConfigurationFingerprint'), false, 'legacy history must not fabricate a prior digest');
  assert.equal(legacyEvidence.completedAt, completedAt);
  assert.equal(legacyEvidence.terminalReconciledAt, legacyPriorLifecycle.terminalReconciledAt);
  assert.ok(legacyEvidence.supersededAt);
  assert.equal(legacyEvidence.priorLifecycle.operationId, priorOperationId);
  assert.equal(legacyEvidence.priorLifecycle.attemptCount, 2);
  assert.equal(legacyEvidence.priorLifecycle.requestedAt, legacyPriorLifecycle.requestedAt);
  assert.equal(legacyEvidence.priorLifecycle.acceptedAt, legacyPriorLifecycle.acceptedAt);
  assert.deepEqual(legacyEvidence.priorLifecycle.services, legacyPriorLifecycle.services);
  assert.equal(legacyEvidence.priorLifecycle.readinessReason, legacyPriorLifecycle.readinessReason);
  assert.equal(Object.hasOwn(legacyEvidence.priorLifecycle, 'sourceConfigurationFingerprint'), false);
  assert.equal(Object.hasOwn(legacyEvidence.priorLifecycle, 'lifecycleSchemaVersion'), false);
  assert.equal(legacyHarness.history[0].sourceConfigurationFingerprintStatus, 'LEGACY_UNBOUND_PRE_FINGERPRINT');
  assert.equal(Object.hasOwn(legacyHarness.history[0], 'sourceConfigurationFingerprint'), false);
  assert.equal(legacyHarness.dispatched.length, 1);
  const legacyStatus = await getManagedCodexLifecycle(legacyReplacementOperationId, lifecycleRequest, legacyHarness.dependencies);
  assert.equal(legacyStatus.lifecycleHistory[0].sourceConfigurationFingerprintStatus, 'LEGACY_UNBOUND_PRE_FINGERPRINT');
  assert.equal(Object.hasOwn(legacyStatus.lifecycleHistory[0], 'sourceConfigurationFingerprint'), false);
  await assert.rejects(
    startManagedCodexLifecycle(priorOperationId, lifecycleRequest, legacyHarness.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_ID_REUSED',
    'the completed legacy transition must not be replayed using its prior UUID',
  );

  const legacyPriorHistory = {
    eventType: 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED',
    priorOperationId,
    attemptCount: 2,
    terminalState: 'FAILED',
    sourceConfigurationFingerprintStatus: 'LEGACY_UNBOUND_PRE_FINGERPRINT',
    completedAt,
    terminalReconciledAt: legacyPriorLifecycle.terminalReconciledAt,
    supersededAt: '2026-09-23T10:02:00.000Z',
    replacementOperationId: '823e4567-e89b-42d3-a456-426614174007',
    priorLifecycle: structuredClone(legacyPriorLifecycle),
  };
  const alreadySupersededLegacy = createLifecycleHarness({
    lifecycle: structuredClone(legacyPriorLifecycle),
    history: [legacyPriorHistory],
    fingerprint: correctedFingerprint,
    supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
  });
  await assert.rejects(
    startManagedCodexLifecycle(replacementOperationId, lifecycleRequest, alreadySupersededLegacy.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_ALREADY_SUPERSEDED',
  );
  assert.equal(alreadySupersededLegacy.dispatched.length, 0);

  const legacyBlockedCases = [
    {
      label: 'uncertain legacy operation',
      lifecycle: { ...legacyPriorLifecycle, state: 'UNKNOWN' },
      supervisor: { operation: null, lastOperation: null, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
    },
    {
      label: 'requested legacy operation',
      lifecycle: { ...legacyPriorLifecycle, state: 'REQUESTED' },
      supervisor: { operation: null, lastOperation: null, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
    },
    {
      label: 'waiting-readiness legacy operation',
      lifecycle: { ...legacyPriorLifecycle, state: 'WAITING_READINESS' },
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'SUCCEEDED', completedAt }, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
    },
    {
      label: 'active legacy operation',
      lifecycle: legacyPriorLifecycle,
      supervisor: { operation: { operationId: priorOperationId, action: 'REBUILD_CODEX_BOOTSTRAP' }, lastOperation: null, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
    },
    {
      label: 'non-exhausted legacy operation',
      lifecycle: { ...legacyPriorLifecycle, attemptCount: 1 },
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_ATTEMPTS_REMAIN',
    },
    {
      label: 'contradictory legacy Supervisor outcome',
      lifecycle: legacyPriorLifecycle,
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'SUCCEEDED', completedAt }, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL',
    },
    {
      label: 'legacy-shaped record with an invalid fingerprint field',
      lifecycle: { ...legacyPriorLifecycle, sourceConfigurationFingerprint: 'not-a-digest' },
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNAVAILABLE',
    },
    {
      label: 'legacy-shaped record with an invalid prior operation identity',
      lifecycle: { ...legacyPriorLifecycle, operationId: 'not-a-uuid' },
      supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
      expectedCode: 'MANAGED_CODEX_LIFECYCLE_RECORD_INVALID',
    },
  ];
  for (const blocked of legacyBlockedCases) {
    const harness = createLifecycleHarness({
      lifecycle: structuredClone(blocked.lifecycle),
      fingerprint: correctedFingerprint,
      supervisor: blocked.supervisor,
    });
    await assert.rejects(
      startManagedCodexLifecycle(legacyReplacementOperationId, lifecycleRequest, harness.dependencies),
      (error) => error.code === blocked.expectedCode,
      blocked.label,
    );
    assert.equal(harness.dispatched.length, 0, `${blocked.label} must not dispatch`);
  }

  const fullHistory = Array.from({ length: 8 }, (_unused, index) => {
    const historyPriorId = `${String(index + 6).padStart(8, '0')}-489b-42d3-a456-426614174000`;
    return {
      ...priorHistoryEntry,
      priorOperationId: historyPriorId,
      replacementOperationId: `${String(index + 6).padStart(8, '0')}-489b-42d3-a456-426614174001`,
      priorLifecycle: { ...priorHistoryEntry.priorLifecycle, operationId: historyPriorId },
    };
  });
  const fullHistoryHarness = createLifecycleHarness({
    lifecycle: { operationId: priorOperationId, state: 'FAILED', attemptCount: 2, completedAt, terminalReconciledAt: completedAt, sourceConfigurationFingerprint: oldFingerprint },
    history: fullHistory,
    fingerprint: correctedFingerprint,
    supervisor: { operation: null, lastOperation: { operationId: priorOperationId, status: 'FAILED', completedAt }, services: [] },
  });
  await assert.rejects(
    startManagedCodexLifecycle(replacementOperationId, lifecycleRequest, fullHistoryHarness.dependencies),
    (error) => error.code === 'MANAGED_CODEX_LIFECYCLE_HISTORY_LIMIT',
  );
  assert.equal(fullHistoryHarness.history.length, 8, 'a full bounded history must fail closed without evicting evidence');
  assert.equal(fullHistoryHarness.dispatched.length, 0);
  console.log('✅ Managed Codex bootstrap and egress self-test passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
