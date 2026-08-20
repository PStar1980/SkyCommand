const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const localSync = read('packages/git/src/local_repo_sync.js');
const workflow = read('packages/temporal/src/workflows/hostAgentWorkflow.js');
const workflowIndex = read('packages/temporal/src/workflows/index.js');
const worker = read('packages/host-agent/src/worker.js');
const activities = read('packages/host-agent/src/activities.js');
const migration = read('packages/db_build/src/migrations/00100__host_agent_local_repository_sync.sql');
const packageJson = JSON.parse(read('package.json'));
const envExample = read('.env.example');

assert.match(localSync, /skyCommandHostAgentToolWorkflow/);
assert.match(localSync, /SKYCOMMAND_HOST_AGENT_ENABLED/);
assert.match(localSync, /temporal_host_agent/);
assert.match(workflow, /isHealthProbe \? '3 seconds' : '45 seconds'/);
assert.match(workflow, /taskQueue:\s*hostTaskQueue/);
assert.match(workflowIndex, /hostAgentWorkflow/);
assert.match(worker, /SkyCommand Host Agent refuses Docker execution/);
assert.match(worker, /worker\.temporal_worker_heartbeats/);
assert.match(worker, /skycommand-host-agent-heartbeat/);
assert.match(worker, /Heartbeat persistence recovered/);
assert.match(worker, /PostgreSQL will be retried automatically/);
assert.match(activities, /LOCAL_REPOSITORY_SYNC_TOOL_CODE/);
assert.match(activities, /SKYCOMMAND_HOST_AGENT_TOOL_NOT_ALLOWED/);
assert.match(migration, /'admin-web'/);
assert.match(migration, /'api'/);
assert.match(migration, /'worker'/);
assert.match(migration, /local_repo_sync/);
assert.equal(packageJson.scripts['host-agent'], 'node packages/host-agent/src/worker.js');
assert.equal(packageJson.scripts['host-agent:check'], 'node packages/host-agent/src/health.js');
assert.match(envExample, /SKYCOMMAND_HOST_AGENT_ENABLED=false/);
assert.match(envExample, /SKYCOMMAND_HOST_AGENT_TASK_QUEUE=skycommand-host-local/);
assert.match(envExample, /SKYCOMMAND_HOST_AGENT_HEARTBEAT_DB_CONNECT_TIMEOUT_MS=3000/);

console.log('✅ SkyCommand Host Agent self-test passed.');
