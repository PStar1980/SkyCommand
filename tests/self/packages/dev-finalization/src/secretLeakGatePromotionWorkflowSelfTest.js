const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { repositoryRoot } = require('../../../../_support/sourceTestBootstrap.js');

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

const gateMigration = read('packages/db_build/src/migrations/00161__development_promotion_secret_leak_gate.sql');
const decouplingMigration = read('packages/db_build/src/migrations/00162__development_promotion_secret_leak_gate_decoupling.sql');
const devCommit = read('packages/git/src/dev_commit.js');
const workflowExecutor = read('apps/api/src/services/workflowExecutorService.js');
const preflight = read('packages/dev-finalization/src/promotionPreflight.js');

// The gate remains a standalone workflow Tool immediately before Dev Commit.
assert.match(gateMigration, /'secret_leak_gate_node'/);
assert.match(gateMigration, /'repo_zip_node_to_secret_leak_gate_node'/);
assert.match(gateMigration, /'secret_leak_gate_node_to_dev_commit_node'/);
assert.match(preflight, /secret_leak_gate_node/);
assert.match(preflight, /\['secret_leak_gate_node', 'dev_commit_node'\]/);

// 00161 is immutable historical ledgered source. 00162 removes the coupling it introduced.
assert.match(decouplingMigration, /DELETE FROM core\.tool_parameters/);
assert.match(decouplingMigration, /SET input_parameters = baseline\.input_parameters/);
assert.match(decouplingMigration, /config = baseline\.config/);
assert.match(decouplingMigration, /THEN 24[\s\S]*?ELSE 10/);
assert.match(decouplingMigration, /revalidateAtDevCommit/);

// Dev Commit is again ignorant of Secret Leak Gate and retains its own R6 boundary only.
assert.doesNotMatch(devCommit, /secretLeakGate|SECRET_LEAK_GATE/);
assert.match(devCommit, /validatePromotionCommitBoundary/);

// Generic workflow failure handling remains the gate enforcement mechanism.
const failedToolCheck = workflowExecutor.indexOf("result.status !== 'SUCCESS' || toolResult.success === false");
const failedToolThrow = workflowExecutor.indexOf('throw new WorkflowServiceError(', failedToolCheck);
assert.ok(failedToolCheck >= 0);
assert.ok(failedToolThrow > failedToolCheck);

console.log('Secret Leak Gate independent workflow composition self-test passed.');
