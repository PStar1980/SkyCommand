'use strict';

const { resolveRuntimeControlAddress } = require('./index');

const SAFE_READINESS = new Set([
  'CURRENT',
  'INSTALLATION_UNCERTIFIED',
  'RUNTIME_INCOMPATIBLE',
  'PROTOCOL_INCOMPATIBLE',
  'RUNTIME_OFFLINE',
  'PROVIDER_UNREACHABLE',
  'MCP_UNREACHABLE',
]);
const SAFE_READINESS_CODES = new Set([
  'CODEX_APP_SERVER_NOT_INITIALIZED',
  'CODEX_OBSERVED_VERSION_UNAVAILABLE',
  'CODEX_VERSION_MISMATCH',
  'CODEX_OBSERVED_WRAPPER_PACKAGE_INTEGRITY_UNAVAILABLE',
  'CODEX_WRAPPER_PACKAGE_INTEGRITY_MISMATCH',
  'CODEX_OBSERVED_PACKAGE_INTEGRITY_UNAVAILABLE',
  'CODEX_PACKAGE_INTEGRITY_MISMATCH',
  'CODEX_PROTOCOL_SCHEMA_DIGEST_EXPECTED_MISSING',
  'CODEX_PROTOCOL_SCHEMA_DIGEST_MISSING',
  'CODEX_PROTOCOL_SCHEMA_DIGEST_MISMATCH',
  'CODEX_INSTALLED_ARTIFACT_ATTESTATION_UNAVAILABLE',
  'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED',
  'CODEX_CONTAINMENT_NON_ROOT_REQUIRED',
  'CODEX_CONTAINMENT_NO_NEW_PRIVILEGES_REQUIRED',
  'CODEX_CONTAINMENT_CAPABILITIES_NOT_DROPPED',
  'CODEX_CONTAINMENT_ROOT_FILESYSTEM_NOT_READ_ONLY',
  'CODEX_CONTAINMENT_MANAGED_HOME_MISSING',
  'CODEX_CONTAINMENT_RUNTIME_CONTROL_MOUNT_MISSING',
  'CODEX_CONTAINMENT_RUNTIME_CONTROL_MOUNT_NOT_READ_ONLY',
  'CODEX_CONTAINMENT_LIVE_CHECKOUT_MOUNT_PRESENT',
  'CODEX_CONTAINMENT_UNEXPECTED_MOUNT_PRESENT',
  'CODEX_CONTAINMENT_DOCKER_SOCKET_PRESENT',
  'CODEX_CONTAINMENT_GIT_AVAILABLE',
  'CODEX_CONTAINMENT_BROWSER_STATE_PRESENT',
  'CODEX_CONTAINMENT_PROHIBITED_CONFIGURATION_PRESENT',
  'CODEX_EGRESS_PROXY_UNAVAILABLE',
  'CODEX_MANAGED_MCP_UNAVAILABLE',
  'CODEX_RUNTIME_CURRENT',
  'CODEX_HEALTH_EVALUATION_FAILED',
]);
const SAFE_FAILED_CONDITIONS = new Set([
  'APP_SERVER_INITIALIZATION',
  'CODEX_IDENTITY',
  'CONTAINMENT',
  'EGRESS_PROXY',
  'MANAGED_MCP',
  'HEALTH_EVALUATION',
]);
const SAFE_TRANSPORT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);
const SAFE_IDENTITY_FIELDS = new Set([
  'observedCodexVersion',
  'observedWrapperPackageIntegrity',
  'observedPackageIntegrity',
  'observedProtocolSchemaDigest',
  'expectedProtocolSchemaDigest',
  'installedPackageManifest',
  'installedPackageLock',
  'artifactAttestation',
  'observedInstalledArtifactSha256',
]);

