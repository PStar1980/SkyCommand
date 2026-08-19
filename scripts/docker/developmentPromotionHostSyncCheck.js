#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env'), override: true });

const WORKFLOW_CODE = 'skyserver_dev_commit';
const EXPECTED_BINDINGS = {
  repoName: '{{ params.repoName }}',
  expectedLocalDevSha: '{{ nodes.dev_commit_node.output.currentHeadSha }}',
  expectedSynchronizedHeadSha: '{{ nodes.merge_sync_node.output.synchronizedHeadSha }}',
};

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const pool = new Pool({
    host: required('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: required('PGDATABASE'),
    user: required('PGUSER'),
    password: required('PGPASSWORD'),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });

  try {
    const definitionResult = await pool.query(
      `SELECT *
         FROM worker.vw_workflow_definitions
        WHERE workflow_code = $1
        LIMIT 1`,
      [WORKFLOW_CODE],
    );
    const definition = definitionResult.rows[0];

    if (!definition?.published_version_id) {
      throw new Error(`Published workflow ${WORKFLOW_CODE} was not found.`);
    }

    const [nodesResult, edgesResult, toolResult] = await Promise.all([
      pool.query(
        `SELECT node_key, node_type_code, display_name, target_code, input_parameters, display_order, config
           FROM worker.workflow_nodes
          WHERE workflow_version_id = $1
          ORDER BY display_order, node_key`,
        [definition.published_version_id],
      ),
      pool.query(
        `SELECT f.node_key AS from_node_key,
                t.node_key AS to_node_key,
                e.edge_type,
                e.edge_key
           FROM worker.workflow_edges e
           JOIN worker.workflow_nodes f ON f.workflow_node_id = e.from_node_id
           JOIN worker.workflow_nodes t ON t.workflow_node_id = e.to_node_id
          WHERE e.workflow_version_id = $1
          ORDER BY e.display_order, e.edge_key`,
        [definition.published_version_id],
      ),
      pool.query(
        `SELECT t.tool_code,
                t.enabled,
                ARRAY_AGG(v.channel_code ORDER BY v.channel_code) FILTER (WHERE v.channel_code IS NOT NULL) AS channels
           FROM core.tools t
           LEFT JOIN core.tool_visibility v ON v.tool_id = t.tool_id
          WHERE t.tool_code = 'local_repo_sync'
          GROUP BY t.tool_code, t.enabled`,
      ),
    ]);

    const nodes = nodesResult.rows;
    const edges = edgesResult.rows;
    const localNode = nodes.find((node) => node.node_key === 'local_repo_sync_node');
    const summaryNode = nodes.find((node) => node.node_key === 'dev_promotion_summary');
    const mergeNode = nodes.find((node) => node.node_key === 'merge_sync_node');
    const tool = toolResult.rows[0];

    if (!localNode || localNode.node_type_code !== 'TOOL' || localNode.target_code !== 'local_repo_sync') {
      throw new Error('Published Development Promotion is missing local_repo_sync_node -> local_repo_sync.');
    }
    if (!mergeNode || !summaryNode) {
      throw new Error('Published Development Promotion is missing merge_sync_node or dev_promotion_summary.');
    }

    for (const [key, expectedValue] of Object.entries(EXPECTED_BINDINGS)) {
      if (localNode.input_parameters?.[key] !== expectedValue) {
        throw new Error(
          `Local Repository Sync binding ${key} is '${localNode.input_parameters?.[key] || '<blank>'}', expected '${expectedValue}'.`,
        );
      }
    }

    const hasMergeToLocal = edges.some(
      (edge) => edge.from_node_key === 'merge_sync_node' && edge.to_node_key === 'local_repo_sync_node',
    );
    const hasLocalToSummary = edges.some(
      (edge) => edge.from_node_key === 'local_repo_sync_node' && edge.to_node_key === 'dev_promotion_summary',
    );
    const hasOldDirectEdge = edges.some(
      (edge) => edge.from_node_key === 'merge_sync_node' && edge.to_node_key === 'dev_promotion_summary',
    );

    if (!hasMergeToLocal || !hasLocalToSummary || hasOldDirectEdge) {
      throw new Error(
        `Workflow edge verification failed (merge->local=${hasMergeToLocal}, local->summary=${hasLocalToSummary}, oldDirect=${hasOldDirectEdge}).`,
      );
    }

    if (!tool?.enabled) {
      throw new Error('local_repo_sync tool is not enabled.');
    }

    const channels = new Set(tool.channels || []);
    for (const channel of ['admin-web', 'api', 'cli', 'worker']) {
      if (!channels.has(channel)) {
        throw new Error(`local_repo_sync visibility is missing channel '${channel}'.`);
      }
    }

    console.log(`[SkyCommand Development Promotion] workflow=${WORKFLOW_CODE}`);
    console.log(`[SkyCommand Development Promotion] publishedVersion=${definition.published_version_number}`);
    console.log(`[SkyCommand Development Promotion] nodes=${nodes.length} edges=${edges.length}`);
    console.log('[SkyCommand Development Promotion] route=merge_sync_node -> local_repo_sync_node -> dev_promotion_summary');
    console.log('[SkyCommand Development Promotion] repository={{ params.repoName }}');
    console.log('[SkyCommand Development Promotion] expectedLocalDevSha={{ nodes.dev_commit_node.output.currentHeadSha }}');
    console.log('[SkyCommand Development Promotion] expectedSynchronizedHeadSha={{ nodes.merge_sync_node.output.synchronizedHeadSha }}');
    console.log('[SkyCommand Development Promotion] Host Agent workflow integration check passed.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[SkyCommand Development Promotion] ERROR: ${error.message}`);
  process.exit(1);
});
