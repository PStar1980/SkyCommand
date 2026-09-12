const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Connection, Client } = require('@temporalio/client');

const { pool, query } = require('../../../../packages/db/src/connection');
const { getBrowserRuntimeConfig } = require('../../../../packages/browser/src/config');
const { resolveGitHeadSha } = require('../../../../packages/browser/src/browserTestRunner');
const { DEFAULT_HOST_AGENT_TASK_QUEUE, normalizeHostAgentTaskQueue } = require('../../../../packages/host-agent/src/config');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const browserAutomationRegistryService = require('./browserAutomationRegistryService');
const { getHostAgentAvailability } = require('./workflowExecutionPreflightService');
const { serializeTemporalFailure } = require('./browserTestFailureUtils');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const ALLOWED_EXECUTION_MODES = new Set(['HEADLESS', 'INTERACTIVE']);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  throw createHttpError(400, `${label} must be true or false.`);
}

function normalizeInteger(value, fallback, label, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw createHttpError(400, `${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function normalizeEnvironmentCode(value) {
  const code = normalizeText(value).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw createHttpError(400, 'environmentCode is invalid.');
  return code;
}

function normalizeExecutionMode(value) {
  const mode = normalizeText(value, 'HEADLESS').toUpperCase();
  if (!ALLOWED_EXECUTION_MODES.has(mode)) {
    throw createHttpError(400, `executionMode must be one of: ${[...ALLOWED_EXECUTION_MODES].join(', ')}.`);
  }
  return mode;
}

function normalizePageSize(value) {
  return normalizeInteger(value, DEFAULT_PAGE_SIZE, 'limit', 1, MAX_PAGE_SIZE);
}

function normalizeOffset(value) {
  return normalizeInteger(value, 0, 'offset', 0, 1000000);
}

function permissionCodeSet(permissions = []) {
  return new Set((permissions || []).map((permission) => (
    typeof permission === 'string'
      ? permission
      : permission?.permissionCode || permission?.permission_code || permission?.code
  )).filter(Boolean));
}

function normalizeActor(actor = null) {
  if (!actor || typeof actor !== 'object') return { userId: null, label: null };
  const userId = actor.userId || actor.user_id || actor.id || null;
  return {
    userId: userId && UUID_PATTERN.test(String(userId)) ? String(userId) : null,
    label: normalizeText(actor.displayName || actor.display_name || actor.username || actor.email || userId) || null,
  };
}

async function validateRepositoryParameter(value) {
  const code = normalizeText(value);
  if (!code) return null;
  const result = await query(
    'SELECT repo_code FROM core.repositories WHERE active = TRUE AND (repo_code = $1 OR repo_id::text = $1) LIMIT 1',
    [code],
  );
  if (!result.rows[0]) throw createHttpError(400, `Repository parameter '${code}' is not registered or active.`);
  return result.rows[0].repo_code;
}

async function coerceParameter(parameter, rawValue) {
  const type = parameter.type;
  const label = parameter.label || parameter.parameterName;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (parameter.required && (parameter.defaultValue === null || parameter.defaultValue === undefined || parameter.defaultValue === '')) {
      throw createHttpError(400, `${label} is required.`, { parameterName: parameter.parameterName });
    }
    rawValue = parameter.defaultValue;
  }
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;

  if (type === 'boolean') return normalizeBoolean(rawValue, false, label);
  if (type === 'number') {
    const number = Number(rawValue);
    if (!Number.isFinite(number)) throw createHttpError(400, `${label} must be numeric.`);
    return number;
  }
  if (type === 'json') {
    if (typeof rawValue === 'object') return rawValue;
    try { return JSON.parse(String(rawValue)); } catch (_error) {
      throw createHttpError(400, `${label} must contain valid JSON.`);
    }
  }
  if (type === 'repo') return validateRepositoryParameter(rawValue);

  const text = String(rawValue).trim();
  if (type === 'select' && parameter.options?.length) {
    const allowed = new Set(parameter.options.filter((option) => option.enabled).map((option) => option.value));
    if (!allowed.has(text)) throw createHttpError(400, `${label} must be one of the configured choices.`);
  }
  return text;
}

async function resolveParameters(automation, supplied = {}) {
  if (supplied === undefined || supplied === null) supplied = {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw createHttpError(400, 'parameters must be a JSON object.');
  }
  const definitions = (automation.parameters || []).filter((parameter) => parameter.enabled);
  const known = new Set(definitions.map((parameter) => parameter.parameterName));
  const unknown = Object.keys(supplied).filter((name) => !known.has(name));
  if (unknown.length) throw createHttpError(400, `Unknown Playwright Automation parameter(s): ${unknown.join(', ')}.`);

  const resolved = {};
  for (const parameter of definitions) {
    const value = await coerceParameter(parameter, supplied[parameter.parameterName]);
    if (value !== null) resolved[parameter.parameterName] = value;
  }
  return resolved;
}

async function resolveEnvironment(automation, requestedEnvironmentCode) {
  const environmentCode = normalizeEnvironmentCode(requestedEnvironmentCode || automation.defaultEnvironmentCode);
  const environment = (automation.environments || []).find((item) => item.environmentCode === environmentCode && item.enabled);
  if (!environment) {
    throw createHttpError(400, `Playwright Automation '${automation.automationCode}' is not enabled for environment ${environmentCode}.`, {
      automationCode: automation.automationCode,
      environmentCode,
    });
  }
  return environment;
}

function assertExecutionPermission(automation, permissions) {
  if (!automation.permissionCode) return;
  if (!permissionCodeSet(permissions).has(automation.permissionCode)) {
    throw createHttpError(403, 'Permission denied for this Playwright Automation.', {
      automationCode: automation.automationCode,
      permissionCode: automation.permissionCode,
    });
  }
}

function assertConfirmation(automation, body = {}) {
  if (!automation.requiresConfirmation) return;
  const confirmed = normalizeBoolean(body.confirmed ?? body.confirm, false, 'confirmed');
  if (!confirmed) {
    throw createHttpError(409, 'Playwright Automation confirmation is required.', {
      code: 'BROWSER_AUTOMATION_CONFIRMATION_REQUIRED',
      confirmationText: automation.confirmationText,
    });
  }
}

function buildWorkflowId(automationCode) {
  return `skycommand-browser-automation-${automationCode}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function temporalStatusName(status) {
  if (!status) return 'UNKNOWN';
  if (typeof status === 'string') return status.toUpperCase();
  if (status.name) return String(status.name).toUpperCase();
  const map = { 1: 'RUNNING', 2: 'COMPLETED', 3: 'FAILED', 4: 'CANCELED', 5: 'TERMINATED', 6: 'CONTINUED_AS_NEW', 7: 'TIMED_OUT' };
  return map[status] || String(status).toUpperCase();
}

function operatorStatusFromTemporal(temporalStatus) {
  const normalized = temporalStatusName(temporalStatus);
  if (normalized === 'COMPLETED') return 'SUCCESS';
  if (['FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'].includes(normalized)) return normalized;
  if (normalized === 'RUNNING') return 'RUNNING';
  return 'STARTED';
}

function relativeArtifactRoot(runtimeConfig, executionId) {
  const sourceRoot = path.resolve(runtimeConfig.sourceRepositoryRoot || process.cwd());
  const runRoot = path.resolve(runtimeConfig.automationArtifactRoot, executionId);
  if (runRoot !== sourceRoot && !runRoot.startsWith(`${sourceRoot}${path.sep}`)) return null;
  return path.relative(sourceRoot, runRoot).replace(/\\/g, '/');
}

function loadSummaryFromDisk(row) {
  if (!row?.artifact_root) return null;
  const runtimeConfig = getBrowserRuntimeConfig();
  const sourceRoot = path.resolve(runtimeConfig.sourceRepositoryRoot || process.cwd());
  const runRoot = path.resolve(sourceRoot, row.artifact_root);
  if (runRoot !== sourceRoot && !runRoot.startsWith(`${sourceRoot}${path.sep}`)) return null;
  const summaryPath = path.join(runRoot, 'skycommand-automation-summary.json');
  try {
    if (!fs.existsSync(summaryPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function sanitizeArtifactRow(row, workflowId = null) {
  return {
    artifactId: row.artifact_id,
    kind: row.artifact_kind,
    name: row.artifact_name,
    relativePath: row.relative_path,
    contentType: row.content_type || null,
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    createdAt: row.created_at || null,
    url: workflowId
      ? `/api/browser-automations/runs/${encodeURIComponent(workflowId)}/artifacts/${encodeURIComponent(row.artifact_id)}`
      : null,
  };
}

function sanitizeRunRow(row, artifacts = []) {
  if (!row) return null;
  return {
    browserAutomationRunId: row.browser_automation_run_id,
    executionId: row.execution_id,
    automationId: row.automation_id,
    automationCode: row.automation_code,
    automationLabel: row.automation_label,
    categoryCode: row.category_code || null,
    categoryLabel: row.category_label || 'Uncategorized',
    workflowId: row.temporal_workflow_id,
    runId: row.temporal_run_id || null,
    temporalStatus: row.temporal_status || 'UNKNOWN',
    status: row.status || 'STARTED',
    triggerSource: row.trigger_source || 'MANUAL',
    initiatedBy: row.initiated_by || row.initiated_by_label || null,
    environmentCode: row.environment_code || null,
    browserType: row.browser_type || 'chromium',
    executionMode: row.execution_mode || row.result_summary?.executionMode || 'HEADLESS',
    parameters: row.parameters || {},
    sourceRepositoryCode: row.source_repo_code || null,
    sourceCommit: row.source_commit_sha || null,
    sideEffectLevel: row.side_effect_level || null,
    idempotencyMode: row.idempotency_mode || null,
    riskCode: row.risk_code || null,
    artifactRoot: row.artifact_root || null,
    result: row.result_summary || null,
    failure: row.failure_summary || null,
    startTime: row.started_at || row.created_at || null,
    closeTime: row.completed_at || null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    artifactCount: Number(row.artifact_count || artifacts.length || 0),
    artifacts,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function replaceRunArtifacts(client, browserAutomationRunId, artifacts = []) {
  await client.query('DELETE FROM worker.browser_automation_artifacts WHERE browser_automation_run_id = $1', [browserAutomationRunId]);
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const relativePath = normalizeText(artifact.relativePath).replace(/\\/g, '/');
    if (!relativePath || relativePath.includes('../') || relativePath.startsWith('/')) continue;
    let kind = normalizeText(artifact.kind || artifact.type, 'ATTACHMENT').toUpperCase();
    const allowedKinds = new Set(['TRACE', 'SCREENSHOT', 'VIDEO', 'REPORT', 'ATTACHMENT', 'DOWNLOAD', 'FILE']);
    if (!allowedKinds.has(kind)) kind = 'ATTACHMENT';
    await client.query(
      `INSERT INTO worker.browser_automation_artifacts (
         browser_automation_run_id, artifact_kind, artifact_name, relative_path, content_type, size_bytes
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (browser_automation_run_id, relative_path)
       DO UPDATE SET artifact_kind = EXCLUDED.artifact_kind,
                     artifact_name = EXCLUDED.artifact_name,
                     content_type = EXCLUDED.content_type,
                     size_bytes = EXCLUDED.size_bytes`,
      [
        browserAutomationRunId,
        kind,
        normalizeText(artifact.name, path.basename(relativePath)),
        relativePath,
        normalizeText(artifact.contentType) || null,
        Number.isFinite(Number(artifact.sizeBytes)) ? Number(artifact.sizeBytes) : null,
      ],
    );
  }
}

async function getLedgerRowByWorkflowId(workflowId) {
  const result = await query(
    `SELECT * FROM worker.vw_browser_automation_runs WHERE temporal_workflow_id = $1 LIMIT 1`,
    [workflowId],
  );
  return result.rows[0] || null;
}

async function loadArtifactsForRun(browserAutomationRunId, workflowId) {
  const result = await query(
    `SELECT * FROM worker.browser_automation_artifacts
     WHERE browser_automation_run_id = $1
     ORDER BY created_at, artifact_kind, artifact_name`,
    [browserAutomationRunId],
  );
  return result.rows.map((row) => sanitizeArtifactRow(row, workflowId));
}

async function persistObservedRun(row, { temporalStatus, description = null, result = null, temporalError = null } = {}) {
  const diskSummary = loadSummaryFromDisk(row);
  const effectiveResult = result && typeof result === 'object' ? result : diskSummary;
  const temporalFailure = temporalError ? serializeTemporalFailure(temporalError) : null;
  const status = effectiveResult?.status
    ? String(effectiveResult.status).toUpperCase()
    : operatorStatusFromTemporal(temporalStatus);
  const normalizedStatus = ['SUCCESS','FAILED','CANCELED','TERMINATED','TIMED_OUT','RUNNING','STARTED'].includes(status)
    ? status
    : operatorStatusFromTemporal(temporalStatus);
  const startedAt = effectiveResult?.startedAt || description?.startTime || row.started_at || row.created_at || null;
  const completedAt = effectiveResult?.completedAt || description?.closeTime || (TERMINAL_STATUSES.has(normalizedStatus) ? new Date().toISOString() : null);
  const durationMs = Number.isFinite(Number(effectiveResult?.durationMs))
    ? Number(effectiveResult.durationMs)
    : (startedAt && completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null);
  const failure = effectiveResult?.failure || temporalFailure || null;
  const sourceCommit = normalizeText(effectiveResult?.sourceCommit) || row.source_commit_sha || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE worker.browser_automation_runs
       SET temporal_status = $2,
           status = $3,
           temporal_run_id = COALESCE($4, temporal_run_id),
           source_commit_sha = COALESCE($5, source_commit_sha),
           result_summary = $6::jsonb,
           failure_summary = $7::jsonb,
           started_at = COALESCE($8, started_at),
           completed_at = $9,
           duration_ms = $10
       WHERE browser_automation_run_id = $1`,
      [
        row.browser_automation_run_id,
        temporalStatusName(temporalStatus),
        normalizedStatus,
        description?.runId || row.temporal_run_id || null,
        sourceCommit,
        effectiveResult ? JSON.stringify(effectiveResult) : null,
        failure ? JSON.stringify(failure) : null,
        startedAt,
        completedAt,
        durationMs,
      ],
    );
    await replaceRunArtifacts(client, row.browser_automation_run_id, effectiveResult?.artifacts || []);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function reconcileRun(row) {
  if (TERMINAL_STATUSES.has(String(row.status || '').toUpperCase()) && row.result_summary) return row;
  const runtimeConfig = getBrowserRuntimeConfig();
  const connection = await Connection.connect({ address: runtimeConfig.temporalAddress });
  const client = new Client({ connection, namespace: runtimeConfig.temporalNamespace });
  try {
    const handle = client.workflow.getHandle(row.temporal_workflow_id);
    const description = await handle.describe();
    const temporalStatus = temporalStatusName(description.status);
    let result = null;
    let temporalError = null;
    if (temporalStatus === 'COMPLETED') result = await handle.result();
    else if (['FAILED','CANCELED','TERMINATED','TIMED_OUT'].includes(temporalStatus)) {
      try { await handle.result(); } catch (error) { temporalError = error; }
    }
    await persistObservedRun(row, { temporalStatus, description, result, temporalError });
  } catch (error) {
    if (/not found/i.test(error.message || '')) return row;
    throw error;
  } finally {
    await connection.close();
  }
  return getLedgerRowByWorkflowId(row.temporal_workflow_id);
}

async function listRuns(filters = {}) {
  const values = [];
  const clauses = [];
  const search = normalizeText(filters.search || filters.query || filters.q);
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(
      automation_label ILIKE $${values.length}
      OR automation_code ILIKE $${values.length}
      OR temporal_workflow_id ILIKE $${values.length}
      OR COALESCE(category_label, '') ILIKE $${values.length}
      OR COALESCE(status, '') ILIKE $${values.length}
    )`);
  }
  const categoryCode = normalizeText(filters.categoryCode).toLowerCase();
  if (categoryCode) { values.push(categoryCode); clauses.push(`category_code = $${values.length}`); }
  const environmentCode = normalizeText(filters.environmentCode).toUpperCase();
  if (environmentCode) { values.push(environmentCode); clauses.push(`environment_code = $${values.length}`); }
  const status = normalizeText(filters.status).toUpperCase();
  if (status) { values.push(status); clauses.push(`status = $${values.length}`); }
  const executionMode = normalizeText(filters.executionMode).toUpperCase();
  if (executionMode) { values.push(executionMode); clauses.push(`execution_mode = $${values.length}`); }
  const sideEffectLevel = normalizeText(filters.sideEffectLevel).toUpperCase();
  if (sideEffectLevel) { values.push(sideEffectLevel); clauses.push(`side_effect_level = $${values.length}`); }

  const limit = normalizePageSize(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit, offset);
  const result = await query(
    `SELECT * FROM worker.vw_browser_automation_runs
     ${where}
     ORDER BY COALESCE(started_at, created_at) DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const countValues = values.slice(0, -2);
  const totalResult = await query(`SELECT COUNT(*)::int AS count FROM worker.vw_browser_automation_runs ${where}`, countValues);
  const rows = [...result.rows];
  for (let index = 0; index < rows.length; index += 1) {
    if (!['STARTED', 'RUNNING'].includes(String(rows[index].status || '').toUpperCase())) continue;
    try { rows[index] = await reconcileRun(rows[index]); } catch (_error) { /* keep durable row visible */ }
  }
  return {
    items: rows.map((row) => sanitizeRunRow(row)),
    total: Number(totalResult.rows[0]?.count || 0),
    limit,
    offset,
  };
}

async function getRun(workflowId) {
  const id = normalizeText(workflowId);
  if (!id || !/^skycommand-browser-automation-[A-Za-z0-9_-]+$/.test(id)) {
    throw createHttpError(400, 'Invalid Playwright Automation workflowId.');
  }
  let row = await getLedgerRowByWorkflowId(id);
  if (!row) throw createHttpError(404, 'Playwright Automation run not found.');
  row = await reconcileRun(row);
  const artifacts = await loadArtifactsForRun(row.browser_automation_run_id, id);
  return sanitizeRunRow(row, artifacts);
}

async function getArtifact({ workflowId, artifactId }) {
  const id = normalizeText(workflowId);
  if (!id || !/^skycommand-browser-automation-[A-Za-z0-9_-]+$/.test(id)) {
    throw createHttpError(400, 'Invalid Playwright Automation workflowId.');
  }
  const artifactUuid = normalizeText(artifactId);
  if (!UUID_PATTERN.test(artifactUuid)) throw createHttpError(400, 'artifactId must be a valid UUID.');
  const result = await query(
    `SELECT r.artifact_root, a.*
     FROM worker.browser_automation_artifacts a
     JOIN worker.browser_automation_runs r ON r.browser_automation_run_id = a.browser_automation_run_id
     WHERE r.temporal_workflow_id = $1 AND a.artifact_id = $2
     LIMIT 1`,
    [id, artifactUuid],
  );
  const row = result.rows[0];
  if (!row) throw createHttpError(404, 'Playwright Automation artifact not found.');
  const runtimeConfig = getBrowserRuntimeConfig();
  const sourceRoot = path.resolve(runtimeConfig.sourceRepositoryRoot || process.cwd());
  const runRoot = path.resolve(sourceRoot, row.artifact_root || '');
  const absolutePath = path.resolve(runRoot, row.relative_path);
  if (!absolutePath.startsWith(`${runRoot}${path.sep}`) || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw createHttpError(404, 'Playwright Automation artifact file is unavailable.');
  }
  return {
    absolutePath,
    name: row.artifact_name,
    contentType: row.content_type || 'application/octet-stream',
    kind: row.artifact_kind,
  };
}

async function startRegisteredAutomation({ automationCode, body = {}, permissions = [], actor = null, triggerSource = 'MANUAL' }) {
  const automation = await browserAutomationRegistryService.getBrowserAutomationByCode(automationCode, { includeDisabled: false });
  if (!automation) throw createHttpError(404, 'Playwright Automation not found or disabled.');
  if (automation.scriptRepository?.repoCode !== 'SkyCommand') {
    throw createHttpError(409, 'The current Browser Worker can execute Playwright Automation source only from the SkyCommand repository.', {
      code: 'BROWSER_AUTOMATION_SOURCE_REPOSITORY_NOT_SUPPORTED',
      repository: automation.scriptRepository?.repoCode,
    });
  }
  assertExecutionPermission(automation, permissions);
  assertConfirmation(automation, body);
  const environment = await resolveEnvironment(automation, body.environmentCode);
  const parameters = await resolveParameters(automation, body.parameters || {});
  const executionMode = normalizeExecutionMode(body.executionMode);

  if (executionMode === 'INTERACTIVE' && environment.environmentCode !== 'LOCAL') {
    throw createHttpError(409, 'Interactive Playwright Automation is currently available only for LOCAL.', {
      code: 'BROWSER_AUTOMATION_INTERACTIVE_ENVIRONMENT_NOT_SUPPORTED',
      environmentCode: environment.environmentCode,
    });
  }
  if (executionMode === 'INTERACTIVE') {
    const hostAvailability = await getHostAgentAvailability();
    if (!hostAvailability.enabled) {
      throw createHttpError(409, 'Interactive Playwright Automation requires the SkyCommand Host Agent to be enabled.', {
        code: 'BROWSER_AUTOMATION_INTERACTIVE_HOST_AGENT_DISABLED',
      });
    }
    if (!hostAvailability.online) {
      throw createHttpError(503, 'Interactive Playwright Automation requires the host-native SkyCommand Host Agent to be online.', {
        code: 'BROWSER_AUTOMATION_INTERACTIVE_HOST_AGENT_UNAVAILABLE',
        operatorCommand: 'npm run host-agent:auto-start:start',
      });
    }
  }

  const runtimeConfig = getBrowserRuntimeConfig();
  const workflowId = buildWorkflowId(automation.automationCode);
  const executionId = randomUUID();
  const actorInfo = normalizeActor(actor);
  const sourceCommit = resolveGitHeadSha(runtimeConfig.sourceRepositoryRoot || process.cwd());
  const artifactRoot = relativeArtifactRoot(runtimeConfig, executionId);

  let browserAutomationRunId;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const lockResult = await db.query(
      'SELECT max_concurrency FROM core.browser_automations WHERE automation_id = $1 FOR UPDATE',
      [automation.automationId],
    );
    if (!lockResult.rows[0]) throw createHttpError(404, 'Playwright Automation not found.');
    const activeResult = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM worker.browser_automation_runs
       WHERE automation_id = $1 AND status IN ('STARTED','RUNNING')`,
      [automation.automationId],
    );
    const activeCount = Number(activeResult.rows[0]?.count || 0);
    if (activeCount >= Number(automation.maxConcurrency || 1)) {
      throw createHttpError(409, `Playwright Automation '${automation.label}' has reached its concurrency limit.`, {
        code: 'BROWSER_AUTOMATION_CONCURRENCY_LIMIT',
        maxConcurrency: automation.maxConcurrency,
        activeCount,
      });
    }
    const insert = await db.query(
      `INSERT INTO worker.browser_automation_runs (
         execution_id, automation_id, automation_code, automation_label, category_code,
         temporal_workflow_id, temporal_status, status, trigger_source,
         initiated_by_user_id, initiated_by_label, environment_code, browser_type, execution_mode,
         parameters, source_repo_code, source_commit_sha, side_effect_level, idempotency_mode, risk_code, artifact_root
       ) VALUES ($1,$2,$3,$4,$5,$6,'STARTED','STARTED',$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19)
       RETURNING browser_automation_run_id`,
      [
        executionId,
        automation.automationId,
        automation.automationCode,
        automation.label,
        automation.category?.categoryCode || null,
        workflowId,
        normalizeText(triggerSource, 'MANUAL').toUpperCase(),
        actorInfo.userId,
        actorInfo.label,
        environment.environmentCode,
        automation.browserType,
        executionMode,
        JSON.stringify(parameters),
        automation.scriptRepository.repoCode,
        sourceCommit,
        automation.sideEffectLevel,
        automation.idempotencyMode,
        automation.riskCode,
        artifactRoot,
      ],
    );
    browserAutomationRunId = insert.rows[0].browser_automation_run_id;
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }

  const connection = await Connection.connect({ address: runtimeConfig.temporalAddress });
  const client = new Client({ connection, namespace: runtimeConfig.temporalNamespace });
  try {
    const commonInput = {
      executionType: 'AUTOMATION',
      executionMode,
      executionId,
      automationCode: automation.automationCode,
      scriptPath: automation.scriptPath,
      browserType: automation.browserType,
      environmentCode: environment.environmentCode,
      baseUrl: environment.baseUrl,
      timeoutMs: automation.timeoutSeconds * 1000,
      retryCount: automation.retryCount,
      parameters,
      outputType: automation.outputType,
      outputSchemaPath: automation.outputSchemaPath,
      sideEffectLevel: automation.sideEffectLevel,
      idempotencyMode: automation.idempotencyMode,
    };
    const hostTaskQueue = normalizeHostAgentTaskQueue(process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE);
    const temporalConfig = getTemporalConfig();
    const workflowType = executionMode === 'INTERACTIVE'
      ? 'skyCommandHostAgentToolWorkflow'
      : 'browserAutomationExecutionWorkflow';
    const workflowTaskQueue = executionMode === 'INTERACTIVE' ? temporalConfig.taskQueue : runtimeConfig.taskQueue;
    const workflowInput = executionMode === 'INTERACTIVE'
      ? { ...commonInput, toolCode: '__browser_automation_interactive', hostTaskQueue, headed: true }
      : commonInput;
    const handle = await client.workflow.start(workflowType, {
      taskQueue: workflowTaskQueue,
      workflowId,
      memo: {
        skycommandBrowserAutomation: {
          automationCode: automation.automationCode,
          environmentCode: environment.environmentCode,
          executionId,
          executionMode,
          sideEffectLevel: automation.sideEffectLevel,
        },
      },
      args: [workflowInput],
    });
    await query(
      `UPDATE worker.browser_automation_runs
       SET temporal_run_id = $2, temporal_status = 'RUNNING', status = 'RUNNING', started_at = CURRENT_TIMESTAMP
       WHERE browser_automation_run_id = $1`,
      [browserAutomationRunId, handle.firstExecutionRunId || null],
    );
    return {
      automation,
      execution: {
        browserAutomationRunId,
        executionId,
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId || null,
        status: 'RUNNING',
        taskQueue: executionMode === 'INTERACTIVE' ? hostTaskQueue : runtimeConfig.taskQueue,
        executionMode,
        environmentCode: environment.environmentCode,
        parameters,
        sourceCommit,
        artifactRoot,
      },
    };
  } catch (error) {
    await query(
      `UPDATE worker.browser_automation_runs
       SET temporal_status = 'UNKNOWN', status = 'FAILED', completed_at = CURRENT_TIMESTAMP,
           failure_summary = $2::jsonb
       WHERE browser_automation_run_id = $1`,
      [browserAutomationRunId, JSON.stringify({ message: error.message || String(error), stack: error.stack || null })],
    ).catch(() => {});
    throw error;
  } finally {
    await connection.close();
  }
}

module.exports = {
  createHttpError,
  getArtifact,
  getRun,
  listRuns,
  normalizeExecutionMode,
  resolveEnvironment,
  resolveParameters,
  startRegisteredAutomation,
};
