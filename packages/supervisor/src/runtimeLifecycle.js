const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ALLOWED_ACTIONS = new Set(['START', 'STOP', 'RESTART', 'REBUILD_WEB']);

class SupervisorRuntimeError extends Error {
  constructor(message, code = 'SKYCOMMAND_SUPERVISOR_RUNTIME_FAILED', details = {}) {
    super(message);
    this.name = 'SupervisorRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function assertConfig(config = {}) {
  if (!normalizeText(config.repositoryRoot) || !fs.existsSync(config.repositoryRoot)) {
    throw new SupervisorRuntimeError(
      'SkyCommand Supervisor repository root is unavailable.',
      'SKYCOMMAND_SUPERVISOR_REPOSITORY_UNAVAILABLE',
    );
  }

  if (!normalizeText(config.composeFile) || !fs.existsSync(config.composeFile)) {
    throw new SupervisorRuntimeError(
      'SkyCommand Supervisor Compose file is unavailable.',
      'SKYCOMMAND_SUPERVISOR_COMPOSE_UNAVAILABLE',
    );
  }

  if (!Array.isArray(config.runtimeServices) || config.runtimeServices.length === 0) {
    throw new SupervisorRuntimeError(
      'SkyCommand Supervisor runtime service list is empty.',
      'SKYCOMMAND_SUPERVISOR_SERVICES_MISSING',
    );
  }

  if (!normalizeText(config.webService)) {
    throw new SupervisorRuntimeError(
      'SkyCommand Supervisor web service name is missing.',
      'SKYCOMMAND_SUPERVISOR_WEB_SERVICE_MISSING',
    );
  }
}

function buildComposeArgs(config, args = []) {
  assertConfig(config);
  return [
    'compose',
    '--project-name',
    config.projectName,
    '--file',
    config.composeFile,
    ...args,
  ];
}

async function executeDocker(config, args, options = {}) {
  const executor = options.executor || execFileAsync;
  const timeout = Number(options.timeout || config.controlTimeoutMs || 180000);

  try {
    return await executor('docker', buildComposeArgs(config, args), {
      cwd: config.repositoryRoot,
      encoding: 'utf8',
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    });
  } catch (error) {
    const raw = [error?.stderr, error?.stdout, error?.message]
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .join('\n');
    const daemonUnavailable = /daemon|docker desktop|pipe|cannot connect|connection refused/i.test(raw);

    throw new SupervisorRuntimeError(
      daemonUnavailable
        ? 'Docker Engine is unavailable to the SkyCommand Supervisor.'
        : 'SkyCommand Supervisor Docker Compose command failed.',
      daemonUnavailable
        ? 'SKYCOMMAND_SUPERVISOR_DOCKER_UNAVAILABLE'
        : 'SKYCOMMAND_SUPERVISOR_DOCKER_COMMAND_FAILED',
      { stderr: normalizeText(error?.stderr) },
    );
  }
}

function parseComposePsOutput(stdout) {
  const text = normalizeText(stdout);
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

function normalizeServiceSnapshot(item = {}) {
  const state = normalizeText(item.State || item.state || 'UNKNOWN').toUpperCase();
  const health = normalizeText(item.Health || item.health).toUpperCase();
  return {
    service: normalizeText(item.Service || item.service),
    name: normalizeText(item.Name || item.name),
    state,
    health: health || null,
    running: state === 'RUNNING',
  };
}

async function getRuntimeStatus(config, options = {}) {
  assertConfig(config);

  let result;
  try {
    result = await executeDocker(
      config,
      ['ps', '--all', '--format', 'json', ...config.runtimeServices],
      { ...options, timeout: Math.min(config.controlTimeoutMs || 180000, 30000) },
    );
  } catch (error) {
    if (error.code === 'SKYCOMMAND_SUPERVISOR_DOCKER_UNAVAILABLE') {
      return {
        engineStatus: 'OFFLINE',
        runtimeStatus: 'UNAVAILABLE',
        services: config.runtimeServices.map((service) => ({
          service,
          name: '',
          state: 'UNKNOWN',
          health: null,
          running: false,
        })),
      };
    }
    throw error;
  }

  const observed = new Map(
    parseComposePsOutput(result.stdout)
      .map(normalizeServiceSnapshot)
      .filter((item) => item.service)
      .map((item) => [item.service, item]),
  );

  const services = config.runtimeServices.map((service) => observed.get(service) || {
    service,
    name: '',
    state: 'NOT_CREATED',
    health: null,
    running: false,
  });

  const runningCount = services.filter((item) => item.running).length;
  const allRunning = runningCount === services.length;
  const anyRunning = runningCount > 0;
  const hasStartingHealth = services.some((item) => item.running && item.health === 'STARTING');
  const hasUnhealthy = services.some((item) => item.health === 'UNHEALTHY');

  let runtimeStatus = 'STOPPED';
  if (allRunning && !hasUnhealthy && !hasStartingHealth) runtimeStatus = 'ONLINE';
  else if (allRunning && hasStartingHealth) runtimeStatus = 'STARTING';
  else if (anyRunning) runtimeStatus = hasUnhealthy ? 'DEGRADED' : 'PARTIAL';

  return {
    engineStatus: 'ONLINE',
    runtimeStatus,
    runningCount,
    serviceCount: services.length,
    services,
  };
}

async function startRuntime(config, options = {}) {
  const result = await executeDocker(
    config,
    ['up', '-d', ...config.runtimeServices],
    { ...options, timeout: config.startupTimeoutMs },
  );
  return {
    action: 'START',
    stdout: normalizeText(result.stdout),
    status: await getRuntimeStatus(config, options),
  };
}

async function stopRuntime(config, options = {}) {
  const stopOrder = [...config.runtimeServices].reverse();
  const result = await executeDocker(
    config,
    ['stop', ...stopOrder],
    { ...options, timeout: config.controlTimeoutMs },
  );
  return {
    action: 'STOP',
    stdout: normalizeText(result.stdout),
    status: await getRuntimeStatus(config, options),
  };
}

async function restartRuntime(config, options = {}) {
  await stopRuntime(config, options);
  const started = await startRuntime(config, options);
  return {
    ...started,
    action: 'RESTART',
  };
}

async function rebuildWeb(config, options = {}) {
  const result = await executeDocker(
    config,
    ['up', '-d', '--build', config.webService],
    { ...options, timeout: config.rebuildTimeoutMs || config.controlTimeoutMs },
  );

  return {
    action: 'REBUILD_WEB',
    stdout: normalizeText(result.stdout),
    status: await getRuntimeStatus(config, options),
  };
}

async function controlRuntime(config, action, options = {}) {
  const normalized = normalizeText(action).toUpperCase();
  if (!ALLOWED_ACTIONS.has(normalized)) {
    throw new SupervisorRuntimeError(
      `SkyCommand Supervisor action '${normalized || 'blank'}' is not allowed.`,
      'SKYCOMMAND_SUPERVISOR_ACTION_NOT_ALLOWED',
      { allowedActions: [...ALLOWED_ACTIONS] },
    );
  }

  if (normalized === 'START') return startRuntime(config, options);
  if (normalized === 'STOP') return stopRuntime(config, options);
  if (normalized === 'REBUILD_WEB') return rebuildWeb(config, options);
  return restartRuntime(config, options);
}

module.exports = {
  ALLOWED_ACTIONS,
  SupervisorRuntimeError,
  buildComposeArgs,
  controlRuntime,
  getRuntimeStatus,
  parseComposePsOutput,
  rebuildWeb,
  restartRuntime,
  startRuntime,
  stopRuntime,
};
