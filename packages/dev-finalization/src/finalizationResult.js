const { TOOL_RESULT_SCHEMA_VERSION, validateToolResult } = require('../../tools/src/toolResultContract');

const PREFLIGHT_OUTPUT_TYPE = 'dev_finalization_preflight_summary.v1';
const LIFECYCLE_OUTPUT_TYPE = 'dev_finalization_lifecycle_summary.v1';
const VALIDATION_OUTPUT_TYPE = 'dev_finalization_validation_summary.v1';
const READINESS_OUTPUT_TYPE = 'dev_finalization_readiness_summary.v1';
const RECEIPT_OUTPUT_TYPE = 'dev_finalization_summary.v1';

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function bool(value) {
  return value === true;
}

function list(value, maximum = 32) {
  return Array.isArray(value)
    ? value
        .slice(0, maximum)
        .map((item) => text(item))
        .filter(Boolean)
    : [];
}

function timing(value = {}) {
  const startedAt = text(value.startedAt, new Date().toISOString());
  const completedAt = text(value.completedAt, startedAt);
  return {
    startedAt,
    completedAt,
    durationMs: numberValue(value.durationMs),
  };
}

function normalizeError(error) {
  if (!error) return null;
  const code = text(error.code || error.details?.code, 'DEV_FINALIZATION_FAILED');
  const message = text(error.message, 'R5 DEV finalization failed.')
    .replace(/(?:password|passwd|secret|token|credential|api[_-]?key)\s*[:=]\s*[^\s,;}]+/gi, '[REDACTED]')
    .replace(/[A-Za-z]:[\\/][^\s]+/g, '[path-redacted]')
    .replace(/(?:\\|\/)(?:Users|home|workspace|var|tmp)(?:\\|\/)[^\s]+/gi, '[path-redacted]')
    .slice(0, 400);
  return { code, message };
}

