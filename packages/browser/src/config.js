const path = require('node:path');

const DEFAULT_BROWSER_TASK_QUEUE = 'skycommand-browser-local';
const DEFAULT_BROWSER_EXECUTION_TIMEOUT_MS = 600000;
const DEFAULT_BROWSER_WORKER_MAX_CONCURRENT_ACTIVITIES = 1;
const DEFAULT_BROWSER_WORKER_MAX_CONCURRENT_WORKFLOW_TASKS = 10;
const DEFAULT_BROWSER_WORKER_HEARTBEAT_INTERVAL_MS = 10000;
const DEFAULT_BROWSER_WORKER_HEALTH_FRESHNESS_MS = 45000;
const DEFAULT_BROWSER_WORKER_HEALTH_FILE = '/tmp/skycommand-browser-worker-health.json';
const DEFAULT_BROWSER_TEST_CONFIG = 'tests/browser/playwright.config.js';
const DEFAULT_BROWSER_ARTIFACT_RELATIVE_ROOT = 'artifacts/browser/tests';

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function parsePositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Number.isFinite(max) && max > 0 ? Math.min(parsed, max) : parsed;
}

function getBrowserRuntimeConfig(repositoryRoot = process.cwd()) {
  const root = path.resolve(repositoryRoot);
  const heartbeatIntervalMs = parsePositiveInteger(
    process.env.SKYCOMMAND_BROWSER_WORKER_HEARTBEAT_INTERVAL_MS,
    DEFAULT_BROWSER_WORKER_HEARTBEAT_INTERVAL_MS,
    60000,
  );

  const sourceRepositoryRoot = path.resolve(
    normalizeText(process.env.SKYCOMMAND_BROWSER_SOURCE_REPOSITORY_ROOT, root),
  );
  const artifactRoot = path.resolve(
    normalizeText(
      process.env.SKYCOMMAND_BROWSER_ARTIFACT_ROOT,
      path.join(sourceRepositoryRoot, DEFAULT_BROWSER_ARTIFACT_RELATIVE_ROOT),
    ),
  );

  return {
    repositoryRoot: root,
    sourceRepositoryRoot,
    artifactRoot,
    temporalAddress: normalizeText(process.env.TEMPORAL_ADDRESS, 'localhost:7233'),
    temporalNamespace: normalizeText(process.env.TEMPORAL_NAMESPACE, 'default'),
    taskQueue: normalizeText(process.env.SKYCOMMAND_BROWSER_TASK_QUEUE, DEFAULT_BROWSER_TASK_QUEUE),
    baseUrl: normalizeText(
      process.env.SKYCOMMAND_BROWSER_BASE_URL,
      'http://127.0.0.1:15171',
    ),
    testConfigPath: normalizeText(
      process.env.SKYCOMMAND_BROWSER_TEST_CONFIG,
      DEFAULT_BROWSER_TEST_CONFIG,
    ),
    executionTimeoutMs: parsePositiveInteger(
      process.env.SKYCOMMAND_BROWSER_EXECUTION_TIMEOUT_MS,
      DEFAULT_BROWSER_EXECUTION_TIMEOUT_MS,
      3600000,
    ),
    maxConcurrentActivities: parsePositiveInteger(
      process.env.SKYCOMMAND_BROWSER_WORKER_MAX_CONCURRENT_ACTIVITIES,
      DEFAULT_BROWSER_WORKER_MAX_CONCURRENT_ACTIVITIES,
      8,
    ),
    maxConcurrentWorkflowTasks: parsePositiveInteger(
      process.env.SKYCOMMAND_BROWSER_WORKER_MAX_CONCURRENT_WORKFLOW_TASKS,
      DEFAULT_BROWSER_WORKER_MAX_CONCURRENT_WORKFLOW_TASKS,
      64,
    ),
    heartbeatIntervalMs,
    healthFreshnessMs: parsePositiveInteger(
      process.env.SKYCOMMAND_BROWSER_WORKER_HEALTH_FRESHNESS_MS,
      Math.max(DEFAULT_BROWSER_WORKER_HEALTH_FRESHNESS_MS, heartbeatIntervalMs * 3),
      300000,
    ),
    healthFile: path.resolve(
      normalizeText(
        process.env.SKYCOMMAND_BROWSER_WORKER_HEALTH_FILE,
        DEFAULT_BROWSER_WORKER_HEALTH_FILE,
      ),
    ),
  };
}

module.exports = {
  DEFAULT_BROWSER_ARTIFACT_RELATIVE_ROOT,
  DEFAULT_BROWSER_EXECUTION_TIMEOUT_MS,
  DEFAULT_BROWSER_TASK_QUEUE,
  DEFAULT_BROWSER_TEST_CONFIG,
  DEFAULT_BROWSER_WORKER_HEALTH_FILE,
  DEFAULT_BROWSER_WORKER_HEALTH_FRESHNESS_MS,
  DEFAULT_BROWSER_WORKER_HEARTBEAT_INTERVAL_MS,
  DEFAULT_BROWSER_WORKER_MAX_CONCURRENT_ACTIVITIES,
  DEFAULT_BROWSER_WORKER_MAX_CONCURRENT_WORKFLOW_TASKS,
  getBrowserRuntimeConfig,
  normalizeText,
  parsePositiveInteger,
};
