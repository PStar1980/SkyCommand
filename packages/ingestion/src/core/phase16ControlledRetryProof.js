#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const { defineSourceAdapter, runSourceAdapter } = require('./sourceAdapter');
const { downloadToFileWithSourcePolicy } = require('./httpSourceClient');
const { fromAdapterBatchResult, createIngestionRunToolResult } = require('../ledger/ingestionRunResult');
const ledgerService = require('../ledger/ingestionLedgerService');

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

async function createFixture(client, suffix) {
  const domainCode = `RETRY_PROOF_${suffix}`;
  const sourceCode = 'PROOF_HTTP';
  const assetCodes = ['RETRY_SUCCESS', 'AUTH_FAILURE'];

  const domainResult = await client.query(
    `
      INSERT INTO data.domains (domain_code, name, description, active, configuration)
      VALUES ($1, $2, $3, TRUE, $4::jsonb)
      RETURNING domain_id
    `,
    [
      domainCode,
      'Controlled Retry Proof Domain',
      'Temporary Phase 16.5.2 source-adapter retry proof.',
      JSON.stringify({ proof: true, phase: '16.5.2' }),
    ],
  );
  const domainId = domainResult.rows[0].domain_id;

  const sourceResult = await client.query(
    `
      INSERT INTO data.sources (
        domain_id, source_code, name, provider_name, provider_type,
        observability_enabled, active, configuration
      )
      VALUES ($1, $2, $3, $4, 'HTTP', TRUE, TRUE, $5::jsonb)
      RETURNING source_id
    `,
    [
      domainId,
      sourceCode,
      'Controlled HTTP Proof Source',
      'SkyCommand deterministic proof fixture',
      JSON.stringify({ proof: true, phase: '16.5.2' }),
    ],
  );
  const sourceId = sourceResult.rows[0].source_id;

  await client.query(
    `
      INSERT INTO data.source_request_policies (
        source_id, request_timeout_ms, max_attempts, base_delay_ms,
        max_delay_ms, max_elapsed_ms, jitter_ratio, respect_retry_after,
        retryable_http_statuses, retryable_error_codes, configuration, active
      )
      VALUES (
        $1, 1000, 4, 10,
        100, 10000, 0, TRUE,
        ARRAY[503], ARRAY['ETIMEDOUT'], $2::jsonb, TRUE
      )
    `,
    [sourceId, JSON.stringify({ proof: true, phase: '16.5.2' })],
  );

  for (const assetCode of assetCodes) {
    const assetResult = await client.query(
      `
        INSERT INTO data.assets (
          domain_id, asset_code, name, asset_kind_code, frequency_code,
          criticality_code, contract_version, active, configuration
        )
        VALUES ($1, $2, $3, 'RECORD_SET', 'DAILY', 'STANDARD', 'data_asset.v1', TRUE, $4::jsonb)
        RETURNING asset_id
      `,
      [
        domainId,
        assetCode,
        assetCode.replace(/_/g, ' '),
        JSON.stringify({ proof: true, phase: '16.5.2' }),
      ],
    );

    await client.query(
      `
        INSERT INTO data.asset_source_bindings (
          asset_id, source_id, provider_asset_code, primary_binding, active
        )
        VALUES ($1, $2, $3, TRUE, TRUE)
      `,
      [assetResult.rows[0].asset_id, sourceId, assetCode],
    );
  }

  return { domainCode, sourceCode, assetCodes };
}

