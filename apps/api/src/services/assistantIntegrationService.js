const authService = require('./authService');
const browserAutomationExecutionService = require('./browserAutomationExecutionService');
const browserAutomationRegistryService = require('./browserAutomationRegistryService');
const workflowExecutorService = require('./workflowExecutorService');
const {
  executeDatabaseUpgrade,
  normalizeDatabaseName,
  normalizeSystemIdentifier,
} = require('../../../../packages/db_upgrade/src/databaseUpgradeEngine');
const {
  createDatabaseUpgradeToolResult,
} = require('../../../../packages/db_upgrade/src/databaseUpgradeResult');
const databaseUpgradeApplyRequestService = require('./databaseUpgradeApplyRequestService');

const INTEGRATION_VERSION = 'skycommand_assistant_bridge.v1';
const DEVELOPMENT_PROMOTION_CAPABILITY = 'skycommand_development_promotion_start';
const DATABASE_UPGRADE_PLAN_CAPABILITY = 'skycommand_database_upgrade_plan';
const DATABASE_UPGRADE_PLAN_PERMISSION_CODE = 'DB_UPGRADE_PLAN';
const DATABASE_UPGRADE_PLAN_REQUIRED_PERMISSION_CODES = Object.freeze([
  DATABASE_UPGRADE_PLAN_PERMISSION_CODE,
]);
const DATABASE_UPGRADE_APPLY_REQUEST_CAPABILITY = 'skycommand_database_upgrade_apply_request';
const DEVELOPMENT_PROMOTION_WORKFLOW_CODE = 'skyserver_dev_commit';
const DEVELOPMENT_PROMOTION_REPOSITORY_CODE = 'SkyCommand';
const DEVELOPMENT_PROMOTION_PERMISSION_CODE = 'WORKFLOW_RUN';
const DEVELOPMENT_PROMOTION_REQUIRED_PERMISSION_CODES = Object.freeze([
  'WORKFLOW_RUN',
  'REPO_MAP_GENERATE',
  'REPO_ZIP_GENERATE',
  'GIT_COMMIT_RUN',
  'GIT_MAIN_MERGE_RUN',
  'GIT_LOCAL_SYNC_RUN',
  'CORE_RUN_LOW_RISK_SCRIPT',
  'CORE_RUN_MEDIUM_RISK_SCRIPT',
  'CORE_RUN_HIGH_RISK_SCRIPT',
]);
const DEVELOPMENT_PROMOTION_TRIGGER_SOURCE = 'ASSISTANT';
const DEVELOPMENT_PROMOTION_TRIGGER_TYPE = 'ASSISTANT';
const DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH = 300;
const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function getDevelopmentPromotionConfig(env = process.env) {
  const configuredRepositoryCode = String(
    env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY || '',
  ).trim();
  const repositoryConfigured = Boolean(configuredRepositoryCode);
  const repositoryAllowed =
    repositoryConfigured &&
    configuredRepositoryCode.toLowerCase() === DEVELOPMENT_PROMOTION_REPOSITORY_CODE.toLowerCase();
  const configuredEnabled = parseBoolean(env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED, false);

  let blockedReason = null;
  if (!configuredEnabled) blockedReason = 'ASSISTANT_DEV_PROMOTION_DISABLED';
  else if (!repositoryConfigured)
    blockedReason = 'ASSISTANT_DEV_PROMOTION_REPOSITORY_NOT_CONFIGURED';
  else if (!repositoryAllowed) blockedReason = 'ASSISTANT_DEV_PROMOTION_REPOSITORY_NOT_ALLOWED';

  return {
    configuredEnabled,
    repositoryCode: repositoryAllowed
      ? DEVELOPMENT_PROMOTION_REPOSITORY_CODE
      : configuredRepositoryCode || null,
    repositoryConfigured,
    repositoryAllowed,
    enabled: configuredEnabled && repositoryConfigured && repositoryAllowed,
    workflowCode: DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
    executor: 'temporal',
    triggerSource: DEVELOPMENT_PROMOTION_TRIGGER_SOURCE,
    triggerType: DEVELOPMENT_PROMOTION_TRIGGER_TYPE,
    permissionCode: DEVELOPMENT_PROMOTION_PERMISSION_CODE,
    blockedReason,
  };
}

