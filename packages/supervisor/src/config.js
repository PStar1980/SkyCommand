const path = require('node:path');

const DEFAULT_SUPERVISOR_HOST = '127.0.0.1';
const DEFAULT_SUPERVISOR_PORT = 17170;
const DEFAULT_SUPERVISOR_PROJECT_NAME = 'skycommand';
const DEFAULT_RUNTIME_SERVICES = [
  'postgres',
  'temporal',
  'temporal-worker',
  'node-worker',
  'api',
];
const DEFAULT_STARTUP_TIMEOUT_MS = 180000;
const DEFAULT_CONTROL_TIMEOUT_MS = 180000;

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function normalizePort(value, fallback = DEFAULT_SUPERVISOR_PORT) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRuntimeServices(value) {
  const configured = normalizeText(value);
  if (!configured) return [...DEFAULT_RUNTIME_SERVICES];

  const services = [...new Set(
    configured
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )];

  return services.length > 0 ? services : [...DEFAULT_RUNTIME_SERVICES];
}

function getSupervisorConfig(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const composeFile = path.resolve(
    normalizeText(process.env.SKYCOMMAND_SUPERVISOR_COMPOSE_FILE, path.join(root, 'compose.yaml')),
  );

  const webPort = normalizePort(process.env.SKYCOMMAND_WEB_PORT, 15171);

  return {
    repositoryRoot: root,
    composeFile,
    projectName: normalizeText(
      process.env.SKYCOMMAND_SUPERVISOR_PROJECT_NAME,
      process.env.SKYCOMMAND_DOCKER_SELF_PROJECT_NAME || DEFAULT_SUPERVISOR_PROJECT_NAME,
    ),
    host: normalizeText(process.env.SKYCOMMAND_SUPERVISOR_HOST, DEFAULT_SUPERVISOR_HOST),
    port: normalizePort(process.env.SKYCOMMAND_SUPERVISOR_PORT),
    runtimeServices: parseRuntimeServices(process.env.SKYCOMMAND_SUPERVISOR_RUNTIME_SERVICES),
    bootstrapOrigins: new Set(
      normalizeText(
        process.env.SKYCOMMAND_SUPERVISOR_BOOTSTRAP_ORIGINS,
        `http://localhost:${webPort},http://127.0.0.1:${webPort}`,
      )
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
    controlToken: normalizeText(process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN),
    startupTimeoutMs: normalizePositiveNumber(
      process.env.SKYCOMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS,
      DEFAULT_STARTUP_TIMEOUT_MS,
    ),
    controlTimeoutMs: normalizePositiveNumber(
      process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TIMEOUT_MS,
      DEFAULT_CONTROL_TIMEOUT_MS,
    ),
  };
}

module.exports = {
  DEFAULT_CONTROL_TIMEOUT_MS,
  DEFAULT_RUNTIME_SERVICES,
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_SUPERVISOR_HOST,
  DEFAULT_SUPERVISOR_PORT,
  DEFAULT_SUPERVISOR_PROJECT_NAME,
  getSupervisorConfig,
  normalizePort,
  parseRuntimeServices,
};
