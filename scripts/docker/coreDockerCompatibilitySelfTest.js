const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(`[SkyCommand Core Docker DB self-test] ${message}`);
}

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const core = read('packages/core/src/SkyCommand_Core.js');
const wrapper = read('scripts/docker/coreDockerDb.js');
const check = read('scripts/docker/coreDockerDbCheck.js');
const packageJson = JSON.parse(read('package.json'));
const validate = read('scripts/validate.js');

assert(
  core.includes('SKYCOMMAND_CORE_CANDIDATE_DB') &&
    core.includes("new Set(['inline'])") &&
    core.includes('Candidate Docker PostgreSQL verification mode') &&
    core.includes('Candidate Docker-database verification allows inline workflow execution only'),
  'SkyCommand_Core must identify candidate-database mode and prevent Temporal execution against a worker that still points at the source database.',
);
assert(
  wrapper.includes("PGHOST: '127.0.0.1'") &&
    wrapper.includes('SKYCOMMAND_POSTGRES_HOST_PORT') &&
    wrapper.includes("SKYCOMMAND_CONFIG_PROFILE: 'DEV_LOCAL'") &&
    wrapper.includes("SKYCOMMAND_CORE_WORKFLOW_EXECUTOR_MODE: 'inline'") &&
    wrapper.includes('packages/core/src/SkyCommand_Core.js'),
  'The candidate CLI wrapper must use the shadow Docker database while preserving host/DEV_LOCAL repository paths and inline-only workflow acceptance.',
);
assert(
  check.includes("channel_code = 'cli'") &&
    check.includes("status = 'ACTIVE'") &&
    check.includes("'DEV_LOCAL', 'DOCKER_LOCAL'") &&
    check.includes('temporalPublishedPort=') &&
    check.includes('Compatibility preflight passed'),
  'The non-interactive CLI check must validate database catalogue visibility, both repository path profiles, published workflows, and the published Temporal port.',
);
for (const scriptName of ['core:docker-db', 'core:docker-db:check', 'core-docker-db:self-test']) {
  assert(packageJson.scripts?.[scriptName], `Missing npm script: ${scriptName}`);
}
assert(validate.includes("'core-docker-db:self-test'"), 'Routine validation must include the Core candidate-database self-test.');

console.log('[SkyCommand] SkyCommand_Core Docker-database compatibility self-test passed.');
