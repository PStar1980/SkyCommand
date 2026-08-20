const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DOCKER_CONTAINER_DETAIL_TOOL_CODE = '__docker_container_detail';
const DOCKER_CONTAINER_CONTROL_TOOL_CODE = '__docker_container_control';
const DOCKER_CONTAINER_ACTIONS = new Set(['START', 'STOP', 'RESTART', 'PAUSE', 'UNPAUSE']);
const DEFAULT_DOCKER_CONTAINER_TIMEOUT_MS = 30000;
const DEFAULT_DOCKER_LOG_TAIL = 200;
const MAX_DOCKER_LOG_TAIL = 1000;
const MAX_DOCKER_LOG_BYTES = 512 * 1024;

class DockerContainerError extends Error {
  constructor(message, code = 'SKYCOMMAND_DOCKER_CONTAINER_FAILED', details = {}) {
    super(message);
    this.name = 'DockerContainerError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeContainerId(value) {
  const containerId = normalizeText(value).toLowerCase();

  if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
    throw new DockerContainerError(
      'Docker container identifier is invalid.',
      'SKYCOMMAND_DOCKER_CONTAINER_ID_INVALID',
    );
  }

  return containerId;
}

function normalizeContainerAction(value) {
  const action = normalizeText(value).toUpperCase();

  if (!DOCKER_CONTAINER_ACTIONS.has(action)) {
    throw new DockerContainerError(
      `Docker container action '${action || 'blank'}' is not allowed.`,
      'SKYCOMMAND_DOCKER_CONTAINER_ACTION_NOT_ALLOWED',
      { allowedActions: [...DOCKER_CONTAINER_ACTIONS] },
    );
  }

  return action;
}

function normalizeLogTail(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DOCKER_LOG_TAIL;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_DOCKER_LOG_TAIL);
}

function getDockerContainerTimeoutMs() {
  const configured = Number(
    process.env.SKYCOMMAND_DOCKER_CONTAINER_TIMEOUT_MS || DEFAULT_DOCKER_CONTAINER_TIMEOUT_MS,
  );

  return Number.isFinite(configured) && configured >= 5000
    ? configured
    : DEFAULT_DOCKER_CONTAINER_TIMEOUT_MS;
}

