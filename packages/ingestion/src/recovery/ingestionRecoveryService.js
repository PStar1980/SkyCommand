const { fromAdapterBatchResult } = require('../ledger/ingestionRunResult');
const { persistRunSummary } = require('../ledger/ingestionLedgerService');
const { runSourceAdapter, validateSourceAdapter } = require('../core/sourceAdapter');
const { validateAdapterProfileAlignment } = require('../core/sourceAdapterRegistry');

let db = null;

function getDb() {
  if (!db) db = require('../../../db/src/connection');
  return db;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCode(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function normalizeAssetCodes(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.flatMap((value) => String(value || '').split(/[\s,]+/))
    .map(normalizeCode)
    .filter(Boolean))];
}

function boundedText(value, max = 4000) {
  const text = normalizeText(value);
  return text ? text.slice(0, max) : null;
}

function recoveryError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function deriveRecoverySelection({ latestItems = [], failedOnly = true, assets = [] } = {}) {
  const failedAssets = latestItems
    .filter((item) => !item.successLike && ['FAILED', 'REJECTED', 'CANCELLED'].includes(item.outcomeCode))
    .map((item) => normalizeCode(item.assetCode))
    .filter(Boolean);
  const failedSet = new Set(failedAssets);
  const explicitAssets = normalizeAssetCodes(assets);

  if (failedOnly) {
    const requestedAssets = explicitAssets.length > 0
      ? explicitAssets.filter((assetCode) => failedSet.has(assetCode))
      : failedAssets;
    const invalidAssets = explicitAssets.filter((assetCode) => !failedSet.has(assetCode));
    if (invalidAssets.length > 0) {
      throw recoveryError(
        'INGESTION_RECOVERY_ASSET_NOT_FAILED',
        `FAILED_ONLY recovery can contain only failed assets: ${invalidAssets.join(', ')}.`,
        400,
        { invalidAssets, failedAssets },
      );
    }
    if (requestedAssets.length === 0) {
      throw recoveryError(
        'INGESTION_RECOVERY_NOT_REQUIRED',
        'The selected run has no failed assets eligible for recovery.',
        409,
        { failedAssets },
      );
    }
    return {
      selectionCode: 'FAILED_ONLY',
      failedAssets,
      requestedAssets,
    };
  }

  if (explicitAssets.length === 0) {
    throw recoveryError(
      'INGESTION_RECOVERY_ASSETS_REQUIRED',
      'Explicit-asset recovery requires at least one asset code.',
    );
  }

  return {
    selectionCode: 'EXPLICIT_ASSETS',
    failedAssets,
    requestedAssets: explicitAssets,
  };
}

