const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const dotenv = require('dotenv');

const { query: defaultQuery } = require('../../db/src/connection');
const { TOOL_RESULT_SCHEMA_VERSION, runToolCli, validateToolResult } = require('../../tools/src');
const {
  buildSourceIdentity,
  databaseSummary,
  getProfileCode,
  loadBinding,
  manifestChangedPaths,
  normalizedRelativePath,
  readDatabasePlan,
} = require('./finalization');
const { readStoredPromotionIdentity } = require('./promotionIdentity');

const TOOL_CODE = 'dev_promotion_preflight';
const OUTPUT_TYPE = 'dev_promotion_preflight_summary.v1';
const REPOSITORY_CODE = 'SkyCommand';
const PROMOTION_WORKFLOW_CODE = 'skyserver_dev_commit';
const PROMOTION_WORKFLOW_VARIANTS = Object.freeze({
  skyserver_dev_commit: 22,
  'skycommand-dev-promo-alt': 8,
});
const FINALIZATION_WORKFLOW_CODE = 'dev_change_finalize';
const PRIMARY_R6_VERSION = PROMOTION_WORKFLOW_VARIANTS.skyserver_dev_commit;
const ACTIVE_PROMOTION_STATUSES = ['PREFLIGHT_RUNNING', 'AUTHORIZED'];
const TERMINAL_WORKFLOW_STATUSES = ['COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED', 'TERMINATED', 'SKIPPED'];
const VALID_PROMOTION_RUN_STATUSES = ['QUEUED', 'RUNNING', 'ADMITTED', 'STARTING', 'STARTED'];
const HUMAN_PROMOTION_RUN_SOURCES = ['manual', 'api'];
const HUMAN_PROMOTION_TRIGGER_TYPES = ['MANUAL', 'API'];
const PROMOTION_REQUIRED_PERMISSION_CODES = Object.freeze([
  'WORKFLOW_RUN',
  'DEV_PROMOTION_PREFLIGHT',
  'CAPABILITY_CATALOG_EXPORT',
  'REPO_MAP_GENERATE',
  'REPO_ZIP_GENERATE',
  'GIT_COMMIT_RUN',
  'GIT_DEV_PR_MERGE_RUN',
  'GIT_MAIN_MERGE_RUN',
  'GIT_LOCAL_SYNC_RUN',
  'CORE_RUN_LOW_RISK_SCRIPT',
  'CORE_RUN_MEDIUM_RISK_SCRIPT',
  'CORE_RUN_HIGH_RISK_SCRIPT',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[A-F0-9]{64}$/;

class PromotionPreflightError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PromotionPreflightError';
    this.code = code;
    this.details = details;
  }
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function nullableText(value) {
  const valueText = text(value);
  return valueText || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function digest(value) {
  const normalized = text(value).toUpperCase();
  return DIGEST_PATTERN.test(normalized) ? normalized : null;
}

function assertRunId(value, fieldName) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new PromotionPreflightError('R6_PROMOTION_RUN_ID_INVALID', fieldName + ' must be a valid workflow run id.');
  }
  return normalized;
}

function getEnvironmentCode(environment = process.env) {
  return text(environment.SKYCOMMAND_ENVIRONMENT_CODE || getProfileCode(environment)).toUpperCase();
}

function getPromotionScope(environment = process.env) {
  return normalizeGovernedScope({
    repositoryCode: REPOSITORY_CODE,
    environmentCode: getEnvironmentCode(environment),
    configProfileCode: getProfileCode(environment),
  });
}

function normalizeGovernedScope(scope = {}) {
  const normalized = {
    repositoryCode: text(scope.repositoryCode),
    environmentCode: text(scope.environmentCode).toUpperCase(),
    configProfileCode: text(scope.configProfileCode).toUpperCase(),
  };
  if (
    normalized.repositoryCode !== REPOSITORY_CODE ||
    !normalized.environmentCode ||
    !normalized.configProfileCode
  ) {
    reject(
      'R6_PROMOTION_SCOPE_INVALID',
      'The promotion admission does not contain a complete authorized SkyCommand DEV scope.',
    );
  }
  return normalized;
}

function queryFunction(queryFn) {
  return typeof queryFn === 'function' ? queryFn : defaultQuery;
}

function reject(code, message, details = {}) {
  throw new PromotionPreflightError(code, message, details);
}

function runGit(repositoryRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch (_error) {
    return null;
  }
}

function isSqlPath(relativePath) {
  const normalized = normalizedRelativePath(relativePath);
  return normalized.startsWith('packages/db_build/src/migrations/') ||
    normalized.startsWith('packages/db_build/src/seeds/') ||
    normalized.startsWith('packages/db_build/src/seed/');
}

function publicSourceIdentity(value = {}) {
  return {
    digest: digest(value.digest),
    baseRevision: nullableText(value.baseRevision),
    manifestDigest: digest(value.manifestDigest),
    sqlManifestDigest: digest(value.sqlManifestDigest),
    configurationRevisionDigest: digest(value.configurationRevision?.digest),
    fileCount: Number.isFinite(Number(value.fileCount)) ? Number(value.fileCount) : 0,
    excludedGeneratedOutputs: value.excludedGeneratedOutputs === true,
  };
}

function publicDatabase(plan = {}) {
  const summary = databaseSummary(plan);
  return {
    outcome: summary.outcome,
    pendingCount: summary.pendingCount,
    pendingOrdinals: summary.pendingOrdinals,
    planDigest: digest(summary.planDigest),
    manifestDigest: digest(summary.manifestDigest),
    databaseName: nullableText(summary.databaseName),
    systemIdentifier: nullableText(summary.systemIdentifier),
  };
}

function receiptSummary(run) {
  const receipt = safeObject(run.receipt_payload);
  const source = safeObject(receipt.sourceIdentity);
  const database = safeObject(receipt.database?.final);
  return {
    receiptSha256: digest(run.receipt_sha256 || receipt.receiptSha256),
    outcome: text(receipt.outcome),
    validationOutcome: text(receipt.validationOutcome),
    readinessOutcome: text(receipt.readinessOutcome),
    sourceIdentity: publicSourceIdentity(source),
    database: {
      outcome: text(database.outcome),
      pendingCount: Number(database.pendingCount || 0),
      planDigest: digest(database.planDigest),
      manifestDigest: digest(database.manifestDigest),
      databaseName: nullableText(database.databaseName),
      systemIdentifier: nullableText(database.systemIdentifier),
    },
  };
}

function normalizeReviewedSourceIdentity(value, finalizationWorkflowRunId) {
  const sourceIdentity = safeObject(value);
  const fileCount = Number(sourceIdentity.fileCount);
  const files = safeArray(sourceIdentity.files);
  const hasValidFileManifest =
    Number.isInteger(fileCount) &&
    fileCount >= 0 &&
    files.length === fileCount &&
    files.every(
      (file) =>
        file &&
        typeof file === 'object' &&
        nullableText(file.path) &&
        Number.isFinite(Number(file.bytes)) &&
        digest(file.sha256),
    );

  if (
    !digest(sourceIdentity.digest) ||
    !nullableText(sourceIdentity.baseRevision) ||
    !digest(sourceIdentity.manifestDigest) ||
    !digest(sourceIdentity.sqlManifestDigest) ||
    !digest(sourceIdentity.configurationRevision?.digest) ||
    sourceIdentity.excludedGeneratedOutputs !== true ||
    !hasValidFileManifest
  ) {
    reject(
      'R6_PROMOTION_FINALIZATION_SOURCE_IDENTITY_INVALID',
      'The reviewed DEV finalization receipt does not contain a valid source identity.',
      { finalizationWorkflowRunId: nullableText(finalizationWorkflowRunId) },
    );
  }

  return sourceIdentity;
}

