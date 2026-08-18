const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand API Docker self-test] ${message}`);
  }
}

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const compose = read('compose.yaml');
const dockerfile = read('docker/api.Dockerfile');
const apiPackage = JSON.parse(read('docker/api.package.json'));
const server = read('apps/api/src/server.js');
const preflight = read('apps/api/src/services/apiDockerPreflight.js');
const scriptExecution = read('apps/api/src/services/scriptExecutionService.js');
const adminRead = read('apps/api/src/services/adminReadService.js');
const packageJson = JSON.parse(read('package.json'));
const validate = read('scripts/validate.js');

assert(
  compose.includes('api:') &&
    compose.includes('dockerfile: docker/api.Dockerfile') &&
    compose.includes('127.0.0.1:7171:7171') &&
    compose.includes('TEMPORAL_ADDRESS: temporal:7233') &&
    compose.includes('PGHOST: ${SKYCOMMAND_DATABASE_HOST:-host.docker.internal}') &&
    compose.includes('PGPORT: ${SKYCOMMAND_DATABASE_PORT:-5432}') &&
    compose.includes('SKYCOMMAND_CONFIG_PROFILE: DOCKER_LOCAL') &&
    compose.includes('SKYCOMMAND_DOCKER_RUNTIME_LABEL: Docker API') &&
    compose.includes('SKYCOMMAND_DOCKER_GIT_CHECK_COMMAND: npm run api:docker:git:check') &&
    compose.includes('SKYCOMMAND_SCRIPT_RUNTIME_ROOT: /app') &&
    compose.includes('SKYCOMMAND_EXECUTION_LOG_ROOT: /workspace/SkyEco System/SkyCommand System/SkyCommand/logs/script-executions') &&
    compose.includes('target: /workspace/SkyEco System') &&
    compose.includes('source: github_token') &&
    compose.includes("fetch('http://127.0.0.1:7171/_health')"),
  'Compose must publish the API on localhost:7171 and connect it to configurable host/Docker PostgreSQL, Docker Temporal, the mounted workspace, shared execution logs, and Git secret.',
);
assert(
  dockerfile.includes('FROM node:20-bookworm-slim AS api-dependencies') &&
    dockerfile.includes('FROM node:22-bookworm-slim AS api-runtime') &&
    dockerfile.includes('COPY docker/api.package.json ./package.json') &&
    dockerfile.includes('npm install --omit=dev --package-lock=false --no-audit --no-fund') &&
    dockerfile.includes('git-credential-skycommand') &&
    dockerfile.includes('postgresql-client') &&
    dockerfile.includes('USER node') &&
    dockerfile.includes('EXPOSE 7171') &&
    dockerfile.includes('apps/api/src/server.js'),
  'The API image must use isolated dependencies, Node 22 at runtime, Git/PostgreSQL tooling, non-root execution, and port 7171.',
);

for (const dependency of [
  '@temporalio/client',
  '@temporalio/worker',
  '@temporalio/workflow',
  'axios',
  'bcryptjs',
  'dotenv',
  'express',
  'pg',
  'xlsx',
]) {
  assert(apiPackage.dependencies?.[dependency], `API runtime dependency is missing: ${dependency}`);
}
assert(!apiPackage.devDependencies, 'The API runtime manifest must not include development dependencies.');
assert(
  server.includes("require('./services/apiDockerPreflight')") &&
    server.includes('await apiDockerPreflight.assertDockerApiConfiguration()') &&
    server.includes('async function startServer()'),
  'The API must complete Docker preflight checks before opening port 7171.',
);
assert(
  preflight.includes("profileCode !== 'DOCKER_LOCAL'") &&
    preflight.includes("['config', '--global', '--add', 'safe.directory', repository.rootPath]") &&
    preflight.includes('dockerExecutionLogRoot=') &&
    preflight.includes('dockerGit='),
  'The Docker API preflight must validate DOCKER_LOCAL, exact Git safe directories, shared logs, and Git credentials.',
);
assert(
  scriptExecution.includes('SKYCOMMAND_DOCKER_RUNTIME_LABEL') &&
    scriptExecution.includes('SKYCOMMAND_DOCKER_GIT_CHECK_COMMAND') &&
    scriptExecution.includes("'npm run temporal:worker:docker:git:check'") &&
    scriptExecution.includes('SKYCOMMAND_SCRIPT_RUNTIME_ROOT'),
  'Direct API tool execution must fail closed for unsupported Docker runtimes and point Git diagnostics at the API container.',
);
assert(
  adminRead.includes('SKYCOMMAND_EXECUTION_LOG_ROOT') &&
    adminRead.includes('SCRIPT_EXECUTION_RELATIVE_LOG_PREFIX') &&
    adminRead.includes('translateWorkspacePath') &&
    adminRead.includes('resolveScriptExecutionOutputPath'),
  'Tool Operations must translate prior host paths and resolve relative execution logs against the shared Docker execution-log mount.',
);

const scripts = packageJson.scripts || {};
for (const scriptName of [
  'api:docker:up',
  'api:docker:stop',
  'api:docker:restart',
  'api:docker:status',
  'api:docker:logs',
  'api:docker:git:check',
  'backend:stack:up',
  'backend:stack:stop',
  'api-docker:self-test',
]) {
  assert(scripts[scriptName], `Missing npm script: ${scriptName}`);
}
assert(validate.includes("'api-docker:self-test'"), 'Routine validation must include the API Docker self-test.');

console.log('[SkyCommand] API Docker foundation self-test passed.');
