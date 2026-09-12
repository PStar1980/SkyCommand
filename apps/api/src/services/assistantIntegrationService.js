const authService = require('./authService');
const browserAutomationExecutionService = require('./browserAutomationExecutionService');
const browserAutomationRegistryService = require('./browserAutomationRegistryService');

const INTEGRATION_VERSION = 'skycommand_assistant_bridge.v1';
const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function permissionCodeSet(permissions = []) {
  return new Set((permissions || []).map((permission) => String(permission?.permissionCode || '').trim()).filter(Boolean));
}

function hasExecutionPermission(automation, permissions = []) {
  if (!automation.permissionCode) return false;
  return permissionCodeSet(permissions).has(automation.permissionCode);
}

function assistantEligibility(automation, permissions = []) {
  if (!automation?.assistantEnabled) {
    return { executable: false, blockedReason: 'ASSISTANT_NOT_ENABLED' };
  }
  if (automation.requiresConfirmation) {
    return { executable: false, blockedReason: 'HUMAN_CONFIRMATION_REQUIRED' };
  }
  if (!automation.permissionCode) {
    return { executable: false, blockedReason: 'EXECUTION_PERMISSION_REQUIRED' };
  }
  if (!hasExecutionPermission(automation, permissions)) {
    return { executable: false, blockedReason: 'ASSISTANT_PERMISSION_SCOPE_MISSING' };
  }
  return { executable: true, blockedReason: null };
}

function sanitizeParameter(parameter) {
  return {
    name: parameter.parameterName,
    label: parameter.label,
    type: parameter.type,
    prompt: parameter.prompt || null,
    required: Boolean(parameter.required),
    defaultValue: parameter.defaultValue ?? null,
    options: (parameter.options || []).filter((option) => option.enabled !== false).map((option) => ({
      label: option.label,
      value: option.value,
    })),
  };
}

function sanitizeAutomation(automation, permissions = []) {
  const eligibility = assistantEligibility(automation, permissions);
  return {
    automationCode: automation.automationCode,
    label: automation.label,
    description: automation.description || null,
    category: automation.category?.label || null,
    browserType: automation.browserType,
    executionMode: 'HEADLESS',
    defaultEnvironmentCode: automation.defaultEnvironmentCode,
    allowedEnvironmentCodes: (automation.environments || [])
      .filter((environment) => environment.enabled !== false)
      .map((environment) => environment.environmentCode),
    risk: {
      code: automation.riskCode,
      name: automation.riskName,
      rank: automation.riskRank,
    },
    sideEffectLevel: automation.sideEffectLevel,
    idempotencyMode: automation.idempotencyMode,
    requiresConfirmation: Boolean(automation.requiresConfirmation),
    confirmationText: automation.confirmationText || null,
    permissionCode: automation.permissionCode || null,
    output: {
      type: automation.outputType,
      schemaPath: automation.outputSchemaPath,
    },
    parameters: (automation.parameters || []).filter((parameter) => parameter.enabled !== false).map(sanitizeParameter),
    assistant: {
      enabled: Boolean(automation.assistantEnabled),
      executable: eligibility.executable,
      blockedReason: eligibility.blockedReason,
    },
  };
}

function sanitizeRun(run) {
  if (!run) return null;
  return {
    workflowId: run.workflowId,
    runId: run.runId || null,
    executionId: run.executionId,
    automationCode: run.automationCode,
    automationLabel: run.automationLabel,
    status: run.status,
    terminal: TERMINAL_STATUSES.has(String(run.status || '').toUpperCase()),
    triggerSource: run.triggerSource,
    environmentCode: run.environmentCode,
    executionMode: run.executionMode,
    parameters: run.parameters || {},
    sourceCommit: run.sourceCommit || null,
    sideEffectLevel: run.sideEffectLevel,
    idempotencyMode: run.idempotencyMode,
    riskCode: run.riskCode,
    startedAt: run.startTime || null,
    completedAt: run.closeTime || null,
    durationMs: run.durationMs ?? null,
    result: run.result || null,
    failure: run.failure || null,
    artifacts: (run.artifacts || []).map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      name: artifact.name,
      contentType: artifact.contentType || null,
      sizeBytes: artifact.sizeBytes ?? null,
      url: `/api/assistant/browser-automation-runs/${encodeURIComponent(run.workflowId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`,
    })),
  };
}

async function loadAssistantAutomation(automationCode, permissions = []) {
  const automation = await browserAutomationRegistryService.getBrowserAutomationByCode(automationCode, { includeDisabled: false });
  if (!automation || !automation.assistantEnabled) {
    throw createHttpError(404, 'Assistant-enabled Playwright Automation not found.', {
      code: 'ASSISTANT_AUTOMATION_NOT_FOUND',
      automationCode,
    });
  }
  return { automation, eligibility: assistantEligibility(automation, permissions) };
}

async function listAutomations(filters = {}, permissions = []) {
  const payload = await browserAutomationRegistryService.listBrowserAutomations({
    ...filters,
    assistantEnabled: true,
    limit: filters.limit || 100,
  });
  const items = [];
  for (const item of payload.items || []) {
    const detail = await browserAutomationRegistryService.getBrowserAutomationById(item.automationId, { includeDisabled: false });
    if (detail?.assistantEnabled) items.push(sanitizeAutomation(detail, permissions));
  }
  return { items, limit: payload.limit, offset: payload.offset };
}

async function getAutomation(automationCode, permissions = []) {
  const { automation } = await loadAssistantAutomation(automationCode, permissions);
  return sanitizeAutomation(automation, permissions);
}

