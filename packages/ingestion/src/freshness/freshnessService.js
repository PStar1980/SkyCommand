let databaseQuery = null;

function getDatabaseQuery() {
  if (!databaseQuery) {
    ({ query: databaseQuery } = require('../../../db/src/connection'));
  }
  return databaseQuery;
}

const FRESHNESS_CONTRACT_VERSION = 'asset_freshness.v1';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCode(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if ([true, 'true', 't', '1', 1].includes(value)) return true;
  if ([false, 'false', 'f', '0', 0].includes(value)) return false;
  const error = new Error(`Invalid boolean value: ${value}`);
  error.statusCode = 400;
  throw error;
}

function normalizePagination(filters = {}) {
  const requestedLimit = Number.parseInt(filters.limit, 10);
  const requestedOffset = Number.parseInt(filters.offset, 10);
  return {
    limit: Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT,
    offset: Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0,
  };
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value) {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function utcDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function startOfPeriod(asOf, policy) {
  const date = toDate(asOf);
  if (!date || !policy) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  switch (policy.periodUnitCode) {
    case 'DAY':
      return utcDate(year, month, day);
    case 'WEEK': {
      const current = utcDate(year, month, day);
      const weekday = current.getUTCDay();
      const mondayOffset = (weekday + 6) % 7;
      current.setUTCDate(current.getUTCDate() - mondayOffset);
      return current;
    }
    case 'MONTH':
      return utcDate(year, month, 1);
    case 'QUARTER':
      return utcDate(year, Math.floor(month / 3) * 3, 1);
    case 'YEAR':
      return utcDate(year, 0, 1);
    default:
      return null;
  }
}

function addPeriods(dateValue, policy, count = 1) {
  const date = toDate(dateValue);
  if (!date || !policy) return null;
  const amount = Number(policy.periodLength || 1) * count;

  switch (policy.periodUnitCode) {
    case 'DAY':
      date.setUTCDate(date.getUTCDate() + amount);
      break;
    case 'WEEK':
      date.setUTCDate(date.getUTCDate() + amount * 7);
      break;
    case 'MONTH':
      date.setUTCMonth(date.getUTCMonth() + amount);
      break;
    case 'QUARTER':
      date.setUTCMonth(date.getUTCMonth() + amount * 3);
      break;
    case 'YEAR':
      date.setUTCFullYear(date.getUTCFullYear() + amount);
      break;
    default:
      return null;
  }
  return date;
}

function addDays(dateValue, days) {
  const date = toDate(dateValue);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date;
}

function subtractPeriods(dateValue, policy, count = 1) {
  return addPeriods(dateValue, policy, -count);
}

function daysBetween(older, newer) {
  const oldDate = toDate(older);
  const newDate = toDate(newer);
  if (!oldDate || !newDate) return null;
  return Math.floor((newDate.getTime() - oldDate.getTime()) / 86400000);
}

function compareDates(left, right) {
  const leftDate = toDate(left);
  const rightDate = toDate(right);
  if (!leftDate || !rightDate) return null;
  return Math.sign(leftDate.getTime() - rightDate.getTime());
}

function computeExpectedLatestDate(asOfValue, policy) {
  const asOf = toDate(asOfValue);
  if (!asOf || !policy || policy.periodUnitCode === 'EVENT') return null;

  let candidate = startOfPeriod(asOf, policy);
  if (!candidate) return null;

  // Walk backward until the represented period has completed and its configured
  // publication lag + tolerance has elapsed. The loop is deliberately bounded.
  for (let index = 0; index < 1000; index += 1) {
    const periodEnd = addPeriods(candidate, policy, 1);
    const dueDate = addDays(
      periodEnd,
      Number(policy.releaseLagDays || 0) + Number(policy.freshnessToleranceDays || 0),
    );

    if (dueDate && dueDate.getTime() <= asOf.getTime()) {
      return candidate;
    }
    candidate = subtractPeriods(candidate, policy, 1);
  }

  return null;
}

function legacyThresholdDays(frequencyCode) {
  switch (normalizeCode(frequencyCode)) {
    case 'DAILY':
      return 7;
    case 'WEEKLY':
      return 21;
    case 'MONTHLY':
      return 75;
    case 'QUARTERLY':
      return 190;
    case 'ANNUAL':
      return 550;
    default:
      return 120;
  }
}

function isLegacyHeuristicStale(targetLatestDate, frequencyCode, asOf) {
  const ageDays = daysBetween(targetLatestDate, asOf);
  return ageDays !== null && ageDays > legacyThresholdDays(frequencyCode);
}

function mapReasonToStatus(reasonCode) {
  switch (reasonCode) {
    case 'CURRENT':
    case 'EXPECTED_PROVIDER_LAG':
      return 'CURRENT';
    case 'DISCONTINUED':
      return 'INACTIVE';
    case 'INGESTION_FAILED':
    case 'LOAD_BEHIND_SOURCE':
    case 'CONFIGURATION_ERROR':
      return 'ERROR';
    case 'SOURCE_NOT_UPDATED':
    case 'INGESTION_NOT_RUN':
    case 'NO_DATA':
      return 'WARNING';
    default:
      return 'UNKNOWN';
  }
}

function evaluateFreshness({
  asset,
  policy,
  stats,
  sourceEvidence,
  asOf = new Date(),
}) {
  const expectedLatestDate = computeExpectedLatestDate(asOf, policy);
  const targetLatestDate = toDate(stats?.maxDate);
  const sourceLatestDate = toDate(sourceEvidence?.sourceLatestDate);
  const lastAttemptAt = toDate(sourceEvidence?.lastAttemptAt);
  const lastSuccessAt = toDate(sourceEvidence?.lastSuccessAt);
  const lastAttemptStatus = normalizeCode(sourceEvidence?.lastAttemptStatus);
  const publicationStatus = normalizeCode(asset?.configuration?.publicationStatus);

  let reasonCode = 'UNKNOWN';
  let message = 'Freshness evidence is incomplete.';

  if (!asset?.active) {
    reasonCode = publicationStatus === 'DISCONTINUED' ? 'DISCONTINUED' : 'UNKNOWN';
    message = publicationStatus === 'DISCONTINUED'
      ? 'Asset publication is explicitly marked discontinued.'
      : 'Asset is inactive; active-asset freshness evaluation is not applicable.';
  } else if (publicationStatus === 'DISCONTINUED') {
    reasonCode = 'DISCONTINUED';
    message = 'Asset publication is explicitly marked discontinued.';
  } else if (stats?.error || stats?.relationExists === false) {
    reasonCode = 'CONFIGURATION_ERROR';
    message = stats?.error || 'Configured target storage relation is unavailable.';
  } else if (!stats?.rowCount || !targetLatestDate) {
    reasonCode = 'NO_DATA';
    message = 'Configured target storage contains no dated observations.';
  } else if (sourceLatestDate && compareDates(sourceLatestDate, targetLatestDate) > 0) {
    reasonCode = 'LOAD_BEHIND_SOURCE';
    message = `Source evidence reaches ${dateOnly(sourceLatestDate)} while target storage reaches ${dateOnly(targetLatestDate)}.`;
  } else if (
    expectedLatestDate &&
    sourceLatestDate &&
    compareDates(sourceLatestDate, expectedLatestDate) < 0
  ) {
    const latestAttemptFailed =
      lastAttemptStatus && !['SUCCESS', 'COMPLETED'].includes(lastAttemptStatus) &&
      (!lastSuccessAt || (lastAttemptAt && lastAttemptAt.getTime() >= lastSuccessAt.getTime()));

    if (latestAttemptFailed) {
      reasonCode = 'INGESTION_FAILED';
      message = `Latest ingestion attempt failed and source evidence is behind the expected ${dateOnly(expectedLatestDate)} observation.`;
    } else {
      reasonCode = 'SOURCE_NOT_UPDATED';
      message = `Provider/source evidence reaches ${dateOnly(sourceLatestDate)}, behind the expected ${dateOnly(expectedLatestDate)} observation; target matches available source evidence.`;
    }
  } else if (expectedLatestDate && compareDates(targetLatestDate, expectedLatestDate) < 0) {
    if (!lastAttemptAt) {
      reasonCode = 'INGESTION_NOT_RUN';
      message = `Target storage is behind the expected ${dateOnly(expectedLatestDate)} observation and no ingestion-attempt evidence is available.`;
    } else if (lastAttemptStatus && !['SUCCESS', 'COMPLETED'].includes(lastAttemptStatus)) {
      reasonCode = 'INGESTION_FAILED';
      message = `Latest ingestion attempt failed while target storage remains behind the expected ${dateOnly(expectedLatestDate)} observation.`;
    } else {
      reasonCode = 'UNKNOWN';
      message = `Target storage is behind the expected ${dateOnly(expectedLatestDate)} observation but provider evidence is unavailable.`;
    }
  } else if (!policy || !expectedLatestDate) {
    reasonCode = 'UNKNOWN';
    message = 'No portable cadence policy is available for this asset.';
  } else if (isLegacyHeuristicStale(targetLatestDate, asset.frequencyCode, asOf)) {
    reasonCode = 'EXPECTED_PROVIDER_LAG';
    message = `Latest observation ${dateOnly(targetLatestDate)} is on schedule after period completion and publication lag are considered.`;
  } else {
    reasonCode = 'CURRENT';
    message = `Latest observation ${dateOnly(targetLatestDate)} meets the expected ${dateOnly(expectedLatestDate)} observation date.`;
  }

  return {
    freshnessStatusCode: mapReasonToStatus(reasonCode),
    freshnessReasonCode: reasonCode,
    message,
    expectedLatestDate: dateOnly(expectedLatestDate),
    sourceLatestDate: dateOnly(sourceLatestDate),
    targetLatestDate: dateOnly(targetLatestDate),
    sourceTargetGapDays:
      sourceLatestDate && targetLatestDate
        ? Math.max(0, daysBetween(targetLatestDate, sourceLatestDate) || 0)
        : null,
  };
}

function quoteIdentifier(identifier) {
  if (!IDENTIFIER_PATTERN.test(identifier || '')) {
    throw new Error(`Unsafe storage identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function loadAssets(query) {
  const result = await query(`
    SELECT *
    FROM data.vw_assets
    WHERE asset_active = TRUE
      AND discoverable = TRUE
    ORDER BY domain_code, asset_code
  `);

  return result.rows.map((row) => ({
    assetId: row.asset_id,
    domainCode: row.domain_code,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    assetKindCode: row.asset_kind_code,
    frequencyCode: row.frequency_code,
    releaseLagDays: row.release_lag_days === null ? null : Number(row.release_lag_days),
    freshnessToleranceDays:
      row.freshness_tolerance_days === null ? null : Number(row.freshness_tolerance_days),
    storage: {
      schemaName: row.storage_schema_name,
      relationName: row.storage_relation_name,
      dateColumn: row.storage_date_column,
      valueColumn: row.storage_value_column,
    },
    sourceId: row.source_id,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    configuration: row.asset_configuration || {},
    active: row.asset_active === true,
  }));
}

async function loadPolicies(query) {
  const [frequencyResult, sourceResult] = await Promise.all([
    query(`SELECT * FROM data.freshness_frequency_policies WHERE active = TRUE`),
    query(`SELECT * FROM data.source_freshness_policies WHERE active = TRUE`),
  ]);

  const frequencyPolicies = new Map();
  for (const row of frequencyResult.rows) {
    frequencyPolicies.set(row.frequency_code, {
      frequencyCode: row.frequency_code,
      periodUnitCode: row.period_unit_code,
      periodLength: Number(row.period_length),
      releaseLagDays: Number(row.release_lag_days),
      freshnessToleranceDays: Number(row.freshness_tolerance_days),
      configuration: row.configuration || {},
    });
  }

  const sourcePolicies = new Map();
  for (const row of sourceResult.rows) {
    sourcePolicies.set(`${row.source_id}:${row.frequency_code}`, {
      releaseLagDays:
        row.release_lag_days === null ? null : Number(row.release_lag_days),
      freshnessToleranceDays:
        row.freshness_tolerance_days === null
          ? null
          : Number(row.freshness_tolerance_days),
      configuration: row.configuration || {},
    });
  }

  return { frequencyPolicies, sourcePolicies };
}

function resolvePolicy(asset, policies) {
  const frequencyCode = normalizeCode(asset.frequencyCode) || 'OTHER';
  const base = policies.frequencyPolicies.get(frequencyCode) || policies.frequencyPolicies.get('OTHER');
  if (!base) return null;

  const sourceOverride = asset.sourceId
    ? policies.sourcePolicies.get(`${asset.sourceId}:${frequencyCode}`)
    : null;

  let policyOriginCode = 'FREQUENCY_DEFAULT';
  let releaseLagDays = base.releaseLagDays;
  let freshnessToleranceDays = base.freshnessToleranceDays;

  if (sourceOverride) {
    if (sourceOverride.releaseLagDays !== null) releaseLagDays = sourceOverride.releaseLagDays;
    if (sourceOverride.freshnessToleranceDays !== null) {
      freshnessToleranceDays = sourceOverride.freshnessToleranceDays;
    }
    policyOriginCode = 'SOURCE';
  }

  if (asset.releaseLagDays !== null || asset.freshnessToleranceDays !== null) {
    if (asset.releaseLagDays !== null) releaseLagDays = asset.releaseLagDays;
    if (asset.freshnessToleranceDays !== null) {
      freshnessToleranceDays = asset.freshnessToleranceDays;
    }
    policyOriginCode = 'ASSET';
  }

  return {
    ...base,
    frequencyCode,
    releaseLagDays,
    freshnessToleranceDays,
    policyOriginCode,
  };
}

async function loadStorageStats(assets, query) {
  const statsByAsset = new Map();
  const validAssets = [];

  for (const asset of assets) {
    const { schemaName, relationName, dateColumn } = asset.storage || {};
    if (!schemaName || !relationName || !dateColumn) {
      statsByAsset.set(asset.assetId, {
        relationExists: false,
        rowCount: 0,
        minDate: null,
        maxDate: null,
        error: 'Asset storage schema, relation, or date-column metadata is incomplete.',
      });
      continue;
    }

    try {
      quoteIdentifier(schemaName);
      quoteIdentifier(relationName);
      quoteIdentifier(dateColumn);
      validAssets.push(asset);
    } catch (error) {
      statsByAsset.set(asset.assetId, {
        relationExists: false,
        rowCount: 0,
        minDate: null,
        maxDate: null,
        error: error.message,
      });
    }
  }

  if (validAssets.length === 0) return statsByAsset;

  const existenceResult = await query(
    `
      SELECT
        fixture.asset_id,
        to_regclass(format('%I.%I', fixture.schema_name, fixture.relation_name)) IS NOT NULL
          AS relation_exists
      FROM unnest($1::uuid[], $2::text[], $3::text[])
        AS fixture(asset_id, schema_name, relation_name)
    `,
    [
      validAssets.map((asset) => asset.assetId),
      validAssets.map((asset) => asset.storage.schemaName),
      validAssets.map((asset) => asset.storage.relationName),
    ],
  );
  const relationExists = new Map(
    existenceResult.rows.map((row) => [row.asset_id, row.relation_exists === true]),
  );

  const existingAssets = [];
  for (const asset of validAssets) {
    const relationName = `${asset.storage.schemaName}.${asset.storage.relationName}`;
    if (!relationExists.get(asset.assetId)) {
      statsByAsset.set(asset.assetId, {
        relationExists: false,
        rowCount: 0,
        minDate: null,
        maxDate: null,
        error: `Configured target relation does not exist: ${relationName}`,
      });
      continue;
    }
    existingAssets.push(asset);
  }

  if (existingAssets.length === 0) return statsByAsset;

  const unionSql = existingAssets
    .map((asset) => {
      const schema = quoteIdentifier(asset.storage.schemaName);
      const relation = quoteIdentifier(asset.storage.relationName);
      const dateColumn = quoteIdentifier(asset.storage.dateColumn);
      return `
        SELECT
          '${asset.assetId}'::uuid AS asset_id,
          COUNT(*)::bigint AS row_count,
          MIN(${dateColumn})::date AS min_date,
          MAX(${dateColumn})::date AS max_date
        FROM ${schema}.${relation}
      `;
    })
    .join('\nUNION ALL\n');

  const statsResult = await query(unionSql);
  for (const row of statsResult.rows) {
    statsByAsset.set(row.asset_id, {
      relationExists: true,
      rowCount: Number(row.row_count || 0),
      minDate: dateOnly(row.min_date),
      maxDate: dateOnly(row.max_date),
      error: null,
    });
  }

  return statsByAsset;
}

function extractAssetEvidenceFromExecution(row) {
  const metadata = row.metadata || {};
  const toolResult = metadata.toolResult || metadata.tool_result || {};
  const output = toolResult.output || {};
  const candidates = [];

  if (Array.isArray(output.assets)) candidates.push(...output.assets);
  if (Array.isArray(output.indicators)) candidates.push(...output.indicators);
  if (Array.isArray(output.items)) candidates.push(...output.items);

  return candidates
    .map((item) => ({
      assetCode: normalizeCode(item.assetCode || item.indicatorCode || item.code),
      sourceLatestDate: dateOnly(
        item.sourceLatestDate || item.sourceMaxDate || item.providerMaxDate || item.stagingMaxDate,
      ),
      targetLatestDate: dateOnly(
        item.targetLatestDate || item.currentTargetMaxDate || item.targetMaxDate,
      ),
    }))
    .filter((item) => item.assetCode);
}

async function loadExecutionEvidence(query) {
  const result = await query(`
    SELECT
      tool.source_id,
      tool.source_code,
      tool.tool_code,
      execution.status,
      execution.started_at,
      execution.finished_at,
      execution.metadata
    FROM data.vw_ingestion_tools tool
    JOIN auth.vw_script_execution_recent execution
      ON execution.script_name = tool.tool_code
    WHERE tool.discoverable = TRUE
    ORDER BY execution.started_at DESC
    LIMIT 500
  `);

  const sourceAttempts = new Map();
  const sourceSuccesses = new Map();
  const assetEvidence = new Map();

  for (const row of result.rows) {
    if (!sourceAttempts.has(row.source_id)) {
      sourceAttempts.set(row.source_id, {
        lastAttemptAt: row.started_at,
        lastAttemptStatus: row.status,
      });
    }

    const executionSucceeded = String(row.status || '').toUpperCase() === 'SUCCESS';
    if (executionSucceeded && !sourceSuccesses.has(row.source_id)) {
      sourceSuccesses.set(row.source_id, row.finished_at || row.started_at);
    }

    if (executionSucceeded) {
      for (const item of extractAssetEvidenceFromExecution(row)) {
        const key = `${row.source_id}:${item.assetCode}`;
        if (!assetEvidence.has(key)) {
          assetEvidence.set(key, {
            sourceLatestDate: item.sourceLatestDate,
            targetLatestDate: item.targetLatestDate,
            evidenceExecutionAt: row.finished_at || row.started_at,
          });
        }
      }
    }
  }

  return { sourceAttempts, sourceSuccesses, assetEvidence };
}

function buildSourceEvidence(asset, executionEvidence) {
  const attempt = executionEvidence.sourceAttempts.get(asset.sourceId) || {};
  const successAt = executionEvidence.sourceSuccesses.get(asset.sourceId) || null;
  const item = executionEvidence.assetEvidence.get(`${asset.sourceId}:${asset.assetCode}`) || {};
  return {
    lastAttemptAt: attempt.lastAttemptAt || null,
    lastAttemptStatus: attempt.lastAttemptStatus || null,
    lastSuccessAt: successAt,
    sourceLatestDate: item.sourceLatestDate || null,
    executionTargetLatestDate: item.targetLatestDate || null,
    evidenceExecutionAt: item.evidenceExecutionAt || null,
  };
}

async function persistSnapshots(rows, query) {
  for (const row of rows) {
    await query(
      `
        INSERT INTO data.asset_freshness_snapshots (
          asset_id, source_id, refreshed_at, policy_frequency_code, policy_origin_code,
          release_lag_days, freshness_tolerance_days, expected_latest_date,
          source_latest_date, target_relation_exists, target_row_count, target_min_date,
          target_latest_date, source_target_gap_days, last_attempt_at, last_attempt_status,
          last_success_at, freshness_status_code, freshness_reason_code, message, evidence
        )
        VALUES (
          $1,$2,CURRENT_TIMESTAMP,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
        )
        ON CONFLICT (asset_id)
        DO UPDATE SET
          source_id = EXCLUDED.source_id,
          refreshed_at = CURRENT_TIMESTAMP,
          policy_frequency_code = EXCLUDED.policy_frequency_code,
          policy_origin_code = EXCLUDED.policy_origin_code,
          release_lag_days = EXCLUDED.release_lag_days,
          freshness_tolerance_days = EXCLUDED.freshness_tolerance_days,
          expected_latest_date = EXCLUDED.expected_latest_date,
          source_latest_date = EXCLUDED.source_latest_date,
          target_relation_exists = EXCLUDED.target_relation_exists,
          target_row_count = EXCLUDED.target_row_count,
          target_min_date = EXCLUDED.target_min_date,
          target_latest_date = EXCLUDED.target_latest_date,
          source_target_gap_days = EXCLUDED.source_target_gap_days,
          last_attempt_at = EXCLUDED.last_attempt_at,
          last_attempt_status = EXCLUDED.last_attempt_status,
          last_success_at = EXCLUDED.last_success_at,
          freshness_status_code = EXCLUDED.freshness_status_code,
          freshness_reason_code = EXCLUDED.freshness_reason_code,
          message = EXCLUDED.message,
          evidence = EXCLUDED.evidence
      `,
      [
        row.asset.assetId,
        row.asset.sourceId,
        row.policy?.frequencyCode || row.asset.frequencyCode || null,
        row.policy?.policyOriginCode || 'NONE',
        row.policy?.releaseLagDays ?? null,
        row.policy?.freshnessToleranceDays ?? null,
        row.evaluation.expectedLatestDate,
        row.evaluation.sourceLatestDate,
        row.stats.relationExists,
        row.stats.rowCount,
        row.stats.minDate,
        row.stats.maxDate,
        row.evaluation.sourceTargetGapDays,
        row.sourceEvidence.lastAttemptAt,
        row.sourceEvidence.lastAttemptStatus,
        row.sourceEvidence.lastSuccessAt,
        row.evaluation.freshnessStatusCode,
        row.evaluation.freshnessReasonCode,
        row.evaluation.message,
        JSON.stringify({
          contractVersion: FRESHNESS_CONTRACT_VERSION,
          sourceEvidenceAt: row.sourceEvidence.evidenceExecutionAt || null,
          executionTargetLatestDate: row.sourceEvidence.executionTargetLatestDate || null,
          legacyHeuristic: {
            thresholdDays: legacyThresholdDays(row.asset.frequencyCode),
            wouldBeStale: isLegacyHeuristicStale(row.stats.maxDate, row.asset.frequencyCode, row.asOf),
          },
        }),
      ],
    );
  }
}

async function refreshFreshnessSnapshots(options = {}) {
  const query = options.query || getDatabaseQuery();
  const asOf = toDate(options.asOf) || new Date();
  const [assets, policies, executionEvidence] = await Promise.all([
    loadAssets(query),
    loadPolicies(query),
    loadExecutionEvidence(query),
  ]);
  const storageStats = await loadStorageStats(assets, query);

  const rows = assets.map((asset) => {
    const policy = resolvePolicy(asset, policies);
    const stats = storageStats.get(asset.assetId) || {
      relationExists: false,
      rowCount: 0,
      minDate: null,
      maxDate: null,
      error: 'No storage evidence was produced for this asset.',
    };
    const sourceEvidence = buildSourceEvidence(asset, executionEvidence);
    const evaluation = evaluateFreshness({ asset, policy, stats, sourceEvidence, asOf });
    return { asset, policy, stats, sourceEvidence, evaluation, asOf };
  });

  if (options.persist !== false) {
    await persistSnapshots(rows, query);
  }

  return rows;
}

function sanitizeSnapshot(row) {
  return {
    contractVersion: FRESHNESS_CONTRACT_VERSION,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    assetKindCode: row.asset_kind_code,
    frequencyCode: row.frequency_code || null,
    active: row.asset_active === true,
    discoverable: row.discoverable === true,
    source: row.source_id
      ? {
          sourceId: row.source_id,
          sourceCode: row.source_code,
          sourceName: row.source_name,
          providerName: row.provider_name || null,
          providerAssetCode: row.provider_asset_code || null,
        }
      : null,
    refreshedAt: row.refreshed_at || null,
    policy: {
      frequencyCode: row.policy_frequency_code || null,
      originCode: row.policy_origin_code || null,
      releaseLagDays:
        row.release_lag_days === null || row.release_lag_days === undefined
          ? null
          : Number(row.release_lag_days),
      freshnessToleranceDays:
        row.freshness_tolerance_days === null || row.freshness_tolerance_days === undefined
          ? null
          : Number(row.freshness_tolerance_days),
      expectedLatestDate: dateOnly(row.expected_latest_date),
    },
    evidence: {
      sourceLatestDate: dateOnly(row.source_latest_date),
      targetRelationExists: row.target_relation_exists,
      targetRowCount:
        row.target_row_count === null || row.target_row_count === undefined
          ? null
          : Number(row.target_row_count),
      targetMinDate: dateOnly(row.target_min_date),
      targetLatestDate: dateOnly(row.target_latest_date),
      sourceTargetGapDays:
        row.source_target_gap_days === null || row.source_target_gap_days === undefined
          ? null
          : Number(row.source_target_gap_days),
      lastAttemptAt: row.last_attempt_at || null,
      lastAttemptStatus: row.last_attempt_status || null,
      lastSuccessAt: row.last_success_at || null,
      details: row.evidence || {},
    },
    freshness: {
      statusCode: row.freshness_status_code || 'UNKNOWN',
      statusName: row.freshness_status_name || 'Unknown',
      severityCode: row.severity_code || 'UNKNOWN',
      reasonCode: row.freshness_reason_code || 'UNKNOWN',
      reasonName: row.freshness_reason_name || 'Unknown',
      message: row.message || 'Freshness evidence has not been refreshed.',
    },
  };
}

async function listFreshness(filters = {}, options = {}) {
  const query = options.query || getDatabaseQuery();
  const values = [];
  const clauses = [];
  const domainCode = normalizeCode(filters.domainCode);
  const sourceCode = normalizeCode(filters.sourceCode || filters.source);
  const reasonCode = normalizeCode(filters.reasonCode || filters.reason);
  const statusCode = normalizeCode(filters.statusCode || filters.status);
  const active = normalizeBoolean(filters.active);
  const search = normalizeText(filters.search || filters.q);
  const { limit, offset } = normalizePagination(filters);

  if (domainCode) {
    values.push(domainCode);
    clauses.push(`domain_code = $${values.length}`);
  }
  if (sourceCode) {
    values.push(sourceCode);
    clauses.push(`source_code = $${values.length}`);
  }
  if (reasonCode) {
    values.push(reasonCode);
    clauses.push(`freshness_reason_code = $${values.length}`);
  }
  if (statusCode) {
    values.push(statusCode);
    clauses.push(`freshness_status_code = $${values.length}`);
  }
  if (active !== null) {
    values.push(active);
    clauses.push(`asset_active = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(
      asset_code ILIKE $${values.length}
      OR asset_name ILIKE $${values.length}
      OR COALESCE(source_code, '') ILIKE $${values.length}
      OR COALESCE(freshness_reason_code, '') ILIKE $${values.length}
    )`);
  }

  values.push(limit);
  const limitParam = `$${values.length}`;
  values.push(offset);
  const offsetParam = `$${values.length}`;

  const result = await query(
    `
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM data.vw_asset_freshness
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY domain_code, asset_code
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    values,
  );

  return {
    contractVersion: FRESHNESS_CONTRACT_VERSION,
    total: Number(result.rows[0]?.total_count || 0),
    limit,
    offset,
    items: result.rows.map(sanitizeSnapshot),
  };
}

async function getFreshness(domainCode, assetCode, options = {}) {
  const query = options.query || getDatabaseQuery();
  const result = await query(
    `
      SELECT *
      FROM data.vw_asset_freshness
      WHERE domain_code = $1
        AND asset_code = $2
      LIMIT 1
    `,
    [normalizeCode(domainCode), normalizeCode(assetCode)],
  );
  return result.rows[0] ? sanitizeSnapshot(result.rows[0]) : null;
}

module.exports = {
  FRESHNESS_CONTRACT_VERSION,
  addPeriods,
  computeExpectedLatestDate,
  evaluateFreshness,
  extractAssetEvidenceFromExecution,
  getFreshness,
  isLegacyHeuristicStale,
  legacyThresholdDays,
  listFreshness,
  mapReasonToStatus,
  refreshFreshnessSnapshots,
  resolvePolicy,
  startOfPeriod,
};
