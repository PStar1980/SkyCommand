const { randomUUID } = require('node:crypto');
const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
} = require('../../../../packages/host-agent/src/config');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const { getHostAgentAvailability } = require('./workflowExecutionPreflightService');

const DOCKER_PROVIDER_CODE = 'DOCKER';
const DOCKER_SNAPSHOT_TOOL_CODE = '__docker_snapshot';
const DOCKER_COMPOSE_CONTROL_TOOL_CODE = '__docker_compose_control';
const DOCKER_CONTAINER_DETAIL_TOOL_CODE = '__docker_container_detail';
const DOCKER_CONTAINER_CONTROL_TOOL_CODE = '__docker_container_control';
const DOCKER_CONTROL_ACTIONS = new Set(['START', 'STOP', 'RESTART']);
const DOCKER_CONTAINER_CONTROL_ACTIONS = new Set(['START', 'STOP', 'RESTART', 'PAUSE', 'UNPAUSE']);
const DOCKER_OPERATION_EVENT_TYPE = 'DOCKER_COMPOSE_CONTROL';
const DOCKER_CONTAINER_OPERATION_EVENT_TYPE = 'DOCKER_CONTAINER_CONTROL';
const DOCKER_OPERATION_EVENT_TYPES = [DOCKER_OPERATION_EVENT_TYPE, DOCKER_CONTAINER_OPERATION_EVENT_TYPE];
const activeDockerProjectControls = new Set();
const activeDockerContainerControls = new Set();

async function defaultAuditRecorder(event) {
  const authService = require('./authService');
  return authService.recordAuditEvent(event);
}

async function defaultQueryExecutor(text, params) {
  const { query } = require('../../../../packages/db/src/connection');
  return query(text, params);
}

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function normalizeAction(value) {
  const action = normalizeText(value).toUpperCase();
  if (!DOCKER_CONTROL_ACTIONS.has(action)) {
    const error = new Error(`Docker Compose action '${action || 'blank'}' is not allowed.`);
    error.statusCode = 400;
    error.details = { allowedActions: [...DOCKER_CONTROL_ACTIONS] };
    throw error;
  }
  return action;
}