function digest(value) {
  const normalized = text(value).toUpperCase();
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeSourceIdentity(value = {}) {
  return {
    algorithm: text(value.algorithm, 'SHA-256_R5_SOURCE_IDENTITY'),
    digest: digest(value.digest),
    baseRevision: nullableText(value.baseRevision),
    manifestDigest: digest(value.manifestDigest),
    fileCount: numberValue(value.fileCount),
    excludedGeneratedOutputs: bool(value.excludedGeneratedOutputs),
    configurationRevision: normalizeConfigurationRevision(value.configurationRevision),
  };
}

function normalizeBinding(value = {}) {
  return {
    repositoryCode: text(value.repositoryCode, 'SkyCommand'),
    repositoryId: nullableText(value.repositoryId),
    environmentCode: text(value.environmentCode),
    configProfileCode: text(value.configProfileCode || value.environmentCode),
    repositoryRoot: nullableText(value.repositoryRoot),
  };
}

function normalizeDatabase(value = {}) {
  return {
    outcome: text(value.outcome, 'UNKNOWN'),
    pendingCount: numberValue(value.pendingCount),
    pendingOrdinals: Array.isArray(value.pendingOrdinals)
      ? value.pendingOrdinals.map((item) => Number(item)).filter(Number.isInteger)
      : [],
    planDigest: digest(value.planDigest),
    manifestDigest: digest(value.manifestDigest),
    databaseName: nullableText(value.databaseName),
    systemIdentifier: nullableText(value.systemIdentifier),
  };
}

function normalizeClassification(value = {}) {
  return {
    key: text(value.key),
    classification: text(value.classification, 'UNKNOWN'),
    change: text(value.change, 'UNKNOWN'),
  };
}

function normalizeConfigurationRevision(value = {}) {
  return {
    algorithm: nullableText(value.algorithm),
    digest: digest(value.digest),
  };
}

function normalizeEnvironmentExecution(value = {}) {
  return {
    status: text(value.status, 'NOT_REQUESTED'),
    outcome: text(value.outcome, 'NOT_REQUESTED'),
    requestedKeys: list(value.requestedKeys, 32),
    changedKeys: list(value.changedKeys, 32),
    classifications: Array.isArray(value.classifications)
      ? value.classifications.slice(0, 32).map(normalizeClassification)
      : [],
    envExample: {
      outcome: text(value.envExample?.outcome, 'NOT_APPLICABLE'),
      changedKeys: list(value.envExample?.changedKeys, 32),
      classifications: Array.isArray(value.envExample?.classifications)
        ? value.envExample.classifications.slice(0, 32).map(normalizeClassification)
        : [],
    },
    configurationRevision: normalizeConfigurationRevision(value.configurationRevision),
    concurrency: {
      checked: bool(value.concurrency?.checked),
      outcome: text(value.concurrency?.outcome, 'NOT_REQUESTED'),
      files: Array.isArray(value.concurrency?.files)
        ? value.concurrency.files.slice(0, 8).map((file) => ({
            target: text(file?.target),
            outcome: text(file?.outcome, 'UNKNOWN'),
          }))
        : [],
    },
    restart: {
      required: bool(value.restart?.required),
      services: list(value.restart?.services, 8),
      reasonCode: nullableText(value.restart?.reasonCode),
    },
    executionId: nullableText(value.execution?.correlationId || value.executionId),
  };
}

function normalizeDatabaseExecution(value = {}) {
  return {
    status: text(value.status, 'NOT_REQUESTED'),
    outcome: text(value.outcome, 'NOT_REQUESTED'),
    pendingCount: numberValue(value.pendingCount),
    pendingOrdinals: Array.isArray(value.pendingOrdinals)
      ? value.pendingOrdinals.map((item) => Number(item)).filter(Number.isInteger)
      : [],
    appliedCount: numberValue(value.appliedCount),
    appliedOrdinals: Array.isArray(value.appliedOrdinals)
      ? value.appliedOrdinals.map((item) => Number(item)).filter(Number.isInteger)
      : [],
    planDigest: digest(value.planDigest?.digest || value.planDigest),
    manifestDigest: digest(value.manifestDigest?.digest || value.manifestDigest),
    fileOutcomes: Array.isArray(value.fileOutcomes)
      ? value.fileOutcomes.slice(0, 64).map((file) => ({
          ordinal: Number.isInteger(Number(file?.ordinal)) ? Number(file.ordinal) : null,
          kind: nullableText(file?.kind || file?.changeKind),
          relativePath: nullableText(file?.relativePath || file?.sourcePath),
          sha256: digest(file?.sha256),
          status: text(file?.status, 'UNKNOWN'),
          errorCode: nullableText(file?.errorCode),
          rolledBack: file?.rolledBack === true,
        }))
      : [],
    ledger: {
      available: bool(value.ledger?.available),
      verification: text(value.ledger?.verification, 'UNKNOWN'),
      appliedCount: numberValue(value.ledger?.appliedCount),
      driftDetected: value.ledger?.driftDetected === true,
      receipts: Array.isArray(value.ledger?.receipts)
        ? value.ledger.receipts.slice(0, 64).map((receipt) => ({
            changeId: nullableText(receipt?.changeId),
            baselineId: nullableText(receipt?.baselineId),
            ordinal: Number.isInteger(Number(receipt?.ordinal)) ? Number(receipt.ordinal) : null,
            kind: nullableText(receipt?.kind || receipt?.changeKind),
            relativePath: nullableText(receipt?.relativePath || receipt?.sourcePath),
            sha256: digest(receipt?.sha256),
            appliedAt: nullableText(receipt?.appliedAt),
            sourceRevision: nullableText(receipt?.sourceRevision),
            planDigest: digest(receipt?.planDigest),
          }))
        : [],
    },
  };
}

function normalizeLock(value = {}) {
  return {
    scope: {
      repositoryCode: text(value.scope?.repositoryCode, 'SkyCommand'),
      environmentCode: text(value.scope?.environmentCode),
      configProfileCode: text(value.scope?.configProfileCode),
    },
    acquired: bool(value.acquired),
    status: text(value.status, 'UNKNOWN'),
    leaseExpiresAt: nullableText(value.leaseExpiresAt),
  };
}

function normalizeLifecycle(value = {}) {
  return {
    required: bool(value.required),
    outcome: text(value.outcome, value.required === false ? 'SKIPPED' : 'UNKNOWN'),
    reason: nullableText(value.reason || (value.required === false ? 'NO_AFFECTED_RUNTIME_SERVICES' : null)),
    action: nullableText(value.action),
    services: list(value.services, 8),
    deferredServices: list(value.deferredServices, 8),
    operationId: nullableText(value.operationId),
    hostWorkflowId: nullableText(value.hostWorkflowId),
    hostRunId: nullableText(value.hostRunId),
  };
}

function normalizePreflight(value = {}) {
  return {
    contract: PREFLIGHT_OUTPUT_TYPE,
    outcome: text(value.outcome, 'FAILED'),
    runId: nullableText(value.runId),
    binding: normalizeBinding(value.binding),
    sourceIdentity: normalizeSourceIdentity(value.sourceIdentity),
    database: normalizeDatabase(value.database),
    environment: {
      patchRequested: bool(value.environment?.patchRequested),
      requestedKeys: list(value.environment?.requestedKeys, 16),
    },
    lock: normalizeLock(value.lock),
    lifecycle: normalizeLifecycle(value.lifecycle),
    sourceChanged: value.sourceChanged === true,
    changedPaths: list(value.changedPaths, 64),
    changedPathCount: numberValue(value.changedPathCount),
    changedPathsDigest: digest(value.changedPathsDigest),
    priorSourceIdentityDigest: digest(value.priorSourceIdentityDigest),
    lifecycleServicesJson: nullableText(value.lifecycleServicesJson),
    partialRun: {
      persisted: bool(value.partialRun?.persisted),
      status: text(value.partialRun?.status, 'UNKNOWN'),
    },
    timing: timing(value.timing),
    warnings: list(value.warnings, 20),
    error: normalizeError(value.error),
  };
}

function normalizeLifecycleOutput(value = {}) {
  return {
    contract: LIFECYCLE_OUTPUT_TYPE,
    outcome: text(value.outcome, 'FAILED'),
    runId: nullableText(value.runId),
    action: text(value.action, 'REBUILD_SERVICES'),
    services: list(value.services, 8),
    operationId: nullableText(value.operationId),
    hostWorkflowId: nullableText(value.hostWorkflowId),
    hostRunId: nullableText(value.hostRunId),
    idempotencyOutcome: text(value.idempotencyOutcome, 'NOT_REQUESTED'),
    status: text(value.status, 'UNKNOWN'),
    timing: timing(value.timing),
    warnings: list(value.warnings, 20),
    error: normalizeError(value.error),
  };
}

function normalizeValidation(value = {}) {
  return {
    contract: VALIDATION_OUTPUT_TYPE,
    outcome: text(value.outcome, 'FAIL'),
    profile: text(value.profile, 'r5-dev-finalization-v1'),
    checks: Array.isArray(value.checks)
      ? value.checks.slice(0, 32).map((check) => ({
          name: text(check?.name),
          status: text(check?.status, 'FAIL'),
          exitCode: check?.exitCode === null || check?.exitCode === undefined ? null : Number(check.exitCode),
          durationMs: numberValue(check?.durationMs),
          classification: text(check?.classification, 'REQUIRED'),
        }))
      : [],
    passedCount: numberValue(value.passedCount),
    knownLimitationCount: numberValue(value.knownLimitationCount),
    failedCount: numberValue(value.failedCount),
    timing: timing(value.timing),
    warnings: list(value.warnings, 20),
    error: normalizeError(value.error),
  };
}

function normalizeReadiness(value = {}) {
  return {
    contract: READINESS_OUTPUT_TYPE,
    outcome: text(value.outcome, 'NOT_READY'),
    runId: nullableText(value.runId),
    probes: Array.isArray(value.probes)
      ? value.probes.slice(0, 24).map((probe) => ({
          name: text(probe?.name),
          status: text(probe?.status, 'FAIL'),
          detail: text(probe?.detail).slice(0, 300),
        }))
      : [],
    runtime: {
      api: text(value.runtime?.api, 'UNKNOWN'),
      web: text(value.runtime?.web, 'NOT_REQUESTED'),
      hostAgent: text(value.runtime?.hostAgent, 'UNKNOWN'),
    },
    database: normalizeDatabase(value.database),
    registrations: {
      workflow: text(value.registrations?.workflow, 'UNKNOWN'),
      tools: list(value.registrations?.tools, 16),
    },
    timing: timing(value.timing),
    warnings: list(value.warnings, 20),
    error: normalizeError(value.error),
  };
}

function normalizeArtifact(value = {}) {
  return {
    path: nullableText(value.path),
    sha256: digest(value.sha256),
    bytes: numberValue(value.bytes),
    exists: bool(value.exists),
  };
}

function normalizeReceipt(value = {}) {
  const database = value.database || {};
  const environment = value.environment || {};
  return {
    contract: RECEIPT_OUTPUT_TYPE,
    outcome: text(value.outcome, 'FAILED'),
    runId: nullableText(value.runId),
    workflowCode: text(value.workflowCode, 'dev_change_finalize'),
    sourceIdentity: normalizeSourceIdentity(value.sourceIdentity),
    sourceChange: {
      changed: value.sourceChange?.changed === true || value.sourceChanged === true,
      changedPaths: list(value.sourceChange?.changedPaths || value.changedPaths, 64),
      changedPathCount: numberValue(value.sourceChange?.changedPathCount ?? value.changedPathCount),
      changedPathsDigest: digest(value.sourceChange?.changedPathsDigest || value.changedPathsDigest),
      priorSourceIdentityDigest: digest(
        value.sourceChange?.priorSourceIdentityDigest || value.priorSourceIdentityDigest,
      ),
    },
    environment: {
      preflight: {
        patchRequested: bool(environment.preflight?.patchRequested),
        requestedKeys: list(environment.preflight?.requestedKeys, 32),
      },
      execution: normalizeEnvironmentExecution(environment.execution),
      final: normalizeEnvironmentExecution(environment.final),
    },
    database: {
      preflight: normalizeDatabase(database.preflight),
      execution: normalizeDatabaseExecution(database.execution),
      final: normalizeDatabase(database.final || database),
    },
    lifecycle: normalizeLifecycle(value.lifecycle),
    validation: normalizeValidation(value.validation),
    readiness: normalizeReadiness(value.readiness),
    validationOutcome: text(value.validationOutcome, 'UNKNOWN'),
    readinessOutcome: text(value.readinessOutcome, 'UNKNOWN'),
    artifacts: {
      capabilityCatalogJson: normalizeArtifact(value.artifacts?.capabilityCatalogJson),
      capabilityCatalogXlsx: normalizeArtifact(value.artifacts?.capabilityCatalogXlsx),
      repoMap: normalizeArtifact(value.artifacts?.repoMap),
      repoZip: normalizeArtifact(value.artifacts?.repoZip),
    },
    zipEntries: Array.isArray(value.zipEntries)
      ? value.zipEntries.slice(0, 16).map((entry) => ({
          path: text(entry?.path),
          sha256: digest(entry?.sha256),
          status: text(entry?.status, 'UNKNOWN'),
        }))
      : [],
    receiptPath: nullableText(value.receiptPath),
    receiptSha256: digest(value.receiptSha256),
    receiptSelfHashConvention: text(
      value.receiptSelfHashConvention,
      'SELF_HASH_FIELD_NULL_DURING_HASH',
    ),
    lockReleasePolicy: text(value.lockReleasePolicy, 'RELEASE_AFTER_RECEIPT_PERSIST'),
    lockStateAtPersist: text(value.lockStateAtPersist, 'HELD'),
    lockReleased: bool(value.lockReleased),
    timing: timing(value.timing),
    warnings: list(value.warnings, 20),
    error: normalizeError(value.error),
  };
}

function envelope(outputType, output, success, message, metadata = {}) {
  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message,
    outputType,
    output,
    warnings: output.warnings || [],
    error: success ? null : normalizeError(output.error) || { code: 'DEV_FINALIZATION_FAILED', message },
    metadata: {
      valuesRedacted: true,
      workflowCode: 'dev_change_finalize',
      ...metadata,
    },
  });
}

