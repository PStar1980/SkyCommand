import api from './api';

async function getStatusSummary(filters = {}) {
  return api.get('/api/ingestion/status', { query: filters });
}

async function listTools(filters = {}) {
  return api.get('/api/ingestion/tools', { query: filters });
}

async function listSources() {
  return api.get('/api/ingestion/sources');
}

async function getSource(source) {
  return api.get(`/api/ingestion/sources/${source}`);
}

async function listRecentExecutions(filters = {}) {
  return api.get('/api/ingestion/recent', { query: filters });
}

async function listIndicatorStatuses(filters = {}) {
  return api.get('/api/ingestion/indicators', { query: filters });
}

async function getIndicatorStatus(indicatorCode) {
  return api.get(`/api/ingestion/indicators/${indicatorCode}/status`);
}

const ingestionService = {
  getStatusSummary,
  listTools,
  listSources,
  getSource,
  listRecentExecutions,
  listIndicatorStatuses,
  getIndicatorStatus,
};

export default ingestionService;
