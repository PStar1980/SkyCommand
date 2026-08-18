const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(`[SkyCommand PostgreSQL Docker self-test] ${message}`);
}

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const compose = read('compose.yaml');
const helper = read('scripts/docker/postgresDocker.js');
const parity = read('scripts/docker/postgresParity.js');
const dbBuild = read('packages/db_build/src/db_build.js');
const envExample = read('.env.example');
const packageJson = JSON.parse(read('package.json'));
const validate = read('scripts/validate.js');

assert(
  compose.includes('postgres:') &&
    compose.includes('${SKYCOMMAND_POSTGRES_IMAGE:-postgres:18.6-bookworm}') &&
    compose.includes('127.0.0.1:${SKYCOMMAND_POSTGRES_HOST_PORT:-55432}:5432') &&
    compose.includes('postgres_data:/var/lib/postgresql') &&
    compose.includes('pg_isready') &&
    compose.includes('host.docker.internal:host-gateway'),
  'Compose must provide a pinned PostgreSQL 18.6 shadow service on a non-conflicting host port with persistent storage and health checking.',
);
assert(
  compose.includes('postgres_data:') && compose.includes('name: skycommand_postgres_data'),
  'PostgreSQL must use a stable named Docker volume.',
);
assert(
  helper.includes('pg_dump') &&
    helper.includes('--format=custom') &&
    helper.includes('--no-owner') &&
    helper.includes('pg_restore') &&
    helper.includes('--exit-on-error') &&
    helper.includes('pre_docker_cutover.dump') &&
    helper.includes('postgresParity.js') &&
    helper.includes('No cutover has occurred'),
  'Staging must create a durable source snapshot, restore it into the shadow database, enforce parity, and remain explicitly pre-cutover.',
);
assert(
  parity.includes('core.tools') &&
    parity.includes('core.tool_parameters') &&
    parity.includes('worker.workflow_definitions') &&
    parity.includes('worker.workflow_versions') &&
    parity.includes('worker.workflow_nodes') &&
    parity.includes('worker.workflow_edges') &&
    parity.includes('Critical tool/workflow configuration is identical'),
  'Parity must explicitly cover the PostgreSQL-authoritative tool and workflow catalogues.',
);
assert(
  dbBuild.includes('TEMPLATE = template0') &&
    !dbBuild.includes("process.env.DB_BUILD_LC_COLLATE || 'English_Canada.1252'") &&
    dbBuild.includes('const localeClauses = []'),
  'Database builds must not hard-code a Windows-only locale now that PostgreSQL can run on Linux.',
);
assert(
  envExample.includes('SKYCOMMAND_POSTGRES_IMAGE=postgres:18.6-bookworm') &&
    envExample.includes('SKYCOMMAND_POSTGRES_HOST_PORT=55432') &&
    envExample.includes('SKYCOMMAND_POSTGRES_SOURCE_PORT=5432'),
  'The sample environment must document the blue/green PostgreSQL staging ports and image pin.',
);
for (const scriptName of [
  'db:docker:up',
  'db:docker:stop',
  'db:docker:restart',
  'db:docker:status',
  'db:docker:logs',
  'db:docker:backup',
  'db:docker:stage',
  'db:docker:parity',
  'postgres-docker:self-test',
]) {
  assert(packageJson.scripts?.[scriptName], `Missing npm script: ${scriptName}`);
}
assert(validate.includes("'postgres-docker:self-test'"), 'Routine validation must include the PostgreSQL Docker self-test.');

console.log('[SkyCommand] PostgreSQL Docker pre-cutover foundation self-test passed.');
