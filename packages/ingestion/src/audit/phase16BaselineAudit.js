#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

dotenv.config({
  path: path.join(REPOSITORY_ROOT, '.env'),
});

const { pool, query } = require('../../../db/src/connection');

const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'docs',
  'audits',
  'phase16',
);
const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;

function parseArguments(args = process.argv.slice(2)) {
  const options = {
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    concurrency: DEFAULT_CONCURRENCY,
  };

  for (const argument of args) {
    if (argument.startsWith('--output-dir=')) {
      const suppliedPath = argument.slice('--output-dir='.length).trim();
      options.outputDirectory = path.resolve(REPOSITORY_ROOT, suppliedPath);
      continue;
    }

    if (argument.startsWith('--concurrency=')) {
      const suppliedValue = Number.parseInt(argument.slice('--concurrency='.length), 10);

      if (Number.isInteger(suppliedValue) && suppliedValue > 0) {
        options.concurrency = Math.min(suppliedValue, MAX_CONCURRENCY);
      }
    }
  }

  return options;
}

function quoteIdentifier(identifier) {
  const text = String(identifier || '');

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${text || '(blank)'}`);
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function getFreshnessThresholdDays(frequency) {
  const normalizedFrequency = String(frequency || '')
    .trim()
    .toLowerCase();

  if (normalizedFrequency.includes('daily')) {
    return 7;
  }

  if (normalizedFrequency.includes('weekly')) {
    return 21;
  }

  if (normalizedFrequency.includes('monthly')) {
    return 75;
  }

  if (normalizedFrequency.includes('quarterly')) {
    return 190;
  }

  if (normalizedFrequency.includes('annual') || normalizedFrequency.includes('yearly')) {
    return 550;
  }

  return 120;
}

function getDaysSince(dateValue, now = new Date()) {
  if (!dateValue) {
    return null;
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

function evaluateCurrentHeuristic(indicator, stats, now) {
  if (!indicator.active) {
    return {
      status: 'INACTIVE',
      reason: 'Indicator is inactive.',
    };
  }

  if (stats.error) {
    return {
      status: 'ERROR',
      reason: stats.error,
    };
  }

  if (!stats.tableExists) {
    return {
      status: 'MISSING_TABLE',
      reason: 'Indicator table does not exist.',
    };
  }

  if (!stats.totalRows || !stats.maxDate) {
    return {
      status: 'NO_DATA',
      reason: 'Indicator table exists but contains no dated observations.',
    };
  }

  const thresholdDays = getFreshnessThresholdDays(indicator.frequency);
  const daysSinceLatestData = getDaysSince(stats.maxDate, now);

  if (daysSinceLatestData !== null && daysSinceLatestData > thresholdDays) {
    return {
      status: 'STALE',
      reason: `Latest observation is ${daysSinceLatestData} day(s) old; current frequency threshold is ${thresholdDays} day(s).`,
    };
  }

  return {
    status: 'CURRENT',
    reason: 'Current according to the existing frequency-only freshness heuristic.',
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const currentIndex = index;
      index += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

async function loadDatabaseIdentity() {
  const result = await query(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      current_timestamp AS database_timestamp,
      version() AS database_version
  `);

  return result.rows[0] || {};
}

async function loadIndicators() {
  const result = await query(`
    SELECT
      indicator_code,
      source,
      description,
      frequency,
      created_at,
      active
    FROM macro.indicators
    ORDER BY source, indicator_code
  `);

  return result.rows;
}

async function loadIndicatorStats(indicatorCode) {
  try {
    const relationResult = await query(
      `SELECT to_regclass(format('%I.%I', $1::text, $2::text)) AS relation_name`,
      ['macro', indicatorCode],
    );
    const tableExists = Boolean(relationResult.rows[0]?.relation_name);

    if (!tableExists) {
      return {
        tableExists: false,
        totalRows: 0,
        minDate: null,
        maxDate: null,
      };
    }

    const relationSql = `${quoteIdentifier('macro')}.${quoteIdentifier(indicatorCode)}`;
    const statsResult = await query(`
      SELECT
        COUNT(*)::int AS total_rows,
        MIN(edate) AS min_date,
        MAX(edate) AS max_date
      FROM ${relationSql}
    `);
    const row = statsResult.rows[0] || {};

    return {
      tableExists: true,
      totalRows: Number(row.total_rows || 0),
      minDate: row.min_date || null,
      maxDate: row.max_date || null,
    };
  } catch (error) {
    return {
      tableExists: false,
      totalRows: 0,
      minDate: null,
      maxDate: null,
      error: error.message || 'Failed to inspect indicator table.',
    };
  }
}

