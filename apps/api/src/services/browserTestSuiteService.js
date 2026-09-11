const { randomUUID } = require('node:crypto');
const { Connection, Client } = require('@temporalio/client');

const { query } = require('../../../../packages/db/src/connection');
const { getBrowserRuntimeConfig } = require('../../../../packages/browser/src/config');
const { resolveGitHeadSha } = require('../../../../packages/browser/src/browserTestRunner');
const browserTestRegistryService = require('./browserTestRegistryService');
const { serializeTemporalFailure } = require('./browserTestFailureUtils');

const SUITE_CODE_PATTERN = /^[a-z][a-z0-9_-]*$/;
const TERMINAL_STATUSES = new Set(['PASSED', 'FAILED', 'PARTIAL', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);

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

function normalizeSuiteCode(value) {
  const code = normalizeText(value).toLowerCase();
  if (!SUITE_CODE_PATTERN.test(code)) throw createHttpError(400, 'Invalid Playwright Test Suite code.');
  return code;
}

function normalizeEnvironmentCode(value, fallback = 'LOCAL') {
  const code = normalizeText(value, fallback).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw createHttpError(400, 'Invalid Browser environment code.');
  return code;
}

function normalizeInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object') return { userId: null, label: null };
  const userId = actor.userId || actor.user_id || null;
  return {
    userId,
    label: normalizeText(actor.displayName || actor.display_name || actor.username || actor.email || userId) || null,
  };
}

function permissionSet(permissions = []) {
  return new Set((Array.isArray(permissions) ? permissions : [])
    .map((item) => item?.permissionCode || item?.permission_code || item)
    .map(normalizeText)
    .filter(Boolean));
}

function assertPermission(code, permissions, label) {
  const required = normalizeText(code);
  if (required && !permissionSet(permissions).has(required)) {
    throw createHttpError(403, `${label || 'Playwright Test Suite'} requires permission ${required}.`, {
      code: 'BROWSER_TEST_SUITE_PERMISSION_REQUIRED',
      permissionCode: required,
    });
  }
}

function temporalStatusName(status) {
  if (!status) return 'UNKNOWN';
  if (typeof status === 'string') return status.toUpperCase();
  const text = String(status?.name || status).toUpperCase();
  for (const candidate of ['COMPLETED','FAILED','CANCELED','TERMINATED','CONTINUED_AS_NEW','TIMED_OUT','RUNNING']) {
    if (text.includes(candidate)) return candidate;
  }
  return 'UNKNOWN';
}

function operatorStatusFromTemporal(status) {
  const normalized = temporalStatusName(status);
  if (normalized === 'COMPLETED') return 'PASSED';
  if (normalized === 'RUNNING') return 'RUNNING';
  if (normalized === 'CANCELED') return 'CANCELED';
  if (normalized === 'TERMINATED') return 'TERMINATED';
  if (normalized === 'TIMED_OUT') return 'TIMED_OUT';
  if (normalized === 'FAILED') return 'FAILED';
  return 'STARTED';
}

function sanitizeSuite(row, members = []) {
  return {
    suiteId: row.suite_id,
    suiteCode: row.suite_code,
    name: row.name,
    label: row.label,
    description: row.description || null,
    defaultEnvironmentCode: row.default_environment_code || 'LOCAL',
    executionMode: row.execution_mode || 'HEADLESS',
    stopOnFailure: row.stop_on_failure === true,
    permissionCode: row.permission_code || 'BROWSER_TEST_SUITE_RUN',
    displayOrder: Number(row.display_order || 0),
    enabled: row.enabled === true,
    memberCount: Number(row.member_count || members.length || 0),
    members,
  };
}

function sanitizeMember(row) {
  return {
    suiteMemberId: row.suite_member_id,
    testId: row.test_id,
    testCode: row.test_code,
    testLabel: row.test_label,
    categoryCode: row.category_code || null,
    categoryLabel: row.category_label || 'Uncategorized',
    browserType: row.browser_type || 'chromium',
    defaultEnvironmentCode: row.test_default_environment_code || 'LOCAL',
    environmentCode: row.environment_code || null,
    parameterOverrides: row.parameter_overrides || {},
    displayOrder: Number(row.display_order || 0),
    enabled: row.enabled === true,
    testEnabled: row.test_enabled === true,
  };
}

async function loadSuiteMembers(suiteId) {
  const result = await query(
    `SELECT m.*, t.test_code, t.label AS test_label, t.browser_type,
            t.default_environment_code AS test_default_environment_code, t.enabled AS test_enabled,
            c.category_code, c.label AS category_label
     FROM core.browser_test_suite_members m
     JOIN core.browser_tests t ON t.test_id = m.test_id
     LEFT JOIN core.browser_test_categories c ON c.category_id = t.category_id
     WHERE m.suite_id = $1
     ORDER BY m.display_order, t.test_code`,
    [suiteId],
  );
  return result.rows.map(sanitizeMember);
}