function permissionCodeSet(permissions = []) {
  return new Set(
    (permissions || [])
      .map((permission) =>
        typeof permission === 'string' ? permission : String(permission?.permissionCode || ''),
      )
      .map((permissionCode) => permissionCode.trim())
      .filter(Boolean),
  );
}

function getMissingDevelopmentPromotionPermissionCodes(permissions = []) {
  const grantedPermissionCodes = permissionCodeSet(permissions);
  return DEVELOPMENT_PROMOTION_REQUIRED_PERMISSION_CODES.filter(
    (permissionCode) => !grantedPermissionCodes.has(permissionCode),
  );
}

function getMissingDatabaseUpgradePlanPermissionCodes(permissions = []) {
  const grantedPermissionCodes = permissionCodeSet(permissions);
  return DATABASE_UPGRADE_PLAN_REQUIRED_PERMISSION_CODES.filter(
    (permissionCode) => !grantedPermissionCodes.has(permissionCode),
  );
}

function getDatabaseUpgradeApplyRequestConfig(environment = process.env, permissions = []) {
  return databaseUpgradeApplyRequestService.getApplyRequestConfig(environment, permissions);
}

function getDatabaseUpgradePlanConfig(env = process.env) {
  const targetDatabaseValue = String(env.SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE || '').trim();
  const targetSystemIdentifier = normalizeSystemIdentifier(
    env.SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER,
  );
  let targetDatabase = null;
  let targetDatabaseValid = false;

  if (targetDatabaseValue) {
    try {
      targetDatabase = normalizeDatabaseName(targetDatabaseValue);
      targetDatabaseValid = true;
    } catch (_error) {
      targetDatabase = null;
    }
  }

  const databaseTargetConfigured = Boolean(targetDatabaseValue);
  const systemIdentifierTargetConfigured = Boolean(targetSystemIdentifier);
  const configured =
    databaseTargetConfigured && targetDatabaseValid && systemIdentifierTargetConfigured;
  const enabled = parseBoolean(env.SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED, false);

  let blockedReason = null;
  if (!enabled) blockedReason = 'ASSISTANT_DATABASE_UPGRADE_PLAN_DISABLED';
  else if (!databaseTargetConfigured) {
    blockedReason = 'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_NOT_CONFIGURED';
  } else if (!targetDatabaseValid) {
    blockedReason = 'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_INVALID';
  } else if (!systemIdentifierTargetConfigured) {
    blockedReason = 'ASSISTANT_DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_NOT_CONFIGURED';
  }

  return {
    capability: DATABASE_UPGRADE_PLAN_CAPABILITY,
    permissionCode: DATABASE_UPGRADE_PLAN_PERMISSION_CODE,
    requiredPermissionCodes: [...DATABASE_UPGRADE_PLAN_REQUIRED_PERMISSION_CODES],
    configured,
    enabled,
    databaseTargetConfigured,
    systemIdentifierTargetConfigured,
    targetDatabase,
    targetSystemIdentifier,
    blockedReason,
  };
}

function assertEmptyDatabaseUpgradePlanRequest({ query = {}, body = {} } = {}) {
  const queryKeys = query && typeof query === 'object' ? Object.keys(query) : [];
  const bodyIsObject = body && typeof body === 'object' && !Array.isArray(body);
  const bodyKeys = bodyIsObject ? Object.keys(body) : [];
  const unexpectedBody =
    body !== undefined && body !== null && (!bodyIsObject || bodyKeys.length > 0);
  if (queryKeys.length > 0 || unexpectedBody) {
    throw createHttpError(400, 'Database upgrade PLAN accepts no request arguments.', {
      code: 'ASSISTANT_DATABASE_UPGRADE_PLAN_UNEXPECTED_ARGUMENTS',
    });
  }
}

function assertExactDevelopmentPromotionBody(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, 'Development Promotion request must be a JSON object.', {
      code: 'ASSISTANT_DEV_PROMOTION_INVALID_REQUEST',
    });
  }

  const unexpectedFields = Object.keys(body).filter((key) => key !== 'commitMessage');
  if (unexpectedFields.length > 0) {
    throw createHttpError(400, 'Development Promotion request contains unsupported fields.', {
      code: 'ASSISTANT_DEV_PROMOTION_UNEXPECTED_FIELDS',
      unexpectedFields,
    });
  }
}