function normalizeFinalizationBinding({
  finalizationWorkflowRunId,
  scope,
  receipt,
  sourceIdentity,
  reviewedSourceIdentity,
} = {}) {
  const normalizedReviewedSourceIdentity = normalizeReviewedSourceIdentity(
    reviewedSourceIdentity || sourceIdentity,
    finalizationWorkflowRunId,
  );

  return {
    finalizationWorkflowRunId: nullableText(finalizationWorkflowRunId),
    scope: safeObject(scope),
    receipt: safeObject(receipt),
    sourceIdentity: publicSourceIdentity(normalizedReviewedSourceIdentity),
    reviewedSourceIdentity: normalizedReviewedSourceIdentity,
  };
}

async function loadFinalizationRun(finalizationWorkflowRunId, queryFn = defaultQuery) {
  const result = await queryFunction(queryFn)(
    "SELECT workflow_run_record_id, workflow_code, repository_code, environment_code, config_profile_code, status, source_identity_digest, source_identity, receipt_payload, receipt_sha256, receipt_path, completed_at FROM worker.dev_finalization_runs WHERE workflow_run_record_id = $1 LIMIT 1",
    [finalizationWorkflowRunId],
  );
  return result.rows[0] || null;
}

async function loadPromotionAdmission(workflowRunRecordId, queryFn = defaultQuery) {
  const result = await queryFunction(queryFn)(
    `SELECT r.workflow_run_record_id,
            r.workflow_definition_id,
            r.workflow_version_id,
            r.workflow_code,
            r.version_number,
            r.status AS workflow_run_status,
            r.run_source,
            r.trigger_type,
            r.input AS workflow_input,
            r.request_context,
            r.metadata AS workflow_metadata,
            r.started_by_user_id,
            r.created_at,
            a.workflow_execution_admission_id,
            a.workflow_execution_principal_id,
            a.workflow_execution_resource_grant_id,
            COALESCE(a.idempotency_key_hash, r.input #>> '{promotionRequest,idempotencyKeyHash}') AS idempotency_key_hash,
            COALESCE(a.request_digest, r.input #>> '{promotionRequest,requestDigest}') AS request_digest,
            a.workflow_definition_id AS admission_workflow_definition_id,
            a.workflow_version_id AS admission_workflow_version_id,
            a.version_number AS admission_version_number,
            a.repository_code AS admission_repository_code,
            a.environment_code AS admission_environment_code,
            a.config_profile_code AS admission_config_profile_code,
            a.validated_parameters AS admission_validated_parameters,
            a.parameter_contract AS admission_parameter_contract,
            a.status AS admission_status,
            p.principal_code,
            p.auth_mode,
            p.status AS principal_status,
            g.repository_code AS grant_repository_code,
            g.environment_code AS grant_environment_code,
            g.config_profile_code AS grant_config_profile_code,
            g.workflow_code AS grant_workflow_code,
            g.status AS grant_status,
            g.allowed_permission_codes AS grant_permission_codes,
            COALESCE(
              ARRAY(
                SELECT DISTINCT up.permission_code
                FROM auth.vw_user_permissions up
                WHERE up.user_id = r.started_by_user_id
                  AND up.app_code = 'SKYSERVER_ADMIN'
                ORDER BY up.permission_code
              ),
              ARRAY[]::text[]
            ) AS actor_permission_codes,
            COALESCE(
              a.repository_code,
              r.input #>> '{params,repoName}',
              r.input #>> '{runtimeParameters,repoName}'
            ) AS repository_code,
            COALESCE(
              a.environment_code,
              r.request_context #>> '{authorization,environmentCode}',
              r.request_context #>> '{executionContext,environmentCode}'
            ) AS environment_code,
            COALESCE(
              a.config_profile_code,
              r.request_context #>> '{authorization,configProfileCode}',
              r.request_context #>> '{executionContext,configProfileCode}'
            ) AS config_profile_code,
            COALESCE(a.validated_parameters, r.input->'params', r.input->'runtimeParameters', '{}'::jsonb) AS validated_parameters,
            COALESCE(a.parameter_contract, '[]'::jsonb) AS parameter_contract,
            COALESCE(a.status, r.status) AS status
       FROM worker.workflow_run_records r
       LEFT JOIN worker.workflow_execution_admissions a
         ON a.workflow_run_record_id = r.workflow_run_record_id
       LEFT JOIN auth.workflow_execution_principals p
         ON p.workflow_execution_principal_id = a.workflow_execution_principal_id
       LEFT JOIN worker.workflow_execution_resource_grants g
         ON g.workflow_execution_resource_grant_id = a.workflow_execution_resource_grant_id
      WHERE r.workflow_run_record_id = $1
        AND r.workflow_code = ANY($2::text[])
        AND (
          a.repository_code = $3
          OR r.input #>> '{params,repoName}' = $3
          OR r.input #>> '{runtimeParameters,repoName}' = $3
        )
      LIMIT 1`,
    [workflowRunRecordId, Object.keys(PROMOTION_WORKFLOW_VARIANTS), REPOSITORY_CODE],
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    workflow_definition_id: row.admission_workflow_definition_id || row.workflow_definition_id,
    workflow_version_id: row.admission_workflow_version_id || row.workflow_version_id,
    version_number: row.admission_version_number || row.version_number,
    validated_parameters: row.validated_parameters || {},
    parameter_contract: row.parameter_contract || [],
    principal_code: row.principal_code || 'operator-ui',
    auth_mode: row.auth_mode || 'HUMAN_SESSION',
  };
}

async function loadDevPromotionAdmission(workflowRunRecordId, queryFn = defaultQuery) {
  const result = await queryFunction(queryFn)(
    `SELECT dev_promotion_admission_id, workflow_execution_admission_id, workflow_run_record_id,
            repository_code, environment_code, config_profile_code, workflow_code,
            workflow_version_id, version_number, finalization_workflow_run_record_id,
            finalization_receipt_sha256, finalization_source_identity_digest,
            request_digest, idempotency_key_hash, authorization_source, status, terminal_run_status,
            terminal_outcome, failure_code, failure_message
       FROM worker.dev_promotion_admissions
      WHERE workflow_run_record_id = $1
      LIMIT 1`,
    [workflowRunRecordId],
  );
  return result.rows[0] || null;
}

async function loadRepositoryMetadata(profileCode, queryFn = defaultQuery) {
  const result = await queryFunction(queryFn)(
    "SELECT repo_code, repo_id, remote_url, dev_branch, main_branch, root_path, profile_code FROM core.vw_repository_paths WHERE repo_code = $1 AND profile_code = $2 AND is_skycommand_repository = TRUE AND repo_active = TRUE AND path_active = TRUE LIMIT 1",
    [REPOSITORY_CODE, profileCode],
  );
  return result.rows[0] || null;
}

function trustedAttribution(admission) {
  const requestContext = safeObject(admission.request_context);
  const executionContext = safeObject(requestContext.executionContext);
  const authorization = safeObject(requestContext.promotionAuthorization);
  return {
    principalId: nullableText(executionContext.principalId || admission.started_by_user_id),
    principalCode: nullableText(executionContext.principalCode || admission.principal_code),
    authMode: nullableText(
      executionContext.authMode || admission.auth_mode || (admission.started_by_user_id ? 'HUMAN_SESSION' : null),
    ),
    userId: nullableText(admission.started_by_user_id),
    sessionId: nullableText(requestContext.sessionId || authorization.sessionId),
    agentId: nullableText(authorization.agentId || requestContext.agentId),
    instructionSource: text(
      authorization.instructionSource,
      text(admission.run_source).toLowerCase() === 'assistant' ? 'ASSISTANT' : 'OPERATOR',
    ),
    instructionRef: nullableText(authorization.instructionRef),
    triggerSource: nullableText(authorization.triggerSource || admission.run_source),
    triggerType: nullableText(authorization.triggerType || admission.trigger_type),
    requestedAt: nullableText(authorization.requestedAt || admission.created_at),
  };
}

