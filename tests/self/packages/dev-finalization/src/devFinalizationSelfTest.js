#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');

const sourceDir = sourceDirectoryForTest(__filename);
const repositoryRoot = path.resolve(sourceDir, '../../..');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), quiet: true });
const finalization = require(path.join(repositoryRoot, 'packages/dev-finalization/src/finalization'));
const resultContracts = require(path.join(repositoryRoot, 'packages/dev-finalization/src/finalizationResult'));
const { validateToolResult } = require(path.join(repositoryRoot, 'packages/tools/src/toolResultContract'));
const { normalizeFinalizationServices } = require(path.join(repositoryRoot, 'packages/supervisor/src/runtimeLifecycle'));
const { isCapabilityCatalogImageBaselineError } = require(path.join(repositoryRoot, 'packages/dev-finalization/src/validation'));
const { resolveApiHealthUrl } = require(path.join(repositoryRoot, 'packages/dev-finalization/src/readiness'));
const {
  applyR5RepositoryZipParameters,
} = require(path.join(repositoryRoot, 'packages/dev-finalization/src/packaging'));
const {
  DEFAULT_HOST_AGENT_HEALTH_FRESHNESS_SECONDS,
  HOST_AGENT_HEALTH_FRESHNESS_ENV_KEY,
  buildHostAgentState,
  getHostAgentHeartbeatFreshnessSeconds,
} = require(path.join(repositoryRoot, 'apps/api/src/services/workflowExecutionPreflightService'));
const { CONFIGURATION_ALLOWLIST } = require(path.join(repositoryRoot, 'packages/config/src/devEnvReconcile'));

const schemas = {
  preflight: require(path.join(repositoryRoot, 'packages/tools/contracts/dev_finalization_preflight_summary.v1.schema.json')),
  lifecycle: require(path.join(repositoryRoot, 'packages/tools/contracts/dev_finalization_lifecycle_summary.v1.schema.json')),
  validation: require(path.join(repositoryRoot, 'packages/tools/contracts/dev_finalization_validation_summary.v1.schema.json')),
  readiness: require(path.join(repositoryRoot, 'packages/tools/contracts/dev_finalization_readiness_summary.v1.schema.json')),
  receipt: require(path.join(repositoryRoot, 'packages/tools/contracts/dev_finalization_summary.v1.schema.json')),
};

let assertions = 0;
function check(name, callback) {
  callback();
  assertions += 1;
  console.log(`PASS ${String(assertions).padStart(2, '0')} ${name}`);
}

