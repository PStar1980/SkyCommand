const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const SKYCOMMAND_ROOT = path.resolve(__dirname, '../../..');
const SQL_ROOTS = Object.freeze([
  path.join(SKYCOMMAND_ROOT, 'packages', 'db_build', 'src', 'migrations'),
  path.join(SKYCOMMAND_ROOT, 'packages', 'db_build', 'src', 'seeds'),
]);
const SQL_ROOT_LABELS = Object.freeze([
  'packages/db_build/src/migrations',
  'packages/db_build/src/seeds',
]);
const BASELINE_ORDINAL = 128;
const BASELINE_CONTRACT = 'skycommand_database_baseline.v1';
const UPGRADE_LOCK_NAMESPACE = 29431;
const UPGRADE_LOCK_KEY = 129;
const RUNNER_VERSION = 'database_upgrade.v1';
const REGISTERED_DEV_TOOL_EXECUTION_PATH = 'REGISTERED_DEV_TOOL';
const LEGACY_SINGLE_UNDERSCORE_FILENAMES = new Set([
  '00007_indicator_views.sql',
  '00008_indicator_views.sql',
  '00009_gen_indicator_tables.sql',
  '00011_gen_indicator_tables.sql',
  '00012_indicator_views.sql',
  '00013_indicator_views.sql',
]);

class DatabaseUpgradeError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message);
    this.name = 'DatabaseUpgradeError';
    this.code = code;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

function upgradeError(code, message, details = {}, cause = null) {
  return new DatabaseUpgradeError(code, message, details, cause);
}

function normalizeDatabaseName(value) {
  const databaseName = String(value || '').trim();
  if (!databaseName) {
    throw upgradeError('DATABASE_NAME_REQUIRED', 'PGDATABASE must be configured.');
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(databaseName)) {
    throw upgradeError(
      'DATABASE_NAME_INVALID',
      'PGDATABASE must be a safe PostgreSQL database name.',
    );
  }
  return databaseName;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  throw upgradeError(
    'BOOLEAN_PARAMETER_INVALID',
    `Invalid boolean value for upgrade gate: ${value}`,
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function getSourceRevision(environment = process.env) {
  const value = String(environment.SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION || '').trim();
  return value || null;
}

function normalizeSystemIdentifier(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function getSqlFileKindFromRoot(rootName) {
  if (rootName === 'migrations') return 'MIGRATION';
  if (rootName === 'seeds') return 'SEED';
  throw upgradeError('DATABASE_SQL_ROOT_INVALID', `Unsupported governed SQL root: ${rootName}.`);
}

function parseGovernedFilename(fileName) {
  const name = path.basename(String(fileName || ''));
  const match = name.match(/^(\d{5})(__|_)([A-Za-z0-9][A-Za-z0-9._-]*)\.sql$/);
  if (!match) {
    throw upgradeError(
      'DATABASE_UPGRADE_MALFORMED_SQL_FILENAME',
      `Governed SQL filename is malformed: ${name || '(blank)'}.`,
      { fileName: name || null },
    );
  }

  const ordinal = Number.parseInt(match[1], 10);
  const separator = match[2];
  if (separator === '_' && !LEGACY_SINGLE_UNDERSCORE_FILENAMES.has(name)) {
    throw upgradeError(
      'DATABASE_UPGRADE_LEGACY_FILENAME_NOT_ALLOWED',
      `Governed SQL filename ${name} must use the double-underscore form unless it is an accepted historical filename.`,
      { fileName: name, ordinal },
    );
  }

  return {
    ordinal,
    separator,
    title: match[3],
  };
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getRealPath(filePath, fileSystem = fs) {
  if (typeof fileSystem.realpathSync !== 'function') return path.resolve(filePath);
  return fileSystem.realpathSync(filePath);
}

function assertCanonicalSqlRoot(root, repositoryRoot, fileSystem = fs) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedRoot = path.resolve(root);
  if (!isPathInside(resolvedRepositoryRoot, resolvedRoot)) {
    throw upgradeError(
      'DATABASE_UPGRADE_SQL_PATH_ESCAPE',
      'A governed SQL root resolves outside the registered repository root.',
    );
  }
  if (!fileSystem.existsSync(resolvedRoot)) return;
  const realRepositoryRoot = getRealPath(resolvedRepositoryRoot, fileSystem);
  const realRoot = getRealPath(resolvedRoot, fileSystem);
  if (!isPathInside(realRepositoryRoot, realRoot)) {
    throw upgradeError(
      'DATABASE_UPGRADE_SQL_PATH_ESCAPE',
      'A governed SQL root resolves outside the registered repository root.',
    );
  }
}

function getAllSqlFiles(root, fileSystem = fs, canonicalRoot = root) {
  if (!fileSystem.existsSync(root)) return [];
  const entries = fileSystem.readdirSync(root, { withFileTypes: true });
  const results = [];
  const realCanonicalRoot = getRealPath(canonicalRoot, fileSystem);

  entries.forEach((entry) => {
    const absolutePath = path.join(root, entry.name);
    const stat =
      typeof fileSystem.lstatSync === 'function' ? fileSystem.lstatSync(absolutePath) : null;
    if (stat?.isSymbolicLink?.()) {
      throw upgradeError(
        'DATABASE_UPGRADE_SQL_PATH_ESCAPE',
        `Governed SQL roots may not contain symbolic links: ${entry.name}.`,
        { path: entry.name },
      );
    }
    const realPath = getRealPath(absolutePath, fileSystem);
    if (!isPathInside(realCanonicalRoot, realPath)) {
      throw upgradeError(
        'DATABASE_UPGRADE_SQL_PATH_ESCAPE',
        `Governed SQL path escapes its canonical root: ${entry.name}.`,
        { path: entry.name },
      );
    }
    if (entry.isDirectory()) {
      results.push(...getAllSqlFiles(absolutePath, fileSystem, canonicalRoot));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      results.push(absolutePath);
    }
  });

  return results;
}

function compareChanges(left, right) {
  if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
  if (left.kind !== right.kind) return left.kind === 'MIGRATION' ? -1 : 1;
  return left.relativePath.localeCompare(right.relativePath);
}

/**
 * Discovers only the two source-controlled SQL roots. The optional repositoryRoot
 * and fileSystem seams are for deterministic self-tests; the CLI never exposes them.
 */
function discoverGovernedSqlChanges({ repositoryRoot = SKYCOMMAND_ROOT, fileSystem = fs } = {}) {
  const roots = [
    path.join(repositoryRoot, 'packages', 'db_build', 'src', 'migrations'),
    path.join(repositoryRoot, 'packages', 'db_build', 'src', 'seeds'),
  ];
  const changes = [];
  const ordinals = new Map();

  roots.forEach((root) => {
    assertCanonicalSqlRoot(root, repositoryRoot, fileSystem);
    const kind = getSqlFileKindFromRoot(path.basename(root));
    getAllSqlFiles(root, fileSystem).forEach((absolutePath) => {
      const parsed = parseGovernedFilename(path.basename(absolutePath));
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
      const previous = ordinals.get(parsed.ordinal);
      if (previous) {
        throw upgradeError(
          'DATABASE_UPGRADE_DUPLICATE_ORDINAL',
          `Duplicate global SQL ordinal ${String(parsed.ordinal).padStart(5, '0')}.`,
          { ordinal: parsed.ordinal, paths: [previous.relativePath, relativePath].sort() },
        );
      }

      const contents = Buffer.from(fileSystem.readFileSync(absolutePath));
      const change = {
        absolutePath,
        ordinal: parsed.ordinal,
        kind,
        relativePath,
        sha256: sha256(contents),
        sqlBytes: contents,
        separator: parsed.separator,
      };
      ordinals.set(parsed.ordinal, change);
      changes.push(change);
    });
  });

  if (changes.length === 0) {
    throw upgradeError(
      'DATABASE_UPGRADE_SQL_FILES_NOT_FOUND',
      `No governed SQL files found under ${SQL_ROOT_LABELS.join(', ')}.`,
    );
  }

  return changes.sort(compareChanges);
}

function publicChange(change) {
  return {
    ordinal: change.ordinal,
    kind: change.kind,
    relativePath: change.relativePath,
    sha256: change.sha256,
  };
}

function manifestDigest(changes = []) {
  return sha256(canonicalJson(changes.map(publicChange).sort(compareChanges)));
}

function assertManifestMatches(expectedChanges, actualChanges) {
  const expected = expectedChanges.map(publicChange).sort(compareChanges);
  const actual = actualChanges.map(publicChange).sort(compareChanges);
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    const expectedByPath = new Map(expected.map((change) => [change.relativePath, change]));
    const actualByPath = new Map(actual.map((change) => [change.relativePath, change]));
    const changedPaths = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])]
      .filter(
        (relativePath) =>
          canonicalJson(expectedByPath.get(relativePath)) !==
          canonicalJson(actualByPath.get(relativePath)),
      )
      .sort();
    throw upgradeError(
      'DATABASE_UPGRADE_MANIFEST_DRIFT',
      'The canonical migration/seed manifest changed before execution.',
      { changedPaths },
    );
  }
}

