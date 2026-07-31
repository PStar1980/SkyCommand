#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'db_build',
  'src',
  'migrations',
  '00079__portable_catalogue_administration.sql',
);

dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
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

async function applyMigration(pool) {
  await pool.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  console.log(`✅ Applied ${path.relative(REPOSITORY_ROOT, MIGRATION_PATH).replace(/\\/g, '/')}`);
}

async function verify(pool) {
  const [permissionResult, roleResult, triggerResult, macroResult] = await Promise.all([
    pool.query(`
      SELECT permission_code, active
      FROM auth.permissions
      WHERE permission_code = 'DATA_CATALOGUE_WRITE'
    `),
    pool.query(`
      SELECT role.role_code, role_permission.active
      FROM auth.role_permissions role_permission
      JOIN auth.roles role ON role.role_id = role_permission.role_id
      JOIN auth.permissions permission ON permission.permission_id = role_permission.permission_id
      WHERE permission.permission_code = 'DATA_CATALOGUE_WRITE'
        AND role.role_code IN ('SUPER_ADMIN', 'ADMIN')
      ORDER BY role.role_code
    `),
    pool.query(`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_schema = 'data'
        AND trigger_name IN (
          'data_sources_validate_catalogue_alignment',
          'data_assets_validate_catalogue_alignment',
          'data_metrics_validate_catalogue_alignment'
        )
      GROUP BY trigger_name
      ORDER BY trigger_name
    `),
    pool.query(`
      SELECT COUNT(*)::int AS asset_count
      FROM data.vw_assets
      WHERE domain_code = 'MACRO'
    `),
  ]);

  console.log('\nSkyCommand Phase 16.2.2 catalogue administration guardrails');
  console.log('---------------------------------------------------------');
  console.log(`Write permission: ${permissionResult.rows[0]?.permission_code || 'missing'}`);
  console.log(`Admin role grants: ${roleResult.rows.filter((row) => row.active).length}`);
  console.log(`Deferred alignment triggers: ${triggerResult.rows.length}`);
  console.log(`Macro assets preserved: ${macroResult.rows[0]?.asset_count || 0}`);

  const failures = [];
  if (!permissionResult.rows[0]?.active) failures.push('DATA_CATALOGUE_WRITE permission missing/inactive');
  if (roleResult.rows.filter((row) => row.active).length !== 2) failures.push('expected SUPER_ADMIN and ADMIN grants');
  if (triggerResult.rows.length !== 3) failures.push('expected 3 catalogue-alignment triggers');
  if (Number(macroResult.rows[0]?.asset_count || 0) !== 73) failures.push('macro asset compatibility count changed');

  if (failures.length > 0) {
    throw new Error(`Phase 16.2.2 administration verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Managed catalogue permission and domain-alignment guardrails passed.');
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  const pool = createPool();
  try {
    if (command === 'setup') {
      await applyMigration(pool);
      await verify(pool);
      return;
    }
    if (command === 'verify') {
      await verify(pool);
      return;
    }
    throw new Error('Usage: phase16CatalogueAdministration.js setup|verify');
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

module.exports = { verify };
