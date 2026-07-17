const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');

const REPOSITORY_PACKAGE_OUTPUT_TYPE = 'repository_package_summary.v1';

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNullableString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return String(value);
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  return {
    code: String(error.code || 'REPOSITORY_PACKAGE_FAILED'),
    message: String(error.message || error),
  };
}

function createRepositoryPackageToolResult(result = {}) {
  const success = result.ok !== false;
  const outcome = success ? 'CREATED' : 'FAILED';
  const sourceBytes = normalizeNumber(result.sourceBytes);
  const archiveBytes = normalizeNumber(result.archiveBytes);
  const compressionRatio = sourceBytes > 0 ? archiveBytes / sourceBytes : 0;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message: success
      ? `Repository package ${result.fileName || ''} was created successfully.`.trim()
      : 'Repository package generation failed.',
    outputType: REPOSITORY_PACKAGE_OUTPUT_TYPE,
    output: {
      artifactKind: 'REPOSITORY_ZIP',
      outcome,
      repositoryName: String(result.repositoryName || 'unknown'),
      repositoryRoot: normalizeNullableString(result.repositoryRoot),
      fileName: normalizeNullableString(result.fileName),
      artifactPath: normalizeNullableString(result.artifactPath),
      startedAt: normalizeNullableString(result.startedAt),
      completedAt: normalizeNullableString(result.completedAt),
      durationMs: normalizeNumber(result.durationMs),
      filesIncluded: normalizeNumber(result.filesIncluded),
      sourceBytes,
      archiveBytes,
      compressionRatio,
      options: {
        nodeModulesIncluded: Boolean(result.nodeModulesIncluded),
        imagesIncluded: Boolean(result.imagesIncluded),
        sensitiveEnvironmentFilesExcluded: result.sensitiveEnvironmentFilesExcluded !== false,
        generatedArtifactsExcluded: result.generatedArtifactsExcluded !== false,
      },
    },
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    error: success ? null : normalizeError(result.error),
    metadata: {
      extension: '.zip',
      transport: 'filesystem',
    },
  });
}

function createRepositoryPackageFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;

  return createRepositoryPackageToolResult({
    ok: false,
    repositoryName: 'unknown',
    repositoryRoot: null,
    fileName: null,
    artifactPath: null,
    startedAt: beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    filesIncluded: 0,
    sourceBytes: 0,
    archiveBytes: 0,
    nodeModulesIncluded: false,
    imagesIncluded: false,
    error,
  });
}

module.exports = {
  REPOSITORY_PACKAGE_OUTPUT_TYPE,
  createRepositoryPackageFailureToolResult,
  createRepositoryPackageToolResult,
};
