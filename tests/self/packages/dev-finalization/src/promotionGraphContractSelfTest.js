const assert = require('node:assert/strict');
const path = require('node:path');

const { repositoryRoot } = require('../../../../_support/sourceTestBootstrap.js');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), quiet: true });
const { validatePromotionWorkflowGraph } = require(path.join(repositoryRoot, 'packages/dev-finalization/src/promotionPreflight'));

const PRIMARY_STAGE_KEYS = [
  'promotion_preflight_node',
  'capability_catalog_node',
  'repo_map_node',
  'repo_zip_node',
  'secret_leak_gate_node',
  'dev_commit_node',
  'github_dev_pr_merge_node',
  'merge_sync_node',
  'local_repo_sync_node',
  'dev_promotion_summary',
];

const ALTERNATE_STAGE_KEYS = [
  'promotion_preflight_node',
  'local_dev_pull_node',
  'capability_catalog_node',
  'repo_map_node',
  'repo_zip_node',
  'secret_leak_gate_node',
  'dev_commit_node',
  'github_dev_pr_merge_node',
  'merge_sync_node',
  'local_repo_sync_node',
  'dev_promotion_summary',
];

const TARGETS = {
  promotion_preflight_node: 'dev_promotion_preflight',
  local_dev_pull_node: 'local_dev_pull',
  capability_catalog_node: 'capability_catalog_export',
  repo_map_node: 'repo_map_generate',
  repo_zip_node: 'repo_zip_generate',
  secret_leak_gate_node: 'secret_leak_gate',
  dev_commit_node: 'dev_commit',
  github_dev_pr_merge_node: 'github_dev_pr_merge',
  merge_sync_node: 'main_merge',
  local_repo_sync_node: 'local_repo_sync',
  dev_promotion_summary: null,
};

