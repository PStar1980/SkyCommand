const {
  getArgValue,
  getRecoveryAssets,
  getRecoveryMode,
  getResumeRunId,
  hasFlag,
} = require('../core/cliOptions');
const {
  createRecoveryRequest,
  executeRecoveryRequest,
} = require('./ingestionRecoveryService');
const {
  resolveExecutionContext,
} = require('../ledger/ingestionLedgerIntegration');

function toBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function getRecoveryCliOptions(args = []) {
  const originalRunId = getResumeRunId(args);
  if (!originalRunId) return null;

  return {
    originalRunId,
    failedOnly: !hasFlag(args, 'explicit-assets'),
    assets: getRecoveryAssets(args),
    modeCode: getRecoveryMode(args),
    forceRefresh: hasFlag(args, 'force-refresh')
      || toBoolean(getArgValue(args, 'force-refresh'))
      || args.some((value) => String(value || '').trim().toLowerCase() === 'true'),
    dryRun: hasFlag(args, 'dry-run') || toBoolean(getArgValue(args, 'dry-run')),
  };
}

function buildRecoveryLedgerReference(recovered = {}, executionContext = {}) {
  const run = recovered.recoveryRun?.run || {};
  return {
    persisted: Boolean(run.ingestionRunId),
    ingestionRunId: run.ingestionRunId || null,
    contractVersion: recovered.recoveryRun?.contractVersion || 'ingestion_run_summary.v1',
    scriptExecutionId: executionContext.scriptExecutionId || null,
    workflowRunRecordId: executionContext.workflowRunRecordId || null,
    workflowNodeRunRecordId: executionContext.workflowNodeRunRecordId || null,
    temporalWorkflowId: executionContext.temporalWorkflowId || null,
    temporalRunId: executionContext.temporalRunId || null,
    recoveryRequestId: recovered.request?.recoveryRequestId || null,
    resumedFromRunId: recovered.request?.originalRunId || run.resumedFromRunId || null,
  };
}

async function executeProductionRecovery({
  adapter,
  toolCode,
  args = [],
  concurrency = 1,
  runId,
  client,
  execute,
  executionContext,
  requestContext = {},
  refreshFreshness = true,
} = {}) {
  const recoveryOptions = getRecoveryCliOptions(args);
  if (!recoveryOptions) return null;

  const resolvedExecutionContext = executionContext || await resolveExecutionContext(
    process.env.SKYCOMMAND_EXECUTION_ID,
    client ? { query: client.query.bind(client) } : {},
  );

  const planned = await createRecoveryRequest({
    ...recoveryOptions,
    triggerCode: 'RECOVERY',
    requestContext: {
      ...requestContext,
      ...resolvedExecutionContext.requestContext,
      scriptExecutionId: resolvedExecutionContext.scriptExecutionId || null,
      workflowRunRecordId: resolvedExecutionContext.workflowRunRecordId || null,
      workflowNodeRunRecordId: resolvedExecutionContext.workflowNodeRunRecordId || null,
      temporalWorkflowId: resolvedExecutionContext.temporalWorkflowId || null,
      temporalRunId: resolvedExecutionContext.temporalRunId || null,
      toolCode,
    },
    metadata: {
      phase: '16.7.2',
      integration: 'production_recovery',
    },
  }, client ? { client } : {});

  const recovered = await executeRecoveryRequest({
    recoveryRequestId: planned.recoveryRequestId,
    adapter,
    concurrency,
    runId: runId || `recovery-${planned.recoveryRequestId}`,
    execute,
  }, {
    ...(client ? { client } : {}),
    executionContext: resolvedExecutionContext,
  });

  const ledgerReference = buildRecoveryLedgerReference(recovered, resolvedExecutionContext);
  if (ledgerReference.persisted && refreshFreshness) {
    try {
      const { refreshFreshnessSnapshots } = require('../freshness/freshnessService');
      const refreshed = await refreshFreshnessSnapshots({
        sourceCode: adapter.sourceCode,
        persist: true,
        ...(client ? { query: client.query.bind(client) } : {}),
      });
      ledgerReference.freshnessRefresh = { ok: true, assets: refreshed.length };
    } catch (error) {
      ledgerReference.freshnessRefresh = {
        ok: false,
        assets: 0,
        warning: String(error?.message || error).slice(0, 500),
      };
    }
  }

  return {
    ...recovered.batchResult,
    recoveryExecution: {
      request: recovered.request,
      run: recovered.recoveryRun?.run || null,
    },
    recoveryLedgerReference: ledgerReference,
  };
}

module.exports = {
  buildRecoveryLedgerReference,
  executeProductionRecovery,
  getRecoveryCliOptions,
};
