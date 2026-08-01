#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const { copyIntoRelation } = require('../loaders/copyLoader');
const { getAssetQualityContext, getCheckPolicy } = require('./qualityPolicy');

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
    domainCode: `QUALITY_POLICY_PROOF_${suffix}`,
    sourceCode: `LOCAL_SOURCE_${suffix}`,
    assetCode: `MONTHLY_EVENTS_${suffix}`,
    schemaName: `phase16_quality_policy_${lower}`.slice(0, 63),
    tableName: 'monthly_events',
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
  await pool.query(`INSERT INTO ${schema}.${table} (edate, value) VALUES ('2026-01-01', 10)`);

  const domainResult = await pool.query(`
    INSERT INTO data.domains (
      domain_code, name, description, schema_name, contract_version, active, configuration
    )
    VALUES ($1, 'Quality Policy Proof', 'Temporary Phase 16.6.2 policy proof domain.',
      $2, 'data_domain.v1', TRUE, $3::jsonb)
    RETURNING domain_id
  `, [codes.domainCode, codes.schemaName, JSON.stringify({ ephemeral: true, phase: '16.6.2' })]);
  const domainId = domainResult.rows[0].domain_id;

  const sourceResult = await pool.query(`
    INSERT INTO data.sources (
      domain_id, source_code, name, provider_name, provider_type,
      description, observability_enabled, active, configuration
    )
    VALUES ($1, $2, 'Local Quality Policy Source', 'SkyCommand fixture', 'DATABASE',
      'Temporary source for quality-policy precedence.', FALSE, TRUE, $3::jsonb)
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
    VALUES ($1, $2, 'Monthly quality-policy events',
      'Temporary time series proving source policy and asset override precedence.',
      'TIME_SERIES', 'MONTHLY', 'COUNT', TRUE,
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
  `, [assetId, sourceId, codes.assetCode, JSON.stringify({ ephemeral: true, unitCode: 'COUNT' })]);

  await pool.query(`
    INSERT INTO data.source_quality_policies (
      source_id, check_code, enabled, severity_code, blocking, parameters, active
    )
    VALUES
      ($1, 'UNEXPECTED_GAP', TRUE, 'WARNING', FALSE, '{"maxGapDays":45}'::jsonb, TRUE),
      ($1, 'ROW_COUNT_ANOMALY', TRUE, 'WARNING', FALSE, '{"minRows":4}'::jsonb, TRUE)
  `, [sourceId]);

  return { domainId, sourceId, assetId };
}

