#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(repositoryRoot, '.env');
dotenv.config({ path: envPath });

const appServices = ['temporal-worker', 'node-worker', 'api', 'web'];
const fullStackServices = ['postgres', 'temporal', 'temporal-worker', 'node-worker', 'api', 'web'];

function fail(message) {
  throw new Error(`[SkyCommand PostgreSQL] ${message}`);
}

function normalizeDatabaseName(value) {
  const databaseName = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(databaseName)) {
    fail(`PGDATABASE must be a safe PostgreSQL database name. Received: ${databaseName || '<blank>'}`);
  }
  if (['postgres', 'template0', 'template1'].includes(databaseName.toLowerCase())) {
    fail(`Refusing to use protected database name for SkyCommand migration: ${databaseName}`);
  }
  return databaseName;
}

function getSourcePort() {
  const raw = String(process.env.SKYCOMMAND_POSTGRES_SOURCE_PORT || process.env.PGPORT || '5432').trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`SKYCOMMAND_POSTGRES_SOURCE_PORT must be a valid TCP port. Received: ${raw}`);
  }
  return port;
}

function getCandidatePort() {
  const raw = String(process.env.SKYCOMMAND_POSTGRES_HOST_PORT || '55432').trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`SKYCOMMAND_POSTGRES_HOST_PORT must be a valid TCP port. Received: ${raw}`);
  }
  if (port === getSourcePort()) {
    fail('The Docker PostgreSQL host port must differ from the Windows source port so blue/green rollback remains available during cutover.');
  }
  process.env.SKYCOMMAND_POSTGRES_HOST_PORT = String(port);
  return port;
}

function getBackupDirectory() {
  const configured = String(process.env.SKYCOMMAND_POSTGRES_BACKUP_DIR || '').trim();
  const resolved = configured
    ? path.resolve(configured)
    : path.join(os.homedir(), '.skycommand', 'backups', 'postgres');
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function getCutoverMarkerPath() {
  return path.join(getBackupDirectory(), 'skycommand_postgres_cutover.json');
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: options.stdio || 'inherit',
    encoding: options.encoding,
    shell: false,
  });

  if (result.error) fail(`Docker command could not start: ${result.error.message}`);
  if (result.status !== 0 && options.allowFailure !== true) process.exit(result.status || 1);
  return result;
}

function runCompose(args, options = {}) {
  return runDocker(['compose', ...args], options);
}

function prepareEnvironment() {
  if (!process.env.PGPASSWORD) fail('PGPASSWORD is required for PostgreSQL Docker migration operations.');
  if (!process.env.PGUSER) fail('PGUSER is required for PostgreSQL Docker migration operations.');
  normalizeDatabaseName(process.env.PGDATABASE);
  getCandidatePort();
}

function waitForCandidate() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', process.env.PGUSER, '-d', 'postgres'],
      { cwd: repositoryRoot, env: process.env, stdio: 'ignore', shell: false },
    );
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  fail('Docker PostgreSQL did not become healthy within 30 seconds. Check npm run db:docker:logs.');
}

function ensureCandidateUp({ recreate = false } = {}) {
  prepareEnvironment();
  const args = ['up', '-d'];
  if (recreate) args.push('--force-recreate');
  args.push('postgres');
  runCompose(args);
  waitForCandidate();
  console.log(`[SkyCommand PostgreSQL] candidate=postgresql://127.0.0.1:${getCandidatePort()}/${process.env.PGDATABASE}`);
  console.log(`[SkyCommand PostgreSQL] source=postgresql://127.0.0.1:${getSourcePort()}/${process.env.PGDATABASE}`);
}

