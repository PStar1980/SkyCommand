#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const { copyIntoRelation } = require('../loaders/copyLoader');
const { persistRunSummary } = require('../ledger/ingestionLedgerService');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeIdentifier(value) {
  const text = String(value || '').trim();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(text)) throw new Error(`Unsafe proof identifier: ${value}`);
  return `"${text}"`;
}

function createCodes() {
  const suffix = `${Date.now()}_${process.pid}`;
  const lower = suffix.toLowerCase();
  return {
    domainCode: `QUALITY_PROOF_${suffix}`,
    sourceCode: `LOCAL_DB_${suffix}`,
    assetCode: `REVISION_ASSET_${suffix}`,
    schemaName: `phase16_quality_${lower}`.slice(0, 63),
    tableName: 'asset_observations',
  };
}

async function createFixture(pool, codes) {
  const schema = safeIdentifier(codes.schemaName);
  const table = safeIdentifier(codes.tableName);

  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`
    CREATE TABLE ${schema}.${table} (
      edate DATE PRIMARY KEY,
      value NUMERIC
    )
  `);
  await pool.query(`
    INSERT INTO ${schema}.${table} (edate, value)
    VALUES ('2026-01-01', 10), ('2026-02-01', 20)
  `);

  const domainResult = await pool.query(`
    INSERT INTO data.domains (
      domain_code, name, description, schema_name, contract_version, active, configuration
    )
    VALUES ($1, 'Revision Quality Proof', 'Temporary Phase 16.6.1 non-macro proof domain.',
      $2, 'data_domain.v1', TRUE, $3::jsonb)
    RETURNING domain_id
  `, [codes.domainCode, codes.schemaName, JSON.stringify({ ephemeral: true, phase: '16.6.1' })]);
  const domainId = domainResult.rows[0].domain_id;

  const sourceResult = await pool.query(`
    INSERT INTO data.sources (
      domain_id, source_code, name, provider_name, provider_type,
      description, observability_enabled, active, configuration
    )
    VALUES ($1, $2, 'Local Revision Proof Source', 'SkyCommand fixture', 'DATABASE',
      'Temporary source for revision and quality evidence.', FALSE, TRUE, $3::jsonb)
    RETURNING source_id
  `, [domainId, codes.sourceCode, JSON.stringify({ ephemeral: true })]);
  const sourceId = sourceResult.rows[0].source_id;

  const assetResult = await pool.query(`
    INSERT INTO data.assets (
      domain_id, asset_code, name, description, asset_kind_code,
      frequency_code, unit_code, revisions_expected,
      storage_schema_name, storage_relation_name, storage_date_column, storage_value_column,
      contract_version, active, configuration
    )
    VALUES ($1, $2, 'Revision-aware proof asset',
      'Temporary time-series asset proving update/reject/audit semantics.',
      'TIME_SERIES', 'MONTHLY', 'INDEX', TRUE,
      $3, $4, 'edate', 'value', 'data_asset.v1', TRUE, $5::jsonb)
    RETURNING asset_id
  `, [
    domainId,
    codes.assetCode,
    codes.schemaName,
    codes.tableName,
    JSON.stringify({ ephemeral: true, qualityContract: 'ingestion_quality.v1' }),
  ]);
  const assetId = assetResult.rows[0].asset_id;

  await pool.query(`
    INSERT INTO data.asset_source_bindings (
      asset_id, source_id, provider_asset_code, source_frequency_code,
      primary_binding, active, configuration
    )
    VALUES ($1, $2, $3, 'MONTHLY', TRUE, TRUE, $4::jsonb)
  `, [assetId, sourceId, codes.assetCode, JSON.stringify({ ephemeral: true })]);

  return { domainId, sourceId, assetId };
}