function resolvePromotionAdmissionIdentity(admission) {
  const identity = readStoredPromotionIdentity({
    admission,
    promotionRequest: safeObject(admission?.workflow_input).promotionRequest,
  });
  if (!identity) {
    reject(
      'R6_PROMOTION_IDEMPOTENCY_INVALID',
      'The promotion start did not establish a valid canonical idempotency identity.',
      { workflowRunRecordId: nullableText(admission?.workflow_run_record_id) },
    );
  }
  return identity;
}

function getPromotionParameters(admission) {
  return safeObject(admission?.validated_parameters);
}

function getPromotionAuthorizationScope(admission) {
  return normalizeGovernedScope({
    repositoryCode: admission?.repository_code,
    environmentCode: admission?.environment_code,
    configProfileCode: admission?.config_profile_code,
  });
}

function hasPermissionCodes(actualCodes, requiredCodes = PROMOTION_REQUIRED_PERMISSION_CODES) {
  const actual = new Set(
    safeArray(actualCodes)
      .map((code) => text(code).toUpperCase())
      .filter(Boolean),
  );
  return requiredCodes.every((code) => actual.has(code));
}

function isHumanPromotionRun(admission) {
  const source = text(admission?.run_source).toLowerCase();
  const trigger = text(admission?.trigger_type).toUpperCase();
  const authorization = safeObject(safeObject(admission?.request_context).authorization);
  return (
    !admission?.workflow_execution_admission_id &&
    UUID_PATTERN.test(text(admission?.started_by_user_id)) &&
    HUMAN_PROMOTION_RUN_SOURCES.includes(source) &&
    HUMAN_PROMOTION_TRIGGER_TYPES.includes(trigger) &&
    authorization.source === 'HUMAN_UI' &&
    text(authorization.actorUserId) === text(admission.started_by_user_id)
  );
}

function isAssistantPromotionRun(admission) {
  return (
    Boolean(admission?.workflow_execution_admission_id) &&
    ['ADMITTED', 'STARTING', 'STARTED'].includes(text(admission?.admission_status).toUpperCase()) &&
    text(admission?.run_source).toLowerCase() === 'assistant' &&
    text(admission?.trigger_type).toUpperCase() === 'ASSISTANT' &&
    text(admission?.principal_code) === 'assistant-http' &&
    text(admission?.principal_status).toUpperCase() === 'ACTIVE' &&
    text(admission?.grant_status).toUpperCase() === 'ACTIVE' &&
    text(admission?.grant_repository_code) === REPOSITORY_CODE &&
    text(admission?.grant_workflow_code) === PROMOTION_WORKFLOW_CODE &&
    text(admission?.grant_environment_code).toUpperCase() === text(admission?.environment_code).toUpperCase() &&
    text(admission?.grant_config_profile_code).toUpperCase() === text(admission?.config_profile_code).toUpperCase() &&
    hasPermissionCodes(admission?.grant_permission_codes)
  );
}

function assertPromotionRunAuthorization(admission) {
  const runStatus = text(admission?.workflow_run_status || admission?.status).toUpperCase();
  if (!VALID_PROMOTION_RUN_STATUSES.includes(runStatus)) {
    reject(
      'R6_PROMOTION_ADMISSION_INVALID',
      'The promotion workflow run is not active for governed R6 execution.',
      { status: runStatus || null },
    );
  }
  if (isAssistantPromotionRun(admission)) return 'ASSISTANT_ADMISSION';
  if (isHumanPromotionRun(admission) && hasPermissionCodes(admission.actor_permission_codes)) {
    return 'HUMAN_UI';
  }
  reject(
    'R6_PROMOTION_AUTHORIZATION_INVALID',
    'The promotion workflow run is not backed by an authorized Assistant admission or authenticated human UI start.',
    { workflowRunRecordId: nullableText(admission?.workflow_run_record_id) },
  );
}

async function assertFinalizationReceipt({
  finalizationWorkflowRunId,
  environment = process.env,
  governanceScope = null,
  queryFn = defaultQuery,
} = {}) {
  const runId = assertRunId(finalizationWorkflowRunId, 'finalizationWorkflowRunId');
  const scope = governanceScope ? normalizeGovernedScope(governanceScope) : getPromotionScope(environment);
  const run = await loadFinalizationRun(runId, queryFn);
  if (!run) reject('R6_PROMOTION_FINALIZATION_NOT_FOUND', 'The referenced DEV finalization run was not found.', { finalizationWorkflowRunId: runId });
  if (
    run.workflow_code !== FINALIZATION_WORKFLOW_CODE ||
    run.repository_code !== REPOSITORY_CODE ||
    run.environment_code !== scope.environmentCode ||
    run.config_profile_code !== scope.configProfileCode
  ) {
    reject('R6_PROMOTION_FINALIZATION_SCOPE_INVALID', 'The referenced finalization receipt is outside the authorized SkyCommand DEV scope.', { finalizationWorkflowRunId: runId });
  }
  if (run.status !== 'COMPLETED') {
    reject('R6_PROMOTION_FINALIZATION_NOT_READY', 'The referenced DEV finalization run is not completed.', { finalizationWorkflowRunId: runId, status: run.status });
  }
  const receipt = receiptSummary(run);
  const reviewedSourceIdentity = normalizeReviewedSourceIdentity(run.source_identity, runId);
  const source = publicSourceIdentity(reviewedSourceIdentity);
  if (
    !receipt.receiptSha256 ||
    !['COMPLETE', 'NO_CHANGES'].includes(receipt.outcome) ||
    !['PASS', 'KNOWN_BASELINE_LIMITATION'].includes(receipt.validationOutcome) ||
    receipt.readinessOutcome !== 'READY' ||
    receipt.database.pendingCount !== 0 ||
    !source.digest ||
    source.digest !== digest(run.source_identity_digest) ||
    !source.manifestDigest ||
    !source.sqlManifestDigest ||
    !source.configurationRevisionDigest ||
    source.excludedGeneratedOutputs !== true ||
    receipt.sourceIdentity.digest !== source.digest
  ) {
    reject('R6_PROMOTION_FINALIZATION_RECEIPT_INVALID', 'The referenced DEV finalization receipt is not complete and READY for promotion.', { finalizationWorkflowRunId: runId });
  }
  return normalizeFinalizationBinding({
    finalizationWorkflowRunId: runId,
    scope,
    receipt,
    sourceIdentity: source,
    reviewedSourceIdentity,
  });
}

async function assertNoFinalizationLease(scope, queryFn = defaultQuery) {
  const result = await queryFunction(queryFn)(
    "SELECT owner_workflow_run_record_id FROM worker.dev_finalization_locks WHERE repository_code = $1 AND environment_code = $2 AND config_profile_code = $3 AND status = 'HELD' AND expires_at > CURRENT_TIMESTAMP ORDER BY acquired_at DESC LIMIT 1",
    [scope.repositoryCode, scope.environmentCode, scope.configProfileCode],
  );
  if (result.rows[0]) reject('R6_PROMOTION_CONCURRENT_EDIT', 'A DEV finalization lease is still active for the authorized repository scope.', { ownerWorkflowRunRecordId: result.rows[0].owner_workflow_run_record_id });
}

function isTerminalWorkflowStatus(status) {
  return TERMINAL_WORKFLOW_STATUSES.includes(text(status).toUpperCase());
}

