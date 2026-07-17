const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');

const REPOSITORY_MAP_OUTPUT_TYPE = 'repository_map_summary.v1';

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeNullableString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeError(error) {
  if (!error) return null;
  return {
    code: String(error.code || 'REPOSITORY_MAP_FAILED'),
    message: String(error.message || error),
  };
}

function normalizeCountMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [String(key), normalizeNumber(count)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function createRepositoryMapToolResult(result = {}) {
  const success = result.ok !== false;
  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message: success
      ? `Repository map ${result.fileName || ''} was created successfully.`.trim()
      : 'Repository map generation failed.',
    outputType: REPOSITORY_MAP_OUTPUT_TYPE,
    output: {
      artifactKind: 'REPOSITORY_MAP',
      outcome: success ? 'CREATED' : 'FAILED',
      repositoryName: String(result.repositoryName || 'unknown'),
      repositoryRoot: normalizeNullableString(result.repositoryRoot),
      fileName: normalizeNullableString(result.fileName),
      artifactPath: normalizeNullableString(result.artifactPath),
      format: String(result.format || 'MARKDOWN').toUpperCase(),
      startedAt: normalizeNullableString(result.startedAt),
      completedAt: normalizeNullableString(result.completedAt),
      durationMs: normalizeNumber(result.durationMs),
      directoriesDocumented: normalizeNumber(result.directoriesDocumented),
      filesDocumented: normalizeNumber(result.filesDocumented),
      directoriesExcluded: normalizeNumber(result.directoriesExcluded),
      filesExcluded: normalizeNumber(result.filesExcluded),
      outputBytes: normalizeNumber(result.outputBytes),
      topLevelEntries: Array.isArray(result.topLevelEntries)
        ? result.topLevelEntries.map(String)
        : [],
      extensionCounts: normalizeCountMap(result.extensionCounts),
      policy: {
        nodeModulesExcluded: result.nodeModulesExcluded !== false,
        sensitiveEnvironmentFilesExcluded: result.sensitiveEnvironmentFilesExcluded !== false,
        generatedArtifactsExcluded: result.generatedArtifactsExcluded !== false,
        e2eTestsExcluded: result.e2eTestsExcluded !== false,
      },
    },
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    error: success ? null : normalizeError(result.error),
    metadata: {
      extension: normalizeNullableString(
        result.fileName ? require('path').extname(result.fileName) : null,
      ),
      transport: 'filesystem',
    },
  });
}

function createRepositoryMapFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;
  return createRepositoryMapToolResult({
    ok: false,
    repositoryName: 'unknown',
    startedAt: beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    error,
  });
}

module.exports = {
  REPOSITORY_MAP_OUTPUT_TYPE,
  createRepositoryMapFailureToolResult,
  createRepositoryMapToolResult,
};