function sanitizeRecoveryRequest(row = {}) {
  return {
    recoveryRequestId: row.recovery_request_id,
    originalRunId: row.original_run_id,
    recoveryRunId: row.recovery_run_id || null,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    toolCode: row.tool_code || null,
    toolLabel: row.tool_label || null,
    adapterCode: row.adapter_code || null,
    supportsSelectedAssets: Boolean(row.supports_selected_assets),
    supportsResume: Boolean(row.supports_resume),
    selectionCode: row.selection_code,
    modeCode: row.mode_code,
    triggerCode: row.trigger_code,
    requestedAssets: row.requested_assets || [],
    failedAssetsSnapshot: row.failed_assets_snapshot || [],
    forceRefresh: Boolean(row.force_refresh),
    dryRun: Boolean(row.dry_run),
    statusCode: row.status_code,
    statusName: row.status_name,
    terminal: Boolean(row.terminal),
    requestContext: row.request_context || {},
    error: row.error_code || row.error_message
      ? { code: row.error_code || null, message: row.error_message || null }
      : null,
    requestedAt: row.requested_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOriginalRunEvidence(originalRunId, options = {}) {
  const runId = normalizeUuid(originalRunId);
  if (!runId) throw recoveryError('INGESTION_RECOVERY_RUN_ID_INVALID', 'A valid original run ID is required.');
  const query = options.query || getDb().query;

  const runResult = await query(
    `
      SELECT
        run.ingestion_run_id,
        run.domain_id,
        run.source_id,
        run.tool_id,
        run.status_code,
        run.mode_code,
        run.selected_assets,
        domain.domain_code,
        source.source_code,
        tool.tool_code,
        profile.adapter_code,
        profile.contract_version,
        profile.supports_incremental,
        profile.supports_selected_assets,
        profile.supports_backfill,
        profile.supports_revisions,
        profile.supports_resume,
        profile.supports_dry_run,
        profile.active AS profile_active
      FROM data.ingestion_runs run
      JOIN data.domains domain ON domain.domain_id = run.domain_id
      JOIN data.sources source ON source.source_id = run.source_id
      LEFT JOIN core.tools tool ON tool.tool_id = run.tool_id
      LEFT JOIN data.ingestion_tool_profiles profile ON profile.tool_id = run.tool_id
      WHERE run.ingestion_run_id = $1
      LIMIT 1
    `,
    [runId],
  );

  if (runResult.rows.length === 0) {
    throw recoveryError('INGESTION_RECOVERY_RUN_NOT_FOUND', `Ingestion run ${runId} was not found.`, 404);
  }

  const run = runResult.rows[0];
  const latestResult = await query(
    `
      WITH ranked AS (
        SELECT
          item.asset_id,
          asset.asset_code,
          item.outcome_code,
          outcome.success_like,
          item.attempt_number,
          item.error_category_code,
          item.error_code,
          item.error_message,
          ROW_NUMBER() OVER (
            PARTITION BY item.asset_id
            ORDER BY item.attempt_number DESC, item.created_at DESC, item.ingestion_run_item_id DESC
          ) AS rank_number
        FROM data.ingestion_run_items item
        JOIN data.assets asset ON asset.asset_id = item.asset_id
        JOIN data.ingestion_item_outcome_codes outcome ON outcome.outcome_code = item.outcome_code
        WHERE item.ingestion_run_id = $1
      )
      SELECT *
      FROM ranked
      WHERE rank_number = 1
      ORDER BY asset_code
    `,
    [runId],
  );

  return {
    run: {
      originalRunId: run.ingestion_run_id,
      domainId: run.domain_id,
      sourceId: run.source_id,
      toolId: run.tool_id,
      statusCode: run.status_code,
      modeCode: run.mode_code,
      selectedAssets: run.selected_assets || [],
      domainCode: run.domain_code,
      sourceCode: run.source_code,
      toolCode: run.tool_code,
      adapterCode: run.adapter_code,
      contractVersion: run.contract_version,
      profileActive: Boolean(run.profile_active),
      capabilities: {
        incremental: Boolean(run.supports_incremental),
        selectedAssets: Boolean(run.supports_selected_assets),
        backfill: Boolean(run.supports_backfill),
        revisions: Boolean(run.supports_revisions),
        resume: Boolean(run.supports_resume),
        dryRun: Boolean(run.supports_dry_run),
      },
    },
    latestItems: latestResult.rows.map((row) => ({
      assetCode: row.asset_code,
      outcomeCode: row.outcome_code,
      successLike: Boolean(row.success_like),
      attemptNumber: Number(row.attempt_number || 1),
      errorCategoryCode: row.error_category_code || null,
      errorCode: row.error_code || null,
      errorMessage: row.error_message || null,
    })),
  };
}

function validateRecoveryCapability(evidence, options = {}) {
  const { run } = evidence;
  if (!['PARTIAL', 'FAILED', 'CANCELLED'].includes(run.statusCode)) {
    throw recoveryError(
      'INGESTION_RECOVERY_RUN_NOT_ELIGIBLE',
      `Run ${run.originalRunId} has status ${run.statusCode} and is not eligible for recovery.`,
      409,
    );
  }
  if (!run.toolId || !run.toolCode || !run.adapterCode || !run.profileActive) {
    throw recoveryError(
      'INGESTION_RECOVERY_PROFILE_UNAVAILABLE',
      'The original run does not resolve to an active ingestion tool profile.',
      409,
    );
  }
  if (!run.capabilities.resume || !run.capabilities.selectedAssets) {
    throw recoveryError(
      'INGESTION_RECOVERY_NOT_SUPPORTED',
      `Tool ${run.toolCode} must support resume and selected assets before recovery can be planned.`,
      409,
      { capabilities: run.capabilities },
    );
  }
  if (options.dryRun && !run.capabilities.dryRun) {
    throw recoveryError(
      'INGESTION_RECOVERY_DRY_RUN_NOT_SUPPORTED',
      `Tool ${run.toolCode} does not support dry-run recovery.`,
      409,
    );
  }
  const mode = normalizeCode(options.modeCode || 'INCREMENTAL');
  if (mode === 'BACKFILL' && !run.capabilities.backfill) {
    throw recoveryError(
      'INGESTION_RECOVERY_BACKFILL_NOT_SUPPORTED',
      `Tool ${run.toolCode} does not support backfill recovery.`,
      409,
    );
  }
}

async function createRecoveryRequest(input = {}, options = {}) {
  const database = getDb();
  const externalClient = options.client || null;
  const client = externalClient || await database.pool.connect();
  const query = client.query.bind(client);
  const ownsTransaction = !externalClient;

  try {
    if (ownsTransaction) await query('BEGIN');
    const evidence = await getOriginalRunEvidence(input.originalRunId, { query });
    validateRecoveryCapability(evidence, input);
    const selection = deriveRecoverySelection({
      latestItems: evidence.latestItems,
      failedOnly: input.failedOnly !== false,
      assets: input.assets || [],
    });
    const modeCode = normalizeCode(input.modeCode || 'INCREMENTAL');
    if (!['INCREMENTAL', 'BACKFILL', 'FULL'].includes(modeCode)) {
      throw recoveryError('INGESTION_RECOVERY_MODE_INVALID', `Unsupported recovery mode: ${modeCode}.`);
    }

    const result = await query(
      `
        INSERT INTO data.ingestion_recovery_requests (
          original_run_id, domain_id, source_id, tool_id,
          selection_code, mode_code, trigger_code,
          requested_assets, failed_assets_snapshot,
          force_refresh, dry_run, status_code,
          request_context, metadata
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8::jsonb, $9::jsonb,
          $10, $11, 'PLANNED',
          $12::jsonb, $13::jsonb
        )
        RETURNING recovery_request_id
      `,
      [
        evidence.run.originalRunId,
        evidence.run.domainId,
        evidence.run.sourceId,
        evidence.run.toolId,
        selection.selectionCode,
        modeCode,
        normalizeCode(input.triggerCode || 'RECOVERY'),
        JSON.stringify(selection.requestedAssets),
        JSON.stringify(selection.failedAssets),
        Boolean(input.forceRefresh),
        Boolean(input.dryRun),
        JSON.stringify(input.requestContext && typeof input.requestContext === 'object' ? input.requestContext : {}),
        JSON.stringify({
          phase: '16.7.1',
          originalStatusCode: evidence.run.statusCode,
          ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
        }),
      ],
    );

    if (ownsTransaction) await query('COMMIT');
    return getRecoveryRequest(result.rows[0].recovery_request_id, { query });
  } catch (error) {
    if (ownsTransaction) await query('ROLLBACK');
    throw error;
  } finally {
    if (!externalClient) client.release();
  }
}

async function getRecoveryRequest(recoveryRequestId, options = {}) {
  const requestId = normalizeUuid(recoveryRequestId);
  if (!requestId) throw recoveryError('INGESTION_RECOVERY_REQUEST_ID_INVALID', 'A valid recovery request ID is required.');
  const query = options.query || getDb().query;
  const result = await query(
    `SELECT * FROM data.vw_ingestion_recovery_requests WHERE recovery_request_id = $1 LIMIT 1`,
    [requestId],
  );
  return result.rows[0] ? sanitizeRecoveryRequest(result.rows[0]) : null;
}

async function updateRecoveryState(query, recoveryRequestId, statusCode, fields = {}) {
  const result = await query(
    `
      UPDATE data.ingestion_recovery_requests
      SET status_code = $2,
          recovery_run_id = COALESCE($3, recovery_run_id),
          started_at = CASE WHEN $2 = 'RUNNING' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
          completed_at = CASE WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
          error_code = $4,
          error_message = $5,
          metadata = metadata || $6::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE recovery_request_id = $1
      RETURNING recovery_request_id
    `,
    [
      recoveryRequestId,
      statusCode,
      fields.recoveryRunId || null,
      boundedText(fields.errorCode, 250),
      boundedText(fields.errorMessage),
      JSON.stringify(fields.metadata && typeof fields.metadata === 'object' ? fields.metadata : {}),
    ],
  );
  if (result.rows.length === 0) {
    throw recoveryError('INGESTION_RECOVERY_REQUEST_NOT_FOUND', `Recovery request ${recoveryRequestId} was not found.`, 404);
  }
}

async function executeRecoveryRequest({ recoveryRequestId, adapter, concurrency = 1, runId, execute } = {}, options = {}) {
  validateSourceAdapter(adapter);
  const database = getDb();
  const externalClient = options.client || null;
  const request = await getRecoveryRequest(recoveryRequestId, {
    query: externalClient ? externalClient.query.bind(externalClient) : undefined,
  });
  if (!request) throw recoveryError('INGESTION_RECOVERY_REQUEST_NOT_FOUND', 'Recovery request was not found.', 404);
  if (request.statusCode !== 'PLANNED') {
    throw recoveryError(
      'INGESTION_RECOVERY_REQUEST_NOT_PLANNED',
      `Recovery request ${request.recoveryRequestId} is ${request.statusCode}, not PLANNED.`,
      409,
    );
  }

  validateAdapterProfileAlignment(adapter, {
    toolCode: request.toolCode,
    adapterCode: request.adapterCode,
    domainCode: request.domainCode,
    sourceCode: request.sourceCode,
    contractVersion: adapter.resultContractVersion,
    supportsIncremental: adapter.capabilities.incremental,
    supportsSelectedAssets: adapter.capabilities.selectedAssets,
    supportsBackfill: adapter.capabilities.backfill,
    supportsRevisions: adapter.capabilities.revisions,
    supportsResume: adapter.capabilities.resume,
    supportsDryRun: adapter.capabilities.dryRun,
    active: true,
  });

  const stateClient = externalClient || await database.pool.connect();
  const stateQuery = stateClient.query.bind(stateClient);
  let stateTransaction = false;
  try {
    if (!externalClient) {
      await stateQuery('BEGIN');
      stateTransaction = true;
    }
    await updateRecoveryState(stateQuery, request.recoveryRequestId, 'RUNNING', {
      metadata: { executionStartedBy: 'ingestionRecoveryService' },
    });
    if (stateTransaction) {
      await stateQuery('COMMIT');
      stateTransaction = false;
    }
  } catch (error) {
    if (stateTransaction) await stateQuery('ROLLBACK');
    if (!externalClient) stateClient.release();
    throw error;
  }
  if (!externalClient) stateClient.release();

  try {
    const executeAdapter = execute || ((runtimeAdapter, runtimeOptions) => runSourceAdapter(runtimeAdapter, runtimeOptions));
    const batchResult = await executeAdapter(adapter, {
      indicators: request.requestedAssets,
      concurrency,
      runId: runId || `recovery-${request.recoveryRequestId}`,
      cleanupQuiet: true,
      recoveryRequest: request,
      forceRefresh: request.forceRefresh,
      dryRun: request.dryRun,
    });
    const summary = fromAdapterBatchResult(batchResult, {
      domainCode: request.domainCode,
      sourceCode: request.sourceCode,
      triggerCode: 'RECOVERY',
      metadata: {
        recoveryRequestId: request.recoveryRequestId,
        resumedFromRunId: request.originalRunId,
        recoverySelectionCode: request.selectionCode,
      },
    });
    summary.modeCode = request.modeCode;
    summary.selectedAssets = [...request.requestedAssets];

    const finalClient = externalClient || await database.pool.connect();
    const finalQuery = finalClient.query.bind(finalClient);
    let finalTransaction = false;
    try {
      if (!externalClient) {
        await finalQuery('BEGIN');
        finalTransaction = true;
      }
      const detail = await persistRunSummary(
        summary,
        {
          toolCode: request.toolCode,
          resumedFromRunId: request.originalRunId,
          triggerCode: 'RECOVERY',
          requestContext: {
            recoveryRequestId: request.recoveryRequestId,
            originalRunId: request.originalRunId,
            requestedAssets: request.requestedAssets,
            forceRefresh: request.forceRefresh,
            dryRun: request.dryRun,
          },
          summary: `Recovery of ${request.requestedAssets.length} asset(s) from run ${request.originalRunId}.`,
          metadata: {
            recoveryRequestId: request.recoveryRequestId,
            recoverySelectionCode: request.selectionCode,
            phase: '16.7.1',
          },
        },
        { client: finalClient },
      );
      const recoveryStatus = detail.run.statusCode === 'SUCCESS' ? 'COMPLETED' : 'FAILED';
      await updateRecoveryState(finalQuery, request.recoveryRequestId, recoveryStatus, {
        recoveryRunId: detail.run.ingestionRunId,
        errorCode: recoveryStatus === 'FAILED' ? 'INGESTION_RECOVERY_RUN_NOT_SUCCESSFUL' : null,
        errorMessage: recoveryStatus === 'FAILED'
          ? `Recovery run completed with status ${detail.run.statusCode}.`
          : null,
        metadata: { recoveryOutcome: detail.run.statusCode },
      });
      await finalQuery('SET CONSTRAINTS ALL IMMEDIATE');
      if (finalTransaction) {
        await finalQuery('COMMIT');
        finalTransaction = false;
      }
      return {
        request: await getRecoveryRequest(request.recoveryRequestId, { query: finalQuery }),
        recoveryRun: detail,
        batchResult,
      };
    } catch (error) {
      if (finalTransaction) await finalQuery('ROLLBACK');
      throw error;
    } finally {
      if (!externalClient) finalClient.release();
    }
  } catch (error) {
    const failureClient = externalClient || await database.pool.connect();
    const failureQuery = failureClient.query.bind(failureClient);
    try {
      await updateRecoveryState(failureQuery, request.recoveryRequestId, 'FAILED', {
        errorCode: error.code || 'INGESTION_RECOVERY_EXECUTION_FAILED',
        errorMessage: error.message,
      });
    } finally {
      if (!externalClient) failureClient.release();
    }
    throw error;
  }
}

module.exports = {
  createRecoveryRequest,
  deriveRecoverySelection,
  executeRecoveryRequest,
  getOriginalRunEvidence,
  getRecoveryRequest,
  normalizeAssetCodes,
  sanitizeRecoveryRequest,
  validateRecoveryCapability,
};
