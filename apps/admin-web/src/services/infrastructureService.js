import api from './api';

async function getDockerOverview() {
  return api.get('/api/infrastructure/providers/docker/overview');
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

async function listDockerOperations(filters = {}) {
  return api.get('/api/infrastructure/providers/docker/operations', { query: filters });
}

export default {
  controlDockerComposeProject,
  getDockerOverview,
  listDockerOperations,
};
