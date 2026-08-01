#!/usr/bin/env node

const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
let environmentLoaded = false;

function loadEnvironment() {
  if (environmentLoaded) return;
  require('dotenv').config({ path: path.join(REPOSITORY_ROOT, '.env') });
  environmentLoaded = true;
}

const EXPECTED_RUNTIME_PARAMETERS = [
  'fredResumeRunId', 'fredRecoveryMode', 'fredForceRefresh',
  'bocResumeRunId', 'bocRecoveryMode', 'bocForceRefresh',
  'statcanResumeRunId', 'statcanRecoveryMode', 'statcanForceRefresh',
];

const EXPECTED_NODE_PARAMETERS = {
  fred_ingestion: {
    resumeRunId: '{{ params.fredResumeRunId }}',
    recoveryMode: '{{ params.fredRecoveryMode }}',
    forceRefresh: '{{ params.fredForceRefresh }}',
  },
  boc_ingestion: {
    resumeRunId: '{{ params.bocResumeRunId }}',
    recoveryMode: '{{ params.bocRecoveryMode }}',
    forceRefresh: '{{ params.bocForceRefresh }}',
  },
  statcan_ingestion: {
    resumeRunId: '{{ params.statcanResumeRunId }}',
    recoveryMode: '{{ params.statcanRecoveryMode }}',
    forceRefresh: '{{ params.statcanForceRefresh }}',
  },
};

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createPool() {
  loadEnvironment();
  const { Pool } = require('pg');
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

async function verify(pool) {
  const definitionResult = await pool.query(`
    SELECT
      definition.workflow_code,
      definition.config->>'runtimeParameterVersion' AS runtime_parameter_version,
      COALESCE(definition.config->'runtimeParameters', '[]'::jsonb) AS runtime_parameters
    FROM worker.workflow_definitions definition
    WHERE definition.workflow_code = 'macro-refresh-pipeline'
    LIMIT 1
  `);
  assert(definitionResult.rows.length === 1, 'Macro Refresh Pipeline workflow definition was not found.');

  const definition = definitionResult.rows[0];
  const runtimeParameters = Array.isArray(definition.runtime_parameters)
    ? definition.runtime_parameters
    : [];
  const runtimeParameterKeys = new Set(runtimeParameters.map((parameter) => parameter?.key).filter(Boolean));
  const missingRuntimeParameters = EXPECTED_RUNTIME_PARAMETERS.filter((key) => !runtimeParameterKeys.has(key));

  const nodeResult = await pool.query(`
    SELECT
      node.node_key,
      node.input_parameters,
      version.version_number,
      version.status AS version_status
    FROM worker.workflow_nodes node
    JOIN worker.workflow_versions version
      ON version.workflow_version_id = node.workflow_version_id
    JOIN worker.workflow_definitions definition
      ON definition.workflow_definition_id = version.workflow_definition_id
    WHERE definition.workflow_code = 'macro-refresh-pipeline'
      AND node.node_key IN ('fred_ingestion', 'boc_ingestion', 'statcan_ingestion')
    ORDER BY version.version_number DESC, node.node_key
  `);

  const failures = [];
  if (missingRuntimeParameters.length > 0) {
    failures.push(`Missing runtime parameters: ${missingRuntimeParameters.join(', ')}`);
  }

  for (const row of nodeResult.rows) {
    const expected = EXPECTED_NODE_PARAMETERS[row.node_key];
    const actual = row.input_parameters || {};
    for (const [parameterName, expectedValue] of Object.entries(expected || {})) {
      if (actual[parameterName] !== expectedValue) {
        failures.push(
          `${row.node_key} v${row.version_number} ${parameterName} expected ${expectedValue}, found ${actual[parameterName] ?? '(missing)'}`,
        );
      }
    }
  }

  const newestByNode = new Map();
  for (const row of nodeResult.rows) {
    if (!newestByNode.has(row.node_key)) newestByNode.set(row.node_key, row);
  }
  for (const nodeKey of Object.keys(EXPECTED_NODE_PARAMETERS)) {
    if (!newestByNode.has(nodeKey)) failures.push(`Workflow node ${nodeKey} was not found.`);
  }

  console.log('\nSkyCommand Phase 16.7.3 workflow recovery parameter closure');
  console.log('------------------------------------------------------------');
  console.log(`Workflow: ${definition.workflow_code}`);
  console.log(`Runtime parameter version: ${definition.runtime_parameter_version || '(missing)'}`);
  console.log(`Recovery runtime parameters: ${EXPECTED_RUNTIME_PARAMETERS.length - missingRuntimeParameters.length}/${EXPECTED_RUNTIME_PARAMETERS.length}`);
  console.table([...newestByNode.values()].map((row) => ({
    node: row.node_key,
    workflowVersion: row.version_number,
    versionStatus: row.version_status,
    resumeRunId: row.input_parameters?.resumeRunId || null,
    recoveryMode: row.input_parameters?.recoveryMode || null,
    forceRefresh: row.input_parameters?.forceRefresh || null,
  })));

  if (failures.length > 0) {
    throw new Error(`Phase 16.7.3 workflow recovery verification failed: ${failures.join('; ')}`);
  }

  console.log('✅ Macro Refresh Pipeline exposes recovery inputs for FRED, Bank of Canada, and Statistics Canada.');
  console.log('✅ Published workflow nodes pass the runtime recovery values into the existing registered ingestion tools.');
  console.log('✅ Workflow recovery uses the same resume/mode/force-refresh contract as Run Tools, API, and CLI.');
}

async function main() {
  const pool = createPool();
  try {
    await verify(pool);
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
  EXPECTED_NODE_PARAMETERS,
  EXPECTED_RUNTIME_PARAMETERS,
  createPool,
  verify,
};