async function settlePromotionAdmission({ workflowRunRecordId, queryFn = defaultQuery, settlementSource = 'durable_workflow_terminal' } = {}) {
  const runId = assertRunId(workflowRunRecordId, 'workflowRunRecordId');
  const admissionResult = await queryFunction(queryFn)(
    `SELECT a.dev_promotion_admission_id, a.status, a.workflow_run_record_id, r.status AS terminal_run_status
       FROM worker.dev_promotion_admissions a
       JOIN worker.workflow_run_records r ON r.workflow_run_record_id = a.workflow_run_record_id
      WHERE a.workflow_run_record_id = $1
      LIMIT 1`,
    [runId],
  );
  const admission = admissionResult?.rows?.[0];
  if (!admission || !ACTIVE_PROMOTION_STATUSES.includes(text(admission.status).toUpperCase())) {
    return { settled: false, reason: admission ? 'NOT_ACTIVE' : 'NOT_FOUND', admission: admission || null };
  }
  const terminalStatus = text(admission.terminal_run_status).toUpperCase();
  if (!isTerminalWorkflowStatus(terminalStatus)) {
    return { settled: false, reason: 'RUN_NOT_TERMINAL', admission };
  }
  if (terminalStatus !== 'COMPLETED') {
    return {
      settled: false,
      reason: 'FAILED_ADMISSION_PRESERVED_FOR_RECOVERY',
      admission,
      evidence: {
        contract: 'dev_promotion_admission_settlement.v1',
        workflowRunRecordId: runId,
        terminalRunStatus: terminalStatus,
        terminalOutcome: 'FAILED',
        recoveryAuthorizationPreserved: true,
        settlementSource: text(settlementSource, 'durable_workflow_terminal'),
      },
    };
  }
  const outcome = 'COMPLETED';
  const evidence = {
    contract: 'dev_promotion_admission_settlement.v1',
    workflowRunRecordId: runId,
    terminalRunStatus: terminalStatus,
    terminalOutcome: outcome,
    settlementSource: text(settlementSource, 'durable_workflow_terminal'),
    settledAt: new Date().toISOString(),
  };
  const updated = await queryFunction(queryFn)(
    `UPDATE worker.dev_promotion_admissions
        SET status = $2,
            terminal_run_status = $3,
            terminal_outcome = $4,
            terminal_receipt = $5::jsonb,
            settled_at = CURRENT_TIMESTAMP,
            settlement_source = $6,
            updated_at = CURRENT_TIMESTAMP
      WHERE dev_promotion_admission_id = $1
        AND status = ANY($7::text[])
      RETURNING *`,
        [
      admission.dev_promotion_admission_id,
      outcome,
      terminalStatus,
      outcome,
      JSON.stringify(evidence),
      text(settlementSource, 'durable_workflow_terminal'),
      ACTIVE_PROMOTION_STATUSES,
    ],
  );
  return {
    settled: Boolean(updated?.rows?.[0]),
    reason: updated?.rows?.[0] ? 'SETTLED' : 'ALREADY_SETTLED',
    admission: updated?.rows?.[0] || admission,
    evidence,
  };
}

async function reconcileActivePromotionAdmissions(scope, queryFn = defaultQuery) {
  const result = await queryFunction(queryFn)(
    `SELECT a.workflow_run_record_id, r.status AS terminal_run_status
       FROM worker.dev_promotion_admissions a
       JOIN worker.workflow_run_records r ON r.workflow_run_record_id = a.workflow_run_record_id
      WHERE a.repository_code = $1 AND a.environment_code = $2 AND a.config_profile_code = $3
        AND a.status = ANY($4::text[])
      ORDER BY a.created_at`,
    [scope.repositoryCode, scope.environmentCode, scope.configProfileCode, ACTIVE_PROMOTION_STATUSES],
  );
  const settlements = [];
  for (const row of result?.rows || []) {
    if (isTerminalWorkflowStatus(row.terminal_run_status)) {
      settlements.push(await settlePromotionAdmission({ workflowRunRecordId: row.workflow_run_record_id, queryFn }));
    }
  }
  return settlements;
}

async function assertNoOtherPromotion(workflowRunRecordId, scope, queryFn = defaultQuery) {
  await reconcileActivePromotionAdmissions(scope, queryFn);
  const result = await queryFunction(queryFn)(
    `SELECT a.dev_promotion_admission_id, a.workflow_run_record_id,
            a.status, r.status AS terminal_run_status
       FROM worker.dev_promotion_admissions a
       JOIN worker.workflow_run_records r
         ON r.workflow_run_record_id = a.workflow_run_record_id
      WHERE a.repository_code = $1
        AND a.environment_code = $2
        AND a.config_profile_code = $3
        AND a.status = ANY($4::text[])
        AND a.workflow_run_record_id <> $5
      ORDER BY a.created_at DESC`,
    [scope.repositoryCode, scope.environmentCode, scope.configProfileCode, ACTIVE_PROMOTION_STATUSES, workflowRunRecordId],
  );
  for (const row of result?.rows || []) {
    if (text(row.terminal_run_status).toUpperCase() === 'COMPLETED') {
      await settlePromotionAdmission({ workflowRunRecordId: row.workflow_run_record_id, queryFn });
      continue;
    }
    if (isTerminalWorkflowStatus(row.terminal_run_status)) {
      const evidence = {
        contract: 'dev_promotion_admission_supersession.v1',
        supersededWorkflowRunRecordId: row.workflow_run_record_id,
        supersededByWorkflowRunRecordId: workflowRunRecordId,
        terminalRunStatus: text(row.terminal_run_status).toUpperCase(),
        supersededAt: new Date().toISOString(),
      };
      await queryFunction(queryFn)(
        `UPDATE worker.dev_promotion_admissions
            SET status = 'FAILED',
                terminal_run_status = $2,
                terminal_outcome = 'FAILED',
                terminal_receipt = $3::jsonb,
                failure_code = 'R6_PROMOTION_SUPERSEDED',
                failure_message = 'A new explicit R6 promotion run superseded this terminal failed admission.',
                settled_at = CURRENT_TIMESTAMP,
                settlement_source = 'new_promotion_admission',
                updated_at = CURRENT_TIMESTAMP
          WHERE dev_promotion_admission_id = $1
            AND status = ANY($4::text[])`,
        [row.dev_promotion_admission_id, text(row.terminal_run_status).toUpperCase(), JSON.stringify(evidence), ACTIVE_PROMOTION_STATUSES],
      );
    }
  }
  const activeResult = await queryFunction(queryFn)(
    "SELECT workflow_run_record_id FROM worker.dev_promotion_admissions WHERE repository_code = $1 AND environment_code = $2 AND config_profile_code = $3 AND status = ANY($4::text[]) AND workflow_run_record_id <> $5 ORDER BY created_at DESC LIMIT 1",
    [scope.repositoryCode, scope.environmentCode, scope.configProfileCode, ACTIVE_PROMOTION_STATUSES, workflowRunRecordId],
  );
  if (activeResult.rows[0]) reject('R6_PROMOTION_CONCURRENT_EDIT', 'Another R6 Development Promotion run is already admitted for this DEV scope.', { ownerWorkflowRunRecordId: activeResult.rows[0].workflow_run_record_id });
}

