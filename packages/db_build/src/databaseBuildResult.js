const DATABASE_BUILD_OUTPUT_TYPE = 'database_build_summary.v1';

function asNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function asNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function asNonNegativeNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function asNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeSqlFileResult(value = {}) {
  return {
    relativePath: String(value.relativePath || '').trim(),
    kind: ['MIGRATION', 'SEED', 'OTHER'].includes(value.kind) ? value.kind : 'OTHER',
    ordinal: asNonNegativeInteger(value.ordinal),
    status: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'].includes(value.status)
      ? value.status
      : 'PENDING',
    durationMs: asNonNegativeNumberOrNull(value.durationMs),
  };
}

function normalizeDatabaseBuildOutput(value = {}, overrides = {}) {
  const input = { ...value, ...overrides };
  const files = Array.isArray(input.files) ? input.files.map(normalizeSqlFileResult) : [];
  const status = input.status === 'BUILT' ? 'BUILT' : 'FAILED';
  const phase = [
    'VALIDATION',
    'DISCOVERY',
    'DROP_DATABASE',
    'CREATE_DATABASE',
    'APPLY_SQL',
    'COMPLETE',
  ].includes(input.phase)
    ? input.phase
    : status === 'BUILT'
      ? 'COMPLETE'
      : 'VALIDATION';

  return {
    startedAt: String(input.startedAt || new Date().toISOString()),
    completedAt: String(input.completedAt || new Date().toISOString()),
    durationMs: asNonNegativeNumber(input.durationMs),
    targetDatabase: String(input.targetDatabase || '').trim(),
    status,
    phase,
    buildCompleted: status === 'BUILT' && input.buildCompleted === true,
    databaseDropped: input.databaseDropped === true,
    databaseCreated: input.databaseCreated === true,
    sqlRoots: Array.isArray(input.sqlRoots)
      ? input.sqlRoots.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    sqlFilesDiscovered: asNonNegativeInteger(input.sqlFilesDiscovered ?? files.length),
    sqlFilesExecuted: asNonNegativeInteger(input.sqlFilesExecuted),
    migrationFilesDiscovered: asNonNegativeInteger(input.migrationFilesDiscovered),
    migrationFilesExecuted: asNonNegativeInteger(input.migrationFilesExecuted),
    seedFilesDiscovered: asNonNegativeInteger(input.seedFilesDiscovered),
    seedFilesExecuted: asNonNegativeInteger(input.seedFilesExecuted),
    firstSqlFile: asNullableString(input.firstSqlFile),
    lastSqlFile: asNullableString(input.lastSqlFile),
    lastCompletedSqlFile: asNullableString(input.lastCompletedSqlFile),
    failedSqlFile: asNullableString(input.failedSqlFile),
    files,
  };
}

function createDatabaseBuildToolResult(result) {
  const output = normalizeDatabaseBuildOutput(result, {
    status: 'BUILT',
    phase: 'COMPLETE',
    buildCompleted: true,
  });

  return {
    schemaVersion: '1.0',
    success: true,
    message: `${output.targetDatabase} was rebuilt successfully from ${output.sqlFilesExecuted} ordered SQL file(s).`,
    outputType: DATABASE_BUILD_OUTPUT_TYPE,
    output,
    warnings: [],
    error: null,
    metadata: {
      buildMode: 'DROP_CREATE_AND_APPLY_ORDERED_SQL',
      destructiveOperation: true,
    },
  };
}

function createDatabaseBuildFailureToolResult(error) {
  const source = error?.buildResult || {};
  const output = normalizeDatabaseBuildOutput(source, {
    status: 'FAILED',
    buildCompleted: false,
    completedAt: new Date().toISOString(),
    durationMs:
      source.durationMs ??
      (Number.isFinite(Number(source.startedAtMs))
        ? Math.max(0, Date.now() - Number(source.startedAtMs))
        : 0),
  });

  return {
    schemaVersion: '1.0',
    success: false,
    message: error?.message || 'PostgreSQL database build failed.',
    outputType: DATABASE_BUILD_OUTPUT_TYPE,
    output,
    warnings: [],
    error: {
      code: error?.code || 'DATABASE_BUILD_FAILED',
      message: error?.message || 'PostgreSQL database build failed.',
      details: {
        phase: output.phase,
        targetDatabase: output.targetDatabase || null,
        failedSqlFile: output.failedSqlFile,
      },
    },
    metadata: {
      buildMode: 'DROP_CREATE_AND_APPLY_ORDERED_SQL',
      destructiveOperation: true,
    },
  };
}

module.exports = {
  DATABASE_BUILD_OUTPUT_TYPE,
  createDatabaseBuildFailureToolResult,
  createDatabaseBuildToolResult,
  normalizeDatabaseBuildOutput,
  normalizeSqlFileResult,
};