function validateDevelopmentPromotionCommitMessage(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, 'commitMessage must be a string.', {
      code: 'ASSISTANT_DEV_PROMOTION_INVALID_COMMIT_MESSAGE',
    });
  }

  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw createHttpError(400, 'commitMessage must be a single line without control characters.', {
      code: 'ASSISTANT_DEV_PROMOTION_INVALID_COMMIT_MESSAGE',
    });
  }

  const commitMessage = value.trim();
  if (!commitMessage) {
    throw createHttpError(400, 'commitMessage must be nonblank.', {
      code: 'ASSISTANT_DEV_PROMOTION_INVALID_COMMIT_MESSAGE',
    });
  }

  if (commitMessage.length > DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH) {
    throw createHttpError(400, 'commitMessage exceeds the maximum allowed length.', {
      code: 'ASSISTANT_DEV_PROMOTION_COMMIT_MESSAGE_TOO_LONG',
      maxLength: DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH,
    });
  }

  return commitMessage;
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
    options: (parameter.options || [])
      .filter((option) => option.enabled !== false)
      .map((option) => ({
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
    parameters: (automation.parameters || [])
      .filter((parameter) => parameter.enabled !== false)
      .map(sanitizeParameter),
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
  const automation = await browserAutomationRegistryService.getBrowserAutomationByCode(
    automationCode,
    { includeDisabled: false },
  );
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
    const detail = await browserAutomationRegistryService.getBrowserAutomationById(
      item.automationId,
      { includeDisabled: false },
    );
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
    throw createHttpError(
      400,
      'Assistant integration supports HEADLESS Playwright Automation only.',
      {
        code: 'ASSISTANT_INTERACTIVE_EXECUTION_NOT_ALLOWED',
      },
    );
  }

  if (!eligibility.executable) {
    const statusCode =
      eligibility.blockedReason === 'ASSISTANT_PERMISSION_SCOPE_MISSING' ? 403 : 409;
    throw createHttpError(
      statusCode,
      'Playwright Automation is not executable through the Assistant integration.',
      {
        code: eligibility.blockedReason,
        automationCode: automation.automationCode,
        confirmationText: automation.requiresConfirmation ? automation.confirmationText : undefined,
        permissionCode: automation.permissionCode || undefined,
      },
    );
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

async function getDatabaseUpgradePlan({
  permissions = [],
  environment = process.env,
  upgradeExecutor = executeDatabaseUpgrade,
} = {}) {
  const config = getDatabaseUpgradePlanConfig(environment);

  if (!config.enabled) {
    throw createHttpError(503, 'Assistant database upgrade PLAN is disabled.', {
      code: config.blockedReason || 'ASSISTANT_DATABASE_UPGRADE_PLAN_DISABLED',
    });
  }
  if (!config.databaseTargetConfigured) {
    throw createHttpError(503, 'Assistant database upgrade target is not configured.', {
      code: 'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_NOT_CONFIGURED',
    });
  }
  if (!config.targetDatabase) {
    throw createHttpError(503, 'Assistant database upgrade target is invalid.', {
      code: 'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_INVALID',
    });
  }
  if (!config.systemIdentifierTargetConfigured) {
    throw createHttpError(503, 'Assistant PostgreSQL system-identifier target is not configured.', {
      code: 'ASSISTANT_DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_NOT_CONFIGURED',
    });
  }

  const missingPermissionCodes = getMissingDatabaseUpgradePlanPermissionCodes(permissions);
  if (missingPermissionCodes.length > 0) {
    throw createHttpError(403, 'Assistant database upgrade PLAN permission scope is incomplete.', {
      code: 'ASSISTANT_DATABASE_UPGRADE_PERMISSION_SCOPE_MISSING',
      missingPermissionCodes,
    });
  }

  const configuredDatabase = String(environment.PGDATABASE || '').trim();
  if (configuredDatabase && configuredDatabase !== config.targetDatabase) {
    throw createHttpError(409, 'Configured database does not match the governed upgrade target.', {
      code: 'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_MISMATCH',
    });
  }

  let result;
  try {
    result = await upgradeExecutor({
      mode: 'PLAN',
      environment,
    });
  } catch (error) {
    if (error?.code === 'DATABASE_UPGRADE_CONNECTED_DATABASE_MISMATCH') {
      throw createHttpError(
        409,
        'Observed database identity does not match the governed upgrade target.',
        {
          code: 'ASSISTANT_DATABASE_UPGRADE_OBSERVED_DATABASE_MISMATCH',
        },
      );
    }
    throw error;
  }

  const observedDatabaseName = String(result?.databaseIdentity?.databaseName || '').trim();
  if (observedDatabaseName !== config.targetDatabase) {
    throw createHttpError(
      409,
      'Observed database identity does not match the governed upgrade target.',
      {
        code: 'ASSISTANT_DATABASE_UPGRADE_OBSERVED_DATABASE_MISMATCH',
      },
    );
  }

  const observedSystemIdentifier = normalizeSystemIdentifier(
    result?.databaseIdentity?.systemIdentifier,
  );
  if (observedSystemIdentifier !== config.targetSystemIdentifier) {
    throw createHttpError(
      409,
      'Observed PostgreSQL system identity does not match the governed upgrade target.',
      { code: 'ASSISTANT_DATABASE_UPGRADE_OBSERVED_SYSTEM_IDENTIFIER_MISMATCH' },
    );
  }

  const toolResult = createDatabaseUpgradeToolResult(result);
  if (toolResult.output.mode !== 'PLAN' || toolResult.output.outcome !== 'PLAN_READY') {
    throw createHttpError(500, 'Assistant database upgrade PLAN returned an invalid result.', {
      code: 'ASSISTANT_DATABASE_UPGRADE_PLAN_RESULT_INVALID',
    });
  }

  return toolResult;
}

function assertExactDatabaseUpgradeApplyRequest({ query = {}, body = {} } = {}) {
  return databaseUpgradeApplyRequestService.assertExactApplyRequestBody({ query, body });
}

async function createDatabaseUpgradeApplyRequest({
  expectedPlanDigest,
  permissions = [],
  assistantIdentity = {},
  environment = process.env,
  upgradeExecutor = executeDatabaseUpgrade,
  database,
} = {}) {
  return databaseUpgradeApplyRequestService.createApplyRequest({
    expectedPlanDigest,
    permissions,
    assistantIdentity,
    environment,
    upgradeExecutor,
    database,
  });
}

async function startDevelopmentPromotion({
  body = {},
  permissions = [],
  actor = null,
  session = null,
  context = {},
  workflowExecutor = workflowExecutorService,
} = {}) {
  const config = getDevelopmentPromotionConfig();

  if (!config.enabled) {
    throw createHttpError(
      503,
      'Assistant development promotion is disabled or not safely configured.',
      {
        code: config.blockedReason || 'ASSISTANT_DEV_PROMOTION_DISABLED',
        workflowCode: config.workflowCode,
        repositoryCode: config.repositoryCode,
      },
    );
  }

  const missingPermissionCodes = getMissingDevelopmentPromotionPermissionCodes(permissions);
  if (missingPermissionCodes.length > 0) {
    throw createHttpError(403, 'Assistant development promotion permission scope is incomplete.', {
      code: 'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING',
      missingPermissionCodes,
    });
  }

  assertExactDevelopmentPromotionBody(body);
  const commitMessage = validateDevelopmentPromotionCommitMessage(body.commitMessage);
  const input = {
    params: {
      commitMessage,
      repoName: config.repositoryCode,
    },
    runSource: 'assistant',
    triggerType: DEVELOPMENT_PROMOTION_TRIGGER_TYPE,
  };

  const result = await workflowExecutor.startWorkflowWithTemporal({
    workflowCode: DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
    input,
    user: actor,
    session,
    permissions,
    context,
  });

  return {
    accepted: true,
    started: Boolean(result?.started),
    workflowCode: DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
    repositoryCode: config.repositoryCode,
    workflowRunRecordId: result?.run?.workflowRunRecordId || null,
    temporalWorkflowId: result?.temporalWorkflow?.workflowId || null,
    triggerSource: DEVELOPMENT_PROMOTION_TRIGGER_SOURCE,
    humanApprovalRequired: true,
    agentMustStop: true,
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

function getCapabilities({
  permissionCodes = [],
  agentId = 'assistant-http',
  environment = process.env,
} = {}) {
  const developmentPromotion = getDevelopmentPromotionConfig();
  const missingPermissionCodes = getMissingDevelopmentPromotionPermissionCodes(permissionCodes);
  const configured = developmentPromotion.enabled;
  const executable = configured && missingPermissionCodes.length === 0;
  const databaseUpgradePlan = getDatabaseUpgradePlanConfig(environment);
  const databaseUpgradePlanMissingPermissionCodes =
    getMissingDatabaseUpgradePlanPermissionCodes(permissionCodes);
  const databaseUpgradePlanExecutable =
    databaseUpgradePlan.enabled &&
    databaseUpgradePlan.configured &&
    databaseUpgradePlanMissingPermissionCodes.length === 0;
  const databaseUpgradeApplyRequest = getDatabaseUpgradeApplyRequestConfig(
    environment,
    permissionCodes,
  );

  return {
    integrationVersion: INTEGRATION_VERSION,
    enabled: true,
    transport: 'HTTP_JSON',
    authentication: 'BEARER_TOKEN',
    executionMode: 'HEADLESS',
    permissionCodes,
    agentId,
    developmentPromotion: {
      capability: DEVELOPMENT_PROMOTION_CAPABILITY,
      configured,
      enabled: executable,
      executable,
      configuredEnabled: developmentPromotion.configuredEnabled,
      repositoryConfigured: developmentPromotion.repositoryConfigured,
      repositoryCode: developmentPromotion.repositoryAllowed
        ? developmentPromotion.repositoryCode
        : null,
      workflowCode: developmentPromotion.workflowCode,
      executor: developmentPromotion.executor,
      triggerSource: developmentPromotion.triggerSource,
      triggerType: developmentPromotion.triggerType,
      permissionCode: developmentPromotion.permissionCode,
      requiredPermissionCodes: [...DEVELOPMENT_PROMOTION_REQUIRED_PERMISSION_CODES],
      missingPermissionCodes,
      humanApprovalRequired: true,
      agentMustStop: true,
      blockedReason:
        developmentPromotion.blockedReason ||
        (missingPermissionCodes.length > 0
          ? 'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING'
          : null),
    },
    databaseUpgradePlan: {
      capability: DATABASE_UPGRADE_PLAN_CAPABILITY,
      configured: databaseUpgradePlan.configured,
      enabled: databaseUpgradePlan.enabled,
      executable: databaseUpgradePlanExecutable,
      configuredEnabled: databaseUpgradePlan.enabled,
      permissionCode: DATABASE_UPGRADE_PLAN_PERMISSION_CODE,
      requiredPermissionCodes: [...DATABASE_UPGRADE_PLAN_REQUIRED_PERMISSION_CODES],
      missingPermissionCodes: databaseUpgradePlanMissingPermissionCodes,
      databaseTargetConfigured: databaseUpgradePlan.databaseTargetConfigured,
      systemIdentifierTargetConfigured: databaseUpgradePlan.systemIdentifierTargetConfigured,
      readOnly: true,
      applyExposed: false,
      blockedReason:
        databaseUpgradePlan.blockedReason ||
        (databaseUpgradePlanMissingPermissionCodes.length > 0
          ? 'ASSISTANT_DATABASE_UPGRADE_PERMISSION_SCOPE_MISSING'
          : null),
      description:
        'Read-only current database-upgrade PLAN metadata. APPLY is not exposed through the Assistant API.',
    },
    databaseUpgradeApplyRequest: {
      capability: DATABASE_UPGRADE_APPLY_REQUEST_CAPABILITY,
      applyRequestConfigured: databaseUpgradeApplyRequest.applyRequestConfigured,
      applyRequestEnabled: databaseUpgradeApplyRequest.applyRequestEnabled,
      applyRequestExecutable: databaseUpgradeApplyRequest.applyRequestExecutable,
      requestPermissionCode: databaseUpgradeApplyRequest.requestPermissionCode,
      missingPermissionCodes: databaseUpgradeApplyRequest.missingPermissionCodes,
      databaseTargetConfigured: databaseUpgradeApplyRequest.databaseTargetConfigured,
      systemIdentifierTargetConfigured:
        databaseUpgradeApplyRequest.systemIdentifierTargetConfigured,
      humanApprovalRequired: true,
      applyExecutionExposed: false,
      readOnly: false,
      destructive: false,
      idempotent: true,
      blockedReason: databaseUpgradeApplyRequest.blockedReason,
      description:
        'Create a durable human-approval request for the exact current PLAN. This records authorization evidence only and never executes database APPLY.',
    },
    safety: {
      assistantOptInRequired: true,
      confirmationRequiredAutomationsBlocked: true,
      automationPermissionEnforced: true,
      registeredEnvironmentEnforced: true,
      structuredOutputSupported: true,
      assistantRunsOnlyVisibleOnAssistantRunEndpoint: true,
      developmentPromotionPermissionEnforced: true,
      developmentPromotionRepositoryPinned: true,
      developmentPromotionHumanApprovalRequired: true,
    },
    endpoints: {
      catalogue: '/api/assistant/browser-automations',
      automation: '/api/assistant/browser-automations/{automationCode}',
      start: '/api/assistant/browser-automations/{automationCode}/runs',
      run: '/api/assistant/browser-automation-runs/{workflowId}',
      artifact: '/api/assistant/browser-automation-runs/{workflowId}/artifacts/{artifactId}',
      developmentPromotionStart: '/api/assistant/development-promotion/runs',
      databaseUpgradePlan: '/api/assistant/database-upgrade/plan',
      databaseUpgradeApplyRequest: '/api/assistant/database-upgrade/apply-requests',
    },
  };
}

function getOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SkyCommand Assistant Integration API',
      version: '1.0.0',
      description:
        'Bounded assistant-facing surface for explicitly opted-in SkyCommand Playwright Automations, the separately gated human-approved development promotion start capability, the strictly read-only database-upgrade PLAN capability, and a separately gated APPLY authorization-request capability. Database-upgrade APPLY execution is not exposed.',
    },
    servers: [{ url: '/api/assistant' }],
    components: {
      securitySchemes: {
        assistantToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'SkyCommand Assistant token',
        },
      },
    },
    security: [{ assistantToken: [] }],
    paths: {
      '/capabilities': {
        get: {
          operationId: 'getSkyCommandAssistantCapabilities',
          responses: { 200: { description: 'Integration capabilities' } },
        },
      },
      '/database-upgrade/plan': {
        get: {
          operationId: DATABASE_UPGRADE_PLAN_CAPABILITY,
          description:
            'Return the current governed database-upgrade PLAN using the configured D1 target database and PostgreSQL system identifier. This operation accepts no arguments, is read-only, and does not expose APPLY.',
          'x-required-permission-codes': [...DATABASE_UPGRADE_PLAN_REQUIRED_PERMISSION_CODES],
          responses: {
            200: {
              description:
                'Structured database_upgrade_summary.v1 ToolResult containing only governed PLAN metadata.',
            },
            400: { description: 'Arguments are not accepted.' },
            403: { description: 'Assistant identity lacks DB_UPGRADE_PLAN.' },
            409: {
              description: 'Observed database identity does not match the configured D1 target.',
            },
            503: { description: 'Assistant PLAN gate or D1 target pins are not configured.' },
          },
        },
      },
      '/database-upgrade/apply-requests': {
        post: {
          operationId: DATABASE_UPGRADE_APPLY_REQUEST_CAPABILITY,
          description:
            'Create or reuse a durable human-approval envelope for the exact current governed PLAN. This operation records authorization evidence only; it never executes database APPLY.',
          'x-required-permission-codes': ['DB_UPGRADE_APPLY_REQUEST'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['expectedPlanDigest'],
                  properties: {
                    expectedPlanDigest: {
                      type: 'string',
                      pattern: '^[A-Fa-f0-9]{64}$',
                    },
                  },
                },
              },
            },
          },
          responses: {
            202: { description: 'Human-approval request accepted or reused.' },
            200: { description: 'Existing current human-approval request reused.' },
            400: { description: 'Exactly expectedPlanDigest is required.' },
            403: { description: 'Assistant identity lacks DB_UPGRADE_APPLY_REQUEST.' },
            409: { description: 'PLAN digest or configured target no longer matches.' },
            503: { description: 'Request gate or target pins are not configured.' },
          },
        },
      },
      '/browser-automations': {
        get: {
          operationId: 'listSkyCommandBrowserAutomations',
          responses: { 200: { description: 'Assistant-enabled automations' } },
        },
      },
      '/browser-automations/{automationCode}': {
        get: {
          operationId: 'getSkyCommandBrowserAutomation',
          parameters: [
            { name: 'automationCode', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Automation contract' } },
        },
      },
      '/browser-automations/{automationCode}/runs': {
        post: {
          operationId: 'runSkyCommandBrowserAutomation',
          parameters: [
            { name: 'automationCode', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    environmentCode: { type: 'string' },
                    parameters: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            202: { description: 'Automation accepted' },
            409: { description: 'Safety policy blocked execution' },
          },
        },
      },
      '/browser-automation-runs/{workflowId}': {
        get: {
          operationId: 'getSkyCommandBrowserAutomationRun',
          parameters: [
            { name: 'workflowId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Structured run status/result' } },
        },
      },
      '/development-promotion/runs': {
        post: {
          operationId: DEVELOPMENT_PROMOTION_CAPABILITY,
          description:
            'Start only the governed SkyCommand Dev Promotion Local workflow. The workflow continues independently to its existing human Merge Approval node; the initiating Agent must stop after this receipt. This API does not expose polling or approval controls.',
          'x-required-permission-codes': [...DEVELOPMENT_PROMOTION_REQUIRED_PERMISSION_CODES],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['commitMessage'],
                  properties: {
                    commitMessage: {
                      type: 'string',
                      minLength: 1,
                      maxLength: DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH,
                      description: 'Single-line commit message without control characters.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            202: {
              description:
                'Promotion accepted and started; human Merge Approval is still required.',
            },
            400: { description: 'Invalid or unsupported request fields/message.' },
            403: {
              description:
                'Assistant service identity is missing one or more required Development Promotion permissions. The response exposes only missingPermissionCodes.',
              headers: {},
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean', const: false },
                      details: {
                        type: 'object',
                        properties: {
                          code: {
                            type: 'string',
                            const: 'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING',
                          },
                          missingPermissionCodes: {
                            type: 'array',
                            items: { type: 'string' },
                          },
                        },
                        required: ['code', 'missingPermissionCodes'],
                        additionalProperties: false,
                      },
                    },
                    required: ['ok', 'details'],
                  },
                },
              },
            },
            503: {
              description: 'Assistant development promotion is disabled or not safely configured.',
            },
          },
        },
      },
    },
  };
}

