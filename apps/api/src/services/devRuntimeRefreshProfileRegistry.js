const { AGENT_SESSION_RUNTIME_REBUILD_SERVICES, CODEX_BOOTSTRAP_REBUILD_SERVICES } = require('../../../../packages/supervisor/src/config');

const DEV_RUNTIME_REFRESH_PERMISSION = 'DEV_RUNTIME_LIFECYCLE';
const DEV_RUNTIME_REFRESH_CAPABILITY = 'skycommand_dev_runtime_refresh';
const DEV_RUNTIME_REFRESH_AGENT_ID = 'codex-local';
const DEV_RUNTIME_REFRESH_REPOSITORY = 'SkyCommand';
const DEV_RUNTIME_REFRESH_ENVIRONMENT = 'DEV_LOCAL';
const DEV_RUNTIME_REFRESH_LIFECYCLE_PROFILE = 'DEV_LOCAL';
const DEV_RUNTIME_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH = 200;

const PROFILE_DEFINITIONS = Object.freeze({
  CODEX_BOOTSTRAP: Object.freeze({
    profileCode: 'CODEX_BOOTSTRAP',
    action: 'REBUILD_CODEX_BOOTSTRAP',
    supervisorPath: '/runtime/rebuild-codex-bootstrap',
    targetService: 'codex-managed-bootstrap',
    repositoryCode: DEV_RUNTIME_REFRESH_REPOSITORY,
    environmentCode: DEV_RUNTIME_REFRESH_ENVIRONMENT,
    lifecycleProfileCode: DEV_RUNTIME_REFRESH_LIFECYCLE_PROFILE,
    affectedServices: Object.freeze([...CODEX_BOOTSTRAP_REBUILD_SERVICES]),
    reconciliationEvidence: Object.freeze(['SUPERVISOR_OPERATION', 'REGISTERED_SERVICE_RUNTIME']),
    oneShotServices: Object.freeze(['codex-managed-volume-init']),
    healthOptionalServices: Object.freeze([]),
  }),
  TEMPORAL_WORKER: Object.freeze({
    profileCode: 'TEMPORAL_WORKER',
    action: 'REBUILD_TEMPORAL_WORKER',
    supervisorPath: '/runtime/rebuild-temporal-worker',
    targetService: 'temporal-worker',
    repositoryCode: DEV_RUNTIME_REFRESH_REPOSITORY,
    environmentCode: DEV_RUNTIME_REFRESH_ENVIRONMENT,
    lifecycleProfileCode: DEV_RUNTIME_REFRESH_LIFECYCLE_PROFILE,
    affectedServices: Object.freeze(['temporal-worker']),
    reconciliationEvidence: Object.freeze([
      'SUPERVISOR_OPERATION',
      'TEMPORAL_HEARTBEAT',
      'TEMPORAL_POLLER',
    ]),
    oneShotServices: Object.freeze([]),
    healthOptionalServices: Object.freeze([]),
  }),
  AGENT_SESSION_RUNTIME: Object.freeze({
    profileCode: 'AGENT_SESSION_RUNTIME',
    action: 'REBUILD_AGENT_SESSION_RUNTIME',
    supervisorPath: '/runtime/rebuild-agent-session-runtime',
    targetService: 'agent-session-runtime',
    repositoryCode: DEV_RUNTIME_REFRESH_REPOSITORY,
    environmentCode: DEV_RUNTIME_REFRESH_ENVIRONMENT,
    lifecycleProfileCode: DEV_RUNTIME_REFRESH_LIFECYCLE_PROFILE,
    affectedServices: Object.freeze([...AGENT_SESSION_RUNTIME_REBUILD_SERVICES]),
    reconciliationEvidence: Object.freeze(['SUPERVISOR_OPERATION', 'REGISTERED_SERVICE_RUNTIME']),
    oneShotServices: Object.freeze([]),
    healthOptionalServices: Object.freeze(['node-worker']),
  }),
});

function normalizeProfileCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getDevRuntimeRefreshProfile(value) {
  const profileCode = normalizeProfileCode(value);
  const profile = PROFILE_DEFINITIONS[profileCode];
  if (!profile) return null;
  return {
    ...profile,
    affectedServices: [...profile.affectedServices],
    reconciliationEvidence: [...profile.reconciliationEvidence],
    oneShotServices: [...profile.oneShotServices],
    healthOptionalServices: [...profile.healthOptionalServices],
  };
}

function listDevRuntimeRefreshProfiles() {
  return Object.keys(PROFILE_DEFINITIONS).map((profileCode) =>
    getDevRuntimeRefreshProfile(profileCode),
  );
}

module.exports = {
  DEV_RUNTIME_REFRESH_AGENT_ID,
  DEV_RUNTIME_REFRESH_CAPABILITY,
  DEV_RUNTIME_REFRESH_ENVIRONMENT,
  DEV_RUNTIME_REFRESH_LIFECYCLE_PROFILE,
  DEV_RUNTIME_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH,
  DEV_RUNTIME_REFRESH_PERMISSION,
  DEV_RUNTIME_REFRESH_REPOSITORY,
  getDevRuntimeRefreshProfile,
  listDevRuntimeRefreshProfiles,
  normalizeProfileCode,
};