function safeReadinessDetails(payload = {}) {
  const failedUnexpectedMounts = payload.failedCondition === 'CONTAINMENT'
    && payload.readinessCode === 'CODEX_CONTAINMENT_UNEXPECTED_MOUNT_PRESENT';
  const unexpectedMountTargets = failedUnexpectedMounts && Array.isArray(payload.containment?.unexpectedMountTargets)
    ? [...new Set(payload.containment.unexpectedMountTargets.filter((target) => (
      typeof target === 'string'
      && target.length <= 160
      && /^\/[A-Za-z0-9._/-]+$/.test(target)
      && !target.split('/').includes('..')
    )))].slice(0, 8)
    : [];
  const identityMismatchFields = payload.failedCondition === 'CODEX_IDENTITY' && Array.isArray(payload.identityMismatchFields)
    ? [...new Set(payload.identityMismatchFields.filter((field) => SAFE_IDENTITY_FIELDS.has(field)))].slice(0, 8)
    : [];
  return {
    ...(SAFE_READINESS.has(payload.readiness) ? { readiness: payload.readiness } : {}),
    ...(SAFE_READINESS_CODES.has(payload.readinessCode) ? { readinessCode: payload.readinessCode } : {}),
    ...(SAFE_FAILED_CONDITIONS.has(payload.failedCondition) ? { failedCondition: payload.failedCondition } : {}),
    ...(unexpectedMountTargets.length ? { unexpectedMountTargets } : {}),
    ...(identityMismatchFields.length ? { identityMismatchFields } : {}),
  };
}

function writeFailure(output, diagnostic) {
  output.write(`${JSON.stringify({
    service: 'codex-agent-runtime-worker',
    probe: 'healthcheck',
    ok: false,
    ...diagnostic,
  })}\n`);
  return 1;
}

async function runHealthcheck({
  address,
  resolveAddress = resolveRuntimeControlAddress,
  port = process.env.CODEX_RUNTIME_CONTROL_PORT || 4219,
  fetcher = fetch,
  output = process.stderr,
} = {}) {
  let targetAddress = address;
  if (targetAddress === undefined) {
    try { targetAddress = await resolveAddress(); }
    catch (_error) {
      return writeFailure(output, { code: 'CODEX_HEALTHCHECK_CONTROL_BINDING_UNAVAILABLE' });
    }
  }
  if (!targetAddress) {
    return writeFailure(output, { code: 'CODEX_HEALTHCHECK_CONTROL_BINDING_UNAVAILABLE' });
  }

  let response;
  try {
    response = await fetcher(`http://${targetAddress}:${port}/health`, {
      signal: AbortSignal.timeout(7000),
    });
  } catch (error) {
    const transportCode = error?.cause?.code;
    return writeFailure(output, {
      code: 'CODEX_HEALTH_ENDPOINT_UNREACHABLE',
      ...(SAFE_TRANSPORT_CODES.has(transportCode) ? { transportCode } : {}),
    });
  }

  let payload;
  try { payload = await response.json(); }
  catch (_error) {
    return writeFailure(output, {
      code: response.ok ? 'CODEX_HEALTH_ENDPOINT_RESPONSE_INVALID' : 'CODEX_HEALTH_ENDPOINT_HTTP_ERROR',
      ...(Number.isInteger(response.status) ? { httpStatus: response.status } : {}),
    });
  }

  if (response.ok && payload?.ok === true) return 0;
  return writeFailure(output, {
    code: response.ok ? 'CODEX_HEALTHCHECK_READINESS_FAILED' : 'CODEX_HEALTH_ENDPOINT_HTTP_ERROR',
    ...(Number.isInteger(response.status) ? { httpStatus: response.status } : {}),
    ...safeReadinessDetails(payload),
  });
}

if (require.main === module) {
  runHealthcheck().then((exitCode) => { process.exitCode = exitCode; }).catch(() => {
    process.stderr.write(`${JSON.stringify({
      service: 'codex-agent-runtime-worker',
      probe: 'healthcheck',
      ok: false,
      code: 'CODEX_HEALTHCHECK_FAILED',
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  runHealthcheck,
  safeReadinessDetails,
};
