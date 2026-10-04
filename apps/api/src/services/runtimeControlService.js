const { randomUUID } = require('node:crypto');
const { getHostAgentAvailability } = require('./workflowExecutionPreflightService');
const { authorizeRuntimeControl } = require('./supervisorLifecycleGrantService');

function getSupervisorBaseUrl(environment) {
  return require('./orchestratorRefreshService').getSupervisorBaseUrl(environment);
}

function recordAuditEvent(event) {
  return require('./authService').recordAuditEvent(event);
}

function dispatchSupervisorProcessLifecycle(input) {
  return require('./infrastructureService').dispatchSupervisorProcessLifecycle(input);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_TIMEOUT_MS = 5000;
const CONTROL_TIMEOUT_MS = 15000;
const ASSISTANT_AGENT_ID = 'codex-local';
const ASSISTANT_PERMISSION = 'DEV_RUNTIME_LIFECYCLE';
const HUMAN_PERMISSION = 'INFRASTRUCTURE_DOCKER_CONTROL';
const HUMAN_READ_PERMISSION = 'INFRASTRUCTURE_DOCKER_READ';
const EVENT_TYPE = 'SKYCOMMAND_RUNTIME_CONTROL_AUTHORIZED';

const ACTIONS = Object.freeze({
  REBUILD_FRONTEND: Object.freeze({ action: 'REBUILD_WEB', path: '/runtime/rebuild-web', target: 'web' }),
  REBUILD_BACKEND: Object.freeze({ action: 'REBUILD_BACKEND', path: '/runtime/rebuild-backend', target: 'backend' }),
  RESTART_RUNTIME: Object.freeze({ action: 'RESTART', path: '/runtime/restart', target: 'runtime' }),
  STOP_RUNTIME: Object.freeze({ action: 'STOP', path: '/runtime/stop', target: 'runtime' }),
  START_HOST_AGENT: Object.freeze({ action: 'START_HOST_AGENT', path: '/runtime/start-host-agent', target: 'host-agent' }),
  RESTART_HOST_AGENT: Object.freeze({ action: 'RESTART_HOST_AGENT', path: '/runtime/restart-host-agent', target: 'host-agent' }),
  START_SUPERVISOR: Object.freeze({ action: 'START', target: 'supervisor' }),
  RESTART_SUPERVISOR: Object.freeze({ action: 'RESTART', target: 'supervisor' }),
});

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function createControlError(statusCode, code, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = { code, ...details };
  return error;
}

function normalizePermissions(permissions = []) {
  return new Set(
    (Array.isArray(permissions) ? permissions : [])
      .map((permission) =>
        typeof permission === 'string' ? permission : permission?.permissionCode,
      )
      .map((code) => normalizeText(code).toUpperCase())
      .filter(Boolean),
  );
}

function assertAuthority({ permissions = [], agentId = '', readOnly = false } = {}) {
  const granted = normalizePermissions(permissions);
  if (granted.has(HUMAN_PERMISSION)) return HUMAN_PERMISSION;
  if (readOnly && granted.has(HUMAN_READ_PERMISSION)) return HUMAN_READ_PERMISSION;
  if (granted.has(ASSISTANT_PERMISSION)) {
    if (normalizeText(agentId) !== ASSISTANT_AGENT_ID) {
      throw createControlError(
        403,
        'SKYCOMMAND_RUNTIME_CONTROL_PRINCIPAL_NOT_ALLOWED',
        'The Assistant principal is not authorized for DEV runtime controls.',
      );
    }
    return ASSISTANT_PERMISSION;
  }
  throw createControlError(
    403,
    'SKYCOMMAND_RUNTIME_CONTROL_PERMISSION_SCOPE_MISSING',
    'The caller lacks the required runtime-control permission.',
  );
}

function assertExactRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw createControlError(400, 'SKYCOMMAND_RUNTIME_CONTROL_INVALID_REQUEST', 'Runtime control request must be a JSON object.');
  }
  const unexpected = Object.keys(request).filter((key) => !['action', 'operationId'].includes(key));
  if (unexpected.length) {
    throw createControlError(400, 'SKYCOMMAND_RUNTIME_CONTROL_UNEXPECTED_FIELDS', 'Runtime control request contains unsupported fields.', {
      rejectedFieldCount: unexpected.length,
    });
  }
  const action = normalizeText(request.action).toUpperCase();
  if (!ACTIONS[action]) {
    throw createControlError(403, 'SKYCOMMAND_RUNTIME_CONTROL_ACTION_NOT_ALLOWED', 'The requested runtime-control action is not allowlisted.');
  }
  const operationId = normalizeText(request.operationId);
  if (!UUID_PATTERN.test(operationId)) {
    throw createControlError(400, 'SKYCOMMAND_RUNTIME_CONTROL_OPERATION_ID_INVALID', 'operationId must be a UUID for lifecycle correlation.');
  }
  return { action, operationId: operationId.toLowerCase() };
}