check('accepts a valid workflow run id', () => {
  assert.equal(finalization.assertRunId('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
});
check('rejects a non-UUID run id', () => {
  assert.throws(() => finalization.assertRunId('r5-run'), { code: 'R5_RUN_ID_INVALID' });
});
check('canonical JSON sorts object keys', () => {
  assert.equal(finalization.canonicalJson({ z: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"z":1}');
});
check('canonical JSON preserves array order', () => {
  assert.equal(finalization.canonicalJson({ values: [2, 1] }), '{"values":[2,1]}');
});
check('SHA-256 output is uppercase and fixed width', () => {
  assert.match(finalization.sha256('r5'), /^[A-F0-9]{64}$/);
});
check('excludes generated docs', () => {
  assert.equal(finalization.isExcludedSourcePath('docs/generated/SkyCommand_Capability_Catalog.json'), true);
});
check('excludes secret environment files but keeps the safe example', () => {
  assert.equal(finalization.isExcludedSourcePath('.env'), true);
  assert.equal(finalization.isExcludedSourcePath('.env.local'), true);
  assert.equal(finalization.isExcludedSourcePath('.env.example'), false);
});
check('excludes archives', () => {
  assert.equal(finalization.isExcludedSourcePath('zip/SkyCommand_RepoZip.zip'), true);
});
check('keeps reviewable source files', () => {
  assert.equal(finalization.isExcludedSourcePath('packages/dev-finalization/src/receipt.js'), false);
});
check('normalizes Windows source paths', () => {
  assert.equal(finalization.normalizedRelativePath('packages\\api\\src\\server.js'), 'packages/api/src/server.js');
});
check('classifies API source changes', () => {
  assert.deepEqual(finalization.classifyChangedPaths(['apps/api/src/server.js']).services, ['api', 'temporal-worker', 'node-worker']);
});
check('classifies web source changes', () => {
  assert.deepEqual(finalization.classifyChangedPaths(['apps/admin-web/src/App.jsx']).services, ['web']);
});
check('classifies browser worker changes', () => {
  assert.deepEqual(finalization.classifyChangedPaths(['apps/browser-worker/src/index.js']).services, ['browser-worker']);
});
check('defers the active Temporal orchestrator while retaining safe services', () => {
  assert.deepEqual(
    finalization.selectLifecycleServices(['api', 'temporal-worker', 'node-worker']),
    { services: ['api', 'node-worker'], deferredServices: ['temporal-worker'] },
  );
});
check('fails closed for an orchestrator-only lifecycle request', () => {
  assert.throws(
    () => finalization.selectLifecycleServices(['temporal-worker']),
    { code: 'R5_ORCHESTRATOR_RESTART_REQUIRES_EXTERNAL_RUN' },
  );
});
check('does not require lifecycle work when no runtime service is affected', () => {
  assert.deepEqual(finalization.selectLifecycleServices([], { deferOrchestrator: false }), {
    services: [],
    deferredServices: [],
  });
});
check('classifies only the Docker capability self-test baseline limitation', () => {
  assert.equal(
    isCapabilityCatalogImageBaselineError({ stderr: 'AssertionError: 128 !== 0' }),
    true,
  );
  assert.equal(
    isCapabilityCatalogImageBaselineError({ stderr: 'AssertionError: unexpected catalog count' }),
    false,
  );
});
check('resolves readiness API health by runtime profile', () => {
  assert.equal(resolveApiHealthUrl({ SKYCOMMAND_CONFIG_PROFILE: 'DOCKER_LOCAL' }), 'http://api:7171/_health');
  assert.equal(resolveApiHealthUrl({ SKYCOMMAND_CONFIG_PROFILE: 'DEV_LOCAL' }), 'http://127.0.0.1:7171/_health');
});
check('ignores empty changed paths', () => {
  assert.deepEqual(finalization.classifyChangedPaths(['', null, '  ']).changedPaths, []);
});
check('parses empty R3 patch as no patch', () => {
  assert.deepEqual(finalization.parseEnvironmentPatch('{}'), { patch: {}, requestedKeys: [], services: [] });
});
check('parses allowlisted R3 API patch', () => {
  const parsed = finalization.parseEnvironmentPatch({ API_TELEMETRY_RETENTION_DAYS: 31 });
  assert.deepEqual(parsed.requestedKeys, ['API_TELEMETRY_RETENTION_DAYS']);
  assert.deepEqual(parsed.services, ['api']);
});
check('parses the R8 Host Agent freshness patch and scopes restart to API', () => {
  const key = 'SKYCOMMAND_HOST_AGENT_HEALTH_FRESHNESS_SECONDS';
  const parsed = finalization.parseEnvironmentPatch({ [key]: 45 });
  assert.deepEqual(parsed.requestedKeys, [key]);
  assert.deepEqual(parsed.services, ['api']);
  assert.equal(CONFIGURATION_ALLOWLIST[key].classification, 'NON_SECRET_APPLICATION');
  assert.equal(CONFIGURATION_ALLOWLIST[key].minimum, 15);
  assert.equal(CONFIGURATION_ALLOWLIST[key].maximum, 600);
  assert.deepEqual(CONFIGURATION_ALLOWLIST[key].restartServices, ['api']);
});
check('uses the typed Host Agent freshness default, bounds, and timestamp recency', () => {
  assert.equal(
    getHostAgentHeartbeatFreshnessSeconds({}),
    DEFAULT_HOST_AGENT_HEALTH_FRESHNESS_SECONDS,
  );
  assert.equal(
    getHostAgentHeartbeatFreshnessSeconds({ [HOST_AGENT_HEALTH_FRESHNESS_ENV_KEY]: '45' }),
    45,
  );
  assert.equal(
    getHostAgentHeartbeatFreshnessSeconds({ [HOST_AGENT_HEALTH_FRESHNESS_ENV_KEY]: '601' }),
    DEFAULT_HOST_AGENT_HEALTH_FRESHNESS_SECONDS,
  );
  const now = Date.parse('2026-09-19T12:00:00.000Z');
  const state = buildHostAgentState({
    enabled: true,
    namespace: 'default',
    taskQueue: 'skycommand-host-local',
    heartbeatFreshnessSeconds: 60,
    now,
    heartbeats: [
      { status: 'ONLINE', last_seen_at: '2026-09-19T11:59:30.000Z', is_recent: false },
      { status: 'ONLINE', last_seen_at: '2026-09-19T11:58:30.000Z', is_recent: true },
    ],
  });
  assert.equal(state.heartbeatFreshnessSeconds, 60);
  assert.equal(state.recentHeartbeatCount, 1);
  assert.equal(state.online, true);
});
check('R8 heartbeat migration is additive and idempotent', () => {
  const migrationDirectory = path.join(repositoryRoot, 'packages/db_build/src/migrations');
  const migrationPath = path.join(
    migrationDirectory,
    '00148__host_agent_heartbeat_freshness_index.sql',
  );
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS idx_temporal_worker_heartbeats_host_agent_lookup/i,
  );
  assert.match(
    migration,
    /ON worker\.temporal_worker_heartbeats \(namespace, task_queue, last_seen_at DESC\)/i,
  );
  assert.match(migration, /metadata ->> 'role' = 'HOST_AGENT'/i);
  assert.match(migration, /metadata ->> 'executionTarget' = 'HOST'/i);
  assert.doesNotMatch(migration, /\b(?:DROP|ALTER TABLE|DELETE FROM|UPDATE)\b/i);
  const ordinals = fs
    .readdirSync(migrationDirectory)
    .map((name) => Number(name.match(/^(\d{5})__/i)?.[1]))
    .filter(Number.isInteger);
  assert.ok(Math.max(...ordinals) >= 148);
});
check('parses the finite assistant permission scope patch', () => {
  const parsed = finalization.parseEnvironmentPatch({
    SKYCOMMAND_ASSISTANT_PERMISSION_CODES:
      'BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN,WORKFLOW_RUN,DEV_PROMOTION_PREFLIGHT,CAPABILITY_CATALOG_EXPORT,REPO_MAP_GENERATE,REPO_ZIP_GENERATE,GIT_COMMIT_RUN,GIT_DEV_PR_MERGE_RUN,GIT_MAIN_MERGE_RUN,GIT_LOCAL_SYNC_RUN,CORE_RUN_LOW_RISK_SCRIPT,CORE_RUN_MEDIUM_RISK_SCRIPT,CORE_RUN_HIGH_RISK_SCRIPT',
  });
  assert.deepEqual(parsed.requestedKeys, ['SKYCOMMAND_ASSISTANT_PERMISSION_CODES']);
  assert.deepEqual(parsed.services, ['api']);
});
check('rejects an unregistered assistant permission code', () => {
  assert.throws(
    () => finalization.parseEnvironmentPatch({ SKYCOMMAND_ASSISTANT_PERMISSION_CODES: 'GIT_DEV_PR_MERGE_RUN,UNREGISTERED_PERMISSION' }),
    { code: 'PATCH_VALUE_INVALID' },
  );
});
check('rejects an unallowlisted configuration key', () => {
  assert.throws(() => finalization.parseEnvironmentPatch({ UNKNOWN_R5_KEY: 1 }), { code: 'RECONCILIATION_KEY_NOT_ALLOWLISTED' });
});
check('rejects an empty object supplied as a non-empty patch', () => {
  assert.throws(() => finalization.parseEnvironmentPatch('[]'), { code: 'R5_ENV_PATCH_INVALID' });
});
check('computes manifest additions', () => {
  assert.deepEqual(finalization.manifestChangedPaths([{ path: 'a', sha256: '1' }], []), ['a']);
});
check('computes manifest removals', () => {
  assert.deepEqual(finalization.manifestChangedPaths([], [{ path: 'a', sha256: '1' }]), ['a']);
});
check('does not report unchanged manifest entries', () => {
  assert.deepEqual(finalization.manifestChangedPaths([{ path: 'a', sha256: '1' }], [{ path: 'a', sha256: '1' }]), []);
});
check('orders finalization services canonically', () => {
  assert.deepEqual(normalizeFinalizationServices(['web', 'api', 'api']), ['api', 'web']);
});
check('rejects a non-allowlisted finalization service', () => {
  assert.throws(() => normalizeFinalizationServices(['postgres']), { code: 'SKYCOMMAND_SUPERVISOR_FINALIZATION_SERVICE_NOT_ALLOWED' });
});
check('normalizes lifecycle JSON service input', () => {
  const { normalizeServices } = require(path.join(repositoryRoot, 'packages/dev-finalization/src/lifecycle'));
  assert.deepEqual(normalizeServices('["web","api"]'), ['api', 'web']);
});
check('rejects malformed lifecycle JSON', () => {
  const { normalizeServices } = require(path.join(repositoryRoot, 'packages/dev-finalization/src/lifecycle'));
  assert.throws(() => normalizeServices('{bad'), { code: 'R5_LIFECYCLE_SERVICES_INVALID' });
});
check('builds a deterministic host operation id', () => {
  const { buildWorkflowId } = require(path.join(repositoryRoot, 'packages/dev-finalization/src/lifecycle'));
  assert.equal(buildWorkflowId('11111111-1111-4111-8111-111111111111'), 'skycommand-dev-finalization-11111111-1111-4111-8111-111111111111');
});
check('preflight contract validates', () => {
  const toolResult = resultContracts.createPreflightToolResult({ outcome: 'READY', runId: '11111111-1111-4111-8111-111111111111' });
  validateToolResult(toolResult, { expectedOutputType: resultContracts.PREFLIGHT_OUTPUT_TYPE, outputSchema: schemas.preflight });
});
check('lifecycle contract validates', () => {
  const toolResult = resultContracts.createLifecycleToolResult({ outcome: 'NO_CHANGES', services: ['api'] });
  validateToolResult(toolResult, { expectedOutputType: resultContracts.LIFECYCLE_OUTPUT_TYPE, outputSchema: schemas.lifecycle });
});
check('validation contract validates', () => {
  const toolResult = resultContracts.createValidationToolResult({ outcome: 'KNOWN_BASELINE_LIMITATION', checks: [] });
  validateToolResult(toolResult, { expectedOutputType: resultContracts.VALIDATION_OUTPUT_TYPE, outputSchema: schemas.validation });
});
check('readiness contract validates', () => {
  const toolResult = resultContracts.createReadinessToolResult({ outcome: 'READY', runId: '11111111-1111-4111-8111-111111111111' });
  validateToolResult(toolResult, { expectedOutputType: resultContracts.READINESS_OUTPUT_TYPE, outputSchema: schemas.readiness });
});
check('receipt contract validates', () => {
  const toolResult = resultContracts.createReceiptToolResult({ outcome: 'NO_CHANGES', runId: '11111111-1111-4111-8111-111111111111' });
  validateToolResult(toolResult, { expectedOutputType: resultContracts.RECEIPT_OUTPUT_TYPE, outputSchema: schemas.receipt });
});
check('receipt schema rejects an incomplete unnormalized payload', () => {
  assert.throws(() =>
    validateToolResult(
      {
        schemaVersion: 'tool_result.v1',
        success: true,
        message: 'invalid',
        outputType: resultContracts.RECEIPT_OUTPUT_TYPE,
        output: { contract: resultContracts.RECEIPT_OUTPUT_TYPE, outcome: 'NO_CHANGES' },
      },
      { expectedOutputType: resultContracts.RECEIPT_OUTPUT_TYPE, outputSchema: schemas.receipt },
    ),
  );
});
check('extracts both raw and enveloped stage outputs', () => {
  assert.deepEqual(finalization.getToolDomainOutput({ outcome: 'PASS' }), { outcome: 'PASS' });
  assert.deepEqual(
    finalization.getToolDomainOutput({ output: { output: { outcome: 'READY' } } }),
    { outcome: 'READY' },
  );
});
check('database summary preserves plan digest', () => {
  const summary = finalization.databaseSummary({ outcome: 'PLAN_READY', pendingCount: 0, planDigest: { digest: 'A'.repeat(64) }, manifestDigest: { digest: 'B'.repeat(64) }, pendingChanges: [] });
  assert.equal(summary.planDigest, 'A'.repeat(64));
});
check('database summary reports pending ordinals', () => {
  const summary = finalization.databaseSummary({ outcome: 'PLAN_READY', pendingCount: 2, pendingChanges: [{ ordinal: 140 }, { ordinal: 141 }] });
  assert.deepEqual(summary.pendingOrdinals, [140, 141]);
});
check('zip evidence requirement has fixed paths', () => {
  const { REQUIRED_ZIP_ENTRIES } = require(path.join(repositoryRoot, 'packages/dev-finalization/src/receipt'));
  assert.equal(REQUIRED_ZIP_ENTRIES.includes('docs/SkyCommand_RepoMap.md'), true);
  assert.equal(REQUIRED_ZIP_ENTRIES.includes('docs/generated/SkyCommand_Capability_Catalog.xlsx'), true);
});
check('R5 final ZIP includes tests without changing ordinary ZIP defaults', () => {
  assert.deepEqual(
    applyR5RepositoryZipParameters({
      workflowCode: 'dev_change_finalize',
      nodeKey: 'repo_zip_node',
      targetCode: 'repo_zip_generate',
      parameters: { repoName: 'SkyCommand', includeTests: false },
    }),
    { repoName: 'SkyCommand', includeTests: true },
  );
  assert.deepEqual(
    applyR5RepositoryZipParameters({
      workflowCode: 'repo-map-zip',
      nodeKey: 'repo_zip_node',
      targetCode: 'repo_zip_generate',
      parameters: { repoName: 'SkyCommand' },
    }),
    { repoName: 'SkyCommand' },
  );
});

assert.ok(assertions >= 30);
console.log(`✅ SkyCommand R5 DEV finalization self-test passed (${assertions} assertions).`);
