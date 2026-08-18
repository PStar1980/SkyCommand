#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

function fail(message) {
  console.error(`[SkyCommand PostgreSQL] ${message}`);
  process.exit(1);
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

function getCandidatePort() {
  const raw = String(process.env.SKYCOMMAND_POSTGRES_HOST_PORT || '55432').trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`SKYCOMMAND_POSTGRES_HOST_PORT must be a valid TCP port. Received: ${raw}`);
  }
  if (port === Number.parseInt(String(process.env.SKYCOMMAND_POSTGRES_SOURCE_PORT || process.env.PGPORT || '5432'), 10)) {
    fail('The candidate PostgreSQL host port must differ from the current source PostgreSQL port during pre-cutover staging.');
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

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: options.stdio || 'inherit',
    shell: false,
  });

  if (result.error) {
    fail(`Docker command could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
}

function runCompose(args, options = {}) {
  return runDocker(['compose', ...args], options);
}

function prepareEnvironment() {
  if (!process.env.PGPASSWORD) {
    fail('PGPASSWORD is required to initialize and clone the PostgreSQL candidate.');
  }
  if (!process.env.PGUSER) {
    fail('PGUSER is required to initialize and clone the PostgreSQL candidate.');
  }
  normalizeDatabaseName(process.env.PGDATABASE);
  getCandidatePort();
}

function waitForCandidate() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', process.env.PGUSER, '-d', 'postgres'],
      {
        cwd: repositoryRoot,
        env: process.env,
        stdio: 'ignore',
        shell: false,
      },
    );
    if (result.status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  fail('Docker PostgreSQL did not become healthy within 30 seconds. Check npm run db:docker:logs.');
}

function ensureCandidateUp({ recreate = false } = {}) {
  prepareEnvironment();
  const args = ['up', '-d'];
  if (recreate) {
    args.push('--force-recreate');
  }
  args.push('postgres');
  runCompose(args);
  waitForCandidate();
  console.log(
    `[SkyCommand PostgreSQL] candidate=postgresql://127.0.0.1:${getCandidatePort()}/${process.env.PGDATABASE}`,
  );
  console.log(
    `[SkyCommand PostgreSQL] source=postgresql://127.0.0.1:${process.env.SKYCOMMAND_POSTGRES_SOURCE_PORT || process.env.PGPORT || '5432'}/${process.env.PGDATABASE}`,
  );
}

function createBackup() {
  ensureCandidateUp();
  const backupDirectory = getBackupDirectory();
  const databaseName = normalizeDatabaseName(process.env.PGDATABASE);
  const backupPath = path.join(
    backupDirectory,
    `${databaseName}_${timestampForFilename()}_pre_docker_cutover.dump`,
  );
  const fd = fs.openSync(backupPath, 'w');

  console.log(`[SkyCommand PostgreSQL] Creating consistent source snapshot: ${backupPath}`);
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'bash',
      '-lc',
      'export PGPASSWORD="$SKYCOMMAND_SOURCE_PGPASSWORD"; exec pg_dump --host host.docker.internal --port "$SKYCOMMAND_SOURCE_PGPORT" --username "$SKYCOMMAND_SOURCE_PGUSER" --dbname "$SKYCOMMAND_SOURCE_PGDATABASE" --format=custom --no-owner --no-acl',
    ],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', fd, 'inherit'],
      shell: false,
    },
  );
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

function restoreBackup(backupPath) {
  ensureCandidateUp();
  const resolvedBackup = path.resolve(backupPath);
  if (!fs.existsSync(resolvedBackup) || !fs.statSync(resolvedBackup).isFile()) {
    fail(`Backup file does not exist: ${resolvedBackup}`);
  }

  console.log('[SkyCommand PostgreSQL] Recreating candidate database with the Docker cluster locale.');
  runCompose([
    'exec',
    '-T',
    'postgres',
    'bash',
    '-lc',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; dropdb --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --if-exists --force "$SKYCOMMAND_SOURCE_PGDATABASE" && createdb --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --template=template0 --encoding=UTF8 "$SKYCOMMAND_SOURCE_PGDATABASE"',
  ]);

  const fd = fs.openSync(resolvedBackup, 'r');
  console.log(`[SkyCommand PostgreSQL] Restoring candidate from ${resolvedBackup}`);
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'bash',
      '-lc',
      'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_restore --host 127.0.0.1 --port 5432 --username "$POSTGRES_USER" --dbname "$SKYCOMMAND_SOURCE_PGDATABASE" --no-owner --no-acl --exit-on-error',
    ],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: [fd, 'inherit', 'inherit'],
      shell: false,
    },
  );
  fs.closeSync(fd);

  if (result.error) {
    fail(`PostgreSQL restore could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  runCompose([
    'exec',
    '-T',
    'postgres',
    'bash',
    '-lc',
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
  if (result.error) {
    fail(`Node verification could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
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
      createBackup();
      break;
    case 'stage': {
      const backupPath = createBackup();
      restoreBackup(backupPath);
      runNode('scripts/docker/postgresParity.js');
      console.log('[SkyCommand PostgreSQL] Shadow database staged and critical tool/workflow parity passed.');
      console.log('[SkyCommand PostgreSQL] Existing Docker application services still point to the Windows PostgreSQL source. No cutover has occurred.');
      break;
    }
    default:
      fail(`Unsupported action '${action}'. Supported actions: up, restart, backup, stage.`);
  }
}

main();