function buildGraph({ workflowCode = 'skyserver_dev_commit', versionNumber = 24, stageKeys = PRIMARY_STAGE_KEYS } = {}) {
  return {
    workflowCode,
    versionNumber,
    status: 'PUBLISHED',
    nodes: stageKeys.map((nodeKey, index) => ({
      node_key: nodeKey,
      node_type_code: nodeKey === 'dev_promotion_summary' ? 'SUMMARY' : 'TOOL',
      target_code: TARGETS[nodeKey],
      display_order: (index + 1) * 10,
    })),
    edges: stageKeys.slice(0, -1).map((fromNodeKey, index) => ({
      edge_type: 'SEQUENTIAL',
      from_node_key: fromNodeKey,
      to_node_key: stageKeys[index + 1],
    })),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertValid(graph, message) {
  const result = validatePromotionWorkflowGraph(graph);
  assert.equal(result.valid, true, `${message}: ${result.violations.join(', ')}`);
}

function assertInvalid(graph, expectedViolation, message) {
  const result = validatePromotionWorkflowGraph(graph);
  assert.equal(result.valid, false, `${message}: graph unexpectedly passed`);
  assert.ok(result.violations.some((violation) => violation.startsWith(expectedViolation)), `${message}: ${result.violations.join(', ')}`);
}

assertValid(buildGraph(), 'current primary Secret Leak Gate graph');
assertValid(buildGraph({
  workflowCode: 'skycommand-dev-promo-alt',
  versionNumber: 10,
  stageKeys: ALTERNATE_STAGE_KEYS,
}), 'current alternate Secret Leak Gate graph');

{
  const graph = buildGraph();
  graph.edges = graph.edges.filter((edge) => !(
    (edge.from_node_key === 'repo_zip_node' && edge.to_node_key === 'secret_leak_gate_node') ||
    (edge.from_node_key === 'secret_leak_gate_node' && edge.to_node_key === 'dev_commit_node')
  ));
  graph.edges.push({ edge_type: 'SEQUENTIAL', from_node_key: 'repo_zip_node', to_node_key: 'dev_commit_node' });
  assertInvalid(graph, 'MUTATION_BYPASS', 'direct artifact to Dev Commit bypass');
}

{
  const graph = buildGraph();
  graph.edges = graph.edges.filter((edge) => !(edge.from_node_key === 'dev_commit_node' && edge.to_node_key === 'github_dev_pr_merge_node'));
  graph.edges.push({ edge_type: 'SEQUENTIAL', from_node_key: 'secret_leak_gate_node', to_node_key: 'github_dev_pr_merge_node' });
  assertInvalid(graph, 'MUTATION_BYPASS', 'Secret Leak Gate to GitHub PR merge bypass');
}

{
  const graph = buildGraph();
  const gate = graph.nodes.find((node) => node.node_key === 'secret_leak_gate_node');
  const commit = graph.nodes.find((node) => node.node_key === 'dev_commit_node');
  [gate.display_order, commit.display_order] = [commit.display_order, gate.display_order];
  assertInvalid(graph, 'CORE_STAGE_ORDER_INVALID', 'Dev Commit before Secret Leak Gate');
}

{
  const graph = buildGraph();
  const commit = graph.nodes.find((node) => node.node_key === 'dev_commit_node');
  const merge = graph.nodes.find((node) => node.node_key === 'github_dev_pr_merge_node');
  [commit.display_order, merge.display_order] = [merge.display_order, commit.display_order];
  assertInvalid(graph, 'CORE_STAGE_ORDER_INVALID', 'GitHub PR merge before Dev Commit');
}

{
  const graph = buildGraph();
  const prMerge = graph.nodes.find((node) => node.node_key === 'github_dev_pr_merge_node');
  const repoMerge = graph.nodes.find((node) => node.node_key === 'merge_sync_node');
  [prMerge.display_order, repoMerge.display_order] = [repoMerge.display_order, prMerge.display_order];
  assertInvalid(graph, 'CORE_STAGE_ORDER_INVALID', 'Repo Merge before GitHub PR merge');
}

{
  const graph = buildGraph();
  const repoMerge = graph.nodes.find((node) => node.node_key === 'merge_sync_node');
  const localSync = graph.nodes.find((node) => node.node_key === 'local_repo_sync_node');
  [repoMerge.display_order, localSync.display_order] = [localSync.display_order, repoMerge.display_order];
  assertInvalid(graph, 'CORE_STAGE_ORDER_INVALID', 'Local Repository Sync before Repo Merge');
}

{
  const graph = buildGraph();
  for (const node of graph.nodes) {
    if (node.display_order >= 40) node.display_order += 10;
  }
  graph.nodes.push({
    node_key: 'additional_evidence_node',
    node_type_code: 'CONDITION',
    target_code: null,
    display_order: 40,
  });
  graph.edges = graph.edges.filter((edge) => !(edge.from_node_key === 'repo_map_node' && edge.to_node_key === 'repo_zip_node'));
  graph.edges.push(
    { edge_type: 'SEQUENTIAL', from_node_key: 'repo_map_node', to_node_key: 'additional_evidence_node' },
    { edge_type: 'SEQUENTIAL', from_node_key: 'additional_evidence_node', to_node_key: 'repo_zip_node' },
  );
  assertValid(graph, 'additional non-mutating evidence node');
}

{
  const graph = buildGraph();
  graph.nodes.push({
    node_key: 'unregistered_evidence_node',
    node_type_code: 'TOOL',
    target_code: 'unregistered_tool',
    display_order: 40,
  });
  assertInvalid(graph, 'UNKNOWN_OR_MUTATING_NODE', 'unknown runtime-sensitive graph node');
}

{
  const graph = buildGraph({ versionNumber: 22 });
  assertInvalid(graph, 'PUBLISHED_VERSION_INVALID', 'wrong published workflow version');
}

{
  const graph = buildGraph();
  delete graph.versionNumber;
  assertInvalid(graph, 'PUBLISHED_VERSION_INVALID', 'missing published workflow version');
}

console.log('Promotion graph contract self-test passed.');