function parseConfigFiles(project = {}) {
  if (Array.isArray(project.configFileList)) {
    return [...new Set(project.configFileList.map((item) => normalizeText(item)).filter(Boolean))];
  }

  return [...new Set(
    normalizeText(project.configFiles)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function getSelfDockerProjectName() {
  return normalizeText(process.env.SKYCOMMAND_DOCKER_SELF_PROJECT_NAME, 'skycommand').toLowerCase();
}

function buildProjectControl(project = {}) {
  const projectName = normalizeText(project.name);
  const state = normalizeText(project.state, 'UNKNOWN').toUpperCase();
  const configFileList = parseConfigFiles(project);
  const selfManaged = Boolean(projectName) && projectName.toLowerCase() === getSelfDockerProjectName();
  const hasConfiguration = configFileList.length > 0;
  const allowed = !selfManaged && hasConfiguration;

  return {
    mode: selfManaged ? 'SELF_MANAGED_PROTECTED' : 'HOST_AGENT',
    allowed,
    reasonCode: selfManaged
      ? 'SKYCOMMAND_DOCKER_SELF_CONTROL_BLOCKED'
      : hasConfiguration
        ? null
        : 'SKYCOMMAND_DOCKER_PROJECT_CONFIG_MISSING',
    actions: {
      start: allowed && ['STOPPED', 'PARTIAL', 'CREATED'].includes(state),
      stop: allowed && ['RUNNING', 'PARTIAL', 'RESTARTING'].includes(state),
      restart: allowed && ['RUNNING', 'PARTIAL'].includes(state),
    },
  };
}

function buildContainerControl(container = {}) {
  const projectName = normalizeText(container.project);
  const state = normalizeText(container.state, 'UNKNOWN').toUpperCase();
  const selfManaged = Boolean(projectName) && projectName.toLowerCase() === getSelfDockerProjectName();
  const allowed = !selfManaged;

  return {
    mode: selfManaged ? 'SELF_MANAGED_PROTECTED' : 'HOST_AGENT',
    allowed,
    reasonCode: selfManaged ? 'SKYCOMMAND_DOCKER_SELF_CONTROL_BLOCKED' : null,
    actions: {
      start: allowed && ['EXITED', 'CREATED', 'DEAD'].includes(state),
      stop: allowed && ['RUNNING', 'RESTARTING'].includes(state),
      restart: allowed && state === 'RUNNING',
      pause: allowed && state === 'RUNNING',
      unpause: allowed && state === 'PAUSED',
    },
  };
}

function decorateDockerOverview(snapshot = {}) {
  return {
    ...snapshot,
    projects: (Array.isArray(snapshot.projects) ? snapshot.projects : []).map((project) => ({
      ...project,
      configFileList: parseConfigFiles(project),
      control: buildProjectControl(project),
    })),
    containers: (Array.isArray(snapshot.containers) ? snapshot.containers : []).map((container) => ({
      ...container,
      control: buildContainerControl(container),
    })),
  };
}

function buildDockerTarget(availability = {}) {
  const status = !availability.enabled
    ? 'DISABLED'
    : availability.online
      ? 'ONLINE'
      : availability.status || 'OFFLINE';

  return {
    targetCode: normalizeText(process.env.SKYCOMMAND_DOCKER_TARGET_CODE, 'LOCAL_DOCKER'),
    displayName: normalizeText(process.env.SKYCOMMAND_DOCKER_TARGET_NAME, 'Local Docker'),
    providerCode: DOCKER_PROVIDER_CODE,
    transport: 'HOST_AGENT',
    status,
    taskQueue: availability.taskQueue || normalizeHostAgentTaskQueue(
      process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
    ),
    hostname:
      availability.liveProbe?.hostname || availability.latestHeartbeat?.hostname || null,
    profileCode:
      availability.liveProbe?.profileCode ||
      availability.latestHeartbeat?.metadata?.profileCode ||
      null,
    availabilitySource: availability.availabilitySource || 'NONE',
  };
}

function buildUnavailableDockerOverview(availability = {}, error = null) {
  const target = buildDockerTarget(availability);
  const status = target.status === 'ONLINE' ? 'OFFLINE' : target.status;

  return {
    target: {
      ...target,
      status,
    },
    provider: {
      code: DOCKER_PROVIDER_CODE,
      status,
      engineVersion: '',
      engineName: '',
      operatingSystem: '',
      osType: '',
      architecture: '',
      cpuCount: 0,
      memoryBytes: 0,
      storageDriver: '',
    },
    host: {
      hostname: target.hostname,
      platform: null,
      architecture: null,
    },
    counts: {
      projects: 0,
      containers: 0,
      running: 0,
      stopped: 0,
      healthy: 0,
      unhealthy: 0,
      images: 0,
      volumes: 0,
      networks: 0,
    },
    projects: [],
    containers: [],
    images: [],
    volumes: [],
    networks: [],
    error: error
      ? {
          code: normalizeText(error.code, 'SKYCOMMAND_DOCKER_UNAVAILABLE'),
          message: normalizeText(error.message, 'Docker provider is unavailable.'),
          details: error.details || null,
        }
      : availability.enabled
        ? {
            code: 'SKYCOMMAND_HOST_AGENT_UNAVAILABLE',
            message: 'SkyCommand Host Agent is unavailable for Docker inventory.',
            details: {
              taskQueue: target.taskQueue,
              availabilitySource: target.availabilitySource,
            },
          }
        : {
            code: 'SKYCOMMAND_HOST_AGENT_DISABLED',
            message: 'SkyCommand Host Agent is disabled. Docker inventory requires host execution.',
            details: {
              taskQueue: target.taskQueue,
            },
          },
    capturedAt: new Date().toISOString(),
  };
}

async function executeHostAgentWorkflow(input, {
  temporalConfig = getTemporalConfig(),
  workflowIdPrefix = 'skycommand-host-agent',
  workflowExecutionTimeout = '25 seconds',
} = {}) {
  const { Connection, Client } = require('@temporalio/client');
  const hostTaskQueue = normalizeHostAgentTaskQueue(
    process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
  );
  const connection = await Connection.connect({ address: temporalConfig.address });

  try {
    const client = new Client({
      connection,
      namespace: temporalConfig.namespace,
    });

    return await client.workflow.execute('skyCommandHostAgentToolWorkflow', {
      taskQueue: temporalConfig.taskQueue,
      workflowId: `${workflowIdPrefix}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      workflowExecutionTimeout,
      args: [
        {
          ...input,
          hostTaskQueue,
        },
      ],
    });
  } finally {
    await connection.close().catch(() => {});
  }
}

async function dispatchDockerSnapshot(options = {}) {
  return executeHostAgentWorkflow(
    { toolCode: DOCKER_SNAPSHOT_TOOL_CODE },
    {
      ...options,
      workflowIdPrefix: 'skycommand-docker-overview',
      workflowExecutionTimeout: '25 seconds',
    },
  );
}

async function dispatchDockerComposeControl({ projectName, action, configFiles }, options = {}) {
  return executeHostAgentWorkflow(
    {
      toolCode: DOCKER_COMPOSE_CONTROL_TOOL_CODE,
      projectName,
      action,
      configFiles,
    },
    {
      ...options,
      workflowIdPrefix: `skycommand-docker-${action.toLowerCase()}`,
      workflowExecutionTimeout: '4 minutes',
    },
  );
}

async function dispatchDockerContainerDetail({ containerId, tail = 200 }, options = {}) {
  return executeHostAgentWorkflow(
    {
      toolCode: DOCKER_CONTAINER_DETAIL_TOOL_CODE,
      containerId,
      tail,
    },
    {
      ...options,
      workflowIdPrefix: 'skycommand-docker-container-detail',
      workflowExecutionTimeout: '30 seconds',
    },
  );
}

async function dispatchDockerContainerControl({ containerId, action }, options = {}) {
  return executeHostAgentWorkflow(
    {
      toolCode: DOCKER_CONTAINER_CONTROL_TOOL_CODE,
      containerId,
      action,
    },
    {
      ...options,
      workflowIdPrefix: `skycommand-docker-container-${action.toLowerCase()}`,
      workflowExecutionTimeout: '3 minutes',
    },
  );
}

async function getDockerOverview({ availabilityLoader = getHostAgentAvailability, dispatcher = dispatchDockerSnapshot } = {}) {
  let availability;

  try {
    availability = await availabilityLoader();
  } catch (error) {
    return buildUnavailableDockerOverview(
      {
        enabled: true,
        online: false,
        status: 'UNKNOWN',
        taskQueue: normalizeHostAgentTaskQueue(
          process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
        ),
      },
      {
        code: 'SKYCOMMAND_HOST_AGENT_STATUS_FAILED',
        message: error?.message || 'Unable to determine Host Agent availability.',
      },
    );
  }

  if (!availability.enabled || !availability.online) {
    return buildUnavailableDockerOverview(availability);
  }

  try {
    const response = await dispatcher();

    if (!response?.ok) {
      return buildUnavailableDockerOverview(availability, response?.error || null);
    }

    const snapshot = decorateDockerOverview(response.result || {});
    const target = buildDockerTarget(availability);
    return {
      ...snapshot,
      target: {
        ...target,
        status: 'ONLINE',
        hostname: snapshot.host?.hostname || target.hostname,
      },
      provider: {
        ...(snapshot.provider || {}),
        code: DOCKER_PROVIDER_CODE,
        status: snapshot.provider?.status || 'ONLINE',
      },
      error: null,
    };
  } catch (error) {
    return buildUnavailableDockerOverview(availability, {
      code: 'SKYCOMMAND_DOCKER_DISPATCH_FAILED',
      message: error?.message || 'Docker inventory dispatch failed.',
    });
  }
}

function createControlError(statusCode, code, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = { code, ...details };
  return error;
}

async function recordDockerOperation({
  auditRecorder = defaultAuditRecorder,
  actor = {},
  session = {},
  requestContext = {},
  operationId,
  projectName,
  action,
  success,
  message,
  metadata = {},
}) {
  await auditRecorder({
    appCode: session?.appCode,
    userId: actor?.userId || null,
    eventType: DOCKER_OPERATION_EVENT_TYPE,
    resourceType: 'docker_compose_project',
    resourceId: projectName,
    action: action.toLowerCase(),
    success,
    message,
    metadata: {
      operationId,
      providerCode: DOCKER_PROVIDER_CODE,
      projectName,
      requestedAction: action,
      ...metadata,
    },
    ipAddress: requestContext?.ipAddress || null,
    userAgent: requestContext?.userAgent || null,
  });
}

async function controlDockerComposeProject({
  projectName,
  action,
  confirmed = false,
  actor = {},
  session = {},
  requestContext = {},
  overviewLoader = getDockerOverview,
  dispatcher = dispatchDockerComposeControl,
  auditRecorder = defaultAuditRecorder,
} = {}) {
  const normalizedAction = normalizeAction(action);
  const requestedProjectName = normalizeText(projectName);
  const operationId = randomUUID();
  let canonicalProjectName = requestedProjectName;
  let previousState = 'UNKNOWN';
  let targetCode = normalizeText(process.env.SKYCOMMAND_DOCKER_TARGET_CODE, 'LOCAL_DOCKER');

  try {
    if (!confirmed) {
      throw createControlError(
        400,
        'SKYCOMMAND_DOCKER_CONFIRMATION_REQUIRED',
        'Docker Compose lifecycle actions require explicit confirmation.',
      );
    }

    const before = await overviewLoader();
    if (before?.error || before?.target?.status !== 'ONLINE') {
      throw createControlError(
        503,
        before?.error?.code || 'SKYCOMMAND_DOCKER_UNAVAILABLE',
        before?.error?.message || 'Docker provider is unavailable.',
        before?.error?.details || {},
      );
    }

    targetCode = normalizeText(before?.target?.targetCode, targetCode);
    const project = (before.projects || []).find(
      (candidate) => normalizeText(candidate.name).toLowerCase() === requestedProjectName.toLowerCase(),
    );

    if (!project) {
      throw createControlError(
        404,
        'SKYCOMMAND_DOCKER_PROJECT_NOT_FOUND',
        `Docker Compose project '${requestedProjectName || 'blank'}' was not discovered on the target.`,
      );
    }

    canonicalProjectName = project.name;
    previousState = normalizeText(project.state, 'UNKNOWN').toUpperCase();
    const control = buildProjectControl(project);

    if (!control.allowed) {
      const selfManaged = control.reasonCode === 'SKYCOMMAND_DOCKER_SELF_CONTROL_BLOCKED';
      throw createControlError(
        409,
        control.reasonCode || 'SKYCOMMAND_DOCKER_PROJECT_CONTROL_BLOCKED',
        selfManaged
          ? 'SkyCommand protects its own Compose project from synchronous lifecycle controls so the control plane cannot terminate itself mid-operation.'
          : 'Docker Compose project control is unavailable because its discovered configuration cannot be resolved safely.',
        { projectName: canonicalProjectName },
      );
    }

    const actionKey = normalizedAction.toLowerCase();
    if (!control.actions[actionKey]) {
      throw createControlError(
        409,
        'SKYCOMMAND_DOCKER_ACTION_STATE_CONFLICT',
        `${normalizedAction} is not available while project '${canonicalProjectName}' is ${previousState}.`,
        { projectName: canonicalProjectName, state: previousState, action: normalizedAction },
      );
    }

    const configFiles = parseConfigFiles(project);
    const lockKey = `${targetCode}:${canonicalProjectName}`.toLowerCase();
    if (activeDockerProjectControls.has(lockKey)) {
      throw createControlError(
        409,
        'SKYCOMMAND_DOCKER_PROJECT_BUSY',
        `Docker Compose project '${canonicalProjectName}' already has a lifecycle action in progress.`,
        { projectName: canonicalProjectName },
      );
    }

    activeDockerProjectControls.add(lockKey);
    const startedAt = Date.now();
    let response;
    try {
      response = await dispatcher({
        projectName: canonicalProjectName,
        action: normalizedAction,
        configFiles,
      });
    } finally {
      activeDockerProjectControls.delete(lockKey);
    }

    if (!response?.ok) {
      throw createControlError(
        502,
        response?.error?.code || 'SKYCOMMAND_DOCKER_CONTROL_FAILED',
        response?.error?.message || 'Docker Compose lifecycle action failed on the Host Agent.',
        response?.error?.details || {},
      );
    }

    const after = await overviewLoader();
    const resultingProject = (after?.projects || []).find(
      (candidate) => normalizeText(candidate.name).toLowerCase() === canonicalProjectName.toLowerCase(),
    );
    const resultingState = normalizeText(resultingProject?.state, previousState).toUpperCase();
    const durationMs = Math.max(Date.now() - startedAt, 0);
    const message = `${normalizedAction} completed for Docker Compose project '${canonicalProjectName}'.`;

    let auditPersisted = true;
    try {
      await recordDockerOperation({
        auditRecorder,
        actor,
        session,
        requestContext,
        operationId,
        projectName: canonicalProjectName,
        action: normalizedAction,
        success: true,
        message,
        metadata: {
          targetCode,
          previousState,
          resultingState,
          durationMs,
          transport: 'HOST_AGENT',
          configFileCount: configFiles.length,
        },
      });
    } catch (auditError) {
      auditPersisted = false;
      console.warn('[SkyCommand Infrastructure] Successful Docker operation audit failed:', auditError.message);
    }

    return {
      operation: {
        operationId,
        providerCode: DOCKER_PROVIDER_CODE,
        targetCode,
        projectName: canonicalProjectName,
        action: normalizedAction,
        status: 'SUCCESS',
        previousState,
        resultingState,
        durationMs,
        auditPersisted,
        message,
        completedAt: new Date().toISOString(),
      },
      overview: after,
    };
  } catch (error) {
    const message = error?.message || 'Docker Compose lifecycle action failed.';

    try {
      await recordDockerOperation({
        auditRecorder,
        actor,
        session,
        requestContext,
        operationId,
        projectName: canonicalProjectName || requestedProjectName || 'unknown',
        action: normalizedAction,
        success: false,
        message,
        metadata: {
          targetCode,
          previousState,
          errorCode: error?.code || error?.details?.code || 'SKYCOMMAND_DOCKER_CONTROL_FAILED',
          statusCode: error?.statusCode || 500,
          transport: 'HOST_AGENT',
        },
      });
    } catch (auditError) {
      console.warn('[SkyCommand Infrastructure] Docker operation audit failed:', auditError.message);
    }

    throw error;
  }
}

function findDockerContainer(overview = {}, containerReference = '') {
  const requested = normalizeText(containerReference).toLowerCase();
  if (!requested) return null;

  return (overview.containers || []).find((container) => {
    const id = normalizeText(container.id).toLowerCase();
    const name = normalizeText(container.name).toLowerCase();
    const idMatch =
      id.length >= 12 &&
      requested.length >= 12 &&
      (id === requested || id.startsWith(requested) || requested.startsWith(id));
    return idMatch || name === requested;
  }) || null;
}

function normalizeLogTail(value, fallback = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 1000);
}

async function getDockerContainerDetail({
  containerId,
  tail = 200,
  overviewLoader = getDockerOverview,
  dispatcher = dispatchDockerContainerDetail,
} = {}) {
  const overview = await overviewLoader();
  if (overview?.error || overview?.target?.status !== 'ONLINE') {
    throw createControlError(
      503,
      overview?.error?.code || 'SKYCOMMAND_DOCKER_UNAVAILABLE',
      overview?.error?.message || 'Docker provider is unavailable.',
      overview?.error?.details || {},
    );
  }

  const inventoryContainer = findDockerContainer(overview, containerId);
  if (!inventoryContainer) {
    throw createControlError(
      404,
      'SKYCOMMAND_DOCKER_CONTAINER_NOT_FOUND',
      'Docker container was not discovered on the target.',
    );
  }

  const response = await dispatcher({
    containerId: inventoryContainer.id,
    tail: normalizeLogTail(tail),
  });

  if (!response?.ok) {
    throw createControlError(
      502,
      response?.error?.code || 'SKYCOMMAND_DOCKER_CONTAINER_DETAIL_FAILED',
      response?.error?.message || 'Docker container inspection failed on the Host Agent.',
      response?.error?.details || {},
    );
  }

  const detail = response.result || {};
  const detailContainer = detail.container || {};
  return {
    providerCode: DOCKER_PROVIDER_CODE,
    targetCode: overview.target?.targetCode || null,
    container: {
      ...inventoryContainer,
      ...detailContainer,
      id: detailContainer.id || inventoryContainer.id,
      inventoryId: inventoryContainer.id,
      name: detailContainer.name || inventoryContainer.name,
      project: detailContainer.project || inventoryContainer.project,
      service: detailContainer.service || inventoryContainer.service,
      inventoryState: inventoryContainer.state,
      control: buildContainerControl(inventoryContainer),
    },
    logs: detail.logs || {
      stdout: '',
      stderr: '',
      available: false,
      truncated: false,
      tail: normalizeLogTail(tail),
    },
    capturedAt: detail.capturedAt || new Date().toISOString(),
    transport: detail.transport || 'HOST_AGENT',
  };
}

async function recordDockerContainerOperation({
  auditRecorder = defaultAuditRecorder,
  actor = {},
  session = {},
  requestContext = {},
  operationId,
  container = {},
  action,
  success,
  message,
  metadata = {},
}) {
  await auditRecorder({
    appCode: session?.appCode,
    userId: actor?.userId || null,
    eventType: DOCKER_CONTAINER_OPERATION_EVENT_TYPE,
    resourceType: 'docker_container',
    resourceId: container.name || container.id || 'unknown',
    action: action.toLowerCase(),
    success,
    message,
    metadata: {
      operationId,
      providerCode: DOCKER_PROVIDER_CODE,
      containerId: container.id || null,
      containerName: container.name || null,
      projectName: container.project || null,
      serviceName: container.service || null,
      requestedAction: action,
      ...metadata,
    },
    ipAddress: requestContext?.ipAddress || null,
    userAgent: requestContext?.userAgent || null,
  });
}

function normalizeContainerAction(value) {
  const action = normalizeText(value).toUpperCase();
  if (!DOCKER_CONTAINER_CONTROL_ACTIONS.has(action)) {
    throw createControlError(
      400,
      'SKYCOMMAND_DOCKER_CONTAINER_ACTION_NOT_ALLOWED',
      `Docker container action '${action || 'blank'}' is not allowed.`,
      { allowedActions: [...DOCKER_CONTAINER_CONTROL_ACTIONS] },
    );
  }
  return action;
}

async function controlDockerContainer({
  containerId,
  action,
  confirmed = false,
  actor = {},
  session = {},
  requestContext = {},
  overviewLoader = getDockerOverview,
  dispatcher = dispatchDockerContainerControl,
  auditRecorder = defaultAuditRecorder,
} = {}) {
  const normalizedAction = normalizeContainerAction(action);
  const requestedContainerId = normalizeText(containerId);
  const operationId = randomUUID();
  let container = { id: requestedContainerId, name: requestedContainerId };
  let previousState = 'UNKNOWN';
  let targetCode = normalizeText(process.env.SKYCOMMAND_DOCKER_TARGET_CODE, 'LOCAL_DOCKER');

  try {
    if (!confirmed) {
      throw createControlError(
        400,
        'SKYCOMMAND_DOCKER_CONFIRMATION_REQUIRED',
        'Docker container lifecycle actions require explicit confirmation.',
      );
    }

    const before = await overviewLoader();
    if (before?.error || before?.target?.status !== 'ONLINE') {
      throw createControlError(
        503,
        before?.error?.code || 'SKYCOMMAND_DOCKER_UNAVAILABLE',
        before?.error?.message || 'Docker provider is unavailable.',
        before?.error?.details || {},
      );
    }

    targetCode = normalizeText(before?.target?.targetCode, targetCode);
    const discovered = findDockerContainer(before, requestedContainerId);
    if (!discovered) {
      throw createControlError(
        404,
        'SKYCOMMAND_DOCKER_CONTAINER_NOT_FOUND',
        'Docker container was not discovered on the target.',
      );
    }

    container = discovered;
    previousState = normalizeText(discovered.state, 'UNKNOWN').toUpperCase();
    const control = buildContainerControl(discovered);

    if (!control.allowed) {
      throw createControlError(
        409,
        control.reasonCode || 'SKYCOMMAND_DOCKER_CONTAINER_CONTROL_BLOCKED',
        'SkyCommand protects containers in its own Compose project from synchronous lifecycle controls so the control plane cannot terminate itself mid-operation.',
        { containerId: discovered.id, containerName: discovered.name, projectName: discovered.project },
      );
    }

    const actionKey = normalizedAction.toLowerCase();
    if (!control.actions[actionKey]) {
      throw createControlError(
        409,
        'SKYCOMMAND_DOCKER_CONTAINER_ACTION_STATE_CONFLICT',
        `${normalizedAction} is not available while container '${discovered.name || discovered.id}' is ${previousState}.`,
        { containerId: discovered.id, state: previousState, action: normalizedAction },
      );
    }

    const lockKey = `${targetCode}:${discovered.id}`.toLowerCase();
    if (activeDockerContainerControls.has(lockKey)) {
      throw createControlError(
        409,
        'SKYCOMMAND_DOCKER_CONTAINER_BUSY',
        `Docker container '${discovered.name || discovered.id}' already has a lifecycle action in progress.`,
        { containerId: discovered.id },
      );
    }

    activeDockerContainerControls.add(lockKey);
    const startedAt = Date.now();
    let response;
    try {
      response = await dispatcher({
        containerId: discovered.id,
        action: normalizedAction,
      });
    } finally {
      activeDockerContainerControls.delete(lockKey);
    }

    if (!response?.ok) {
      throw createControlError(
        502,
        response?.error?.code || 'SKYCOMMAND_DOCKER_CONTAINER_CONTROL_FAILED',
        response?.error?.message || 'Docker container lifecycle action failed on the Host Agent.',
        response?.error?.details || {},
      );
    }

    const after = await overviewLoader();
    const resultingContainer = findDockerContainer(after, discovered.id);
    const resultingState = normalizeText(resultingContainer?.state, previousState).toUpperCase();
    const durationMs = Math.max(Date.now() - startedAt, 0);
    const message = `${normalizedAction} completed for Docker container '${discovered.name || discovered.id}'.`;

    let auditPersisted = true;
    try {
      await recordDockerContainerOperation({
        auditRecorder,
        actor,
        session,
        requestContext,
        operationId,
        container: discovered,
        action: normalizedAction,
        success: true,
        message,
        metadata: {
          targetCode,
          previousState,
          resultingState,
          durationMs,
          transport: 'HOST_AGENT',
        },
      });
    } catch (auditError) {
      auditPersisted = false;
      console.warn('[SkyCommand Infrastructure] Successful Docker container operation audit failed:', auditError.message);
    }

    return {
      operation: {
        operationId,
        providerCode: DOCKER_PROVIDER_CODE,
        targetCode,
        resourceType: 'CONTAINER',
        containerId: discovered.id,
        containerName: discovered.name,
        projectName: discovered.project || null,
        serviceName: discovered.service || null,
        action: normalizedAction,
        status: 'SUCCESS',
        previousState,
        resultingState,
        durationMs,
        auditPersisted,
        message,
        completedAt: new Date().toISOString(),
      },
      overview: after,
    };
  } catch (error) {
    const message = error?.message || 'Docker container lifecycle action failed.';

    try {
      await recordDockerContainerOperation({
        auditRecorder,
        actor,
        session,
        requestContext,
        operationId,
        container,
        action: normalizedAction,
        success: false,
        message,
        metadata: {
          targetCode,
          previousState,
          errorCode: error?.code || error?.details?.code || 'SKYCOMMAND_DOCKER_CONTAINER_CONTROL_FAILED',
          statusCode: error?.statusCode || 500,
          transport: 'HOST_AGENT',
        },
      });
    } catch (auditError) {
      console.warn('[SkyCommand Infrastructure] Docker container operation audit failed:', auditError.message);
    }

    throw error;
  }
}

function normalizeLimit(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.trunc(parsed), 0);
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return null;
}

async function listDockerOperations(filters = {}, { queryExecutor = defaultQueryExecutor } = {}) {
  const limit = normalizeLimit(filters.limit, 20);
  const offset = normalizeOffset(filters.offset);
  const scope = normalizeText(filters.scope).toUpperCase();
  const eventTypes = scope === 'COMPOSE'
    ? [DOCKER_OPERATION_EVENT_TYPE]
    : scope === 'CONTAINER'
      ? [DOCKER_CONTAINER_OPERATION_EVENT_TYPE]
      : DOCKER_OPERATION_EVENT_TYPES;
  const conditions = ['event_type = ANY($1::text[])'];
  const params = [eventTypes];

  const projectName = normalizeText(filters.projectName || filters.project);
  if (projectName) {
    params.push(projectName);
    conditions.push(
      `LOWER(COALESCE(metadata->>'projectName', CASE WHEN event_type = '${DOCKER_OPERATION_EVENT_TYPE}' THEN resource_id END, '')) = LOWER($${params.length})`,
    );
  }

  const action = normalizeText(filters.action).toLowerCase();
  const allowedActions = new Set([...DOCKER_CONTROL_ACTIONS, ...DOCKER_CONTAINER_CONTROL_ACTIONS]);
  if (action && allowedActions.has(action.toUpperCase())) {
    params.push(action);
    conditions.push(`LOWER(action) = LOWER($${params.length})`);
  }

  const success = parseOptionalBoolean(filters.success);
  if (success !== null) {
    params.push(success);
    conditions.push(`success = $${params.length}`);
  }

  const whereSql = conditions.join(' AND ');
  const countResult = await queryExecutor(
    `SELECT COUNT(*)::int AS total FROM auth.vw_audit_events_recent WHERE ${whereSql}`,
    params,
  );

  const pageParams = [...params, limit, offset];
  const result = await queryExecutor(
    `
      SELECT
        audit_event_id,
        user_id,
        email,
        username,
        display_name,
        event_type,
        resource_type,
        resource_id,
        action,
        success,
        message,
        metadata,
        created_at
      FROM auth.vw_audit_events_recent
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${pageParams.length - 1}
      OFFSET $${pageParams.length}
    `,
    pageParams,
  );

  return {
    items: (result.rows || []).map((row) => {
      const containerOperation = row.event_type === DOCKER_CONTAINER_OPERATION_EVENT_TYPE;
      return {
        operationId: row.metadata?.operationId || row.audit_event_id,
        auditEventId: row.audit_event_id,
        resourceType: containerOperation ? 'CONTAINER' : 'COMPOSE_PROJECT',
        resourceName: containerOperation
          ? row.metadata?.containerName || row.resource_id
          : row.resource_id,
        projectName: row.metadata?.projectName || (containerOperation ? null : row.resource_id),
        containerId: row.metadata?.containerId || null,
        containerName: row.metadata?.containerName || null,
        serviceName: row.metadata?.serviceName || null,
        action: normalizeText(row.action).toUpperCase(),
        status: row.success ? 'SUCCESS' : 'FAILED',
        success: Boolean(row.success),
        message: row.message,
        actor: row.display_name || row.username || row.email || 'System',
        userId: row.user_id,
        targetCode: row.metadata?.targetCode || null,
        previousState: row.metadata?.previousState || null,
        resultingState: row.metadata?.resultingState || null,
        durationMs: row.metadata?.durationMs ?? null,
        errorCode: row.metadata?.errorCode || null,
        createdAt: row.created_at,
      };
    }),
    total: Number(countResult.rows?.[0]?.total || 0),
    limit,
    offset,
  };
}

module.exports = {
  DOCKER_COMPOSE_CONTROL_TOOL_CODE,
  DOCKER_CONTAINER_CONTROL_ACTIONS,
  DOCKER_CONTAINER_CONTROL_TOOL_CODE,
  DOCKER_CONTAINER_DETAIL_TOOL_CODE,
  DOCKER_CONTAINER_OPERATION_EVENT_TYPE,
  DOCKER_CONTROL_ACTIONS,
  DOCKER_OPERATION_EVENT_TYPE,
  DOCKER_PROVIDER_CODE,
  DOCKER_SNAPSHOT_TOOL_CODE,
  buildContainerControl,
  buildDockerTarget,
  buildProjectControl,
  buildUnavailableDockerOverview,
  controlDockerComposeProject,
  controlDockerContainer,
  decorateDockerOverview,
  dispatchDockerComposeControl,
  dispatchDockerContainerControl,
  dispatchDockerContainerDetail,
  dispatchDockerSnapshot,
  findDockerContainer,
  getDockerContainerDetail,
  getDockerOverview,
  listDockerOperations,
  parseConfigFiles,
};