function getFileOutcomeStatus(change, ledgerRows = []) {
  const receipt = ledgerRows.find((row) => Number(row.ordinal) === Number(change.ordinal));
  return receipt ? 'ALREADY_LEDGERED' : 'PENDING_NOT_ATTEMPTED';
}

function createFileOutcomes(changes = [], ledgerRows = []) {
  return changes
    .filter((change) => change.ordinal > BASELINE_ORDINAL)
    .sort(compareChanges)
    .map((change) => ({
      ordinal: change.ordinal,
      kind: change.kind,
      relativePath: change.relativePath,
      sha256: change.sha256,
      status: getFileOutcomeStatus(change, ledgerRows),
      rolledBack: false,
      errorCode: null,
    }));
}

function createLedgerSnapshot(ledgerState = {}) {
  return {
    available: ledgerState.available === true,
    verification: ledgerState.verification || 'UNKNOWN',
    appliedCount: Number(ledgerState.appliedCount || 0),
    ordinals: (ledgerState.ledgerRows || [])
      .map((row) => Number(row.ordinal))
      .sort((a, b) => a - b),
  };
}

function publicLedgerReceipt(row = {}) {
  return {
    changeId: row.change_id || row.changeId || null,
    baselineId: row.baseline_id || row.baselineId || null,
    ordinal: Number(row.ordinal),
    kind: row.change_kind || row.kind || null,
    relativePath: row.source_path || row.relativePath || null,
    sha256:
      String(row.sha256 || '')
        .trim()
        .toUpperCase() || null,
    appliedAt: row.applied_at || row.appliedAt || null,
    sourceRevision: row.source_revision || row.sourceRevision || null,
    planDigest:
      String(row.plan_digest || row.planDigest || '')
        .trim()
        .toUpperCase() || null,
  };
}

function createPgDatabaseAdapter(environment = process.env, ClientClass = Client) {
  return {
    async connect() {
      const host = String(environment.PGHOST || '').trim();
      const user = String(environment.PGUSER || '').trim();
      const password = environment.PGPASSWORD;
      const database = normalizeDatabaseName(environment.PGDATABASE);
      if (!host || !user || password === undefined || password === '') {
        throw upgradeError(
          'DATABASE_ENVIRONMENT_MISSING',
          'PGHOST, PGUSER, PGPASSWORD, and PGDATABASE are required for database upgrade inspection.',
        );
      }
      const client = new ClientClass({
        host,
        port: Number(environment.PGPORT || 5432),
        database,
        user,
        password,
        application_name: 'skycommand_db_upgrade',
        connectionTimeoutMillis: Number(
          environment.SKYCOMMAND_DB_UPGRADE_CONNECT_TIMEOUT_MS || 10000,
        ),
      });
      await client.connect();
      return client;
    },
  };
}

