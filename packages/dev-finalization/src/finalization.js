const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');

const { query, pool } = require('../../db/src/connection');
const {
  executeDatabaseUpgrade,
} = require('../../db_upgrade/src/databaseUpgradeEngine');
const {
  computeConfigurationRevision,
  CONFIGURATION_ALLOWLIST,
  normalizePatch,
} = require('../../config/src/devEnvReconcile');
const {
  loadRepositoryArtifactConfiguration,
} = require('../../files/src/repositoryArtifactConfiguration');

const REPOSITORY_CODE = 'SkyCommand';
const WORKFLOW_CODE = 'dev_change_finalize';
const LOCK_LEASE_MS = 2 * 60 * 60 * 1000;
const RECEIPT_RELATIVE_PATH = 'docs/generated/SkyCommand_DevFinalizationSummary.json';
const CATALOG_JSON_RELATIVE_PATH = 'docs/generated/SkyCommand_Capability_Catalog.json';
const CATALOG_XLSX_RELATIVE_PATH = 'docs/generated/SkyCommand_Capability_Catalog.xlsx';
const FINALIZATION_SERVICE_ORDER = Object.freeze([
  'api',
  'temporal-worker',
  'browser-worker',
  'node-worker',
  'web',
]);
const FINALIZATION_ORCHESTRATOR_SERVICE = 'temporal-worker';
const SOURCE_EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.cache',
  '.next',
  '.venv',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'out',
  'temp',
  'tmp',
  'zip',
]);
const SOURCE_EXCLUDED_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  'SkyCommand_RepoMap.md',
  'SkyCommand_RepoZip.zip',
  'SkyCommand_DevFinalizationSummary.json',
]);

class FinalizationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FinalizationError';
    this.code = code;
    this.details = details;
  }
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function getProfileCode(environment = process.env) {
  return text(
    environment.SKYCOMMAND_CONFIG_PROFILE ||
      environment.SKYSERVER_CONFIG_PROFILE ||
      environment.SKYCOMMAND_CORE_PROFILE ||
      environment.SKYSERVER_CORE_PROFILE ||
      environment.CONFIG_PROFILE ||
      'DEV_LOCAL',
  ).toUpperCase();
}

function assertRunId(value) {
  const runId = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new FinalizationError('R5_RUN_ID_INVALID', 'R5 finalization requires a valid workflow run id.');
  }
  return runId;
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

function normalizedRelativePath(relativePath) {
  return String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function isExcludedSourcePath(relativePath, extraExcluded = new Set()) {
  const normalized = normalizedRelativePath(relativePath);
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments.at(-1) || '';
  if (segments.some((segment) => SOURCE_EXCLUDED_DIRECTORY_NAMES.has(segment))) return true;
  if (SOURCE_EXCLUDED_FILE_NAMES.has(fileName)) return true;
  if (extraExcluded.has(normalized)) return true;
  if (fileName !== '.env.example' && /^\.env(?:\.|$)/i.test(fileName)) return true;
  if (/\.(?:zip|log|patch)$/i.test(fileName)) return true;
  if (normalized.startsWith('docs/generated/')) return true;
  return false;
}

function runGit(repositoryRoot, args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
}

function listFallbackFiles(directory, baseDirectory = directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(baseDirectory, absolutePath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!isExcludedSourcePath(relativePath)) listFallbackFiles(absolutePath, baseDirectory, output);
      continue;
    }
    if (entry.isFile() && !isExcludedSourcePath(relativePath)) output.push(relativePath);
  }
  return output;
}