async function assertWorkflowGraph(workflowVersionId, expectedWorkflowCode = null, queryFn = defaultQuery) {
  const metadataResult = await queryFunction(queryFn)(
    `SELECT d.workflow_code, v.version_number, v.status
       FROM worker.workflow_versions v
       JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
      WHERE v.workflow_version_id = $1
      LIMIT 1`,
    [workflowVersionId],
  );
  const metadata = metadataResult?.rows?.[0];
  const workflowCode = text(expectedWorkflowCode || metadata?.workflow_code);
  const expectedVersion = PROMOTION_WORKFLOW_VARIANTS[workflowCode];
  if (!metadata || !expectedVersion || metadata.status !== 'PUBLISHED' || Number(metadata.version_number) !== expectedVersion) {
    reject('R6_PROMOTION_WORKFLOW_GRAPH_INVALID', 'The admitted Development Promotion workflow is not an allowed published correction version.', { workflowVersionId, workflowCode, expectedVersion });
  }
  const nodeResult = await queryFunction(queryFn)(
    `SELECT node_key, node_type_code, target_code
       FROM worker.workflow_nodes
      WHERE workflow_version_id = $1`,
    [workflowVersionId],
  );
  const edgeResult = await queryFunction(queryFn)(
    `SELECT e.edge_type, from_node.node_key AS from_node_key, to_node.node_key AS to_node_key
       FROM worker.workflow_edges e
       JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
       JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
      WHERE e.workflow_version_id = $1`,
    [workflowVersionId],
  );
  const nodes = nodeResult?.rows || [];
  const edges = edgeResult?.rows || [];
  const count = (predicate) => nodes.filter(predicate).length;
  const edgeCount = (fromKey, toKey) => edges.filter((edge) => edge.from_node_key === fromKey && edge.to_node_key === toKey && text(edge.edge_type).toUpperCase() === 'SEQUENTIAL').length;
  const predecessorChain = workflowCode === PROMOTION_WORKFLOW_CODE
    ? ['promotion_preflight_node', 'capability_catalog_node', 'repo_map_node', 'repo_zip_node', 'dev_commit_node']
    : ['promotion_preflight_node', 'local_dev_pull_node', 'capability_catalog_node', 'repo_map_node', 'repo_zip_node', 'dev_commit_node'];
  const chainValid = predecessorChain.slice(0, -1).every((key, index) => edgeCount(key, predecessorChain[index + 1]) === 1);
  const valid =
    count((node) => node.node_type_code === 'HUMAN_APPROVAL') === 0 &&
    count((node) => node.node_key === 'promotion_preflight_node' && node.target_code === 'dev_promotion_preflight') === 1 &&
    count((node) => node.node_key === 'github_dev_pr_merge_node' && node.target_code === 'github_dev_pr_merge') === 1 &&
    edgeCount('dev_commit_node', 'github_dev_pr_merge_node') === 1 &&
    edgeCount('github_dev_pr_merge_node', 'merge_sync_node') === 1 &&
    edgeCount('merge_sync_node', 'local_repo_sync_node') === 1 &&
    edgeCount('local_repo_sync_node', 'dev_promotion_summary') === 1 &&
    edgeCount('dev_commit_node', 'merge_sync_node') === 0 &&
    chainValid;
  if (!valid) {
    reject('R6_PROMOTION_WORKFLOW_GRAPH_INVALID', 'The admitted Development Promotion workflow does not match the GitHub PR merge graph contract.', { workflowVersionId, workflowCode, versionNumber: metadata.version_number });
  }
  return { workflowCode, versionNumber: Number(metadata.version_number), nodes, edges };
}

async function validateCurrentSource({
  finalization,
  environment = process.env,
  workflowRunRecordId = null,
  sourceIdentityProfileCode = null,
  queryFn = defaultQuery,
  dependencies = {},
} = {}) {
  const reviewedIdentity = normalizeReviewedSourceIdentity(
    finalization?.reviewedSourceIdentity,
    finalization?.finalizationWorkflowRunId,
  );
  const loadBindingFn = dependencies.loadBinding || loadBinding;
  const loadRepositoryMetadataFn = dependencies.loadRepositoryMetadata || loadRepositoryMetadata;
  const readDatabasePlanFn = dependencies.readDatabasePlan || readDatabasePlan;
  const buildSourceIdentityFn = dependencies.buildSourceIdentity || buildSourceIdentity;
  const runGitFn = dependencies.runGit || runGit;
  const binding = await loadBindingFn(REPOSITORY_CODE, environment);
  const repository = await loadRepositoryMetadataFn(getProfileCode(environment), queryFn);
  if (!repository || repository.repo_code !== REPOSITORY_CODE) reject('R6_PROMOTION_REPOSITORY_SCOPE_INVALID', 'Registered SkyCommand repository metadata is unavailable.');
  const currentBranch = runGitFn(binding.repositoryRoot, ['branch', '--show-current']);
  const currentRevision = runGitFn(binding.repositoryRoot, ['rev-parse', 'HEAD']);
  const expectedBranch = text(repository.dev_branch, 'dev');
  if (!currentBranch || currentBranch !== expectedBranch) reject('R6_PROMOTION_BRANCH_DRIFT', 'The registered DEV branch is not currently checked out.', { expectedBranch });
  if (currentRevision && currentRevision !== text(reviewedIdentity.baseRevision)) reject('R6_PROMOTION_BRANCH_DRIFT', 'The checked-out DEV revision differs from the reviewed finalization revision.');

  const databasePlan = await readDatabasePlanFn(binding.repositoryRoot, environment);
  const database = publicDatabase(databasePlan);
  if (!['PLAN_READY', 'NO_CHANGES'].includes(database.outcome) || database.pendingCount !== 0) reject('R6_PROMOTION_DATABASE_NOT_READY', 'The governed DEV database is not at a verified zero-pending state.', { outcome: database.outcome, pendingCount: database.pendingCount });

  const currentIdentity = await buildSourceIdentityFn({
    repositoryRoot: binding.repositoryRoot,
    databasePlan,
    environment,
    identityProfileCode: sourceIdentityProfileCode,
  });
  const changedPaths = manifestChangedPaths(currentIdentity.files, reviewedIdentity.files || []);
  if (digest(currentIdentity.configurationRevision?.digest) !== digest(reviewedIdentity.configurationRevision?.digest)) reject('R6_PROMOTION_CONFIG_DRIFT', 'Effective non-secret configuration differs from the reviewed finalization receipt.');
  if (digest(currentIdentity.sqlManifestDigest) !== digest(reviewedIdentity.sqlManifestDigest) || changedPaths.some(isSqlPath)) reject('R6_PROMOTION_SQL_DRIFT', 'The reviewed SQL manifest differs from the current source state.', { changedPathCount: changedPaths.filter(isSqlPath).length });
  if (digest(currentIdentity.manifestDigest) !== digest(reviewedIdentity.manifestDigest) || digest(currentIdentity.digest) !== digest(reviewedIdentity.digest)) reject('R6_PROMOTION_SOURCE_DRIFT', 'Current source identity differs from the reviewed finalization receipt.', { changedPathCount: changedPaths.length });

  const reviewedDatabase = finalization.receipt.database;
  for (const key of ['manifestDigest', 'databaseName', 'systemIdentifier']) {
    if (reviewedDatabase[key] && String(reviewedDatabase[key]) !== String(database[key] || '')) reject('R6_PROMOTION_DATABASE_DRIFT', 'Current DEV database target differs from the reviewed finalization receipt.', { field: key });
  }
  await assertNoFinalizationLease(finalization.scope, queryFn);
  if (workflowRunRecordId) await assertNoOtherPromotion(workflowRunRecordId, finalization.scope, queryFn);
  const remoteUrl = text(repository.remote_url);
  const mainBranch = text(repository.main_branch, 'main');
  if (!remoteUrl) reject('R6_PROMOTION_REMOTE_METADATA_INVALID', 'Registered SkyCommand remote metadata is unavailable.');
  const remoteOutput = runGitFn(binding.repositoryRoot, ['ls-remote', '--heads', remoteUrl, `refs/heads/${mainBranch}`]);
  const expectedMainSha = text(remoteOutput).split(/\s+/)[0].toLowerCase();
  if (!/^[a-f0-9]{40,64}$/i.test(expectedMainSha)) {
    reject('R6_PROMOTION_REMOTE_MAIN_UNAVAILABLE', 'The configured GitHub main branch could not be read during promotion preflight.');
  }
  return {
    binding: {
      repositoryCode: REPOSITORY_CODE,
      repositoryId: binding.repoId || repository.repo_id || null,
      environmentCode: finalization.scope.environmentCode,
      configProfileCode: finalization.scope.configProfileCode,
      repositoryRoot: binding.repositoryRoot,
      devBranch: expectedBranch,
      mainBranch,
      remoteUrl,
      expectedMainSha,
    },
    currentBranch,
    currentRevision,
    sourceIdentity: publicSourceIdentity(currentIdentity),
    database,
    changedPaths,
  };
}

