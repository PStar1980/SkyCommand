const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const CRITICAL_DATABASE_ENV_KEYS = Object.freeze([
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'SKYCOMMAND_DATABASE_HOST',
  'SKYCOMMAND_DATABASE_PORT',
]);
const PARENT_PROCESS_ONLY_ENV_PREFIXES = Object.freeze(['SKYCOMMAND_SUPERVISOR_']);
const PARENT_PROCESS_ONLY_ENV_KEYS = Object.freeze([
  'COMSPEC',
  'HOME',
  'NODE_ENV',
  'NODE_OPTIONS',
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'USERPROFILE',
]);

function assertEnvKey(key) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key || ''))) {
    throw new Error('Environment key is invalid.');
  }
}

function activeAssignmentIndexes(content, key) {
  assertEnvKey(key);
  const assignmentPattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  return String(content || '')
    .split(/\r\n|\n/)
    .map((line, index) => (assignmentPattern.test(line) ? index : -1))
    .filter((index) => index >= 0);
}

function duplicateEnvironmentKeyError(key) {
  const error = new Error(
    `Duplicate active environment definitions for ${key}; refusing to normalize automatically.`,
  );
  error.code = 'SKYCOMMAND_ENV_DUPLICATE_KEY';
  error.key = key;
  return error;
}

function assertNoDuplicateActiveEnvDefinitions(content, keys = CRITICAL_DATABASE_ENV_KEYS) {
  for (const key of keys) {
    if (activeAssignmentIndexes(content, key).length > 1) {
      throw duplicateEnvironmentKeyError(key);
    }
  }
  return content;
}

function assertSafeEnvValue(key, value) {
  if (String(value ?? '').includes('\r') || String(value ?? '').includes('\n')) {
    throw new Error(`Environment value for ${key} cannot contain a newline.`);
  }
}

function upsertEnv(content, key, value) {
  assertEnvKey(key);
  assertSafeEnvValue(key, value);

  const source = String(content || '');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r\n|\n/);
  const indexes = activeAssignmentIndexes(source, key);

  if (indexes.length > 1) {
    throw duplicateEnvironmentKeyError(key);
  }

  const line = `${key}=${value}`;
  if (indexes.length === 1) {
    lines[indexes[0]] = line;
    return lines.join(newline);
  }

  const suffix =
    source.length === 0 || source.endsWith('\n') || source.endsWith('\r') ? '' : newline;
  return `${source}${suffix}${line}${newline}`;
}

function parseRepositoryEnv(content) {
  assertNoDuplicateActiveEnvDefinitions(content);
  return dotenv.parse(String(content || ''));
}

function readRepositoryEnv(repositoryRoot) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const envPath = path.join(resolvedRoot, '.env');
  if (!fs.existsSync(envPath)) {
    const error = new Error('SkyCommand repository .env file is unavailable.');
    error.code = 'SKYCOMMAND_ENV_FILE_UNAVAILABLE';
    throw error;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  return {
    envPath,
    content,
    values: parseRepositoryEnv(content),
  };
}

function buildChildProcessEnvironmentFromContent(content, parentEnvironment = process.env) {
  const fileEnvironment = parseRepositoryEnv(content);
  const childEnvironment = {
    ...parentEnvironment,
    ...fileEnvironment,
  };

  for (const key of Object.keys(parentEnvironment)) {
    if (
      PARENT_PROCESS_ONLY_ENV_KEYS.includes(key) ||
      PARENT_PROCESS_ONLY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      childEnvironment[key] = parentEnvironment[key];
    }
  }

  return childEnvironment;
}

function buildChildProcessEnvironment(repositoryRoot, parentEnvironment = process.env) {
  return buildChildProcessEnvironmentFromContent(
    readRepositoryEnv(repositoryRoot).content,
    parentEnvironment,
  );
}

module.exports = {
  CRITICAL_DATABASE_ENV_KEYS,
  activeAssignmentIndexes,
  assertNoDuplicateActiveEnvDefinitions,
  buildChildProcessEnvironment,
  buildChildProcessEnvironmentFromContent,
  parseRepositoryEnv,
  readRepositoryEnv,
  upsertEnv,
};