async function readDatabaseIdentity(client) {
  const result = await client.query(`
    SELECT
      current_database() AS database_name,
      current_setting('server_version') AS server_version,
      inet_server_port() AS server_port,
      CAST((pg_control_system()).system_identifier AS text) AS system_identifier
  `);
  const row = result.rows[0] || {};
  return {
    databaseName: row.database_name || null,
    serverVersion: row.server_version || null,
    serverPort:
      row.server_port === null || row.server_port === undefined ? null : Number(row.server_port),
    systemIdentifier: normalizeSystemIdentifier(row.system_identifier),
  };
}

async function readBaselineProbes(client) {
  const schemas = await client.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])`,
    [['core', 'auth', 'worker']],
  );
  const tables = await client.query(`
    SELECT
      to_regclass('core.repositories') AS repositories,
      to_regclass('worker.workflow_run_records') AS workflow_run_records,
      to_regclass('core.browser_automations') AS browser_automations
  `);
  const constraints = await client.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'worker'
      AND t.relname = 'workflow_run_records'
      AND c.contype = 'c'
  `);

  const schemaNames = new Set(schemas.rows.map((row) => row.schema_name));
  const tableRow = tables.rows[0] || {};
  const definitions = constraints.rows.map((row) => String(row.definition || '').toLowerCase());
  const stepCSource = definitions.some(
    (definition) => definition.includes('run_source') && definition.includes("'assistant'"),
  );
  const stepCTrigger = definitions.some(
    (definition) => definition.includes('trigger_type') && definition.includes("'assistant'"),
  );
  const probes = [
    {
      name: 'REQUIRED_SCHEMAS',
      status: ['core', 'auth', 'worker'].every((name) => schemaNames.has(name)) ? 'PASS' : 'FAIL',
      evidence: { schemas: ['core', 'auth', 'worker'].filter((name) => schemaNames.has(name)) },
    },
    {
      name: 'HISTORICAL_CORE_REPOSITORY_IDENTITY',
      status: tableRow.repositories ? 'PASS' : 'FAIL',
      evidence: { table: 'core.repositories', present: Boolean(tableRow.repositories) },
    },
    {
      name: 'STEP_C_ASSISTANT_WORKFLOW_RUN_ATTRIBUTION',
      status: tableRow.workflow_run_records && stepCSource && stepCTrigger ? 'PASS' : 'FAIL',
      evidence: {
        table: 'worker.workflow_run_records',
        present: Boolean(tableRow.workflow_run_records),
        runSourceAssistant: stepCSource,
        triggerTypeAssistant: stepCTrigger,
      },
    },
    {
      name: 'STEP_C_BROWSER_AUTOMATION_FOUNDATION',
      status: tableRow.browser_automations ? 'PASS' : 'FAIL',
      evidence: {
        table: 'core.browser_automations',
        present: Boolean(tableRow.browser_automations),
      },
    },
  ];

  return probes;
}

function assertBaselineProbes(probes) {
  const failed = probes.filter((probe) => probe.status !== 'PASS');
  if (failed.length > 0) {
    throw upgradeError(
      'DATABASE_UPGRADE_BASELINE_EVIDENCE_MISSING',
      'Expected historical baseline evidence is incomplete; upgrade is fail-closed.',
      { failedProbes: failed.map((probe) => probe.name) },
    );
  }
}

async function readLedgerState(client, identity, changes) {
  const existence = await client.query(`
    SELECT
      to_regclass('core.database_upgrade_baselines') AS baseline_table,
      to_regclass('core.database_upgrade_ledger') AS ledger_table
  `);
  const row = existence.rows[0] || {};
  const baselineAvailable = Boolean(row.baseline_table);
  const ledgerAvailable = Boolean(row.ledger_table);

  if (baselineAvailable !== ledgerAvailable) {
    throw upgradeError(
      'DATABASE_UPGRADE_LEDGER_SCHEMA_INCOMPLETE',
      'Database upgrade ledger tables are only partially present.',
    );
  }
  if (!ledgerAvailable) {
    return {
      available: false,
      verification: 'NOT_INITIALIZED',
      baseline: null,
      ledgerRows: [],
      appliedCount: 0,
      driftDetected: false,
    };
  }

  const baselines = await client.query(`
    SELECT baseline_id, baseline_contract, baseline_ordinal, database_name,
           database_server_version, source_revision, evidence, verified_at
    FROM core.database_upgrade_baselines
    ORDER BY created_at, baseline_id
  `);
  const ledger = await client.query(`
    SELECT change_id, baseline_id, ordinal, change_kind, source_path, sha256,
           applied_at, source_revision, plan_digest, runner_version, evidence
    FROM core.database_upgrade_ledger
    ORDER BY ordinal
  `);
  const baseline = baselines.rows[0] || null;
  if (!baseline && ledger.rows.length === 0) {
    return {
      available: true,
      verification: 'NOT_INITIALIZED',
      baseline: null,
      ledgerRows: [],
      appliedCount: 0,
      driftDetected: false,
    };
  }
  if (
    !baseline ||
    baseline.baseline_contract !== BASELINE_CONTRACT ||
    Number(baseline.baseline_ordinal) !== BASELINE_ORDINAL ||
    baseline.database_name !== identity.databaseName
  ) {
    throw upgradeError(
      'DATABASE_UPGRADE_BASELINE_RECORD_INVALID',
      'Recorded database baseline identity/version does not match the connected database.',
    );
  }
  if (baselines.rows.length !== 1) {
    throw upgradeError(
      'DATABASE_UPGRADE_MULTIPLE_BASELINES',
      'More than one database upgrade baseline record exists.',
    );
  }

  const baselineEvidence =
    baseline.evidence && typeof baseline.evidence === 'object' && !Array.isArray(baseline.evidence)
      ? baseline.evidence
      : {};
  if (Object.prototype.hasOwnProperty.call(baselineEvidence, 'systemIdentifier')) {
    const recordedSystemIdentifier = normalizeSystemIdentifier(baselineEvidence.systemIdentifier);
    if (!recordedSystemIdentifier || recordedSystemIdentifier !== identity.systemIdentifier) {
      throw upgradeError(
        'DATABASE_UPGRADE_BASELINE_DATABASE_IDENTITY_DRIFT',
        'Recorded database baseline system identifier does not match the connected PostgreSQL cluster.',
      );
    }
  }

  const byPath = new Map(changes.map((change) => [change.relativePath, change]));
  const byOrdinal = new Map(changes.map((change) => [change.ordinal, change]));
  for (const receipt of ledger.rows) {
    const change = byOrdinal.get(Number(receipt.ordinal));
    if (!change || receipt.source_path !== change.relativePath) {
      throw upgradeError(
        'DATABASE_UPGRADE_SOURCE_DRIFT',
        `Ledgered SQL ordinal ${receipt.ordinal} no longer matches governed source.`,
        { ordinal: Number(receipt.ordinal), sourcePath: receipt.source_path || null },
      );
    }
    if (
      receipt.change_kind !== change.kind ||
      String(receipt.sha256 || '').toUpperCase() !== change.sha256 ||
      !byPath.has(receipt.source_path)
    ) {
      throw upgradeError(
        'DATABASE_UPGRADE_CHECKSUM_DRIFT',
        `Checksum or kind drift detected for ledgered SQL ordinal ${receipt.ordinal}.`,
        { ordinal: Number(receipt.ordinal), sourcePath: change.relativePath },
      );
    }
    if (Number(receipt.ordinal) <= BASELINE_ORDINAL) {
      throw upgradeError(
        'DATABASE_UPGRADE_HISTORICAL_RECEIPT_INVALID',
        'Historical ordinals must remain represented by baseline evidence, not individual receipts.',
        { ordinal: Number(receipt.ordinal) },
      );
    }
  }

  return {
    available: true,
    verification: 'VERIFIED',
    baseline,
    ledgerRows: ledger.rows,
    appliedCount: ledger.rows.length,
    driftDetected: false,
  };
}

