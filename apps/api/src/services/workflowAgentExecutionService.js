const crypto = require('node:crypto');

const { pool, query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');
const workflowExecutorService = require('./workflowExecutorService');
const { WorkflowServiceError } = require('./workflowServiceError');

let dependencyOverrides = null;

function dbQuery(...args) {
  return (dependencyOverrides?.query || query)(...args);
}

function getDatabasePool() {
  return dependencyOverrides?.pool || pool;
}

function getWorkflowExecutorService() {
  return dependencyOverrides?.workflowExecutor || workflowExecutorService;
}

function getAuthService() {
  return dependencyOverrides?.auth || authService;
}

async function withTestDependencies(overrides, callback) {
  if (
    String(process.env.NODE_ENV || '')
      .trim()
      .toLowerCase() === 'production'
  ) {
    throw new Error('R4 test dependency overrides are unavailable in production.');
  }

  const previous = dependencyOverrides;
  dependencyOverrides = { ...(previous || {}), ...(overrides || {}) };
  try {
    return await callback();
  } finally {
    dependencyOverrides = previous;
  }
}

const DEFAULT_ASSISTANT_PRINCIPAL_CODE = 'assistant-http';
const DEFAULT_ASSISTANT_AUTH_MODE = 'ASSISTANT_SERVICE_TOKEN';
const CORE_APP_CODE =
  process.env.SKYCOMMAND_CORE_APP_CODE || process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE';
const WORKFLOW_RUN_PERMISSION = 'WORKFLOW_RUN';
const LOW_RISK_PERMISSION = 'CORE_RUN_LOW_RISK_SCRIPT';
const MEDIUM_RISK_PERMISSION = 'CORE_RUN_MEDIUM_RISK_SCRIPT';
const HIGH_RISK_PERMISSION = 'CORE_RUN_HIGH_RISK_SCRIPT';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const R4_REDACTED_TEXT = '[REDACTED]';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const PRINCIPAL_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'SKIPPED']);

function serviceError(message, statusCode, details = {}) {
  return new WorkflowServiceError(message, statusCode, details);
}

function getSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').toUpperCase();
}

function normalizeText(value, label, { required = true, maxLength = 200 } = {}) {
  const text = String(value ?? '').trim();
  if (!text && required)
    throw serviceError(`${label} is required.`, 400, { code: 'INVALID_REQUEST' });
  if (text.length > maxLength) {
    throw serviceError(`${label} exceeds the maximum length.`, 400, {
      code: 'INVALID_REQUEST',
      field: label,
      maxLength,
    });
  }
  if (/[\x00-\x1F\x7F-\x9F]/.test(text)) {
    throw serviceError(`${label} contains unsupported control characters.`, 400, {
      code: 'INVALID_REQUEST',
      field: label,
    });
  }
  return text;
}

function normalizeRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw serviceError('Workflow start request must be a JSON object.', 400, {
      code: 'INVALID_REQUEST',
    });
  }

  const allowedKeys = new Set(['workflowCode', 'parameters', 'idempotencyKey']);
  const unexpectedFields = Object.keys(request).filter((key) => !allowedKeys.has(key));
  if (unexpectedFields.length > 0) {
    throw serviceError('Workflow start request contains unsupported fields.', 400, {
      code: 'INVALID_REQUEST',
      unexpectedFields,
    });
  }

  const workflowCode = normalizeText(request.workflowCode, 'workflowCode', { maxLength: 160 });
  if (!WORKFLOW_CODE_PATTERN.test(workflowCode)) {
    throw serviceError('workflowCode contains unsupported characters.', 400, {
      code: 'INVALID_REQUEST',
      field: 'workflowCode',
    });
  }

  const idempotencyKey = normalizeText(request.idempotencyKey, 'idempotencyKey', {
    maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
  });
  const parameters = request.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw serviceError('parameters must be a JSON object.', 400, {
      code: 'INVALID_REQUEST',
      field: 'parameters',
    });
  }

  let requestBytes;
  try {
    requestBytes = Buffer.byteLength(canonicalJson(parameters), 'utf8');
  } catch (error) {
    throw serviceError('parameters must be JSON serializable.', 400, {
      code: 'INVALID_REQUEST',
      field: 'parameters',
    });
  }
  if (requestBytes > MAX_REQUEST_BYTES) {
    throw serviceError('parameters exceeds the request size limit.', 413, {
      code: 'REQUEST_TOO_LARGE',
      maxBytes: MAX_REQUEST_BYTES,
    });
  }

  return { workflowCode, parameters, idempotencyKey };
}

function getProfileCode(environment = process.env) {
  return String(
    environment.SKYCOMMAND_CONFIG_PROFILE ||
      environment.SKYSERVER_CONFIG_PROFILE ||
      environment.SKYCOMMAND_CORE_PROFILE ||
      environment.SKYSERVER_CORE_PROFILE ||
      environment.CONFIG_PROFILE ||
      'DEV_LOCAL',
  )
    .trim()
    .toUpperCase();
}

function getEnvironmentCode(environment = process.env) {
  return String(environment.SKYCOMMAND_ENVIRONMENT_CODE || getProfileCode(environment))
    .trim()
    .toUpperCase();
}

function normalizePrincipalCode(value) {
  const code = normalizeText(value, 'principalCode', { maxLength: 128 });
  if (!PRINCIPAL_CODE_PATTERN.test(code)) {
    throw serviceError('principalCode contains unsupported characters.', 400, {
      code: 'INVALID_PRINCIPAL_CONTEXT',
    });
  }
  return code;
}