async function validateFinalizationBinding({ finalizationWorkflowRunId, environment = process.env, queryFn = defaultQuery, verifyCurrent = false, workflowRunRecordId = null } = {}) {
  const finalization = await assertFinalizationReceipt({ finalizationWorkflowRunId, environment, queryFn });
  const output = normalizeFinalizationBinding(finalization);
  if (verifyCurrent) output.current = await validateCurrentSource({ finalization: output, environment, workflowRunRecordId, queryFn });
  return output;
}

async function validatePromotionCommitBoundary({
  workflowRunId,
  finalizationWorkflowRunId,
  hostEnvironment = process.env,
  queryFn = defaultQuery,
  dependencies = {},
} = {}) {
  const promotionRunId = assertRunId(workflowRunId, 'workflowRunId');
  const finalizationRunId = assertRunId(finalizationWorkflowRunId, 'finalizationWorkflowRunId');
  const loadPromotionAdmissionFn = dependencies.loadPromotionAdmission || loadPromotionAdmission;
  const loadDevPromotionAdmissionFn = dependencies.loadDevPromotionAdmission || loadDevPromotionAdmission;
  const assertFinalizationReceiptFn = dependencies.assertFinalizationReceipt || assertFinalizationReceipt;
  const validateCurrentSourceFn = dependencies.validateCurrentSource || validateCurrentSource;

  const admission = await loadPromotionAdmissionFn(promotionRunId, queryFn);
  const workflowCode = text(admission?.workflow_code);
  const expectedVersion = PROMOTION_WORKFLOW_VARIANTS[workflowCode];
  if (
    !admission ||
    text(admission.workflow_run_record_id) !== promotionRunId ||
    workflowCode !== PROMOTION_WORKFLOW_CODE ||
    !expectedVersion ||
    Number(admission.version_number) !== expectedVersion ||
    text(admission.repository_code) !== REPOSITORY_CODE
  ) {
    reject(
      'R6_PROMOTION_COMMIT_ADMISSION_INVALID',
      'The current promotion workflow run is not a valid governed SkyCommand DEV admission.',
      { workflowRunRecordId: promotionRunId },
    );
  }
  const authorizationSource = assertPromotionRunAuthorization(admission);
  if (text(admission.workflow_run_record_id) !== promotionRunId) {
    reject(
      'R6_PROMOTION_COMMIT_BOUNDARY_INVALID',
      'The durable promotion run identity does not match the current workflow boundary.',
      { workflowRunRecordId: promotionRunId },
    );
  }

  const parameters = safeObject(admission.validated_parameters);
  if (
    text(parameters.repoName) !== REPOSITORY_CODE ||
    text(parameters.finalizationWorkflowRunId) !== finalizationRunId
  ) {
    reject(
      'R6_PROMOTION_COMMIT_ADMISSION_INVALID',
      'The promotion admission is not bound to the requested repository and finalization receipt.',
      { workflowRunRecordId: promotionRunId, finalizationWorkflowRunId: finalizationRunId },
    );
  }

  const promotionAdmission = await loadDevPromotionAdmissionFn(promotionRunId, queryFn);
  if (
    !promotionAdmission ||
    text(promotionAdmission.workflow_run_record_id) !== promotionRunId ||
    text(promotionAdmission.status).toUpperCase() !== 'AUTHORIZED'
  ) {
    reject(
      'R6_PROMOTION_COMMIT_ADMISSION_UNAUTHORIZED',
      'The durable SkyCommand DEV promotion admission is not authorized for Dev Commit.',
      { workflowRunRecordId: promotionRunId, status: text(promotionAdmission?.status) || null },
    );
  }
  if (
    text(promotionAdmission.authorization_source || 'ASSISTANT_ADMISSION') !== authorizationSource ||
    text(promotionAdmission.workflow_execution_admission_id) !== text(admission.workflow_execution_admission_id) ||
    text(promotionAdmission.workflow_code) !== PROMOTION_WORKFLOW_CODE ||
    text(promotionAdmission.workflow_version_id) !== text(admission.workflow_version_id) ||
    Number(promotionAdmission.version_number) !== Number(admission.version_number) ||
    text(promotionAdmission.repository_code) !== REPOSITORY_CODE ||
    text(promotionAdmission.finalization_workflow_run_record_id) !== finalizationRunId ||
    text(parameters.finalizationWorkflowRunId) !== text(promotionAdmission.finalization_workflow_run_record_id)
  ) {
    reject(
      'R6_PROMOTION_COMMIT_BOUNDARY_INVALID',
      'The durable promotion admission is not bound to the current promotion workflow and finalization receipt.',
      { workflowRunRecordId: promotionRunId, finalizationWorkflowRunId: finalizationRunId },
    );
  }
  if (
    text(promotionAdmission.environment_code).toUpperCase() !== text(admission.environment_code).toUpperCase() ||
    text(promotionAdmission.config_profile_code).toUpperCase() !== text(admission.config_profile_code).toUpperCase()
  ) {
    reject(
      'R6_PROMOTION_COMMIT_SCOPE_INVALID',
      'The durable promotion admission scope does not match the authorized workflow-run scope.',
      { workflowRunRecordId: promotionRunId, finalizationWorkflowRunId: finalizationRunId },
    );
  }

  const governanceScope = normalizeGovernedScope({
    repositoryCode: promotionAdmission.repository_code,
    environmentCode: promotionAdmission.environment_code,
    configProfileCode: promotionAdmission.config_profile_code,
  });
  const finalization = await assertFinalizationReceiptFn({
    finalizationWorkflowRunId: finalizationRunId,
    governanceScope,
    queryFn,
  });
  if (
    text(finalization.scope?.repositoryCode) !== governanceScope.repositoryCode ||
    text(finalization.scope?.environmentCode).toUpperCase() !== governanceScope.environmentCode ||
    text(finalization.scope?.configProfileCode).toUpperCase() !== governanceScope.configProfileCode
  ) {
    reject(
      'R6_PROMOTION_COMMIT_SCOPE_INVALID',
      'The promotion admission scope does not match the reviewed finalization receipt scope.',
      { workflowRunRecordId: promotionRunId, finalizationWorkflowRunId: finalizationRunId },
    );
  }
  if (
    digest(promotionAdmission.finalization_receipt_sha256) !== digest(finalization.receipt?.receiptSha256) ||
    digest(promotionAdmission.finalization_source_identity_digest) !== digest(finalization.sourceIdentity?.digest)
  ) {
    reject(
      'R6_PROMOTION_COMMIT_BINDING_INVALID',
      'The durable promotion admission is not bound to the reviewed finalization receipt and source identity.',
      { workflowRunRecordId: promotionRunId, finalizationWorkflowRunId: finalizationRunId },
    );
  }

  const output = normalizeFinalizationBinding(finalization);
  output.current = await validateCurrentSourceFn({
    finalization: output,
    environment: hostEnvironment,
    sourceIdentityProfileCode: governanceScope.configProfileCode,
    workflowRunRecordId: promotionRunId,
    queryFn,
    dependencies: dependencies.currentSourceDependencies || {},
  });
  return output;
}

