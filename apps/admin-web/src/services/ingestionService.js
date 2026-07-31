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


async function listFreshnessPolicies(filters = {}) {
  return api.get('/api/ingestion/catalogue/admin/freshness/policies', { query: filters });
}

async function saveSourceFreshnessPolicy(domainCode, sourceCode, frequencyCode, payload) {
  return api.put(
    `/api/ingestion/catalogue/admin/freshness/source-policies/${domainCode}/${sourceCode}/${frequencyCode}`,
    payload,
  );
}

async function saveAssetFreshnessPolicy(domainCode, assetCode, payload) {
  return api.put(
    `/api/ingestion/catalogue/admin/freshness/asset-policies/${domainCode}/${assetCode}`,
    payload,
  );
}

const ingestionService = {
  getStatusSummary,
  listTools,
  listSources,
  getSource,
  listRecentExecutions,
  listIndicatorStatuses,
  getIndicatorStatus,
  saveAssetFreshnessPolicy,
  saveSourceFreshnessPolicy,
  listFreshnessPolicies,
};

export default ingestionService;
