const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DOCKER_RESOURCE_DETAIL_TOOL_CODE = '__docker_resource_detail';
const DOCKER_RESOURCE_CONTROL_TOOL_CODE = '__docker_resource_control';
const DOCKER_RESOURCE_TYPES = new Set(['IMAGE', 'VOLUME', 'NETWORK']);
const DOCKER_RESOURCE_CONTROL_ACTIONS = new Set(['REMOVE']);
const DEFAULT_DOCKER_RESOURCE_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const BUILT_IN_NETWORK_NAMES = new Set(['bridge', 'host', 'none']);

class DockerResourceError extends Error {
  constructor(message, code = 'SKYCOMMAND_DOCKER_RESOURCE_FAILED', details = {}) {
    super(message);
    this.name = 'DockerResourceError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeResourceType(value) {
  const resourceType = normalizeText(value).toUpperCase();
  if (!DOCKER_RESOURCE_TYPES.has(resourceType)) {
    throw new DockerResourceError(
      `Docker resource type '${resourceType || 'blank'}' is not allowed.`,
      'SKYCOMMAND_DOCKER_RESOURCE_TYPE_NOT_ALLOWED',
      { allowedResourceTypes: [...DOCKER_RESOURCE_TYPES] },
    );
  }
  return resourceType;
}

function normalizeResourceAction(value) {
  const action = normalizeText(value).toUpperCase();
  if (!DOCKER_RESOURCE_CONTROL_ACTIONS.has(action)) {
    throw new DockerResourceError(
      `Docker resource action '${action || 'blank'}' is not allowed.`,
      'SKYCOMMAND_DOCKER_RESOURCE_ACTION_NOT_ALLOWED',
      { allowedActions: [...DOCKER_RESOURCE_CONTROL_ACTIONS] },
    );
  }
  return action;
}

function normalizeReference(value, resourceType) {
  const reference = normalizeText(value);
  if (!reference || reference.length > 512 || /[\r\n\0]/.test(reference)) {
    throw new DockerResourceError(
      'Docker resource reference is invalid.',
      'SKYCOMMAND_DOCKER_RESOURCE_REFERENCE_INVALID',
    );
  }

  if (resourceType === 'VOLUME' && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(reference)) {
    throw new DockerResourceError(
      'Docker volume name is invalid.',
      'SKYCOMMAND_DOCKER_VOLUME_NAME_INVALID',
    );
  }

  if (resourceType === 'NETWORK' && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/.test(reference)) {
    throw new DockerResourceError(
      'Docker network reference is invalid.',
      'SKYCOMMAND_DOCKER_NETWORK_REFERENCE_INVALID',
    );
  }

  return reference;
}

function getDockerResourceTimeoutMs() {
  const configured = Number(
    process.env.SKYCOMMAND_DOCKER_RESOURCE_TIMEOUT_MS || DEFAULT_DOCKER_RESOURCE_TIMEOUT_MS,
  );
  return Number.isFinite(configured) && configured >= 5000
    ? configured
    : DEFAULT_DOCKER_RESOURCE_TIMEOUT_MS;
}

async function runDockerCommand(args, { executor = execFileAsync } = {}) {
  try {
    const result = await executor('docker', args, {
      encoding: 'utf8',
      timeout: getDockerResourceTimeoutMs(),
      maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    return normalizeText(result?.stdout);
  } catch (error) {
    const stderr = normalizeText(error?.stderr);
    const message = stderr || normalizeText(error?.message) || 'Docker resource command failed.';
    const notFound = /no such|not found/i.test(message);
    const inUse = /in use|is being used|active endpoints|conflict/i.test(message);
    throw new DockerResourceError(
      notFound ? 'Docker resource was not found on the Host Agent.' : message,
      notFound
        ? 'SKYCOMMAND_DOCKER_RESOURCE_NOT_FOUND'
        : inUse
          ? 'SKYCOMMAND_DOCKER_RESOURCE_IN_USE'
          : 'SKYCOMMAND_DOCKER_RESOURCE_COMMAND_FAILED',
      { command: ['docker', ...args.slice(0, 2)].join(' ') },
    );
  }
}

function parseInspect(output) {
  try {
    const parsed = JSON.parse(normalizeText(output));
    return Array.isArray(parsed) ? parsed[0] || null : parsed;
  } catch {
    return null;
  }
}

function parseJsonLines(output) {
  return normalizeText(output)
    .split(/\r?\n/)
    .map((line) => {
      try {
        return line ? JSON.parse(line) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeContainer(record = {}) {
  return {
    id: normalizeText(record.ID),
    name: normalizeText(record.Names),
    image: normalizeText(record.Image),
    state: normalizeText(record.State).toUpperCase(),
    status: normalizeText(record.Status),
  };
}

function normalizeLabels(labels = {}) {
  const safePrefixes = ['com.docker.compose.', 'org.opencontainers.image.', 'com.docker.desktop.'];
  return Object.entries(labels || {})
    .filter(([key]) => normalizeText(key))
    .slice(0, 50)
    .map(([key, value]) => {
      const normalizedKey = normalizeText(key);
      const safeValue = safePrefixes.some((prefix) => normalizedKey.startsWith(prefix));
      return {
        key: normalizedKey,
        value: safeValue ? normalizeText(value).slice(0, 2048) : '[redacted]',
        redacted: !safeValue,
      };
    });
}

function normalizeImageDetail(inspect = {}, usage = [], reference = '') {
  const repoTags = Array.isArray(inspect.RepoTags) ? inspect.RepoTags.filter(Boolean) : [];
  const repoDigests = Array.isArray(inspect.RepoDigests) ? inspect.RepoDigests.filter(Boolean) : [];
  return {
    resourceType: 'IMAGE',
    reference,
    id: normalizeText(inspect.Id),
    repoTags,
    repoDigests,
    createdAt: normalizeText(inspect.Created),
    sizeBytes: Number(inspect.Size) || 0,
    architecture: normalizeText(inspect.Architecture),
    operatingSystem: normalizeText(inspect.Os),
    dockerVersion: normalizeText(inspect.DockerVersion),
    author: normalizeText(inspect.Author),
    labels: normalizeLabels(inspect?.Config?.Labels),
    usageContainers: usage.map(normalizeContainer),
    usageCount: usage.length,
    cleanup: {
      mode: 'GUARDED_REMOVE',
      eligible: usage.length === 0,
      reasonCode: usage.length === 0 ? null : 'SKYCOMMAND_DOCKER_IMAGE_IN_USE',
    },
  };
}

function normalizeVolumeDetail(inspect = {}, usage = []) {
  const labels = inspect.Labels || {};
  return {
    resourceType: 'VOLUME',
    name: normalizeText(inspect.Name),
    driver: normalizeText(inspect.Driver),
    scope: normalizeText(inspect.Scope),
    mountpoint: normalizeText(inspect.Mountpoint),
    createdAt: normalizeText(inspect.CreatedAt),
    project: normalizeText(labels['com.docker.compose.project']),
    labels: normalizeLabels(labels),
    options: Object.entries(inspect.Options || {}).map(([key]) => ({
      key: normalizeText(key),
      value: '[redacted]',
      redacted: true,
    })),
    usageContainers: usage.map(normalizeContainer),
    usageCount: usage.length,
    cleanup: {
      mode: 'DATA_PROTECTED',
      eligible: false,
      reasonCode: 'SKYCOMMAND_DOCKER_VOLUME_DATA_PROTECTED',
    },
  };
}

function normalizeNetworkDetail(inspect = {}, usage = []) {
  const labels = inspect.Labels || {};
  const name = normalizeText(inspect.Name);
  const builtIn = BUILT_IN_NETWORK_NAMES.has(name.toLowerCase()) || Boolean(inspect.Ingress);
  const ipamConfigs = Array.isArray(inspect?.IPAM?.Config) ? inspect.IPAM.Config : [];
  const endpoints = Object.entries(inspect.Containers || {}).map(([containerId, endpoint]) => ({
    containerId,
    name: normalizeText(endpoint?.Name),
    endpointId: normalizeText(endpoint?.EndpointID),
    macAddress: normalizeText(endpoint?.MacAddress),
    ipv4Address: normalizeText(endpoint?.IPv4Address),
    ipv6Address: normalizeText(endpoint?.IPv6Address),
  }));

  return {
    resourceType: 'NETWORK',
    id: normalizeText(inspect.Id),
    name,
    driver: normalizeText(inspect.Driver),
    scope: normalizeText(inspect.Scope),
    createdAt: normalizeText(inspect.Created),
    internal: Boolean(inspect.Internal),
    attachable: Boolean(inspect.Attachable),
    ingress: Boolean(inspect.Ingress),
    ipv6: Boolean(inspect.EnableIPv6),
    project: normalizeText(labels['com.docker.compose.project']),
    labels: normalizeLabels(labels),
    ipam: ipamConfigs.map((config) => ({
      subnet: normalizeText(config?.Subnet),
      gateway: normalizeText(config?.Gateway),
      ipRange: normalizeText(config?.IPRange),
    })),
    endpoints,
    usageContainers: usage.map(normalizeContainer),
    usageCount: usage.length,
    cleanup: {
      mode: builtIn ? 'SYSTEM_PROTECTED' : 'GUARDED_REMOVE',
      eligible: !builtIn && usage.length === 0,
      reasonCode: builtIn
        ? 'SKYCOMMAND_DOCKER_NETWORK_SYSTEM_PROTECTED'
        : usage.length > 0
          ? 'SKYCOMMAND_DOCKER_NETWORK_IN_USE'
          : null,
    },
  };
}

async function inspectUsage(resourceType, reference, run) {
  const filter = resourceType === 'IMAGE'
    ? `ancestor=${reference}`
    : resourceType === 'VOLUME'
      ? `volume=${reference}`
      : `network=${reference}`;
  const output = await run(['container', 'ls', '--all', '--filter', filter, '--format', '{{json .}}']);
  return parseJsonLines(output);
}

async function executeDockerResourceDetail({ resourceType, reference }, { executor = execFileAsync } = {}) {
  const normalizedType = normalizeResourceType(resourceType);
  const normalizedReference = normalizeReference(reference, normalizedType);
  const run = (args) => runDockerCommand(args, { executor });
  const objectType = normalizedType.toLowerCase();
  const [inspectOutput, usage] = await Promise.all([
    run([objectType, 'inspect', normalizedReference]),
    inspectUsage(normalizedType, normalizedReference, run),
  ]);
  const inspect = parseInspect(inspectOutput);
  if (!inspect) {
    throw new DockerResourceError(
      'Docker returned an unreadable resource inspection payload.',
      'SKYCOMMAND_DOCKER_RESOURCE_INSPECT_INVALID',
    );
  }

  const resource = normalizedType === 'IMAGE'
    ? normalizeImageDetail(inspect, usage, normalizedReference)
    : normalizedType === 'VOLUME'
      ? normalizeVolumeDetail(inspect, usage)
      : normalizeNetworkDetail(inspect, usage);

  return { resource, capturedAt: new Date().toISOString() };
}

async function executeDockerResourceControl(
  { resourceType, reference, action },
  { executor = execFileAsync } = {},
) {
  const normalizedType = normalizeResourceType(resourceType);
  const normalizedReference = normalizeReference(reference, normalizedType);
  const normalizedAction = normalizeResourceAction(action);

  if (normalizedType === 'VOLUME') {
    throw new DockerResourceError(
      'SkyCommand does not expose Docker volume deletion because detached volumes may contain persistent application data.',
      'SKYCOMMAND_DOCKER_VOLUME_DATA_PROTECTED',
    );
  }

  const run = (args) => runDockerCommand(args, { executor });
  const before = await executeDockerResourceDetail(
    { resourceType: normalizedType, reference: normalizedReference },
    { executor },
  );

  if (!before.resource?.cleanup?.eligible) {
    throw new DockerResourceError(
      normalizedType === 'IMAGE'
        ? 'Docker image reference is still used by one or more containers.'
        : 'Docker network is protected or still attached to one or more containers.',
      before.resource?.cleanup?.reasonCode || 'SKYCOMMAND_DOCKER_RESOURCE_REMOVE_BLOCKED',
      { usageCount: before.resource?.usageCount || 0 },
    );
  }

  if (normalizedAction === 'REMOVE') {
    if (normalizedType === 'IMAGE') {
      await run(['image', 'rm', normalizedReference]);
    } else if (normalizedType === 'NETWORK') {
      await run(['network', 'rm', before.resource.name || normalizedReference]);
    }
  }

  return {
    resourceType: normalizedType,
    reference: normalizedReference,
    action: normalizedAction,
    status: 'SUCCESS',
    removedAt: new Date().toISOString(),
  };
}

module.exports = {
  BUILT_IN_NETWORK_NAMES,
  DOCKER_RESOURCE_CONTROL_ACTIONS,
  DOCKER_RESOURCE_CONTROL_TOOL_CODE,
  DOCKER_RESOURCE_DETAIL_TOOL_CODE,
  DOCKER_RESOURCE_TYPES,
  DockerResourceError,
  executeDockerResourceControl,
  executeDockerResourceDetail,
  normalizeImageDetail,
  normalizeNetworkDetail,
  normalizeResourceAction,
  normalizeResourceType,
  normalizeVolumeDetail,
};
