#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const dataCatalogueService = require('../catalogue/dataCatalogueService');
const dataConsumerService = require('../consumer/dataConsumerService');
const freshnessService = require('../freshness/freshnessService');
const qualityEvidenceService = require('../quality/qualityEvidenceService');
const ingestionLedgerService = require('../ledger/ingestionLedgerService');
const { fromAdapterBatchResult } = require('../ledger/ingestionRunResult');
const recoveryService = require('../recovery/ingestionRecoveryService');
const { runSourceAdapter } = require('../core/sourceAdapter');
const {
  DEFAULT_ADAPTER_DIRECTORY,
  discoverSourceAdapters,
  validateAdapterProfileAlignment,
} = require('../core/sourceAdapterRegistry');

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
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(text)) {
    throw new Error(`Unsafe proof identifier: ${value}`);
  }
  return `"${text}"`;
}

function createCodes() {
  const suffix = `${Date.now()}_${process.pid}`;
  const lower = suffix.toLowerCase();
  return {
    domainCode: `PROGRAM_EVALUATION_PROOF_${suffix}`,
    sourceCode: 'LOCAL_CASE_FILE',
    categoryCode: `phase16_closure_${lower}`,
    toolCode: `phase16_closure_ingestion_${lower}`,
    adapterCode: `PROGRAM_EVAL_PROBE_${suffix}`,
    schemaName: `phase16_closure_${lower}`.slice(0, 63),
    intakeAssetCode: 'CLIENT_INTAKE',
    accessAssetCode: 'SERVICE_ACCESS',
    metricCode: 'CLIENT_INTAKE_GROWTH',
    intakeTable: 'client_intake',
    accessTable: 'service_access',
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

  if (result.rows.length === 0) {
    throw new Error('No existing INGESTION tool is available as a visibility/runtime template.');
  }
  return result.rows[0];
}

function writeProofAdapter(directory, codes) {
  const modulePath = path.join(directory, 'phase16ClosureAdapter.js');
  const sourceAdapterPath = path.resolve(__dirname, '../core/sourceAdapter.js');
  const qualityPolicyPath = path.resolve(__dirname, '../quality/qualityPolicy.js');
  const copyLoaderPath = path.resolve(__dirname, '../loaders/copyLoader.js');
  const runtimeRoot = path.join(directory, 'runtime');
  const relations = {
    [codes.intakeAssetCode]: `${codes.schemaName}.${codes.intakeTable}`,
    [codes.accessAssetCode]: `${codes.schemaName}.${codes.accessTable}`,
  };

  const source = `
const fs = require('fs');
const path = require('path');
const { defineSourceAdapter } = require(${JSON.stringify(sourceAdapterPath)});
const { getAssetQualityContext } = require(${JSON.stringify(qualityPolicyPath)});
const { copyIntoRelation } = require(${JSON.stringify(copyLoaderPath)});

const DOMAIN_CODE = ${JSON.stringify(codes.domainCode)};
const SOURCE_CODE = ${JSON.stringify(codes.sourceCode)};
const INTAKE = ${JSON.stringify(codes.intakeAssetCode)};
const ACCESS = ${JSON.stringify(codes.accessAssetCode)};
const RELATIONS = ${JSON.stringify(relations)};
let accessFetchCount = 0;

function csvFor(code) {
  if (code === INTAKE) {
    return 'edate,value\\n2026-01-01,100\\n2026-02-01,120\\n2026-04-01,180\\n';
  }
  return 'edate,value\\n2026-01-01,50\\n2026-02-01,60\\n2026-04-01,90\\n';
}

module.exports = defineSourceAdapter({
  domainCode: DOMAIN_CODE,
  sourceCode: SOURCE_CODE,
  adapterCode: ${JSON.stringify(codes.adapterCode)},
  resultContractVersion: 'ingestion_run_summary.v1',
  name: 'Program Evaluation Portability Proof',
  getAssets: async () => [INTAKE, ACCESS],
  fetch: async (code, tempDir) => {
    if (code === ACCESS) {
      accessFetchCount += 1;
      if (accessFetchCount === 1) {
        const error = new Error('Synthetic first-pass source failure for failed-only recovery proof.');
        error.code = 'PROOF_INITIAL_SOURCE_FAILURE';
        error.errorCategoryCode = 'SOURCE_DATA';
        throw error;
      }
    }

    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, code + '.csv');
    fs.writeFileSync(filePath, csvFor(code), 'utf8');
    return filePath;
  },
  load: async (code, filePath) => {
    const qualityContext = await getAssetQualityContext(DOMAIN_CODE, SOURCE_CODE, code);
    return copyIntoRelation({
      assetCode: code,
      relationName: RELATIONS[code],
      filePath,
      qualityContext,
    });
  },
  tempDir: ${JSON.stringify(runtimeRoot)},
  defaultConcurrency: 1,
  maxConcurrency: 2,
  requestPolicyRequired: false,
  capabilities: {
    incremental: true,
    selectedAssets: true,
    backfill: false,
    revisions: true,
    resume: true,
    dryRun: false,
  },
  metadata: {
    proof: 'phase16.8.3',
    domainNeutral: true,
  },
});
`;

  fs.writeFileSync(modulePath, source.trimStart(), 'utf8');
  return modulePath;
}

async function insertAsset(client, input) {
  const result = await client.query(`
    INSERT INTO data.assets (
      domain_id, asset_code, name, description, asset_kind_code,
      frequency_code, unit_code, geography_code, transform_code,
      release_lag_days, freshness_tolerance_days, revisions_expected,
      storage_schema_name, storage_relation_name, storage_date_column, storage_value_column,
      contract_version, active, configuration
    )
    VALUES (
      $1, $2, $3, $4, 'TIME_SERIES',
      'MONTHLY', 'COUNT', 'LOCAL', 'IDENTITY',
      0, 45, TRUE,
      $5, $6, 'edate', 'value',
      'data_asset.v1', TRUE, $7::jsonb
    )
    RETURNING asset_id
  `, [
    input.domainId,
    input.assetCode,
    input.name,
    input.description,
    input.schemaName,
    input.tableName,
    JSON.stringify({ ephemeral: true, phase: '16.8.3', businessDomain: 'PROGRAM_EVALUATION' }),
  ]);

  await client.query(`
    INSERT INTO data.asset_source_bindings (
      asset_id, source_id, provider_asset_code, source_frequency_code,
      transform_code, primary_binding, active, configuration
    )
    VALUES ($1, $2, $3, 'MONTHLY', 'IDENTITY', TRUE, TRUE, $4::jsonb)
  `, [
    result.rows[0].asset_id,
    input.sourceId,
    input.assetCode,
    JSON.stringify({ unitCode: 'COUNT', ephemeral: true }),
  ]);

  return result.rows[0].asset_id;
}

async function createFixture(pool, codes) {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const template = await loadTemplate(client);
    await client.query('BEGIN');
    transactionOpen = true;

    const schema = safeIdentifier(codes.schemaName);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TABLE ${schema}.${safeIdentifier(codes.intakeTable)} (edate DATE PRIMARY KEY, value NUMERIC)`);
    await client.query(`CREATE TABLE ${schema}.${safeIdentifier(codes.accessTable)} (edate DATE PRIMARY KEY, value NUMERIC)`);

    const domainResult = await client.query(`
      INSERT INTO data.domains (
        domain_code, name, description, schema_name, contract_version, active, configuration
      )
      VALUES ($1, 'Program Evaluation Proof',
        'Temporary non-macro domain proving the complete Phase 16 portable ingestion contract.',
        $2, 'data_domain.v1', TRUE, $3::jsonb)
      RETURNING domain_id
    `, [codes.domainCode, codes.schemaName, JSON.stringify({ ephemeral: true, phase: '16.8.3' })]);
    const domainId = domainResult.rows[0].domain_id;

    const sourceResult = await client.query(`
      INSERT INTO data.sources (
        domain_id, source_code, name, provider_name, provider_type,
        description, observability_enabled, active, configuration
      )
      VALUES ($1, $2, 'Local Program File', 'SkyCommand portability fixture', 'FILE',
        'Synthetic program-evaluation source used only for the final Phase 16 proof.',
        TRUE, TRUE, $3::jsonb)
      RETURNING source_id
    `, [domainId, codes.sourceCode, JSON.stringify({ ephemeral: true, noSecrets: true })]);
    const sourceId = sourceResult.rows[0].source_id;

    const intakeAssetId = await insertAsset(client, {
      domainId,
      sourceId,
      assetCode: codes.intakeAssetCode,
      name: 'Client Intake Volume',
      description: 'Monthly client intake count.',
      schemaName: codes.schemaName,
      tableName: codes.intakeTable,
    });
    await insertAsset(client, {
      domainId,
      sourceId,
      assetCode: codes.accessAssetCode,
      name: 'Service Access Volume',
      description: 'Monthly clients reaching service.',
      schemaName: codes.schemaName,
      tableName: codes.accessTable,
    });

    const metricResult = await client.query(`
      INSERT INTO data.metrics (
        domain_id, metric_code, name, description, metric_kind_code,
        frequency_code, unit_code, definition, contract_version, active, configuration
      )
      VALUES ($1, $2, 'Client Intake Growth',
        'Month-over-month percentage change in client intake volume.',
        'DERIVED', 'MONTHLY', 'PERCENT', $3::jsonb, 'data_metric.v1', TRUE, $4::jsonb)
      RETURNING metric_id
    `, [
      domainId,
      codes.metricCode,
      JSON.stringify({ operator: 'PCT_CHANGE', periods: 1, multiplier: 100 }),
      JSON.stringify({ ephemeral: true, phase: '16.8.3' }),
    ]);

    await client.query(`
      INSERT INTO data.metric_dependencies (
        metric_id, asset_id, dependency_role_code, dependency_order, active, configuration
      )
      VALUES ($1, $2, 'INPUT', 1, TRUE, $3::jsonb)
    `, [metricResult.rows[0].metric_id, intakeAssetId, JSON.stringify({ ephemeral: true })]);

    await client.query(`
      INSERT INTO data.source_quality_policies (
        source_id, check_code, enabled, severity_code, blocking, parameters, active
      )
      VALUES
        ($1, 'FREQUENCY_INCOMPATIBLE', TRUE, 'ERROR', TRUE, '{}'::jsonb, TRUE),
        ($1, 'SOURCE_DATE_REGRESSION', TRUE, 'WARNING', FALSE, '{}'::jsonb, TRUE),
        ($1, 'UNEXPECTED_GAP', TRUE, 'WARNING', FALSE, '{"maxGapDays":45}'::jsonb, TRUE)
    `, [sourceId]);

    const categoryResult = await client.query(`
      INSERT INTO core.tool_categories (
        app_id, category_code, name, label, description,
        display_order, enabled, category_kind_code
      )
      VALUES ($1, $2, 'phase16ClosureProof', 'Portable Data Proof',
        'Temporary semantic INGESTION category with a non-macro source.',
        997, TRUE, 'INGESTION')
      RETURNING category_id
    `, [template.app_id, codes.categoryCode]);
    const categoryId = categoryResult.rows[0].category_id;

    await client.query(`
      INSERT INTO core.tool_category_visibility (category_id, channel_code)
      SELECT $1, channel_code
      FROM core.tool_category_visibility
      WHERE category_id = $2
      ON CONFLICT DO NOTHING
    `, [categoryId, template.category_id]);

    const toolResult = await client.query(`
      INSERT INTO core.tools (
        category_id, tool_code, name, label, description,
        script_repo_id, script_path, runtime_code, permission_code, risk_code,
        requires_confirmation, captures_output, allow_params,
        display_order, enabled, output_type, managed_by_skycommand
      )
      VALUES (
        $1, $2, 'phase16ClosureIngestion', 'Program Evaluation Ingestion Proof',
        'Temporary non-macro ingestion tool used by the final Phase 16 portability proof.',
        $3, 'packages/ingestion/src/closure/phase16PortabilityClosure.js',
        $4, $5, $6,
        FALSE, TRUE, TRUE,
        997, TRUE, 'ingestion_run_summary.v1', FALSE
      )
      RETURNING tool_id
    `, [
      categoryId,
      codes.toolCode,
      template.script_repo_id,
      template.runtime_code,
      template.permission_code,
      template.risk_code,
    ]);
    const toolId = toolResult.rows[0].tool_id;

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
      VALUES (
        $1, $2, $3, $4, 'ingestion_run_summary.v1',
        TRUE, TRUE, FALSE,
        TRUE, TRUE, FALSE,
        $5::jsonb, TRUE
      )
    `, [
      toolId,
      domainId,
      sourceId,
      codes.adapterCode,
      JSON.stringify({ runner: 'common_source_adapter', ephemeral: true, phase: '16.8.3' }),
    ]);

    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');
    transactionOpen = false;

    const profileResult = await pool.query(`
      SELECT *
      FROM data.vw_ingestion_tools
      WHERE tool_code = $1 AND discoverable = TRUE
    `, [codes.toolCode]);
    if (profileResult.rows.length !== 1) {
      throw new Error('Final proof ingestion profile was not discoverable after commit.');
    }

    return {
      domainId,
      sourceId,
      toolId,
      categoryId,
      profile: profileResult.rows[0],
    };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_) { /* best effort */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(pool, codes) {
  const domainResult = await pool.query(
    'SELECT domain_id FROM data.domains WHERE domain_code = $1 LIMIT 1',
    [codes.domainCode],
  );
  const domainId = domainResult.rows[0]?.domain_id || null;

  if (domainId) {
    await pool.query('DELETE FROM data.ingestion_recovery_requests WHERE domain_id = $1', [domainId]);
    await pool.query('DELETE FROM data.ingestion_runs WHERE domain_id = $1', [domainId]);
  }

  await pool.query('DELETE FROM core.tools WHERE tool_code = $1', [codes.toolCode]);
  await pool.query('DELETE FROM core.tool_categories WHERE category_code = $1', [codes.categoryCode]);
  await pool.query('DELETE FROM data.domains WHERE domain_code = $1', [codes.domainCode]);
  await pool.query(`DROP SCHEMA IF EXISTS ${safeIdentifier(codes.schemaName)} CASCADE`);
}

async function assertClean(pool, codes) {
  const result = await pool.query(`
    SELECT
      EXISTS (SELECT 1 FROM data.domains WHERE domain_code = $1) AS domain_exists,
      EXISTS (SELECT 1 FROM core.tools WHERE tool_code = $2) AS tool_exists,
      EXISTS (SELECT 1 FROM core.tool_categories WHERE category_code = $3) AS category_exists,
      to_regnamespace($4) IS NOT NULL AS schema_exists
  `, [codes.domainCode, codes.toolCode, codes.categoryCode, codes.schemaName]);
  const row = result.rows[0];
  assert(!row.domain_exists, 'Proof domain remained after cleanup.');
  assert(!row.tool_exists, 'Proof tool remained after cleanup.');
  assert(!row.category_exists, 'Proof category remained after cleanup.');
  assert(!row.schema_exists, 'Proof storage schema remained after cleanup.');
}

async function runProof(pool) {
  const codes = createCodes();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-phase16-closure-'));

  try {
    const baselineRegistry = discoverSourceAdapters();
    const fixture = await createFixture(pool, codes);
    writeProofAdapter(tempDirectory, codes);

    const registry = discoverSourceAdapters({
      directories: [DEFAULT_ADAPTER_DIRECTORY, tempDirectory],
      fresh: true,
    });
    const adapter = registry.get(codes.adapterCode);
    const alignment = validateAdapterProfileAlignment(adapter, fixture.profile);

    assert(registry.size === baselineRegistry.size + 1, 'Temporary adapter was not auto-discovered.');
    assert(alignment.ok, 'Temporary adapter did not align with its PostgreSQL profile.');

    const firstBatch = await runSourceAdapter(adapter, {
      indicators: [codes.intakeAssetCode, codes.accessAssetCode],
      concurrency: 1,
      runId: 'phase16-final-portability-initial',
      cleanupQuiet: true,
    });
    assert(firstBatch.ok === false, 'Initial proof run was expected to be partial.');

    const firstSummary = fromAdapterBatchResult(firstBatch, {
      domainCode: codes.domainCode,
      sourceCode: codes.sourceCode,
      triggerCode: 'PROOF',
      metadata: { phase: '16.8.3', portabilityProof: true },
    });
    const firstRun = await ingestionLedgerService.persistRunSummary(firstSummary, {
      toolCode: codes.toolCode,
      triggerCode: 'PROOF',
      summary: 'Initial non-macro portability proof run with one synthetic source failure.',
      metadata: { phase: '16.8.3', stage: 'initial_partial' },
    });

    assert(firstRun.run.statusCode === 'PARTIAL', 'Initial durable run did not resolve to PARTIAL.');
    assert(firstRun.run.totals.itemsSucceeded === 1, 'Initial durable run should have one successful asset.');
    assert(firstRun.run.totals.itemsFailed === 1, 'Initial durable run should have one failed asset.');

    await freshnessService.refreshFreshnessSnapshots({
      sourceCode: codes.sourceCode,
      asOf: '2026-05-20T00:00:00.000Z',
    });

    const request = await recoveryService.createRecoveryRequest({
      originalRunId: firstRun.run.ingestionRunId,
      failedOnly: true,
      modeCode: 'INCREMENTAL',
      triggerCode: 'RECOVERY',
      metadata: { phase: '16.8.3', portabilityProof: true },
    });
    assert(
      request.requestedAssets.length === 1 && request.requestedAssets[0] === codes.accessAssetCode,
      'Failed-only recovery did not select exactly SERVICE_ACCESS.',
    );

    const recovery = await recoveryService.executeRecoveryRequest({
      recoveryRequestId: request.recoveryRequestId,
      adapter,
      concurrency: 1,
      runId: 'phase16-final-portability-recovery',
    });
    assert(recovery.request.statusCode === 'COMPLETED', 'Recovery request did not complete.');
    assert(recovery.recoveryRun.run.statusCode === 'SUCCESS', 'Recovery child run did not succeed.');
    assert(
      recovery.recoveryRun.run.selectedAssets.length === 1
        && recovery.recoveryRun.run.selectedAssets[0] === codes.accessAssetCode,
      'Recovery child run included a previously successful asset.',
    );

    await freshnessService.refreshFreshnessSnapshots({
      sourceCode: codes.sourceCode,
      asOf: '2026-05-20T00:00:00.000Z',
    });

    const [domains, assets, metrics, observations, metricObservations, intakeFreshness, accessFreshness,
      runs, recoveries, qualityEvents] = await Promise.all([
      dataCatalogueService.listDomains({ active: true }),
      dataCatalogueService.listAssets({ domainCode: codes.domainCode, limit: 10 }),
      dataCatalogueService.listMetrics({ domainCode: codes.domainCode, limit: 10 }),
      dataConsumerService.listAssetObservations(
        codes.domainCode,
        codes.intakeAssetCode,
        { sortDirection: 'DESC', limit: 5 },
      ),
      dataConsumerService.listMetricObservations(
        codes.domainCode,
        codes.metricCode,
        { sortDirection: 'DESC', limit: 5 },
      ),
      freshnessService.getFreshness(codes.domainCode, codes.intakeAssetCode),
      freshnessService.getFreshness(codes.domainCode, codes.accessAssetCode),
      ingestionLedgerService.listRuns({ domainCode: codes.domainCode, limit: 10 }),
      recoveryService.listRecoveryRequests({ domainCode: codes.domainCode, limit: 10 }),
      qualityEvidenceService.listQualityEvents({ domainCode: codes.domainCode, limit: 20 }),
    ]);

    const discoveredDomain = domains.find((item) => item.domainCode === codes.domainCode);
    assert(discoveredDomain, 'Non-macro domain was not discoverable.');
    assert(assets.total === 2, 'Expected two non-macro assets in the generic catalogue.');
    assert(metrics.total === 1, 'Expected one non-macro metric in the generic catalogue.');
    assert(observations.contractVersion === 'time_series_observations.v1', 'Asset contract mismatch.');
    assert(observations.total === 3, 'Client-intake observation contract returned the wrong row count.');
    assert(metricObservations.contractVersion === 'metric_observations.v1', 'Metric contract mismatch.');
    assert(metricObservations.operator === 'PCT_CHANGE', 'Derived metric did not use PCT_CHANGE.');
    assert(metricObservations.total === 2, 'Derived metric should expose two computable changes.');
    assert(Number(metricObservations.items[0]?.value) === 50, 'Latest client-intake growth should be 50%.');
    assert(intakeFreshness?.evidence?.targetRowCount === 3, 'Client-intake freshness lacks storage evidence.');
    assert(accessFreshness?.evidence?.targetRowCount === 3, 'Service-access freshness lacks recovered storage evidence.');
    assert(runs.total === 2, 'Expected initial and recovery ingestion runs.');
    assert(recoveries.total === 1 && recoveries.items[0].statusCode === 'COMPLETED',
      'Recovery history was not exposed by the generic service.');
    assert(qualityEvents.total >= 2, 'Expected portable unexpected-gap quality evidence for both assets.');

    console.log('\nSkyCommand Phase 16.8.3 final non-macro portability proof');
    console.log('--------------------------------------------------------');
    console.log(`Domain: ${codes.domainCode}`);
    console.log(`Source: ${codes.sourceCode}`);
    console.log(`Tool: ${codes.toolCode}`);
    console.log(`Adapter registry: ${baselineRegistry.size} -> ${registry.size}`);
    console.log(`Assets: ${assets.items.map((item) => item.assetCode).join(', ')}`);
    console.log(`Metric: ${codes.metricCode} (${metricObservations.operator})`);
    console.log(`Initial run: ${firstRun.run.statusCode}`);
    console.log(`Recovery run: ${recovery.recoveryRun.run.statusCode}`);
    console.log(`Recovered assets: ${recovery.request.requestedAssets.join(', ')}`);
    console.log(`Observation rows: ${observations.total}`);
    console.log(`Latest metric value: ${metricObservations.items[0]?.value}`);
    console.log(`Quality events: ${qualityEvents.total}`);
    console.log(`Freshness: ${intakeFreshness.freshness.reasonCode}, ${accessFreshness.freshness.reasonCode}`);
    console.log('✅ A non-macro domain, source, time-series assets, and metric were discovered from PostgreSQL metadata.');
    console.log('✅ A new adapter module joined the common runner without a core source-list edit.');
    console.log('✅ The initial partial run persisted generic item, quality, and freshness evidence.');
    console.log('✅ Failed-only recovery executed SERVICE_ACCESS while leaving CLIENT_INTAKE untouched.');
    console.log('✅ Generic observation and derived-metric contracts queried the non-macro storage.');
    console.log('✅ Generic catalogue, ledger, freshness, quality, recovery, and consumer services required no macro-specific branch.');
  } finally {
    try {
      await cleanupFixture(pool, codes);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  }

  await assertClean(pool, codes);
  console.log('✅ Temporary adapter, tool, catalogue metadata, evidence, and storage were removed cleanly.');
}

async function main() {
  const pool = createPool();
  try {
    await runProof(pool);
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

module.exports = {
  createCodes,
  runProof,
  writeProofAdapter,
};
