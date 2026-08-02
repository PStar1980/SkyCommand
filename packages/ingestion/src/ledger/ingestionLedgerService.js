const {
  classifyError,
  normalizeRunSummary,
} = require('./ingestionRunResult');

let db = null;

function getDb() {
  if (!db) {
    db = require('../../../db/src/connection');
  }
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

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedText(value, max = 4000) {
  const text = normalizeText(value);
  return text ? text.slice(0, max) : null;
}

function normalizePagination(filters = {}) {
  const requestedLimit = Number.parseInt(filters.limit, 10);
  const requestedOffset = Number.parseInt(filters.offset, 10);
  return {
    limit: Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 250) : 50,
    offset: Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0,
  };
}

async function resolveIdentity(query, { domainCode, sourceCode, toolCode = null }) {
  const normalizedDomain = normalizeCode(domainCode);
  const normalizedSource = normalizeCode(sourceCode);
  const normalizedTool = normalizeText(toolCode);

  const result = await query(
    `
      SELECT
        domain.domain_id,
        source.source_id,
        tool.tool_id,
        profile.supports_incremental,
        profile.supports_selected_assets,
        profile.supports_backfill,
        profile.supports_revisions,
        profile.supports_resume,
        profile.supports_dry_run
      FROM data.domains domain
      JOIN data.sources source
        ON source.domain_id = domain.domain_id
       AND source.source_code = $2
      LEFT JOIN core.tools tool
        ON $3::text IS NOT NULL
       AND tool.tool_code = $3
      LEFT JOIN data.ingestion_tool_profiles profile
        ON profile.tool_id = tool.tool_id
      WHERE domain.domain_code = $1
      LIMIT 1
    `,
    [normalizedDomain, normalizedSource, normalizedTool],
  );

  if (result.rows.length === 0) {
    const error = new Error(`Unknown ingestion domain/source: ${normalizedDomain}/${normalizedSource}.`);
    error.statusCode = 404;
    throw error;
  }

  const row = result.rows[0];
  if (normalizedTool && !row.tool_id) {
    const error = new Error(`Unknown ingestion tool: ${normalizedTool}.`);
    error.statusCode = 404;
    throw error;
  }

  return row;
}

async function resolveAssetIds(query, domainId, sourceId, assetCodes = []) {
  if (assetCodes.length === 0) return new Map();

  const normalized = [...new Set(assetCodes.map(normalizeCode).filter(Boolean))];
  const result = await query(
    `
      SELECT asset.asset_id, asset.asset_code
      FROM data.assets asset
      JOIN data.asset_source_bindings binding
        ON binding.asset_id = asset.asset_id
       AND binding.source_id = $2
      WHERE asset.domain_id = $1
        AND asset.asset_code = ANY($3::text[])
    `,
    [domainId, sourceId, normalized],
  );

  const map = new Map(result.rows.map((row) => [row.asset_code, row.asset_id]));
  const missing = normalized.filter((assetCode) => !map.has(assetCode));
  if (missing.length > 0) {
    const error = new Error(`Asset(s) are not bound to the ingestion source: ${missing.join(', ')}.`);
    error.statusCode = 400;
    error.details = { missingAssets: missing };
    throw error;
  }
  return map;
}

