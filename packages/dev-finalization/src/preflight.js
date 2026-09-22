#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createPreflightFailureToolResult,
  createPreflightToolResult,
  PREFLIGHT_OUTPUT_TYPE,
} = require('./finalizationResult');
const {
  FinalizationError,
  assertRunId,
  acquireFinalizationRun,
  buildScope,
  buildSourceIdentity,
  classifyChangedPaths,
  databaseSummary,
  getLatestSuccessfulRun,
  getProfileCode,
  loadBinding,
  manifestChangedPaths,
  parseEnvironmentPatch,
  readDatabasePlan,
  selectLifecycleServices,
  sha256,
} = require('./finalization');

const TOOL_CODE = 'dev_finalization_preflight';
const REPOSITORY_CODE = 'SkyCommand';
const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');

function parseArguments(args = []) {
  const values = Array.isArray(args) ? args.map((value) => String(value || '')) : [];
  if (values.length !== 3 || values.some((value) => !value.trim())) {
    throw new FinalizationError(
      'R5_PREFLIGHT_ARGUMENTS_INVALID',
      'R5 preflight requires repository name, workflow run id, and environment patch JSON.',
    );
  }
  return {
    repositoryName: values[0].trim(),
    runId: values[1].trim(),
    envPatchJson: values[2],
  };
}

async function executePreflight(args = []) {
  const input = parseArguments(args);
  if (input.repositoryName !== REPOSITORY_CODE) {
    throw new FinalizationError('R5_REPOSITORY_SCOPE_INVALID', 'R5 preflight is bound to SkyCommand.');
  }

  const runId = assertRunId(input.runId);
  const environment = process.env;
  const binding = await loadBinding(input.repositoryName, environment);
  const patchInfo = parseEnvironmentPatch(input.envPatchJson);
  const databasePlan = await readDatabasePlan(binding.repositoryRoot, environment);
  if (!['PLAN_READY', 'NO_CHANGES'].includes(databasePlan.outcome)) {
    throw new FinalizationError(
      'R5_DATABASE_PLAN_INVALID',
      'R5 preflight could not obtain a valid read-only database plan.',
      { outcome: databasePlan.outcome },
    );
  }
  const sourceIdentity = await buildSourceIdentity({
    repositoryRoot: binding.repositoryRoot,
    databasePlan,
    environment,
  });
  const scope = buildScope(binding, environment);
  const latest = await getLatestSuccessfulRun(scope);
  const changedPaths = manifestChangedPaths(sourceIdentity.files, latest?.source_identity_manifest || []);
  const classified = classifyChangedPaths(changedPaths);
  const services = [...new Set([...classified.services, ...patchInfo.services])];
  const orderedServices = ['api', 'temporal-worker', 'browser-worker', 'node-worker', 'agent-runtime-worker', 'web'].filter((service) => services.includes(service));
  const sourceChanged =
    !latest || String(latest.source_identity_digest || '').toUpperCase() !== sourceIdentity.digest;
  const lifecycleRequired = orderedServices.length > 0;
  const lifecycleSelection = selectLifecycleServices(
    orderedServices,
    { deferOrchestrator: lifecycleRequired },
  );
  const lifecycle = {
    required: lifecycleRequired,
    outcome: lifecycleRequired ? 'PENDING' : 'SKIPPED',
    reason: lifecycleRequired ? null : 'NO_AFFECTED_RUNTIME_SERVICES',
    action: lifecycleRequired ? 'REBUILD_SERVICES' : null,
    services: lifecycleSelection.services,
    deferredServices: lifecycleSelection.deferredServices,
    environmentPatchRequested: patchInfo.requestedKeys.length > 0,
    environmentKeys: patchInfo.requestedKeys,
  };
  const acquired = await acquireFinalizationRun({
    runId,
    scope,
    sourceIdentity,
    database: databaseSummary(databasePlan),
    lifecycle,
    lifecycleServicesJson: JSON.stringify(lifecycle.services),
    sourceChanged,
    changedPaths,
    changedPathCount: changedPaths.length,
    changedPathsDigest: sha256(JSON.stringify(changedPaths)),
    priorSourceIdentityDigest: String(latest?.source_identity_digest || '').toUpperCase() || null,
  });
  return {
    ...acquired.output,
    binding: {
      repositoryCode: binding.repoCode,
      repositoryId: binding.repoId,
      environmentCode: getProfileCode(environment),
      configProfileCode: getProfileCode(environment),
      repositoryRoot: binding.repositoryRoot,
    },
    sourceIdentity,
    database: databaseSummary(databasePlan),
    sourceChanged,
    changedPaths,
    changedPathsDigest: sha256(JSON.stringify(classified.changedPaths)),
    changedPathCount: classified.changedPaths.length,
    priorSourceIdentityDigest: String(latest?.source_identity_digest || '').toUpperCase() || null,
    lifecycle,
    partialRun: { persisted: true, status: 'RUNNING' },
  };
}

function renderConsole(result) {
  console.log(
    `[SkyCommand R5 preflight] ${result.outcome}: ${result.lifecycle?.required ? 'lifecycle required' : 'lifecycle not required'}, ${result.database?.pendingCount || 0} pending DB change(s).`,
  );
}

async function main() {
  dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env'), quiet: true });
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: PREFLIGHT_OUTPUT_TYPE,
    outputSchema: require('../../tools/contracts/dev_finalization_preflight_summary.v1.schema.json'),
    args: process.argv.slice(2),
    execute: executePreflight,
    createToolResult: createPreflightToolResult,
    createFailureToolResult: createPreflightFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) main();

module.exports = {
  TOOL_CODE,
  executePreflight,
  main,
  parseArguments,
  renderConsole,
};