function parseInspectPayload(value) {
  const source = normalizeText(value);
  if (!source) return null;

  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed[0] || null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeHealth(state = {}) {
  const status = normalizeText(state?.Health?.Status).toUpperCase();
  return status || 'NONE';
}

function normalizeMount(mount = {}) {
  return {
    type: normalizeText(mount.Type),
    name: normalizeText(mount.Name),
    source: normalizeText(mount.Source),
    destination: normalizeText(mount.Destination),
    driver: normalizeText(mount.Driver),
    mode: normalizeText(mount.Mode),
    readWrite: Boolean(mount.RW),
    propagation: normalizeText(mount.Propagation),
  };
}

function normalizeNetwork(name, network = {}) {
  return {
    name: normalizeText(name),
    networkId: normalizeText(network.NetworkID),
    endpointId: normalizeText(network.EndpointID),
    gateway: normalizeText(network.Gateway),
    ipAddress: normalizeText(network.IPAddress),
    prefixLength: Number(network.IPPrefixLen) || 0,
    ipv6Gateway: normalizeText(network.IPv6Gateway),
    globalIpv6Address: normalizeText(network.GlobalIPv6Address),
    macAddress: normalizeText(network.MacAddress),
    aliases: Array.isArray(network.Aliases) ? network.Aliases.filter(Boolean) : [],
  };
}

function normalizePortBindings(ports = {}) {
  return Object.entries(ports || {}).map(([containerPort, bindings]) => ({
    containerPort,
    hostBindings: Array.isArray(bindings)
      ? bindings.map((binding) => ({
          hostIp: normalizeText(binding.HostIp),
          hostPort: normalizeText(binding.HostPort),
        }))
      : [],
  }));
}

function normalizeHealthLog(entry = {}) {
  return {
    start: normalizeText(entry.Start),
    end: normalizeText(entry.End),
    exitCode: Number.isFinite(Number(entry.ExitCode)) ? Number(entry.ExitCode) : null,
    output: normalizeText(entry.Output).slice(0, 4096),
  };
}

function buildContainerDetail(inspect = {}) {
  const labels = inspect?.Config?.Labels || {};
  const state = inspect.State || {};
  const restartPolicy = inspect?.HostConfig?.RestartPolicy || {};
  const networks = inspect?.NetworkSettings?.Networks || {};

  return {
    id: normalizeText(inspect.Id),
    name: normalizeText(inspect.Name).replace(/^\//, ''),
    image: normalizeText(inspect?.Config?.Image),
    imageId: normalizeText(inspect.Image),
    platform: normalizeText(inspect.Platform),
    createdAt: normalizeText(inspect.Created),
    project: normalizeText(labels['com.docker.compose.project']),
    service: normalizeText(labels['com.docker.compose.service']),
    composeVersion: normalizeText(labels['com.docker.compose.version']),
    composeWorkingDir: normalizeText(labels['com.docker.compose.project.working_dir']),
    composeConfigFiles: normalizeText(labels['com.docker.compose.project.config_files']),
    state: {
      status: normalizeText(state.Status).toUpperCase() || 'UNKNOWN',
      running: Boolean(state.Running),
      paused: Boolean(state.Paused),
      restarting: Boolean(state.Restarting),
      oomKilled: Boolean(state.OOMKilled),
      dead: Boolean(state.Dead),
      pid: Number(state.Pid) || 0,
      exitCode: Number.isFinite(Number(state.ExitCode)) ? Number(state.ExitCode) : null,
      error: normalizeText(state.Error),
      startedAt: normalizeText(state.StartedAt),
      finishedAt: normalizeText(state.FinishedAt),
      health: normalizeHealth(state),
      healthFailingStreak: Number(state?.Health?.FailingStreak) || 0,
      healthLog: Array.isArray(state?.Health?.Log)
        ? state.Health.Log.slice(-5).map(normalizeHealthLog)
        : [],
    },
    restartCount: Number(inspect.RestartCount) || 0,
    restartPolicy: {
      name: normalizeText(restartPolicy.Name) || 'no',
      maximumRetryCount: Number(restartPolicy.MaximumRetryCount) || 0,
    },
    runtime: {
      user: normalizeText(inspect?.Config?.User),
      workingDir: normalizeText(inspect?.Config?.WorkingDir),
      entrypoint: Array.isArray(inspect?.Config?.Entrypoint) ? inspect.Config.Entrypoint : [],
      command: Array.isArray(inspect?.Config?.Cmd) ? inspect.Config.Cmd : [],
      tty: Boolean(inspect?.Config?.Tty),
      openStdin: Boolean(inspect?.Config?.OpenStdin),
    },
    mounts: Array.isArray(inspect.Mounts) ? inspect.Mounts.map(normalizeMount) : [],
    networks: Object.entries(networks).map(([name, network]) => normalizeNetwork(name, network)),
    ports: normalizePortBindings(inspect?.NetworkSettings?.Ports),
    security: {
      environmentRedacted: true,
      rawInspectPayloadExposed: false,
    },
  };
}

function truncateLogOutput(value) {
  const source = value === undefined || value === null ? '' : String(value);
  const buffer = Buffer.from(source, 'utf8');
  if (buffer.length <= MAX_DOCKER_LOG_BYTES) {
    return { text: source.trimEnd(), truncated: false };
  }

  return {
    text: buffer.subarray(buffer.length - MAX_DOCKER_LOG_BYTES).toString('utf8').trimEnd(),
    truncated: true,
  };
}

async function runContainerCommand(args, { executor = execFileAsync, timeoutMs = getDockerContainerTimeoutMs() } = {}) {
  try {
    return await executor('docker', args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = normalizeText(error?.stderr);
    const message = stderr || normalizeText(error?.message) || 'Docker container command failed.';
    const daemonUnavailable = /daemon|docker desktop|pipe|connection refused|cannot connect/i.test(message);
    const notFound = /no such container/i.test(message);

    throw new DockerContainerError(
      daemonUnavailable
        ? 'Docker Engine is unavailable on the SkyCommand Host Agent machine.'
        : notFound
          ? 'Docker container no longer exists on the SkyCommand Host Agent machine.'
          : 'Docker container command failed.',
      daemonUnavailable
        ? 'SKYCOMMAND_DOCKER_ENGINE_UNAVAILABLE'
        : notFound
          ? 'SKYCOMMAND_DOCKER_CONTAINER_NOT_FOUND'
          : 'SKYCOMMAND_DOCKER_CONTAINER_COMMAND_FAILED',
      { command: ['docker', ...args.slice(0, 2)].join(' ') },
    );
  }
}

async function executeDockerContainerDetail(
  input = {},
  { executor = execFileAsync } = {},
) {
  const containerId = normalizeContainerId(input.containerId);
  const tail = normalizeLogTail(input.tail);
  const inspectResult = await runContainerCommand(
    ['container', 'inspect', containerId],
    { executor },
  );
  const inspect = parseInspectPayload(inspectResult?.stdout);

  if (!inspect) {
    throw new DockerContainerError(
      'Docker returned an unreadable container inspection payload.',
      'SKYCOMMAND_DOCKER_CONTAINER_INSPECT_INVALID',
    );
  }

  let logs = {
    stdout: '',
    stderr: '',
    tail,
    truncated: false,
    available: true,
    error: null,
  };

  try {
    const logResult = await runContainerCommand(
      ['container', 'logs', '--timestamps', '--tail', String(tail), containerId],
      { executor },
    );
    const stdout = truncateLogOutput(logResult?.stdout);
    const stderr = truncateLogOutput(logResult?.stderr);
    logs = {
      stdout: stdout.text,
      stderr: stderr.text,
      tail,
      truncated: stdout.truncated || stderr.truncated,
      available: true,
      error: null,
    };
  } catch (error) {
    logs = {
      stdout: '',
      stderr: '',
      tail,
      truncated: false,
      available: false,
      error: {
        code: error?.code || 'SKYCOMMAND_DOCKER_CONTAINER_LOGS_FAILED',
        message: error?.message || 'Docker container logs are unavailable.',
      },
    };
  }

  return {
    providerCode: 'DOCKER',
    container: buildContainerDetail(inspect),
    logs,
    capturedAt: new Date().toISOString(),
  };
}

async function executeDockerContainerControl(
  input = {},
  { executor = execFileAsync } = {},
) {
  const containerId = normalizeContainerId(input.containerId);
  const action = normalizeContainerAction(input.action);
  const startedAt = new Date();

  await runContainerCommand(
    ['container', action.toLowerCase(), containerId],
    { executor, timeoutMs: action === 'RESTART' ? 120000 : getDockerContainerTimeoutMs() },
  );

  const finishedAt = new Date();
  return {
    providerCode: 'DOCKER',
    containerId,
    action,
    status: 'SUCCESS',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(finishedAt.getTime() - startedAt.getTime(), 0),
  };
}

module.exports = {
  DEFAULT_DOCKER_CONTAINER_TIMEOUT_MS,
  DEFAULT_DOCKER_LOG_TAIL,
  DOCKER_CONTAINER_ACTIONS,
  DOCKER_CONTAINER_CONTROL_TOOL_CODE,
  DOCKER_CONTAINER_DETAIL_TOOL_CODE,
  DockerContainerError,
  buildContainerDetail,
  executeDockerContainerControl,
  executeDockerContainerDetail,
  normalizeContainerAction,
  normalizeContainerId,
  normalizeLogTail,
};