function dumpDatabase({ label, command }) {
  ensureCandidateUp();
  const backupDirectory = getBackupDirectory();
  const databaseName = normalizeDatabaseName(process.env.PGDATABASE);
  const backupPath = path.join(backupDirectory, `${databaseName}_${timestampForFilename()}_${label}.dump`);
  const fd = fs.openSync(backupPath, 'w');

  console.log(`[SkyCommand PostgreSQL] Creating ${label.replaceAll('_', ' ')}: ${backupPath}`);
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'bash', '-lc', command], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ['ignore', fd, 'inherit'],
    shell: false,
  });
  fs.closeSync(fd);

  if (result.error) {
    fs.rmSync(backupPath, { force: true });
    fail(`PostgreSQL backup could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fs.rmSync(backupPath, { force: true });
    process.exit(result.status || 1);
  }

  const size = fs.statSync(backupPath).size;
  if (size <= 0) {
    fs.rmSync(backupPath, { force: true });
    fail('PostgreSQL backup completed without producing a dump file.');
  }
  console.log(`[SkyCommand PostgreSQL] Backup complete (${size} bytes).`);
  return backupPath;
}

function createSourceBackup() {
  return dumpDatabase({
    label: 'pre_docker_cutover',
    command:
      'export PGPASSWORD="$SKYCOMMAND_SOURCE_PGPASSWORD"; exec pg_dump --host host.docker.internal --port "$SKYCOMMAND_SOURCE_PGPORT" --username "$SKYCOMMAND_SOURCE_PGUSER" --dbname "$SKYCOMMAND_SOURCE_PGDATABASE" --format=custom --no-owner --no-acl',
  });
}

function createCandidateBackup() {
  return dumpDatabase({
    label: 'docker_active',
    command:
      'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --dbname "$SKYCOMMAND_SOURCE_PGDATABASE" --format=custom --no-owner --no-acl',
  });
}

function restoreBackup(backupPath) {
  ensureCandidateUp();
  const resolvedBackup = path.resolve(backupPath);
  if (!fs.existsSync(resolvedBackup) || !fs.statSync(resolvedBackup).isFile()) {
    fail(`Backup file does not exist: ${resolvedBackup}`);
  }

  console.log('[SkyCommand PostgreSQL] Recreating candidate database with the Docker cluster locale.');
  runCompose([
    'exec', '-T', 'postgres', 'bash', '-lc',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; dropdb --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --if-exists --force "$SKYCOMMAND_SOURCE_PGDATABASE" && createdb --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --template=template0 --encoding=UTF8 "$SKYCOMMAND_SOURCE_PGDATABASE"',
  ]);

  const fd = fs.openSync(resolvedBackup, 'r');
  console.log(`[SkyCommand PostgreSQL] Restoring candidate from ${resolvedBackup}`);
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'bash', '-lc', 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_restore --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --dbname "$SKYCOMMAND_SOURCE_PGDATABASE" --no-owner --no-acl --exit-on-error'],
    { cwd: repositoryRoot, env: process.env, stdio: [fd, 'inherit', 'inherit'], shell: false },
  );
  fs.closeSync(fd);
  if (result.error) fail(`PostgreSQL restore could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);

  runCompose([
    'exec', '-T', 'postgres', 'bash', '-lc',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; psql --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --dbname "$SKYCOMMAND_SOURCE_PGDATABASE" -v ON_ERROR_STOP=1 -c "ANALYZE;"',
  ]);
  console.log('[SkyCommand PostgreSQL] Candidate restore complete.');
}

