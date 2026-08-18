const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand Node Worker Docker self-test] ${message}`);
  }
}

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const compose = read('compose.yaml');
const dockerfile = read('docker/node-worker.Dockerfile');
const workerPackage = JSON.parse(read('docker/node-worker.package.json'));
const worker = read('apps/worker/src/index.js');
const schedulePoller = read('apps/worker/src/schedulers/schedulePoller.js');
const workerToolExecution = read('apps/worker/src/jobs/workerToolExecutionService.js');
const packageJson = JSON.parse(read('package.json'));
const validate = read('scripts/validate.js');

assert(
  compose.includes('node-worker:') &&
    compose.includes('dockerfile: docker/node-worker.Dockerfile') &&
    compose.includes('TEMPORAL_ADDRESS: temporal:7233') &&
    compose.includes('PGHOST: ${SKYCOMMAND_DATABASE_HOST:-host.docker.internal}') &&
    compose.includes('PGPORT: ${SKYCOMMAND_DATABASE_PORT:-5432}') &&
    compose.includes('SKYCOMMAND_CONFIG_PROFILE: DOCKER_LOCAL') &&
    compose.includes('WORKER_NODE_NAME: skycommand-node-worker-docker') &&
    compose.includes('target: /workspace/SkyEco System') &&
    compose.includes('source: github_token') &&
    compose.includes('condition: service_healthy'),
  'Compose must run the scheduler/listener worker against configurable host/Docker PostgreSQL, Docker Temporal, the mounted workspace, and the shared Git secret.',
);
assert(
  dockerfile.includes('FROM node:20-bookworm-slim AS worker-dependencies') &&
    dockerfile.includes('FROM node:22-bookworm-slim AS worker-runtime') &&
    dockerfile.includes('COPY docker/node-worker.package.json ./package.json') &&
    dockerfile.includes('npm install --omit=dev --package-lock=false --no-audit --no-fund') &&
    dockerfile.includes('git-credential-skycommand') &&
    dockerfile.includes('postgresql-client') &&
    dockerfile.includes('USER node') &&
    dockerfile.includes('apps/worker/src/index.js'),
  'The Node worker image must use the isolated dependency stage, retain Node 22 at runtime, include Git/PostgreSQL support, and run non-root.',
);

const requiredDependencies = ['@temporalio/client', 'axios', 'bcryptjs', 'dotenv', 'pg'];
assert(
  requiredDependencies.every((dependency) => workerPackage.dependencies?.[dependency]) &&
    !workerPackage.devDependencies,
  'The Node worker must use a compact server-side dependency manifest.',
);
assert(
  worker.includes('assertDockerWorkerConfiguration') &&
    worker.includes("['config', '--global', '--add', 'safe.directory', repository.rootPath]") &&
    worker.includes('dockerUnsupportedScheduledTools=') &&
    worker.includes("runtimeEnvironment: process.env.SKYCOMMAND_RUNTIME_ENV || 'host'"),
  'The Node worker must validate DOCKER_LOCAL mounts, register exact Git safe directories, report unsupported scheduled runtimes, and record its runtime metadata.',
);
assert(
  schedulePoller.includes('isDockerRuntime') &&
    schedulePoller.includes("t.runtime_code = 'node'") &&
    schedulePoller.includes('Docker Node worker only claims Node.js-backed schedules'),
  'The Docker Node worker must fail closed by claiming only Node.js-backed generic schedules.',
);
assert(
  workerToolExecution.includes('assertDockerToolSupported') &&
    workerToolExecution.includes('SKYCOMMAND_DOCKER_GIT_ENABLED') &&
    workerToolExecution.includes('SKYCOMMAND_EXECUTION_LOG_ROOT') &&
    workerToolExecution.includes('SKYCOMMAND_EXECUTION_LOG_PATH_MODE'),
  'Docker Node worker tool execution must protect Git changes and retain host-readable execution logs.',
);

const scripts = packageJson.scripts || {};
assert(scripts['worker:docker:up'], 'Missing Docker Node worker start helper.');
assert(scripts['worker:docker:restart'], 'Missing Docker Node worker restart helper.');
assert(scripts['worker:docker:status'], 'Missing Docker Node worker status helper.');
assert(scripts['worker:docker:logs'], 'Missing Docker Node worker logs helper.');
assert(scripts['worker:docker:git:check'], 'Missing Docker Node worker Git check helper.');
assert(scripts['automation:stack:up'], 'Missing combined automation stack helper.');
assert(validate.includes("'node-worker-docker:self-test'"), 'Routine validation must include the Node worker Docker self-test.');

console.log('[SkyCommand] Node Worker Docker foundation self-test passed.');
