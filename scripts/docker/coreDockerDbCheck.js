#!/usr/bin/env node

const path = require('node:path');
const net = require('node:net');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function main() {
  const port = Number.parseInt(String(process.env.SKYCOMMAND_POSTGRES_HOST_PORT || '55432'), 10);
  const pool = new Pool({
    host: '127.0.0.1',
    port,
    database: requireEnv('PGDATABASE'),
    user: requireEnv('PGUSER'),
    password: requireEnv('PGPASSWORD'),
    connectionTimeoutMillis: 5000,
  });

  try {
    const [database, categories, tools, workflows, repositories] = await Promise.all([
      pool.query("SELECT current_database() AS database, current_setting('server_version') AS version"),
      pool.query(`
        SELECT COUNT(DISTINCT c.category_id)::INT AS count
        FROM core.tool_categories c
        JOIN core.tool_category_visibility v ON v.category_id = c.category_id
        WHERE c.enabled = TRUE AND v.channel_code = 'cli'
      `),
      pool.query(`
        SELECT COUNT(DISTINCT t.tool_id)::INT AS count
        FROM core.tools t
        JOIN core.tool_visibility v ON v.tool_id = t.tool_id
        WHERE t.enabled = TRUE AND v.channel_code = 'cli'
      `),
      pool.query(`
        SELECT COUNT(*)::INT AS count
        FROM worker.workflow_definitions
        WHERE status = 'ACTIVE' AND enabled = TRUE AND published_version_id IS NOT NULL
      `),
      pool.query(`
        SELECT cp.profile_code, COUNT(*)::INT AS path_count
        FROM core.repository_paths rp
        JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
        WHERE cp.profile_code IN ('DEV_LOCAL', 'DOCKER_LOCAL') AND rp.active = TRUE
        GROUP BY cp.profile_code
        ORDER BY cp.profile_code
      `),
    ]);

    const temporalReachable = await canConnect('127.0.0.1', 7233);
    console.log(`[SkyCommand Core candidate] database=${database.rows[0].database}`);
    console.log(`[SkyCommand Core candidate] PostgreSQL=${database.rows[0].version}`);
    console.log(`[SkyCommand Core candidate] cliCategories=${categories.rows[0].count}`);
    console.log(`[SkyCommand Core candidate] cliTools=${tools.rows[0].count}`);
    console.log(`[SkyCommand Core candidate] publishedWorkflows=${workflows.rows[0].count}`);
    for (const row of repositories.rows) {
      console.log(`[SkyCommand Core candidate] repositoryProfile=${row.profile_code} paths=${row.path_count}`);
    }
    console.log(`[SkyCommand Core candidate] temporalPublishedPort=${temporalReachable ? 'reachable' : 'unreachable'}`);

    const profiles = new Set(repositories.rows.map((row) => row.profile_code));
    if (!profiles.has('DEV_LOCAL') || !profiles.has('DOCKER_LOCAL')) {
      throw new Error('Both DEV_LOCAL and DOCKER_LOCAL repository profiles must exist before cutover.');
    }
    if (tools.rows[0].count < 1 || workflows.rows[0].count < 1) {
      throw new Error('Candidate database is missing CLI-visible tools or published workflows.');
    }
  } finally {
    await pool.end();
  }

  console.log('[SkyCommand Core candidate] Compatibility preflight passed.');
}

main().catch((error) => {
  console.error(`[SkyCommand Core candidate] ERROR: ${error.message}`);
  process.exit(1);
});
