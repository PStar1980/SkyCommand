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
const DOCKER_CONTROL_ACTIONS = new Set(['START', 'STOP', 'RESTART']);
const DOCKER_OPERATION_EVENT_TYPE = 'DOCKER_COMPOSE_CONTROL';
const activeDockerProjectControls = new Set();

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

function decorateDockerOverview(snapshot = {}) {
  return {
    ...snapshot,
    projects: (Array.isArray(snapshot.projects) ? snapshot.projects : []).map((project) => ({
      ...project,
      configFileList: parseConfigFiles(project),
      control: buildProjectControl(project),
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
  const conditions = ['event_type = $1'];
  const params = [DOCKER_OPERATION_EVENT_TYPE];

  const projectName = normalizeText(filters.projectName || filters.project);
  if (projectName) {
    params.push(projectName);
    conditions.push(`LOWER(resource_id) = LOWER($${params.length})`);
  }

  const action = normalizeText(filters.action).toLowerCase();
  if (action && DOCKER_CONTROL_ACTIONS.has(action.toUpperCase())) {
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
    items: (result.rows || []).map((row) => ({
      operationId: row.metadata?.operationId || row.audit_event_id,
      auditEventId: row.audit_event_id,
      projectName: row.resource_id,
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
    })),
    total: Number(countResult.rows?.[0]?.total || 0),
    limit,
    offset,
  };
}

module.exports = {
  DOCKER_COMPOSE_CONTROL_TOOL_CODE,
  DOCKER_CONTROL_ACTIONS,
  DOCKER_OPERATION_EVENT_TYPE,
  DOCKER_PROVIDER_CODE,
  DOCKER_SNAPSHOT_TOOL_CODE,
  buildDockerTarget,
  buildProjectControl,
  buildUnavailableDockerOverview,
  controlDockerComposeProject,
  decorateDockerOverview,
  dispatchDockerComposeControl,
  dispatchDockerSnapshot,
  getDockerOverview,
  listDockerOperations,
  parseConfigFiles,
};