function buildPlan({ identity, baseline, ledgerState, changes, sourceRevision }) {
  const recordedOrdinals = new Set(
    (ledgerState.ledgerRows || []).map((row) => Number(row.ordinal)),
  );
  const pending = changes
    .filter((change) => change.ordinal > BASELINE_ORDINAL && !recordedOrdinals.has(change.ordinal))
    .sort(compareChanges);
  const planPayload = {
    contract: 'database_upgrade_plan.v1',
    database: {
      databaseName: identity.databaseName,
      serverPort: identity.serverPort,
      serverVersion: identity.serverVersion,
      systemIdentifier: normalizeSystemIdentifier(identity.systemIdentifier),
    },
    baseline: {
      contract: BASELINE_CONTRACT,
      ordinal: BASELINE_ORDINAL,
      status: baseline.status,
      recorded: Boolean(ledgerState.baseline),
    },
    sourceRevision,
    pendingChanges: pending.map(publicChange),
  };
  return {
    pending,
    digest: sha256(canonicalJson(planPayload)),
    manifestDigest: manifestDigest(changes),
    payload: planPayload,
  };
}

async function inspectAndPlan(client, identity, changes, sourceRevision) {
  const probes = await readBaselineProbes(client);
  assertBaselineProbes(probes);
  const ledgerState = await readLedgerState(client, identity, changes);
  const baseline = {
    status: ledgerState.available ? 'VERIFIED' : 'VERIFIED',
    contract: BASELINE_CONTRACT,
    ordinal: BASELINE_ORDINAL,
    recorded: Boolean(ledgerState.baseline),
    probes,
  };
  const plan = buildPlan({ identity, baseline, ledgerState, changes, sourceRevision });
  return { probes, ledgerState, baseline, plan };
}

function removeSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function removePlpgsqlDoBlockStructure(sql) {
  const source = String(sql);
  const doBlockStart = /\bDO\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/gi;
  let cursor = 0;
  let output = '';
  let match;

  while ((match = doBlockStart.exec(source)) !== null) {
    output += source.slice(cursor, match.index);
    const delimiter = match[1];
    const bodyStart = doBlockStart.lastIndex;
    const bodyEnd = source.indexOf(delimiter, bodyStart);
    if (bodyEnd < 0) {
      output += source.slice(match.index);
      cursor = source.length;
      break;
    }

    const body = source.slice(bodyStart, bodyEnd).replace(/\b(BEGIN|END)\b/gi, ' ');
    output += `${source.slice(match.index, bodyStart)}${body}${delimiter}`;
    cursor = bodyEnd + delimiter.length;
    doBlockStart.lastIndex = cursor;
  }

  return output + source.slice(cursor);
}

function assertUpgradeSqlTransactionSafe(sql, change) {
  const normalized = removeSqlComments(sql);
  if (/\b(COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(normalized)) {
    throw upgradeError(
      'DATABASE_UPGRADE_SQL_TRANSACTION_CONTROL_NOT_ALLOWED',
      `Governed SQL ${change.relativePath} must not own transaction boundaries.`,
      { ordinal: change.ordinal, relativePath: change.relativePath },
    );
  }

  const nonProcedural = removePlpgsqlDoBlockStructure(normalized);
  if (/\bBEGIN\b|\bEND\s*;/i.test(nonProcedural)) {
    throw upgradeError(
      'DATABASE_UPGRADE_SQL_TRANSACTION_CONTROL_NOT_ALLOWED',
      `Governed SQL ${change.relativePath} must not own transaction boundaries.`,
      { ordinal: change.ordinal, relativePath: change.relativePath },
    );
  }
  if (/\b(DROP\s+DATABASE|DROP\s+SCHEMA|DROP\s+TABLE|TRUNCATE)\b/i.test(normalized)) {
    throw upgradeError(
      'DATABASE_UPGRADE_DESTRUCTIVE_SQL_NOT_ALLOWED',
      `Destructive SQL is not allowed in an incremental upgrade: ${change.relativePath}.`,
      { ordinal: change.ordinal, relativePath: change.relativePath },
    );
  }
}

async function acquireUpgradeLock(client) {
  const result = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
    UPGRADE_LOCK_NAMESPACE,
    UPGRADE_LOCK_KEY,
  ]);
  if (!result.rows[0]?.acquired) {
    throw upgradeError(
      'DATABASE_UPGRADE_LOCK_NOT_ACQUIRED',
      'Another governed database upgrade owns the target database lock.',
      { mechanism: 'pg_advisory_lock', namespace: UPGRADE_LOCK_NAMESPACE, key: UPGRADE_LOCK_KEY },
    );
  }
}

