const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DOCKER_COMPOSE_CONTROL_TOOL_CODE = '__docker_compose_control';
const DEFAULT_DOCKER_CONTROL_TIMEOUT_MS = 120000;
const DOCKER_COMPOSE_ACTIONS = new Set(['START', 'STOP', 'RESTART']);

class DockerControlError extends Error {
  constructor(message, code = 'SKYCOMMAND_DOCKER_CONTROL_FAILED', details = {}) {
    super(message);
    this.name = 'DockerControlError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeDockerComposeAction(value) {
  const action = normalizeText(value).toUpperCase();

  if (!DOCKER_COMPOSE_ACTIONS.has(action)) {
    throw new DockerControlError(
      `Docker Compose action '${action || 'blank'}' is not allowed.`,
      'SKYCOMMAND_DOCKER_ACTION_NOT_ALLOWED',
      { allowedActions: [...DOCKER_COMPOSE_ACTIONS] },
    );
  }

  return action;
}

function normalizeDockerProjectName(value) {
  const projectName = normalizeText(value);

  if (!projectName || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(projectName)) {
    throw new DockerControlError(
      'Docker Compose project name is invalid.',
      'SKYCOMMAND_DOCKER_PROJECT_INVALID',
    );
  }

  return projectName;
}

function normalizeConfigFiles(configFiles, { fileExists = fs.existsSync } = {}) {
  const normalized = [...new Set(
    (Array.isArray(configFiles) ? configFiles : [])
      .map((item) => normalizeText(item))
      .filter(Boolean),
  )];

  if (normalized.length === 0) {
    throw new DockerControlError(
      'Docker Compose project has no discovered configuration file.',
      'SKYCOMMAND_DOCKER_PROJECT_CONFIG_MISSING',
    );
  }

  const missingFiles = normalized.filter((filePath) => !fileExists(filePath));
  if (missingFiles.length > 0) {
    throw new DockerControlError(
      'One or more discovered Docker Compose configuration files are unavailable on the Host Agent machine.',
      'SKYCOMMAND_DOCKER_PROJECT_CONFIG_UNAVAILABLE',
      { missingFileCount: missingFiles.length },
    );
  }

  return normalized;
}

function buildDockerComposeControlArgs({ projectName, action, configFiles }, options = {}) {
  const normalizedProjectName = normalizeDockerProjectName(projectName);
  const normalizedAction = normalizeDockerComposeAction(action);
  const normalizedConfigFiles = normalizeConfigFiles(configFiles, options);
  const args = ['compose', '--project-name', normalizedProjectName];

  for (const configFile of normalizedConfigFiles) {
    args.push('--file', configFile);
  }

  args.push(normalizedAction.toLowerCase());
  return args;
}

function getDockerControlTimeoutMs() {
  const configured = Number(
    process.env.SKYCOMMAND_DOCKER_CONTROL_TIMEOUT_MS || DEFAULT_DOCKER_CONTROL_TIMEOUT_MS,
  );

  return Number.isFinite(configured) && configured >= 10000
    ? configured
    : DEFAULT_DOCKER_CONTROL_TIMEOUT_MS;
}

async function executeDockerComposeControl(
  input = {},
  { executor = execFileAsync, fileExists = fs.existsSync } = {},
) {
  const action = normalizeDockerComposeAction(input.action);
  const projectName = normalizeDockerProjectName(input.projectName);
  const configFiles = normalizeConfigFiles(input.configFiles, { fileExists });
  const args = buildDockerComposeControlArgs(
    { projectName, action, configFiles },
    { fileExists: () => true },
  );
  const startedAt = new Date();

  try {
    const result = await executor('docker', args, {
      encoding: 'utf8',
      timeout: getDockerControlTimeoutMs(),
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const finishedAt = new Date();

    return {
      providerCode: 'DOCKER',
      projectName,
      action,
      status: 'SUCCESS',
      stdout: normalizeText(result?.stdout),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(finishedAt.getTime() - startedAt.getTime(), 0),
      configFileCount: configFiles.length,
    };
  } catch (error) {
    const stderr = normalizeText(error?.stderr);
    const message = stderr || normalizeText(error?.message) || 'Docker Compose control command failed.';
    const daemonUnavailable = /daemon|docker desktop|pipe|connection refused|cannot connect/i.test(message);

    throw new DockerControlError(
      daemonUnavailable
        ? 'Docker Engine is unavailable on the SkyCommand Host Agent machine.'
        : 'Docker Compose control command failed.',
      daemonUnavailable
        ? 'SKYCOMMAND_DOCKER_ENGINE_UNAVAILABLE'
        : 'SKYCOMMAND_DOCKER_CONTROL_COMMAND_FAILED',
      {
        projectName,
        action,
      },
    );
  }
}

module.exports = {
  DEFAULT_DOCKER_CONTROL_TIMEOUT_MS,
  DOCKER_COMPOSE_ACTIONS,
  DOCKER_COMPOSE_CONTROL_TOOL_CODE,
  DockerControlError,
  buildDockerComposeControlArgs,
  executeDockerComposeControl,
  normalizeDockerComposeAction,
  normalizeDockerProjectName,
};