function safeSupervisorProjection(payload) {
  const services = Array.isArray(payload?.services) ? payload.services : [];
  const sanitizeOperation = (operation) => operation && typeof operation === 'object'
    ? {
        operationId: UUID_PATTERN.test(String(operation.operationId || '')) ? String(operation.operationId).toLowerCase() : null,
        action: normalizeText(operation.action).toUpperCase() || null,
        status: normalizeText(operation.status).toUpperCase() || null,
        requestedAt: operation.requestedAt || null,
        completedAt: operation.completedAt || null,
        code: normalizeText(operation.code).toUpperCase() || null,
      }
    : null;
  return {
    status: payload?.supervisor === 'ONLINE' ? 'ONLINE' : 'UNKNOWN',
    runtimeStatus: normalizeText(payload?.runtimeStatus).toUpperCase() || 'UNKNOWN',
    engineStatus: normalizeText(payload?.engineStatus).toUpperCase() || 'UNKNOWN',
    services: services.map((service) => ({
      service: normalizeText(service?.service),
      name: normalizeText(service?.name),
      state: normalizeText(service?.state).toUpperCase() || 'UNKNOWN',
      health: normalizeText(service?.health).toUpperCase() || null,
      running: service?.running === true,
    })),
    activeOperation: sanitizeOperation(payload?.operation),
    lastOperation: sanitizeOperation(payload?.lastOperation),
  };
}

async function loadSupervisorStatus({ fetcher = fetch, environment = process.env } = {}) {
  try {
    const response = await fetcher(`${getSupervisorBaseUrl(environment)}/runtime/status`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      return { ...safeSupervisorProjection(payload), status: 'UNKNOWN' };
    }
    return safeSupervisorProjection(payload);
  } catch (error) {
    return {
      status: error?.cause?.code === 'ECONNREFUSED' ? 'OFFLINE' : 'UNKNOWN',
      runtimeStatus: 'UNKNOWN',
      engineStatus: 'UNKNOWN',
      services: [],
      activeOperation: null,
      lastOperation: null,
    };
  }
}

function normalizedHostAgentState(availability = {}) {
  if (!availability.enabled) return 'DISABLED';
  if (availability.online) return 'ONLINE';
  if (String(availability.status || '').toUpperCase() === 'OFFLINE') return 'OFFLINE';
  return 'UNKNOWN';
}

function deriveAvailableActions(supervisor, hostAgent) {
  const actions = [];
  const runtimeActive = ['ONLINE', 'STARTING', 'PARTIAL', 'DEGRADED'].includes(supervisor.runtimeStatus);
  const supervisorLifecycleIdle = !supervisor.activeOperation;
  if (supervisor.status === 'ONLINE' && supervisor.engineStatus === 'ONLINE') {
    if (runtimeActive) actions.push('REBUILD_FRONTEND', 'REBUILD_BACKEND', 'STOP_RUNTIME');
    if (supervisor.runtimeStatus === 'ONLINE') actions.push('RESTART_RUNTIME');
  }
  if (supervisor.status === 'ONLINE') {
    if (hostAgent.status === 'ONLINE') {
      actions.push('RESTART_HOST_AGENT');
      if (supervisorLifecycleIdle) actions.push('RESTART_SUPERVISOR');
    }
    if (hostAgent.status === 'OFFLINE') actions.push('START_HOST_AGENT');
  }
  if (supervisor.status === 'OFFLINE' && hostAgent.status === 'ONLINE') {
    actions.push('START_SUPERVISOR');
  }
  return actions;
}

async function getRuntimeControlStatus({
  permissions = [],
  agentId = '',
  supervisorStatusLoader = loadSupervisorStatus,
  hostAgentAvailabilityLoader = getHostAgentAvailability,
} = {}) {
  assertAuthority({ permissions, agentId, readOnly: true });
  const [supervisorResult, availabilityResult] = await Promise.allSettled([
    supervisorStatusLoader(),
    hostAgentAvailabilityLoader(),
  ]);
  const supervisor = supervisorResult.status === 'fulfilled'
    ? supervisorResult.value
    : { status: 'UNKNOWN', runtimeStatus: 'UNKNOWN', engineStatus: 'UNKNOWN', services: [], activeOperation: null, lastOperation: null };
  const availability = availabilityResult.status === 'fulfilled'
    ? availabilityResult.value
    : { enabled: true, online: false, status: 'UNKNOWN' };
  const hostAgent = {
    status: normalizedHostAgentState(availability),
    enabled: availability?.enabled === true,
    online: availability?.online === true,
    taskQueue: normalizeText(availability?.taskQueue) || null,
    checkedAt: availability?.liveProbe?.checkedAt || availability?.latestHeartbeat?.lastSeenAt || null,
  };
  return {
    ok: true,
    supervisor,
    hostAgent,
    availableActions: deriveAvailableActions(supervisor, hostAgent),
    checkedAt: new Date().toISOString(),
  };
}