async function buildIndicatorAuditRows(indicators, concurrency, now) {
  return mapWithConcurrency(indicators, concurrency, async (indicator) => {
    const stats = await loadIndicatorStats(indicator.indicator_code);
    const evaluation = evaluateCurrentHeuristic(indicator, stats, now);

    return {
      indicatorCode: indicator.indicator_code,
      source: indicator.source,
      description: indicator.description,
      frequency: indicator.frequency,
      active: Boolean(indicator.active),
      tableExists: stats.tableExists,
      totalRows: stats.totalRows,
      minDate: stats.minDate,
      maxDate: stats.maxDate,
      daysSinceLatestData: getDaysSince(stats.maxDate, now),
      freshnessThresholdDays: getFreshnessThresholdDays(indicator.frequency),
      currentHeuristicStatus: evaluation.status,
      currentHeuristicReason: evaluation.reason,
      inspectionError: stats.error || null,
    };
  });
}

async function loadIngestionTools() {
  const result = await query(`
    SELECT
      a.app_code,
      c.category_code,
      c.label AS category_label,
      c.enabled AS category_enabled,
      t.tool_code,
      t.label AS tool_label,
      t.script_path,
      t.runtime_code,
      t.permission_code,
      t.risk_code,
      t.output_type,
      t.enabled AS tool_enabled,
      COALESCE(
        ARRAY_AGG(DISTINCT tv.channel_code ORDER BY tv.channel_code)
          FILTER (WHERE tv.channel_code IS NOT NULL),
        ARRAY[]::text[]
      ) AS visibility_channels
    FROM core.tools t
    JOIN core.tool_categories c ON c.category_id = t.category_id
    JOIN core.applications a ON a.app_id = c.app_id
    LEFT JOIN core.tool_visibility tv ON tv.tool_id = t.tool_id
    WHERE c.category_code = 'data_ingestion_tools'
       OR t.script_path ILIKE '%ingestion%'
    GROUP BY
      a.app_code,
      c.category_code,
      c.label,
      c.enabled,
      t.tool_code,
      t.label,
      t.script_path,
      t.runtime_code,
      t.permission_code,
      t.risk_code,
      t.output_type,
      t.enabled
    ORDER BY c.category_code, t.tool_code
  `);

  return result.rows;
}

async function loadMacroViews() {
  const result = await query(`
    SELECT
      v.table_name AS view_name,
      COUNT(c.column_name)::int AS column_count
    FROM information_schema.views v
    LEFT JOIN information_schema.columns c
      ON c.table_schema = v.table_schema
     AND c.table_name = v.table_name
    WHERE v.table_schema = 'macro'
    GROUP BY v.table_name
    ORDER BY v.table_name
  `);

  return result.rows;
}

