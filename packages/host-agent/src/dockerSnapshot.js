const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_DOCKER_COMMAND_TIMEOUT_MS = 10000;
const DEFAULT_DOCKER_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

class DockerSnapshotError extends Error {
  constructor(message, code = 'SKYCOMMAND_DOCKER_SNAPSHOT_FAILED', details = {}) {
    super(message);
    this.name = 'DockerSnapshotError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function parseJson(value, fallback = null) {
  const source = normalizeText(value);
  if (!source) return fallback;

  try {
    return JSON.parse(source);
  } catch {
    return fallback;
  }
}

function parseJsonRecords(value) {
  const source = normalizeText(value);
  if (!source) return [];

  const parsed = parseJson(source, null);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];

  return source
    .split(/\r?\n/)
    .map((line) => parseJson(line, null))
    .filter((record) => record && typeof record === 'object');
}

function parseLabelMap(value) {
  const labels = {};
  const source = normalizeText(value);
  if (!source) return labels;

  for (const item of source.split(',')) {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = item.slice(0, separatorIndex).trim();
    const labelValue = item.slice(separatorIndex + 1).trim();
    if (key) labels[key] = labelValue;
  }

  return labels;
}


function parseComposeConfigFiles(value) {
  return [...new Set(
    normalizeText(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeHealth(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized.includes('(healthy)')) return 'HEALTHY';
  if (normalized.includes('(unhealthy)')) return 'UNHEALTHY';
  if (normalized.includes('(health: starting)')) return 'STARTING';
  return 'NONE';
}

function normalizeContainerState(record = {}) {
  const explicitState = normalizeText(record.State).toUpperCase();
  if (explicitState) return explicitState;

  const status = normalizeText(record.Status).toLowerCase();
  if (status.startsWith('up ')) return 'RUNNING';
  if (status.startsWith('created')) return 'CREATED';
  if (status.startsWith('paused')) return 'PAUSED';
  if (status.startsWith('restarting')) return 'RESTARTING';
  if (status.startsWith('exited')) return 'EXITED';
  if (status.startsWith('dead')) return 'DEAD';
  return status ? status.split(/\s+/)[0].toUpperCase() : 'UNKNOWN';
}

function normalizeContainer(record = {}) {
  const labels = parseLabelMap(record.Labels);

  return {
    id: normalizeText(record.ID),
    name: normalizeText(record.Names),
    image: normalizeText(record.Image),
    state: normalizeContainerState(record),
    status: normalizeText(record.Status),
    health: normalizeHealth(record.Status),
    project: normalizeText(labels['com.docker.compose.project']),
    service: normalizeText(labels['com.docker.compose.service']),
    ports: normalizeText(record.Ports),
    networks: normalizeText(record.Networks),
    mounts: normalizeText(record.Mounts),
    createdAt: normalizeText(record.CreatedAt),
  };
}

function normalizeProject(record = {}, containers = []) {
  const name = normalizeText(record.Name || record.name);
  const projectContainers = containers.filter((container) => container.project === name);
  const runningCount = projectContainers.filter((container) => container.state === 'RUNNING').length;
  const healthyCount = projectContainers.filter((container) => container.health === 'HEALTHY').length;
  const unhealthyCount = projectContainers.filter((container) => container.health === 'UNHEALTHY').length;
  const serviceCount = new Set(projectContainers.map((container) => container.service).filter(Boolean)).size;
  let state = 'UNKNOWN';

  if (projectContainers.length > 0 && runningCount === projectContainers.length) state = 'RUNNING';
  else if (runningCount > 0) state = 'PARTIAL';
  else if (projectContainers.length > 0) state = 'STOPPED';
  else if (/running/i.test(normalizeText(record.Status))) state = 'RUNNING';
  else if (/exited|stopped/i.test(normalizeText(record.Status))) state = 'STOPPED';

  return {
    name,
    state,
    status: normalizeText(record.Status || record.status),
    configFiles: normalizeText(record.ConfigFiles || record.configFiles),
    configFileList: parseComposeConfigFiles(record.ConfigFiles || record.configFiles),
    containerCount: projectContainers.length,
    runningCount,
    healthyCount,
    unhealthyCount,
    serviceCount,
  };
}

function normalizeImage(record = {}) {
  const id = normalizeText(record.ID);
  const repository = normalizeText(record.Repository);
  const tag = normalizeText(record.Tag);
  const tagged = repository && repository !== '<none>' && tag && tag !== '<none>';
  return {
    id,
    repository,
    tag,
    reference: tagged ? `${repository}:${tag}` : id,
    size: normalizeText(record.Size),
    createdSince: normalizeText(record.CreatedSince),
    containers: normalizeText(record.Containers),
  };
}

function normalizeVolume(record = {}) {
  return {
    name: normalizeText(record.Name),
    driver: normalizeText(record.Driver),
    scope: normalizeText(record.Scope),
    mountpoint: normalizeText(record.Mountpoint),
    labels: normalizeText(record.Labels),
  };
}

function normalizeNetwork(record = {}) {
  return {
    id: normalizeText(record.ID),
    name: normalizeText(record.Name),
    driver: normalizeText(record.Driver),
    scope: normalizeText(record.Scope),
    ipv6: normalizeText(record.IPv6),
    internal: normalizeText(record.Internal),
  };
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildDockerSnapshot({ info = {}, compose = [], containers = [], images = [], volumes = [], networks = [] } = {}) {
  const normalizedContainers = containers.map(normalizeContainer);
  const composeNames = new Set(
    normalizedContainers.map((container) => container.project).filter(Boolean),
  );
  const composeRecords = [...compose];

  for (const projectName of composeNames) {
    if (!composeRecords.some((record) => normalizeText(record.Name || record.name) === projectName)) {
      composeRecords.push({ Name: projectName, Status: '' });
    }
  }

  const projects = composeRecords
    .map((record) => normalizeProject(record, normalizedContainers))
    .filter((project) => project.name)
    .sort((left, right) => left.name.localeCompare(right.name));
  const normalizedImages = images.map(normalizeImage);
  const normalizedVolumes = volumes.map(normalizeVolume);
  const normalizedNetworks = networks.map(normalizeNetwork);
  const running = normalizedContainers.filter((container) => container.state === 'RUNNING').length;
  const healthy = normalizedContainers.filter((container) => container.health === 'HEALTHY').length;
  const unhealthy = normalizedContainers.filter((container) => container.health === 'UNHEALTHY').length;

  return {
    provider: {
      code: 'DOCKER',
      status: 'ONLINE',
      engineVersion: normalizeText(info.ServerVersion),
      engineName: normalizeText(info.Name),
      operatingSystem: normalizeText(info.OperatingSystem),
      osType: normalizeText(info.OSType),
      architecture: normalizeText(info.Architecture),
      cpuCount: toNumber(info.NCPU),
      memoryBytes: toNumber(info.MemTotal),
      storageDriver: normalizeText(info.Driver),
    },
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
    },
    counts: {
      projects: projects.length,
      containers: normalizedContainers.length,
      running,
      stopped: Math.max(normalizedContainers.length - running, 0),
      healthy,
      unhealthy,
      images: normalizedImages.length,
      volumes: normalizedVolumes.length,
      networks: normalizedNetworks.length,
    },
    projects,
    containers: normalizedContainers,
    images: normalizedImages,
    volumes: normalizedVolumes,
    networks: normalizedNetworks,
    capturedAt: new Date().toISOString(),
  };
}

function getDockerCommandTimeoutMs() {
  const configured = Number(process.env.SKYCOMMAND_DOCKER_COMMAND_TIMEOUT_MS || DEFAULT_DOCKER_COMMAND_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1000
    ? configured
    : DEFAULT_DOCKER_COMMAND_TIMEOUT_MS;
}

async function runDockerCommand(args, { executor = execFileAsync } = {}) {
  try {
    const result = await executor('docker', args, {
      encoding: 'utf8',
      timeout: getDockerCommandTimeoutMs(),
      maxBuffer: DEFAULT_DOCKER_MAX_BUFFER_BYTES,
      windowsHide: true,
    });

    return normalizeText(result?.stdout);
  } catch (error) {
    const stderr = normalizeText(error?.stderr);
    const message = stderr || normalizeText(error?.message) || 'Docker command failed.';
    const notFound = error?.code === 'ENOENT' || /not recognized|not found/i.test(message);
    const daemonUnavailable = /daemon|docker desktop|pipe|connection refused|cannot connect/i.test(message);

    throw new DockerSnapshotError(
      notFound
        ? 'Docker CLI is not available on the SkyCommand Host Agent machine.'
        : daemonUnavailable
          ? 'Docker Engine is unavailable on the SkyCommand Host Agent machine.'
          : 'Docker inventory command failed.',
      notFound
        ? 'SKYCOMMAND_DOCKER_CLI_UNAVAILABLE'
        : daemonUnavailable
          ? 'SKYCOMMAND_DOCKER_ENGINE_UNAVAILABLE'
          : 'SKYCOMMAND_DOCKER_COMMAND_FAILED',
      {
        command: ['docker', ...args.slice(0, 2)].join(' '),
      },
    );
  }
}

async function executeDockerSnapshot({ executor = execFileAsync } = {}) {
  const run = (args) => runDockerCommand(args, { executor });
  const infoOutput = await run(['info', '--format', '{{json .}}']);
  const info = parseJson(infoOutput, null);

  if (!info || typeof info !== 'object') {
    throw new DockerSnapshotError(
      'Docker Engine returned an unreadable information payload.',
      'SKYCOMMAND_DOCKER_INFO_INVALID',
    );
  }

  const [composeOutput, containersOutput, imagesOutput, volumesOutput, networksOutput] =
    await Promise.all([
      run(['compose', 'ls', '--all', '--format', 'json']),
      run(['container', 'ls', '--all', '--format', '{{json .}}']),
      run(['image', 'ls', '--format', '{{json .}}']),
      run(['volume', 'ls', '--format', '{{json .}}']),
      run(['network', 'ls', '--format', '{{json .}}']),
    ]);

  return buildDockerSnapshot({
    info,
    compose: parseJsonRecords(composeOutput),
    containers: parseJsonRecords(containersOutput),
    images: parseJsonRecords(imagesOutput),
    volumes: parseJsonRecords(volumesOutput),
    networks: parseJsonRecords(networksOutput),
  });
}

module.exports = {
  DEFAULT_DOCKER_COMMAND_TIMEOUT_MS,
  DockerSnapshotError,
  buildDockerSnapshot,
  executeDockerSnapshot,
  normalizeContainer,
  normalizeHealth,
  parseComposeConfigFiles,
  parseJsonRecords,
  parseLabelMap,
  runDockerCommand,
};
