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
const gitCredentialHelper = read('docker/git-credential-skycommand.js');
const gitCredentialCheck = read('scripts/docker/temporalWorkerGitCheck.js');
const workerPackage = JSON.parse(read('docker/temporal-worker.package.json'));
const envSource = read('.env.example');
const worker = read('packages/temporal/src/worker.js');
const scriptExecution = read('apps/api/src/services/scriptExecutionService.js');
const workflowExecutor = read('apps/api/src/services/workflowExecutorService.js');
const adminRead = read('apps/api/src/services/adminReadService.js');
const artifactConfiguration = read('packages/files/src/repositoryArtifactConfiguration.js');
const mainMerge = read('packages/git/src/main_merge.js');
const migration = read('packages/db_build/src/migrations/00098__docker_local_repository_profile.sql');
const seed = read('packages/db_build/src/seeds/00019__core_config_seed.sql');
const packageJson = JSON.parse(read('package.json'));

assert(
  compose.includes('temporal-worker:') &&
    compose.includes('dockerfile: docker/temporal-worker.Dockerfile') &&
    compose.includes('TEMPORAL_ADDRESS: temporal:7233') &&
    compose.includes('PGHOST: ${SKYCOMMAND_DATABASE_HOST:-host.docker.internal}') &&
    compose.includes('PGPORT: ${SKYCOMMAND_DATABASE_PORT:-5432}') &&
    compose.includes('SKYCOMMAND_CONFIG_PROFILE: DOCKER_LOCAL') &&
    compose.includes('SKYCOMMAND_SCRIPT_RUNTIME_ROOT: /app') &&
    compose.includes('SKYCOMMAND_EXECUTION_LOG_PATH_MODE: relative') &&
    compose.includes('target: /workspace/SkyEco System') &&
    compose.includes('source: github_token') &&
    compose.includes('target: skycommand_github_token') &&
    compose.includes('file: "${SKYCOMMAND_DOCKER_GITHUB_TOKEN_FILE:-docker/empty-github-token}"') &&
    compose.includes('condition: service_healthy'),
  'Compose must run the SkyCommand Temporal worker against the Temporal service, configurable host/Docker PostgreSQL, and the Docker repository profile.',
);
assert(
  dockerfile.includes('FROM node:20-bookworm-slim AS worker-dependencies') &&
    dockerfile.includes('FROM node:22-bookworm-slim AS worker-runtime') &&
    dockerfile.includes('COPY docker/temporal-worker.package.json ./package.json') &&
    dockerfile.includes('npm install --omit=dev --package-lock=false --no-audit --no-fund') &&
    dockerfile.includes('COPY --from=worker-dependencies --chown=node:node') &&
    dockerfile.includes('git') &&
    dockerfile.includes('postgresql-client') &&
    dockerfile.includes('git-credential-skycommand') &&
    !dockerfile.includes("safe.directory '/workspace/SkyEco System/*'") &&
    dockerfile.includes('USER node') &&
    dockerfile.includes('packages/temporal/src/worker.js'),
  'The worker image must isolate dependency installation in the Node 20 compatibility stage, retain Node 22 at runtime, provide Git/PostgreSQL support, and run as the non-root node user.',
);

