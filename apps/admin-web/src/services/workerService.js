import api from './api';

function getHealth() {
  return api.get('/api/worker/health');
}

function listTools() {
  return api.get('/api/worker/tools');
}

function listNodes(filters = {}) {
  return api.get('/api/worker/nodes', { query: filters });
}

function listSchedules(filters = {}) {
  return api.get('/api/worker/schedules', { query: filters });
}

function getSchedule(scheduleId) {
  return api.get(`/api/worker/schedules/${encodeURIComponent(scheduleId)}`);
}

function createSchedule(payload) {
  return api.post('/api/worker/schedules', payload);
}

function updateSchedule(scheduleId, payload) {
  return api.patch(`/api/worker/schedules/${encodeURIComponent(scheduleId)}`, payload);
}

function updateScheduleStatus(scheduleId, enabled) {
  return api.patch(`/api/worker/schedules/${encodeURIComponent(scheduleId)}/status`, { enabled });
}

function runScheduleNow(scheduleId) {
  return api.post(`/api/worker/schedules/${encodeURIComponent(scheduleId)}/run-now`, {});
}

function listRuns(filters = {}) {
  return api.get('/api/worker/runs', { query: filters });
}

function listRunsForSchedule(scheduleId, filters = {}) {
  return api.get(`/api/worker/schedules/${encodeURIComponent(scheduleId)}/runs`, {
    query: filters,
  });
}

function listListeners(filters = {}) {
  return api.get('/api/worker/listeners', { query: filters });
}

function getListener(listenerId) {
  return api.get(`/api/worker/listeners/${encodeURIComponent(listenerId)}`);
}

function createListener(payload) {
  return api.post('/api/worker/listeners', payload);
}

function updateListener(listenerId, payload) {
  return api.patch(`/api/worker/listeners/${encodeURIComponent(listenerId)}`, payload);
}

function updateListenerStatus(listenerId, enabled) {
  return api.patch(`/api/worker/listeners/${encodeURIComponent(listenerId)}/status`, { enabled });
}

function listListenerEvents(filters = {}) {
  return api.get('/api/worker/listener-events', { query: filters });
}

function listEventsForListener(listenerId, filters = {}) {
  return api.get(`/api/worker/listeners/${encodeURIComponent(listenerId)}/events`, {
    query: filters,
  });
}

const workerService = {
  getHealth,
  listTools,
  listNodes,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  updateScheduleStatus,
  runScheduleNow,
  listRuns,
  listRunsForSchedule,
  listListeners,
  getListener,
  createListener,
  updateListener,
  updateListenerStatus,
  listListenerEvents,
  listEventsForListener,
};

export default workerService;
