#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const { defineSourceAdapter } = require('../core/sourceAdapter');
const { persistRunSummary } = require('../ledger/ingestionLedgerService');
const {
  createRecoveryRequest,
  executeRecoveryRequest,
  getRecoveryRequest,
} = require('./ingestionRecoveryService');

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

function createCodes() {
  const suffix = `${Date.now()}_${process.pid}`;
  const lower = suffix.toLowerCase();
  return {
    domainCode: `RECOVERY_PROOF_${suffix}`,
    sourceCode: `LOCAL_DB_${suffix}`,
    categoryCode: `phase16_recovery_proof_${lower}`,
    toolCode: `phase16_recovery_probe_${lower}`,
    adapterCode: `RECOVERY_PROBE_${suffix}`,
  };
}

async function loadTemplate(client) {
  const result = await client.query(`
    SELECT
      tool.tool_id,
      tool.script_repo_id,
      tool.runtime_code,
      tool.permission_code,
      tool.risk_code,
      category.category_id,
      category.app_id
    FROM core.tools tool
    JOIN core.tool_categories category ON category.category_id = tool.category_id
    WHERE category.category_kind_code = 'INGESTION'
    ORDER BY tool.enabled DESC, tool.tool_code
    LIMIT 1
  `);
  if (result.rows.length === 0) throw new Error('No INGESTION tool template is available.');
  return result.rows[0];
}

async function insertFixture(client, template, codes) {
  const domain = await client.query(`
    INSERT INTO data.domains (domain_code, name, description, contract_version, active, configuration)
    VALUES ($1, 'Recovery Proof', 'Rollback-safe Phase 16.7.1 recovery fixture.',
      'data_domain.v1', TRUE, $2::jsonb)
    RETURNING domain_id
  `, [codes.domainCode, JSON.stringify({ ephemeral: true, phase: '16.7.1' })]);
  const domainId = domain.rows[0].domain_id;

  const source = await client.query(`
    INSERT INTO data.sources (
      domain_id, source_code, name, provider_name, provider_type,
      description, observability_enabled, active, configuration
    )
    VALUES ($1, $2, 'Local Recovery Source', 'SkyCommand fixture', 'DATABASE',
      'Temporary source proving failed-only recovery.', FALSE, TRUE, $3::jsonb)
    RETURNING source_id
  `, [domainId, codes.sourceCode, JSON.stringify({ ephemeral: true })]);
  const sourceId = source.rows[0].source_id;

  const category = await client.query(`
    INSERT INTO core.tool_categories (
      app_id, category_code, name, label, description, display_order, enabled, category_kind_code
    )
    VALUES ($1, $2, 'phase16_recovery_proof', 'Recovery Proof Tools',
      'Temporary INGESTION category.', 998, TRUE, 'INGESTION')
    RETURNING category_id
  `, [template.app_id, codes.categoryCode]);
  const categoryId = category.rows[0].category_id;

  await client.query(`
    INSERT INTO core.tool_category_visibility (category_id, channel_code)
    SELECT $1, channel_code
    FROM core.tool_category_visibility
    WHERE category_id = $2
    ON CONFLICT DO NOTHING
  `, [categoryId, template.category_id]);

  const tool = await client.query(`
    INSERT INTO core.tools (
      category_id, tool_code, name, label, description, script_repo_id, script_path,
      runtime_code, permission_code, risk_code, requires_confirmation, captures_output,
      allow_params, display_order, enabled, output_type, managed_by_skycommand
    )
    VALUES ($1, $2, 'recoveryProof', 'Recovery Proof',
      'Temporary failed-only recovery tool.', $3,
      'packages/ingestion/src/recovery/phase16RecoveryProof.js',
      $4, $5, $6, FALSE, TRUE, TRUE, 998, TRUE,
      'ingestion_run_summary.v1', FALSE)
    RETURNING tool_id
  `, [
    categoryId,
    codes.toolCode,
    template.script_repo_id,
    template.runtime_code,
    template.permission_code,
    template.risk_code,
  ]);
  const toolId = tool.rows[0].tool_id;

  await client.query(`
    INSERT INTO core.tool_visibility (tool_id, channel_code)
    SELECT $1, channel_code
    FROM core.tool_visibility
    WHERE tool_id = $2
    ON CONFLICT DO NOTHING
  `, [toolId, template.tool_id]);

  await client.query(`
    INSERT INTO data.ingestion_tool_profiles (
      tool_id, data_domain_id, source_id, adapter_code, contract_version,
      supports_incremental, supports_selected_assets, supports_backfill,
      supports_revisions, supports_resume, supports_dry_run,
      configuration, active
    )
    VALUES ($1, $2, $3, $4, 'ingestion_run_summary.v1',
      TRUE, TRUE, FALSE, TRUE, TRUE, FALSE,
      $5::jsonb, TRUE)
  `, [
    toolId,
    domainId,
    sourceId,
    codes.adapterCode,
    JSON.stringify({ runner: 'common_source_adapter', recovery: 'failed_only', ephemeral: true }),
  ]);

  const assets = {};
  for (const assetCode of ['ASSET_A', 'ASSET_B', 'ASSET_C']) {
    const assetResult = await client.query(`
      INSERT INTO data.assets (
        domain_id, asset_code, name, description, asset_kind_code,
        frequency_code, revisions_expected, active, configuration
      )
      VALUES ($1, $2, $2, 'Recovery proof asset.', 'TIME_SERIES',
        'DAILY', TRUE, TRUE, $3::jsonb)
      RETURNING asset_id
    `, [domainId, assetCode, JSON.stringify({ ephemeral: true })]);
    assets[assetCode] = assetResult.rows[0].asset_id;
    await client.query(`
      INSERT INTO data.asset_source_bindings (
        asset_id, source_id, provider_asset_code, source_frequency_code,
        primary_binding, active, configuration
      )
      VALUES ($1, $2, $3, 'DAILY', TRUE, TRUE, $4::jsonb)
    `, [assets[assetCode], sourceId, assetCode, JSON.stringify({ ephemeral: true })]);
  }

  return { domainId, sourceId, toolId, assets };
}

