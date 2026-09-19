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

const migration = read('packages/db_build/src/migrations/00145__dev_commit_r6_boundary_parameters.sql');
assert.doesNotMatch(migration, /^\s*(BEGIN|COMMIT)\s*;\s*$/m);
assert.match(migration, /'repoName'[\s\S]*?10/);
assert.match(migration, /'commitMessage'[\s\S]*?20/);
assert.match(migration, /'finalizationWorkflowRunId'[\s\S]*?30/);
assert.match(migration, /'workflowRunId'[\s\S]*?40/);
assert.match(migration, /required[\s\S]*?FALSE/);
assert.match(migration, /argument_mode[\s\S]*?'POSITIONAL'/);

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

console.log('Dev Commit R6 Tool contract self-test passed.');