function createPreflightToolResult(value = {}) {
  const output = normalizePreflight(value);
  return envelope(
    PREFLIGHT_OUTPUT_TYPE,
    output,
    ['READY', 'NO_CHANGES'].includes(output.outcome),
    output.error?.message || `R5 preflight ${output.outcome.toLowerCase()}.`,
  );
}

function createPreflightFailureToolResult(error, value = {}) {
  return createPreflightToolResult({
    ...(error?.details?.output || {}),
    ...value,
    outcome: value.outcome || 'FAILED',
    error,
  });
}

function createLifecycleToolResult(value = {}) {
  const output = normalizeLifecycleOutput(value);
  return envelope(
    LIFECYCLE_OUTPUT_TYPE,
    output,
    ['RECONCILED', 'NO_CHANGES'].includes(output.outcome),
    output.error?.message || `R5 lifecycle ${output.outcome.toLowerCase()}.`,
  );
}

function createLifecycleFailureToolResult(error, value = {}) {
  return createLifecycleToolResult({
    ...(error?.details?.output || {}),
    ...value,
    outcome: value.outcome || 'FAILED',
    error,
  });
}

function createValidationToolResult(value = {}) {
  const output = normalizeValidation(value);
  return envelope(
    VALIDATION_OUTPUT_TYPE,
    output,
    ['PASS', 'KNOWN_BASELINE_LIMITATION'].includes(output.outcome),
    output.error?.message || `R5 validation ${output.outcome.toLowerCase()}.`,
  );
}

