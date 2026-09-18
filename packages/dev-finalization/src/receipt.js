#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const { query } = require('../../db/src/connection');
const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createReceiptFailureToolResult,
  createReceiptToolResult,
  RECEIPT_OUTPUT_TYPE,
} = require('./finalizationResult');
const {
  assertRunId,
  assertReceiptOutsideZip,
  FinalizationError,
  artifactPaths,
  databaseSummary,
  getRun,
  getToolDomainOutput,
  getWorkflowNodeOutputs,
  hashArtifact,
  loadBinding,
  readDatabasePlan,
  updateRunStage,
  verifyZipEntries,
  releaseFinalizationLock,
  sha256,
} = require('./finalization');

const TOOL_CODE = 'dev_finalization_receipt';
const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const REQUIRED_ZIP_ENTRIES = Object.freeze([
  'docs/SkyCommand_RepoMap.md',
  'docs/generated/SkyCommand_Capability_Catalog.json',
  'docs/generated/SkyCommand_Capability_Catalog.xlsx',
]);

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizedOutput(value) {
  return getToolDomainOutput(value || {}) || {};
}

function publicSourceIdentity(value = {}) {
  return {
    algorithm: text(value.algorithm),
    digest: text(value.digest).toUpperCase() || null,
    baseRevision: value.baseRevision || null,
    manifestDigest: text(value.manifestDigest).toUpperCase() || null,
    fileCount: Number(value.fileCount || 0),
    excludedGeneratedOutputs: value.excludedGeneratedOutputs === true,
    configurationRevision: {
      algorithm: text(value.configurationRevision?.algorithm) || null,
      digest: text(value.configurationRevision?.digest).toUpperCase() || null,
    },
  };
}

function publicArtifact(artifact) {
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    exists: artifact.exists,
  };
}

function publicClassifications(value) {
  return Array.isArray(value)
    ? value.slice(0, 32).map((item) => ({
        key: text(item?.key),
        classification: text(item?.classification, 'UNKNOWN'),
        change: text(item?.change, 'UNKNOWN'),
      }))
    : [];
}

function publicConfigurationRevision(value) {
  return {
    algorithm: text(value?.algorithm) || null,
    digest: text(value?.digest).toUpperCase() || null,
  };
}

function publicEnvironmentExecution(record) {
  const domain = normalizedOutput(record?.output);
  return {
    status: text(record?.status, record ? 'UNKNOWN' : 'SKIPPED'),
    outcome: text(domain.outcome, record ? 'NOT_RECORDED' : 'SKIPPED'),
    requestedKeys: Array.isArray(domain.requestedKeys) ? domain.requestedKeys : [],
    changedKeys: Array.isArray(domain.changedKeys) ? domain.changedKeys : [],
    classifications: publicClassifications(domain.classifications),
    envExample: {
      outcome: text(domain.envExample?.outcome, 'NOT_APPLICABLE'),
      changedKeys: Array.isArray(domain.envExample?.changedKeys) ? domain.envExample.changedKeys : [],
      classifications: publicClassifications(domain.envExample?.classifications),
    },
    configurationRevision: publicConfigurationRevision(domain.configurationRevision),
    concurrency: {
      checked: domain.concurrency?.checked === true,
      outcome: text(domain.concurrency?.outcome, 'NOT_REQUESTED'),
      files: Array.isArray(domain.concurrency?.files)
        ? domain.concurrency.files.slice(0, 8).map((file) => ({
            target: text(file?.target),
            outcome: text(file?.outcome, 'UNKNOWN'),
          }))
        : [],
    },
    restart: {
      required: domain.restart?.required === true,
      services: Array.isArray(domain.restart?.services) ? domain.restart.services : [],
      reasonCode: text(domain.restart?.reasonCode) || null,
    },
    executionId: text(domain.execution?.correlationId) || null,
  };
}

