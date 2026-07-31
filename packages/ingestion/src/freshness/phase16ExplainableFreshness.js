#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const freshnessService = require('./freshnessService');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'db_build',
  'src',
  'migrations',
  '00080__explainable_freshness_foundation.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'db_build',
  'src',
  'seeds',
  '00081__explainable_freshness_foundation_seed.sql',
);
const AUDIT_DIRECTORY = path.join(REPOSITORY_ROOT, 'docs', 'audits', 'phase16');
const AUDIT_MARKDOWN_PATH = path.join(
  AUDIT_DIRECTORY,
  'SkyCommand_Phase_16_Explainable_Freshness_Audit.md',
);
const AUDIT_CSV_PATH = path.join(
  AUDIT_DIRECTORY,
  'SkyCommand_Phase_16_Explainable_Freshness_Audit.csv',
);

dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createPool() {
  return new Pool({
    host: requireEnv('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: requireEnv('PGDATABASE'),
    user: requireEnv('PGUSER'),
    password: requireEnv('PGPASSWORD'),
  });
}

async function applySqlFile(pool, filePath) {
  await pool.query(fs.readFileSync(filePath, 'utf8'));
  console.log(`✅ Applied ${path.relative(REPOSITORY_ROOT, filePath).replace(/\\/g, '/')}`);
}

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(items) {
  const columns = [
    'domainCode',
    'sourceCode',
    'assetCode',
    'frequencyCode',
    'reasonCode',
    'statusCode',
    'expectedLatestDate',
    'sourceLatestDate',
    'targetLatestDate',
    'targetRowCount',
    'sourceTargetGapDays',
    'lastAttemptStatus',
    'lastAttemptAt',
    'lastSuccessAt',
    'policyOriginCode',
    'releaseLagDays',
    'freshnessToleranceDays',
    'message',
  ];

  const rows = items.map((item) => ({
    domainCode: item.domainCode,
    sourceCode: item.source?.sourceCode,
    assetCode: item.assetCode,
    frequencyCode: item.frequencyCode,
    reasonCode: item.freshness.reasonCode,
    statusCode: item.freshness.statusCode,
    expectedLatestDate: item.policy.expectedLatestDate,
    sourceLatestDate: item.evidence.sourceLatestDate,
    targetLatestDate: item.evidence.targetLatestDate,
    targetRowCount: item.evidence.targetRowCount,
    sourceTargetGapDays: item.evidence.sourceTargetGapDays,
    lastAttemptStatus: item.evidence.lastAttemptStatus,
    lastAttemptAt: item.evidence.lastAttemptAt,
    lastSuccessAt: item.evidence.lastSuccessAt,
    policyOriginCode: item.policy.originCode,
    releaseLagDays: item.policy.releaseLagDays,
    freshnessToleranceDays: item.policy.freshnessToleranceDays,
    message: item.freshness.message,
  }));

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function groupCounts(items, accessor) {
  const counts = new Map();
  for (const item of items) {
    const key = accessor(item) || 'UNKNOWN';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function renderMarkdown(items, generatedAt) {
  const reasonCounts = groupCounts(items, (item) => item.freshness.reasonCode);
  const sourceCounts = groupCounts(items, (item) => item.source?.sourceCode);
  const attention = items.filter((item) => !['CURRENT', 'EXPECTED_PROVIDER_LAG'].includes(item.freshness.reasonCode));

  const lines = [
    '# SkyCommand Phase 16.3 Explainable Freshness Audit',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Purpose',
    '',
    'This audit replaces the legacy age-only stale/current interpretation with portable source, target, execution, and cadence evidence. `EXPECTED_PROVIDER_LAG` is healthy: it means a period-start date looks old under a simple age threshold but is still on schedule after period completion and publication lag are considered.',
    '',
    '## Summary',
    '',
    `- Active discoverable assets evaluated: **${items.length}**`,
    `- Assets requiring investigation: **${attention.length}**`,
    '',
    '### Freshness reasons',
    '',
    '| Reason | Assets |',
    '|---|---:|',
    ...reasonCounts.map(([reason, count]) => `| ${reason} | ${count} |`),
    '',
    '### Sources',
    '',
    '| Source | Assets |',
    '|---|---:|',
    ...sourceCounts.map(([source, count]) => `| ${source} | ${count} |`),
    '',
    '## Assets requiring investigation',
    '',
    '| Source | Asset | Frequency | Reason | Expected | Source latest | Target latest | Last attempt |',
    '|---|---|---|---|---|---|---|---|',
    ...attention.map((item) =>
      `| ${item.source?.sourceCode || '—'} | ${item.assetCode} | ${item.frequencyCode || '—'} | ${item.freshness.reasonCode} | ${item.policy.expectedLatestDate || '—'} | ${item.evidence.sourceLatestDate || '—'} | ${item.evidence.targetLatestDate || '—'} | ${item.evidence.lastAttemptStatus || '—'} |`,
    ),
    '',
    '## Interpretation rule',
    '',
    '- `CURRENT`: target meets the expected observation date.',
    '- `EXPECTED_PROVIDER_LAG`: healthy; the stored period-start date is old but the next period is not yet due under policy.',
    '- `SOURCE_NOT_UPDATED`: the ingestion ran successfully, target matches source evidence, but the provider itself is behind the expected observation date.',
    '- `LOAD_BEHIND_SOURCE`: source contains newer data than target; this is a load/pipeline problem.',
    '- `INGESTION_FAILED`: the latest attempt failed while data remains behind.',
    '- `INGESTION_NOT_RUN`: data is behind and no attempt evidence exists.',
    '- `CONFIGURATION_ERROR`, `NO_DATA`, `DISCONTINUED`, and `UNKNOWN` are explicit rather than being collapsed into generic staleness.',
    '',
    '## Compatibility note',
    '',
    'This snapshot seam does not replace the Phase 16.4 durable ingestion ledger. It is a read-optimized freshness view built from the portable catalogue, storage statistics, and existing execution evidence.',
    '',
  ];
  return lines.join('\n');
}

async function writeAuditEvidence(pool) {
  const payload = await freshnessService.listFreshness(
    { active: true, limit: 500 },
    { query: pool.query.bind(pool) },
  );
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(AUDIT_DIRECTORY, { recursive: true });
  fs.writeFileSync(AUDIT_CSV_PATH, renderCsv(payload.items));
  fs.writeFileSync(AUDIT_MARKDOWN_PATH, renderMarkdown(payload.items, generatedAt));
  return payload.items;
}

async function refresh(pool) {
  const rows = await freshnessService.refreshFreshnessSnapshots({
    query: pool.query.bind(pool),
    persist: true,
  });
  console.log(`✅ Refreshed explainable freshness for ${rows.length} active discoverable asset(s).`);
  const items = await writeAuditEvidence(pool);
  console.log(`✅ Wrote ${path.relative(REPOSITORY_ROOT, AUDIT_MARKDOWN_PATH).replace(/\\/g, '/')}`);
  console.log(`✅ Wrote ${path.relative(REPOSITORY_ROOT, AUDIT_CSV_PATH).replace(/\\/g, '/')}`);
  return items;
}

async function verify(pool) {
  const [summaryResult, policyResult, sourceEvidenceResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS active_macro_assets,
        COUNT(*) FILTER (WHERE refreshed_at IS NOT NULL)::int AS refreshed_assets,
        COUNT(*) FILTER (WHERE freshness_reason_code IS NULL)::int AS missing_reason,
        COUNT(*) FILTER (WHERE freshness_reason_code = 'EXPECTED_PROVIDER_LAG')::int AS expected_provider_lag,
        COUNT(*) FILTER (WHERE freshness_reason_code = 'SOURCE_NOT_UPDATED')::int AS source_not_updated,
        COUNT(*) FILTER (WHERE freshness_reason_code = 'LOAD_BEHIND_SOURCE')::int AS load_behind_source,
        COUNT(*) FILTER (WHERE freshness_reason_code = 'INGESTION_FAILED')::int AS ingestion_failed,
        COUNT(*) FILTER (WHERE freshness_reason_code = 'CONFIGURATION_ERROR')::int AS configuration_error,
        COUNT(*) FILTER (WHERE freshness_reason_code = 'NO_DATA')::int AS no_data
      FROM data.vw_asset_freshness
      WHERE domain_code = 'MACRO'
        AND asset_active = TRUE
        AND discoverable = TRUE
    `),
    pool.query(`
      SELECT frequency_code, period_unit_code, period_length, release_lag_days, freshness_tolerance_days
      FROM data.freshness_frequency_policies
      WHERE active = TRUE
      ORDER BY frequency_code
    `),
    pool.query(`
      SELECT COUNT(*)::int AS source_evidence_count
      FROM data.vw_asset_freshness
      WHERE domain_code = 'MACRO'
        AND asset_active = TRUE
        AND discoverable = TRUE
        AND source_latest_date IS NOT NULL
    `),
  ]);

  const summary = summaryResult.rows[0] || {};
  console.log('\nSkyCommand Phase 16.3.1 explainable freshness foundation');
  console.log('-------------------------------------------------------');
  console.log(`Active macro assets: ${summary.active_macro_assets || 0}`);
  console.log(`Refreshed snapshots: ${summary.refreshed_assets || 0}`);
  console.log(`Source-evidence assets: ${sourceEvidenceResult.rows[0]?.source_evidence_count || 0}`);
  console.log(`Cadence policies: ${policyResult.rows.length}`);
  console.log(`Expected provider lag: ${summary.expected_provider_lag || 0}`);
  console.log(`Source not updated: ${summary.source_not_updated || 0}`);
  console.log(`Load behind source: ${summary.load_behind_source || 0}`);
  console.log(`Ingestion failed: ${summary.ingestion_failed || 0}`);
  console.log(`Configuration errors: ${summary.configuration_error || 0}`);
  console.log(`No data: ${summary.no_data || 0}`);

  const failures = [];
  if (Number(summary.active_macro_assets || 0) !== 69) failures.push('expected 69 active macro assets');
  if (Number(summary.refreshed_assets || 0) !== 69) failures.push('expected 69 refreshed macro snapshots');
  if (Number(summary.missing_reason || 0) !== 0) failures.push('one or more macro assets lack a reason code');
  if (policyResult.rows.length < 6) failures.push('expected six portable cadence policies');

  if (failures.length > 0) {
    throw new Error(`Phase 16.3.1 freshness verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Every active macro asset has a portable, explainable freshness result.');
  return summary;
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  const pool = createPool();
  try {
    if (command === 'setup') {
      await applySqlFile(pool, MIGRATION_PATH);
      await applySqlFile(pool, SEED_PATH);
      await refresh(pool);
      await verify(pool);
      return;
    }
    if (command === 'refresh') {
      await refresh(pool);
      await verify(pool);
      return;
    }
    if (command === 'verify') {
      await verify(pool);
      return;
    }
    throw new Error('Usage: phase16ExplainableFreshness.js setup|refresh|verify');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { refresh, verify };
