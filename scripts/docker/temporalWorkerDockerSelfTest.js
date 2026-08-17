const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand Temporal Worker Docker self-test] ${message}`);
  }
}

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const compose = read('compose.yaml');
const dockerfile = read('docker/temporal-worker.Dockerfile');
const envSource = read('.env.example');
const worker = read('packages/temporal/src/worker.js');
const scriptExecution = read('apps/api/src/services/scriptExecutionService.js');
const workflowExecutor = read('apps/api/src/services/workflowExecutorService.js');
const adminRead = read('apps/api/src/services/adminReadService.js');
const artifactConfiguration = read('packages/files/src/repositoryArtifactConfiguration.js');
const migration = read('packages/db_build/src/migrations/00098__docker_local_repository_profile.sql');
const seed = read('packages/db_build/src/seeds/00019__core_config_seed.sql');
const packageJson = JSON.parse(read('package.json'));

assert(
  compose.includes('temporal-worker:') &&
    compose.includes('dockerfile: docker/temporal-worker.Dockerfile') &&
    compose.includes('TEMPORAL_ADDRESS: temporal:7233') &&
    compose.includes('PGHOST: host.docker.internal') &&
    compose.includes('SKYCOMMAND_CONFIG_PROFILE: DOCKER_LOCAL') &&
    compose.includes('SKYCOMMAND_SCRIPT_RUNTIME_ROOT: /app') &&
    compose.includes('SKYCOMMAND_EXECUTION_LOG_PATH_MODE: relative') &&
    compose.includes('target: /workspace/SkyEco System') &&
    compose.includes('condition: service_healthy'),
  'Compose must run the SkyCommand Temporal worker against the Temporal service, host PostgreSQL, and the Docker repository profile.',
);
assert(
  dockerfile.includes('FROM node:22-bookworm-slim') &&
    dockerfile.includes('git') &&
    dockerfile.includes('postgresql-client') &&
    dockerfile.includes('USER node') &&
    dockerfile.includes('packages/temporal/src/worker.js'),
  'The worker image must provide Node, Git, PostgreSQL CLI support, and run as the non-root node user.',
);
assert(
  envSource.includes('SKYCOMMAND_DOCKER_WORKSPACE_ROOT=') &&
    envSource.includes('SKYCOMMAND_DOCKER_GIT_ENABLED=false'),
  'The example environment must document the host workspace mount and safe Git default.',
);
assert(
  migration.includes("'DOCKER_LOCAL'") &&
    migration.includes("'/workspace'") &&
    migration.includes("position('/skyeco system/' IN lower(normalized_path))") &&
    seed.includes("'DOCKER_LOCAL','Docker Local Development'"),
  'The database must persist a reusable DOCKER_LOCAL repository profile derived from DEV_LOCAL paths.',
);
assert(
  worker.includes('assertDockerWorkerConfiguration') &&
    worker.includes('00098__docker_local_repository_profile.sql') &&
    worker.includes('fs.existsSync(rootPath)') &&
    worker.includes("runtimeEnvironment: process.env.SKYCOMMAND_RUNTIME_ENV || 'host'"),
  'The worker must fail fast when its Docker profile/mount is unavailable and identify its runtime in heartbeat metadata.',
);
assert(
  scriptExecution.includes('SKYCOMMAND_SCRIPT_RUNTIME_ROOT') &&
    scriptExecution.includes('assertDockerToolSupported') &&
    scriptExecution.includes('SKYCOMMAND_DOCKER_GIT_ENABLED'),
  'Docker worker tool execution must use the image runtime root and fail closed for Git tools until credentials are configured.',
);
assert(
  artifactConfiguration.includes('translateWorkspacePath') &&
    workflowExecutor.includes('translateLocalApiUrlForRuntime') &&
    workflowExecutor.includes('SKYCOMMAND_CONTAINER_HOST_ALIAS'),
  'Docker runtime must translate repository artifact paths and host-local API calls across the container boundary.',
);
assert(
  scriptExecution.includes('SKYCOMMAND_EXECUTION_LOG_ROOT') &&
    scriptExecution.includes('SKYCOMMAND_EXECUTION_LOG_PATH_MODE') &&
    adminRead.includes('SCRIPT_EXECUTION_REPOSITORY_ROOT') &&
    adminRead.includes('path.isAbsolute(storedPath)'),
  'Docker worker process output must be written to the mounted repository and persisted with host-readable relative paths.',
);

const scripts = packageJson.scripts || {};
assert(scripts['temporal:worker:docker:up'], 'Missing Docker worker start helper.');
assert(scripts['temporal:worker:docker:status'], 'Missing Docker worker status helper.');
assert(scripts['temporal:worker:docker:logs'], 'Missing Docker worker logs helper.');
assert(scripts['temporal:stack:up'], 'Missing combined Temporal stack start helper.');

console.log('[SkyCommand] Temporal Worker Docker foundation self-test passed.');
