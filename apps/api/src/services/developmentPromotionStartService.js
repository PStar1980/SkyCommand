const crypto = require('node:crypto');

const promotionPreflight = require('../../../../packages/dev-finalization/src/promotionPreflight');
const {
  buildPromotionRequestIdentity,
} = require('../../../../packages/dev-finalization/src/promotionIdentity');
const workflowExecutorService = require('./workflowExecutorService');
const workflowAgentExecutionService = require('./workflowAgentExecutionService');

const DEVELOPMENT_PROMOTION_WORKFLOW_CODE = 'skyserver_dev_commit';
const DEVELOPMENT_PROMOTION_REPOSITORY_CODE = 'SkyCommand';
const DEVELOPMENT_PROMOTION_FINALIZATION_WORKFLOW_CODE = 'dev_change_finalize';
const DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH = 300;
const DEVELOPMENT_PROMOTION_MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const DEVELOPMENT_PROMOTION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVELOPMENT_PROMOTION_WORKFLOW_CODES = Object.freeze([
  DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
  'skycommand-dev-promo-alt',
]);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getPromotionParameters(input = {}) {
  const source = safeObject(input);
  const params = safeObject(source.params);
  const runtimeParameters = safeObject(source.runtimeParameters);
  return {
    repoName: params.repoName ?? runtimeParameters.repoName ?? null,
    commitMessage: params.commitMessage ?? runtimeParameters.commitMessage ?? null,
    finalizationWorkflowRunId:
      params.finalizationWorkflowRunId ?? runtimeParameters.finalizationWorkflowRunId ?? null,
  };
}

function buildPromotionParameters({ commitMessage, finalizationWorkflowRunId } = {}) {
  return {
    commitMessage,
    repoName: DEVELOPMENT_PROMOTION_REPOSITORY_CODE,
    finalizationWorkflowRunId,
  };
}

function validateDevelopmentPromotionCommitMessage(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, 'commitMessage must be a string.', {
      code: 'ASSISTANT_DEV_PROMOTION_INVALID_COMMIT_MESSAGE',
    });
  }

  if (/^[\s\S]*[\u0000-\u001F\u007F-\u009F][\s\S]*$/.test(value)) {
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

function validateDevelopmentPromotionFinalizationWorkflowRunId(value) {
  if (typeof value !== 'string' || !DEVELOPMENT_PROMOTION_UUID_PATTERN.test(value.trim())) {
    throw createHttpError(
      400,
      'finalizationWorkflowRunId must be a valid DEV finalization workflow run id.',
      { code: 'ASSISTANT_DEV_PROMOTION_FINALIZATION_REF_INVALID' },
    );
  }
  return value.trim();
}

function validateDevelopmentPromotionIdempotencyKey(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, 'idempotencyKey must be a string.', {
      code: 'ASSISTANT_DEV_PROMOTION_IDEMPOTENCY_KEY_INVALID',
    });
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw createHttpError(
      400,
      'idempotencyKey must be a single-line string without control characters.',
      { code: 'ASSISTANT_DEV_PROMOTION_IDEMPOTENCY_KEY_INVALID' },
    );
  }
  const idempotencyKey = value.trim();
  if (!idempotencyKey || idempotencyKey.length > DEVELOPMENT_PROMOTION_MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw createHttpError(400, 'idempotencyKey must be nonblank and no more than 200 characters.', {
      code: 'ASSISTANT_DEV_PROMOTION_IDEMPOTENCY_KEY_INVALID',
      maxLength: DEVELOPMENT_PROMOTION_MAX_IDEMPOTENCY_KEY_LENGTH,
    });
  }
  return idempotencyKey;
}

function normalizeServerRequestId(value) {
  const candidate = String(value ?? '').trim();
  if (candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) return candidate;
  return crypto.randomUUID();
}