function createValidationFailureToolResult(error, value = {}) {
  return createValidationToolResult({
    ...(error?.details?.output || {}),
    ...value,
    outcome: value.outcome || 'FAIL',
    error,
  });
}

function createReadinessToolResult(value = {}) {
  const output = normalizeReadiness(value);
  return envelope(
    READINESS_OUTPUT_TYPE,
    output,
    output.outcome === 'READY',
    output.error?.message || `R5 readiness ${output.outcome.toLowerCase()}.`,
  );
}

function createReadinessFailureToolResult(error, value = {}) {
  return createReadinessToolResult({
    ...(error?.details?.output || {}),
    ...value,
    outcome: value.outcome || 'NOT_READY',
    error,
  });
}

function createReceiptToolResult(value = {}) {
  const output = normalizeReceipt(value);
  return envelope(
    RECEIPT_OUTPUT_TYPE,
    output,
    ['COMPLETE', 'NO_CHANGES'].includes(output.outcome),
    output.error?.message || `R5 finalization ${output.outcome.toLowerCase()}.`,
  );
}

function createReceiptFailureToolResult(error, value = {}) {
  return createReceiptToolResult({
    ...(error?.details?.output || {}),
    ...value,
    outcome: value.outcome || 'FAILED',
    error,
  });
}

module.exports = {
  LIFECYCLE_OUTPUT_TYPE,
  PREFLIGHT_OUTPUT_TYPE,
  READINESS_OUTPUT_TYPE,
  RECEIPT_OUTPUT_TYPE,
  VALIDATION_OUTPUT_TYPE,
  createLifecycleFailureToolResult,
  createLifecycleToolResult,
  createPreflightFailureToolResult,
  createPreflightToolResult,
  createReadinessFailureToolResult,
  createReadinessToolResult,
  createReceiptFailureToolResult,
  createReceiptToolResult,
  createValidationFailureToolResult,
  createValidationToolResult,
  normalizeLifecycleOutput,
  normalizePreflight,
  normalizeReadiness,
  normalizeReceipt,
  normalizeValidation,
};
