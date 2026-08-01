#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const fredAdapter = require('../adapters/fredAdapter');
const { persistRunSummary } = require('../ledger/ingestionLedgerService');
const { executeProductionRecovery } = require('./productionRecovery');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') throw new Error(`Missing required environment variable: ${name}`);
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

function createRecoveredBatchResult() {
  const startedAt = new Date(Date.now() - 250).toISOString();
  const completedAt = new Date().toISOString();
  return {
    source: 'FRED',
    mode: 'indicator_batch',
    selectedIndicators: true,
    concurrency: 1,
    batchCount: 1,
    startedAt,
    completedAt,
    results: [{
      indicatorCode: 'DFF',
      outcome: 'UNCHANGED',
      rowsStaged: 1,
      rowsUnchanged: 1,
      sourceMaxDate: '2026-07-31',
      currentTargetMaxDate: '2026-07-31',
      startedAt,
      completedAt,
      durationMs: 250,
      qualityStatusCode: 'PASS',
    }],
    summary: {
      total: 1,
      succeeded: 1,
      failed: 0,
      updated: 0,
      unchanged: 1,
      rowsInserted: 0,
    },
  };
}

async function proof(pool) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    const baseline = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM data.ingestion_recovery_requests)::int AS requests,
        (SELECT COUNT(*) FROM data.ingestion_runs)::int AS runs
    `);
    await client.query('BEGIN');
    transactionOpen = true;

    const original = await persistRunSummary({
      domainCode: 'MACRO',
      sourceCode: 'FRED',
      modeCode: 'SELECTED',
      triggerCode: 'PROOF',
      selectedAssets: ['DFF', 'CPIAUCSL'],
      startedAt: new Date(Date.now() - 3000).toISOString(),
      completedAt: new Date(Date.now() - 2000).toISOString(),
      items: [
        {
          assetCode: 'DFF',
          attemptNumber: 1,
          outcome: 'FAILED',
          errorCategoryCode: 'SOURCE_DATA',
          errorCode: 'PRODUCTION_RECOVERY_PROOF_FAILURE',
          errorMessage: 'Synthetic failed asset for production recovery integration proof.',
        },
        {
          assetCode: 'CPIAUCSL',
          attemptNumber: 1,
          outcome: 'UNCHANGED',
          rowsStaged: 1,
          rowsUnchanged: 1,
          currentTargetMaxDate: '2026-07-01',
        },
      ],
      metadata: { phase: '16.7.2', proof: true },
    }, {
      toolCode: 'ingestion_fred',
      summary: 'Production-compatible partial run for recovery integration proof.',
    }, { client });

    assert(original.run.statusCode === 'PARTIAL', 'Original proof run must be PARTIAL.');
    const recovered = await executeProductionRecovery({
      adapter: fredAdapter,
      toolCode: 'ingestion_fred',
      args: [`--resume-run-id=${original.run.ingestionRunId}`],
      concurrency: 1,
      runId: 'phase16-production-recovery-proof',
      client,
      execute: async (_adapter, options) => {
        assert(JSON.stringify(options.indicators) === JSON.stringify(['DFF']), 'Only failed DFF should execute.');
        return createRecoveredBatchResult();
      },
      refreshFreshness: false,
      executionContext: {
        scriptExecutionId: null,
        workflowRunRecordId: null,
        workflowNodeRunRecordId: null,
        temporalWorkflowId: null,
        temporalRunId: null,
        requestContext: { proof: true, phase: '16.7.2' },
      },
    });

    assert(recovered.recoveryExecution.request.statusCode === 'COMPLETED', 'Recovery request did not complete.');
    assert(recovered.recoveryExecution.run.resumedFromRunId === original.run.ingestionRunId, 'Recovery ancestry is incorrect.');
    assert(recovered.recoveryLedgerReference.persisted, 'Recovery ledger reference was not returned to the tool boundary.');
    assert(recovered.results.length === 1 && recovered.results[0].indicatorCode === 'DFF', 'Successful CPIAUCSL was rerun unexpectedly.');

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    console.log('\nSkyCommand Phase 16.7.2 production recovery integration proof');
    console.log('------------------------------------------------------------');
    console.log(`Original run: ${original.run.ingestionRunId}`);
    console.log(`Original status: ${original.run.statusCode}`);
    console.log(`Recovery request: ${recovered.recoveryExecution.request.recoveryRequestId}`);
    console.log(`Recovery run: ${recovered.recoveryExecution.run.ingestionRunId}`);
    console.log(`Recovered assets: ${recovered.results.map((item) => item.indicatorCode).join(', ')}`);
    console.log('✅ A production FRED profile accepted durable failed-only recovery.');
    console.log('✅ Only the failed asset crossed the common adapter boundary; the successful asset was untouched.');
    console.log('✅ The recovery run preserved original-run ancestry and returned its ledger reference to the tool contract.');
    console.log('✅ The same positional/flag recovery path used by CLI, Run Tools, API, and workflows was exercised.');

    await client.query('ROLLBACK');
    transactionOpen = false;
    const residue = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM data.ingestion_recovery_requests)::int AS requests,
        (SELECT COUNT(*) FROM data.ingestion_runs)::int AS runs
    `);
    assert(residue.rows[0].requests === baseline.rows[0].requests, 'Recovery request count did not return to baseline.');
    assert(residue.rows[0].runs === baseline.rows[0].runs, 'Ingestion run count did not return to baseline.');
    console.log('✅ Proof transaction rolled back cleanly and all durable counts returned to baseline.');
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

module.exports = { createPool, proof };
