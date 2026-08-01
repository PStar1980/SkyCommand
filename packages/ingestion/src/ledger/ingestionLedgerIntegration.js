const {
  fromAdapterBatchResult,
  fromMacroToolResult,
  normalizeRunSummary,
} = require('./ingestionRunResult');
const {
  getRun,
  persistRunSummary,
} = require('./ingestionLedgerService');

let db = null;

function getDb() {
  if (!db) {
    db = require('../../../db/src/connection');
  }
  return db;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCode(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function requireToolCode(value, sourceCode) {
  const toolCode = normalizeText(value);
  if (!toolCode) {
    throw new Error(
      `Ingestion ledger persistence for ${normalizeCode(sourceCode) || '(unknown source)'} requires an explicit toolCode from the ingestion profile boundary.`,
    );
  }
  return toolCode;
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return text && UUID_PATTERN.test(text) ? text : null;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedText(value, max = 500) {
  const text = normalizeText(value);
  return text ? text.slice(0, max) : null;
}

function determineTriggerCode(metadata = {}, fallback = 'CLI') {
  const launchChannel = normalizeCode(metadata.launchChannel);
  if (launchChannel === 'WORKFLOW') return 'WORKFLOW';
  if (metadata.scheduleRunId || metadata.scheduleId || metadata.scheduleCode) return 'SCHEDULE';
  if (metadata.workerLaunched) return 'WORKER';
  if (metadata.apiLaunched) return 'INTERACTIVE';
  return normalizeCode(fallback) || 'CLI';
}

async function resolveExecutionContext(executionId, options = {}) {
  const safeExecutionId = normalizeUuid(executionId);
  if (!safeExecutionId) {
    return {
      scriptExecutionId: null,
      workflowRunRecordId: null,
      workflowNodeRunRecordId: null,
      temporalWorkflowId: null,
      temporalRunId: null,
      triggerCode: 'CLI',
      requestContext: {},
    };
  }

  const query = options.query || getDb().query;
  const executionResult = await query(
    `
      SELECT execution_id, metadata, parameters
      FROM auth.script_execution_log
      WHERE execution_id = $1
      LIMIT 1
    `,
    [safeExecutionId],
  );

  if (executionResult.rows.length === 0) {
    return {
      scriptExecutionId: null,
      workflowRunRecordId: null,
      workflowNodeRunRecordId: null,
      temporalWorkflowId: null,
      temporalRunId: null,
      triggerCode: 'CLI',
      requestContext: {},
    };
  }

  const row = executionResult.rows[0];
  const metadata = row.metadata || {};
  const workflowRunRecordId = normalizeUuid(metadata.workflowRunRecordId);
  const workflowNodeRunRecordId = normalizeUuid(metadata.workflowNodeRunRecordId);
  let temporalWorkflowId = null;
  let temporalRunId = null;

  if (workflowRunRecordId) {
    const workflowResult = await query(
      `
        SELECT temporal_workflow_id, temporal_run_id
        FROM worker.workflow_run_records
        WHERE workflow_run_record_id = $1
        LIMIT 1
      `,
      [workflowRunRecordId],
    );

    temporalWorkflowId = normalizeText(workflowResult.rows[0]?.temporal_workflow_id);
    temporalRunId = normalizeText(workflowResult.rows[0]?.temporal_run_id);
  }

  return {
    scriptExecutionId: safeExecutionId,
    workflowRunRecordId,
    workflowNodeRunRecordId,
    temporalWorkflowId,
    temporalRunId,
    triggerCode: determineTriggerCode(metadata, 'CLI'),
    requestContext: {
      launchChannel: normalizeText(metadata.launchChannel),
      workflowNodeKey: normalizeText(metadata.workflowNodeKey),
      scheduleId: normalizeUuid(metadata.scheduleId),
      scheduleRunId: normalizeUuid(metadata.scheduleRunId),
      scheduleCode: normalizeText(metadata.scheduleCode),
      workerNodeId: normalizeUuid(metadata.workerNodeId),
      workerNodeName: normalizeText(metadata.workerNodeName),
      parameters: row.parameters && typeof row.parameters === 'object' ? row.parameters : {},
    },
  };
}

async function getExistingRunForExecution(executionId, options = {}) {
  const safeExecutionId = normalizeUuid(executionId);
  if (!safeExecutionId) return null;
  const query = options.query || getDb().query;
  const result = await query(
    `
      SELECT ingestion_run_id
      FROM data.ingestion_runs
      WHERE script_execution_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [safeExecutionId],
  );

  return result.rows[0]?.ingestion_run_id
    ? getRun(result.rows[0].ingestion_run_id, { query })
    : null;
}

function buildLedgerReference(detail, executionContext = {}) {
  return {
    persisted: Boolean(detail?.run?.ingestionRunId),
    ingestionRunId: detail?.run?.ingestionRunId || null,
    contractVersion: detail?.contractVersion || 'ingestion_run_summary.v1',
    scriptExecutionId: executionContext.scriptExecutionId || null,
    workflowRunRecordId: executionContext.workflowRunRecordId || null,
    workflowNodeRunRecordId: executionContext.workflowNodeRunRecordId || null,
    temporalWorkflowId: executionContext.temporalWorkflowId || null,
    temporalRunId: executionContext.temporalRunId || null,
  };
}

function buildLedgerWarning(error) {
  return {
    persisted: false,
    ingestionRunId: null,
    contractVersion: 'ingestion_run_summary.v1',
    warning: {
      code: 'INGESTION_LEDGER_PERSISTENCE_WARNING',
      message: boundedText(error?.message || String(error || 'Ledger persistence failed.')),
    },
  };
}

async function persistMacroToolResult({
  sourceCode,
  toolCode,
  toolResult,
  executionId = process.env.SKYCOMMAND_EXECUTION_ID,
  options = {},
} = {}) {
  const normalizedSourceCode = normalizeCode(sourceCode);
  const normalizedToolCode = requireToolCode(toolCode, normalizedSourceCode);
  const executionContext = await resolveExecutionContext(executionId, options);
  const existing = await getExistingRunForExecution(executionContext.scriptExecutionId, options);

  if (existing) {
    return buildLedgerReference(existing, executionContext);
  }

  const genericSummary = fromMacroToolResult(toolResult, {
    domainCode: 'MACRO',
    sourceCode: normalizedSourceCode,
    triggerCode: executionContext.triggerCode,
    metadata: {
      compatibilityContract: 'macro_ingestion_summary.v1',
      ledgerIntegration: 'phase16.4.2',
    },
  });

  const detail = await persistRunSummary(
    genericSummary,
    {
      toolCode: normalizedToolCode,
      scriptExecutionId: executionContext.scriptExecutionId,
      workflowRunRecordId: executionContext.workflowRunRecordId,
      workflowNodeRunRecordId: executionContext.workflowNodeRunRecordId,
      temporalWorkflowId: executionContext.temporalWorkflowId,
      temporalRunId: executionContext.temporalRunId,
      triggerCode: executionContext.triggerCode,
      requestContext: executionContext.requestContext,
      summary: toolResult?.message || `Ingestion run ${genericSummary.outcome.toLowerCase()}.`,
      metadata: {
        compatibilityContract: 'macro_ingestion_summary.v1',
        integrationVersion: 'phase16.4.2',
      },
    },
    options,
  );

  return buildLedgerReference(detail, executionContext);
}

async function persistMacroBatchResult({
  sourceCode,
  toolCode,
  batchResult,
  executionId = process.env.SKYCOMMAND_EXECUTION_ID,
  options = {},
} = {}) {
  const normalizedSourceCode = normalizeCode(sourceCode);
  const normalizedToolCode = requireToolCode(toolCode, normalizedSourceCode);
  const executionContext = await resolveExecutionContext(executionId, options);
  const existing = await getExistingRunForExecution(executionContext.scriptExecutionId, options);

  if (existing) {
    return buildLedgerReference(existing, executionContext);
  }

  const genericSummary = fromAdapterBatchResult(batchResult, {
    domainCode: 'MACRO',
    sourceCode: normalizedSourceCode,
    triggerCode: executionContext.triggerCode,
    metadata: {
      compatibilityContract: 'macro_ingestion_summary.v1',
      ledgerIntegration: 'phase16.5.1',
      attemptEvidence: 'source_request_retry',
    },
  });

  const detail = await persistRunSummary(
    genericSummary,
    {
      toolCode: normalizedToolCode,
      scriptExecutionId: executionContext.scriptExecutionId,
      workflowRunRecordId: executionContext.workflowRunRecordId,
      workflowNodeRunRecordId: executionContext.workflowNodeRunRecordId,
      temporalWorkflowId: executionContext.temporalWorkflowId,
      temporalRunId: executionContext.temporalRunId,
      triggerCode: executionContext.triggerCode,
      requestContext: executionContext.requestContext,
      summary: `${normalizedSourceCode} ingestion ${genericSummary.outcome.toLowerCase()}.`,
      metadata: {
        compatibilityContract: 'macro_ingestion_summary.v1',
        integrationVersion: 'phase16.5.1',
        attemptEvidence: 'source_request_retry',
      },
    },
    options,
  );

  return buildLedgerReference(detail, executionContext);
}

function mapManualTotals(batchResult = {}) {
  const summary = batchResult.summary || {};
  return {
    itemsRequested: number(summary.total),
    itemsSucceeded: number(summary.succeeded),
    itemsFailed: number(summary.failed),
    itemsUpdated: number(summary.updated),
    itemsUnchanged: number(summary.unchanged),
    rowsStaged: number(summary.rowsStaged),
    rowsDetectedAsNew: number(summary.rowsDetectedAsNew),
    rowsInserted: number(summary.rowsInserted),
    rowsUpdated: number(summary.rowsUpdated),
    rowsUnchanged: number(summary.rowsUnchanged),
    rowsRejected: number(summary.rowsRejected),
    attempts: number(summary.total),
    retries: 0,
  };
}

async function persistManualBatchResult({
  batchResult,
  toolCode,
  executionId = process.env.SKYCOMMAND_EXECUTION_ID,
  options = {},
} = {}) {
  const executionContext = await resolveExecutionContext(executionId, options);
  const existing = await getExistingRunForExecution(executionContext.scriptExecutionId, options);
  if (existing) return buildLedgerReference(existing, executionContext);

  const summary = normalizeRunSummary({
    domainCode: 'MACRO',
    sourceCode: 'MANUAL',
    modeCode: 'MANUAL',
    triggerCode: executionContext.triggerCode,
    outcome: batchResult?.summary?.failed > 0
      ? (batchResult?.summary?.succeeded > 0 ? 'PARTIAL' : 'FAILED')
      : 'SUCCESS',
    startedAt: batchResult?.startedAt,
    completedAt: batchResult?.completedAt,
    durationMs: batchResult?.startedAt && batchResult?.completedAt
      ? Math.max(0, new Date(batchResult.completedAt).getTime() - new Date(batchResult.startedAt).getTime())
      : 0,
    items: [],
    metadata: {
      evidenceGranularity: 'RUN_ONLY',
      manualJobs: Array.isArray(batchResult?.results)
        ? batchResult.results.map((item) => ({
            code: item.indicatorCode || null,
            outcome: item.outcome || null,
            error: item.error || null,
          }))
        : [],
      integrationVersion: 'phase16.4.2',
    },
  });

  const detail = await persistRunSummary(
    summary,
    {
      toolCode: requireToolCode(toolCode, 'MANUAL'),
      scriptExecutionId: executionContext.scriptExecutionId,
      workflowRunRecordId: executionContext.workflowRunRecordId,
      workflowNodeRunRecordId: executionContext.workflowNodeRunRecordId,
      temporalWorkflowId: executionContext.temporalWorkflowId,
      temporalRunId: executionContext.temporalRunId,
      triggerCode: executionContext.triggerCode,
      requestContext: executionContext.requestContext,
      runTotalsOverride: mapManualTotals(batchResult),
      summary: 'Manual ingestion run recorded with run-level evidence; manual jobs are not yet catalogue-bound assets.',
      metadata: {
        evidenceGranularity: 'RUN_ONLY',
        integrationVersion: 'phase16.4.2',
      },
    },
    options,
  );

  return buildLedgerReference(detail, executionContext);
}

async function persistMacroToolResultSafely(input = {}, logger = console.error) {
  try {
    const reference = await persistMacroToolResult(input);

    if (reference.persisted && input.refreshFreshness) {
      try {
        const { refreshFreshnessSnapshots } = require('../freshness/freshnessService');
        const refreshed = await refreshFreshnessSnapshots({
          sourceCode: normalizeCode(input.sourceCode),
          persist: true,
        });
        reference.freshnessRefresh = { ok: true, assets: refreshed.length };
      } catch (freshnessError) {
        reference.freshnessRefresh = {
          ok: false,
          assets: 0,
          warning: boundedText(freshnessError?.message || String(freshnessError)),
        };
        logger(`[Ingestion Freshness] Refresh warning: ${freshnessError?.message || String(freshnessError)}`);
      }
    }

    return reference;
  } catch (error) {
    logger(`[Ingestion Ledger] Persistence warning: ${error?.message || String(error)}`);
    return buildLedgerWarning(error);
  }
}

async function persistMacroBatchResultSafely(input = {}, logger = console.error) {
  try {
    const reference = await persistMacroBatchResult(input);

    if (reference.persisted) {
      try {
        const { refreshFreshnessSnapshots } = require('../freshness/freshnessService');
        const refreshed = await refreshFreshnessSnapshots({
          sourceCode: normalizeCode(input.sourceCode),
          persist: true,
        });
        reference.freshnessRefresh = {
          ok: true,
          assets: refreshed.length,
        };
      } catch (freshnessError) {
        reference.freshnessRefresh = {
          ok: false,
          assets: 0,
          warning: boundedText(freshnessError?.message || String(freshnessError)),
        };
        logger(`[Ingestion Freshness] Refresh warning: ${freshnessError?.message || String(freshnessError)}`);
      }
    }

    return reference;
  } catch (error) {
    logger(`[Ingestion Ledger] Persistence warning: ${error?.message || String(error)}`);
    return buildLedgerWarning(error);
  }
}

async function persistManualBatchResultSafely(input = {}, logger = console.error) {
  try {
    return await persistManualBatchResult(input);
  } catch (error) {
    logger(`[Ingestion Ledger] Manual persistence warning: ${error?.message || String(error)}`);
    return buildLedgerWarning(error);
  }
}

module.exports = {
  buildLedgerReference,
  buildLedgerWarning,
  determineTriggerCode,
  getExistingRunForExecution,
  mapManualTotals,
  normalizeUuid,
  requireToolCode,
  persistMacroBatchResult,
  persistMacroToolResult,
  persistMacroBatchResultSafely,
  persistMacroToolResultSafely,
  persistManualBatchResult,
  persistManualBatchResultSafely,
  resolveExecutionContext,
};
