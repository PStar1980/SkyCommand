const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { repositoryRoot } = require('../../../../_support/sourceTestBootstrap.js');
const {
  DEV_COMMIT_BOUNDARY_ERROR_CODE,
  DEV_COMMIT_BOUNDARY_PARAMETER_NAMES,
  getDevCommitBoundaryValidation,
} = require(path.join(repositoryRoot, 'packages/tools/src/devCommitParameterContract.js'));

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function assertValid(parameters) {
  assert.equal(getDevCommitBoundaryValidation('dev_commit', parameters), null);
}

assertValid({ repoName: 'SkyCommand', commitMessage: 'legacy/manual commit' });
assertValid({
  repoName: 'SkyCommand',
  commitMessage: 'governed R6 commit',
  finalizationWorkflowRunId: '7907e537-168d-4c20-bb5a-f7541952541f',
  workflowRunId: 'promotion-run-id',
});

for (const parameters of [
  {
    repoName: 'SkyCommand',
    commitMessage: 'missing promotion run id',
    finalizationWorkflowRunId: 'finalization-run-id',
  },
  {
    repoName: 'SkyCommand',
    commitMessage: 'missing finalization run id',
    workflowRunId: 'promotion-run-id',
  },
]) {
  const validation = getDevCommitBoundaryValidation('dev_commit', parameters);
  assert.equal(validation.code, DEV_COMMIT_BOUNDARY_ERROR_CODE);
  assert.deepEqual(validation.parameterNames, [...DEV_COMMIT_BOUNDARY_PARAMETER_NAMES]);
}

assertValid({
  repoName: 'SkyCommand',
  commitMessage: 'blank legacy values',
  finalizationWorkflowRunId: '',
  workflowRunId: null,
});

const boundaryMigration = read('packages/db_build/src/migrations/00145__dev_commit_r6_boundary_parameters.sql');
assert.doesNotMatch(boundaryMigration, /^\s*(BEGIN|COMMIT)\s*;\s*$/m);
assert.match(boundaryMigration, /'repoName'[\s\S]*?10/);
assert.match(boundaryMigration, /'commitMessage'[\s\S]*?20/);
assert.match(boundaryMigration, /'finalizationWorkflowRunId'[\s\S]*?30/);
assert.match(boundaryMigration, /'workflowRunId'[\s\S]*?40/);
assert.match(boundaryMigration, /required[\s\S]*?FALSE/);
assert.match(boundaryMigration, /argument_mode[\s\S]*?'POSITIONAL'/);

const gateMigration = read('packages/db_build/src/migrations/00161__development_promotion_secret_leak_gate.sql');
assert.match(gateMigration, /secret_leak_gate_node/);
assert.match(gateMigration, /repo_zip_node_to_secret_leak_gate_node/);
assert.match(gateMigration, /secret_leak_gate_node_to_dev_commit_node/);

const decouplingMigration = read('packages/db_build/src/migrations/00162__development_promotion_secret_leak_gate_decoupling.sql');
for (const parameterName of [
  'secretLeakGateSourceIdentityDigest',
  'secretLeakGateArtifactIdentityDigest',
  'secretLeakGateCapabilityCatalogJsonPath',
  'secretLeakGateCapabilityCatalogXlsxPath',
  'secretLeakGateRepositoryMapPath',
  'secretLeakGateRepositoryZipPath',
]) {
  assert.match(decouplingMigration, new RegExp(`'${parameterName}'`));
}
assert.match(decouplingMigration, /DELETE FROM core\.tool_parameters/);
assert.match(decouplingMigration, /SET input_parameters = baseline\.input_parameters/);
assert.match(decouplingMigration, /config = baseline\.config/);
assert.match(decouplingMigration, /pinnedVersionNumber', 24/);

for (const relativePath of [
  'apps/api/src/services/scriptExecutionService.js',
  'apps/worker/src/jobs/workerToolExecutionService.js',
]) {
  const source = read(relativePath);
  assert.match(source, /devCommitParameterContract/);
  assert.match(source, /getDevCommitBoundaryValidation\(toolCode, inputParameters\)/);
  assert.match(source, /Unknown parameter\(s\)/);
}

const devCommitSource = read('packages/git/src/dev_commit.js');
assert.match(devCommitSource, /finalizationWorkflowRunId/);
assert.match(devCommitSource, /workflowRunId/);
assert.match(devCommitSource, /R6_PROMOTION_COMMIT_BOUNDARY_ARGUMENTS_INVALID/);
assert.doesNotMatch(devCommitSource, /secretLeakGate|SECRET_LEAK_GATE/);

const hostActivitySource = read('packages/host-agent/src/activities.js');
assert.doesNotMatch(hostActivitySource, /secretLeakGateSourceIdentityDigest/);
assert.doesNotMatch(hostActivitySource, /secretLeakGateRepositoryZipPath/);

console.log('Dev Commit independent Tool contract self-test passed.');
