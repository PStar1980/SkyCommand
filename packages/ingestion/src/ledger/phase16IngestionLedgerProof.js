#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const ledgerService = require('./ingestionLedgerService');
const { createIngestionRunToolResult } = require('./ingestionRunResult');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
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

async function createFixture(client, suffix) {
  const domainCode = `LEDGER_PROOF_${suffix}`;
  const sourceCode = 'LOCAL_DB';
  const domain = await client.query(
    `INSERT INTO data.domains (domain_code, name, description) VALUES ($1, $2, $3) RETURNING domain_id`,
    [domainCode, 'Ledger Proof Domain', 'Temporary Phase 16.4.1 rollback fixture.'],
  );
  const domainId = domain.rows[0].domain_id;
  const source = await client.query(
    `
      INSERT INTO data.sources (domain_id, source_code, name, provider_name, provider_type, observability_enabled)
      VALUES ($1, $2, $3, $4, 'DATABASE', TRUE)
      RETURNING source_id
    `,
    [domainId, sourceCode, 'Local Proof Database', 'SkyCommand proof fixture'],
  );
  const sourceId = source.rows[0].source_id;

  for (const assetCode of ['SERVICE_EVENTS', 'CLIENT_CASES', 'REFERRALS']) {
    const asset = await client.query(
      `
        INSERT INTO data.assets (
          domain_id, asset_code, name, asset_kind_code, frequency_code,
          criticality_code, contract_version, active
        ) VALUES ($1, $2, $3, 'RECORD_SET', 'DAILY', 'STANDARD', 'data_asset.v1', TRUE)
        RETURNING asset_id
      `,
      [domainId, assetCode, assetCode.replace(/_/g, ' ')],
    );
    await client.query(
      `
        INSERT INTO data.asset_source_bindings (
          asset_id, source_id, provider_asset_code, is_primary, active
        ) VALUES ($1, $2, $3, TRUE, TRUE)
      `,
      [asset.rows[0].asset_id, sourceId, assetCode],
    );
  }

  return { domainCode, sourceCode };
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();
  const suffix = `${Date.now()}_${process.pid}`;
  let fixture;

  try {
    await client.query('BEGIN');
    fixture = await createFixture(client, suffix);

    const detail = await ledgerService.persistRunSummary({
      domainCode: fixture.domainCode,
      sourceCode: fixture.sourceCode,
      modeCode: 'INCREMENTAL',
      triggerCode: 'PROOF',
      startedAt: '2026-07-31T12:00:00.000Z',
      completedAt: '2026-07-31T12:00:03.000Z',
      durationMs: 3000,
      items: [
        {
          assetCode: 'SERVICE_EVENTS',
          attemptNumber: 1,
          outcome: 'UPDATED',
          rowsStaged: 100,
          rowsDetectedAsNew: 5,
          rowsInserted: 5,
          sourceMaxDate: '2026-07-31',
          currentTargetMaxDate: '2026-07-31',
          durationMs: 500,
        },
        {
          assetCode: 'CLIENT_CASES',
          attemptNumber: 1,
          outcome: 'FAILED',
          error: { code: 'ETIMEDOUT', message: 'Synthetic timeout for retry evidence.' },
          durationMs: 250,
        },
        {
          assetCode: 'CLIENT_CASES',
          attemptNumber: 2,
          outcome: 'UNCHANGED',
          rowsStaged: 30,
          sourceMaxDate: '2026-07-31',
          currentTargetMaxDate: '2026-07-31',
          durationMs: 200,
        },
        {
          assetCode: 'REFERRALS',
          attemptNumber: 1,
          outcome: 'FAILED',
          errorCategoryCode: 'SOURCE_DATA',
          error: { code: 'PROOF_PAYLOAD_INVALID', message: 'Synthetic provider payload failure.' },
          durationMs: 300,
        },
      ],
      metadata: { proofFixture: true },
    }, {
      summary: 'Phase 16.4.1 mixed-outcome rollback proof.',
      requestContext: { proof: true },
    }, { client });

    const run = detail.run;
    const items = detail.items;
    const resultEnvelope = createIngestionRunToolResult({
      ...run,
      domainCode: run.domainCode,
      sourceCode: run.sourceCode,
      modeCode: run.modeCode,
      triggerCode: run.triggerCode,
      outcome: run.statusCode,
      selectedAssets: run.selectedAssets,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      items: items.map((item) => ({
        assetCode: item.assetCode,
        attemptNumber: item.attemptNumber,
        outcome: item.outcomeCode,
        rowsStaged: item.rows.staged,
        rowsDetectedAsNew: item.rows.detectedAsNew,
        rowsInserted: item.rows.inserted,
        rowsUpdated: item.rows.updated,
        rowsUnchanged: item.rows.unchanged,
        rowsRejected: item.rows.rejected,
        errorCategoryCode: item.error?.categoryCode,
        errorCode: item.error?.code,
        errorMessage: item.error?.message,
      })),
    });

    console.log('\nSkyCommand Phase 16.4.1 durable ingestion ledger proof');
    console.log('-----------------------------------------------------');
    console.log(`Domain: ${run.domainCode}`);
    console.log(`Source: ${run.sourceCode}`);
    console.log(`Run: ${run.ingestionRunId}`);
    console.log(`Status: ${run.statusCode}`);
    console.log(`Requested assets: ${run.totals.itemsRequested}`);
    console.log(`Succeeded assets: ${run.totals.itemsSucceeded}`);
    console.log(`Failed assets: ${run.totals.itemsFailed}`);
    console.log(`Attempts: ${run.totals.attempts}`);
    console.log(`Retries: ${run.totals.retries}`);
    console.log(`Persisted item attempts: ${items.length}`);
    console.log(`Generic output: ${resultEnvelope.outputType}`);

    if (run.statusCode !== 'PARTIAL') throw new Error('Expected PARTIAL run status.');
    if (run.totals.itemsRequested !== 3) throw new Error('Expected 3 unique requested assets.');
    if (run.totals.itemsSucceeded !== 2 || run.totals.itemsFailed !== 1) {
      throw new Error('Expected 2 successful assets and 1 failed asset.');
    }
    if (run.totals.attempts !== 4 || run.totals.retries !== 1) {
      throw new Error('Expected 4 attempts including 1 retry.');
    }
    if (items.length !== 4) throw new Error('Expected four durable item-attempt rows.');
    if (!items.some((item) => item.error?.categoryCode === 'TIMEOUT')) {
      throw new Error('Expected normalized TIMEOUT evidence.');
    }
    if (resultEnvelope.outputType !== 'ingestion_run_summary.v1') {
      throw new Error('Expected generic ingestion_run_summary.v1 ToolResult.');
    }

    console.log('✅ One durable run represented mixed success/failure outcomes.');
    console.log('✅ Retry attempts remained separate rows instead of overwriting prior evidence.');
    console.log('✅ The stateless read service reconstructed the full run from PostgreSQL rows.');
    console.log('✅ Generic ingestion_run_summary.v1 represented the same evidence without macro-specific fields.');

    await client.query('ROLLBACK');

    const cleanup = await pool.query(
      `SELECT COUNT(*)::int AS count FROM data.domains WHERE domain_code = $1`,
      [fixture.domainCode],
    );
    if (Number(cleanup.rows[0]?.count || 0) !== 0) {
      throw new Error('Proof fixture remained after rollback.');
    }
    console.log('✅ Proof transaction rolled back cleanly.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
