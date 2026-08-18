#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

const criticalTables = [
  'core.applications',
  'core.config_profiles',
  'core.repositories',
  'core.repository_paths',
  'core.runtimes',
  'core.option_sources',
  'core.param_types',
  'core.risk_levels',
  'core.visibility_channels',
  'core.tool_categories',
  'core.tool_category_visibility',
  'core.tools',
  'core.tool_visibility',
  'core.tool_parameters',
  'core.tool_parameter_options',
  'worker.workflow_node_types',
  'worker.workflow_definitions',
  'worker.workflow_versions',
  'worker.workflow_nodes',
  'worker.workflow_edges',
];

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`[SkyCommand PostgreSQL parity] Missing required environment variable: ${name}`);
  }
  return value;
}

function candidatePort() {
  const port = Number.parseInt(String(process.env.SKYCOMMAND_POSTGRES_HOST_PORT || '55432'), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('[SkyCommand PostgreSQL parity] Invalid SKYCOMMAND_POSTGRES_HOST_PORT.');
  }
  return port;
}

function sourcePort() {
  const port = Number.parseInt(
    String(process.env.SKYCOMMAND_POSTGRES_SOURCE_PORT || process.env.PGPORT || '5432'),
    10,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('[SkyCommand PostgreSQL parity] Invalid source PostgreSQL port.');
  }
  return port;
}

function createPool({ host, port }) {
  return new Pool({
    host,
    port,
    database: requireEnv('PGDATABASE'),
    user: requireEnv('PGUSER'),
    password: requireEnv('PGPASSWORD'),
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
}

function splitTableName(value) {
  const match = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/i.exec(value);
  if (!match) {
    throw new Error(`Unsafe table name: ${value}`);
  }
  return match.slice(1);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function fingerprintTable(pool, tableName) {
  const [schema, table] = splitTableName(tableName);
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const client = await pool.connect();

  try {
    // PostgreSQL renders TIMESTAMPTZ values through the session TimeZone when a row is
    // converted to JSON. The Windows source and Linux Docker candidate can therefore
    // contain identical timestamp instants while producing different textual hashes.
    // Canonicalize both sides to UTC before computing semantic row fingerprints.
    await client.query("SET TIME ZONE 'UTC'");
    const result = await client.query(`
      SELECT
        COUNT(*)::BIGINT AS row_count,
        COALESCE(md5(string_agg(row_hash, '' ORDER BY row_hash)), md5('')) AS content_hash
      FROM (
        SELECT md5(to_jsonb(t)::text) AS row_hash
        FROM ${qualified} AS t
      ) AS rows
    `);
    return {
      rowCount: Number(result.rows[0].row_count),
      contentHash: result.rows[0].content_hash,
    };
  } finally {
    client.release();
  }
}

async function querySummary(pool) {
  const [version, tools, workflows] = await Promise.all([
    pool.query(`
      SELECT
        current_setting('server_version') AS server_version,
        current_setting('TimeZone') AS time_zone
    `),
    pool.query(`
      SELECT tool_code, label, runtime_code, enabled
      FROM core.tools
      ORDER BY tool_code
    `),
    pool.query(`
      SELECT workflow_code, display_name, status, published_version_id
      FROM worker.vw_workflow_definitions
      ORDER BY workflow_code
    `),
  ]);
  return {
    serverVersion: version.rows[0].server_version,
    timeZone: version.rows[0].time_zone,
    tools: tools.rows,
    workflows: workflows.rows,
  };
}

async function main() {
  const source = createPool({ host: '127.0.0.1', port: sourcePort() });
  const candidate = createPool({ host: '127.0.0.1', port: candidatePort() });
  let failed = false;

  try {
    const [sourceSummary, candidateSummary] = await Promise.all([
      querySummary(source),
      querySummary(candidate),
    ]);
    console.log(
      `[SkyCommand PostgreSQL parity] sourceVersion=${sourceSummary.serverVersion} sourceTimeZone=${sourceSummary.timeZone}`,
    );
    console.log(
      `[SkyCommand PostgreSQL parity] candidateVersion=${candidateSummary.serverVersion} candidateTimeZone=${candidateSummary.timeZone}`,
    );
    if (sourceSummary.timeZone !== candidateSummary.timeZone) {
      console.log(
        '[SkyCommand PostgreSQL parity] INFO: server time zones differ; TIMESTAMPTZ fingerprints are canonicalized to UTC before comparison.',
      );
    }

    for (const tableName of criticalTables) {
      const [sourceFingerprint, candidateFingerprint] = await Promise.all([
        fingerprintTable(source, tableName),
        fingerprintTable(candidate, tableName),
      ]);
      const match =
        sourceFingerprint.rowCount === candidateFingerprint.rowCount &&
        sourceFingerprint.contentHash === candidateFingerprint.contentHash;
      console.log(
        `[SkyCommand PostgreSQL parity] ${match ? 'PASS' : 'FAIL'} ${tableName} source=${sourceFingerprint.rowCount}/${sourceFingerprint.contentHash} candidate=${candidateFingerprint.rowCount}/${candidateFingerprint.contentHash}`,
      );
      failed ||= !match;
    }

    const toolsMatch = JSON.stringify(sourceSummary.tools) === JSON.stringify(candidateSummary.tools);
    const workflowsMatch =
      JSON.stringify(sourceSummary.workflows) === JSON.stringify(candidateSummary.workflows);
    console.log(
      `[SkyCommand PostgreSQL parity] ${toolsMatch ? 'PASS' : 'FAIL'} tool catalogue rows=${sourceSummary.tools.length}`,
    );
    console.log(
      `[SkyCommand PostgreSQL parity] ${workflowsMatch ? 'PASS' : 'FAIL'} workflow catalogue rows=${sourceSummary.workflows.length}`,
    );
    failed ||= !toolsMatch || !workflowsMatch;
  } finally {
    await Promise.allSettled([source.end(), candidate.end()]);
  }

  if (failed) {
    throw new Error('Critical PostgreSQL tool/workflow parity failed. Do not cut over.');
  }

  console.log('[SkyCommand PostgreSQL parity] Critical tool/workflow configuration is identical.');
}

main().catch((error) => {
  console.error(`[SkyCommand PostgreSQL parity] ERROR: ${error.message}`);
  process.exit(1);
});
