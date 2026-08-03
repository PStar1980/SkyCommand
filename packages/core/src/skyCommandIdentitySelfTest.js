const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../..');
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repositoryRoot, relativePath));

const packageJson = JSON.parse(read('package.json'));
assert.strictEqual(packageJson.name, 'skycommand');
assert.strictEqual(packageJson.scripts?.core, 'node packages/core/src/SkyCommand_Core.js');
assert.strictEqual(
  packageJson.scripts?.['skycommand-identity:verify'],
  'node packages/core/src/skyCommandIdentityVerification.js',
);
assert.strictEqual(
  packageJson.repository?.url,
  'git+https://github.com/PStar1980/SkyCommand.git',
);
assert.strictEqual(packageJson.bugs?.url, 'https://github.com/PStar1980/SkyCommand/issues');
assert.strictEqual(packageJson.homepage, 'https://github.com/PStar1980/SkyCommand#readme');

const packageLock = JSON.parse(read('package-lock.json'));
assert.strictEqual(packageLock.name, 'skycommand');
assert.strictEqual(packageLock.packages?.['']?.name, 'skycommand');

const renamedFiles = [
  'packages/core/src/SkyCommand_Core.js',
  'apps/worker/src/jobs/scheduledSkyCommandWorkflowRunner.js',
  'packages/temporal/src/activities/skyCommandWorkflowActivities.js',
  'packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js',
  'docs/SkyCommand_Temporal_Local_Setup.md',
  'docs/SkyCommand_Temporal_Workflow_Architecture_Plan.md',
  'packages/core/src/skyCommandIdentityVerification.js',
];
const obsoleteFiles = [
  'packages/core/src/SkyServer_Core.js',
  'apps/worker/src/jobs/scheduledSkyserverWorkflowRunner.js',
  'packages/temporal/src/activities/skyserverWorkflowActivities.js',
  'packages/temporal/src/workflows/skyserverWorkflowExecutorWorkflow.js',
  'docs/SkyServer_Temporal_Local_Setup.md',
  'docs/SkyServer_Temporal_Workflow_Architecture_Plan.md',
];

renamedFiles.forEach((relativePath) => {
  assert(exists(relativePath), `Canonical SkyCommand file is missing: ${relativePath}`);
});
obsoleteFiles.forEach((relativePath) => {
  assert(!exists(relativePath), `Obsolete SkyServer file must be removed: ${relativePath}`);
});

const envExample = read('.env.example');
[
  'SKYCOMMAND_INTERNAL_API_AUTH_ENABLED=',
  'SKYCOMMAND_INTERNAL_API_TOKEN=',
  'SKYCOMMAND_CORE_APP_CODE=',
  'SKYCOMMAND_CONFIG_PROFILE=',
  'SKYCOMMAND_CORE_WORKFLOW_EXECUTOR_MODE=',
  'TEMPORAL_TASK_QUEUE=skyserver-local',
  'TEMPORAL_FRED_WORKFLOW_ID_PREFIX=skycommand-fred-ingestion',
].forEach((marker) => {
  assert(envExample.includes(marker), `Canonical environment marker is missing: ${marker}`);
});

const authMiddleware = read('apps/api/src/middleware/authMiddleware.js');
assert(authMiddleware.includes("req.headers['x-skycommand-internal-token']"));
assert(authMiddleware.includes("req.headers['x-skyserver-internal-token']"));
assert(authMiddleware.includes('process.env.SKYCOMMAND_INTERNAL_API_TOKEN'));
assert(authMiddleware.includes('process.env.SKYSERVER_INTERNAL_API_TOKEN'));

const temporalWorkflows = read(
  'packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js',
);
assert(temporalWorkflows.includes('async function skyserverWorkflowExecutorWorkflow'));
assert(
  temporalWorkflows.includes(
    'skyCommandWorkflowExecutorWorkflow: skyserverWorkflowExecutorWorkflow',
  ),
  'Canonical source alias must preserve the stable Temporal workflow type.',
);

const identityMigration = read(
  'packages/db_build/src/migrations/00094__skycommand_repository_identity_changeover.sql',
);
assert(identityMigration.includes("repo_code = 'SkyCommand'"));
assert(identityMigration.includes('is_skycommand_repository = TRUE'));
assert(identityMigration.includes('https://github.com/PStar1980/SkyCommand.git'));
assert(identityMigration.includes('SkyCommand System\\SkyCommand'));
assert(identityMigration.includes("SKYSERVER_ADMIN, SKYSERVER_CORE, and SKYSERVER_WORKER"));
assert(!/UPDATE core\.config_profiles[^;]*updated_at/.test(identityMigration));

const identityVerification = read('packages/core/src/skyCommandIdentityVerification.js');
assert(identityVerification.includes("repo_code IN ('SkyServer', 'SkyCommand')"));
assert(identityVerification.includes('EXPECTED_REPOSITORY_URL'));
assert(identityVerification.includes('EXPECTED_DEV_PATH'));
assert(identityVerification.includes('ON tool.script_repo_id = repository.repo_id'));
assert(!identityVerification.includes('ON tool.repo_id = repository.repo_id'));

const readme = read('README.md');
assert(readme.startsWith('# SkyCommand\n'));
assert(readme.includes('https://github.com/PStar1980/SkyCommand'));
assert(readme.includes('stable PostgreSQL application keys'));
assert(readme.includes('retained as durable protocol identifiers'));

console.log('✅ SkyCommand repository identity changeover self-test passed.');