function buildManualPromotionIdentity({
  input,
  user,
  session,
  context,
  workflowCode,
  definition,
  environment,
} = {}) {
  const parameters = getPromotionParameters(input);
  const scope = promotionPreflight.getPromotionScope(environment);
  const requestId = normalizeServerRequestId(context?.requestId || context?.promotionRequestId);
  const principalScope = `human-ui:${String(user?.userId || session?.sessionId || 'operator').trim()}`;
  const idempotencyKey = `admin-web:${requestId}`;
  const identity = buildPromotionRequestIdentity({
    principalScope,
    idempotencyKey,
    workflowCode,
    repositoryCode: scope.repositoryCode,
    environmentCode: scope.environmentCode,
    configProfileCode: scope.configProfileCode,
    workflowDefinitionId: definition?.workflowDefinitionId || null,
    workflowVersionId: definition?.publishedVersionId || null,
    versionNumber: definition?.publishedVersionNumber || null,
    parameters,
  });

  return {
    ...identity,
    requestId,
    repositoryCode: scope.repositoryCode,
    environmentCode: scope.environmentCode,
    configProfileCode: scope.configProfileCode,
    finalizationWorkflowRunId: parameters.finalizationWorkflowRunId,
  };
}

function buildManualPromotionAuthorization({ identity, user, finalizationWorkflowRunId } = {}) {
  return {
    instructionSource: 'OPERATOR',
    triggerSource: 'ADMIN_WEB',
    triggerType: 'MANUAL',
    actorUserId: user?.userId || null,
    instructionRef: identity.requestId,
    requestId: identity.requestId,
    requestedAt: new Date().toISOString(),
    finalizationWorkflowRunId,
  };
}

function buildManualPromotionInput({ input, parameters, identity } = {}) {
  const safeInput = safeObject(input);
  return {
    ...safeInput,
    runSource: 'manual',
    triggerType: 'MANUAL',
    params: parameters,
    runtimeParameters: parameters,
    promotionRequest: {
      contractVersion: 'skycommand_development_promotion_start.v1',
      requestId: identity.requestId,
      principalScope: identity.principalScope,
      idempotencyKeyHash: identity.idempotencyKeyHash,
      requestDigest: identity.requestDigest,
      repositoryCode: identity.repositoryCode,
      environmentCode: identity.environmentCode,
      configProfileCode: identity.configProfileCode,
      finalizationWorkflowRunId: identity.finalizationWorkflowRunId,
    },
  };
}

function buildManualPromotionResult({
  result,
  identity,
  finalization,
  user,
  session,
  context,
  workflowCode,
  finalizationWorkflowRunId,
} = {}) {
  return {
    ...result,
    promotionStart: {
      authorizationSource: 'HUMAN_UI',
      workflowCode,
      repositoryCode: identity.repositoryCode,
      finalizationWorkflowRunId,
      finalizationReceiptSha256: finalization.receipt?.receiptSha256 || null,
      finalizationSourceIdentityDigest: finalization.sourceIdentity?.digest || null,
      idempotency: {
        keyHash: identity.idempotencyKeyHash,
        requestDigest: identity.requestDigest,
      },
      trustedAttribution: {
        principalCode: 'operator-ui',
        principalId: user?.userId || null,
        userId: user?.userId || null,
        sessionId: session?.sessionId || context?.sessionId || null,
        instructionSource: 'OPERATOR',
        instructionRef: identity.requestId,
        triggerSource: 'ADMIN_WEB',
        triggerType: 'MANUAL',
        requestedAt: context?.promotionAuthorization?.requestedAt || null,
      },
    },
  };
}