async function loadRecentIngestionExecutions() {
  try {
    const result = await query(`
      SELECT
        execution_id,
        script_name,
        script_file,
        category,
        status,
        started_at,
        finished_at,
        duration_ms,
        summary
      FROM auth.vw_script_execution_recent
      WHERE category ILIKE '%ingest%'
         OR script_name ILIKE '%ingest%'
         OR script_file ILIKE '%ingestion%'
         OR script_file ILIKE '%loadFREDMacroData.js%'
         OR script_file ILIKE '%loadBoCMacroData.js%'
         OR script_file ILIKE '%loadStatCanMacroData.js%'
      ORDER BY started_at DESC
      LIMIT 25
    `);

    return result.rows;
  } catch (error) {
    return [
      {
        inspectionError: error.message || 'Recent ingestion execution view could not be read.',
      },
    ];
  }
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = String(row[key] ?? 'UNKNOWN');
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function buildSummary(indicators) {
  const activeIndicators = indicators.filter((indicator) => indicator.active);
  const inactiveIndicators = indicators.filter((indicator) => !indicator.active);

  return {
    registeredIndicators: indicators.length,
    activeIndicators: activeIndicators.length,
    inactiveIndicators: inactiveIndicators.length,
    sourceCounts: countBy(indicators, 'source'),
    activeSourceCounts: countBy(activeIndicators, 'source'),
    statusCounts: countBy(indicators, 'currentHeuristicStatus'),
    activeStatusCounts: countBy(activeIndicators, 'currentHeuristicStatus'),
    totalObservationRows: indicators.reduce(
      (total, indicator) => total + Number(indicator.totalRows || 0),
      0,
    ),
  };
}

function normalizeDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildIndicatorCsv(indicators) {
  const columns = [
    'indicatorCode',
    'source',
    'description',
    'frequency',
    'active',
    'tableExists',
    'totalRows',
    'minDate',
    'maxDate',
    'daysSinceLatestData',
    'freshnessThresholdDays',
    'currentHeuristicStatus',
    'currentHeuristicReason',
    'inspectionError',
  ];

  const lines = [columns.join(',')];

  for (const indicator of indicators) {
    lines.push(
      columns
        .map((column) => {
          const value = ['minDate', 'maxDate'].includes(column)
            ? normalizeDate(indicator[column])
            : indicator[column];
          return escapeCsv(value);
        })
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function formatCountMap(counts = {}) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
}

function buildMarkdownReport(audit) {
  const staleOrProblemRows = audit.indicators.filter(
    (indicator) =>
      indicator.active &&
      !['CURRENT'].includes(indicator.currentHeuristicStatus),
  );

  const lines = [
    '# SkyCommand Phase 16 Baseline Audit',
    '',
    `- **Generated:** ${audit.generatedAt}`,
    `- **Database:** ${audit.database.database_name || 'Unknown'}`,
    `- **Database timestamp:** ${normalizeDate(audit.database.database_timestamp) || 'Unknown'}`,
    '- **Mode:** Read-only repository and PostgreSQL baseline inspection',
    '- **Freshness caution:** Status values below reproduce the existing frequency-only heuristic. They are evidence for Phase 16 analysis, not the final explainable-freshness contract.',
    '',
    '## Summary',
    '',
    `- Registered indicators: **${audit.summary.registeredIndicators}**`,
    `- Active indicators: **${audit.summary.activeIndicators}**`,
    `- Inactive indicators: **${audit.summary.inactiveIndicators}**`,
    `- Total observation rows: **${audit.summary.totalObservationRows}**`,
    `- Active indicators by source: ${formatCountMap(audit.summary.activeSourceCounts) || 'None'}`,
    `- Active heuristic status counts: ${formatCountMap(audit.summary.activeStatusCounts) || 'None'}`,
    `- Ingestion tools discovered by the current category/path rules: **${audit.ingestionTools.length}**`,
    `- Macro views: **${audit.macroViews.length}**`,
    '',
    '## Active indicators requiring investigation',
    '',
  ];

  if (staleOrProblemRows.length === 0) {
    lines.push('No active indicators were classified as stale, missing, empty, or errored by the current heuristic.');
  } else {
    lines.push('| Source | Indicator | Frequency | Rows | Latest observation | Age (days) | Current status |');
    lines.push('|---|---|---:|---:|---|---:|---|');

    for (const indicator of staleOrProblemRows) {
      lines.push(
        `| ${escapeMarkdown(indicator.source)} | ${escapeMarkdown(indicator.indicatorCode)} | ${escapeMarkdown(indicator.frequency)} | ${indicator.totalRows} | ${escapeMarkdown(normalizeDate(indicator.maxDate).slice(0, 10) || '—')} | ${indicator.daysSinceLatestData ?? '—'} | ${escapeMarkdown(indicator.currentHeuristicStatus)} |`,
      );
    }
  }

  lines.push('', '## Ingestion tool baseline', '');
  lines.push('| Category | Tool | Script | Output contract | Enabled | Channels |');
  lines.push('|---|---|---|---|---:|---|');

  for (const tool of audit.ingestionTools) {
    lines.push(
      `| ${escapeMarkdown(tool.category_code)} | ${escapeMarkdown(tool.tool_code)} | ${escapeMarkdown(tool.script_path)} | ${escapeMarkdown(tool.output_type || '—')} | ${tool.tool_enabled ? 'Yes' : 'No'} | ${escapeMarkdown((tool.visibility_channels || []).join(', '))} |`,
    );
  }

  lines.push('', '## Macro view compatibility baseline', '');
  lines.push('| View | Columns |');
  lines.push('|---|---:|');

  for (const view of audit.macroViews) {
    lines.push(`| ${escapeMarkdown(view.view_name)} | ${view.column_count} |`);
  }

  lines.push('', '## Full indicator inventory', '');
  lines.push('| Source | Indicator | Active | Frequency | Rows | Earliest | Latest | Age | Threshold | Status |');
  lines.push('|---|---|---:|---|---:|---|---|---:|---:|---|');

  for (const indicator of audit.indicators) {
    lines.push(
      `| ${escapeMarkdown(indicator.source)} | ${escapeMarkdown(indicator.indicatorCode)} | ${indicator.active ? 'Yes' : 'No'} | ${escapeMarkdown(indicator.frequency)} | ${indicator.totalRows} | ${escapeMarkdown(normalizeDate(indicator.minDate).slice(0, 10) || '—')} | ${escapeMarkdown(normalizeDate(indicator.maxDate).slice(0, 10) || '—')} | ${indicator.daysSinceLatestData ?? '—'} | ${indicator.freshnessThresholdDays} | ${escapeMarkdown(indicator.currentHeuristicStatus)} |`,
    );
  }

  lines.push(
    '',
    '## Next analysis step',
    '',
    'Classify each non-current active indicator as a likely provider delay, discontinued/replaced asset, ingestion failure, target-load gap, configuration issue, missing table, or no-data condition. Phase 16.3 will replace the frequency-only result with source- and asset-aware reason codes.',
    '',
  );

  return lines.join('\n');
}

function writeAuditFiles(outputDirectory, audit) {
  fs.mkdirSync(outputDirectory, { recursive: true });

  const jsonPath = path.join(outputDirectory, 'SkyCommand_Phase_16_Baseline_Audit.json');
  const csvPath = path.join(outputDirectory, 'SkyCommand_Phase_16_Indicator_Audit.csv');
  const markdownPath = path.join(outputDirectory, 'SkyCommand_Phase_16_Baseline_Audit.md');

  fs.writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  fs.writeFileSync(csvPath, buildIndicatorCsv(audit.indicators), 'utf8');
  fs.writeFileSync(markdownPath, `${buildMarkdownReport(audit)}\n`, 'utf8');

  return {
    jsonPath,
    csvPath,
    markdownPath,
  };
}

function printConsoleSummary(audit, files) {
  console.log('\nSkyCommand Phase 16 baseline audit');
  console.log('----------------------------------');
  console.log(`Database: ${audit.database.database_name || 'Unknown'}`);
  console.log(
    `Indicators: ${audit.summary.registeredIndicators} registered / ${audit.summary.activeIndicators} active`,
  );
  console.log(`Active source counts: ${formatCountMap(audit.summary.activeSourceCounts)}`);
  console.log(`Active status counts: ${formatCountMap(audit.summary.activeStatusCounts)}`);
  console.log(`Macro views: ${audit.macroViews.length}`);
  console.log(`Ingestion tools: ${audit.ingestionTools.length}`);

  const problemRows = audit.indicators.filter(
    (indicator) => indicator.active && indicator.currentHeuristicStatus !== 'CURRENT',
  );

  if (problemRows.length > 0) {
    console.log('\nActive indicators requiring investigation:');
    console.table(
      problemRows.map((indicator) => ({
        source: indicator.source,
        indicator: indicator.indicatorCode,
        frequency: indicator.frequency,
        rows: indicator.totalRows,
        latest: normalizeDate(indicator.maxDate).slice(0, 10) || null,
        ageDays: indicator.daysSinceLatestData,
        thresholdDays: indicator.freshnessThresholdDays,
        status: indicator.currentHeuristicStatus,
      })),
    );
  }

  console.log('\nGenerated evidence:');
  console.log(`- ${path.relative(REPOSITORY_ROOT, files.markdownPath)}`);
  console.log(`- ${path.relative(REPOSITORY_ROOT, files.csvPath)}`);
  console.log(`- ${path.relative(REPOSITORY_ROOT, files.jsonPath)}`);
  console.log('\nNo database rows or schema objects were changed.');
}

async function main() {
  const options = parseArguments();
  const now = new Date();

  try {
    const [database, indicators, ingestionTools, macroViews, recentIngestionExecutions] =
      await Promise.all([
        loadDatabaseIdentity(),
        loadIndicators(),
        loadIngestionTools(),
        loadMacroViews(),
        loadRecentIngestionExecutions(),
      ]);

    const auditedIndicators = await buildIndicatorAuditRows(
      indicators,
      options.concurrency,
      now,
    );
    const audit = {
      schemaVersion: 'skycommand.phase16.baseline-audit.v1',
      generatedAt: now.toISOString(),
      repository: { name: path.basename(REPOSITORY_ROOT) },
      database,
      summary: buildSummary(auditedIndicators),
      ingestionTools,
      macroViews,
      recentIngestionExecutions,
      indicators: auditedIndicators,
      currentFreshnessThresholds: {
        daily: 7,
        weekly: 21,
        monthly: 75,
        quarterly: 190,
        annual: 550,
        other: 120,
      },
    };
    const files = writeAuditFiles(options.outputDirectory, audit);

    printConsoleSummary(audit, files);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[SkyCommand Phase 16 Audit] Failed:', error.message || error);
  process.exitCode = 1;
});