async function releaseUpgradeLock(client) {
  const result = await client.query('SELECT pg_advisory_unlock($1, $2) AS released', [
    UPGRADE_LOCK_NAMESPACE,
    UPGRADE_LOCK_KEY,
  ]);
  return Boolean(result.rows[0]?.released);
}

async function insertBaseline(client, identity, sourceRevision, probes) {
  const result = await client.query(
    `
      INSERT INTO core.database_upgrade_baselines (
        baseline_contract, baseline_ordinal, database_name,
        database_server_version, source_revision, evidence
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING baseline_id
    `,
    [
      BASELINE_CONTRACT,
      BASELINE_ORDINAL,
      identity.databaseName,
      identity.serverVersion,
      sourceRevision,
      JSON.stringify({
        probes,
        systemIdentifier: identity.systemIdentifier,
        historicalSqlReplayed: false,
      }),
    ],
  );
  return result.rows[0]?.baseline_id || null;
}

async function insertLedgerReceipt(client, change, baselineId, sourceRevision, planDigest) {
  await client.query(
    `
      INSERT INTO core.database_upgrade_ledger (
        baseline_id, ordinal, change_kind, source_path, sha256,
        source_revision, plan_digest, runner_version, evidence
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      baselineId,
      change.ordinal,
      change.kind,
      change.relativePath,
      change.sha256,
      sourceRevision,
      planDigest,
      RUNNER_VERSION,
      JSON.stringify({ receipt: 'SUCCESS', historicalSqlReplayed: false }),
    ],
  );
}

async function applyChange(client, change, context) {
  const sqlBytes = Buffer.isBuffer(change.sqlBytes)
    ? change.sqlBytes
    : typeof change.sql === 'string'
      ? Buffer.from(change.sql, 'utf8')
      : null;
  if (!sqlBytes) {
    throw upgradeError(
      'DATABASE_UPGRADE_VERIFIED_BYTES_MISSING',
      `Verified SQL bytes were not captured for ${change.relativePath}.`,
      { ordinal: change.ordinal, relativePath: change.relativePath },
    );
  }
  if (change.sha256 && sha256(sqlBytes) !== String(change.sha256).toUpperCase()) {
    throw upgradeError(
      'DATABASE_UPGRADE_VERIFIED_BYTES_HASH_MISMATCH',
      `Verified SQL bytes do not match the planned checksum for ${change.relativePath}.`,
      { ordinal: change.ordinal, relativePath: change.relativePath },
    );
  }
  const sql = sqlBytes.toString('utf8');
  assertUpgradeSqlTransactionSafe(sql, change);
  await client.query('BEGIN');
  let commitAttempted = false;
  try {
    await client.query(sql);
    if (!context.baselineId) {
      if (change.ordinal !== BASELINE_ORDINAL + 1) {
        throw upgradeError(
          'DATABASE_UPGRADE_BASELINE_NOT_BOOTSTRAPPED',
          'The first post-baseline change must establish the baseline receipt before later changes.',
          { ordinal: change.ordinal, relativePath: change.relativePath },
        );
      }
      context.baselineId = await insertBaseline(
        client,
        context.identity,
        context.sourceRevision,
        context.probes,
      );
      if (!context.baselineId) {
        throw upgradeError(
          'DATABASE_UPGRADE_BASELINE_RECEIPT_FAILED',
          'Database baseline receipt did not return an identity.',
        );
      }
    }
    await insertLedgerReceipt(
      client,
      change,
      context.baselineId,
      context.sourceRevision,
      context.planDigest,
    );
    commitAttempted = true;
    await client.query('COMMIT');
  } catch (cause) {
    if (!commitAttempted) await client.query('ROLLBACK').catch(() => {});
    const safeCauseMessage =
      String(cause?.message || '').replace(/\s+/g, ' ').slice(0, 500) || null;
    if (cause instanceof DatabaseUpgradeError) {
      if (!commitAttempted) {
        cause.details = { ...cause.details, rolledBack: true };
      }
      throw cause;
    }
    if (commitAttempted) {
      throw upgradeError(
        'DATABASE_UPGRADE_COMMIT_UNCERTAIN',
        `Commit state is uncertain for governed SQL change: ${change.relativePath}.`,
        { ordinal: change.ordinal, relativePath: change.relativePath, rolledBack: false },
        cause,
      );
    }
    throw upgradeError(
      'DATABASE_UPGRADE_CHANGE_FAILED',
      `Governed SQL change failed: ${change.relativePath}${
        cause?.code || safeCauseMessage
          ? ` (${[cause?.code, safeCauseMessage].filter(Boolean).join(': ')})`
          : ''
      }.`,
      {
        ordinal: change.ordinal,
        relativePath: change.relativePath,
        rolledBack: true,
        causeCode: cause?.code || null,
        causeMessage: safeCauseMessage,
      },
      cause,
    );
  }
}

function createInitialUpgradeOutput(mode, startedAt, execution = {}) {
  return {
    mode,
    execution: {
      path: execution.path || null,
      toolCode: execution.toolCode || null,
      executionId: execution.executionId || null,
      reconciledFromLedger: false,
    },
    binding: execution.binding || null,
    databaseIdentity: {
      databaseName: null,
      serverVersion: null,
      serverPort: null,
      systemIdentifier: null,
    },
    baseline: {
      status: 'UNKNOWN',
      contract: BASELINE_CONTRACT,
      ordinal: BASELINE_ORDINAL,
      recorded: false,
      probes: [],
    },
    sourceRevision: null,
    planDigest: null,
    manifestDigest: null,
    pendingCount: 0,
    pendingChanges: [],
    appliedCount: 0,
    fileOutcomes: [],
    ledger: {
      available: false,
      verification: 'UNKNOWN',
      appliedCount: 0,
      driftDetected: false,
      receipts: [],
      before: null,
      after: null,
    },
    lock: {
      requested: false,
      acquired: false,
      released: false,
      mechanism: 'pg_advisory_lock',
    },
    revalidation: {
      performed: false,
      outcome: 'NOT_REQUESTED',
      manifestDigest: null,
    },
    outcome: 'FAILED',
    warnings: [
      {
        code: 'HISTORICAL_SQL_NOT_INDIVIDUALLY_LEDGERED',
        message: 'Ordinals at or below 00128 are represented by verified baseline evidence only.',
      },
    ],
    errors: [],
    timing: {
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(startedAt).toISOString(),
      durationMs: 0,
    },
  };
}

function finishUpgradeOutput(output, startedAt) {
  const completedAt = Date.now();
  output.timing = {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: Math.max(0, completedAt - startedAt),
  };
  return output;
}

function attachUpgradeFailure(error, output) {
  if (!(error instanceof DatabaseUpgradeError)) {
    error = upgradeError(
      'DATABASE_UPGRADE_DATABASE_OPERATION_FAILED',
      'A database inspection or upgrade operation failed.',
      {},
      error,
    );
  }
  if (
    error.code === 'DATABASE_UPGRADE_BASELINE_EVIDENCE_MISSING' ||
    error.code === 'DATABASE_UPGRADE_BASELINE_DATABASE_IDENTITY_DRIFT' ||
    error.code === 'DATABASE_UPGRADE_BASELINE_RECORD_INVALID'
  ) {
    output.baseline.status = 'FAILED';
  }
  if (
    error.code === 'DATABASE_UPGRADE_SOURCE_DRIFT' ||
    error.code === 'DATABASE_UPGRADE_CHECKSUM_DRIFT' ||
    error.code === 'DATABASE_UPGRADE_MANIFEST_DRIFT' ||
    error.code === 'DATABASE_UPGRADE_SQL_PATH_ESCAPE'
  ) {
    output.ledger.verification = 'DRIFT';
    output.ledger.driftDetected = true;
  }
  if (
    error.code === 'DATABASE_UPGRADE_MANIFEST_DRIFT' ||
    error.code === 'DATABASE_UPGRADE_SQL_PATH_ESCAPE'
  ) {
    output.revalidation.outcome = 'DRIFT_REJECTED';
  }
  if (Number.isInteger(error.details?.ordinal)) {
    const failedOutcome = output.fileOutcomes.find(
      (outcome) => outcome.ordinal === error.details.ordinal,
    );
    if (failedOutcome && failedOutcome.status === 'PENDING_NOT_ATTEMPTED') {
      failedOutcome.status = error.details.rolledBack ? 'FAILED_ROLLED_BACK' : 'FAILED';
      failedOutcome.rolledBack = error.details.rolledBack === true;
      failedOutcome.errorCode = error.code || 'DATABASE_UPGRADE_FAILED';
    }
  }
  output.errors = [
    {
      code: error.code || 'DATABASE_UPGRADE_FAILED',
      message: error.message || 'Database upgrade failed.',
    },
  ];
  error.upgradeResult = output;
  return error;
}

function assertConfiguredApplyTarget({ environment, configuredDatabase, identity }) {
  const allowedTarget = String(environment.SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE || '').trim();
  if (!allowedTarget) {
    throw upgradeError(
      'DATABASE_UPGRADE_TARGET_NOT_CONFIGURED',
      'APPLY requires the registered DEV target database to be configured.',
    );
  }
  if (normalizeDatabaseName(allowedTarget) !== configuredDatabase) {
    throw upgradeError(
      'DATABASE_UPGRADE_TARGET_MISMATCH',
      'Configured upgrade target does not match PGDATABASE.',
    );
  }
  const allowedSystemIdentifier = normalizeSystemIdentifier(
    environment.SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER,
  );
  if (!allowedSystemIdentifier) {
    throw upgradeError(
      'DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_NOT_CONFIGURED',
      'APPLY requires the registered DEV target PostgreSQL cluster to be configured.',
    );
  }
  if (allowedSystemIdentifier !== identity.systemIdentifier) {
    throw upgradeError(
      'DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_MISMATCH',
      'Configured upgrade target system identifier does not match the connected PostgreSQL cluster.',
    );
  }
}

function assertIdentityMatches(left, right) {
  if (
    left?.databaseName !== right?.databaseName ||
    left?.systemIdentifier !== right?.systemIdentifier
  ) {
    throw upgradeError(
      'DATABASE_UPGRADE_IDENTITY_CHANGED_UNDER_LOCK',
      'Connected database identity changed while the upgrade lock was held.',
    );
  }
}

async function executeDatabaseUpgradeInternal(
  {
    mode = 'PLAN',
    expectedPlanDigest = null,
    confirmed = false,
    environment = process.env,
    adapter = null,
    repositoryRoot = SKYCOMMAND_ROOT,
    fileSystem = fs,
    binding = null,
    toolCode = null,
  } = {},
  executionPath = 'MANUAL',
) {
  const normalizedMode = mode === 'APPLY' ? 'APPLY' : 'PLAN';
  const startedAt = Date.now();
  const output = createInitialUpgradeOutput(normalizedMode, startedAt, {
    path: executionPath,
    toolCode,
    executionId: environment.SKYCOMMAND_EXECUTION_ID || null,
    binding,
  });
  let client = null;
  let lockHeld = false;
  let changes = [];
  let identity = null;

  try {
    const configuredDatabase = normalizeDatabaseName(environment.PGDATABASE);
    output.databaseIdentity.databaseName = configuredDatabase;
    output.sourceRevision = getSourceRevision(environment);
    changes = discoverGovernedSqlChanges({ repositoryRoot, fileSystem });
    client = await (adapter || createPgDatabaseAdapter(environment)).connect();
    identity = await readDatabaseIdentity(client);
    output.databaseIdentity = identity;
    if (identity.databaseName !== configuredDatabase) {
      throw upgradeError(
        'DATABASE_UPGRADE_CONNECTED_DATABASE_MISMATCH',
        'Connected PostgreSQL database does not match configured PGDATABASE.',
      );
    }

    const inspected = await inspectAndPlan(client, identity, changes, output.sourceRevision);
    output.baseline = inspected.baseline;
    output.ledger = {
      available: inspected.ledgerState.available,
      verification: inspected.ledgerState.verification,
      appliedCount: inspected.ledgerState.appliedCount,
      driftDetected: inspected.ledgerState.driftDetected,
      receipts: inspected.ledgerState.ledgerRows.map(publicLedgerReceipt),
      before: createLedgerSnapshot(inspected.ledgerState),
      after: createLedgerSnapshot(inspected.ledgerState),
    };
    output.pendingChanges = inspected.plan.pending.map(publicChange);
    output.pendingCount = inspected.plan.pending.length;
    output.planDigest = { algorithm: 'SHA-256', digest: inspected.plan.digest };
    output.manifestDigest = { algorithm: 'SHA-256', digest: inspected.plan.manifestDigest };
    output.fileOutcomes = createFileOutcomes(changes, inspected.ledgerState.ledgerRows);

    if (normalizedMode === 'PLAN') {
      output.outcome = 'PLAN_READY';
      return finishUpgradeOutput(output, startedAt);
    }

    const registeredDevTool = executionPath === REGISTERED_DEV_TOOL_EXECUTION_PATH;
    if (
      executionPath !== 'APPROVED_REQUEST' &&
      !registeredDevTool &&
      !parseBoolean(environment.SKYCOMMAND_DB_UPGRADE_ENABLED, false)
    ) {
      throw upgradeError(
        'DATABASE_UPGRADE_DISABLED',
        'Database upgrade APPLY is disabled by SKYCOMMAND_DB_UPGRADE_ENABLED.',
      );
    }
    assertConfiguredApplyTarget({ environment, configuredDatabase, identity });
    if (!registeredDevTool && !confirmed) {
      throw upgradeError(
        'DATABASE_UPGRADE_CONFIRMATION_REQUIRED',
        'APPLY requires explicit --confirm confirmation.',
      );
    }
    if (!registeredDevTool && !/^[A-Fa-f0-9]{64}$/.test(String(expectedPlanDigest || ''))) {
      throw upgradeError(
        'DATABASE_UPGRADE_PLAN_DIGEST_REQUIRED',
        'APPLY requires the exact current SHA-256 plan digest.',
      );
    }
    if (!registeredDevTool && String(expectedPlanDigest).toUpperCase() !== inspected.plan.digest) {
      throw upgradeError(
        'DATABASE_UPGRADE_PLAN_DIGEST_MISMATCH',
        'The supplied plan digest does not match a freshly computed plan.',
      );
    }
    if (inspected.plan.pending.length === 0) {
      output.outcome = 'NO_CHANGES';
      output.execution.reconciledFromLedger = true;
      output.revalidation.outcome = 'NOT_REQUIRED_NO_CHANGES';
      return finishUpgradeOutput(output, startedAt);
    }

    output.lock.requested = true;
    await acquireUpgradeLock(client);
    lockHeld = true;
    output.lock.acquired = true;

    const lockedChanges = discoverGovernedSqlChanges({ repositoryRoot, fileSystem });
    try {
      assertManifestMatches(changes, lockedChanges);
    } catch (error) {
      output.revalidation.outcome = 'DRIFT_REJECTED';
      throw error;
    }
    const lockedIdentity = await readDatabaseIdentity(client);
    assertIdentityMatches(identity, lockedIdentity);
    const refreshed = await inspectAndPlan(
      client,
      lockedIdentity,
      lockedChanges,
      output.sourceRevision,
    );
    const expectedDigest = registeredDevTool
      ? inspected.plan.digest
      : String(expectedPlanDigest).toUpperCase();
    if (refreshed.plan.digest !== expectedDigest) {
      throw upgradeError(
        'DATABASE_UPGRADE_PLAN_CHANGED_UNDER_LOCK',
        'The current plan changed before APPLY could begin.',
      );
    }
    output.revalidation = {
      performed: true,
      outcome: 'VERIFIED',
      manifestDigest: { algorithm: 'SHA-256', digest: refreshed.plan.manifestDigest },
    };
    changes = lockedChanges;
    identity = lockedIdentity;
    output.databaseIdentity = lockedIdentity;
    output.manifestDigest = { algorithm: 'SHA-256', digest: refreshed.plan.manifestDigest };
    output.fileOutcomes = createFileOutcomes(lockedChanges, refreshed.ledgerState.ledgerRows);

    const context = {
      baselineId: refreshed.ledgerState.baseline?.baseline_id || null,
      identity,
      sourceRevision: output.sourceRevision,
      probes: refreshed.probes,
      planDigest: refreshed.plan.digest,
    };
    for (const pendingChange of refreshed.plan.pending) {
      try {
        await applyChange(client, pendingChange, context);
      } catch (error) {
        const failedOutcome = output.fileOutcomes.find(
          (outcome) => outcome.ordinal === pendingChange.ordinal,
        );
        if (failedOutcome) {
          failedOutcome.status = error.details?.rolledBack ? 'FAILED_ROLLED_BACK' : 'FAILED';
          failedOutcome.rolledBack = error.details?.rolledBack === true;
          failedOutcome.errorCode = error.code || 'DATABASE_UPGRADE_FAILED';
        }
        throw error;
      }
      const committedOutcome = output.fileOutcomes.find(
        (outcome) => outcome.ordinal === pendingChange.ordinal,
      );
      if (committedOutcome) committedOutcome.status = 'COMMITTED';
      output.appliedCount += 1;
    }
    output.outcome = 'APPLIED';
    output.ledger.available = true;
    output.ledger.verification = 'VERIFIED';
    const finalLedgerState = await readLedgerState(client, identity, changes);
    output.ledger.appliedCount = finalLedgerState.appliedCount;
    output.ledger.receipts = finalLedgerState.ledgerRows.map(publicLedgerReceipt);
    output.ledger.after = createLedgerSnapshot(finalLedgerState);
    return finishUpgradeOutput(output, startedAt);
  } catch (error) {
    if (client && normalizedMode === 'APPLY' && identity && changes.length > 0) {
      try {
        const failureLedgerState = await readLedgerState(client, identity, changes);
        output.ledger.appliedCount = failureLedgerState.appliedCount;
        output.ledger.receipts = failureLedgerState.ledgerRows.map(publicLedgerReceipt);
        output.ledger.after = createLedgerSnapshot(failureLedgerState);
        output.execution.reconciledFromLedger = true;
        const ledgeredOrdinals = new Set(
          failureLedgerState.ledgerRows.map((row) => Number(row.ordinal)),
        );
        output.fileOutcomes = output.fileOutcomes.map((fileOutcome) =>
          ledgeredOrdinals.has(fileOutcome.ordinal) &&
          ['FAILED', 'FAILED_ROLLED_BACK'].includes(fileOutcome.status)
            ? {
                ...fileOutcome,
                status: 'COMMITTED_RECONCILED',
                rolledBack: false,
              }
            : fileOutcome,
        );
      } catch (_ledgerError) {
        // Preserve the original failure; reconciliation can retry a read-only PLAN.
      }
    }
    throw attachUpgradeFailure(error, finishUpgradeOutput(output, startedAt));
  } finally {
    if (client && lockHeld) {
      try {
        output.lock.released = await releaseUpgradeLock(client);
      } catch (_error) {
        output.lock.released = false;
      }
    }
    if (client) {
      if (typeof client.release === 'function') client.release();
      else if (typeof client.end === 'function') await client.end().catch(() => {});
    }
  }
}

async function executeDatabaseUpgrade(options = {}) {
  return executeDatabaseUpgradeInternal(options, 'MANUAL');
}

/**
 * Registered DEV_LOCAL Tool entry point. Authority is supplied by the Tool
 * catalogue/permission boundary and the trusted DEV target pins; no caller
 * confirmation, plan digest, SQL, path, credential, or target override is
 * accepted here.
 */
async function executeRegisteredDatabaseUpgrade({
  environment = process.env,
  adapter = null,
  repositoryRoot = SKYCOMMAND_ROOT,
  fileSystem = fs,
  binding = null,
} = {}) {
  return executeDatabaseUpgradeInternal(
    {
      mode: 'APPLY',
      environment,
      adapter,
      repositoryRoot,
      fileSystem,
      binding,
      toolCode: 'database_upgrade_apply',
    },
    REGISTERED_DEV_TOOL_EXECUTION_PATH,
  );
}

function assertApprovedRequestExecutionEnvelope(approvedRequest) {
  const status = approvedRequest?.status;
  const requestId = approvedRequest?.requestId || approvedRequest?.request_id;
  const planDigest = String(approvedRequest?.planDigest || approvedRequest?.plan_digest || '')
    .trim()
    .toUpperCase();
  const requestDigest = String(
    approvedRequest?.requestDigest || approvedRequest?.request_digest || '',
  )
    .trim()
    .toUpperCase();
  const humanDecisionUserId =
    approvedRequest?.humanDecisionUserId || approvedRequest?.human_decision_user_id;
  const humanDecisionAt = approvedRequest?.humanDecisionAt || approvedRequest?.human_decision_at;

  if (
    status !== 'APPROVED' ||
    !requestId ||
    !humanDecisionUserId ||
    !humanDecisionAt ||
    !/^[A-F0-9]{64}$/.test(planDigest) ||
    !/^[A-F0-9]{64}$/.test(requestDigest)
  ) {
    throw upgradeError(
      'DATABASE_UPGRADE_APPROVED_REQUEST_AUTHORITY_INVALID',
      'D1 approved-request execution requires a server-validated APPROVED request envelope.',
    );
  }
  return { requestId, planDigest, requestDigest };
}

/**
 * D2B.2-only continuation. The manual/CLI entry point remains gated by
 * SKYCOMMAND_DB_UPGRADE_ENABLED; this dedicated function is reachable only
 * by the API service after it has loaded and independently revalidated the
 * persisted APPROVED request envelope.
 */
async function executeApprovedDatabaseUpgrade({
  approvedRequest,
  environment = process.env,
  adapter = null,
  repositoryRoot = SKYCOMMAND_ROOT,
  fileSystem = fs,
} = {}) {
  const authority = assertApprovedRequestExecutionEnvelope(approvedRequest);
  return executeDatabaseUpgradeInternal(
    {
      mode: 'APPLY',
      expectedPlanDigest: authority.planDigest,
      confirmed: true,
      environment,
      adapter,
      repositoryRoot,
      fileSystem,
    },
    'APPROVED_REQUEST',
  );
}

module.exports = {
  BASELINE_CONTRACT,
  BASELINE_ORDINAL,
  DatabaseUpgradeError,
  REGISTERED_DEV_TOOL_EXECUTION_PATH,
  RUNNER_VERSION,
  SQL_ROOT_LABELS,
  SQL_ROOTS,
  acquireUpgradeLock,
  applyChange,
  buildPlan,
  canonicalJson,
  compareChanges,
  createInitialUpgradeOutput,
  createPgDatabaseAdapter,
  discoverGovernedSqlChanges,
  executeRegisteredDatabaseUpgrade,
  executeDatabaseUpgrade,
  executeApprovedDatabaseUpgrade,
  finishUpgradeOutput,
  getSourceRevision,
  normalizeDatabaseName,
  normalizeSystemIdentifier,
  parseBoolean,
  parseGovernedFilename,
  publicChange,
  assertManifestMatches,
  createFileOutcomes,
  manifestDigest,
  publicLedgerReceipt,
  readBaselineProbes,
  readDatabaseIdentity,
  readLedgerState,
  releaseUpgradeLock,
  sha256,
};
