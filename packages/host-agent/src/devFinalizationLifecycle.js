const path = require('node:path');

const { getSupervisorConfig } = require('../../supervisor/src/config');
const {
  FINALIZATION_REBUILD_SERVICES,
  rebuildServices,
  normalizeFinalizationServices,
} = require('../../supervisor/src/runtimeLifecycle');

const REPOSITORY_CODE = 'SkyCommand';
const ACTION = 'REBUILD_SERVICES';

class DevFinalizationLifecycleError extends Error {
  constructor(message, code = 'SKYCOMMAND_DEV_FINALIZATION_LIFECYCLE_FAILED', details = {}) {
    super(message);
    this.name = 'DevFinalizationLifecycleError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

async function executeDevFinalizationLifecycle(input = {}) {
  if (normalizeText(input.repoCode) !== REPOSITORY_CODE) {
    throw new DevFinalizationLifecycleError(
      'R5 finalization lifecycle is bound to the SkyCommand repository.',
      'SKYCOMMAND_DEV_FINALIZATION_REPOSITORY_INVALID',
    );
  }
  if (normalizeText(input.action).toUpperCase() !== ACTION) {
    throw new DevFinalizationLifecycleError(
      'R5 finalization lifecycle action is fixed to REBUILD_SERVICES.',
      'SKYCOMMAND_DEV_FINALIZATION_ACTION_INVALID',
    );
  }

  let services = input.services;
  if (typeof services === 'string') {
    try {
      services = JSON.parse(services);
    } catch (_error) {
      throw new DevFinalizationLifecycleError(
        'R5 finalization service list is not valid JSON.',
        'SKYCOMMAND_DEV_FINALIZATION_SERVICES_INVALID',
      );
    }
  }

  let normalizedServices;
  try {
    normalizedServices = normalizeFinalizationServices(services);
  } catch (error) {
    throw new DevFinalizationLifecycleError(
      'R5 finalization service list is outside the fixed allowlist.',
      error.code || 'SKYCOMMAND_DEV_FINALIZATION_SERVICES_INVALID',
      error.details || {},
    );
  }

  const repositoryRoot = path.resolve(__dirname, '../../..');
  const config = getSupervisorConfig(repositoryRoot);
  const result = await rebuildServices(config, normalizedServices);
  return {
    providerCode: 'SKYCOMMAND_SUPERVISOR',
    repositoryCode: REPOSITORY_CODE,
    action: ACTION,
    services: normalizedServices,
    allowedServices: [...FINALIZATION_REBUILD_SERVICES],
    executionTarget: 'HOST',
    transport: 'temporal_host_agent',
    ...result,
  };
}

module.exports = {
  ACTION,
  FINALIZATION_REBUILD_SERVICES,
  DevFinalizationLifecycleError,
  REPOSITORY_CODE,
  executeDevFinalizationLifecycle,
};
