const assert = require('node:assert/strict');
const {
  buildCanonicalNodeResultView,
  buildConditionNodeLookup,
  buildMacroIngestionRollup,
  buildScheduledToolResultSummary,
  buildStructuredResultRollup,
  buildSummaryKeyOutputs,
} = require('./workflowResultContext');

function macroResult({
  sourceCode,
  rowsInserted = 0,
  updated = 0,
  unchanged = 1,
  failed = 0,
  durationMs = 1000,
}) {
  return {
    schemaVersion: '1.0',
    success: failed === 0,
    message: `${sourceCode} ingestion completed.`,
    outputType: 'macro_ingestion_summary.v1',
    output: {
      sourceCode,
      outcome: failed > 0 ? 'PARTIAL' : rowsInserted > 0 ? 'UPDATED' : 'UNCHANGED',
      selectedIndicators: false,
      durationMs,
      totals: {
        indicatorsRequested: updated + unchanged + failed,
        indicatorsSucceeded: updated + unchanged,
        indicatorsFailed: failed,
        indicatorsUpdated: updated,
        indicatorsUnchanged: unchanged,
        rowsStaged: 100,
        rowsDetectedAsNew: rowsInserted,
        rowsInserted,
      },
      indicators: [],
    },
    warnings: [],
    error: failed > 0 ? { code: 'SOURCE_PARTIAL', message: 'One indicator failed.' } : null,
    metadata: { sourceCode },
    kind: 'tool_execution',
    toolCode: `ingestion_${sourceCode.toLowerCase()}`,
    status: failed > 0 ? 'FAILED' : 'SUCCESS',
    durationMs,
    executionId: `${sourceCode.toLowerCase()}-execution`,
  };
}


function repositoryPackageResult() {
  return {
    schemaVersion: '1.0',
    success: true,
    message: 'Repository package created.',
    outputType: 'repository_package_summary.v1',
    output: {
      artifactKind: 'REPOSITORY_ZIP',
      outcome: 'CREATED',
      repositoryName: 'SkyServer',
      repositoryRoot: 'C:/Projects/SkyServer',
      fileName: 'SkyServer_Repo.zip',
      artifactPath: 'C:/Projects/SkyServer/zip/SkyServer_Repo.zip',
      startedAt: '2026-07-17T02:00:00.000Z',
      completedAt: '2026-07-17T02:00:03.000Z',
      durationMs: 3000,
      filesIncluded: 412,
      sourceBytes: 1840000,
      archiveBytes: 910000,
      compressionRatio: 0.4945652173913043,
      options: {
        nodeModulesIncluded: false,
        imagesIncluded: false,
        sensitiveEnvironmentFilesExcluded: true,
        generatedArtifactsExcluded: true,
      },
    },
    warnings: [],
    error: null,
    metadata: { extension: '.zip' },
    kind: 'tool_execution',
    toolCode: 'repo_zip_generate',
    status: 'SUCCESS',
    durationMs: 3000,
    executionId: 'repo-zip-execution',
  };
}

function run() {
  const results = {
    fred_ingestion: macroResult({
      sourceCode: 'FRED',
      rowsInserted: 8,
      updated: 8,
      unchanged: 45,
      durationMs: 14000,
    }),
    boc_ingestion: macroResult({ sourceCode: 'BOC', unchanged: 2, durationMs: 1000 }),
    statcan_ingestion: macroResult({ sourceCode: 'STATCAN', unchanged: 14, durationMs: 6000 }),
  };

  const canonical = buildCanonicalNodeResultView({
    nodeKey: 'fred_ingestion',
    rawResult: results.fred_ingestion,
    existingNode: { status: 'COMPLETED' },
  });

  assert.equal(canonical.output.totals.rowsInserted, 8);
  assert.equal(canonical.result.outputType, 'macro_ingestion_summary.v1');
  assert.equal(canonical.status, 'COMPLETED');

  const lookup = buildConditionNodeLookup({}, results);
  assert.equal(lookup.fred_ingestion.output.totals.rowsInserted, 8);
  assert.equal(lookup.boc_ingestion.output.totals.indicatorsUnchanged, 2);
  assert.equal(lookup.statcan_ingestion.result.toolCode, 'ingestion_statcan');

  const rollup = buildMacroIngestionRollup(results);
  assert.equal(rollup.sourceCount, 3);
  assert.deepEqual(
    rollup.sources.map((source) => source.sourceCode),
    ['FRED', 'BOC', 'STATCAN'],
  );
  assert.equal(rollup.totals.indicatorsRequested, 69);
  assert.equal(rollup.totals.indicatorsUpdated, 8);
  assert.equal(rollup.totals.indicatorsUnchanged, 61);
  assert.equal(rollup.totals.rowsInserted, 8);
  assert.equal(rollup.outcome, 'UPDATED');

  const keyOutputs = buildSummaryKeyOutputs(results);
  assert.deepEqual(Object.keys(keyOutputs), [
    'fred_ingestion',
    'boc_ingestion',
    'statcan_ingestion',
  ]);
  assert.equal(keyOutputs.boc_ingestion.output.sourceCode, 'BOC');
  assert.equal(keyOutputs.fred_ingestion.output.totals.rowsInserted, 8);
  assert.equal(
    Object.prototype.hasOwnProperty.call(keyOutputs.fred_ingestion.output, 'indicators'),
    false,
  );

  const structured = buildStructuredResultRollup(results);
  assert.equal(structured.resultCount, 3);
  assert.equal(structured.outputTypes['macro_ingestion_summary.v1'], 3);
  assert.equal(structured.macroIngestion.sources.length, 3);

  const scheduled = buildScheduledToolResultSummary(results.boc_ingestion);
  assert.equal(scheduled.outputType, 'macro_ingestion_summary.v1');
  assert.equal(scheduled.macroIngestion.sourceCode, 'BOC');
  assert.equal(scheduled.macroIngestion.totals.indicatorsUnchanged, 2);

  const repositoryResult = repositoryPackageResult();
  const repositoryLookup = buildConditionNodeLookup({}, { package_repo: repositoryResult });
  assert.equal(repositoryLookup.package_repo.output.filesIncluded, 412);
  assert.equal(
    repositoryLookup.package_repo.output.artifactPath,
    'C:/Projects/SkyServer/zip/SkyServer_Repo.zip',
  );

  const repositoryKeyOutputs = buildSummaryKeyOutputs({ package_repo: repositoryResult });
  assert.equal(repositoryKeyOutputs.package_repo.output.fileName, 'SkyServer_Repo.zip');
  assert.equal(repositoryKeyOutputs.package_repo.output.filesIncluded, 412);

  const scheduledRepository = buildScheduledToolResultSummary(repositoryResult);
  assert.equal(scheduledRepository.outputType, 'repository_package_summary.v1');
  assert.equal(scheduledRepository.repositoryPackage.filesIncluded, 412);
  assert.equal(scheduledRepository.repositoryPackage.archiveBytes, 910000);

  console.log('[SkyCommand] Workflow result context self-test passed.');
}

run();