function permissionRows(permissionCodes = []) {
  return [...new Set(permissionCodes.map((code) => String(code || '').trim()).filter(Boolean))].map(
    (permissionCode) => ({ permissionCode, permission_code: permissionCode }),
  );
}

function parsePermissionCodes(value) {
  if (Array.isArray(value)) return value.map((code) => String(code || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      return parsePermissionCodes(JSON.parse(value));
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function normalizePrincipalRow(row) {
  return {
    principalId: row.workflow_execution_principal_id,
    principalCode: row.principal_code,
    displayName: row.display_name,
    authMode: row.auth_mode,
    status: row.status,
  };
}

function normalizeGrantRow(row) {
  return {
    grantId: row.workflow_execution_resource_grant_id,
    principalId: row.workflow_execution_principal_id,
    repositoryCode: row.repository_code,
    environmentCode: row.environment_code,
    configProfileCode: row.config_profile_code,
    workflowCode: row.workflow_code,
    allowedPermissionCodes: parsePermissionCodes(row.allowed_permission_codes),
    status: row.status,
  };
}

function normalizeAdmissionRow(row) {
  return {
    admissionId: row.workflow_execution_admission_id,
    principalId: row.workflow_execution_principal_id,
    grantId: row.workflow_execution_resource_grant_id,
    workflowRunRecordId: row.workflow_run_record_id,
    idempotencyKeyHash: row.idempotency_key_hash,
    requestDigest: row.request_digest,
    workflowCode: row.workflow_code,
    workflowDefinitionId: row.workflow_definition_id,
    workflowVersionId: row.workflow_version_id,
    versionNumber: row.version_number,
    repositoryCode: row.repository_code,
    environmentCode: row.environment_code,
    configProfileCode: row.config_profile_code,
    validatedParameters: getSafeObject(row.validated_parameters),
    parameterContract: Array.isArray(row.parameter_contract) ? row.parameter_contract : [],
    status: row.status,
    temporalWorkflowId: row.temporal_workflow_id || null,
    temporalRunId: row.temporal_run_id || null,
    failureCode: row.failure_code || null,
    failureMessage: row.failure_message || null,
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function resolvePrincipal({ principalCode, authMode = null } = {}) {
  const normalizedPrincipalCode = normalizePrincipalCode(principalCode);
  const result = await dbQuery(
    `
      SELECT workflow_execution_principal_id, principal_code, display_name, auth_mode, status
      FROM auth.workflow_execution_principals
      WHERE principal_code = $1
        AND status = 'ACTIVE'
        AND ($2::text IS NULL OR auth_mode = $2)
      LIMIT 1
    `,
    [normalizedPrincipalCode, authMode ? String(authMode).trim() : null],
  );

  if (!result.rows[0]) {
    throw serviceError('The authenticated execution principal is not registered for R4.', 403, {
      code: 'WORKFLOW_PRINCIPAL_NOT_REGISTERED',
      principalCode: normalizedPrincipalCode,
    });
  }

  return normalizePrincipalRow(result.rows[0]);
}

async function resolveGrant({
  principalId,
  workflowCode,
  repositoryCode = null,
  environmentCode,
  configProfileCode,
}) {
  const result = await dbQuery(
    `
      SELECT *
      FROM worker.workflow_execution_resource_grants
      WHERE workflow_execution_principal_id = $1
        AND workflow_code = $2
        AND ($3::text IS NULL OR LOWER(repository_code) = LOWER($3))
        AND LOWER(environment_code) = LOWER($4)
        AND LOWER(config_profile_code) = LOWER($5)
        AND status = 'ACTIVE'
      ORDER BY LOWER(repository_code), workflow_execution_resource_grant_id
    `,
    [principalId, workflowCode, repositoryCode, environmentCode, configProfileCode],
  );

  if (!result.rows[0]) {
    throw serviceError('The execution principal has no matching Workflow resource grant.', 403, {
      code: 'WORKFLOW_RESOURCE_GRANT_DENIED',
      workflowCode,
      repositoryCode,
      environmentCode,
      configProfileCode,
    });
  }

  if (result.rows.length !== 1) {
    throw serviceError('The Workflow resource grant set is ambiguous.', 409, {
      code: 'WORKFLOW_RESOURCE_GRANT_AMBIGUOUS',
      workflowCode,
      repositoryCode,
      environmentCode,
      configProfileCode,
      matchingGrantCount: result.rows.length,
    });
  }

  return normalizeGrantRow(result.rows[0]);
}

async function assertRepositoryBinding({ repositoryCode, configProfileCode }) {
  const result = await dbQuery(
    `
      SELECT repo_code, profile_code
      FROM core.vw_repository_paths
      WHERE LOWER(repo_code) = LOWER($1)
        AND LOWER(profile_code) = LOWER($2)
      ORDER BY repo_code, profile_code
    `,
    [repositoryCode, configProfileCode],
  );

  if (!result.rows[0]) {
    throw serviceError('The granted repository/profile binding is not active.', 403, {
      code: 'WORKFLOW_RESOURCE_BINDING_UNAVAILABLE',
      repositoryCode,
      configProfileCode,
    });
  }

  if (result.rows.length !== 1) {
    throw serviceError('The repository/profile binding is ambiguous.', 409, {
      code: 'WORKFLOW_RESOURCE_BINDING_AMBIGUOUS',
      repositoryCode,
      configProfileCode,
      matchingBindingCount: result.rows.length,
    });
  }
}

function getRiskPermission(riskCode) {
  switch (
    String(riskCode || '')
      .trim()
      .toLowerCase()
  ) {
    case 'low':
      return LOW_RISK_PERMISSION;
    case 'medium':
      return MEDIUM_RISK_PERMISSION;
    case 'high':
      return HIGH_RISK_PERMISSION;
    default:
      return null;
  }
}

async function loadToolAuthority(toolCode, configProfileCode) {
  const result = await dbQuery(
    `
      SELECT
        tool.tool_code,
        tool.permission_code,
        tool.risk_code,
        tool.enabled
      FROM core.tools tool
      JOIN core.tool_categories category ON category.category_id = tool.category_id
      JOIN core.applications application ON application.app_id = category.app_id
      JOIN core.repositories repository ON repository.repo_id = tool.script_repo_id
      JOIN core.repository_paths repository_path ON repository_path.repo_id = repository.repo_id
      JOIN core.config_profiles profile ON profile.profile_id = repository_path.profile_id
      WHERE application.app_code = $1
        AND application.active = TRUE
        AND category.enabled = TRUE
        AND tool.tool_code = $2
        AND tool.enabled = TRUE
        AND repository.active = TRUE
        AND repository_path.active = TRUE
        AND profile.active = TRUE
        AND profile.profile_code = $3
        AND EXISTS (
          SELECT 1 FROM core.tool_visibility visibility
          WHERE visibility.tool_id = tool.tool_id AND visibility.channel_code = 'admin-web'
        )
        AND EXISTS (
          SELECT 1 FROM core.tool_visibility visibility
          WHERE visibility.tool_id = tool.tool_id AND visibility.channel_code = 'api'
        )
      LIMIT 1
    `,
    [CORE_APP_CODE, toolCode, configProfileCode],
  );

  if (!result.rows[0]) {
    throw serviceError('A Workflow Tool target is not registered for this profile.', 409, {
      code: 'WORKFLOW_AUTHORITY_CLOSURE_TOOL_MISSING',
      toolCode,
      configProfileCode,
    });
  }

  const requiredRiskPermission = getRiskPermission(result.rows[0].risk_code);
  if (!requiredRiskPermission) {
    throw serviceError('A Workflow Tool target has an unsupported risk level.', 409, {
      code: 'WORKFLOW_AUTHORITY_CLOSURE_RISK_UNSUPPORTED',
      toolCode,
      riskCode: result.rows[0].risk_code || null,
    });
  }

  return {
    toolCode: result.rows[0].tool_code,
    permissionCode: result.rows[0].permission_code || null,
    riskCode: result.rows[0].risk_code,
    requiredRiskPermission,
  };
}

function assertGrantPermissions(grant, requiredPermissionCodes, workflowCode, nodeKey = null) {
  const allowed = new Set(grant.allowedPermissionCodes);
  const missingPermissionCodes = [...new Set(requiredPermissionCodes.filter(Boolean))].filter(
    (permissionCode) => !allowed.has(permissionCode),
  );
  if (missingPermissionCodes.length > 0) {
    throw serviceError('The Workflow authority closure is incomplete.', 403, {
      code: 'WORKFLOW_AUTHORITY_CLOSURE_MISSING',
      workflowCode,
      nodeKey,
      missingPermissionCodes,
      grantId: grant.grantId,
    });
  }
}

function getStaticChildWorkflowCode(node = {}) {
  const targetCode = String(node.targetCode || '').trim();
  const configuredCode = String(getSafeObject(node.inputParameters).workflowCode || '').trim();
  const childCode = targetCode || configuredCode;
  if (!childCode || childCode.includes('{{') || !WORKFLOW_CODE_PATTERN.test(childCode)) {
    throw serviceError('Child Workflow targets must be statically registered.', 409, {
      code: 'WORKFLOW_AUTHORITY_CLOSURE_DYNAMIC_CHILD',
      nodeKey: node.nodeKey || null,
    });
  }
  return childCode;
}

async function assertAuthorityClosure({
  definition,
  grant,
  principal,
  repositoryCode,
  environmentCode,
  configProfileCode,
  visited = new Set(),
  depth = 0,
} = {}) {
  if (depth > 8) {
    throw serviceError('Workflow authority closure exceeded the nesting limit.', 409, {
      code: 'WORKFLOW_AUTHORITY_CLOSURE_TOO_DEEP',
      workflowCode: definition.workflowCode,
    });
  }

  const visitKey = `${principal.principalId}:${grant.grantId}:${definition.workflowCode}:${definition.publishedVersionId}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  assertGrantPermissions(
    grant,
    [WORKFLOW_RUN_PERMISSION, definition.startPermissionCode],
    definition.workflowCode,
  );

  for (const node of definition.nodes || []) {
    const nodeType = String(node.nodeTypeCode || '')
      .trim()
      .toUpperCase();
    if (nodeType === 'TOOL') {
      const tool = await loadToolAuthority(node.targetCode, configProfileCode);
      assertGrantPermissions(
        grant,
        [tool.permissionCode, tool.requiredRiskPermission],
        definition.workflowCode,
        node.nodeKey,
      );
      continue;
    }

    if (nodeType === 'WORKFLOW' || nodeType === 'TEMPORAL_WORKFLOW') {
      const childWorkflowCode = getStaticChildWorkflowCode(node);
      const childGrant = await resolveGrant({
        principalId: principal.principalId,
        workflowCode: childWorkflowCode,
        repositoryCode,
        environmentCode,
        configProfileCode,
      });
      const childDefinition =
        await getWorkflowExecutorService().getWorkflowDefinition(childWorkflowCode);
      await assertAuthorityClosure({
        definition: childDefinition,
        grant: childGrant,
        principal,
        repositoryCode,
        environmentCode,
        configProfileCode,
        visited,
        depth: depth + 1,
      });
    }
  }
}

function getParameterContract(definition = {}) {
  const config = getSafeObject(definition.config);
  const parameters = Array.isArray(config.runtimeParameters)
    ? config.runtimeParameters
    : Array.isArray(config.parameterSchema?.runtimeParameters)
      ? config.parameterSchema.runtimeParameters
      : Array.isArray(config.parameterSchema?.parameters)
        ? config.parameterSchema.parameters
        : [];

  return parameters.map((parameter, index) => {
    const value = getSafeObject(parameter);
    return {
      key: String(value.key || value.parameterName || value.name || `param_${index + 1}`),
      type: String(value.type || value.paramTypeCode || 'string'),
      required: Boolean(value.required),
      optionSourceCode: value.optionSourceCode || null,
      maxLength: Number.isFinite(Number(value.maxLength)) ? Number(value.maxLength) : null,
    };
  });
}

function containsSecretLikeKey(value, path = '') {
  if (Array.isArray(value))
    return value.some((item, index) => containsSecretLikeKey(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => {
    if (/(password|passwd|secret|token|credential|private.?key|api.?key)/i.test(key)) return true;
    return containsSecretLikeKey(nested, `${path}.${key}`);
  });
}

function redactSensitiveText(value) {
  return String(value ?? '')
    .replace(/(?:authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{8,}/gi, R4_REDACTED_TEXT)
    .replace(
      /(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|connection[_-]?string)\s*[:=]\s*['"]?[^'"\s,;}]+/gi,
      R4_REDACTED_TEXT,
    )
    .replace(/\b[\w./-]*(?:secret|token|password|credential)[\w./-]*\b/gi, R4_REDACTED_TEXT)
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, R4_REDACTED_TEXT)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, R4_REDACTED_TEXT)
    .replace(
      /\b(?=[A-Za-z0-9+/_=-]{32,}\b)(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]{32,}\b/g,
      R4_REDACTED_TEXT,
    );
}

function normalizeSafeMessage(value, maxLength = 1000) {
  return redactSensitiveText(String(value || ''))
    .replace(/[A-Za-z]:[\\/][^\r\n\t ]+/g, '[path-redacted]')
    .replace(/(?:\\|\/)(?:Users|home|var|tmp|workspace)(?:\\|\/)[^\r\n\t ]+/gi, '[path-redacted]')
    .slice(0, maxLength);
}

function sanitizeR4Value(value, key = null) {
  if (
    key &&
    /(password|passwd|secret|token|credential|private.?key|api.?key|authorization)/i.test(key)
  ) {
    return R4_REDACTED_TEXT;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeR4Value(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeR4Value(nestedValue, nestedKey),
      ]),
    );
  }
  if (typeof value === 'string') return normalizeSafeMessage(value, 1000);
  return value ?? null;
}

function getSafeErrorCode(error, fallback = 'WORKFLOW_START_FAILED') {
  const candidate = String(error?.details?.code || error?.code || fallback).trim();
  return /^[A-Z0-9_.:-]{1,80}$/i.test(candidate) ? candidate : fallback;
}

function getSafeFailureMessage(error) {
  return `Workflow execution failed (${getSafeErrorCode(error)}).`;
}

function createSafeExecutionError(error) {
  const code = getSafeErrorCode(error);
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const details = getSafeObject(sanitizeR4Value(error?.details));
  details.code = code;
  return serviceError(`R4 Workflow execution failed (${code}).`, statusCode, details);
}

function buildExecutionContext({ principal, grant, admissionId, workflowRunRecordId }) {
  return {
    principalId: principal.principalId,
    principalCode: principal.principalCode,
    authMode: principal.authMode,
    resourceGrantId: grant.grantId,
    admissionId,
    rootWorkflowRunRecordId: workflowRunRecordId,
    repositoryCode: grant.repositoryCode,
    environmentCode: grant.environmentCode,
    configProfileCode: grant.configProfileCode,
  };
}

async function loadAdmissionByKey(principalId, idempotencyKeyHash) {
  const result = await dbQuery(
    `
      SELECT *
      FROM worker.workflow_execution_admissions
      WHERE workflow_execution_principal_id = $1
        AND idempotency_key_hash = $2
      LIMIT 1
    `,
    [principalId, idempotencyKeyHash],
  );
  return result.rows[0] ? normalizeAdmissionRow(result.rows[0]) : null;
}

function getDispatchLockWaitMs(environment = process.env) {
  const configured = Number.parseInt(environment.SKYCOMMAND_R4_DISPATCH_LOCK_WAIT_MS || '', 10);
  if (!Number.isFinite(configured)) return 15000;
  return Math.min(Math.max(configured, 100), 30000);
}

async function withAdmissionDispatchLock(admissionId, callback, environment = process.env) {
  const deadline = Date.now() + getDispatchLockWaitMs(environment);
  const lockKey = String(admissionId || '').trim();
  if (!lockKey) throw serviceError('admissionId is required for dispatch locking.', 500);

  while (Date.now() <= deadline) {
    const client = await getDatabasePool().connect();
    let locked = false;
    try {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [lockKey],
      );
      locked = result.rows[0]?.locked === true || result.rows[0]?.locked === 't';
      if (locked) {
        return { locked: true, result: await callback() };
      }
    } finally {
      if (locked) {
        await client
          .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
          .catch(() => {});
      }
      client.release();
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return { locked: false, result: null };
}

async function runTestHook(name, payload) {
  const hook = dependencyOverrides?.hooks?.[name];
  return typeof hook === 'function' ? hook(payload) : undefined;
}

function isTestProcessCrash(error) {
  return Boolean(dependencyOverrides?.hooks && error?.code === 'R4_TEST_PROCESS_CRASH');
}

async function insertAdmission({
  admissionId,
  principal,
  grant,
  workflowRunRecordId,
  idempotencyKeyHash,
  requestDigest,
  definition,
  parameters,
  parameterContract,
}) {
  const result = await dbQuery(
    `
      INSERT INTO worker.workflow_execution_admissions (
        workflow_execution_admission_id,
        workflow_execution_principal_id,
        workflow_execution_resource_grant_id,
        workflow_run_record_id,
        idempotency_key_hash,
        request_digest,
        workflow_code,
        workflow_definition_id,
        workflow_version_id,
        version_number,
        repository_code,
        environment_code,
        config_profile_code,
        validated_parameters,
        parameter_contract,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, 'ADMITTED')
      RETURNING *
    `,
    [
      admissionId,
      principal.principalId,
      grant.grantId,
      workflowRunRecordId,
      idempotencyKeyHash,
      requestDigest,
      definition.workflowCode,
      definition.workflowDefinitionId,
      definition.publishedVersionId,
      definition.publishedVersionNumber,
      grant.repositoryCode,
      grant.environmentCode,
      grant.configProfileCode,
      JSON.stringify(parameters),
      JSON.stringify(parameterContract),
    ],
  );
  return normalizeAdmissionRow(result.rows[0]);
}

async function claimAdmission(admissionId) {
  const result = await dbQuery(
    `
      UPDATE worker.workflow_execution_admissions
      SET status = 'STARTING',
          updated_at = CURRENT_TIMESTAMP
      WHERE workflow_execution_admission_id = $1
        AND status = 'ADMITTED'
      RETURNING *
    `,
    [admissionId],
  );
  return result.rows[0] ? normalizeAdmissionRow(result.rows[0]) : null;
}

async function updateAdmission(admissionId, patch = {}) {
  const result = await dbQuery(
    `
      UPDATE worker.workflow_execution_admissions
      SET status = COALESCE($2, status),
          temporal_workflow_id = COALESCE($3, temporal_workflow_id),
          temporal_run_id = COALESCE($4, temporal_run_id),
          failure_code = COALESCE($5, failure_code),
          failure_message = COALESCE($6, failure_message),
          started_at = CASE WHEN $2 = 'STARTED' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
          completed_at = CASE WHEN $2 IN ('FAILED', 'CANCELED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE workflow_execution_admission_id = $1
      RETURNING *
    `,
    [
      admissionId,
      patch.status || null,
      patch.temporalWorkflowId || null,
      patch.temporalRunId || null,
      patch.failureCode || null,
      patch.failureMessage ? normalizeSafeMessage(patch.failureMessage) : null,
    ],
  );
  return result.rows[0] ? normalizeAdmissionRow(result.rows[0]) : null;
}

function buildReceipt({ admission, principal, reused = false, warning = null } = {}) {
  return {
    accepted: admission.status !== 'FAILED',
    reused,
    status: admission.status,
    admissionId: admission.admissionId,
    principal: {
      principalId: principal.principalId,
      principalCode: principal.principalCode,
      authMode: principal.authMode,
    },
    resource: {
      grantId: admission.grantId,
      repositoryCode: admission.repositoryCode,
      environmentCode: admission.environmentCode,
      configProfileCode: admission.configProfileCode,
      workflowCode: admission.workflowCode,
      workflowDefinitionId: admission.workflowDefinitionId,
      workflowVersionId: admission.workflowVersionId,
      versionNumber: admission.versionNumber,
    },
    idempotency: {
      keyHash: admission.idempotencyKeyHash,
      requestDigest: admission.requestDigest,
    },
    workflowRunRecordId: admission.workflowRunRecordId,
    temporalWorkflowId: admission.temporalWorkflowId,
    temporalRunId: admission.temporalRunId,
    createdAt: admission.createdAt,
    startedAt: admission.startedAt,
    completedAt: admission.completedAt,
    ...(admission.failureCode ? { failureCode: admission.failureCode } : {}),
    ...(warning ? { warning } : {}),
  };
}

async function recordAdmissionAudit({
  principal,
  admission,
  context,
  success,
  action,
  message,
  metadata = {},
}) {
  await getAuthService().recordAuditEvent({
    userId: null,
    eventType: 'WORKFLOW_AGENT_EXECUTION',
    resourceType: 'worker.workflow_execution_admissions',
    resourceId: admission?.admissionId || null,
    action,
    success,
    message: normalizeSafeMessage(message, 500),
    metadata: {
      principalCode: principal?.principalCode || null,
      principalId: principal?.principalId || null,
      admissionId: admission?.admissionId || null,
      workflowRunRecordId: admission?.workflowRunRecordId || null,
      workflowCode: admission?.workflowCode || null,
      workflowVersionId: admission?.workflowVersionId || null,
      requestDigest: admission?.requestDigest || null,
      ...sanitizeR4Value(metadata),
    },
    ipAddress: context?.ipAddress ? normalizeSafeMessage(context.ipAddress, 200) : null,
    userAgent: context?.userAgent ? normalizeSafeMessage(context.userAgent, 500) : null,
  });
}

async function dispatchAdmission({
  admission,
  principal,
  grant,
  idempotencyKeyHash,
  requestDigest,
  validatedParameters,
  context = {},
  session = null,
  environment = process.env,
} = {}) {
  const lockedResult = await withAdmissionDispatchLock(
    admission.admissionId,
    async () => {
      let current = await loadAdmissionByKey(principal.principalId, idempotencyKeyHash);
      if (!current) {
        throw serviceError('The R4 admission could not be reloaded for dispatch.', 409, {
          code: 'WORKFLOW_ADMISSION_NOT_FOUND',
          admissionId: admission.admissionId,
        });
      }

      if (current.requestDigest !== requestDigest) {
        throw serviceError('The idempotency key was already used for a different request.', 409, {
          code: 'WORKFLOW_IDEMPOTENCY_CONFLICT',
          keyHash: idempotencyKeyHash,
          originalRequestDigest: current.requestDigest,
          requestDigest,
        });
      }

      if (current.status === 'ADMITTED') {
        current = (await claimAdmission(current.admissionId)) || current;
      }

      if (current.status === 'STARTED' && current.temporalWorkflowId) {
        return buildReceipt({ admission: current, principal, reused: true });
      }

      if (['FAILED', 'CANCELED'].includes(current.status)) {
        return buildReceipt({ admission: current, principal, reused: true });
      }

      await runTestHook('afterAdmissionClaim', current);

      const executionContext = buildExecutionContext({
        principal,
        grant,
        admissionId: current.admissionId,
        workflowRunRecordId: current.workflowRunRecordId,
      });
      const executionActor = {
        userId: null,
        email: principal.principalCode + '@local',
        username: principal.principalCode,
        displayName: principal.displayName,
        status: 'ACTIVE',
        isSystemUser: true,
      };
      const input = {
        params: validatedParameters,
        runtimeParameters: validatedParameters,
        runSource: 'assistant',
        triggerType: 'ASSISTANT',
        workflowVersionId: current.workflowVersionId,
        workflowId: `skycommand-agent-${current.admissionId}`,
      };

      try {
        const result = await getWorkflowExecutorService().startWorkflowWithTemporal({
          workflowCode: current.workflowCode,
          workflowVersionId: current.workflowVersionId,
          workflowRunRecordId: current.workflowRunRecordId,
          input,
          user: executionActor,
          session,
          permissions: permissionRows(grant.allowedPermissionCodes),
          context: { ...getSafeObject(context), executionContext },
        });
        await runTestHook('beforeAdmissionUpdate', {
          admission: current,
          result,
        });
        current =
          (await updateAdmission(current.admissionId, {
            status: 'STARTED',
            temporalWorkflowId: result.temporalWorkflow?.workflowId || null,
            temporalRunId: result.temporalWorkflow?.runId || null,
          })) || current;
        const receipt = buildReceipt({
          admission: current,
          principal,
          reused: Boolean(result.temporalWorkflow?.reused),
        });
        await recordAdmissionAudit({
          principal,
          admission: current,
          context,
          success: true,
          action: 'start',
          message: 'Governed Workflow execution admitted and started.',
          metadata: { reusedTemporalStart: Boolean(result.temporalWorkflow?.reused) },
        }).catch(() => {});
        return receipt;
      } catch (error) {
        if (isTestProcessCrash(error)) throw error;
        const safeError = createSafeExecutionError(error);
        current =
          (await updateAdmission(current.admissionId, {
            status: 'FAILED',
            failureCode: safeError.details.code,
            failureMessage: getSafeFailureMessage(safeError),
          })) || current;
        await recordAdmissionAudit({
          principal,
          admission: current,
          context,
          success: false,
          action: 'start_rejected',
          message: 'Governed Workflow execution failed to start.',
          metadata: { failureCode: current.failureCode },
        }).catch(() => {});
        throw safeError;
      }
    },
    environment,
  );

  if (lockedResult.locked) return lockedResult.result;

  const latest = await loadAdmissionByKey(principal.principalId, idempotencyKeyHash);
  if (latest && ['STARTED', 'FAILED', 'CANCELED'].includes(latest.status)) {
    return buildReceipt({ admission: latest, principal, reused: true });
  }

  throw serviceError('Another request is reconciling this Workflow execution.', 409, {
    code: 'WORKFLOW_START_IN_PROGRESS',
    admissionId: admission.admissionId,
  });
}

async function startWorkflow({
  request,
  principalCode,
  authMode = null,
  actor = null,
  session = null,
  context = {},
  environment = process.env,
} = {}) {
  const normalizedRequest = normalizeRequest(request);
  const principal = await resolvePrincipal({ principalCode, authMode });
  const configProfileCode = getProfileCode(environment);
  const environmentCode = getEnvironmentCode(environment);
  const definition = await getWorkflowExecutorService().getWorkflowDefinition(
    normalizedRequest.workflowCode,
  );

  if (
    String(definition.status || '')
      .trim()
      .toUpperCase() !== 'ACTIVE' ||
    definition.enabled === false
  ) {
    throw serviceError('The Workflow is not active for agent execution.', 409, {
      code: 'WORKFLOW_INACTIVE',
      workflowCode: definition.workflowCode,
    });
  }

  if (
    !definition.publishedVersionId ||
    !Number.isInteger(Number(definition.publishedVersionNumber)) ||
    (definition.publishedVersionStatus &&
      String(definition.publishedVersionStatus).trim().toUpperCase() !== 'PUBLISHED')
  ) {
    throw serviceError('The Workflow has no currently published version.', 409, {
      code: 'WORKFLOW_PUBLISHED_VERSION_REQUIRED',
      workflowCode: definition.workflowCode,
    });
  }

  const grant = await resolveGrant({
    principalId: principal.principalId,
    workflowCode: definition.workflowCode,
    repositoryCode: null,
    environmentCode,
    configProfileCode,
  });

  if (
    grant.environmentCode.toUpperCase() !== environmentCode ||
    grant.configProfileCode.toUpperCase() !== configProfileCode
  ) {
    throw serviceError('The Workflow resource grant is bound to a different local profile.', 403, {
      code: 'WORKFLOW_RESOURCE_PROFILE_MISMATCH',
    });
  }

  await assertRepositoryBinding({
    repositoryCode: grant.repositoryCode,
    configProfileCode: grant.configProfileCode,
  });

  const validatedInput = await getWorkflowExecutorService().validateWorkflowRuntimeInput(
    definition,
    { params: normalizedRequest.parameters },
    { rejectUnknown: true },
  );
  const validatedParameters = getSafeObject(
    validatedInput.params || validatedInput.runtimeParameters,
  );
  if (containsSecretLikeKey(validatedParameters)) {
    throw serviceError(
      'Secret-bearing Workflow parameters are not accepted by agent execution.',
      400,
      {
        code: 'WORKFLOW_SECRET_PARAMETER_FORBIDDEN',
      },
    );
  }

  const runtimeDefinitions = getParameterContract(definition);
  for (const parameter of runtimeDefinitions) {
    if (String(parameter.type).toLowerCase() === 'repo' && validatedParameters[parameter.key]) {
      if (
        String(validatedParameters[parameter.key]).toLowerCase() !==
        grant.repositoryCode.toLowerCase()
      ) {
        throw serviceError(
          'Workflow repository parameters must match the granted repository.',
          403,
          {
            code: 'WORKFLOW_REPOSITORY_SCOPE_DENIED',
            parameterKey: parameter.key,
            repositoryCode: grant.repositoryCode,
          },
        );
      }
    }
  }

  await assertAuthorityClosure({
    definition,
    grant,
    principal,
    repositoryCode: grant.repositoryCode,
    environmentCode: grant.environmentCode,
    configProfileCode: grant.configProfileCode,
  });

  const idempotencyKeyHash = sha256(`${principal.principalId}:${normalizedRequest.idempotencyKey}`);
  const requestDigest = sha256(
    canonicalJson({
      principalId: principal.principalId,
      grantId: grant.grantId,
      workflowCode: definition.workflowCode,
      workflowDefinitionId: definition.workflowDefinitionId,
      workflowVersionId: definition.publishedVersionId,
      versionNumber: definition.publishedVersionNumber,
      repositoryCode: grant.repositoryCode,
      environmentCode: grant.environmentCode,
      configProfileCode: grant.configProfileCode,
      parameters: validatedParameters,
    }),
  );

  let admission = await loadAdmissionByKey(principal.principalId, idempotencyKeyHash);
  if (admission) {
    if (admission.requestDigest !== requestDigest) {
      throw serviceError('The idempotency key was already used for a different request.', 409, {
        code: 'WORKFLOW_IDEMPOTENCY_CONFLICT',
        keyHash: idempotencyKeyHash,
        originalRequestDigest: admission.requestDigest,
        requestDigest,
      });
    }
  } else {
    const admissionId = crypto.randomUUID();
    const workflowRunRecordId = crypto.randomUUID();
    try {
      admission = await insertAdmission({
        admissionId,
        principal,
        grant,
        workflowRunRecordId,
        idempotencyKeyHash,
        requestDigest,
        definition,
        parameters: validatedParameters,
        parameterContract: runtimeDefinitions,
      });
      admission = (await claimAdmission(admission.admissionId)) || admission;
    } catch (error) {
      if (error?.code !== '23505') throw error;
      const concurrentAdmission = await loadAdmissionByKey(
        principal.principalId,
        idempotencyKeyHash,
      );
      if (!concurrentAdmission) throw error;
      if (concurrentAdmission.requestDigest !== requestDigest) {
        throw serviceError('The idempotency key was already used for a different request.', 409, {
          code: 'WORKFLOW_IDEMPOTENCY_CONFLICT',
          keyHash: idempotencyKeyHash,
        });
      }
      admission = concurrentAdmission;
    }
  }

  return dispatchAdmission({
    admission,
    principal,
    grant,
    idempotencyKeyHash,
    requestDigest,
    validatedParameters,
    context,
    session,
    environment,
  });
}

function sanitizeNodeRun(nodeRun = {}) {
  return {
    workflowNodeRunRecordId: nodeRun.workflowNodeRunRecordId || null,
    nodeKey: nodeRun.nodeKey || null,
    nodeTypeCode: nodeRun.nodeTypeCode || null,
    targetCode: nodeRun.targetCode || null,
    status: nodeRun.status || null,
    attemptCount: nodeRun.attemptCount || 0,
    startedAt: nodeRun.startedAt || null,
    completedAt: nodeRun.completedAt || null,
    errorMessage: nodeRun.errorMessage ? normalizeSafeMessage(nodeRun.errorMessage) : null,
  };
}

function sanitizeNodeOutput(nodeOutput = {}) {
  return {
    nodeKey: nodeOutput.nodeKey || null,
    outputKey: nodeOutput.outputKey || null,
    outputType: nodeOutput.outputType || null,
    outputSummary: nodeOutput.outputSummary ? normalizeSafeMessage(nodeOutput.outputSummary) : null,
    status: nodeOutput.status || null,
    attemptCount: nodeOutput.attemptCount || 0,
    createdAt: nodeOutput.createdAt || null,
  };
}

function sanitizeApproval(approval = {}) {
  return {
    approvalRequestId: approval.approvalRequestId || null,
    nodeKey: approval.nodeKey || null,
    status: approval.status || null,
    requestedAt: approval.requestedAt || approval.createdAt || null,
    decidedAt: approval.decidedAt || null,
    decision: approval.decision ? normalizeSafeMessage(approval.decision, 200) : null,
  };
}

function sanitizeRunDetail(detail = {}, admission) {
  const run = getSafeObject(detail.run);
  const approvals = Array.isArray(detail.approvals) ? detail.approvals.map(sanitizeApproval) : [];
  const pendingApproval = approvals.some(
    (approval) => String(approval.status).toUpperCase() === 'PENDING',
  );
  const status = String(run.status || admission.status || 'UNKNOWN').toUpperCase();
  const terminal = TERMINAL_RUN_STATUSES.has(status);
  const state = !terminal && pendingApproval ? 'WAITING' : status;
  const temporalRuntime = getSafeObject(run.temporalRuntime || detail.temporalRuntime);

  return {
    state,
    terminal,
    run: {
      workflowRunRecordId: run.workflowRunRecordId || admission.workflowRunRecordId,
      workflowCode: run.workflowCode || admission.workflowCode,
      workflowVersionId: run.workflowVersionId || admission.workflowVersionId,
      versionNumber: run.versionNumber || admission.versionNumber,
      status,
      summary: run.summary ? normalizeSafeMessage(run.summary, 2000) : null,
      createdAt: run.createdAt || null,
      startedAt: run.startedAt || null,
      completedAt: run.completedAt || null,
      temporalWorkflowId: run.temporalWorkflowId || admission.temporalWorkflowId,
      temporalRunId: run.temporalRunId || admission.temporalRunId,
    },
    nodeRuns: Array.isArray(detail.nodeRuns) ? detail.nodeRuns.map(sanitizeNodeRun) : [],
    nodeOutputs: Array.isArray(detail.nodeOutputs)
      ? detail.nodeOutputs.map(sanitizeNodeOutput)
      : [],
    approvals,
    temporalRuntime: {
      available: temporalRuntime.available !== false,
      workflowId: temporalRuntime.workflowId || admission.temporalWorkflowId,
      runId: temporalRuntime.runId || admission.temporalRunId,
      status: temporalRuntime.status || null,
      startTime: temporalRuntime.startTime || null,
      closeTime: temporalRuntime.closeTime || null,
      warnings: Array.isArray(temporalRuntime.warnings)
        ? temporalRuntime.warnings.map((warning) => normalizeSafeMessage(warning, 500))
        : [],
    },
  };
}

async function loadAdmissionForRun(principalId, workflowRunRecordId) {
  const result = await dbQuery(
    `
      SELECT *
      FROM worker.workflow_execution_admissions
      WHERE workflow_execution_principal_id = $1
        AND workflow_run_record_id = $2
      LIMIT 1
    `,
    [principalId, workflowRunRecordId],
  );
  return result.rows[0] ? normalizeAdmissionRow(result.rows[0]) : null;
}

async function getWorkflowRun({ workflowRunRecordId, principalCode, authMode = null } = {}) {
  const normalizedRunId = normalizeText(workflowRunRecordId, 'workflowRunRecordId', {
    maxLength: 64,
  });
  if (!UUID_PATTERN.test(normalizedRunId)) {
    throw serviceError('workflowRunRecordId must be a UUID.', 400, { code: 'INVALID_REQUEST' });
  }
  const principal = await resolvePrincipal({ principalCode, authMode });
  const admission = await loadAdmissionForRun(principal.principalId, normalizedRunId);
  if (!admission) {
    throw serviceError('Workflow run was not found for this execution principal.', 404, {
      code: 'WORKFLOW_RUN_NOT_FOUND_OR_NOT_OWNED',
    });
  }

  const detail = await getWorkflowExecutorService().getWorkflowRun(admission.workflowRunRecordId);
  return {
    principal: {
      principalId: principal.principalId,
      principalCode: principal.principalCode,
      authMode: principal.authMode,
    },
    admission: {
      admissionId: admission.admissionId,
      grantId: admission.grantId,
      workflowRunRecordId: admission.workflowRunRecordId,
      workflowCode: admission.workflowCode,
      workflowDefinitionId: admission.workflowDefinitionId,
      workflowVersionId: admission.workflowVersionId,
      versionNumber: admission.versionNumber,
      repositoryCode: admission.repositoryCode,
      environmentCode: admission.environmentCode,
      configProfileCode: admission.configProfileCode,
      status: admission.status,
      keyHash: admission.idempotencyKeyHash,
      requestDigest: admission.requestDigest,
      validatedParameterKeys: Object.keys(admission.validatedParameters).sort(),
      createdAt: admission.createdAt,
      startedAt: admission.startedAt,
      completedAt: admission.completedAt,
    },
    ...sanitizeRunDetail(detail, admission),
  };
}

function getCapabilitySummary() {
  return {
    capability: 'skycommand_workflow_agent_execution',
    contractVersion: 'skycommand_workflow_agent_execution.v1',
    principalResolution: 'server_side_only',
    pinnedVersionAtAdmission: true,
    callerScopedIdempotency: true,
    staticAuthorityClosure: true,
    endpoints: {
      assistantStart: '/api/assistant/workflow-runs',
      assistantRead: '/api/assistant/workflow-runs/{workflowRunRecordId}',
      apiStart: '/api/workflows/agent/workflow-runs',
      apiRead: '/api/workflows/agent/workflow-runs/{workflowRunRecordId}',
    },
  };
}

module.exports = {
  DEFAULT_ASSISTANT_AUTH_MODE,
  DEFAULT_ASSISTANT_PRINCIPAL_CODE,
  WORKFLOW_RUN_PERMISSION,
  assertAuthorityClosure,
  canonicalJson,
  containsSecretLikeKey,
  getCapabilitySummary,
  getEnvironmentCode,
  getParameterContract,
  getProfileCode,
  getRiskPermission,
  getSafeErrorCode,
  getSafeFailureMessage,
  normalizeRequest,
  normalizeSafeMessage,
  permissionRows,
  redactSensitiveText,
  resolvePrincipal,
  sanitizeR4Value,
  startWorkflow,
  getWorkflowRun,
  withTestDependencies,
};