async function recordInvocationAudit({
  req,
  automationCode,
  workflowId = null,
  success,
  message,
  error = null,
}) {
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
      agentId: req.assistantIntegration?.agentId || 'assistant-http',
      permissionCodes: (req.permissions || []).map((permission) => permission.permissionCode),
      errorCode: error?.details?.code || error?.code || null,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

async function recordDatabaseUpgradePlanAudit({
  req,
  result = null,
  success,
  error = null,
  auditRecorder = authService.recordAuditEvent,
} = {}) {
  const context = authService.getRequestContext(req);
  const output = result?.output || error?.upgradeResult || {};
  const digest = String(output.planDigest?.digest || '')
    .trim()
    .toUpperCase();
  const planDigest = /^[A-F0-9]{64}$/.test(digest) ? digest : null;
  const pendingCount = Number.isInteger(Number(output.pendingCount))
    ? Number(output.pendingCount)
    : 0;
  const ledgeredCount = Number.isInteger(Number(output.ledger?.appliedCount))
    ? Number(output.ledger.appliedCount)
    : 0;
  const databaseName = String(output.databaseIdentity?.databaseName || '').trim() || null;
  const authorizationErrorCode = error?.details?.code || error?.code || null;

  await auditRecorder({
    appCode: req.session?.appCode,
    userId: null,
    eventType: 'ASSISTANT_DATABASE_UPGRADE_PLAN',
    resourceType: 'database_upgrade',
    resourceId: databaseName,
    action: success
      ? 'assistant_database_upgrade_plan'
      : 'assistant_database_upgrade_plan_rejected',
    success,
    message: success
      ? 'Assistant database upgrade PLAN was returned.'
      : 'Assistant database upgrade PLAN request was rejected.',
    metadata: {
      agentId: req.assistantIntegration?.agentId || 'assistant-http',
      permissionCode: DATABASE_UPGRADE_PLAN_PERMISSION_CODE,
      outcome: success ? output.outcome || 'PLAN_READY' : 'REJECTED',
      planDigest,
      pendingCount,
      ledgeredCount,
      databaseName,
      authorizationErrorCode,
      readOnly: true,
      applyExposed: false,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

async function recordDatabaseUpgradeApplyRequestAudit({
  req,
  request = null,
  success,
  outcome,
  error = null,
  auditRecorder,
} = {}) {
  return databaseUpgradeApplyRequestService.recordApplyRequestAudit({
    req,
    request,
    success,
    outcome,
    errorCode: error?.details?.code || error?.code || null,
    auditRecorder,
  });
}

async function recordDevelopmentPromotionAudit({
  req,
  result = null,
  success,
  error = null,
  auditRecorder = authService.recordAuditEvent,
} = {}) {
  const context = authService.getRequestContext(req);
  const config = getDevelopmentPromotionConfig();
  const workflowRunRecordId =
    result?.workflowRunRecordId ||
    error?.details?.workflowRunRecordId ||
    error?.details?.run?.workflowRunRecordId ||
    null;
  const temporalWorkflowId = result?.temporalWorkflowId || null;
  const errorCode = error?.details?.code || error?.code || null;

  await auditRecorder({
    appCode: req.session?.appCode,
    userId: null,
    eventType: 'ASSISTANT_DEVELOPMENT_PROMOTION',
    resourceType: 'worker.workflow_run_records',
    resourceId: workflowRunRecordId,
    action: success
      ? 'assistant_development_promotion_start'
      : 'assistant_development_promotion_start_rejected',
    success,
    message: success
      ? 'Assistant development promotion was accepted and started.'
      : 'Assistant development promotion request was rejected.',
    metadata: {
      agentId: req.assistantIntegration?.agentId || 'assistant-http',
      workflowCode: DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
      repositoryCode:
        result?.repositoryCode || (config.repositoryAllowed ? config.repositoryCode : null),
      workflowRunRecordId,
      temporalWorkflowId,
      triggerSource: DEVELOPMENT_PROMOTION_TRIGGER_SOURCE,
      triggerType: DEVELOPMENT_PROMOTION_TRIGGER_TYPE,
      executor: 'temporal',
      permissionCode: DEVELOPMENT_PROMOTION_PERMISSION_CODE,
      success: Boolean(success),
      authorizationErrorCode: errorCode,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

module.exports = {
  DEVELOPMENT_PROMOTION_CAPABILITY,
  DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH,
  DEVELOPMENT_PROMOTION_PERMISSION_CODE,
  DEVELOPMENT_PROMOTION_REQUIRED_PERMISSION_CODES,
  DEVELOPMENT_PROMOTION_REPOSITORY_CODE,
  DEVELOPMENT_PROMOTION_TRIGGER_SOURCE,
  DEVELOPMENT_PROMOTION_TRIGGER_TYPE,
  DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
  DATABASE_UPGRADE_PLAN_CAPABILITY,
  DATABASE_UPGRADE_PLAN_PERMISSION_CODE,
  DATABASE_UPGRADE_PLAN_REQUIRED_PERMISSION_CODES,
  DATABASE_UPGRADE_APPLY_REQUEST_CAPABILITY,
  INTEGRATION_VERSION,
  assistantEligibility,
  assertEmptyDatabaseUpgradePlanRequest,
  assertExactDatabaseUpgradeApplyRequest,
  assertExactDevelopmentPromotionBody,
  getArtifact,
  getAutomation,
  getCapabilities,
  getDatabaseUpgradePlan,
  getDatabaseUpgradePlanConfig,
  getDatabaseUpgradeApplyRequestConfig,
  getDevelopmentPromotionConfig,
  getMissingDatabaseUpgradePlanPermissionCodes,
  getMissingDevelopmentPromotionPermissionCodes,
  getOpenApiDocument,
  getRun,
  listAutomations,
  recordDatabaseUpgradePlanAudit,
  recordDatabaseUpgradeApplyRequestAudit,
  recordDevelopmentPromotionAudit,
  recordInvocationAudit,
  sanitizeAutomation,
  sanitizeRun,
  startDevelopmentPromotion,
  createDatabaseUpgradeApplyRequest,
  startAutomation,
  validateDevelopmentPromotionCommitMessage,
};
