const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(sourceDir, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const localSync = read('packages/git/src/local_repo_sync.js');
const localDevPull = read('packages/git/src/local_dev_pull.js');
const mainMerge = read('packages/git/src/main_merge.js');
const workflow = read('packages/temporal/src/workflows/hostAgentWorkflow.js');
const workflowIndex = read('packages/temporal/src/workflows/index.js');
const worker = read('packages/host-agent/src/worker.js');
const activities = read('packages/host-agent/src/activities.js');
const dockerEventBridge = read('packages/host-agent/src/dockerEventBridge.js');
const dockerTelemetryBridge = read('packages/host-agent/src/dockerTelemetryBridge.js');
const dockerResource = read('packages/host-agent/src/dockerResource.js');
const migration = read('packages/db_build/src/migrations/00100__host_agent_local_repository_sync.sql');
const packageJson = JSON.parse(read('package.json'));
const envExample = read('.env.example');
const supervisorTaskScript = read('scripts/powershell/SkyCommand-SupervisorTask.ps1');
const { executeSupervisorProcessLifecycle } = require(path.join(
  repoRoot,
  'packages/host-agent/src/supervisorProcessLifecycle.js',
));

assert.match(localSync, /skyCommandHostAgentToolWorkflow/);
assert.match(localSync, /SKYCOMMAND_HOST_AGENT_ENABLED/);
assert.match(localSync, /temporal_host_agent/);
assert.match(localDevPull, /skyCommandHostAgentToolWorkflow/);
assert.match(localDevPull, /temporal_host_agent/);
assert.match(localDevPull, /REMOTE_NOT_AHEAD/);
assert.match(localDevPull, /merge', '--ff-only'/);
assert.match(mainMerge, /executeMainMergeViaHostAgent/);
assert.match(mainMerge, /skyCommandHostAgentToolWorkflow/);
assert.match(mainMerge, /remoteOnly/);
assert.match(workflow, /isDockerDetail/);
assert.match(workflow, /'45 seconds'/);
assert.match(workflow, /'3 minutes'/);
assert.match(workflow, /taskQueue:\s*hostTaskQueue/);
assert.match(workflowIndex, /hostAgentWorkflow/);
assert.match(worker, /SkyCommand Host Agent refuses Docker execution/);
assert.match(worker, /SKYCOMMAND_LOCAL_DEV_PULL_PROFILE/);
assert.match(worker, /SKYCOMMAND_DEV_COMMIT_PROFILE/);
assert.match(worker, /SKYCOMMAND_MAIN_MERGE_PROFILE/);
assert.match(worker, /worker\.temporal_worker_heartbeats/);
assert.match(worker, /skycommand-host-agent-heartbeat/);
assert.match(worker, /Heartbeat persistence recovered/);
assert.match(worker, /PostgreSQL will be retried automatically/);
assert.match(worker, /startDockerEventBridge/);
assert.match(worker, /startDockerTelemetryBridge/);
assert.match(activities, /DEV_COMMIT_TOOL_CODE/);
assert.match(activities, /executeDevCommit/);
assert.match(activities, /GITHUB_DEV_PR_MERGE_TOOL_CODE/);
assert.match(activities, /executeGithubDevPrMerge/);
assert.match(activities, /expectedDevSha/);
assert.match(activities, /expectedMainSha/);
assert.match(activities, /orchestratedExecution:\s*true/);
assert.match(activities, /executionTarget:\s*'HOST'/);
assert.match(activities, /MAIN_MERGE_TOOL_CODE/);
assert.match(activities, /executeMainMerge/);
assert.match(activities, /remoteOnly:\s*true/);
assert.match(activities, /LOCAL_DEV_PULL_TOOL_CODE/);
assert.match(activities, /executeLocalDevPull/);
assert.match(activities, /LOCAL_REPOSITORY_SYNC_TOOL_CODE/);
assert.match(activities, /DOCKER_SNAPSHOT_TOOL_CODE/);
assert.match(activities, /DOCKER_COMPOSE_CONTROL_TOOL_CODE/);
assert.match(activities, /DOCKER_CONTAINER_DETAIL_TOOL_CODE/);
assert.match(activities, /DOCKER_CONTAINER_CONTROL_TOOL_CODE/);
assert.match(activities, /DOCKER_RESOURCE_DETAIL_TOOL_CODE/);
assert.match(activities, /DOCKER_RESOURCE_CONTROL_TOOL_CODE/);
assert.match(activities, /SUPERVISOR_PROCESS_LIFECYCLE_TOOL_CODE/);
assert.match(activities, /LEGACY_SUPERVISOR_TASK_LIFECYCLE_TOOL_CODE/);
assert.match(activities, /temporal_host_agent_process_legacy_adapter/);
assert.match(activities, /executeSupervisorProcessLifecycle/);
assert.match(supervisorTaskScript, /'Restart' \{/);
assert.match(activities, /executeDockerSnapshot/);
assert.match(activities, /executeDockerComposeControl/);
assert.match(activities, /executeDockerContainerDetail/);
assert.match(activities, /executeDockerContainerControl/);
assert.match(activities, /executeDockerResourceDetail/);
assert.match(activities, /executeDockerResourceControl/);
assert.match(activities, /SKYCOMMAND_HOST_AGENT_TOOL_NOT_ALLOWED/);
assert.match(dockerEventBridge, /docker.*events/i);
assert.match(dockerEventBridge, /X-SkyCommand-Internal-Token/);
assert.match(dockerEventBridge, /ALLOWED_DOCKER_CONTAINER_EVENT_ACTIONS/);
assert.doesNotMatch(dockerEventBridge, /docker exec/i);
assert.match(dockerTelemetryBridge, /\['stats', '--no-stream'/);
assert.match(dockerTelemetryBridge, /\['inspect', '--format'/);
assert.match(dockerTelemetryBridge, /DOCKER_TELEMETRY_SNAPSHOT/);
assert.doesNotMatch(dockerTelemetryBridge, /Config\?\.Env|environment:/i);
assert.match(dockerResource, /DATA_PROTECTED/);
assert.match(dockerResource, /SYSTEM_PROTECTED/);
assert.match(dockerResource, /GUARDED_REMOVE/);
assert.doesNotMatch(dockerResource, /--force|\b-f\b/);
assert.match(migration, /'admin-web'/);
assert.match(migration, /'api'/);
assert.match(migration, /'worker'/);
assert.match(migration, /local_repo_sync/);
assert.equal(packageJson.scripts['host-agent'], 'node packages/host-agent/src/worker.js');
assert.equal(packageJson.scripts['host-agent:check'], 'node packages/host-agent/src/health.js');
assert.match(envExample, /SKYCOMMAND_HOST_AGENT_ENABLED=false/);
assert.match(envExample, /SKYCOMMAND_HOST_AGENT_TASK_QUEUE=skycommand-host-local/);
assert.match(envExample, /SKYCOMMAND_HOST_AGENT_HEARTBEAT_DB_CONNECT_TIMEOUT_MS=3000/);
assert.match(envExample, /SKYCOMMAND_DOCKER_TARGET_CODE=LOCAL_DOCKER/);
assert.match(envExample, /SKYCOMMAND_DOCKER_COMMAND_TIMEOUT_MS=10000/);
assert.match(envExample, /SKYCOMMAND_DOCKER_CONTROL_TIMEOUT_MS=120000/);
assert.match(envExample, /SKYCOMMAND_DOCKER_CONTAINER_TIMEOUT_MS=30000/);
assert.match(envExample, /SKYCOMMAND_DOCKER_RESOURCE_TIMEOUT_MS=30000/);
assert.match(envExample, /SKYCOMMAND_DOCKER_SELF_PROJECT_NAME=skycommand/);
assert.match(envExample, /SKYCOMMAND_DOCKER_EVENT_STREAM_ENABLED=true/);
assert.match(envExample, /SKYCOMMAND_DOCKER_EVENT_HEARTBEAT_MS=15000/);
assert.match(envExample, /SKYCOMMAND_DOCKER_TELEMETRY_ENABLED=true/);
assert.match(envExample, /SKYCOMMAND_DOCKER_TELEMETRY_INTERVAL_MS=5000/);

let supervisorProcesses = [];
Promise.all([
  executeSupervisorProcessLifecycle(
    { action: 'START', operationId: '123e4567-e89b-42d3-a456-426614174001' },
    {
      platform: 'win32',
      repositoryRoot: repoRoot,
      processLister: async () => supervisorProcesses,
      processLauncher: async () => {
        supervisorProcesses = [{
          processId: 4567,
          name: 'node.exe',
          commandLine: `node.exe "${path.join(repoRoot, 'packages/supervisor/src/server.js')}"`,
          ownsConfiguredPort: true,
        }];
        return { processId: 4567 };
      },
      healthChecker: async () => ({ url: 'http://127.0.0.1:17170/health', payload: { ok: true } }),
    },
  ).then((result) => {
    assert.equal(result.action, 'START_SUPERVISOR');
    assert.equal(result.operationId, '123e4567-e89b-42d3-a456-426614174001');
    assert.equal(result.outcome, 'COMPLETED');
    assert.equal(result.transport, 'guarded_host_agent_process');
  }),
  assert.rejects(
    () => executeSupervisorProcessLifecycle({ action: 'STOP' }, { platform: 'win32' }),
    /not allowlisted/i,
  ),
]).then(() => {
  console.log('✅ SkyCommand Host Agent self-test passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