async function beginPromotionAdmission({ admission, finalization, queryFn = defaultQuery } = {}) {
  const attribution = trustedAttribution(admission);
  const identity = resolvePromotionAdmissionIdentity(admission);
  try {
    const result = await queryFunction(queryFn)(
      "INSERT INTO worker.dev_promotion_admissions (dev_promotion_admission_id, workflow_execution_admission_id, workflow_run_record_id, principal_code, principal_id, repository_code, environment_code, config_profile_code, workflow_code, workflow_version_id, version_number, idempotency_key_hash, request_digest, finalization_workflow_run_record_id, finalization_receipt_sha256, finalization_source_identity_digest, trusted_attribution, authorization_source, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, 'PREFLIGHT_RUNNING') RETURNING *",
      [
        crypto.randomUUID(),
        admission.workflow_execution_admission_id,
        admission.workflow_run_record_id,
        attribution.principalCode,
        attribution.principalId,
        REPOSITORY_CODE,
        finalization.scope.environmentCode,
        finalization.scope.configProfileCode,
        admission.workflow_code,
        admission.workflow_version_id,
        admission.version_number,
        identity.idempotencyKeyHash,
        identity.requestDigest,
        finalization.finalizationWorkflowRunId,
        finalization.receipt.receiptSha256,
        finalization.sourceIdentity.digest,
        JSON.stringify(attribution),
        text(admission.authorization_source, admission.workflow_execution_admission_id ? 'ASSISTANT_ADMISSION' : 'HUMAN_UI'),
      ],
    );
    return result.rows[0];
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const result = await queryFunction(queryFn)(
      "SELECT * FROM worker.dev_promotion_admissions WHERE workflow_run_record_id = $1 OR (repository_code = $2 AND environment_code = $3 AND config_profile_code = $4 AND status = ANY($5::text[])) ORDER BY CASE WHEN workflow_run_record_id = $1 THEN 0 ELSE 1 END, created_at LIMIT 1",
      [admission.workflow_run_record_id, REPOSITORY_CODE, finalization.scope.environmentCode, finalization.scope.configProfileCode, ACTIVE_PROMOTION_STATUSES],
    );
    const existing = result.rows[0];
    if (!existing) throw error;
    if (existing.workflow_run_record_id !== admission.workflow_run_record_id) reject('R6_PROMOTION_CONCURRENT_EDIT', 'Another R6 Development Promotion run is already admitted for this DEV scope.', { ownerWorkflowRunRecordId: existing.workflow_run_record_id });
    const existingIdentity = readStoredPromotionIdentity({ admission: existing });
    if (!existingIdentity || existingIdentity.idempotencyKeyHash !== identity.idempotencyKeyHash || existingIdentity.requestDigest !== identity.requestDigest || existing.finalization_workflow_run_record_id !== finalization.finalizationWorkflowRunId) reject('R6_PROMOTION_IDEMPOTENCY_CONFLICT', 'The R6 promotion run is already bound to a different request.');
    return existing;
  }
}

async function authorizePromotionAdmission({ promotionAdmission, output, finalization, queryFn = defaultQuery } = {}) {
  const result = await queryFunction(queryFn)(
    "UPDATE worker.dev_promotion_admissions SET status = 'AUTHORIZED', finalization_receipt_sha256 = $2, finalization_source_identity_digest = $3, preflight_output = $4::jsonb, updated_at = CURRENT_TIMESTAMP WHERE dev_promotion_admission_id = $1 RETURNING *",
    [promotionAdmission.dev_promotion_admission_id, finalization.receipt.receiptSha256, finalization.sourceIdentity.digest, JSON.stringify(output)],
  );
  return result.rows[0] || promotionAdmission;
}

function buildPreflightOutput({ admission, finalization, current, promotionAdmission, startedAt }) {
  const completedAt = new Date().toISOString();
  return {
    contract: OUTPUT_TYPE,
    outcome: 'READY',
    workflowRunRecordId: admission.workflow_run_record_id,
    finalizationWorkflowRunId: finalization.finalizationWorkflowRunId,
    repository: {
      repositoryCode: REPOSITORY_CODE,
      environmentCode: finalization.scope.environmentCode,
      configProfileCode: finalization.scope.configProfileCode,
      devBranch: current.binding.devBranch,
      mainBranch: current.binding.mainBranch,
      expectedMainSha: current.binding.expectedMainSha,
      remoteUrl: current.binding.remoteUrl,
      currentRevision: current.currentRevision,
    },
    workflow: {
      workflowCode: admission.workflow_code,
      workflowVersionId: admission.workflow_version_id,
      versionNumber: Number(admission.version_number),
      mergeApprovalRequired: false,
      agentMustStop: false,
      terminalObservationRequired: true,
    },
    principal: trustedAttribution(admission),
    authorization: {
      promotionAdmissionId: promotionAdmission.dev_promotion_admission_id,
      workflowExecutionAdmissionId: admission.workflow_execution_admission_id,
      idempotencyKeyHash: digest(admission.idempotency_key_hash),
      requestDigest: digest(admission.request_digest),
      status: 'AUTHORIZED',
    },
    finalizationReceipt: {
      receiptSha256: finalization.receipt.receiptSha256,
      outcome: finalization.receipt.outcome,
      validationOutcome: finalization.receipt.validationOutcome,
      readinessOutcome: finalization.receipt.readinessOutcome,
    },
    sourceIdentity: current.sourceIdentity,
    database: current.database,
    checks: [
      { code: 'FINALIZATION_RECEIPT', status: 'PASS' },
      { code: 'SOURCE_IDENTITY', status: 'PASS' },
      { code: 'SQL_MANIFEST', status: 'PASS' },
      { code: 'CONFIGURATION_REVISION', status: 'PASS' },
      { code: 'DATABASE_READINESS', status: 'PASS' },
      { code: 'WORKFLOW_GRAPH', status: 'PASS' },
      { code: 'CONCURRENT_SCOPE', status: 'PASS' },
    ],
    changedPaths: current.changedPaths,
    timing: { startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) },
    warnings: [],
    error: null,
  };
}

function parseArguments(args = []) {
  const values = Array.isArray(args) ? args.map((value) => String(value || '')) : [];
  if (values.length !== 3 || values.some((value) => !value.trim())) {
    throw new PromotionPreflightError('R6_PROMOTION_PREFLIGHT_ARGUMENTS_INVALID', 'R6 promotion preflight requires repository name, promotion workflow run id, and finalization workflow run id.');
  }
  return {
    repositoryName: values[0].trim(),
    workflowRunId: assertRunId(values[1], 'workflowRunId'),
    finalizationWorkflowRunId: assertRunId(values[2], 'finalizationWorkflowRunId'),
  };
}

async function executePreflight(args = []) {
  const startedAt = new Date().toISOString();
  const input = parseArguments(args);
  if (input.repositoryName !== REPOSITORY_CODE) reject('R6_PROMOTION_REPOSITORY_SCOPE_INVALID', 'R6 promotion preflight is bound to SkyCommand.');
  const admission = await loadPromotionAdmission(input.workflowRunId);
  const workflowCode = text(admission?.workflow_code);
  if (!admission || !PROMOTION_WORKFLOW_VARIANTS[workflowCode]) {
    reject('R6_PROMOTION_ADMISSION_INVALID', 'The promotion run is not a valid governed primary or operator-owned admission.', { workflowRunRecordId: input.workflowRunId });
  }
  const authorizationSource = assertPromotionRunAuthorization(admission);
  const parameters = getPromotionParameters(admission);
  if (text(parameters.repoName) !== REPOSITORY_CODE || text(parameters.finalizationWorkflowRunId) !== input.finalizationWorkflowRunId) reject('R6_PROMOTION_ADMISSION_INVALID', 'The promotion admission is not bound to the requested repository and finalization receipt.');
  const governanceScope = getPromotionAuthorizationScope(admission);
  const finalization = await validateFinalizationBinding({
    finalizationWorkflowRunId: input.finalizationWorkflowRunId,
    governanceScope,
  });
  await assertWorkflowGraph(admission.workflow_version_id, workflowCode);
  await assertNoOtherPromotion(input.workflowRunId, governanceScope);
  const admissionIdentity = resolvePromotionAdmissionIdentity(admission);
  const admissionWithIdentity = {
    ...admission,
    idempotency_key_hash: admissionIdentity.idempotencyKeyHash,
    request_digest: admissionIdentity.requestDigest,
  };
  const promotionAdmission = await beginPromotionAdmission({
    admission: { ...admissionWithIdentity, authorization_source: authorizationSource },
    finalization,
  });
  let current;
  try {
    current = await validateCurrentSource({
      finalization,
      environment: process.env,
      sourceIdentityProfileCode: governanceScope.configProfileCode,
      workflowRunRecordId: input.workflowRunId,
    });
  } catch (error) {
    await queryFunction(defaultQuery)(
      "UPDATE worker.dev_promotion_admissions SET status = 'FAILED', failure_code = $2, failure_message = $3, updated_at = CURRENT_TIMESTAMP WHERE dev_promotion_admission_id = $1",
      [promotionAdmission.dev_promotion_admission_id, text(error?.code, 'R6_PROMOTION_PREFLIGHT_FAILED'), text(error?.message, 'R6 promotion preflight failed.').slice(0, 400)],
    ).catch(() => {});
    throw error;
  }
  const output = buildPreflightOutput({
    admission: admissionWithIdentity,
    finalization,
    current,
    promotionAdmission,
    startedAt,
  });
  await authorizePromotionAdmission({ promotionAdmission, output, finalization });
  return output;
}