async function startAutomation({ automationCode, body = {}, permissions = [], actor = null }) {
  const { automation, eligibility } = await loadAssistantAutomation(automationCode, permissions);

  if (body.executionMode && String(body.executionMode).trim().toUpperCase() !== 'HEADLESS') {
    throw createHttpError(400, 'Assistant integration supports HEADLESS Playwright Automation only.', {
      code: 'ASSISTANT_INTERACTIVE_EXECUTION_NOT_ALLOWED',
    });
  }

  if (!eligibility.executable) {
    const statusCode = eligibility.blockedReason === 'ASSISTANT_PERMISSION_SCOPE_MISSING' ? 403 : 409;
    throw createHttpError(statusCode, 'Playwright Automation is not executable through the Assistant integration.', {
      code: eligibility.blockedReason,
      automationCode: automation.automationCode,
      confirmationText: automation.requiresConfirmation ? automation.confirmationText : undefined,
      permissionCode: automation.permissionCode || undefined,
    });
  }

  const payload = await browserAutomationExecutionService.startRegisteredAutomation({
    automationCode: automation.automationCode,
    body: {
      environmentCode: body.environmentCode,
      parameters: body.parameters || {},
      executionMode: 'HEADLESS',
      confirmed: false,
    },
    permissions,
    actor,
    triggerSource: 'ASSISTANT',
  });

  return {
    automation: sanitizeAutomation(payload.automation, permissions),
    execution: {
      ...payload.execution,
      statusUrl: `/api/assistant/browser-automation-runs/${encodeURIComponent(payload.execution.workflowId)}`,
    },
  };
}

async function getRun(workflowId) {
  const run = await browserAutomationExecutionService.getRun(workflowId);
  if (String(run?.triggerSource || '').toUpperCase() !== 'ASSISTANT') {
    throw createHttpError(404, 'Assistant Playwright Automation run not found.', {
      code: 'ASSISTANT_RUN_NOT_FOUND',
    });
  }
  return sanitizeRun(run);
}

async function getArtifact({ workflowId, artifactId }) {
  await getRun(workflowId);
  return browserAutomationExecutionService.getArtifact({ workflowId, artifactId });
}

function getCapabilities({ permissionCodes = [] } = {}) {
  return {
    integrationVersion: INTEGRATION_VERSION,
    enabled: true,
    transport: 'HTTP_JSON',
    authentication: 'BEARER_TOKEN',
    executionMode: 'HEADLESS',
    permissionCodes,
    safety: {
      assistantOptInRequired: true,
      confirmationRequiredAutomationsBlocked: true,
      automationPermissionEnforced: true,
      registeredEnvironmentEnforced: true,
      structuredOutputSupported: true,
      assistantRunsOnlyVisibleOnAssistantRunEndpoint: true,
    },
    endpoints: {
      catalogue: '/api/assistant/browser-automations',
      automation: '/api/assistant/browser-automations/{automationCode}',
      start: '/api/assistant/browser-automations/{automationCode}/runs',
      run: '/api/assistant/browser-automation-runs/{workflowId}',
      artifact: '/api/assistant/browser-automation-runs/{workflowId}/artifacts/{artifactId}',
    },
  };
}

function getOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SkyCommand Assistant Browser Automation API',
      version: '1.0.0',
      description: 'Bounded assistant-facing surface for explicitly opted-in SkyCommand Playwright Automations.',
    },
    servers: [{ url: '/api/assistant' }],
    components: {
      securitySchemes: {
        assistantToken: { type: 'http', scheme: 'bearer', bearerFormat: 'SkyCommand Assistant token' },
      },
    },
    security: [{ assistantToken: [] }],
    paths: {
      '/capabilities': { get: { operationId: 'getSkyCommandAssistantCapabilities', responses: { 200: { description: 'Integration capabilities' } } } },
      '/browser-automations': { get: { operationId: 'listSkyCommandBrowserAutomations', responses: { 200: { description: 'Assistant-enabled automations' } } } },
      '/browser-automations/{automationCode}': { get: { operationId: 'getSkyCommandBrowserAutomation', parameters: [{ name: 'automationCode', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Automation contract' } } } },
      '/browser-automations/{automationCode}/runs': { post: { operationId: 'runSkyCommandBrowserAutomation', parameters: [{ name: 'automationCode', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { environmentCode: { type: 'string' }, parameters: { type: 'object', additionalProperties: true } } } } } }, responses: { 202: { description: 'Automation accepted' }, 409: { description: 'Safety policy blocked execution' } } } },
      '/browser-automation-runs/{workflowId}': { get: { operationId: 'getSkyCommandBrowserAutomationRun', parameters: [{ name: 'workflowId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Structured run status/result' } } } },
    },
  };
}

async function recordInvocationAudit({ req, automationCode, workflowId = null, success, message, error = null }) {
  const context = authService.getRequestContext(req);
  await authService.recordAuditEvent({
    appCode: req.session?.appCode,
    userId: null,
    eventType: 'ASSISTANT_BROWSER_AUTOMATION',
    resourceType: 'browser_automation',
    resourceId: automationCode,
    action: 'assistant_execute',
    success,
    message,
    metadata: {
      automationCode,
      workflowId,
      authMode: req.session?.authMode || 'ASSISTANT_SERVICE_TOKEN',
      permissionCodes: (req.permissions || []).map((permission) => permission.permissionCode),
      errorCode: error?.details?.code || error?.code || null,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

module.exports = {
  INTEGRATION_VERSION,
  assistantEligibility,
  getArtifact,
  getAutomation,
  getCapabilities,
  getOpenApiDocument,
  getRun,
  listAutomations,
  recordInvocationAudit,
  sanitizeAutomation,
  sanitizeRun,
  startAutomation,
};