function createProofAdapter(codes, tempRoot, executedAssets) {
  return defineSourceAdapter({
    domainCode: codes.domainCode,
    sourceCode: codes.sourceCode,
    adapterCode: codes.adapterCode,
    resultContractVersion: 'ingestion_run_summary.v1',
    name: 'Recovery Proof',
    getAssets: async () => ['ASSET_A', 'ASSET_B', 'ASSET_C'],
    fetch: async (assetCode, tempDir) => {
      executedAssets.push(assetCode);
      fs.mkdirSync(tempDir, { recursive: true });
      const filePath = path.join(tempDir, `${assetCode}.csv`);
      fs.writeFileSync(filePath, 'date,value\n2026-08-01,2\n', 'utf8');
      return filePath;
    },
    load: async () => ({
      stagingRows: 1,
      stagingMinDate: '2026-08-01',
      stagingMaxDate: '2026-08-01',
      previousTargetMaxDate: '2026-07-31',
      newRowsDetected: 1,
      rowsInserted: 1,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsRejected: 0,
      revisionsDetected: 0,
      qualityIssueCount: 0,
      qualityStatusCode: 'PASS',
      currentTargetMaxDate: '2026-08-01',
    }),
    tempDir: tempRoot,
    defaultConcurrency: 1,
    maxConcurrency: 1,
    requestPolicyRequired: false,
    capabilities: {
      incremental: true,
      selectedAssets: true,
      backfill: false,
      revisions: true,
      resume: true,
      dryRun: false,
    },
  });
}