function normalizeError(error) {
  return {
    code: text(error?.code || error?.details?.code, 'R6_PROMOTION_PREFLIGHT_FAILED'),
    message: text(error?.message, 'R6 promotion preflight failed.').replace(/[A-Za-z]:[\\/][^\s]+/g, '[path-redacted]').slice(0, 400),
  };
}

function normalizeOutput(value = {}) {
  return {
    contract: OUTPUT_TYPE,
    outcome: text(value.outcome, 'FAILED'),
    workflowRunRecordId: nullableText(value.workflowRunRecordId),
    finalizationWorkflowRunId: nullableText(value.finalizationWorkflowRunId),
    repository: {
      repositoryCode: text(value.repository?.repositoryCode, REPOSITORY_CODE),
      environmentCode: text(value.repository?.environmentCode),
      configProfileCode: text(value.repository?.configProfileCode),
      devBranch: text(value.repository?.devBranch),
      mainBranch: text(value.repository?.mainBranch),
      expectedMainSha: nullableText(value.repository?.expectedMainSha),
      remoteUrl: nullableText(value.repository?.remoteUrl),
      currentRevision: nullableText(value.repository?.currentRevision),
    },
    workflow: {
      workflowCode: text(value.workflow?.workflowCode, PROMOTION_WORKFLOW_CODE),
      workflowVersionId: nullableText(value.workflow?.workflowVersionId),
      versionNumber: Number(value.workflow?.versionNumber || 0),
      mergeApprovalRequired: value.workflow?.mergeApprovalRequired === true,
      agentMustStop: value.workflow?.agentMustStop === true,
      terminalObservationRequired: value.workflow?.terminalObservationRequired === true,
    },
    principal: {
      principalCode: nullableText(value.principal?.principalCode),
      principalId: nullableText(value.principal?.principalId),
      authMode: nullableText(value.principal?.authMode),
      userId: nullableText(value.principal?.userId),
      sessionId: nullableText(value.principal?.sessionId),
      agentId: nullableText(value.principal?.agentId),
      instructionSource: text(value.principal?.instructionSource, 'ASSISTANT'),
      instructionRef: nullableText(value.principal?.instructionRef),
      triggerSource: nullableText(value.principal?.triggerSource),
      triggerType: nullableText(value.principal?.triggerType),
      requestedAt: nullableText(value.principal?.requestedAt),
    },
    authorization: {
      promotionAdmissionId: nullableText(value.authorization?.promotionAdmissionId),
      workflowExecutionAdmissionId: nullableText(value.authorization?.workflowExecutionAdmissionId),
      idempotencyKeyHash: digest(value.authorization?.idempotencyKeyHash),
      requestDigest: digest(value.authorization?.requestDigest),
      status: text(value.authorization?.status, 'UNKNOWN'),
    },
    finalizationReceipt: {
      receiptSha256: digest(value.finalizationReceipt?.receiptSha256),
      outcome: text(value.finalizationReceipt?.outcome),
      validationOutcome: text(value.finalizationReceipt?.validationOutcome),
      readinessOutcome: text(value.finalizationReceipt?.readinessOutcome),
    },
    sourceIdentity: publicSourceIdentity(value.sourceIdentity),
    database: {
      outcome: text(value.database?.outcome),
      pendingCount: Number(value.database?.pendingCount || 0),
      pendingOrdinals: safeArray(value.database?.pendingOrdinals).map(Number).filter(Number.isInteger),
      planDigest: digest(value.database?.planDigest),
      manifestDigest: digest(value.database?.manifestDigest),
      databaseName: nullableText(value.database?.databaseName),
      systemIdentifier: nullableText(value.database?.systemIdentifier),
    },
    checks: safeArray(value.checks).slice(0, 16).map((check) => ({ code: text(check?.code), status: text(check?.status, 'UNKNOWN') })),
    changedPaths: safeArray(value.changedPaths).map((item) => normalizedRelativePath(item)).filter(Boolean).slice(0, 64),
    timing: {
      startedAt: nullableText(value.timing?.startedAt),
      completedAt: nullableText(value.timing?.completedAt),
      durationMs: Number(value.timing?.durationMs || 0),
    },
    warnings: safeArray(value.warnings).map((item) => text(item)).filter(Boolean).slice(0, 16),
    error: value.error ? normalizeError(value.error) : null,
  };
}

function createToolResult(value = {}) {
  const output = normalizeOutput(value);
  const success = output.outcome === 'READY';
  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message: success ? 'R6 Development Promotion preflight is READY.' : output.error?.message || 'R6 promotion preflight failed.',
    outputType: OUTPUT_TYPE,
    output,
    warnings: output.warnings,
    error: success ? null : output.error || { code: 'R6_PROMOTION_PREFLIGHT_FAILED', message: 'R6 promotion preflight failed.' },
    metadata: { valuesRedacted: true, workflowCode: output.workflow.workflowCode, finalizationWorkflowCode: FINALIZATION_WORKFLOW_CODE },
  });
}

function createFailureToolResult(error) {
  return createToolResult({ outcome: 'FAILED', error: normalizeError(error) });
}

function renderConsole(result) {
  console.log('[SkyCommand R6 promotion preflight] ' + text(result.outcome, 'FAILED') + ': ' + text(result.workflowRunRecordId, 'run unavailable') + '.');
}

async function main() {
  dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: OUTPUT_TYPE,
    outputSchema: require('../../tools/contracts/dev_promotion_preflight_summary.v1.schema.json'),
    args: process.argv.slice(2),
    execute: executePreflight,
    createToolResult,
    createFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) main();

module.exports = {
  ACTIVE_PROMOTION_STATUSES,
  FINALIZATION_WORKFLOW_CODE,
  HUMAN_PROMOTION_RUN_SOURCES,
  HUMAN_PROMOTION_TRIGGER_TYPES,
  OUTPUT_TYPE,
  PROMOTION_REQUIRED_PERMISSION_CODES,
  PROMOTION_WORKFLOW_VARIANTS,
  PRIMARY_R6_VERSION,
  PROMOTION_WORKFLOW_CODE,
  PromotionPreflightError,
  REPOSITORY_CODE,
  TOOL_CODE,
  assertFinalizationReceipt,
  assertWorkflowGraph,
  assertRunId,
  buildPreflightOutput,
  createFailureToolResult,
  createToolResult,
  executePreflight,
  getEnvironmentCode,
  getPromotionAuthorizationScope,
  getPromotionScope,
  isSqlPath,
  loadDevPromotionAdmission,
  loadPromotionAdmission,
  loadFinalizationRun,
  normalizeGovernedScope,
  normalizeFinalizationBinding,
  normalizeReviewedSourceIdentity,
  main,
  normalizeOutput,
  parseArguments,
  publicDatabase,
  publicSourceIdentity,
  reconcileActivePromotionAdmissions,
  settlePromotionAdmission,
  renderConsole,
  assertPromotionRunAuthorization,
  hasPermissionCodes,
  isAssistantPromotionRun,
  isHumanPromotionRun,
  beginPromotionAdmission,
  resolvePromotionAdmissionIdentity,
  trustedAttribution,
  validateCurrentSource,
  validateFinalizationBinding,
  validatePromotionCommitBoundary,
};
