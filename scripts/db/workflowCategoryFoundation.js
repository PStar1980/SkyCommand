#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_PATHS = [
  path.join(
    REPOSITORY_ROOT,
    'packages',
    'db_build',
    'src',
    'migrations',
    '00107__workflow_category_foundation.sql',
  ),
  path.join(
    REPOSITORY_ROOT,
    'packages',
    'db_build',
    'src',
    'migrations',
    '00109__workflow_run_category_projection.sql',
  ),
  path.join(
    REPOSITORY_ROOT,
    'packages',
    'db_build',
    'src',
    'migrations',
    '00110__workflow_approval_category_projection.sql',
  ),
];
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'db_build',
  'src',
  'seeds',
  '00108__workflow_category_seed.sql',
);
const EXPECTED_CATEGORY_CODES = [
  'REPOSITORY_AUTOMATION',
  'DATA_PIPELINES',
  'DATABASE_OPERATIONS',
  'GENERAL',
];

dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
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
  const sql = fs.readFileSync(filePath, 'utf8');
  await pool.query(sql);
  console.log(`✅ Applied ${path.relative(REPOSITORY_ROOT, filePath).replace(/\\/g, '/')}`);
}

async function loadVerification(pool) {
  const [categoryResult, definitionResult, uncategorizedResult, runCategoryResult, approvalCategoryResult] = await Promise.all([
    pool.query(`
      SELECT
        category_code,
        display_name,
        display_order,
        enabled
      FROM worker.workflow_categories
      ORDER BY display_order, display_name, category_code
    `),
    pool.query(`
      SELECT
        workflow_code,
        display_name,
        category_code,
        category_display_name
      FROM worker.vw_workflow_definitions
      ORDER BY display_name, workflow_code
    `),
    pool.query(`
      SELECT COUNT(*)::int AS count
      FROM worker.workflow_definitions
      WHERE workflow_category_id IS NULL
    `),
    pool.query(`
      SELECT
        workflow_category_code,
        workflow_category_display_name,
        workflow_category_source
      FROM worker.vw_workflow_run_records
      ORDER BY created_at DESC
      LIMIT 1
    `),
    pool.query(`
      SELECT
        workflow_category_code,
        workflow_category_display_name,
        workflow_category_source
      FROM worker.vw_workflow_approval_requests
      ORDER BY created_at DESC
      LIMIT 1
    `),
  ]);

  return {
    categories: categoryResult.rows,
    definitions: definitionResult.rows,
    uncategorized: Number(uncategorizedResult.rows[0]?.count || 0),
    latestRunCategoryProjection: runCategoryResult.rows[0] || null,
    latestApprovalCategoryProjection: approvalCategoryResult.rows[0] || null,
  };
}

function verifyState(state) {
  const actualCategoryCodes = new Set(state.categories.map((category) => category.category_code));
  const missingCategories = EXPECTED_CATEGORY_CODES.filter((code) => !actualCategoryCodes.has(code));

  if (missingCategories.length > 0) {
    throw new Error(`Missing workflow categories: ${missingCategories.join(', ')}`);
  }

  if (state.uncategorized !== 0) {
    throw new Error(`${state.uncategorized} workflow definition(s) are missing a category.`);
  }

  const knownExpectations = new Map([
    ['skyserver_dev_commit', 'REPOSITORY_AUTOMATION'],
    ['git-repo-intelligence', 'REPOSITORY_AUTOMATION'],
    ['repo-map-zip', 'REPOSITORY_AUTOMATION'],
    ['macro-refresh-pipeline', 'DATA_PIPELINES'],
    ['db-sync-test', 'DATABASE_OPERATIONS'],
  ]);

  const mismatches = state.definitions
    .filter((definition) => knownExpectations.has(definition.workflow_code))
    .filter(
      (definition) => knownExpectations.get(definition.workflow_code) !== definition.category_code,
    );

  if (mismatches.length > 0) {
    throw new Error(
      `Known workflow category mismatch: ${mismatches
        .map((definition) => `${definition.workflow_code}=${definition.category_code}`)
        .join(', ')}`,
    );
  }

  return state;
}

function printState(state) {
  console.log('\nWorkflow categories:');
  console.table(
    state.categories.map((category) => ({
      code: category.category_code,
      name: category.display_name,
      order: category.display_order,
      enabled: category.enabled,
    })),
  );

  console.log('\nWorkflow assignments:');
  console.table(
    state.definitions.map((definition) => ({
      workflow: definition.workflow_code,
      name: definition.display_name,
      category: definition.category_display_name,
      categoryCode: definition.category_code,
    })),
  );
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  const pool = createPool();

  try {
    if (command === 'setup') {
      for (const migrationPath of MIGRATION_PATHS) {
        await applySqlFile(pool, migrationPath);
      }
      await applySqlFile(pool, SEED_PATH);
    } else if (command !== 'verify') {
      throw new Error('Usage: node scripts/db/workflowCategoryFoundation.js [setup|verify]');
    }

    const state = verifyState(await loadVerification(pool));
    printState(state);
    console.log(`\n✅ Workflow category foundation ${command === 'setup' ? 'setup and ' : ''}verification passed.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`❌ Workflow category foundation failed: ${error.message}`);
  process.exitCode = 1;
});
