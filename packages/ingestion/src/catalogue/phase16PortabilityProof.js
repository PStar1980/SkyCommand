#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

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

function createProofCodes() {
  const suffix = `${Date.now()}_${process.pid}`;
  const lowerSuffix = suffix.toLowerCase();

  return {
    domainCode: `PORTABILITY_PROOF_${suffix}`,
    sourceCode: `LOCAL_PROBE_${suffix}`,
    categoryCode: `phase16_portability_proof_${lowerSuffix}`,
    toolCode: `phase16_portability_probe_${lowerSuffix}`,
    adapterCode: 'PORTABILITY_PROBE',
  };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getDiscoveryCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::integer
       FROM data.vw_ingestion_tools
       WHERE discoverable = TRUE) AS discoverable_tools,
      (SELECT COUNT(*)::integer
       FROM data.vw_ingestion_sources
       WHERE discoverable = TRUE) AS discoverable_sources
  `);

  return {
    tools: toNumber(result.rows[0]?.discoverable_tools),
    sources: toNumber(result.rows[0]?.discoverable_sources),
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
    JOIN core.tool_categories category
      ON category.category_id = tool.category_id
    WHERE category.category_kind_code = 'INGESTION'
    ORDER BY tool.enabled DESC, tool.tool_code
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    throw new Error('No existing INGESTION tool is available as a safe catalogue template.');
  }

  return result.rows[0];
}

async function insertProofCatalogue(client, template, codes) {
  const domainResult = await client.query(
    `
      INSERT INTO data.domains (
        domain_code,
        name,
        description,
        contract_version,
        active,
        configuration
      )
      VALUES ($1, $2, $3, $4, TRUE, $5::jsonb)
      RETURNING domain_id
    `,
    [
      codes.domainCode,
      'Portable Ingestion Proof Domain',
      'Ephemeral non-macro domain used only inside the Phase 16.1 portability proof transaction.',
      'data_domain.v1',
      JSON.stringify({ ephemeral: true, phase: '16.1.3' }),
    ],
  );
  const domainId = domainResult.rows[0].domain_id;

  const sourceResult = await client.query(
    `
      INSERT INTO data.sources (
        domain_id,
        source_code,
        name,
        provider_name,
        provider_type,
        description,
        observability_enabled,
        active,
        configuration
      )
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE, $7::jsonb)
      RETURNING source_id
    `,
    [
      domainId,
      codes.sourceCode,
      'Synthetic Local Proof Source',
      'SkyCommand Phase 16 portability fixture',
      'SYNTHETIC',
      'Ephemeral non-macro source used to prove catalogue-driven discovery without core source registration.',
      JSON.stringify({ ephemeral: true, transport: 'LOCAL_FIXTURE' }),
    ],
  );
  const sourceId = sourceResult.rows[0].source_id;

  const categoryResult = await client.query(
    `
      INSERT INTO core.tool_categories (
        app_id,
        category_code,
        name,
        label,
        description,
        display_order,
        enabled,
        category_kind_code
      )
      VALUES ($1, $2, $3, $4, $5, 998, TRUE, 'INGESTION')
      RETURNING category_id
    `,
    [
      template.app_id,
      codes.categoryCode,
      'phase16_portability_proof',
      'Portable Proof Tools',
      'Ephemeral INGESTION category with a nonstandard code and label.',
    ],
  );
  const categoryId = categoryResult.rows[0].category_id;

  await client.query(
    `
      INSERT INTO core.tool_category_visibility (category_id, channel_code)
      SELECT $1, visibility.channel_code
      FROM core.tool_category_visibility visibility
      WHERE visibility.category_id = $2
      ON CONFLICT DO NOTHING
    `,
    [categoryId, template.category_id],
  );

  const toolResult = await client.query(
    `
      INSERT INTO core.tools (
        category_id,
        tool_code,
        name,
        label,
        description,
        script_repo_id,
        script_path,
        runtime_code,
        permission_code,
        risk_code,
        requires_confirmation,
        confirmation_text,
        captures_output,
        allow_params,
        display_order,
        enabled,
        output_type,
        output_schema_path,
        managed_by_skycommand
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        FALSE, NULL, TRUE, FALSE, 998, FALSE, $11, NULL, FALSE
      )
      RETURNING tool_id
    `,
    [
      categoryId,
      codes.toolCode,
      'portableIngestionProbe',
      'Portable Ingestion Probe',
      'Ephemeral non-macro ingestion tool used to prove semantic discovery and clean rollback.',
      template.script_repo_id,
      'packages/ingestion/src/catalogue/phase16PortabilityProof.js',
      template.runtime_code,
      template.permission_code,
      template.risk_code,
      'ingestion_run_summary.v1',
    ],
  );
  const toolId = toolResult.rows[0].tool_id;

  await client.query(
    `
      INSERT INTO core.tool_visibility (tool_id, channel_code)
      SELECT $1, visibility.channel_code
      FROM core.tool_visibility visibility
      WHERE visibility.tool_id = $2
      ON CONFLICT DO NOTHING
    `,
    [toolId, template.tool_id],
  );

  await client.query(
    `
      INSERT INTO data.ingestion_tool_profiles (
        tool_id,
        data_domain_id,
        source_id,
        adapter_code,
        contract_version,
        supports_incremental,
        supports_selected_assets,
        supports_backfill,
        supports_revisions,
        supports_resume,
        supports_dry_run,
        configuration,
        active
      )
      VALUES (
        $1, $2, $3, $4, $5,
        TRUE, TRUE, FALSE, FALSE, FALSE, TRUE,
        $6::jsonb, FALSE
      )
    `,
    [
      toolId,
      domainId,
      sourceId,
      codes.adapterCode,
      'ingestion_run_summary.v1',
      JSON.stringify({ ephemeral: true, proofMode: 'TRANSACTION_ROLLBACK' }),
    ],
  );

  return { domainId, sourceId, categoryId, toolId };
}

async function loadProofTool(client, toolCode) {
  const result = await client.query(
    `
      SELECT
        tool_id,
        tool_code,
        category_code,
        category_label,
        category_kind_code,
        script_path,
        adapter_code,
        contract_version,
        domain_code,
        source_code,
        visibility_channels,
        tool_enabled,
        profile_active,
        discoverable
      FROM data.vw_ingestion_tools
      WHERE tool_code = $1
    `,
    [toolCode],
  );

  return result.rows[0] || null;
}

async function loadProofSource(client, sourceCode) {
  const result = await client.query(
    `
      SELECT
        domain_code,
        source_code,
        tool_codes,
        adapter_codes,
        discoverable
      FROM data.vw_ingestion_sources
      WHERE source_code = $1
    `,
    [sourceCode],
  );

  return result.rows[0] || null;
}

async function verifyRolledBack(client, codes, baselineCounts) {
  const residueResult = await client.query(
    `
      SELECT
        EXISTS (SELECT 1 FROM data.domains WHERE domain_code = $1) AS domain_exists,
        EXISTS (SELECT 1 FROM data.sources WHERE source_code = $2) AS source_exists,
        EXISTS (SELECT 1 FROM core.tool_categories WHERE category_code = $3) AS category_exists,
        EXISTS (SELECT 1 FROM core.tools WHERE tool_code = $4) AS tool_exists
    `,
    [codes.domainCode, codes.sourceCode, codes.categoryCode, codes.toolCode],
  );

  const residue = residueResult.rows[0];
  const finalCounts = await getDiscoveryCounts(client);

  assert(!residue.domain_exists, 'Portability proof domain remained after rollback.');
  assert(!residue.source_exists, 'Portability proof source remained after rollback.');
  assert(!residue.category_exists, 'Portability proof category remained after rollback.');
  assert(!residue.tool_exists, 'Portability proof tool remained after rollback.');
  assert(
    finalCounts.tools === baselineCounts.tools,
    `Discoverable tool count did not return to baseline (${baselineCounts.tools} -> ${finalCounts.tools}).`,
  );
  assert(
    finalCounts.sources === baselineCounts.sources,
    `Discoverable source count did not return to baseline (${baselineCounts.sources} -> ${finalCounts.sources}).`,
  );

  return {
    clean: true,
    counts: finalCounts,
  };
}

function printProof(result) {
  console.log('\nSkyCommand Phase 16.1.3 portability closure proof');
  console.log('--------------------------------------------------');
  console.log(`Database: ${result.database}`);
  console.log(
    `Baseline discovery: ${result.baseline.tools} tool(s), ${result.baseline.sources} source(s)`,
  );
  console.log('Proof fixture: non-macro domain, synthetic source, unique INGESTION category');

  console.table([
    {
      stage: 'Disabled profile',
      presentInSemanticView: result.disabled.present,
      discoverable: result.disabled.discoverable,
      toolCount: result.disabled.counts.tools,
      sourceCount: result.disabled.counts.sources,
    },
    {
      stage: 'Enabled profile',
      presentInSemanticView: result.enabled.present,
      discoverable: result.enabled.discoverable,
      toolCount: result.enabled.counts.tools,
      sourceCount: result.enabled.counts.sources,
    },
    {
      stage: 'After rollback',
      presentInSemanticView: false,
      discoverable: false,
      toolCount: result.cleanup.counts.tools,
      sourceCount: result.cleanup.counts.sources,
    },
  ]);

  console.log(`Category code: ${result.fixture.categoryCode}`);
  console.log(`Category label: ${result.enabled.tool.category_label}`);
  console.log(`Domain: ${result.enabled.tool.domain_code}`);
  console.log(`Source: ${result.enabled.tool.source_code}`);
  console.log(`Adapter: ${result.enabled.tool.adapter_code}`);
  console.log(`Visibility: ${result.enabled.tool.visibility_channels.join(', ') || '(none)'}`);
  console.log('✅ New non-macro ingestion metadata was discovered without a core source registry change.');
  console.log('✅ Disabled metadata remained hidden from default discovery.');
  console.log('✅ Deferred profile guardrails passed when the fixture was enabled.');
  console.log('✅ The transaction was rolled back and all discovery counts returned to baseline.');
}

async function runPortabilityProof(pool) {
  const client = await pool.connect();
  const codes = createProofCodes();
  let transactionOpen = false;

  try {
    const databaseResult = await client.query('SELECT current_database() AS database');
    const database = databaseResult.rows[0].database;
    const baseline = await getDiscoveryCounts(client);
    const template = await loadTemplate(client);

    await client.query('BEGIN');
    transactionOpen = true;

    await insertProofCatalogue(client, template, codes);

    // Validate the disabled intermediate state before making the tool discoverable.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const disabledTool = await loadProofTool(client, codes.toolCode);
    const disabledCounts = await getDiscoveryCounts(client);

    assert(disabledTool, 'Disabled proof tool did not appear in the semantic ingestion view.');
    assert(disabledTool.category_kind_code === 'INGESTION', 'Proof category was not semantically INGESTION.');
    assert(disabledTool.discoverable === false, 'Disabled proof tool was unexpectedly discoverable.');
    assert(
      disabledCounts.tools === baseline.tools && disabledCounts.sources === baseline.sources,
      'Disabled proof metadata changed default discovery counts.',
    );

    // Re-defer guardrails so profile and tool activation can complete as one logical definition.
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query(
      'UPDATE data.ingestion_tool_profiles SET active = TRUE WHERE tool_id = $1',
      [disabledTool.tool_id],
    );
    await client.query('UPDATE core.tools SET enabled = TRUE WHERE tool_code = $1', [codes.toolCode]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    const enabledTool = await loadProofTool(client, codes.toolCode);
    const enabledSource = await loadProofSource(client, codes.sourceCode);
    const enabledCounts = await getDiscoveryCounts(client);

    assert(enabledTool, 'Enabled proof tool did not appear in the semantic ingestion view.');
    assert(enabledSource, 'Enabled proof source did not appear in the semantic source view.');
    assert(enabledTool.discoverable === true, 'Enabled proof tool was not discoverable.');
    assert(enabledSource.discoverable === true, 'Enabled proof source was not discoverable.');
    assert(enabledTool.domain_code === codes.domainCode, 'Proof tool domain did not resolve dynamically.');
    assert(enabledTool.source_code === codes.sourceCode, 'Proof tool source did not resolve dynamically.');
    assert(enabledTool.adapter_code === codes.adapterCode, 'Proof adapter metadata did not resolve dynamically.');
    assert(enabledTool.category_code === codes.categoryCode, 'Proof tool category code changed unexpectedly.');
    assert(enabledTool.category_label === 'Portable Proof Tools', 'Proof category label changed unexpectedly.');
    assert(
      enabledCounts.tools === baseline.tools + 1,
      `Expected one additional discoverable tool (${baseline.tools} -> ${baseline.tools + 1}), found ${enabledCounts.tools}.`,
    );
    assert(
      enabledCounts.sources === baseline.sources + 1,
      `Expected one additional discoverable source (${baseline.sources} -> ${baseline.sources + 1}), found ${enabledCounts.sources}.`,
    );
    assert(
      Array.isArray(enabledSource.tool_codes) && enabledSource.tool_codes.includes(codes.toolCode),
      'Proof source did not aggregate the dynamically discovered tool.',
    );

    await client.query('ROLLBACK');
    transactionOpen = false;

    const cleanup = await verifyRolledBack(client, codes, baseline);
    const result = {
      database,
      baseline,
      fixture: codes,
      disabled: {
        present: Boolean(disabledTool),
        discoverable: disabledTool.discoverable,
        counts: disabledCounts,
      },
      enabled: {
        present: Boolean(enabledTool),
        discoverable: enabledTool.discoverable,
        counts: enabledCounts,
        tool: enabledTool,
        source: enabledSource,
      },
      cleanup,
    };

    printProof(result);
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.message = `${error.message}; rollback also failed: ${rollbackError.message}`;
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const command = String(process.argv[2] || 'proof').trim().toLowerCase();
  if (!['proof', 'verify'].includes(command)) {
    throw new Error('Usage: phase16PortabilityProof.js proof');
  }

  const pool = createPool();
  try {
    await runPortabilityProof(pool);
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
  createProofCodes,
  getDiscoveryCounts,
  runPortabilityProof,
};