function publicDatabaseExecution(record) {
  const domain = normalizedOutput(record?.output);
  const fileOutcomes = Array.isArray(domain.fileOutcomes) ? domain.fileOutcomes : [];
  const appliedOrdinals = fileOutcomes
    .filter((file) => ['COMMITTED', 'COMMITTED_RECONCILED'].includes(text(file?.status).toUpperCase()))
    .map((file) => Number(file.ordinal))
    .filter(Number.isInteger);
  return {
    status: text(record?.status, record ? 'UNKNOWN' : 'SKIPPED'),
    outcome: text(domain.outcome, record ? 'NOT_RECORDED' : 'SKIPPED'),
    pendingCount: Number(domain.pendingCount || 0),
    pendingOrdinals: Array.isArray(domain.pendingChanges)
      ? domain.pendingChanges.map((change) => Number(change.ordinal)).filter(Number.isInteger)
      : [],
    appliedCount: Number(domain.appliedCount || 0),
    appliedOrdinals: [...new Set(appliedOrdinals)].sort((left, right) => left - right),
    planDigest: domain.planDigest || null,
    manifestDigest: domain.manifestDigest || null,
    fileOutcomes: fileOutcomes.map((file) => ({
      ordinal: Number.isInteger(Number(file?.ordinal)) ? Number(file.ordinal) : null,
      kind: file?.kind || file?.changeKind || null,
      relativePath: file?.relativePath || file?.sourcePath || null,
      sha256: file?.sha256 || null,
      status: text(file?.status, 'UNKNOWN'),
      errorCode: file?.errorCode || null,
      rolledBack: file?.rolledBack === true,
    })),
    ledger: {
      available: domain.ledger?.available === true,
      verification: text(domain.ledger?.verification, 'UNKNOWN'),
      appliedCount: Number(domain.ledger?.appliedCount || 0),
      driftDetected: domain.ledger?.driftDetected === true,
      receipts: Array.isArray(domain.ledger?.receipts)
        ? domain.ledger.receipts.map((receipt) => ({
            changeId: receipt?.changeId || null,
            baselineId: receipt?.baselineId || null,
            ordinal: Number.isInteger(Number(receipt?.ordinal)) ? Number(receipt.ordinal) : null,
            kind: receipt?.kind || receipt?.changeKind || null,
            relativePath: receipt?.relativePath || receipt?.sourcePath || null,
            sha256: receipt?.sha256 || null,
            appliedAt: receipt?.appliedAt || null,
            sourceRevision: receipt?.sourceRevision || null,
            planDigest: receipt?.planDigest || null,
          }))
        : [],
    },
  };
}

