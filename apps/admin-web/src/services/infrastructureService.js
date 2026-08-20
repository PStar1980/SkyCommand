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


async function streamDockerEvents(options = {}) {
  return api.stream('/api/infrastructure/providers/docker/events/stream', options);
}

async function listDockerOperations(filters = {}) {
  return api.get('/api/infrastructure/providers/docker/operations', { query: filters });
}

export default {
  controlDockerComposeProject,
  controlDockerContainer,
  getDockerContainerDetail,
  getDockerOverview,
  listDockerOperations,
  streamDockerEvents,
};