function createDeterministicAxios() {
  const calls = new Map();

  const axiosInstance = async ({ url }) => {
    const assetCode = String(url || '').split('/').pop().replace(/\.csv$/i, '');
    const attemptNumber = (calls.get(assetCode) || 0) + 1;
    calls.set(assetCode, attemptNumber);

    if (assetCode === 'RETRY_SUCCESS') {
      if (attemptNumber === 1) {
        const error = new Error('Synthetic provider unavailable response.');
        error.code = 'ERR_BAD_RESPONSE';
        error.response = { status: 503, headers: { 'retry-after': '0' } };
        throw error;
      }
      if (attemptNumber === 2) {
        const error = new Error('Synthetic request timeout.');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return {
        status: 200,
        headers: {},
        data: Buffer.from('edate,value\n2026-07-31,1\n', 'utf8'),
      };
    }

    if (assetCode === 'AUTH_FAILURE') {
      const error = new Error('Synthetic unauthorized response.');
      error.code = 'ERR_BAD_REQUEST';
      error.response = { status: 401, headers: {} };
      throw error;
    }

    throw new Error(`Unexpected proof asset: ${assetCode}`);
  };

  return { axiosInstance, calls };
}

function createProofAdapter({ domainCode, sourceCode, root, axiosInstance, waits }) {
  return defineSourceAdapter({
    domainCode,
    sourceCode,
    adapterCode: 'CONTROLLED_RETRY_PROOF',
    resultContractVersion: 'ingestion_run_summary.v1',
    name: 'ControlledRetryProof',
    getAssets: async () => ['RETRY_SUCCESS', 'AUTH_FAILURE'],
    fetch: (code, outputDir, item, context = {}) => downloadToFileWithSourcePolicy({
      sourceCode,
      domainCode,
      assetCode: code,
      url: `https://proof.invalid/${code}.csv`,
      outputDir,
      fileName: `${code}.csv`,
      policy: context.requestPolicy,
      axiosInstance,
      logger: { log() {}, warn() {} },
      retryOptions: {
        random: () => 0.5,
        sleepFn: async (milliseconds) => {
          waits.push({ assetCode: code, milliseconds });
        },
      },
    }),
    normalize: null,
    load: async (code, filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.includes('2026-07-31,1')) {
        throw new Error(`Unexpected proof payload for ${code}.`);
      }
      return {
        stagingRows: 1,
        stagingMinDate: '2026-07-31',
        stagingMaxDate: '2026-07-31',
        previousTargetMaxDate: '2026-07-30',
        newRowsDetected: 1,
        rowsInserted: 1,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsRejected: 0,
        currentTargetMaxDate: '2026-07-31',
      };
    },
    tempDir: root,
    defaultConcurrency: 1,
    maxConcurrency: 1,
    capabilities: {
      incremental: false,
      selectedAssets: true,
      backfill: false,
      revisions: false,
      resume: false,
      dryRun: false,
    },
    requestPolicyRequired: true,
    metadata: { proof: true, phase: '16.5.2' },
  });
}

function findAttempt(items, assetCode, attemptNumber) {
  return items.find(
    (item) => item.assetCode === assetCode && item.attemptNumber === attemptNumber,
  );
}

