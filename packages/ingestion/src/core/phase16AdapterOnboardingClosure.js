#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const { runSourceAdapter } = require('./sourceAdapter');
const {
  DEFAULT_ADAPTER_DIRECTORY,
  discoverSourceAdapters,
  validateAdapterProfileAlignment,
} = require('./sourceAdapterRegistry');

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
    domainCode: `ADAPTER_PROOF_${suffix}`,
    sourceCode: `LOCAL_SOURCE_${suffix}`,
    categoryCode: `phase16_adapter_proof_${lower}`,
    toolCode: `phase16_adapter_probe_${lower}`,
    adapterCode: `ADAPTER_PROBE_${suffix}`,
  };
}

async function loadProfiles(query) {
  const result = await query(`
    SELECT
      tool_code,
      adapter_code,
      contract_version,
      domain_code,
      source_code,
      supports_incremental,
      supports_selected_assets,
      supports_backfill,
      supports_revisions,
      supports_resume,
      supports_dry_run,
      profile_configuration,
      provider_type
    FROM data.vw_ingestion_tools
    WHERE discoverable = TRUE
    ORDER BY domain_code, source_code, tool_code
  `);
  return result.rows;
}

async function loadPolicyKeys(query) {
  const result = await query(`
    SELECT domain.domain_code, source.source_code
    FROM data.source_request_policies policy
    JOIN data.sources source ON source.source_id = policy.source_id
    JOIN data.domains domain ON domain.domain_id = source.domain_id
    WHERE policy.active = TRUE
  `);
  return new Set(result.rows.map((row) => `${row.domain_code}:${row.source_code}`));
}