async function proof(pool) {
  const client = await pool.connect();
  const codes = createCodes();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-recovery-proof-'));
  const executedAssets = [];
  let transactionOpen = false;

  try {
    const template = await loadTemplate(client);
    const baseline = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM data.ingestion_recovery_requests)::int AS requests,
        (SELECT COUNT(*) FROM data.ingestion_runs)::int AS runs
    `);

    await client.query('BEGIN');
    transactionOpen = true;
    await insertFixture(client, template, codes);

    const original = await persistRunSummary({
      domainCode: codes.domainCode,
      sourceCode: codes.sourceCode,
      modeCode: 'INCREMENTAL',
      triggerCode: 'PROOF',
      selectedAssets: ['ASSET_A', 'ASSET_B', 'ASSET_C'],
      startedAt: new Date(Date.now() - 2000).toISOString(),
      completedAt: new Date(Date.now() - 1000).toISOString(),
      items: [
        {
          assetCode: 'ASSET_A',
          attemptNumber: 1,
          outcome: 'UPDATED',
          rowsStaged: 1,
          rowsDetectedAsNew: 1,
          rowsInserted: 1,
          currentTargetMaxDate: '2026-07-31',
        },
        {
          assetCode: 'ASSET_B',
          attemptNumber: 1,
          outcome: 'FAILED',
          retryable: false,
          errorCategoryCode: 'SOURCE_DATA',
          errorCode: 'SYNTHETIC_SOURCE_FAILURE',
          errorMessage: 'Synthetic source failure for recovery proof.',
        },
        {
          assetCode: 'ASSET_C',
          attemptNumber: 1,
          outcome: 'UNCHANGED',
          rowsStaged: 1,
          rowsUnchanged: 1,
          currentTargetMaxDate: '2026-07-31',
        },
      ],
      metadata: { phase: '16.7.1', fixture: true },
    }, {
      toolCode: codes.toolCode,
      summary: 'Synthetic partial run for failed-only recovery proof.',
    }, { client });

    assert(original.run.statusCode === 'PARTIAL', 'Original proof run must be PARTIAL.');

    const planned = await createRecoveryRequest({
      originalRunId: original.run.ingestionRunId,
      failedOnly: true,
      modeCode: 'INCREMENTAL',
      triggerCode: 'PROOF',
      requestContext: { requestedBy: 'phase16RecoveryProof' },
    }, { client });

    assert(planned.statusCode === 'PLANNED', 'Recovery request must begin PLANNED.');
    assert(
      JSON.stringify(planned.requestedAssets) === JSON.stringify(['ASSET_B']),
      'Failed-only plan must select only ASSET_B.',
    );

    // Simulate process reconstruction: no in-memory plan is carried into execution.
    const reconstructed = await getRecoveryRequest(planned.recoveryRequestId, {
      query: client.query.bind(client),
    });
    assert(reconstructed?.requestedAssets?.[0] === 'ASSET_B', 'Durable recovery request was not reconstructable.');

    const adapter = createProofAdapter(codes, tempRoot, executedAssets);
    const recovered = await executeRecoveryRequest({
      recoveryRequestId: reconstructed.recoveryRequestId,
      adapter,
      concurrency: 1,
      runId: 'phase16-recovery-proof',
    }, { client });

    assert(recovered.request.statusCode === 'COMPLETED', 'Recovery request did not complete.');
    assert(
      recovered.recoveryRun.run.resumedFromRunId === original.run.ingestionRunId,
      'Recovery run ancestry does not point to the original run.',
    );
    assert(
      JSON.stringify(executedAssets) === JSON.stringify(['ASSET_B']),
      `Only failed ASSET_B should execute; received ${executedAssets.join(', ')}.`,
    );
    assert(recovered.recoveryRun.run.totals.itemsRequested === 1, 'Recovery run should request one asset.');
    assert(recovered.recoveryRun.run.totals.itemsSucceeded === 1, 'Recovery run should recover one asset.');
    assert(recovered.recoveryRun.items.length === 1, 'Recovery ledger should contain one asset attempt.');

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    console.log('\nSkyCommand Phase 16.7.1 failed-only recovery portability proof');
    console.log('------------------------------------------------------------');
    console.log(`Domain: ${codes.domainCode}`);
    console.log(`Source: ${codes.sourceCode}`);
    console.log(`Original run: ${original.run.ingestionRunId}`);
    console.log(`Original status: ${original.run.statusCode}`);
    console.log(`Recovery request: ${planned.recoveryRequestId}`);
    console.log(`Requested assets: ${planned.requestedAssets.join(', ')}`);
    console.log(`Recovery run: ${recovered.recoveryRun.run.ingestionRunId}`);
    console.log(`Recovery status: ${recovered.recoveryRun.run.statusCode}`);
    console.log(`Executed assets: ${executedAssets.join(', ')}`);
    console.log('✅ A partial run produced a durable failed-only recovery request.');
    console.log('✅ Recovery intent was reconstructed from PostgreSQL without in-memory state.');
    console.log('✅ Only the failed asset was re-fetched and reloaded; successful assets were untouched.');
    console.log('✅ The recovery run preserved original-run ancestry and per-asset ledger evidence.');

    await client.query('ROLLBACK');
    transactionOpen = false;

    const residue = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM data.ingestion_recovery_requests)::int AS requests,
        (SELECT COUNT(*) FROM data.ingestion_runs)::int AS runs,
        (SELECT COUNT(*) FROM data.domains WHERE domain_code = $1)::int AS domains,
        (SELECT COUNT(*) FROM core.tools WHERE tool_code = $2)::int AS tools
    `, [codes.domainCode, codes.toolCode]);
    const baselineRow = baseline.rows[0];
    const residueRow = residue.rows[0];
    assert(residueRow.requests === baselineRow.requests, 'Recovery request count did not return to baseline.');
    assert(residueRow.runs === baselineRow.runs, 'Ingestion run count did not return to baseline.');
    assert(residueRow.domains === 0 && residueRow.tools === 0, 'Proof catalogue residue remains.');
    console.log('✅ Proof transaction rolled back cleanly and all counts returned to baseline.');
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
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