async function cleanupFixture(pool, codes) {
  const schema = safeIdentifier(codes.schemaName);
  try {
    await pool.query('DELETE FROM data.domains WHERE domain_code = $1', [codes.domainCode]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
}

function writeCsv(filePath, includeJune = false) {
  const rows = [
    'edate,value',
    '2026-01-01,10',
    '2026-02-01,20',
    '2026-05-01,50',
  ];
  if (includeJune) rows.push('2026-06-01,60');
  rows.push('');
  fs.writeFileSync(filePath, rows.join('\n'), 'utf8');
}

async function proof(pool) {
  const codes = createCodes();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-quality-policy-proof-'));
  const csvPath = path.join(tempDirectory, 'source.csv');
  let fixtureCreated = false;

  try {
    const fixture = await createFixture(pool, codes);
    fixtureCreated = true;
    const query = pool.query.bind(pool);
    const relationName = `${codes.schemaName}.${codes.tableName}`;

    writeCsv(csvPath, false);
    const sourceContext = await getAssetQualityContext(
      codes.domainCode,
      codes.sourceCode,
      codes.assetCode,
      { query },
    );
    assert(getCheckPolicy(sourceContext, 'UNEXPECTED_GAP').originCode === 'SOURCE',
      'Expected source-level gap policy before the asset override.');
    assert(getCheckPolicy(sourceContext, 'ROW_COUNT_ANOMALY').originCode === 'SOURCE',
      'Expected source-level row-count policy.');

    const warningLoad = copyIntoRelation({
      assetCode: codes.assetCode,
      relationName,
      filePath: csvPath,
      qualityContext: sourceContext,
    });
    assert(warningLoad.qualityStatusCode === 'WARN', 'Expected non-blocking source policies to produce WARN.');
    assert(warningLoad.rowsInserted === 2, 'Expected February and May observations to load.');
    const warningCodes = new Set(warningLoad.qualityIssues.map((item) => item.checkCode));
    assert(warningCodes.has('UNEXPECTED_GAP'), 'Expected durable unexpected-gap evidence.');
    assert(warningCodes.has('ROW_COUNT_ANOMALY'), 'Expected durable row-count anomaly evidence.');

    await pool.query(`
      INSERT INTO data.asset_quality_policies (
        asset_id, check_code, enabled, severity_code, blocking, parameters, active
      )
      VALUES ($1, 'UNEXPECTED_GAP', TRUE, 'ERROR', TRUE, '{"maxGapDays":45}'::jsonb, TRUE)
    `, [fixture.assetId]);

    const assetContext = await getAssetQualityContext(
      codes.domainCode,
      codes.sourceCode,
      codes.assetCode,
      { query },
    );
    const resolvedGap = getCheckPolicy(assetContext, 'UNEXPECTED_GAP');
    assert(resolvedGap.originCode === 'ASSET', 'Asset policy did not override the source policy.');
    assert(resolvedGap.blocking === true && resolvedGap.severityCode === 'ERROR',
      'Asset override did not resolve to blocking ERROR.');

    writeCsv(csvPath, true);
    let blockedEvidence = null;
    try {
      copyIntoRelation({
        assetCode: codes.assetCode,
        relationName,
        filePath: csvPath,
        qualityContext: assetContext,
      });
      throw new Error('Expected the blocking asset policy to fail the load.');
    } catch (error) {
      if (error.code !== 'INGESTION_QUALITY_FAILED') throw error;
      blockedEvidence = error.ingestionEvidence;
    }

    assert(blockedEvidence?.qualityStatusCode === 'FAIL', 'Expected blocking policy to produce FAIL.');
    assert(blockedEvidence?.rowsInserted === 0, 'Blocking quality failure must not insert rows.');
    assert(blockedEvidence?.rowsUpdated === 0, 'Blocking quality failure must not update rows.');
    assert(blockedEvidence?.newRowsDetected === 1, 'The blocked June row should remain detectable as new.');

    const targetResult = await pool.query(`
      SELECT COUNT(*)::int AS rows, MAX(edate)::text AS max_date
      FROM ${safeIdentifier(codes.schemaName)}.${safeIdentifier(codes.tableName)}
    `);
    assert(Number(targetResult.rows[0].rows) === 3, 'Blocking failure changed the target row count.');
    assert(targetResult.rows[0].max_date === '2026-05-01', 'Blocking failure inserted the June observation.');

    console.log('\nSkyCommand Phase 16.6.2 quality-policy portability proof');
    console.log('--------------------------------------------------------');
    console.log(`Domain: ${codes.domainCode}`);
    console.log(`Source: ${codes.sourceCode}`);
    console.log(`Asset: ${codes.assetCode}`);
    console.log(`Source-policy load: ${warningLoad.qualityStatusCode}`);
    console.log(`Source-policy issues: ${[...warningCodes].sort().join(', ')}`);
    console.log(`Asset override origin: ${resolvedGap.originCode}`);
    console.log(`Blocking load: ${blockedEvidence.qualityStatusCode}`);
    console.log(`Blocked rows inserted: ${blockedEvidence.rowsInserted}`);
    console.log('✅ Source-level gap and row-count policies produced portable warning evidence.');
    console.log('✅ Asset-level policy overrode the source policy without changing loader code.');
    console.log('✅ Blocking quality findings prevented inserts and updates while preserving diagnostics.');
    console.log('✅ The policy contract worked for a temporary non-macro time-series asset.');
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
  console.log('✅ Proof policies, catalogue records, and storage objects were removed cleanly.');
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