async function listSuites(filters = {}) {
  const values = [];
  const clauses = [];
  const search = normalizeText(filters.search || filters.q || filters.query);
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(s.label ILIKE $${values.length} OR s.suite_code ILIKE $${values.length} OR COALESCE(s.description,'') ILIKE $${values.length})`);
  }
  if (normalizeText(filters.enabled)) {
    values.push(/^true|1|yes$/i.test(String(filters.enabled)));
    clauses.push(`s.enabled = $${values.length}`);
  } else {
    clauses.push('s.enabled = TRUE');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(
    `SELECT s.*, COUNT(m.suite_member_id) FILTER (WHERE m.enabled = TRUE)::int AS member_count
     FROM core.browser_test_suites s
     LEFT JOIN core.browser_test_suite_members m ON m.suite_id = s.suite_id
     ${where}
     GROUP BY s.suite_id
     ORDER BY s.display_order, s.suite_code`,
    values,
  );
  return { items: result.rows.map((row) => sanitizeSuite(row)), total: result.rows.length };
}

async function getSuiteByCode(suiteCode, { includeDisabled = false } = {}) {
  const code = normalizeSuiteCode(suiteCode);
  const result = await query(
    `SELECT s.*, COUNT(m.suite_member_id) FILTER (WHERE m.enabled = TRUE)::int AS member_count
     FROM core.browser_test_suites s
     LEFT JOIN core.browser_test_suite_members m ON m.suite_id = s.suite_id
     WHERE s.suite_code = $1 ${includeDisabled ? '' : 'AND s.enabled = TRUE'}
     GROUP BY s.suite_id LIMIT 1`,
    [code],
  );
  const row = result.rows[0];
  if (!row) return null;
  return sanitizeSuite(row, await loadSuiteMembers(row.suite_id));
}

async function resolveSuiteMemberExecution(member, environmentCode, permissions) {
  const test = await browserTestRegistryService.getBrowserTestById(member.testId, { includeDisabled: false });
  if (!test) throw createHttpError(409, `Suite member '${member.testCode}' is disabled or unavailable.`);
  if (test.scriptRepository?.repoCode !== 'SkyCommand') {
    throw createHttpError(409, `Suite member '${test.testCode}' is not executable by the current Browser Worker.`);
  }
  assertPermission(test.permissionCode, permissions, test.label);
  if (test.requiresConfirmation) {
    throw createHttpError(409, `Suite member '${test.testCode}' requires direct confirmation and cannot run unattended in a Phase 8 suite.`, {
      code: 'BROWSER_TEST_SUITE_MEMBER_CONFIRMATION_REQUIRED',
      testCode: test.testCode,
    });
  }
  const memberEnvironment = normalizeEnvironmentCode(member.environmentCode || environmentCode || test.defaultEnvironmentCode);
  const allowedEnvironment = (test.environments || []).find((item) => item.enabled && item.environmentCode === memberEnvironment);
  if (!allowedEnvironment) {
    throw createHttpError(409, `Suite member '${test.testCode}' does not allow environment ${memberEnvironment}.`);
  }
  const parameters = await browserTestRegistryService.resolveBrowserTestParameters(test, member.parameterOverrides || {});
  const executionId = randomUUID();
  return {
    suiteMemberId: member.suiteMemberId,
    testId: test.testId,
    testCode: test.testCode,
    testLabel: test.label,
    displayOrder: member.displayOrder,
    executionId,
    executionInput: {
      executionType: 'TEST',
      executionMode: 'HEADLESS',
      executionId,
      testCode: test.testCode,
      testPath: test.scriptPath,
      grep: test.grepPattern,
      browserType: test.browserType,
      environmentCode: allowedEnvironment.environmentCode,
      baseUrl: allowedEnvironment.baseUrl,
      timeoutMs: test.timeoutSeconds * 1000,
      retryCount: test.retryCount,
      parameters,
    },
  };
}

function buildSuiteWorkflowId(suiteCode) {
  return `skycommand-browser-suite-${suiteCode}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function startSuite({ suiteCode, body = {}, permissions = [], actor = null, triggerSource = 'MANUAL' }) {
  const suite = await getSuiteByCode(suiteCode);
  if (!suite) throw createHttpError(404, 'Playwright Test Suite not found.');
  assertPermission(suite.permissionCode, permissions, suite.label);
  const environmentCode = normalizeEnvironmentCode(body.environmentCode || suite.defaultEnvironmentCode);
  if (normalizeText(body.executionMode, 'HEADLESS').toUpperCase() !== 'HEADLESS') {
    throw createHttpError(409, 'Phase 8 Playwright Test Suites execute in Background (Headless) mode only.', {
      code: 'BROWSER_TEST_SUITE_INTERACTIVE_NOT_SUPPORTED',
    });
  }
  const enabledMembers = suite.members.filter((member) => member.enabled && member.testEnabled);
  if (!enabledMembers.length) throw createHttpError(409, 'Playwright Test Suite has no enabled members.');

  const preparedMembers = [];
  for (const member of enabledMembers) preparedMembers.push(await resolveSuiteMemberExecution(member, environmentCode, permissions));

  const runtimeConfig = getBrowserRuntimeConfig();
  const executionId = randomUUID();
  const workflowId = buildSuiteWorkflowId(suite.suiteCode);
  const actorInfo = normalizeActor(actor);
  const sourceCommit = resolveGitHeadSha(runtimeConfig.sourceRepositoryRoot || process.cwd());
  const insert = await query(
    `INSERT INTO worker.browser_test_suite_runs (
       execution_id, suite_id, suite_code, suite_label, temporal_workflow_id,
       temporal_status, status, trigger_source, initiated_by_user_id, initiated_by_label,
       environment_code, execution_mode, stop_on_failure, source_commit_sha
     ) VALUES ($1,$2,$3,$4,$5,'STARTED','STARTED',$6,$7,$8,$9,'HEADLESS',$10,$11)
     RETURNING browser_test_suite_run_id`,
    [executionId, suite.suiteId, suite.suiteCode, suite.label, workflowId,
      normalizeText(triggerSource, 'MANUAL').toUpperCase(), actorInfo.userId, actorInfo.label,
      environmentCode, suite.stopOnFailure, sourceCommit],
  );
  const suiteRunId = insert.rows[0].browser_test_suite_run_id;

  const connection = await Connection.connect({ address: runtimeConfig.temporalAddress });
  const client = new Client({ connection, namespace: runtimeConfig.temporalNamespace });
  try {
    const handle = await client.workflow.start('browserTestSuiteWorkflow', {
      taskQueue: runtimeConfig.taskQueue,
      workflowId,
      memo: {
        skycommandBrowserTestSuite: {
          suiteCode: suite.suiteCode,
          executionId,
          environmentCode,
          memberCount: preparedMembers.length,
        },
      },
      args: [{
        executionType: 'TEST_SUITE',
        suiteCode: suite.suiteCode,
        environmentCode,
        executionMode: 'HEADLESS',
        stopOnFailure: suite.stopOnFailure,
        members: preparedMembers,
      }],
    });
    await query(
      `UPDATE worker.browser_test_suite_runs
       SET temporal_run_id = $2, temporal_status = 'RUNNING', status = 'RUNNING', started_at = CURRENT_TIMESTAMP
       WHERE browser_test_suite_run_id = $1`,
      [suiteRunId, handle.firstExecutionRunId || null],
    );
    return {
      suite,
      execution: {
        browserTestSuiteRunId: suiteRunId,
        executionId,
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId || null,
        status: 'RUNNING',
        executionMode: 'HEADLESS',
        environmentCode,
        sourceCommit,
        memberCount: preparedMembers.length,
      },
    };
  } catch (error) {
    await query(
      `UPDATE worker.browser_test_suite_runs SET temporal_status='UNKNOWN', status='FAILED', completed_at=CURRENT_TIMESTAMP,
       failure_summary=$2::jsonb WHERE browser_test_suite_run_id=$1`,
      [suiteRunId, JSON.stringify({ message: error.message || String(error) })],
    ).catch(() => {});
    throw error;
  } finally {
    await connection.close();
  }
}

async function getLedgerRow(workflowId) {
  const result = await query('SELECT * FROM worker.vw_browser_test_suite_runs WHERE temporal_workflow_id = $1 LIMIT 1', [workflowId]);
  return result.rows[0] || null;
}

async function replaceMemberRuns(suiteRunId, members = []) {
  await query('DELETE FROM worker.browser_test_suite_member_runs WHERE browser_test_suite_run_id = $1', [suiteRunId]);
  for (const member of members) {
    await query(
      `INSERT INTO worker.browser_test_suite_member_runs (
         browser_test_suite_run_id, suite_member_id, test_id, test_code, test_label, display_order,
         status, duration_ms, execution_id, artifact_root, result_summary, failure_summary
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
      [suiteRunId, member.suiteMemberId || null, member.testId, member.testCode, member.testLabel,
        Number(member.displayOrder || 999), member.status, member.durationMs ?? null, member.executionId || null,
        member.artifactRoot || null, JSON.stringify(member.result || null), JSON.stringify(member.failure || null)],
    );
  }
}

async function reconcileSuiteRun(row) {
  if (!row || (TERMINAL_STATUSES.has(String(row.status || '').toUpperCase()) && row.result_summary)) return row;
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
    const operatorStatus = result?.status || operatorStatusFromTemporal(temporalStatus);
    const startTime = description?.startTime || row.started_at || row.created_at;
    const closeTime = description?.closeTime || (TERMINAL_STATUSES.has(operatorStatus) ? new Date() : null);
    const durationMs = result?.durationMs ?? (startTime && closeTime ? Math.max(0, new Date(closeTime).getTime() - new Date(startTime).getTime()) : null);
    const failure = temporalError ? serializeTemporalFailure(temporalError) : null;
    await query(
      `UPDATE worker.browser_test_suite_runs
       SET temporal_run_id=COALESCE($2, temporal_run_id), temporal_status=$3, status=$4,
           result_summary=$5::jsonb, failure_summary=$6::jsonb,
           started_at=COALESCE(started_at,$7), completed_at=$8, duration_ms=$9
       WHERE browser_test_suite_run_id=$1`,
      [row.browser_test_suite_run_id, description?.runId || null, temporalStatus, operatorStatus,
        JSON.stringify(result || null), JSON.stringify(failure), startTime || null, closeTime || null, durationMs],
    );
    if (result?.members) await replaceMemberRuns(row.browser_test_suite_run_id, result.members);
  } catch (error) {
    if (!/not found/i.test(error.message || '')) throw error;
  } finally {
    await connection.close();
  }
  return getLedgerRow(row.temporal_workflow_id);
}

async function loadMemberRuns(suiteRunId) {
  const result = await query(
    `SELECT * FROM worker.browser_test_suite_member_runs
     WHERE browser_test_suite_run_id=$1 ORDER BY display_order, test_code`,
    [suiteRunId],
  );
  return result.rows.map((row) => ({
    suiteMemberRunId: row.suite_member_run_id,
    testId: row.test_id,
    testCode: row.test_code,
    testLabel: row.test_label,
    status: row.status,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    executionId: row.execution_id || null,
    artifactRoot: row.artifact_root || null,
    result: row.result_summary || null,
    failure: row.failure_summary || null,
  }));
}

function sanitizeRun(row, members = []) {
  return {
    browserTestSuiteRunId: row.browser_test_suite_run_id,
    executionId: row.execution_id,
    suiteId: row.suite_id,
    suiteCode: row.suite_code,
    suiteLabel: row.suite_label,
    workflowId: row.temporal_workflow_id,
    runId: row.temporal_run_id || null,
    temporalStatus: row.temporal_status || 'UNKNOWN',
    status: row.status || 'STARTED',
    triggerSource: row.trigger_source || 'MANUAL',
    initiatedBy: row.initiated_by || row.initiated_by_label || null,
    environmentCode: row.environment_code,
    executionMode: row.execution_mode || 'HEADLESS',
    stopOnFailure: row.stop_on_failure === true,
    sourceCommit: row.source_commit_sha || null,
    result: row.result_summary || null,
    failure: row.failure_summary || null,
    startTime: row.started_at || row.created_at || null,
    closeTime: row.completed_at || null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    memberCount: Number(row.member_count || members.length || 0),
    members,
  };
}

async function getSuiteRun(workflowId) {
  const id = normalizeText(workflowId);
  if (!/^skycommand-browser-suite-[A-Za-z0-9_-]+$/.test(id)) throw createHttpError(400, 'Invalid Playwright Test Suite workflowId.');
  let row = await getLedgerRow(id);
  if (!row) throw createHttpError(404, 'Playwright Test Suite run not found.');
  row = await reconcileSuiteRun(row);
  return sanitizeRun(row, await loadMemberRuns(row.browser_test_suite_run_id));
}

async function listSuiteRuns(filters = {}) {
  const values = [];
  const clauses = [];
  const search = normalizeText(filters.search || filters.q || filters.query);
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(suite_label ILIKE $${values.length} OR suite_code ILIKE $${values.length} OR temporal_workflow_id ILIKE $${values.length})`);
  }
  const status = normalizeText(filters.status).toUpperCase();
  if (status) { values.push(status); clauses.push(`status=$${values.length}`); }
  const limit = normalizeInteger(filters.limit, 100, 1, 500);
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(`SELECT * FROM worker.vw_browser_test_suite_runs ${where} ORDER BY COALESCE(started_at,created_at) DESC LIMIT $${values.length}`, values);
  const rows = [...result.rows];
  for (let i = 0; i < rows.length; i += 1) {
    if (!['STARTED','RUNNING'].includes(String(rows[i].status || '').toUpperCase())) continue;
    try { rows[i] = await reconcileSuiteRun(rows[i]); } catch (_error) { /* durable row remains visible */ }
  }
  return { items: rows.map((row) => sanitizeRun(row)), total: rows.length };
}

module.exports = {
  getSuiteByCode,
  getSuiteRun,
  listSuiteRuns,
  listSuites,
  startSuite,
};