async function recordHostAgentSupervisorControl({
  action,
  operationId,
  permissionCode,
  actor = {},
  session = {},
  requestContext = {},
  auditRecorder = recordAuditEvent,
  supervisorProcessDispatcher = dispatchSupervisorProcessLifecycle,
}) {
  const processAction = action === 'START_SUPERVISOR' ? 'START' : 'RESTART';
  await auditRecorder({
    appCode: session?.appCode,
    userId: actor?.userId || null,
    eventType: EVENT_TYPE,
    resourceType: 'skycommand_runtime',
    resourceId: 'skycommand',
    action: action.toLowerCase(),
    success: true,
    message: `${action} authorized through the registered Host Agent lifecycle path.`,
    metadata: {
      transport: 'TEMPORAL_HOST_AGENT_PROCESS',
      permissionCode,
      operationId,
      requestedAction: action,
    },
    ipAddress: requestContext?.ipAddress || null,
    userAgent: requestContext?.userAgent || null,
  });
  const result = await supervisorProcessDispatcher({
    action: processAction,
    operationId,
  });
  if (!result?.ok || !['COMPLETED', 'ALREADY_RUNNING'].includes(String(result?.result?.outcome || '').toUpperCase())) {
    throw createControlError(
      502,
      result?.error?.code || 'SKYCOMMAND_SUPERVISOR_PROCESS_CONTROL_FAILED',
      'The registered Host Agent did not confirm the Supervisor process lifecycle operation.',
      { operationId },
    );
  }
  return {
    operation: {
      operationId,
      action,
      targetService: 'supervisor',
      status: 'COMPLETED',
      requestedAt: new Date().toISOString(),
      transport: 'TEMPORAL_HOST_AGENT_PROCESS',
      hostAgentResult: {
        outcome: result.result.outcome,
        transport: result.result.transport,
        workflowId: result.workflowId,
        processId: result.result.processId || null,
        previousProcessIds: Array.isArray(result.result.previousProcessIds) ? result.result.previousProcessIds : [],
      },
    },
  };
}

async function startRuntimeControl({
  request = {},
  permissions = [],
  agentId = '',
  actor = {},
  session = {},
  requestContext = {},
  statusLoader = getRuntimeControlStatus,
  authorize = authorizeRuntimeControl,
  fetcher = fetch,
  auditRecorder,
  supervisorProcessDispatcher,
} = {}) {
  const permissionCode = assertAuthority({ permissions, agentId });
  const { action, operationId } = assertExactRequest(request);
  const status = await statusLoader({ permissions, agentId });
  if (!status.availableActions.includes(action)) {
    throw createControlError(
      409,
      'SKYCOMMAND_RUNTIME_CONTROL_STATE_MISMATCH',
      'The requested control is unavailable for the currently observed runtime state.',
      { action, supervisorStatus: status.supervisor.status, hostAgentStatus: status.hostAgent.status },
    );
  }

  if (action === 'START_SUPERVISOR' || action === 'RESTART_SUPERVISOR') {
    return recordHostAgentSupervisorControl({
      action,
      operationId,
      permissionCode,
      actor,
      session,
      requestContext,
      auditRecorder,
      supervisorProcessDispatcher,
    });
  }

  const definition = ACTIONS[action];
  const authorization = await authorize({
    action: definition.action,
    operationId,
    permissionCode,
    confirmed: true,
    actor,
    session,
    requestContext,
  });
  let response;
  try {
    response = await fetcher(`${getSupervisorBaseUrl(process.env)}${definition.path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-SkyCommand-Supervisor-Grant': authorization.authorization.grant,
      },
      body: '{}',
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
  } catch (error) {
    throw createControlError(
      502,
      'SKYCOMMAND_RUNTIME_CONTROL_DISPATCH_OUTCOME_UNKNOWN',
      'The Supervisor control request outcome could not be confirmed. Inspect the current operation status before retrying.',
      { operationId, outcomeUnknown: true, transportCode: normalizeText(error?.cause?.code) || null },
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw createControlError(
      response.status || 502,
      payload?.code || 'SKYCOMMAND_RUNTIME_CONTROL_REJECTED',
      payload?.error || 'The Supervisor rejected the runtime control request.',
      { operationId },
    );
  }
  if (payload.operation?.operationId && payload.operation.operationId !== operationId) {
    throw createControlError(
      502,
      'SKYCOMMAND_RUNTIME_CONTROL_OPERATION_ID_MISMATCH',
      'Supervisor acceptance did not match the requested operation identity.',
      { operationId, supervisorOperationId: payload.operation.operationId },
    );
  }
  return {
    operation: {
      ...(payload.operation || {}),
      operationId,
      action,
      targetService: definition.target,
      status: 'REQUESTED',
      transport: 'HOST_SUPERVISOR_SIGNED_GRANT',
    },
  };
}

module.exports = {
  ACTIONS,
  ASSISTANT_AGENT_ID,
  ASSISTANT_PERMISSION,
  HUMAN_PERMISSION,
  assertAuthority,
  assertExactRequest,
  deriveAvailableActions,
  getRuntimeControlStatus,
  loadSupervisorStatus,
  startRuntimeControl,
};
