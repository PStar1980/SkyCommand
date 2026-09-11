import api from './api';

const LAST_BROWSER_TEST_RUN_KEY = 'skycommand.browserTests.lastRunWorkflowId';

async function listTests(filters = {}) {
  return api.get('/api/browser-tests', { query: filters });
}

async function getTest(testCode) {
  return api.get(`/api/browser-tests/${encodeURIComponent(testCode)}`);
}

async function runTest(testCode, payload = {}) {
  return api.post(`/api/browser-tests/${encodeURIComponent(testCode)}/run`, payload);
}

async function listRuns(filters = {}) {
  return api.get('/api/browser-tests/runs', { query: filters });
}

async function getRun(workflowId) {
  return api.get(`/api/browser-tests/runs/${encodeURIComponent(workflowId)}`);
}

async function createReportView(workflowId, artifactId) {
  return api.post(
    `/api/browser-tests/runs/${encodeURIComponent(workflowId)}/artifacts/${encodeURIComponent(artifactId)}/report-view`,
    {},
  );
}

async function getArtifact(workflowId, artifactId) {
  return api.blob(
    `/api/browser-tests/runs/${encodeURIComponent(workflowId)}/artifacts/${encodeURIComponent(artifactId)}`,
  );
}

async function getAdminOptions() {
  return api.get('/api/admin/browser-tests/options');
}

async function listAdminTests(filters = {}) {
  return api.get('/api/admin/browser-tests', { query: filters });
}

async function getAdminTest(testId) {
  return api.get(`/api/admin/browser-tests/${encodeURIComponent(testId)}`);
}

async function createAdminTest(payload) {
  return api.post('/api/admin/browser-tests', payload);
}

async function updateAdminTest(testId, payload) {
  return api.patch(`/api/admin/browser-tests/${encodeURIComponent(testId)}`, payload);
}

async function updateAdminTestStatus(testId, enabled) {
  return api.patch(`/api/admin/browser-tests/${encodeURIComponent(testId)}/status`, { enabled });
}

async function replaceAdminTestParameters(testId, parameters) {
  return api.put(`/api/admin/browser-tests/${encodeURIComponent(testId)}/parameters`, { parameters });
}

async function replaceAdminTestEnvironments(testId, environmentCodes) {
  return api.put(`/api/admin/browser-tests/${encodeURIComponent(testId)}/environments`, {
    environmentCodes,
  });
}


async function listSuites(filters = {}) {
  return api.get('/api/browser-test-suites', { query: filters });
}

async function getSuite(suiteCode) {
  return api.get(`/api/browser-test-suites/${encodeURIComponent(suiteCode)}`);
}

async function runSuite(suiteCode, payload = {}) {
  return api.post(`/api/browser-test-suites/${encodeURIComponent(suiteCode)}/run`, payload);
}

async function listSuiteRuns(filters = {}) {
  return api.get('/api/browser-test-suites/runs', { query: filters });
}

async function getSuiteRun(workflowId) {
  return api.get(`/api/browser-test-suites/runs/${encodeURIComponent(workflowId)}`);
}

function setLastRunWorkflowId(workflowId) {
  if (!workflowId) {
    window.sessionStorage.removeItem(LAST_BROWSER_TEST_RUN_KEY);
    return;
  }
  window.sessionStorage.setItem(LAST_BROWSER_TEST_RUN_KEY, String(workflowId));
}

function getLastRunWorkflowId() {
  return window.sessionStorage.getItem(LAST_BROWSER_TEST_RUN_KEY) || '';
}

const browserTestService = {
  createAdminTest,
  createReportView,
  getAdminOptions,
  getAdminTest,
  getArtifact,
  getLastRunWorkflowId,
  getRun,
  getSuite,
  getSuiteRun,
  getTest,
  listAdminTests,
  listRuns,
  listSuiteRuns,
  listSuites,
  listTests,
  replaceAdminTestEnvironments,
  replaceAdminTestParameters,
  runTest,
  runSuite,
  setLastRunWorkflowId,
  updateAdminTest,
  updateAdminTestStatus,
};

export default browserTestService;
