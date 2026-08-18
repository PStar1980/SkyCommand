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
const cutoverCheck = read('scripts/docker/postgresCutoverCheck.js');
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
  'Compose must provide a pinned PostgreSQL 18.6 blue/green service on a non-conflicting host port with persistent storage and health checking.',
);
assert(
  compose.includes('postgres_data:') && compose.includes('name: skycommand_postgres_data'),
  'PostgreSQL must use a stable named Docker volume.',
);
assert(
  compose.includes('PGHOST: ${SKYCOMMAND_DATABASE_HOST:-host.docker.internal}') &&
    compose.includes('PGPORT: ${SKYCOMMAND_DATABASE_PORT:-5432}') &&
    compose.includes('postgres:\n        condition: service_healthy'),
  'Docker API/workers must support an explicit database host switch and wait for the PostgreSQL service health contract after cutover.',
);
assert(
  helper.includes('pg_dump') &&
    helper.includes('--format=custom') &&
    helper.includes('--no-owner') &&
    helper.includes('pg_restore') &&
    helper.includes('--exit-on-error') &&
    helper.includes('pre_docker_cutover') &&
    helper.includes('docker_active') &&
    helper.includes('postgresParity.js') &&
    helper.includes('No cutover has occurred') &&
    helper.includes("case 'cutover':") &&
    helper.includes("case 'rollback':") &&
    helper.includes("case 'persistence':") &&
    helper.includes("case 'finalize':") &&
    helper.includes('Refusing database cutover while') &&
    helper.includes('SKYCOMMAND_DATABASE_HOST') &&
    helper.includes('CUTOVER COMPLETE'),
  'The PostgreSQL helper must retain shadow staging while adding quiesced cutover, rollback, persistence, active backup, and finalize controls.',
);
assert(
  cutoverCheck.includes("runtimeHost !== 'postgres'") &&
    cutoverCheck.includes("fetchJson('http://127.0.0.1:7171/_db/health')") &&
    cutoverCheck.includes('Runtime cutover verification passed'),
  'Cutover verification must prove host CLI connectivity, Docker API database connectivity, and the active PostgreSQL runtime contract.',
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
  parity.includes('FROM worker.vw_workflow_definitions') &&
    !parity.includes('SELECT workflow_code, display_name, status, published_version_id\n      FROM worker.workflow_definitions'),
  'Workflow publication metadata must be read from worker.vw_workflow_definitions because published_version_id is derived from workflow_versions rather than stored on the base definition table.',
);
assert(
  parity.includes("SET TIME ZONE 'UTC'") &&
    parity.includes('sourceTimeZone=') &&
    parity.includes('candidateTimeZone=') &&
    parity.includes('TIMESTAMPTZ fingerprints are canonicalized to UTC'),
  'Cross-platform parity fingerprints must canonicalize TIMESTAMPTZ rendering to UTC so Windows and Linux session time zones cannot create false data mismatches.',
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
    envExample.includes('SKYCOMMAND_POSTGRES_SOURCE_PORT=5432') &&
    envExample.includes('SKYCOMMAND_DATABASE_HOST=host.docker.internal') &&
    envExample.includes('SKYCOMMAND_DATABASE_PORT=5432'),
  'The sample environment must document the blue/green PostgreSQL ports, image pin, and explicit Docker-service database switch.',
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
  'db:docker:cutover',
  'db:docker:cutover:check',
  'db:docker:rollback',
  'db:docker:persistence',
  'db:docker:finalize',
  'postgres-docker:self-test',
]) {
  assert(packageJson.scripts?.[scriptName], `Missing npm script: ${scriptName}`);
}
assert(validate.includes("'postgres-docker:self-test'"), 'Routine validation must include the PostgreSQL Docker self-test.');

console.log('[SkyCommand] PostgreSQL Docker blue/green cutover self-test passed.');