async function verify(options = {}) {
  const query = options.query;
  if (typeof query !== 'function') throw new TypeError('verify requires query().');

  const [profiles, policyKeys] = await Promise.all([
    loadProfiles(query),
    loadPolicyKeys(query),
  ]);
  const registry = discoverSourceAdapters();
  const rows = [];
  const failures = [];

  for (const profile of profiles) {
    try {
      const adapter = registry.get(profile.adapter_code);
      validateAdapterProfileAlignment(adapter, profile);
      const policyRequired = adapter.requestPolicyRequired;
      const policyPresent = policyKeys.has(`${profile.domain_code}:${profile.source_code}`);
      if (policyRequired && !policyPresent) {
        throw new Error(`request policy missing for ${profile.domain_code}/${profile.source_code}`);
      }
      rows.push({
        tool: profile.tool_code,
        domain: profile.domain_code,
        source: profile.source_code,
        adapter: profile.adapter_code,
        contract: profile.contract_version,
        requestPolicy: policyRequired ? 'catalogue' : 'not required',
        aligned: true,
      });
    } catch (error) {
      failures.push(`${profile.tool_code}: ${error.message}`);
      rows.push({
        tool: profile.tool_code,
        domain: profile.domain_code,
        source: profile.source_code,
        adapter: profile.adapter_code,
        contract: profile.contract_version,
        requestPolicy: 'invalid',
        aligned: false,
      });
    }
  }

  const profiledAdapterCodes = new Set(profiles.map((profile) => profile.adapter_code));
  const unprofiledRuntimeAdapters = registry.list()
    .map(({ adapter }) => adapter.adapterCode)
    .filter((adapterCode) => !profiledAdapterCodes.has(adapterCode));

  if (profiles.length === 0) failures.push('no discoverable ingestion profiles found');
  if (unprofiledRuntimeAdapters.length > 0) {
    failures.push(`runtime adapters without active profiles: ${unprofiledRuntimeAdapters.join(', ')}`);
  }

  console.log('\nSkyCommand Phase 16.5.3 source-adapter onboarding contract');
  console.log('-----------------------------------------------------------');
  console.table(rows);
  console.log(`Runtime adapters: ${registry.size}`);
  console.log(`Discoverable ingestion profiles: ${profiles.length}`);
  console.log(`Active request policies: ${policyKeys.size}`);

  if (failures.length > 0) {
    throw new Error(`Adapter onboarding verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Every discoverable ingestion profile resolves to one runtime adapter.');
  console.log('✅ Domain, source, result contract, capabilities, and request-policy requirements align.');
  console.log('✅ Runtime adapter discovery requires no hard-coded source registry.');
  return { profiles: profiles.length, adapters: registry.size, policies: policyKeys.size };
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

function writeProofAdapter(directory, codes) {
  const modulePath = path.join(directory, 'portableProofAdapter.js');
  const sourceAdapterPath = path.resolve(__dirname, 'sourceAdapter.js');
  const tempRoot = path.join(directory, 'runtime');
  const source = `
const fs = require('fs');
const path = require('path');
const { defineSourceAdapter } = require(${JSON.stringify(sourceAdapterPath)});
module.exports = defineSourceAdapter({
  domainCode: ${JSON.stringify(codes.domainCode)},
  sourceCode: ${JSON.stringify(codes.sourceCode)},
  adapterCode: ${JSON.stringify(codes.adapterCode)},
  resultContractVersion: 'ingestion_run_summary.v1',
  name: 'Portable Adapter Proof',
  getAssets: async () => ['PROOF_ASSET'],
  fetch: async (code, tempDir) => {
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, code + '.csv');
    fs.writeFileSync(filePath, 'date,value\\n2026-07-31,1\\n', 'utf8');
    return filePath;
  },
  load: async () => ({
    stagingRows: 1,
    stagingMinDate: '2026-07-31',
    stagingMaxDate: '2026-07-31',
    newRowsDetected: 1,
    rowsInserted: 1,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsRejected: 0,
    currentTargetMaxDate: '2026-07-31',
  }),
  tempDir: ${JSON.stringify(tempRoot)},
  defaultConcurrency: 1,
  maxConcurrency: 1,
  requestPolicyRequired: false,
  capabilities: {
    incremental: false,
    selectedAssets: true,
    backfill: false,
    revisions: false,
    resume: false,
    dryRun: true,
  },
});
`;
  fs.writeFileSync(modulePath, source.trimStart(), 'utf8');
  return modulePath;
}

async function insertProofProfile(client, template, codes) {
  const domain = await client.query(`
    INSERT INTO data.domains (domain_code, name, description, contract_version, active, configuration)
    VALUES ($1, 'Adapter Onboarding Proof', 'Rollback-safe Phase 16.5.3 fixture.', 'data_domain.v1', TRUE, $2::jsonb)
    RETURNING domain_id
  `, [codes.domainCode, JSON.stringify({ ephemeral: true, phase: '16.5.3' })]);
  const domainId = domain.rows[0].domain_id;

  const source = await client.query(`
    INSERT INTO data.sources (
      domain_id, source_code, name, provider_name, provider_type,
      description, observability_enabled, active, configuration
    )
    VALUES ($1, $2, 'Local Adapter Proof', 'SkyCommand fixture', 'FILE',
      'Temporary source proving adapter onboarding.', FALSE, TRUE, $3::jsonb)
    RETURNING source_id
  `, [domainId, codes.sourceCode, JSON.stringify({ ephemeral: true })]);
  const sourceId = source.rows[0].source_id;

  const category = await client.query(`
    INSERT INTO core.tool_categories (
      app_id, category_code, name, label, description, display_order, enabled, category_kind_code
    )
    VALUES ($1, $2, 'phase16_adapter_proof', 'Adapter Proof Tools',
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
    VALUES ($1, $2, 'portableAdapterProof', 'Portable Adapter Proof',
      'Temporary adapter onboarding tool.', $3,
      'packages/ingestion/src/core/phase16AdapterOnboardingClosure.js',
      $4, $5, $6, FALSE, TRUE, FALSE, 998, TRUE,
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
      FALSE, TRUE, FALSE, FALSE, FALSE, TRUE,
      $5::jsonb, TRUE)
  `, [
    toolId,
    domainId,
    sourceId,
    codes.adapterCode,
    JSON.stringify({ runner: 'common_source_adapter', ephemeral: true }),
  ]);

  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  const profile = await client.query(`
    SELECT *
    FROM data.vw_ingestion_tools
    WHERE tool_code = $1 AND discoverable = TRUE
  `, [codes.toolCode]);
  if (profile.rows.length !== 1) throw new Error('Proof ingestion profile was not discoverable.');
  return profile.rows[0];
}

async function proof(pool) {
  const client = await pool.connect();
  const codes = createCodes();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-adapter-onboarding-proof-'));
  let transactionOpen = false;

  try {
    const baselineRegistry = discoverSourceAdapters();
    const template = await loadTemplate(client);
    writeProofAdapter(tempDirectory, codes);

    await client.query('BEGIN');
    transactionOpen = true;
    const profile = await insertProofProfile(client, template, codes);

    const registry = discoverSourceAdapters({
      directories: [DEFAULT_ADAPTER_DIRECTORY, tempDirectory],
      fresh: true,
    });
    const adapter = registry.get(codes.adapterCode);
    const alignment = validateAdapterProfileAlignment(adapter, profile);
    const result = await runSourceAdapter(adapter, {
      indicators: ['PROOF_ASSET'],
      concurrency: 1,
      runId: 'phase16-adapter-onboarding-proof',
      cleanupQuiet: true,
    });

    assert(registry.size === baselineRegistry.size + 1, 'Proof adapter was not auto-discovered.');
    assert(alignment.ok, 'Proof adapter did not align with its profile.');
    assert(result.ok === true, 'Proof adapter did not execute successfully.');
    assert(result.results?.length === 1, 'Proof adapter did not return one asset result.');
    assert(result.results[0].rowsInserted === 1, 'Proof adapter load evidence was incorrect.');

    await client.query('ROLLBACK');
    transactionOpen = false;

    const residue = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM data.domains WHERE domain_code = $1) AS domain_exists,
        EXISTS (SELECT 1 FROM data.sources WHERE source_code = $2) AS source_exists,
        EXISTS (SELECT 1 FROM core.tools WHERE tool_code = $3) AS tool_exists
    `, [codes.domainCode, codes.sourceCode, codes.toolCode]);
    assert(!residue.rows[0].domain_exists, 'Proof domain remained after rollback.');
    assert(!residue.rows[0].source_exists, 'Proof source remained after rollback.');
    assert(!residue.rows[0].tool_exists, 'Proof tool remained after rollback.');

    console.log('\nSkyCommand Phase 16.5.3 adapter onboarding portability proof');
    console.log('-----------------------------------------------------------');
    console.log(`Domain: ${codes.domainCode}`);
    console.log(`Source: ${codes.sourceCode}`);
    console.log(`Tool: ${codes.toolCode}`);
    console.log(`Adapter: ${codes.adapterCode}`);
    console.log(`Registry adapters: ${baselineRegistry.size} -> ${registry.size}`);
    console.log(`Executed asset: ${result.results[0].indicatorCode}`);
    console.log(`Rows inserted: ${result.results[0].rowsInserted}`);
    console.log('✅ Adding one adapter module and catalogue profile required no common-runner edit.');
    console.log('✅ Runtime contract matched domain, source, output contract, and capabilities.');
    console.log('✅ The new adapter executed through the same source-adapter runner.');
    console.log('✅ Proof catalogue records rolled back and the temporary module was removed.');
    return { alignment, result };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    }
    throw error;
  } finally {
    client.release();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  const pool = createPool();
  try {
    if (command === 'verify') {
      await verify({ query: pool.query.bind(pool) });
      return;
    }
    if (command === 'proof') {
      await proof(pool);
      return;
    }
    if (command === 'setup') {
      await verify({ query: pool.query.bind(pool) });
      await proof(pool);
      return;
    }
    throw new Error('Usage: phase16AdapterOnboardingClosure.js verify|proof|setup');
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
  proof,
  verify,
};
