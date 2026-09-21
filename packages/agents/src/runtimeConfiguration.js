const { sha256Digest } = require('./canonical');

const RUNTIME_FRESHNESS_STATUSES = Object.freeze([
  'CURRENT',
  'STALE_RECONCILABLE',
  'STALE_BLOCKED',
  'UNKNOWN',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeRuntimeConfigurationIdentity(input = {}) {
  const runtimeInstallationId = text(input.runtimeInstallationId || input.installationId, 'UNREGISTERED');
  const configurationRevision = text(input.configurationRevision, 'UNKNOWN');
  const capabilityManifestRevision = text(input.capabilityManifestRevision, 'UNKNOWN');
  const configurationDigest = text(input.configurationDigest) || sha256Digest({
    runtimeInstallationId,
    configurationRevision,
    capabilityManifestRevision,
    runtimeProfile: text(input.runtimeProfile, 'UNKNOWN'),
  });
  const capabilityManifestDigest = text(input.capabilityManifestDigest) || sha256Digest({
    runtimeInstallationId,
    capabilityManifestRevision,
  });
  const freshnessStatus = RUNTIME_FRESHNESS_STATUSES.includes(input.freshnessStatus)
    ? input.freshnessStatus
    : 'UNKNOWN';

  return {
    contract: 'agent_runtime_configuration_identity.v1',
    runtimeInstallationId,
    reviewedSourceRevision: input.reviewedSourceRevision ? text(input.reviewedSourceRevision) : null,
    configurationRevision,
    configurationDigest,
    capabilityManifestRevision,
    capabilityManifestDigest,
    runtimeProfile: text(input.runtimeProfile, 'UNKNOWN'),
    processGeneration: input.processGeneration ? text(input.processGeneration) : null,
    serviceGeneration: input.serviceGeneration ? text(input.serviceGeneration) : null,
    processStartedAt: input.processStartedAt || null,
    observedAt: input.observedAt || null,
    freshnessStatus,
    evidence: input.evidence && typeof input.evidence === 'object' ? { ...input.evidence } : null,
  };
}

function normalizeCapabilities(value) {
  const capabilities = Array.isArray(value)
    ? value
    : Array.isArray(value?.scope?.capabilities)
      ? value.scope.capabilities
      : Array.isArray(value?.capabilities)
        ? value.capabilities
        : [];
  return [...new Set(capabilities.map((capability) => String(capability || '').trim()).filter(Boolean))].sort();
}

function evaluateRuntimeCompatibility({ installation = {}, requiredCapabilities = [] } = {}) {
  const required = normalizeCapabilities(requiredCapabilities);
  const declared = normalizeCapabilities(installation.capabilityManifest || installation.manifestCapabilities);
  const reasons = [];

  if (installation.enabled !== true) reasons.push('RUNTIME_INSTALLATION_DISABLED');
  if (installation.certificationState !== 'CERTIFIED') reasons.push('RUNTIME_NOT_CERTIFIED');
  if (installation.executionEnabled !== false) reasons.push('RUNTIME_EXECUTION_FLAG_INVALID');
  if (installation.freshnessStatus !== 'CURRENT') reasons.push(`RUNTIME_FRESHNESS_${installation.freshnessStatus || 'UNKNOWN'}`);

  const missingCapabilities = required.filter((capability) => !declared.includes(capability));
  if (missingCapabilities.length > 0) reasons.push('RUNTIME_CAPABILITY_NOT_DECLARED');

  return {
    contract: 'agent_runtime_compatibility.v1',
    compatible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    requiredCapabilities: required,
    declaredCapabilities: declared,
    missingCapabilities,
    executionEnabled: false,
    phase: '19.1',
  };
}

function runtimeEligibility({ installation = {}, account = {}, requiredCapabilities = [] } = {}) {
  const compatibility = evaluateRuntimeCompatibility({ installation, requiredCapabilities });
  const reasons = [...compatibility.reasons];
  if (account.accountState !== 'CONFIGURED') reasons.push('RUNTIME_ACCOUNT_NOT_CONFIGURED');
  if (account.executionEnabled !== false) reasons.push('ACCOUNT_EXECUTION_FLAG_INVALID');

  return {
    eligible: reasons.length === 0,
    runtimeCompatible: compatibility.compatible,
    reasons: [...new Set(reasons)],
    executionEnabled: false,
    phase: '19.1',
  };
}

function safeRuntimeInstallation(row = {}) {
  return {
    installationId: row.installationId || row.installation_id || null,
    installationCode: row.installationCode || row.installation_code || null,
    runtimeCode: row.runtimeCode || row.runtime_code || null,
    runtimeName: row.runtimeName || row.runtime_name || null,
    adapterVersion: row.adapterVersion || row.adapter_version || null,
    protocolSchemaDigest: row.protocolSchemaDigest || row.protocol_schema_digest || null,
    capabilityManifestRevision: row.capabilityManifestRevision || row.capability_manifest_revision || null,
    capabilityManifestDigest: row.capabilityManifestDigest || row.capability_manifest_digest || null,
    runtimeProfile: row.runtimeProfile || row.runtime_profile || null,
    containmentClass: row.containmentClass || row.containment_class || null,
    certificationState: row.certificationState || row.certification_state || 'UNVERIFIED',
    enabled: row.enabled === true,
    executionEnabled: false,
    configurationRevision: row.configurationRevision || row.configuration_revision || null,
    configurationDigest: row.configurationDigest || row.configuration_digest || null,
    processGeneration: row.processGeneration || row.process_generation || null,
    serviceGeneration: row.serviceGeneration || row.service_generation || null,
    observedAt: row.observedAt || row.observed_at || null,
    freshnessStatus: row.freshnessStatus || row.freshness_status || 'UNKNOWN',
  };
}

module.exports = {
  RUNTIME_FRESHNESS_STATUSES,
  evaluateRuntimeCompatibility,
  normalizeRuntimeConfigurationIdentity,
  runtimeEligibility,
  safeRuntimeInstallation,
};
