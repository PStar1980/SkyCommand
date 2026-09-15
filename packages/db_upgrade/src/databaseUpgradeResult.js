const DATABASE_UPGRADE_OUTPUT_TYPE = 'database_upgrade_summary.v1';

function asNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function asNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function asNullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeChange(value = {}) {
  return {
    ordinal: asNonNegativeInteger(value.ordinal),
    kind: ['MIGRATION', 'SEED'].includes(value.kind) ? value.kind : 'MIGRATION',
    relativePath: String(value.relativePath || '').trim(),
    sha256: String(value.sha256 || '').trim().toUpperCase(),
  };
}

function normalizeDatabaseIdentity(value = {}) {
  return {
    databaseName: asNullableString(value.databaseName),
    serverVersion: asNullableString(value.serverVersion),
    serverPort:
      value.serverPort === null || value.serverPort === undefined
        ? null
        : asNonNegativeInteger(value.serverPort),
    systemIdentifier: asNullableString(value.systemIdentifier),
  };
}

function normalizeProbe(value = {}) {
  return {
    name: String(value.name || '').trim(),
    status: ['PASS', 'FAIL', 'UNKNOWN'].includes(value.status) ? value.status : 'UNKNOWN',
    evidence: value.evidence && typeof value.evidence === 'object' ? value.evidence : {},
  };
}

function normalizeDatabaseUpgradeOutput(value = {}, overrides = {}) {
  const input = { ...value, ...overrides };
  const mode = input.mode === 'APPLY' ? 'APPLY' : 'PLAN';
  const outcome = [
    'PLAN_READY',
    'APPLIED',
    'BLOCKED',
    'FAILED',
  ].includes(input.outcome)
    ? input.outcome
    : 'FAILED';

  return {
    contract: 'database_upgrade_summary.v1',
    mode,
    databaseIdentity: normalizeDatabaseIdentity(input.databaseIdentity),
    baseline: {
      status: ['VERIFIED', 'NOT_INITIALIZED', 'FAILED', 'UNKNOWN'].includes(
        input.baseline?.status,
      )
        ? input.baseline.status
        : 'UNKNOWN',
      contract: asNullableString(input.baseline?.contract),
      ordinal: asNonNegativeInteger(input.baseline?.ordinal),
      recorded: input.baseline?.recorded === true,
      probes: Array.isArray(input.baseline?.probes)
        ? input.baseline.probes.map(normalizeProbe)
        : [],
    },
    sourceRevision: asNullableString(input.sourceRevision),
    planDigest: input.planDigest
      ? {
          algorithm: 'SHA-256',
          digest: String(input.planDigest.digest || '').trim().toUpperCase(),
        }
      : null,
    pendingCount: asNonNegativeInteger(input.pendingCount),
    pendingChanges: Array.isArray(input.pendingChanges)
      ? input.pendingChanges.map(normalizeChange)
      : [],
    appliedCount: asNonNegativeInteger(input.appliedCount),
    ledger: {
      available: input.ledger?.available === true,
      verification: ['VERIFIED', 'NOT_INITIALIZED', 'DRIFT', 'FAILED', 'UNKNOWN'].includes(
        input.ledger?.verification,
      )
        ? input.ledger.verification
        : 'UNKNOWN',
      appliedCount: asNonNegativeInteger(input.ledger?.appliedCount),
      driftDetected: input.ledger?.driftDetected === true,
    },
    lock: {
      requested: input.lock?.requested === true,
      acquired: input.lock?.acquired === true,
      released: input.lock?.released === true,
      mechanism: asNullableString(input.lock?.mechanism),
    },
    outcome,
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    errors: Array.isArray(input.errors) ? input.errors : [],
    timing: {
      startedAt: String(input.timing?.startedAt || new Date().toISOString()),
      completedAt: String(input.timing?.completedAt || new Date().toISOString()),
      durationMs: asNonNegativeNumber(input.timing?.durationMs),
    },
  };
}

function createDatabaseUpgradeToolResult(result) {
  const output = normalizeDatabaseUpgradeOutput(result);
  const success = output.outcome === 'PLAN_READY' || output.outcome === 'APPLIED';

  return {
    schemaVersion: '1.0',
    success,
    message:
      output.outcome === 'APPLIED'
        ? `Applied ${output.appliedCount} database upgrade change(s).`
        : `Database upgrade plan contains ${output.pendingCount} pending change(s).`,
    outputType: DATABASE_UPGRADE_OUTPUT_TYPE,
    output,
    warnings: output.warnings,
    error: success
      ? null
      : {
          code: output.errors[0]?.code || 'DATABASE_UPGRADE_BLOCKED',
          message: output.errors[0]?.message || 'Database upgrade was blocked.',
        },
    metadata: {
      upgradeMode: output.mode,
      destructiveOperation: false,
      agentExecutionExposed: false,
    },
  };
}

function createDatabaseUpgradeFailureToolResult(error) {
  const output = normalizeDatabaseUpgradeOutput(error?.upgradeResult || {}, {
    outcome: 'FAILED',
    errors: [
      {
        code: error?.code || 'DATABASE_UPGRADE_FAILED',
        message: error?.message || 'Database upgrade failed.',
      },
    ],
    timing: {
      ...(error?.upgradeResult?.timing || {}),
      completedAt: new Date().toISOString(),
    },
  });

  return {
    schemaVersion: '1.0',
    success: false,
    message: error?.message || 'Database upgrade failed.',
    outputType: DATABASE_UPGRADE_OUTPUT_TYPE,
    output,
    warnings: output.warnings,
    error: {
      code: error?.code || 'DATABASE_UPGRADE_FAILED',
      message: error?.message || 'Database upgrade failed.',
      details: {
        mode: output.mode,
        databaseName: output.databaseIdentity.databaseName,
        outcome: output.outcome,
      },
    },
    metadata: {
      upgradeMode: output.mode,
      destructiveOperation: false,
      agentExecutionExposed: false,
    },
  };
}

module.exports = {
  DATABASE_UPGRADE_OUTPUT_TYPE,
  createDatabaseUpgradeFailureToolResult,
  createDatabaseUpgradeToolResult,
  normalizeDatabaseUpgradeOutput,
};