async function runProof() {
  const pool = createPool();
  const client = await pool.connect();
  const suffix = `${Date.now()}_${process.pid}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-retry-proof-'));
  const waits = [];
  let fixture = null;

  try {
    await client.query('BEGIN');
    fixture = await createFixture(client, suffix);
    const query = client.query.bind(client);
    const { axiosInstance, calls } = createDeterministicAxios();
    const adapter = createProofAdapter({
      ...fixture,
      root,
      axiosInstance,
      waits,
    });

    const batchResult = await runSourceAdapter(adapter, {
      concurrency: 1,
      runId: `phase16-5-2-${suffix}`,
      query,
      cleanupQuiet: true,
    });

    const genericSummary = fromAdapterBatchResult(batchResult, {
      domainCode: fixture.domainCode,
      sourceCode: fixture.sourceCode,
      triggerCode: 'PROOF',
      metadata: {
        proof: true,
        phase: '16.5.2',
        path: 'common_source_adapter',
      },
    });

    const detail = await ledgerService.persistRunSummary(
      genericSummary,
      {
        summary: 'Phase 16.5.2 controlled retry and terminal-failure proof.',
        requestContext: { proof: true, phase: '16.5.2' },
        metadata: { proof: true, phase: '16.5.2' },
      },
      { client },
    );

    const envelope = createIngestionRunToolResult(genericSummary);
    const run = detail.run;
    const items = detail.items;
    const retry503 = findAttempt(items, 'RETRY_SUCCESS', 1);
    const retryTimeout = findAttempt(items, 'RETRY_SUCCESS', 2);
    const retrySuccess = findAttempt(items, 'RETRY_SUCCESS', 3);
    const authFailure = findAttempt(items, 'AUTH_FAILURE', 1);

    if (batchResult.ok !== false) throw new Error('Expected the mixed proof batch to be non-successful.');
    if (run.statusCode !== 'PARTIAL') throw new Error(`Expected PARTIAL run, received ${run.statusCode}.`);
    if (run.totals.itemsRequested !== 2 || run.totals.itemsSucceeded !== 1 || run.totals.itemsFailed !== 1) {
      throw new Error('Expected 2 requested assets with 1 success and 1 terminal failure.');
    }
    if (run.totals.attempts !== 4 || run.totals.retries !== 2 || items.length !== 4) {
      throw new Error('Expected 4 durable attempts including 2 retries.');
    }
    if (!retry503 || retry503.outcomeCode !== 'FAILED' || retry503.error?.categoryCode !== 'HTTP') {
      throw new Error('Expected durable HTTP failure evidence for retry attempt 1.');
    }
    if (retry503.httpStatus !== 503 || retry503.retryable !== true) {
      throw new Error('Expected retryable HTTP 503 evidence.');
    }
    if (!retryTimeout || retryTimeout.outcomeCode !== 'FAILED' || retryTimeout.error?.categoryCode !== 'TIMEOUT') {
      throw new Error('Expected durable TIMEOUT evidence for retry attempt 2.');
    }
    if (!retrySuccess || retrySuccess.outcomeCode !== 'UPDATED' || retrySuccess.rows.inserted !== 1) {
      throw new Error('Expected retry attempt 3 to complete successfully and insert one proof row.');
    }
    if (!authFailure || authFailure.error?.categoryCode !== 'AUTH' || authFailure.httpStatus !== 401) {
      throw new Error('Expected terminal AUTH/401 evidence.');
    }
    if (authFailure.retryable !== false || calls.get('AUTH_FAILURE') !== 1) {
      throw new Error('Authentication failure was retried unexpectedly.');
    }
    if (calls.get('RETRY_SUCCESS') !== 3) {
      throw new Error('Retry-success asset did not use exactly three request attempts.');
    }
    if (waits.length !== 2 || waits[0].milliseconds !== 10 || waits[1].milliseconds !== 20) {
      throw new Error(`Unexpected deterministic backoff sequence: ${JSON.stringify(waits)}.`);
    }
    if (retry503.diagnostics?.requestWaitBeforeNextMs !== 10) {
      throw new Error('First retry delay was not preserved in durable diagnostics.');
    }
    if (retryTimeout.diagnostics?.requestWaitBeforeNextMs !== 20) {
      throw new Error('Second retry delay was not preserved in durable diagnostics.');
    }
    if (envelope.outputType !== 'ingestion_run_summary.v1') {
      throw new Error('Expected generic ingestion_run_summary.v1 proof output.');
    }

    console.log('\nSkyCommand Phase 16.5.2 controlled adapter retry proof');
    console.log('---------------------------------------------------');
    console.log(`Domain: ${run.domainCode}`);
    console.log(`Source: ${run.sourceCode}`);
    console.log(`Run: ${run.ingestionRunId}`);
    console.log(`Status: ${run.statusCode}`);
    console.log(`Requested assets: ${run.totals.itemsRequested}`);
    console.log(`Succeeded assets: ${run.totals.itemsSucceeded}`);
    console.log(`Failed assets: ${run.totals.itemsFailed}`);
    console.log(`Attempts: ${run.totals.attempts}`);
    console.log(`Retries: ${run.totals.retries}`);
    console.log(`Backoff waits: ${waits.map((item) => `${item.milliseconds}ms`).join(', ')}`);
    console.log(`Generic output: ${envelope.outputType}`);
    console.log('✅ Retryable HTTP 503 and timeout failures were retried through the common source-adapter path.');
    console.log('✅ The third request succeeded and all three attempts remained separate durable ledger rows.');
    console.log('✅ HTTP 401 was classified as AUTH and stopped after one terminal attempt.');
    console.log('✅ PostgreSQL-authoritative request policy and deterministic backoff diagnostics were preserved.');

    await client.query('ROLLBACK');

    const cleanup = await pool.query(
      `SELECT COUNT(*)::int AS count FROM data.domains WHERE domain_code = $1`,
      [fixture.domainCode],
    );
    if (Number(cleanup.rows[0]?.count || 0) !== 0) {
      throw new Error('Controlled retry proof fixture remained after rollback.');
    }
    console.log('✅ Proof transaction rolled back cleanly.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runProof().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createDeterministicAxios,
  runProof,
};
