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

async function listCatalogueDomains(filters = {}) {
  return api.get('/api/ingestion/catalogue/domains', { query: filters });
}

async function listCatalogueSources(filters = {}) {
  return api.get('/api/ingestion/catalogue/sources', { query: filters });
}

async function listCatalogueAssets(filters = {}) {
  return api.get('/api/ingestion/catalogue/assets', { query: filters });
}

async function getCatalogueAsset(domainCode, assetCode) {
  return api.get(`/api/ingestion/catalogue/assets/${domainCode}/${assetCode}`);
}

async function listAssetObservations(domainCode, assetCode, filters = {}) {
  return api.get(
    `/api/ingestion/catalogue/assets/${domainCode}/${assetCode}/observations`,
    { query: filters },
  );
}

async function listCatalogueMetrics(filters = {}) {
  return api.get('/api/ingestion/catalogue/metrics', { query: filters });
}

async function getCatalogueMetric(domainCode, metricCode) {
  return api.get(`/api/ingestion/catalogue/metrics/${domainCode}/${metricCode}`);
}

async function listMetricObservations(domainCode, metricCode, filters = {}) {
  return api.get(
    `/api/ingestion/catalogue/metrics/${domainCode}/${metricCode}/observations`,
    { query: filters },
  );
}

async function listIngestionRuns(filters = {}) {
  return api.get('/api/ingestion/runs', { query: filters });
}

async function getIngestionRun(ingestionRunId) {
  return api.get(`/api/ingestion/runs/${ingestionRunId}`);
}

async function listRecoveryRequests(filters = {}) {
  return api.get('/api/ingestion/recoveries', { query: filters });
}

async function getRecoveryRequest(recoveryRequestId) {
  return api.get(`/api/ingestion/recoveries/${recoveryRequestId}`);
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
  listCatalogueDomains,
  listCatalogueSources,
  listCatalogueAssets,
  getCatalogueAsset,
  listAssetObservations,
  listCatalogueMetrics,
  getCatalogueMetric,
  listMetricObservations,
  listIngestionRuns,
  getIngestionRun,
  listRecoveryRequests,
  getRecoveryRequest,
  saveAssetFreshnessPolicy,
  saveSourceFreshnessPolicy,
  listFreshnessPolicies,
};

export default ingestionService;