const requiredWorkerDependencies = [
  '@temporalio/client',
  '@temporalio/worker',
  '@temporalio/workflow',
  'axios',
  'bcryptjs',
  'dotenv',
  'pg',
];
assert(
  requiredWorkerDependencies.every((dependency) => workerPackage.dependencies?.[dependency]) &&
    !workerPackage.scripts &&
    !workerPackage.devDependencies,
  'The Docker worker must use a minimal pinned runtime manifest instead of the full Windows-authored SkyCommand package/lock pair.',
);
assert(
  envSource.includes('SKYCOMMAND_DOCKER_WORKSPACE_ROOT=') &&
    envSource.includes('SKYCOMMAND_DOCKER_GIT_ENABLED=false') &&
    envSource.includes('SKYCOMMAND_DOCKER_GITHUB_TOKEN_FILE=') &&
    envSource.includes('SKYCOMMAND_GITHUB_USERNAME=') &&
    envSource.includes('SKYCOMMAND_GIT_AUTHOR_NAME=') &&
    envSource.includes('SKYCOMMAND_GIT_AUTHOR_EMAIL='),
  'The example environment must document the host workspace mount, fail-closed Git flag, secret file, GitHub identity, and commit identity.',
);
assert(
  gitCredentialHelper.includes('SKYCOMMAND_GITHUB_TOKEN_FILE') &&
    gitCredentialHelper.includes('SKYCOMMAND_GITHUB_USERNAME') &&
    gitCredentialHelper.includes('FEFF') &&
    gitCredentialHelper.includes('.trim()') &&
    gitCredentialHelper.includes('password=${token}') &&
    !gitCredentialHelper.includes('console.log(token)'),
  'The Docker Git credential helper must normalize Windows BOM/outer whitespace, read the mounted secret at execution time, and never persist or log the token.',
);
assert(
  gitCredentialCheck.includes("requestGitHub('/user', token, host)") &&
    gitCredentialCheck.includes('githubAuthentication=passed') &&
    gitCredentialCheck.includes('repositoryAccess=passed') &&
    gitCredentialCheck.includes("['ls-remote', 'origin', 'HEAD']") &&
    gitCredentialCheck.includes("['push', '--dry-run', 'origin'") &&
    !gitCredentialCheck.includes('console.log(token)'),
  'The Docker Git check must distinguish mounted-token validity, repository access, Git read, and dry-run push without exposing the token.',
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
    worker.includes("['config', '--global', '--add', 'safe.directory', repository.rootPath]") &&
    worker.includes('dockerGitSafeDirectories=') &&
    worker.includes("runtimeEnvironment: process.env.SKYCOMMAND_RUNTIME_ENV || 'host'"),
  'The worker must fail fast when its Docker profile/mount is unavailable, register each mounted DOCKER_LOCAL repository as an exact Git safe.directory, and identify its runtime in heartbeat metadata.',
);
assert(
  gitCredentialCheck.includes("['config', '--global', '--add', 'safe.directory', repo]") &&
    read('scripts/docker/temporalWorkerDocker.js').includes("'scripts/docker/temporalWorkerGitCheck.js'"),
  'The Docker Git credential check must defensively register the exact SkyCommand repository and run the layered credential diagnostic inside the worker.',
);
assert(
  scriptExecution.includes('SKYCOMMAND_SCRIPT_RUNTIME_ROOT') &&
    scriptExecution.includes('assertDockerToolSupported') &&
    scriptExecution.includes('SKYCOMMAND_DOCKER_GIT_ENABLED') &&
    scriptExecution.includes('temporal:worker:docker:git:check'),
  'Docker worker tool execution must use the image runtime root and fail closed for Git tools until credentials are configured and checked.',
);
assert(
  artifactConfiguration.includes('translateWorkspacePath') &&
    workflowExecutor.includes('translateLocalApiUrlForRuntime') &&
    workflowExecutor.includes('SKYCOMMAND_CONTAINER_HOST_ALIAS'),
  'Docker runtime must translate repository artifact paths and host-local API calls across the container boundary.',
);
assert(
  mainMerge.includes("const DOCKER_LOCAL_PROFILE = 'DOCKER_LOCAL'") &&
    mainMerge.includes("['remote', 'get-url', remote]") &&
    mainMerge.includes("['ls-remote', '--heads', remote, branchRef]") &&
    mainMerge.includes('Docker URL transport') &&
    mainMerge.includes('createDeferredLocalBranchRefState') &&
    mainMerge.includes('host-owned local branch references untouched'),
  'DOCKER_LOCAL Main Merge must keep remote synchronization authoritative while avoiding Linux writes to host-owned local branch and remote-tracking refs after the push.',
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
assert(scripts['temporal:worker:docker:git:check'], 'Missing Docker worker Git credential check helper.');
assert(scripts['temporal:stack:up'], 'Missing combined Temporal stack start helper.');

console.log('[SkyCommand] Temporal Worker Docker foundation self-test passed.');
