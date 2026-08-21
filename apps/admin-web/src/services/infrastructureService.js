import api from './api';

async function getDockerOverview() {
  return api.get('/api/infrastructure/providers/docker/overview');
}

async function getDockerContainerDetail(containerId, { tail = 200 } = {}) {
  return api.get(
    `/api/infrastructure/providers/docker/containers/${encodeURIComponent(containerId)}`,
    { query: { tail } },
  );
}

async function controlDockerContainer(containerId, action) {
  return api.post(
    `/api/infrastructure/providers/docker/containers/${encodeURIComponent(containerId)}/actions`,
    {
      action,
      confirmed: true,
    },
  );
}

async function controlDockerComposeProject(projectName, action) {
  return api.post(
    `/api/infrastructure/providers/docker/projects/${encodeURIComponent(projectName)}/actions`,
    {
      action,
      confirmed: true,
    },
  );
}



async function getDockerResourceDetail(resourceType, reference) {
  const pathByType = {
    IMAGE: 'images',
    VOLUME: 'volumes',
    NETWORK: 'networks',
  };
  const path = pathByType[String(resourceType || '').toUpperCase()];
  if (!path) throw new Error('Unsupported Docker resource type.');
  return api.get(`/api/infrastructure/providers/docker/${path}/${encodeURIComponent(reference)}`);
}

async function controlDockerResource(resourceType, reference, action) {
  const pathByType = { IMAGE: 'images', NETWORK: 'networks' };
  const path = pathByType[String(resourceType || '').toUpperCase()];
  if (!path) throw new Error('Docker cleanup is not available for this resource type.');
  return api.post(
    `/api/infrastructure/providers/docker/${path}/${encodeURIComponent(reference)}/actions`,
    { action, confirmed: true },
  );
}

async function streamDockerEvents(options = {}) {
  return api.stream('/api/infrastructure/providers/docker/events/stream', options);
}

async function streamDockerTelemetry(options = {}) {
  return api.stream('/api/infrastructure/providers/docker/telemetry/stream', options);
}

async function listDockerOperations(filters = {}) {
  return api.get('/api/infrastructure/providers/docker/operations', { query: filters });
}

export default {
  controlDockerComposeProject,
  controlDockerContainer,
  controlDockerResource,
  getDockerContainerDetail,
  getDockerResourceDetail,
  getDockerOverview,
  listDockerOperations,
  streamDockerEvents,
  streamDockerTelemetry,
};