async function cleanupFixture(pool, codes) {
  const schema = safeIdentifier(codes.schemaName);
  try {
    await pool.query(`
      DELETE FROM data.ingestion_runs
      WHERE domain_id IN (SELECT domain_id FROM data.domains WHERE domain_code = $1)
    `, [codes.domainCode]);
    await pool.query('DELETE FROM data.domains WHERE domain_code = $1', [codes.domainCode]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
}

function writeProofCsv(filePath) {
  fs.writeFileSync(filePath, [
    'edate,value',
    '2026-01-01,10',
    '2026-02-01,21',
    '2026-03-01,30',
    '2026-03-01,31',
    'bad-date,40',
    '2026-04-01,not-a-number',
    '',
  ].join('\n'), 'utf8');
}

async function proof(pool) {
  const codes = createCodes();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-revision-quality-proof-'));
  const csvPath = path.join(tempDirectory, 'proof.csv');
  let fixtureCreated = false;

  try {
    await createFixture(pool, codes);
    fixtureCreated = true;
    writeProofCsv(csvPath);

    const relationName = `${codes.schemaName}.${codes.tableName}`;
    const firstLoad = copyIntoRelation({
      assetCode: codes.assetCode,
      relationName,
      filePath: csvPath,
    });

    assert(firstLoad.rowsInserted === 1, 'Expected one newly inserted observation.');
    assert(firstLoad.rowsUpdated === 1, 'Expected one revised observation update.');
    assert(firstLoad.rowsUnchanged === 1, 'Expected one unchanged observation.');
    assert(firstLoad.revisionsDetected === 1, 'Expected one detected historical revision.');
    assert(firstLoad.rowsRejected === 3, 'Expected invalid date, invalid numeric, and duplicate rejection evidence.');
    assert(firstLoad.qualityStatusCode === 'WARN', 'Expected WARN quality status for non-blocking row rejections.');

    const detail = await persistRunSummary({
      domainCode: codes.domainCode,
      sourceCode: codes.sourceCode,
      modeCode: 'FULL',
      triggerCode: 'PROOF',
      outcome: 'SUCCESS',
      selectedAssets: [codes.assetCode],
      startedAt: new Date(Date.now() - 1000).toISOString(),
      completedAt: new Date().toISOString(),
      items: [{
        assetCode: codes.assetCode,
        attemptNumber: 1,
        outcome: 'UPDATED',
        sourceMinDate: firstLoad.stagingMinDate,
        sourceMaxDate: firstLoad.stagingMaxDate,
        previousTargetMaxDate: firstLoad.previousTargetMaxDate,
        currentTargetMaxDate: firstLoad.currentTargetMaxDate,
        rowsStaged: firstLoad.stagingRows,
        rowsDetectedAsNew: firstLoad.newRowsDetected,
        rowsInserted: firstLoad.rowsInserted,
        rowsUpdated: firstLoad.rowsUpdated,
        rowsUnchanged: firstLoad.rowsUnchanged,
        rowsRejected: firstLoad.rowsRejected,
        revisionsDetected: firstLoad.revisionsDetected,
        qualityIssueCount: firstLoad.qualityIssueCount,
        qualityStatusCode: firstLoad.qualityStatusCode,
        revisionEvents: firstLoad.revisionEvents,
        rejectionEvents: firstLoad.rejectionEvents,
        qualityIssues: firstLoad.qualityIssues,
      }],
      metadata: { phase: '16.6.1', proof: true },
    }, {
      summary: 'Revision-aware loading and quality evidence proof.',
      metadata: { ephemeral: true },
    });

    const secondLoad = copyIntoRelation({
      assetCode: codes.assetCode,
      relationName,
      filePath: csvPath,
    });
    assert(secondLoad.rowsInserted === 0, 'Identical second load should insert no rows.');
    assert(secondLoad.rowsUpdated === 0, 'Identical second load should update no rows.');
    assert(secondLoad.revisionsDetected === 0, 'Identical second load should detect no revisions.');
    assert(secondLoad.rowsUnchanged === 3, 'Identical second load should preserve three accepted observations.');

    const [targetResult, revisionResult, rejectionResult, runResult] = await Promise.all([
      pool.query(`
        SELECT edate::text AS edate, value::text AS value
        FROM ${safeIdentifier(codes.schemaName)}.${safeIdentifier(codes.tableName)}
        ORDER BY edate
      `),
      pool.query(`
        SELECT observation_key, old_value, new_value
        FROM data.vw_ingestion_revision_events
        WHERE ingestion_run_id = $1
      `, [detail.run.ingestionRunId]),
      pool.query(`
        SELECT check_code, COUNT(*)::int AS count
        FROM data.vw_ingestion_rejection_events
        WHERE ingestion_run_id = $1
        GROUP BY check_code
        ORDER BY check_code
      `, [detail.run.ingestionRunId]),
      pool.query(`
        SELECT revisions_detected, quality_issue_count, quality_status_code
        FROM data.vw_ingestion_runs
        WHERE ingestion_run_id = $1
      `, [detail.run.ingestionRunId]),
    ]);

    const values = new Map(targetResult.rows.map((row) => [row.edate, row.value]));
    assert(values.get('2026-02-01') === '21', 'Revised February value was not updated.');
    assert(values.get('2026-03-01') === '31', 'Deterministic duplicate handling did not retain the final source row.');
    assert(revisionResult.rows.length === 1, 'Exactly one durable revision event was expected.');
    assert(revisionResult.rows[0].observation_key === '2026-02-01', 'Revision event key was incorrect.');
    assert(rejectionResult.rows.reduce((sum, row) => sum + Number(row.count), 0) === 3,
      'Exactly three durable rejection events were expected.');
    assert(Number(runResult.rows[0]?.revisions_detected || 0) === 1, 'Run revision total was not persisted.');
    assert(Number(runResult.rows[0]?.quality_issue_count || 0) === 3, 'Run quality issue total was not persisted.');
    assert(runResult.rows[0]?.quality_status_code === 'WARN', 'Run quality status was not persisted.');

    console.log('\nSkyCommand Phase 16.6.1 revision and quality portability proof');
    console.log('-----------------------------------------------------------');
    console.log(`Domain: ${codes.domainCode}`);
    console.log(`Source: ${codes.sourceCode}`);
    console.log(`Asset: ${codes.assetCode}`);
    console.log(`Inserted: ${firstLoad.rowsInserted}`);
    console.log(`Updated revisions: ${firstLoad.rowsUpdated}`);
    console.log(`Unchanged: ${firstLoad.rowsUnchanged}`);
    console.log(`Rejected: ${firstLoad.rowsRejected}`);
    console.log(`Quality status: ${firstLoad.qualityStatusCode}`);
    console.log(`Durable run: ${detail.run.ingestionRunId}`);
    console.log('✅ An existing observation changed by the source was updated and audited with old/new values.');
    console.log('✅ Invalid date, invalid numeric, and duplicate-key rows were rejected with durable evidence.');
    console.log('✅ A second identical load performed no inserts, updates, or revision rewrites.');
    console.log('✅ The same revision/quality contract worked for a temporary non-macro time-series asset.');
  } finally {
    if (fixtureCreated) await cleanupFixture(pool, codes);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }

  const residue = await pool.query(`
    SELECT
      EXISTS (SELECT 1 FROM data.domains WHERE domain_code = $1) AS domain_exists,
      to_regnamespace($2) IS NOT NULL AS schema_exists
  `, [codes.domainCode, codes.schemaName]);
  assert(!residue.rows[0].domain_exists, 'Proof domain remained after cleanup.');
  assert(!residue.rows[0].schema_exists, 'Proof storage schema remained after cleanup.');
  console.log('✅ Proof records and storage objects were removed cleanly.');
}

async function main() {
  const pool = createPool();
  try {
    await proof(pool);
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

module.exports = { createCodes, proof };