async function persistReceipt({ runId, payload, output, paths }) {
  const receiptDirectory = path.dirname(paths.receipt);
  fs.mkdirSync(receiptDirectory, { recursive: true });
  const temporaryPath = `${paths.receipt}.tmp-${process.pid}-${Date.now()}`;
  const receiptBytes = Buffer.from(`${JSON.stringify({ ...payload, receiptSha256: null }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(temporaryPath, receiptBytes, { flag: 'w', mode: 0o600 });
  const receiptSha256 = sha256(receiptBytes);
  fs.rmSync(paths.receipt, { force: true });
  fs.renameSync(temporaryPath, paths.receipt);
  await query(
    `
      UPDATE worker.dev_finalization_runs
      SET status = 'COMPLETED',
          artifact_manifest = $2::jsonb,
          receipt_payload = $3::jsonb,
          receipt_path = $4,
          receipt_sha256 = $5,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          failure_code = NULL,
          failure_message = NULL
      WHERE workflow_run_record_id = $1
    `,
    [runId, JSON.stringify(output.artifacts), JSON.stringify({ ...payload, receiptSha256 }), output.receiptPath, receiptSha256],
  );
  await releaseFinalizationLock(runId);
  return receiptSha256;
}

async function executeReceipt(args = []) {
  if (!Array.isArray(args) || args.length !== 1) {
    throw new FinalizationError('R5_RECEIPT_ARGUMENTS_INVALID', 'R5 receipt requires workflow run id.');
  }
  const runId = assertRunId(args[0]);
  const startedAt = new Date().toISOString();
  const run = await getRun(runId);
  const existingReceipt = text(run.receipt_path);
  if (run.status === 'COMPLETED' && existingReceipt && run.receipt_sha256 && fs.existsSync(existingReceipt)) {
    return {
      ...(run.receipt_payload || {}),
      outcome: text(run.receipt_payload?.outcome, 'NO_CHANGES'),
      runId,
      receiptPath: existingReceipt,
      receiptSha256: text(run.receipt_sha256).toUpperCase(),
      lockReleased: true,
    };
  }

  const validation = normalizedOutput(run.validation_output);
  const readiness = normalizedOutput(run.readiness_output);
  if (!['PASS', 'KNOWN_BASELINE_LIMITATION'].includes(text(validation.outcome).toUpperCase())) {
    throw new FinalizationError('R5_VALIDATION_REQUIRED', 'R5 receipt requires a successful validation stage.');
  }
  if (text(readiness.outcome).toUpperCase() !== 'READY') {
    throw new FinalizationError('R5_READINESS_REQUIRED', 'R5 receipt requires a READY runtime stage.');
  }

  const binding = await loadBinding('SkyCommand', process.env);
  const plan = await readDatabasePlan(binding.repositoryRoot, process.env);
  if (plan.pendingCount !== 0 || !['PLAN_READY', 'NO_CHANGES'].includes(plan.outcome)) {
    throw new FinalizationError('R5_DATABASE_NOT_RECONCILED', 'R5 receipt requires zero pending database changes.');
  }
  const paths = artifactPaths(binding);
  const artifacts = {
    capabilityCatalogJson: hashArtifact(binding.repositoryRoot, paths.capabilityCatalogJson),
    capabilityCatalogXlsx: hashArtifact(binding.repositoryRoot, paths.capabilityCatalogXlsx),
    repoMap: hashArtifact(binding.repositoryRoot, paths.repoMap),
    repoZip: hashArtifact(binding.repositoryRoot, paths.repoZip),
  };
  const missing = Object.entries(artifacts).filter(([, artifact]) => !artifact.exists).map(([name]) => name);
  if (missing.length > 0) {
    throw new FinalizationError('R5_ARTIFACT_MISSING', 'R5 receipt artifacts are incomplete.', { missing });
  }
  const zipEntries = verifyZipEntries(paths.repoZip, REQUIRED_ZIP_ENTRIES);
  const missingZipEntries = zipEntries.filter((entry) => entry.status !== 'PRESENT');
  if (missingZipEntries.length > 0) {
    throw new FinalizationError('R5_ZIP_CONTENT_INVALID', 'R5 repository ZIP is missing required evidence entries.', { missingZipEntries });
  }
  assertReceiptOutsideZip(paths.repoZip);

  const sourceIdentity = publicSourceIdentity(run.source_identity || {});
  const preflight = run.preflight_output || {};
  const lifecycle = run.lifecycle_output || {};
  const nodeOutputs = await getWorkflowNodeOutputs(runId);
  const environmentExecution = publicEnvironmentExecution(nodeOutputs.environment_reconcile_node);
  const databaseExecution = publicDatabaseExecution(nodeOutputs.database_upgrade_node);
  const lifecycleRequired = preflight.lifecycle?.required === true;
  const lifecycleReceipt = {
    required: lifecycleRequired,
    outcome: lifecycleRequired
      ? text(lifecycle.outcome, 'NOT_RECORDED')
      : 'SKIPPED',
    reason: lifecycleRequired ? null : 'NO_AFFECTED_RUNTIME_SERVICES',
    action: lifecycleRequired
      ? text(lifecycle.action, preflight.lifecycle?.action || 'REBUILD_SERVICES')
      : null,
    services: lifecycleRequired
      ? Array.isArray(lifecycle.services)
        ? lifecycle.services
        : Array.isArray(preflight.lifecycle?.services)
          ? preflight.lifecycle.services
          : []
      : [],
    deferredServices: Array.isArray(preflight.lifecycle?.deferredServices)
      ? preflight.lifecycle.deferredServices
      : [],
    operationId: lifecycle.operationId || null,
    hostWorkflowId: lifecycle.hostWorkflowId || null,
    hostRunId: lifecycle.hostRunId || null,
  };
  const sourceChange = {
    changed: preflight.sourceChanged === true,
    changedPaths: Array.isArray(preflight.changedPaths) ? preflight.changedPaths : [],
    changedPathCount: Number(preflight.changedPathCount || 0),
    changedPathsDigest: text(preflight.changedPathsDigest).toUpperCase() || null,
    priorSourceIdentityDigest: text(preflight.priorSourceIdentityDigest).toUpperCase() || null,
  };
  const hasEnvironmentEffect =
    environmentExecution.outcome.toUpperCase() === 'CHANGED' || environmentExecution.changedKeys.length > 0;
  const hasDatabaseEffect =
    databaseExecution.outcome.toUpperCase() === 'APPLIED' || databaseExecution.appliedCount > 0;
  const hasLifecycleEffect = ['RECONCILED'].includes(lifecycleReceipt.outcome.toUpperCase());
  const finalNoChanges = !sourceChange.changed && !hasEnvironmentEffect && !hasDatabaseEffect && !hasLifecycleEffect;
  const completedAt = new Date().toISOString();
  const payload = {
    contract: RECEIPT_OUTPUT_TYPE,
    outcome: finalNoChanges ? 'NO_CHANGES' : 'COMPLETE',
    runId,
    workflowCode: 'dev_change_finalize',
    generatedAt: completedAt,
    sourceIdentity,
    sourceChange,
    environment: {
      preflight: {
        patchRequested: preflight.environment?.patchRequested === true,
        requestedKeys: Array.isArray(preflight.environment?.requestedKeys)
          ? preflight.environment.requestedKeys
          : [],
      },
      execution: environmentExecution,
      final: {
        ...environmentExecution,
        status: 'OBSERVED',
        outcome: environmentExecution.outcome,
        configurationRevision: publicConfigurationRevision(sourceIdentity.configurationRevision),
      },
    },
    database: {
      preflight: databaseSummary(preflight.database || {}),
      execution: databaseExecution,
      final: databaseSummary(plan),
    },
    lifecycle: lifecycleReceipt,
    validation,
    readiness,
    validationOutcome: text(validation.outcome, 'UNKNOWN'),
    readinessOutcome: text(readiness.outcome, 'UNKNOWN'),
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, publicArtifact(value)])),
    zipEntries,
    receiptPath: paths.receipt,
    receiptSha256: null,
    receiptSelfHashConvention: 'SELF_HASH_FIELD_NULL_DURING_HASH',
    lockReleasePolicy: 'RELEASE_AFTER_RECEIPT_PERSIST',
    lockStateAtPersist: 'HELD',
    lockReleased: true,
    timing: {
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    },
    warnings: [
      ...(validation.outcome === 'KNOWN_BASELINE_LIMITATION'
        ? ['The production runtime image classified the excluded focused self-test as a known baseline limitation; the host-side focused test is executed separately in the R5 validation record.']
        : []),
      ...(Array.isArray(preflight.lifecycle?.deferredServices) && preflight.lifecycle.deferredServices.length > 0
        ? [`The active workflow deferred restart of its orchestrator service: ${preflight.lifecycle.deferredServices.join(', ')}.`]
        : []),
    ],
  };
  const output = {
    ...payload,
    receiptPath: paths.receipt,
    lockReleased: true,
  };
  const receiptSha256 = await persistReceipt({
    runId,
    payload,
    output: { artifacts: payload.artifacts },
    paths,
  });
  output.receiptSha256 = receiptSha256;
  output.lockReleased = true;
  return output;
}

function renderConsole(result) {
  console.log(`[SkyCommand R5 receipt] ${result.outcome}: ${result.receiptPath || 'not written'}.`);
}

async function main() {
  dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env'), quiet: true });
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: RECEIPT_OUTPUT_TYPE,
    outputSchema: require('../../tools/contracts/dev_finalization_summary.v1.schema.json'),
    args: process.argv.slice(2),
    execute: executeReceipt,
    createToolResult: createReceiptToolResult,
    createFailureToolResult: createReceiptFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) main();

module.exports = {
  REQUIRED_ZIP_ENTRIES,
  TOOL_CODE,
  executeReceipt,
  main,
  persistReceipt,
  publicSourceIdentity,
};
