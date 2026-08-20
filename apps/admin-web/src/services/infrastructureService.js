import api from './api';

function getDockerOverview() {
  return api.get('/api/infrastructure/providers/docker/overview');
}

const infrastructureService = {
  getDockerOverview,
};

export default infrastructureService;
