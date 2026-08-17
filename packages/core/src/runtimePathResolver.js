const path = require('node:path');

const DEFAULT_CONTAINER_WORKSPACE_ROOT = '/workspace/SkyEco System';
const SKY_ECO_MARKER = '/skyeco system';

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function trimTrailingSlash(value) {
  const normalized = normalizeSlashes(value).trim();
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function isDockerRuntime(environment = process.env, profileCode = null) {
  const runtime = String(environment.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase();
  const profile = String(
    profileCode ||
      environment.SKYCOMMAND_CONFIG_PROFILE ||
      environment.SKYSERVER_CONFIG_PROFILE ||
      '',
  )
    .trim()
    .toUpperCase();

  return runtime === 'docker' || profile === 'DOCKER_LOCAL';
}

function translateWorkspacePath(value, options = {}) {
  if (value === undefined || value === null || value === '') {
    return value;
  }

  const environment = options.environment || process.env;
  const profileCode = options.profileCode || null;
  if (!isDockerRuntime(environment, profileCode)) {
    return value;
  }

  const normalizedValue = normalizeSlashes(value).trim();
  const containerRoot = trimTrailingSlash(
    environment.SKYCOMMAND_DOCKER_CONTAINER_WORKSPACE_ROOT || DEFAULT_CONTAINER_WORKSPACE_ROOT,
  );
  const normalizedContainerRoot = containerRoot.toLowerCase();

  if (normalizedValue.toLowerCase() === normalizedContainerRoot) {
    return containerRoot;
  }
  if (normalizedValue.toLowerCase().startsWith(`${normalizedContainerRoot}/`)) {
    return `${containerRoot}${normalizedValue.slice(containerRoot.length)}`;
  }

  const configuredHostRoot = trimTrailingSlash(
    environment.SKYCOMMAND_DOCKER_HOST_WORKSPACE_ROOT ||
      environment.SKYCOMMAND_DOCKER_WORKSPACE_ROOT ||
      '',
  );
  if (configuredHostRoot) {
    const lowerValue = normalizedValue.toLowerCase();
    const lowerHostRoot = configuredHostRoot.toLowerCase();
    if (lowerValue === lowerHostRoot || lowerValue.startsWith(`${lowerHostRoot}/`)) {
      return `${containerRoot}${normalizedValue.slice(configuredHostRoot.length)}`;
    }
  }

  const markerIndex = normalizedValue.toLowerCase().indexOf(SKY_ECO_MARKER);
  if (markerIndex >= 0) {
    return `${containerRoot}${normalizedValue.slice(markerIndex + SKY_ECO_MARKER.length)}`;
  }

  return value;
}

function resolveRuntimePath(value, options = {}) {
  const translated = translateWorkspacePath(value, options);
  return translated ? path.resolve(String(translated)) : translated;
}

module.exports = {
  DEFAULT_CONTAINER_WORKSPACE_ROOT,
  isDockerRuntime,
  normalizeSlashes,
  resolveRuntimePath,
  translateWorkspacePath,
};