async function startAssistantDevelopmentPromotion({
  body = {},
  permissions = [],
  actor = null,
  session = null,
  context = {},
  agentId = 'assistant-http',
  workflowAgentExecution = workflowAgentExecutionService,
  promotionValidator = promotionPreflight.validateFinalizationBinding,
  config,
  requiredPermissionCodes = [],
  assertExactBody,
} = {}) {
  if (!config?.enabled) {
    throw createHttpError(
      503,
      'Assistant development promotion is disabled or not safely configured.',
      {
        code: config?.blockedReason || 'ASSISTANT_DEV_PROMOTION_DISABLED',
        workflowCode: DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
        repositoryCode: config?.repositoryCode || null,
      },
    );
  }

  const granted = new Set(
    (permissions || [])
      .map((permission) =>
        typeof permission === 'string' ? permission : String(permission?.permissionCode || ''),
      )
      .map((permissionCode) => permissionCode.trim())
      .filter(Boolean),
  );
  const missingPermissionCodes = requiredPermissionCodes.filter(
    (permissionCode) => !granted.has(permissionCode),
  );
  if (missingPermissionCodes.length > 0) {
    throw createHttpError(403, 'Assistant development promotion permission scope is incomplete.', {
      code: 'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING',
      missingPermissionCodes,
    });
  }

  assertExactBody(body);
  const commitMessage = validateDevelopmentPromotionCommitMessage(body.commitMessage);
  const finalizationWorkflowRunId = validateDevelopmentPromotionFinalizationWorkflowRunId(
    body.finalizationWorkflowRunId,
  );
  const idempotencyKey = validateDevelopmentPromotionIdempotencyKey(body.idempotencyKey);
  const finalization = await promotionValidator({
    finalizationWorkflowRunId,
    environment: process.env,
    verifyCurrent: true,
  });
  const requestedAt = new Date().toISOString();
  const trustedContext = {
    ...context,
    agentId,
    promotionAuthorization: {
      instructionSource: 'ASSISTANT',
      triggerSource: 'ASSISTANT',
      triggerType: 'ASSISTANT',
      agentId,
      instructionRef: context?.instructionRef || null,
      requestedAt,
      finalizationWorkflowRunId,
      finalizationReceiptSha256: finalization.receipt?.receiptSha256 || null,
      finalizationSourceIdentityDigest: finalization.sourceIdentity?.digest || null,
    },
  };
  const result = await workflowAgentExecution.startWorkflow({
    request: {
      workflowCode: DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
      parameters: buildPromotionParameters({ commitMessage, finalizationWorkflowRunId }),
      idempotencyKey,
    },
    principalCode: 'assistant-http',
    authMode: 'ASSISTANT_SERVICE_TOKEN',
    actor,
    session,
    context: trustedContext,
  });

  return {
    accepted: result?.accepted !== false,
    reused: Boolean(result?.reused),
    status: result?.status || null,
    started: result?.status === 'STARTED',
    admissionId: result?.admissionId || null,
    workflowCode: DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
    repositoryCode: config.repositoryCode,
    workflowRunRecordId: result?.workflowRunRecordId || null,
    temporalWorkflowId: result?.temporalWorkflowId || null,
    temporalRunId: result?.temporalRunId || null,
    principal: result?.principal || null,
    idempotency: result?.idempotency || null,
    finalizationWorkflowCode: DEVELOPMENT_PROMOTION_FINALIZATION_WORKFLOW_CODE,
    finalizationWorkflowRunId,
    finalizationReceiptSha256: finalization.receipt?.receiptSha256 || null,
    finalizationSourceIdentityDigest: finalization.sourceIdentity?.digest || null,
    triggerSource: 'ASSISTANT',
    triggerType: 'ASSISTANT',
    humanApprovalRequired: false,
    agentMustStop: false,
    terminalObservationRequired: true,
    terminalObservationPath: '/api/assistant/workflow-runs/{workflowRunRecordId}',
    trustedAttribution: {
      agentId,
      userId: actor?.userId || null,
      sessionId: session?.sessionId || null,
      instructionSource: 'ASSISTANT',
      instructionRef: context?.instructionRef || null,
      requestedAt,
    },
  };
}