function listReviewableSourceFiles(repositoryRoot, extraExcluded = new Set()) {
  let paths = [];
  let revision = null;
  let sourceMode = 'DIRECTORY_SNAPSHOT';
  try {
    revision = text(runGit(repositoryRoot, ['rev-parse', 'HEAD'])) || null;
    const tracked = runGit(repositoryRoot, ['ls-files', '-z'])
      .split('\0')
      .filter(Boolean);
    const untracked = runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean);
    paths = [...new Set([...tracked, ...untracked])];
    sourceMode = 'GIT_WORKTREE';
  } catch (_error) {
    paths = listFallbackFiles(repositoryRoot);
  }

  const entries = [];
  for (const relativePath of paths) {
    const normalized = relativePath.split(path.sep).join('/');
    if (isExcludedSourcePath(normalized, extraExcluded)) continue;
    const absolutePath = path.resolve(repositoryRoot, normalized);
    const relativeFromRoot = path.relative(repositoryRoot, absolutePath);
    if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) continue;
    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch (_error) {
      continue;
    }
    if (!stat.isFile()) continue;
    const bytes = fs.readFileSync(absolutePath);
    entries.push({
      path: normalized.replace(/\\/g, '/'),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { entries, revision, sourceMode };
}

function classifyChangedPaths(changedPaths = []) {
  const services = new Set();
  const reviewable = [];
  for (const rawPath of changedPaths) {
    const normalized = normalizedRelativePath(rawPath);
    if (!normalized) continue;
    reviewable.push(normalized);
    if (normalized.startsWith('apps/admin-web/') || normalized.startsWith('packages/admin-web/')) {
      services.add('web');
      continue;
    }
    if (normalized.startsWith('apps/browser-worker/') || normalized.startsWith('packages/browser/')) {
      services.add('browser-worker');
    }
    if (
      normalized.startsWith('packages/temporal/') ||
      normalized.startsWith('apps/api/') ||
      normalized.startsWith('packages/api/') ||
      normalized.startsWith('packages/config/') ||
      normalized.startsWith('packages/core/') ||
      normalized.startsWith('packages/db_upgrade/') ||
      normalized.startsWith('packages/db_build/') ||
      normalized.startsWith('packages/dev-finalization/') ||
      normalized.startsWith('packages/files/') ||
      normalized.startsWith('packages/host-agent/') ||
      normalized.startsWith('packages/supervisor/') ||
      normalized.startsWith('packages/tools/') ||
      normalized.startsWith('apps/worker/') ||
      normalized === 'compose.yaml' ||
      normalized.startsWith('docker/') ||
      normalized === 'package.json' ||
      normalized === 'package-lock.json'
    ) {
      services.add('api');
      services.add('temporal-worker');
      services.add('node-worker');
    }
  }
  return {
    changedPaths: [...new Set(reviewable)].sort(),
    services: FINALIZATION_SERVICE_ORDER.filter((service) => services.has(service)),
  };
}

function selectLifecycleServices(services = [], { deferOrchestrator = true } = {}) {
  const requested = new Set(
    (Array.isArray(services) ? services : [])
      .map((service) => String(service || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const deferredServices = deferOrchestrator && requested.has(FINALIZATION_ORCHESTRATOR_SERVICE)
    ? [FINALIZATION_ORCHESTRATOR_SERVICE]
    : [];
  const selectedServices = FINALIZATION_SERVICE_ORDER.filter(
    (service) => requested.has(service) && !deferredServices.includes(service),
  );
  if (selectedServices.length === 0 && deferredServices.length > 0) {
    throw new FinalizationError(
      'R5_ORCHESTRATOR_RESTART_REQUIRES_EXTERNAL_RUN',
      'R5 cannot restart its own Temporal orchestrator from inside the active workflow; an external lifecycle run is required.',
      { deferredServices },
    );
  }
  return { services: selectedServices, deferredServices };
}

function parseEnvironmentPatch(value) {
  if (value === undefined || value === null || text(value) === '' || text(value) === '{}') {
    return { patch: {}, requestedKeys: [], services: [] };
  }
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_error) {
    throw new FinalizationError('R5_ENV_PATCH_INVALID', 'R5 environment patch is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FinalizationError('R5_ENV_PATCH_INVALID', 'R5 environment patch must be a JSON object.');
  }
  try {
    const patch = normalizePatch(parsed);
    const services = new Set();
    for (const key of Object.keys(patch)) {
      for (const service of CONFIGURATION_ALLOWLIST[key]?.restartServices || []) services.add(service);
    }
    return {
      patch,
      requestedKeys: Object.keys(patch).sort(),
      services: FINALIZATION_SERVICE_ORDER.filter((service) => services.has(service)),
    };
  } catch (error) {
    throw new FinalizationError(
      error.code || 'R5_ENV_PATCH_INVALID',
      'R5 environment patch failed the typed allowlist preflight.',
      { causeCode: error.code || null },
    );
  }
}

async function loadBinding(repositoryName = REPOSITORY_CODE, environment = process.env) {
  const binding = await loadRepositoryArtifactConfiguration(repositoryName, {
    profileCode: getProfileCode(environment),
  });
  if (binding.repoCode !== REPOSITORY_CODE) {
    throw new FinalizationError('R5_REPOSITORY_SCOPE_INVALID', 'R5 finalization is bound to SkyCommand.');
  }
  const repositoryRoot = path.resolve(binding.rootPath);
  if (!fs.existsSync(repositoryRoot) || !fs.statSync(repositoryRoot).isDirectory()) {
    throw new FinalizationError('R5_REPOSITORY_ROOT_UNAVAILABLE', 'The registered R5 repository root is unavailable.');
  }
  return { ...binding, repositoryRoot };
}

async function readDatabasePlan(repositoryRoot, environment = process.env) {
  return executeDatabaseUpgrade({
    mode: 'PLAN',
    environment,
    repositoryRoot,
  });
}

async function buildSourceIdentity({ repositoryRoot, databasePlan, environment = process.env, identityProfileCode = null }) {
  const artifactBinding = await loadBinding(REPOSITORY_CODE, environment);
  const extraExcluded = new Set([
    artifactBinding.repoMapOutputPath && artifactBinding.repoMapFileName
      ? normalizedRelativePath(
          path.relative(
            repositoryRoot,
            path.join(artifactBinding.repoMapOutputPath, artifactBinding.repoMapFileName),
          ),
        )
      : null,
    artifactBinding.repoZipOutputPath && artifactBinding.repoZipFileName
      ? normalizedRelativePath(
          path.relative(
            repositoryRoot,
            path.join(artifactBinding.repoZipOutputPath, artifactBinding.repoZipFileName),
          ),
        )
      : null,
    RECEIPT_RELATIVE_PATH,
    CATALOG_JSON_RELATIVE_PATH,
    CATALOG_XLSX_RELATIVE_PATH,
  ].filter(Boolean));
  const files = listReviewableSourceFiles(repositoryRoot, extraExcluded);
  const configurationRevision = computeConfigurationRevision(
    fs.readFileSync(path.join(repositoryRoot, '.env'), 'utf8'),
  );
  const fileManifestDigest = sha256(canonicalJson(files.entries));
  const sqlManifestDigest = text(databasePlan.manifestDigest?.digest).toUpperCase() || null;
  const sourceProfileCode = text(identityProfileCode || getProfileCode(environment)).toUpperCase();
  const sourceDigest = sha256(
    canonicalJson({
      repositoryCode: REPOSITORY_CODE,
      profileCode: sourceProfileCode,
      baseRevision: files.revision,
      fileManifestDigest,
      sqlManifestDigest,
      configurationRevision: configurationRevision.digest,
    }),
  );
  return {
    algorithm: 'SHA-256_R5_SOURCE_IDENTITY',
    digest: sourceDigest,
    baseRevision: files.revision,
    sourceMode: files.sourceMode,
    manifestDigest: fileManifestDigest,
    fileCount: files.entries.length,
    excludedGeneratedOutputs: true,
    files: files.entries,
    configurationRevision,
    sqlManifestDigest,
  };
}

function databaseSummary(plan) {
  return {
    outcome: plan.outcome || 'UNKNOWN',
    pendingCount: Number(plan.pendingCount || 0),
    pendingOrdinals: (plan.pendingChanges || []).map((change) => Number(change.ordinal)),
    planDigest: text(plan.planDigest?.digest).toUpperCase() || null,
    manifestDigest: text(plan.manifestDigest?.digest).toUpperCase() || null,
    databaseName: plan.databaseIdentity?.databaseName || null,
    systemIdentifier: plan.databaseIdentity?.systemIdentifier || null,
  };
}

async function getLatestSuccessfulRun(scope) {
  const result = await query(
    `
      SELECT source_identity_digest, source_identity_manifest
      FROM worker.dev_finalization_runs
      WHERE repository_code = $1
        AND environment_code = $2
        AND config_profile_code = $3
        AND status = 'COMPLETED'
      ORDER BY completed_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [scope.repositoryCode, scope.environmentCode, scope.configProfileCode],
  );
  return result.rows[0] || null;
}

function manifestChangedPaths(currentManifest = [], previousManifest = []) {
  const previous = new Map((Array.isArray(previousManifest) ? previousManifest : []).map((file) => [file.path, file.sha256]));
  const current = new Map((Array.isArray(currentManifest) ? currentManifest : []).map((file) => [file.path, file.sha256]));
  const paths = new Set([...previous.keys(), ...current.keys()]);
  return [...paths].filter((filePath) => previous.get(filePath) !== current.get(filePath)).sort();
}

function buildScope(binding, environment = process.env) {
  const profileCode = getProfileCode(environment);
  return {
    repositoryCode: REPOSITORY_CODE,
    environmentCode: profileCode,
    configProfileCode: profileCode,
  };
}

async function acquireFinalizationRun({
  runId,
  scope,
  sourceIdentity,
  database,
  lifecycle,
  lifecycleServicesJson,
  sourceChanged = true,
  changedPaths = [],
  changedPathsDigest = null,
  priorSourceIdentityDigest = null,
}) {
  const client = await pool.connect();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LOCK_LEASE_MS);
  const lockScopeKey = `${scope.repositoryCode}:${scope.environmentCode}:${scope.configProfileCode}`;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockScopeKey]);
    const activeLock = await client.query(
      `
        SELECT lock_id, owner_workflow_run_record_id, status, expires_at
        FROM worker.dev_finalization_locks
        WHERE repository_code = $1
          AND environment_code = $2
          AND config_profile_code = $3
          AND status = 'HELD'
        ORDER BY acquired_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [scope.repositoryCode, scope.environmentCode, scope.configProfileCode],
    );
    const existingLock = activeLock.rows[0] || null;
    if (
      existingLock &&
      existingLock.owner_workflow_run_record_id !== runId &&
      new Date(existingLock.expires_at).getTime() > now.getTime()
    ) {
      throw new FinalizationError(
        'R5_FINALIZATION_BUSY',
        'Another R5 DEV finalization run currently holds the repository lease.',
        { ownerRunId: existingLock.owner_workflow_run_record_id },
      );
    }
    if (existingLock && new Date(existingLock.expires_at).getTime() <= now.getTime()) {
      await client.query(
        `UPDATE worker.dev_finalization_locks SET status = 'EXPIRED', released_at = CURRENT_TIMESTAMP WHERE lock_id = $1`,
        [existingLock.lock_id],
      );
    }

    const lockId = existingLock?.owner_workflow_run_record_id === runId
      ? existingLock.lock_id
      : crypto.randomUUID();
    await client.query(
      `
        INSERT INTO worker.dev_finalization_locks (
          lock_id, repository_code, environment_code, config_profile_code,
          owner_workflow_run_record_id, status, acquired_at, expires_at, metadata
        )
        VALUES ($1, $2, $3, $4, $5, 'HELD', CURRENT_TIMESTAMP, $6, $7::jsonb)
        ON CONFLICT (lock_id) DO UPDATE SET
          status = 'HELD', expires_at = EXCLUDED.expires_at,
          released_at = NULL, metadata = EXCLUDED.metadata
      `,
      [lockId, scope.repositoryCode, scope.environmentCode, scope.configProfileCode, runId, leaseExpiresAt, JSON.stringify({ scope })],
    );
    const preflightOutput = {
      outcome: 'READY',
      runId,
      binding: { ...scope },
      sourceIdentity,
      database,
      environment: {
        patchRequested: lifecycle.environmentPatchRequested,
        requestedKeys: lifecycle.environmentKeys,
      },
      sourceChanged: sourceChanged === true,
      changedPaths: Array.isArray(changedPaths) ? changedPaths : [],
      changedPathCount: Array.isArray(changedPaths) ? changedPaths.length : 0,
      changedPathsDigest: text(changedPathsDigest).toUpperCase() || null,
      priorSourceIdentityDigest: text(priorSourceIdentityDigest).toUpperCase() || null,
      lock: { scope, acquired: true, status: 'HELD', leaseExpiresAt: leaseExpiresAt.toISOString() },
      lifecycle: {
        required: lifecycle.required,
        outcome: lifecycle.outcome || (lifecycle.required ? 'PENDING' : 'SKIPPED'),
        reason: lifecycle.reason || null,
        action: lifecycle.action,
        services: lifecycle.services,
        deferredServices: lifecycle.deferredServices || [],
      },
      lifecycleServicesJson: lifecycleServicesJson || JSON.stringify(lifecycle.services),
      partialRun: { persisted: true, status: 'RUNNING' },
    };
    await client.query(
      `
        INSERT INTO worker.dev_finalization_runs (
          workflow_run_record_id, workflow_code, repository_code, environment_code,
          config_profile_code, status, lock_id, source_identity_digest,
          source_identity_manifest, source_identity, preflight_output
        )
        VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
        ON CONFLICT (workflow_run_record_id) DO UPDATE SET
          status = CASE WHEN worker.dev_finalization_runs.status = 'COMPLETED' THEN 'COMPLETED' ELSE 'RUNNING' END,
          lock_id = EXCLUDED.lock_id, source_identity_digest = EXCLUDED.source_identity_digest,
          source_identity_manifest = EXCLUDED.source_identity_manifest,
          source_identity = EXCLUDED.source_identity, preflight_output = EXCLUDED.preflight_output,
          failure_code = NULL, failure_message = NULL, updated_at = CURRENT_TIMESTAMP
      `,
      [
        runId,
        WORKFLOW_CODE,
        scope.repositoryCode,
        scope.environmentCode,
        scope.configProfileCode,
        lockId,
        sourceIdentity.digest,
        JSON.stringify(sourceIdentity.files),
        JSON.stringify(sourceIdentity),
        JSON.stringify(preflightOutput),
      ],
    );
    await client.query('COMMIT');
    return { lockId, leaseExpiresAt, output: preflightOutput };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateRunStage(runId, stage, output) {
  const columns = {
    lifecycle: 'lifecycle_output',
    validation: 'validation_output',
    readiness: 'readiness_output',
  };
  const column = columns[stage];
  if (!column) throw new FinalizationError('R5_STAGE_INVALID', 'R5 finalization stage is not recognized.');
  await query(
    `UPDATE worker.dev_finalization_runs SET ${column} = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE workflow_run_record_id = $1`,
    [runId, JSON.stringify(output)],
  );
}

async function getRun(runId) {
  const result = await query(
    `SELECT * FROM worker.dev_finalization_runs WHERE workflow_run_record_id = $1 LIMIT 1`,
    [runId],
  );
  if (result.rowCount !== 1) {
    throw new FinalizationError('R5_RUN_NOT_FOUND', 'The R5 finalization run ledger record was not found.');
  }
  return result.rows[0];
}

async function releaseFinalizationLock(runId, status = 'RELEASED') {
  await query(
    `
      UPDATE worker.dev_finalization_locks
      SET status = $2, released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE owner_workflow_run_record_id = $1 AND status = 'HELD'
    `,
    [runId, status],
  );
}

async function markFinalizationFailure(runId, error) {
  const code = text(error?.code, 'R5_FINALIZATION_FAILED');
  const message = text(error?.message, 'R5 DEV finalization failed.').slice(0, 400);
  await query(
    `
      UPDATE worker.dev_finalization_runs
      SET status = CASE WHEN status = 'COMPLETED' THEN status ELSE 'FAILED' END,
          failure_code = $2, failure_message = $3, updated_at = CURRENT_TIMESTAMP
      WHERE workflow_run_record_id = $1
    `,
    [runId, code, message],
  );
  await releaseFinalizationLock(runId);
}

function relativeArtifactPath(repositoryRoot, filePath) {
  const relative = path.relative(repositoryRoot, filePath).split(path.sep).join('/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

function hashArtifact(repositoryRoot, filePath) {
  const result = {
    path: relativeArtifactPath(repositoryRoot, filePath),
    sha256: null,
    bytes: 0,
    exists: false,
  };
  if (!result.path || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return result;
  const bytes = fs.readFileSync(filePath);
  result.exists = true;
  result.bytes = bytes.length;
  result.sha256 = sha256(bytes);
  return result;
}

function readZipEntries(zipPath) {
  const bytes = fs.readFileSync(zipPath);
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (bytes.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) throw new FinalizationError('R5_ZIP_INVALID', 'The repository zip has no valid central directory.');
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new FinalizationError('R5_ZIP_INVALID', 'The repository zip central directory is malformed.');
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const fileNameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    cursor += 46 + fileNameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new FinalizationError('R5_ZIP_INVALID', 'The repository zip local entry is malformed.');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(start, start + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else continue;
    entries.push({ path: name.replace(/\\/g, '/'), sha256: sha256(content), bytes: content.length });
  }
  return entries;
}

function verifyZipEntries(zipPath, expectedPaths = []) {
  const entries = readZipEntries(zipPath);
  return expectedPaths.map((expectedPath) => {
    const lower = expectedPath.toLowerCase();
    const match = entries.find((entry) => entry.path.toLowerCase() === lower || entry.path.toLowerCase().endsWith(`/${lower}`));
    return {
      path: expectedPath,
      sha256: match?.sha256 || null,
      status: match ? 'PRESENT' : 'MISSING',
    };
  });
}

function assertReceiptOutsideZip(zipPath) {
  const receiptEntry = verifyZipEntries(zipPath, [RECEIPT_RELATIVE_PATH])[0];
  if (receiptEntry.status === 'PRESENT') {
    throw new FinalizationError(
      'R5_ZIP_RECEIPT_MEMBER_FORBIDDEN',
      'The R5 finalization receipt attests the repository ZIP and must not be a ZIP member.',
      { receiptPath: RECEIPT_RELATIVE_PATH },
    );
  }

  return receiptEntry;
}

async function getWorkflowNodeOutputs(runId) {
  const result = await query(
    `SELECT node_key, status, output, error_message FROM worker.workflow_node_run_records WHERE workflow_run_record_id = $1 ORDER BY created_at, node_key`,
    [runId],
  );
  return Object.fromEntries(
    result.rows.map((row) => [row.node_key, { status: row.status, output: row.output || {}, error: row.error_message || null }]),
  );
}

function getToolDomainOutput(node) {
  const outer = node?.output || node || {};
  return outer?.output && typeof outer.output === 'object' ? outer.output : outer;
}

function artifactPaths(binding) {
  return {
    capabilityCatalogJson: path.resolve(binding.repositoryRoot, CATALOG_JSON_RELATIVE_PATH),
    capabilityCatalogXlsx: path.resolve(binding.repositoryRoot, CATALOG_XLSX_RELATIVE_PATH),
    repoMap: path.resolve(binding.repoMapOutputPath, binding.repoMapFileName),
    repoZip: path.resolve(binding.repoZipOutputPath, binding.repoZipFileName),
    receipt: path.resolve(binding.repositoryRoot, RECEIPT_RELATIVE_PATH),
  };
}

module.exports = {
  CATALOG_JSON_RELATIVE_PATH,
  CATALOG_XLSX_RELATIVE_PATH,
  FINALIZATION_SERVICE_ORDER,
  FINALIZATION_ORCHESTRATOR_SERVICE,
  FinalizationError,
  LOCK_LEASE_MS,
  RECEIPT_RELATIVE_PATH,
  WORKFLOW_CODE,
  acquireFinalizationRun,
  artifactPaths,
  buildScope,
  buildSourceIdentity,
  canonicalJson,
  classifyChangedPaths,
  databaseSummary,
  getLatestSuccessfulRun,
  getProfileCode,
  getRun,
  getWorkflowNodeOutputs,
  getToolDomainOutput,
  assertRunId,
  hashArtifact,
  isExcludedSourcePath,
  loadBinding,
  manifestChangedPaths,
  normalizedRelativePath,
  markFinalizationFailure,
  parseEnvironmentPatch,
  selectLifecycleServices,
  readDatabasePlan,
  readZipEntries,
  assertReceiptOutsideZip,
  releaseFinalizationLock,
  sha256,
  updateRunStage,
  verifyZipEntries,
};