function sanitizeRun(row) {
  return {
    ingestionRunId: row.ingestion_run_id,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    toolCode: row.tool_code || null,
    toolLabel: row.tool_label || null,
    scriptExecutionId: row.script_execution_id || null,
    workflowRunRecordId: row.workflow_run_record_id || null,
    workflowNodeRunRecordId: row.workflow_node_run_record_id || null,
    resumedFromRunId: row.resumed_from_run_id || null,
    temporalWorkflowId: row.temporal_workflow_id || null,
    temporalRunId: row.temporal_run_id || null,
    modeCode: row.mode_code,
    triggerCode: row.trigger_code,
    statusCode: row.status_code,
    statusName: row.status_name,
    terminal: Boolean(row.terminal),
    successLike: Boolean(row.success_like),
    contractVersion: row.contract_version,
    selectedAssets: row.selected_assets || [],
    capabilities: row.capabilities_snapshot || {},
    requestContext: row.request_context || {},
    totals: {
      itemsRequested: number(row.items_requested),
      itemsSucceeded: number(row.items_succeeded),
      itemsFailed: number(row.items_failed),
      itemsUpdated: number(row.items_updated),
      itemsUnchanged: number(row.items_unchanged),
      rowsStaged: number(row.rows_staged),
      rowsDetectedAsNew: number(row.rows_detected_as_new),
      rowsInserted: number(row.rows_inserted),
      rowsUpdated: number(row.rows_updated),
      rowsUnchanged: number(row.rows_unchanged),
      rowsRejected: number(row.rows_rejected),
      revisionsDetected: number(row.revisions_detected),
      qualityIssueCount: number(row.quality_issue_count),
      qualityStatusCode: row.quality_status_code || 'PASS',
      attempts: number(row.attempt_count),
      retries: number(row.retry_count),
    },
    error: row.error_category_code || row.error_code || row.error_message
      ? {
          categoryCode: row.error_category_code || null,
          code: row.error_code || null,
          message: row.error_message || null,
        }
      : null,
    summary: row.summary || null,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : number(row.duration_ms),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeItem(row) {
  return {
    ingestionRunItemId: row.ingestion_run_item_id,
    ingestionRunId: row.ingestion_run_id,
    domainCode: row.domain_code,
    sourceCode: row.source_code,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    attemptNumber: number(row.attempt_number, 1),
    outcomeCode: row.outcome_code,
    outcomeName: row.outcome_name,
    successLike: Boolean(row.success_like),
    retryable: row.retryable === null || row.retryable === undefined ? null : Boolean(row.retryable),
    httpStatus: row.http_status === null || row.http_status === undefined ? null : number(row.http_status),
    sourceMinDate: row.source_min_date || null,
    sourceMaxDate: row.source_max_date || null,
    previousTargetMaxDate: row.previous_target_max_date || null,
    currentTargetMaxDate: row.current_target_max_date || null,
    rows: {
      staged: number(row.rows_staged),
      detectedAsNew: number(row.rows_detected_as_new),
      inserted: number(row.rows_inserted),
      updated: number(row.rows_updated),
      unchanged: number(row.rows_unchanged),
      rejected: number(row.rows_rejected),
      revisionsDetected: number(row.revisions_detected),
      qualityIssueCount: number(row.quality_issue_count),
    },
    qualityStatusCode: row.quality_status_code || 'PASS',
    error: row.error_category_code || row.error_code || row.error_message
      ? {
          categoryCode: row.error_category_code || null,
          code: row.error_code || null,
          message: row.error_message || null,
        }
      : null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : number(row.duration_ms),
    diagnostics: row.diagnostics || {},
    metadata: row.metadata || {},
  };
}

async function persistRunSummary(summaryInput = {}, context = {}, options = {}) {
  const summary = normalizeRunSummary(summaryInput);
  const database = getDb();
  const externalClient = options.client || null;
  const client = externalClient || await database.pool.connect();
  const query = client.query.bind(client);
  const ownsTransaction = !externalClient;

  try {
    if (ownsTransaction) await query('BEGIN');

    const identity = await resolveIdentity(query, {
      domainCode: summary.domainCode,
      sourceCode: summary.sourceCode,
      toolCode: context.toolCode,
    });
    const assetMap = await resolveAssetIds(
      query,
      identity.domain_id,
      identity.source_id,
      summary.items.map((item) => item.assetCode),
    );

    const capabilitySnapshot = context.capabilities || {
      incremental: Boolean(identity.supports_incremental),
      selectedAssets: Boolean(identity.supports_selected_assets),
      backfill: Boolean(identity.supports_backfill),
      revisions: Boolean(identity.supports_revisions),
      resume: Boolean(identity.supports_resume),
      dryRun: Boolean(identity.supports_dry_run),
    };
    const totals = context.runTotalsOverride && typeof context.runTotalsOverride === 'object'
      ? {
          ...summary.totals,
          ...context.runTotalsOverride,
        }
      : summary.totals;

    const runError = summary.error || null;
    const runErrorCategory = runError
      ? normalizeCode(context.errorCategoryCode || classifyError(runError)) || 'UNKNOWN'
      : null;

    const runResult = await query(
      `
        INSERT INTO data.ingestion_runs (
          domain_id, source_id, tool_id, script_execution_id,
          workflow_run_record_id, workflow_node_run_record_id,
          resumed_from_run_id, temporal_workflow_id, temporal_run_id,
          mode_code, trigger_code, status_code, contract_version,
          selected_assets, capabilities_snapshot, request_context,
          items_requested, items_succeeded, items_failed, items_updated, items_unchanged,
          rows_staged, rows_detected_as_new, rows_inserted, rows_updated, rows_unchanged, rows_rejected,
          revisions_detected, quality_issue_count, quality_status_code,
          attempt_count, retry_count,
          error_category_code, error_code, error_message, summary,
          started_at, completed_at, duration_ms, metadata
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6,
          $7, $8, $9,
          $10, $11, $12, 'ingestion_run_summary.v1',
          $13::jsonb, $14::jsonb, $15::jsonb,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26,
          $27, $28, $29,
          $30, $31,
          $32, $33, $34, $35,
          $36, $37, $38, $39::jsonb
        )
        RETURNING ingestion_run_id
      `,
      [
        identity.domain_id,
        identity.source_id,
        identity.tool_id || null,
        context.scriptExecutionId || null,
        context.workflowRunRecordId || null,
        context.workflowNodeRunRecordId || null,
        context.resumedFromRunId || null,
        context.temporalWorkflowId || null,
        context.temporalRunId || null,
        normalizeCode(summary.modeCode) || 'INCREMENTAL',
        normalizeCode(summary.triggerCode || context.triggerCode) || 'UNKNOWN',
        summary.outcome,
        JSON.stringify(summary.selectedAssets || []),
        JSON.stringify(safeJsonObject(capabilitySnapshot)),
        JSON.stringify(safeJsonObject(context.requestContext)),
        totals.itemsRequested,
        totals.itemsSucceeded,
        totals.itemsFailed,
        totals.itemsUpdated,
        totals.itemsUnchanged,
        totals.rowsStaged,
        totals.rowsDetectedAsNew,
        totals.rowsInserted,
        totals.rowsUpdated,
        totals.rowsUnchanged,
        totals.rowsRejected,
        totals.revisionsDetected || 0,
        totals.qualityIssueCount || 0,
        totals.qualityStatusCode || 'PASS',
        totals.attempts,
        totals.retries,
        runErrorCategory,
        boundedText(runError?.code, 250),
        boundedText(runError?.message),
        boundedText(context.summary || `Ingestion run ${summary.outcome.toLowerCase()}.`, 2000),
        summary.startedAt,
        summary.completedAt,
        summary.durationMs,
        JSON.stringify({ ...safeJsonObject(summary.metadata), ...safeJsonObject(context.metadata) }),
      ],
    );

    const ingestionRunId = runResult.rows[0].ingestion_run_id;

    for (const item of summary.items) {
      const assetId = assetMap.get(item.assetCode);
      const itemResult = await query(
        `
          INSERT INTO data.ingestion_run_items (
            ingestion_run_id, asset_id, attempt_number, outcome_code,
            retryable, http_status,
            source_min_date, source_max_date, previous_target_max_date, current_target_max_date,
            rows_staged, rows_detected_as_new, rows_inserted, rows_updated, rows_unchanged, rows_rejected,
            revisions_detected, quality_issue_count, quality_status_code,
            error_category_code, error_code, error_message,
            started_at, completed_at, duration_ms, diagnostics, metadata
          )
          VALUES (
            $1, $2, $3, $4,
            $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16,
            $17, $18, $19,
            $20, $21, $22,
            $23, $24, $25, $26::jsonb, $27::jsonb
          )
          RETURNING ingestion_run_item_id
        `,
        [
          ingestionRunId,
          assetId,
          item.attemptNumber,
          item.outcome,
          item.retryable,
          item.httpStatus,
          item.sourceMinDate,
          item.sourceMaxDate,
          item.previousTargetMaxDate,
          item.currentTargetMaxDate,
          item.rowsStaged,
          item.rowsDetectedAsNew,
          item.rowsInserted,
          item.rowsUpdated,
          item.rowsUnchanged,
          item.rowsRejected,
          item.revisionsDetected || 0,
          item.qualityIssueCount || 0,
          item.qualityStatusCode || 'PASS',
          item.errorCategoryCode,
          boundedText(item.errorCode, 250),
          boundedText(item.errorMessage),
          item.startedAt,
          item.completedAt,
          item.durationMs,
          JSON.stringify(safeJsonObject(item.diagnostics)),
          JSON.stringify(safeJsonObject(item.metadata)),
        ],
      );

      const ingestionRunItemId = itemResult.rows[0].ingestion_run_item_id;

      for (const event of item.revisionEvents || []) {
        await query(
          `
            INSERT INTO data.ingestion_revision_events (
              ingestion_run_id, ingestion_run_item_id, asset_id,
              observation_key, observation_date, old_value, new_value, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
            ON CONFLICT (ingestion_run_item_id, observation_key) DO NOTHING
          `,
          [
            ingestionRunId,
            ingestionRunItemId,
            assetId,
            boundedText(event.observationKey || event.observationDate, 1000),
            event.observationDate || null,
            JSON.stringify(event.oldValue ?? null),
            JSON.stringify(event.newValue ?? null),
            JSON.stringify(safeJsonObject(event.metadata)),
          ],
        );
      }

      for (const issue of item.qualityIssues || []) {
        await query(
          `
            INSERT INTO data.ingestion_quality_events (
              ingestion_run_id, ingestion_run_item_id, asset_id,
              check_code, severity_code, blocking,
              observation_key, source_row_number, message, evidence
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
          `,
          [
            ingestionRunId,
            ingestionRunItemId,
            assetId,
            normalizeCode(issue.checkCode) || 'TRANSFORMATION_FAILED',
            normalizeCode(issue.severityCode) || 'ERROR',
            Boolean(issue.blocking),
            boundedText(issue.observationKey, 1000),
            issue.sourceRowNumber || null,
            boundedText(issue.message || 'Ingestion quality finding.'),
            JSON.stringify(safeJsonObject(issue.evidence)),
          ],
        );
      }

      for (const rejection of item.rejectionEvents || []) {
        await query(
          `
            INSERT INTO data.ingestion_rejection_events (
              ingestion_run_id, ingestion_run_item_id, asset_id,
              check_code, severity_code, source_row_number, observation_key,
              raw_payload, normalized_payload, message, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb)
          `,
          [
            ingestionRunId,
            ingestionRunItemId,
            assetId,
            normalizeCode(rejection.checkCode) || 'TRANSFORMATION_FAILED',
            normalizeCode(rejection.severityCode) || 'ERROR',
            rejection.sourceRowNumber || null,
            boundedText(rejection.observationKey, 1000),
            JSON.stringify(safeJsonObject(rejection.rawPayload)),
            JSON.stringify(safeJsonObject(rejection.normalizedPayload)),
            boundedText(rejection.message || 'Source row rejected.'),
            JSON.stringify(safeJsonObject(rejection.metadata)),
          ],
        );
      }
    }

    if (ownsTransaction) await query('COMMIT');
    return getRun(ingestionRunId, { query });
  } catch (error) {
    if (ownsTransaction) await query('ROLLBACK');
    throw error;
  } finally {
    if (!externalClient) client.release();
  }
}

async function listRuns(filters = {}, options = {}) {
  const query = options.query || getDb().query;
  const { limit, offset } = normalizePagination(filters);
  const values = [];
  const clauses = [];

  const mappings = [
    ['domainCode', 'domain_code'],
    ['sourceCode', 'source_code'],
    ['statusCode', 'status_code'],
    ['toolCode', 'tool_code'],
    ['workflowRunRecordId', 'workflow_run_record_id'],
    ['scriptExecutionId', 'script_execution_id'],
  ];
  for (const [key, column] of mappings) {
    const value = normalizeText(filters[key]);
    if (!value) continue;
    values.push(['domainCode', 'sourceCode', 'statusCode'].includes(key) ? normalizeCode(value) : value);
    clauses.push(`run.${column} = $${values.length}`);
  }

  const searchText = normalizeText(filters.q || filters.search);
  if (searchText) {
    values.push(`%${searchText}%`);
    const searchParam = `$${values.length}`;
    clauses.push(`(
      run.domain_code ILIKE ${searchParam}
      OR run.domain_name ILIKE ${searchParam}
      OR run.source_code ILIKE ${searchParam}
      OR run.source_name ILIKE ${searchParam}
      OR run.tool_code ILIKE ${searchParam}
      OR run.tool_label ILIKE ${searchParam}
      OR run.status_code ILIKE ${searchParam}
      OR run.summary ILIKE ${searchParam}
      OR run.ingestion_run_id::text ILIKE ${searchParam}
      OR run.script_execution_id::text ILIKE ${searchParam}
      OR run.workflow_run_record_id::text ILIKE ${searchParam}
      OR run.temporal_workflow_id ILIKE ${searchParam}
      OR run.selected_assets::text ILIKE ${searchParam}
      OR EXISTS (
        SELECT 1
        FROM data.vw_ingestion_run_items item
        WHERE item.ingestion_run_id = run.ingestion_run_id
          AND (
            item.asset_code ILIKE ${searchParam}
            OR item.asset_name ILIKE ${searchParam}
            OR COALESCE(item.error_code, '') ILIKE ${searchParam}
            OR COALESCE(item.error_message, '') ILIKE ${searchParam}
          )
      )
    )`);
  }

  values.push(limit);
  const limitParam = `$${values.length}`;
  values.push(offset);
  const offsetParam = `$${values.length}`;
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM data.vw_ingestion_runs run ${where}`,
    values.slice(0, -2),
  );
  const rowsResult = await query(
    `SELECT run.* FROM data.vw_ingestion_runs run ${where} ORDER BY run.started_at DESC, run.ingestion_run_id DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
    values,
  );

  return {
    contractVersion: 'ingestion_run_summary.v1',
    total: number(countResult.rows[0]?.total),
    limit,
    offset,
    items: rowsResult.rows.map(sanitizeRun),
  };
}

async function getRun(ingestionRunId, options = {}) {
  const query = options.query || getDb().query;
  const runResult = await query(
    `SELECT * FROM data.vw_ingestion_runs WHERE ingestion_run_id = $1`,
    [ingestionRunId],
  );
  if (runResult.rows.length === 0) return null;

  // A caller may provide a query function bound to one checked-out pg Client.
  // node-postgres does not support overlapping queries on that client and emits
  // a deprecation warning that becomes an error in pg 9. Keep this detail read
  // deliberately sequential so the same service is safe for pool.query and for
  // transaction/client-bound execution paths.
  const itemResult = await query(
    `
      SELECT *
      FROM data.vw_ingestion_run_items
      WHERE ingestion_run_id = $1
      ORDER BY asset_code, attempt_number, created_at
    `,
    [ingestionRunId],
  );
  const revisionResult = await query(
    `
      SELECT *
      FROM data.vw_ingestion_revision_events
      WHERE ingestion_run_id = $1
      ORDER BY asset_code, observation_key, created_at
    `,
    [ingestionRunId],
  );
  const qualityResult = await query(
    `
      SELECT *
      FROM data.vw_ingestion_quality_events
      WHERE ingestion_run_id = $1
      ORDER BY asset_code, created_at
    `,
    [ingestionRunId],
  );
  const rejectionResult = await query(
    `
      SELECT *
      FROM data.vw_ingestion_rejection_events
      WHERE ingestion_run_id = $1
      ORDER BY asset_code, source_row_number, created_at
    `,
    [ingestionRunId],
  );

  return {
    contractVersion: 'ingestion_run_summary.v1',
    run: sanitizeRun(runResult.rows[0]),
    items: itemResult.rows.map(sanitizeItem),
    revisionEvents: revisionResult.rows,
    qualityEvents: qualityResult.rows,
    rejectionEvents: rejectionResult.rows,
  };
}

module.exports = {
  getRun,
  listRuns,
  persistRunSummary,
  resolveAssetIds,
  resolveIdentity,
  sanitizeItem,
  sanitizeRun,
};