async function startManualDevelopmentPromotion({
  workflowCode = DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
  input = {},
  user = null,
  session = null,
  permissions = [],
  context = {},
  environment = process.env,
  workflowExecutor = workflowExecutorService,
  promotionValidator = promotionPreflight.validateFinalizationBinding,
} = {}) {
  if (!DEVELOPMENT_PROMOTION_WORKFLOW_CODES.includes(workflowCode)) {
    throw createHttpError(404, 'The requested workflow is not a Development Promotion workflow.', {
      code: 'DEV_PROMOTION_WORKFLOW_NOT_SUPPORTED',
      workflowCode,
    });
  }

  const parameters = getPromotionParameters(input);
  if (parameters.repoName !== DEVELOPMENT_PROMOTION_REPOSITORY_CODE) {
    throw createHttpError(400, 'Development Promotion is bound to the SkyCommand repository.', {
      code: 'ASSISTANT_DEV_PROMOTION_REPOSITORY_SCOPE_INVALID',
    });
  }
  const commitMessage = validateDevelopmentPromotionCommitMessage(parameters.commitMessage);
  const finalizationWorkflowRunId = validateDevelopmentPromotionFinalizationWorkflowRunId(
    parameters.finalizationWorkflowRunId,
  );
  const normalizedParameters = buildPromotionParameters({
    commitMessage,
    finalizationWorkflowRunId,
  });
  const definition =
    typeof workflowExecutor.getWorkflowDefinition === 'function'
      ? await workflowExecutor.getWorkflowDefinition(workflowCode)
      : null;
  const identity = buildManualPromotionIdentity({
    input: { params: normalizedParameters },
    user,
    session,
    context,
    workflowCode,
    definition,
    environment,
  });
  const finalization = await promotionValidator({
    finalizationWorkflowRunId,
    environment,
    verifyCurrent: true,
  });
  const promotionAuthorization = buildManualPromotionAuthorization({
    identity,
    user,
    finalizationWorkflowRunId,
  });
  const trustedContext = {
    ...context,
    requestId: identity.requestId,
    sessionId: session?.sessionId || context?.sessionId || null,
    promotionAuthorization: {
      ...promotionAuthorization,
      finalizationReceiptSha256: finalization.receipt?.receiptSha256 || null,
      finalizationSourceIdentityDigest: finalization.sourceIdentity?.digest || null,
    },
  };
  const existingRun =
    typeof workflowExecutor.findWorkflowRunByPromotionIdentity === 'function'
      ? await workflowExecutor.findWorkflowRunByPromotionIdentity({
          workflowCode,
          idempotencyKeyHash: identity.idempotencyKeyHash,
        })
      : null;
  if (existingRun) {
    const existingInput = safeObject(existingRun.input);
    const existingPromotionRequest = safeObject(existingInput.promotionRequest);
    const existingRequestDigest = String(existingPromotionRequest.requestDigest || '')
      .trim()
      .toUpperCase();
    if (existingRequestDigest !== identity.requestDigest) {
      throw createHttpError(
        409,
        'The manual promotion request identity was already used for a different request.',
        {
          code: 'R6_PROMOTION_IDEMPOTENCY_CONFLICT',
          idempotencyKeyHash: identity.idempotencyKeyHash,
          originalRequestDigest: existingRequestDigest || null,
          requestDigest: identity.requestDigest,
        },
      );
    }
    const detail =
      typeof workflowExecutor.getWorkflowRun === 'function'
        ? await workflowExecutor.getWorkflowRun(existingRun.workflow_run_record_id)
        : null;
    return buildManualPromotionResult({
      result: {
        ok: true,
        started: true,
        async: true,
        reused: true,
        run: detail?.run || existingRun,
        nodeRuns: detail?.nodeRuns || [],
        nodeOutputs: detail?.nodeOutputs || [],
        temporalWorkflow: detail?.temporalRuntime
          ? {
              workflowId: detail.temporalRuntime.workflowId || null,
              runId: detail.temporalRuntime.runId || null,
            }
          : null,
        message: 'Development Promotion start reused the existing admitted workflow run.',
      },
      identity,
      finalization,
      user,
      session,
      context: trustedContext,
      workflowCode,
      finalizationWorkflowRunId,
    });
  }

  const result = await workflowExecutor.startWorkflowWithTemporal({
    workflowCode,
    input: buildManualPromotionInput({ input, parameters: normalizedParameters, identity }),
    user,
    session,
    permissions,
    context: trustedContext,
  });

  return buildManualPromotionResult({
    result,
    identity,
    finalization,
    user,
    session,
    context: trustedContext,
    workflowCode,
    finalizationWorkflowRunId,
  });
}

module.exports = {
  DEVELOPMENT_PROMOTION_FINALIZATION_WORKFLOW_CODE,
  DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH,
  DEVELOPMENT_PROMOTION_MAX_IDEMPOTENCY_KEY_LENGTH,
  DEVELOPMENT_PROMOTION_REPOSITORY_CODE,
  DEVELOPMENT_PROMOTION_UUID_PATTERN,
  DEVELOPMENT_PROMOTION_WORKFLOW_CODE,
  DEVELOPMENT_PROMOTION_WORKFLOW_CODES,
  buildManualPromotionIdentity,
  buildManualPromotionInput,
  buildPromotionParameters,
  startAssistantDevelopmentPromotion,
  startManualDevelopmentPromotion,
  validateDevelopmentPromotionCommitMessage,
  validateDevelopmentPromotionFinalizationWorkflowRunId,
  validateDevelopmentPromotionIdempotencyKey,
};