function runNode(relativePath) {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, relativePath)], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) fail(`Node verification could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
}

function querySourceScalar(sql) {
  ensureCandidateUp();
  const escapedSql = sql.replace(/'/g, `'"'"'`);
  const result = runCompose(
    [
      'exec', '-T', 'postgres', 'bash', '-lc',
      `export PGPASSWORD="$SKYCOMMAND_SOURCE_PGPASSWORD"; psql --host host.docker.internal --port "$SKYCOMMAND_SOURCE_PGPORT" --username "$SKYCOMMAND_SOURCE_PGUSER" --dbname "$SKYCOMMAND_SOURCE_PGDATABASE" -v ON_ERROR_STOP=1 -tA -c '${escapedSql}'`,
    ],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  return String(result.stdout || '').trim();
}

function assertNoActiveSourceRuns() {
  const active = Number.parseInt(
    querySourceScalar("SELECT COUNT(*) FROM worker.workflow_run_records WHERE status IN ('QUEUED','RUNNING')"),
    10,
  );
  if (!Number.isInteger(active)) fail('Could not determine active workflow count on the Windows PostgreSQL source.');
  if (active > 0) fail(`Refusing database cutover while ${active} workflow run(s) are QUEUED/RUNNING on the source database.`);
  console.log('[SkyCommand PostgreSQL] Source workflow ledger is quiescent.');
}

function stopApplicationWriters() {
  console.log('[SkyCommand PostgreSQL] Quiescing Web/API/Node-worker/Temporal-worker before the final source snapshot.');
  runCompose(['stop', ...appServices]);
}

function startApplicationStack({ build = false } = {}) {
  const args = ['up', '-d'];
  if (build) args.push('--build');
  args.push(...fullStackServices);
  runCompose(args);
  waitForCandidate();
}

function upsertEnv(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  const suffix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  return `${content}${suffix}${line}\n`;
}

function writeRuntimeCutoverEnvironment() {
  if (!fs.existsSync(envPath)) fail(`SkyCommand .env file does not exist: ${envPath}`);
  const backupPath = path.join(getBackupDirectory(), `.env_${timestampForFilename()}_pre_postgres_cutover`);
  fs.copyFileSync(envPath, backupPath);

  let content = fs.readFileSync(envPath, 'utf8');
  const candidatePort = String(getCandidatePort());
  for (const [key, value] of [
    ['PGHOST', '127.0.0.1'],
    ['PGPORT', candidatePort],
    ['SKYCOMMAND_DATABASE_HOST', 'postgres'],
    ['SKYCOMMAND_DATABASE_PORT', '5432'],
  ]) {
    content = upsertEnv(content, key, value);
    process.env[key] = value;
  }
  const tempPath = `${envPath}.cutover.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, envPath);
  console.log(`[SkyCommand PostgreSQL] Runtime environment switched to Docker PostgreSQL. Previous .env preserved at ${backupPath}`);
  return backupPath;
}

function loadCutoverMarker() {
  const markerPath = getCutoverMarkerPath();
  if (!fs.existsSync(markerPath)) fail(`PostgreSQL cutover marker not found: ${markerPath}`);
  return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
}

function writeCutoverMarker(data) {
  const markerPath = getCutoverMarkerPath();
  fs.writeFileSync(markerPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return markerPath;
}

function restoreEnvironmentBackup(envBackupPath) {
  if (!envBackupPath || !fs.existsSync(envBackupPath)) fail(`Cutover .env backup does not exist: ${envBackupPath || '<blank>'}`);
  fs.copyFileSync(envBackupPath, envPath);
  dotenv.config({ path: envPath, override: true });
  console.log(`[SkyCommand PostgreSQL] Restored pre-cutover environment from ${envBackupPath}`);
}

function isDockerRuntimeActive() {
  return String(process.env.SKYCOMMAND_DATABASE_HOST || '').trim() === 'postgres';
}

function stageShadowDatabase() {
  const backupPath = createSourceBackup();
  restoreBackup(backupPath);
  runNode('scripts/docker/postgresParity.js');
  console.log('[SkyCommand PostgreSQL] Shadow database staged and critical tool/workflow parity passed.');
  console.log('[SkyCommand PostgreSQL] Existing Docker application services still point to the Windows PostgreSQL source. No cutover has occurred.');
}

function cutover() {
  prepareEnvironment();
  ensureCandidateUp();
  console.log('[SkyCommand PostgreSQL] Prebuilding application images before the write freeze to minimize cutover downtime.');
  runCompose(['build', 'temporal-worker', 'node-worker', 'api', 'web']);
  assertNoActiveSourceRuns();
  stopApplicationWriters();

  let envBackupPath;
  try {
    assertNoActiveSourceRuns();
    const finalSourceBackupPath = createSourceBackup();
    restoreBackup(finalSourceBackupPath);
    runNode('scripts/docker/postgresParity.js');
    runNode('scripts/docker/coreDockerDbCheck.js');

    envBackupPath = writeRuntimeCutoverEnvironment();
    const marker = {
      state: 'cutover',
      cutoverAt: new Date().toISOString(),
      sourcePort: getSourcePort(),
      candidatePort: getCandidatePort(),
      finalSourceBackupPath,
      envBackupPath,
    };
    writeCutoverMarker(marker);

    console.log('[SkyCommand PostgreSQL] Starting the complete Docker runtime against postgres:5432.');
    startApplicationStack();
    runNode('scripts/docker/postgresCutoverCheck.js');

    console.log('[SkyCommand PostgreSQL] CUTOVER COMPLETE. Docker PostgreSQL is now authoritative for SkyCommand.');
    console.log(`[SkyCommand PostgreSQL] Host tools/CLI now use 127.0.0.1:${getCandidatePort()}.`);
    console.log(`[SkyCommand PostgreSQL] Windows PostgreSQL on port ${getSourcePort()} remains online only as a short-lived rollback fallback. Do not write to it.`);
  } catch (error) {
    console.error(`[SkyCommand PostgreSQL] Cutover failed: ${error.message}`);
    if (envBackupPath) {
      console.error('[SkyCommand PostgreSQL] Restoring the pre-cutover runtime environment and source-backed Docker services.');
      restoreEnvironmentBackup(envBackupPath);
      try {
        const marker = loadCutoverMarker();
        writeCutoverMarker({ ...marker, state: 'auto-rolled-back', autoRolledBackAt: new Date().toISOString() });
      } catch (_) {
        // Best-effort marker repair; the restored .env is the authoritative rollback boundary.
      }
      startApplicationStack();
    } else {
      startApplicationStack();
    }
    throw error;
  }
}

function rollback() {
  const marker = loadCutoverMarker();
  console.log('[SkyCommand PostgreSQL] WARNING: rollback does not copy post-cutover Docker writes back to Windows PostgreSQL. Use only for immediate cutover recovery.');
  stopApplicationWriters();
  restoreEnvironmentBackup(marker.envBackupPath);
  startApplicationStack();
  writeCutoverMarker({ ...marker, state: 'rolled-back', rolledBackAt: new Date().toISOString() });
  console.log(`[SkyCommand PostgreSQL] Runtime rolled back to the Windows PostgreSQL source on port ${marker.sourcePort}.`);
}

function persistenceProof() {
  if (!isDockerRuntimeActive()) fail('Persistence proof requires an active Docker PostgreSQL cutover.');
  runNode('scripts/docker/postgresCutoverCheck.js');
  const backupPath = createCandidateBackup();
  console.log('[SkyCommand PostgreSQL] Cold-stopping the full Docker runtime, including PostgreSQL.');
  runCompose(['stop', 'web', 'api', 'node-worker', 'temporal-worker', 'temporal', 'postgres']);
  console.log('[SkyCommand PostgreSQL] Restarting the full Docker runtime from persistent volumes.');
  startApplicationStack();
  runNode('scripts/docker/postgresCutoverCheck.js');
  const marker = loadCutoverMarker();
  writeCutoverMarker({ ...marker, state: 'persistence-proven', persistenceProvenAt: new Date().toISOString(), dockerBackupPath: backupPath });
  console.log(`[SkyCommand PostgreSQL] Persistence proof passed. Docker baseline backup: ${backupPath}`);
}

function finalize() {
  if (!isDockerRuntimeActive()) fail('Finalize requires an active Docker PostgreSQL cutover.');
  runNode('scripts/docker/postgresCutoverCheck.js');
  const backupPath = createCandidateBackup();
  const marker = loadCutoverMarker();
  writeCutoverMarker({ ...marker, state: 'finalized', finalizedAt: new Date().toISOString(), dockerBackupPath: backupPath });
  console.log('[SkyCommand PostgreSQL] Docker PostgreSQL migration finalized.');
  console.log(`[SkyCommand PostgreSQL] Verified Docker backup: ${backupPath}`);
  console.log(`[SkyCommand PostgreSQL] The Windows PostgreSQL service on port ${marker.sourcePort} can now be stopped/disabled after your final UI/CLI acceptance check.`);
}

function main() {
  const action = String(process.argv[2] || 'up').trim().toLowerCase();
  switch (action) {
    case 'up':
      ensureCandidateUp();
      break;
    case 'restart':
      ensureCandidateUp({ recreate: true });
      break;
    case 'backup':
      if (isDockerRuntimeActive()) createCandidateBackup();
      else createSourceBackup();
      break;
    case 'stage':
      stageShadowDatabase();
      break;
    case 'cutover':
      cutover();
      break;
    case 'rollback':
      rollback();
      break;
    case 'persistence':
      persistenceProof();
      break;
    case 'finalize':
      finalize();
      break;
    default:
      fail(`Unsupported action '${action}'. Supported actions: up, restart, backup, stage, cutover, rollback, persistence, finalize.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
