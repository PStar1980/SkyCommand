const DEFAULT_TEMPORAL_ADDRESS = 'localhost:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'skyserver-local';
const DEFAULT_FRED_WORKFLOW_ID_PREFIX = 'skyserver-fred-ingestion';
const DEFAULT_TEMPORAL_UI_BASE_URL = 'http://localhost:8233';

function getTemporalConfig() {
  return {
    address: process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS,
    namespace: process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE,
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE,
    fredWorkflowIdPrefix:
      process.env.TEMPORAL_FRED_WORKFLOW_ID_PREFIX || DEFAULT_FRED_WORKFLOW_ID_PREFIX,
    uiBaseUrl: process.env.TEMPORAL_UI_BASE_URL || DEFAULT_TEMPORAL_UI_BASE_URL,
  };
}

function parsePositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  if (Number.isFinite(max) && max > 0) {
    return Math.min(parsed, max);
  }

  return parsed;
}

module.exports = {
  DEFAULT_TEMPORAL_ADDRESS,
  DEFAULT_TEMPORAL_NAMESPACE,
  DEFAULT_TEMPORAL_TASK_QUEUE,
  DEFAULT_FRED_WORKFLOW_ID_PREFIX,
  DEFAULT_TEMPORAL_UI_BASE_URL,
  getTemporalConfig,
  parsePositiveInteger,
};
