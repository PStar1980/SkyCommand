const assert = require('node:assert/strict');
const {
  buildCanonicalNodeResultView,
  buildConditionNodeLookup,
  buildGitPromotionRollup,
  buildDatabaseSynchronizationRollup,
  buildMacroIngestionRollup,
  buildScheduledToolResultSummary,
  buildStructuredResultRollup,
  buildSummaryKeyOutputs,
  compactDomainOutput,
  getScheduledToolResultEvidence,
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

function repositoryMapResult() {
  return {
    schemaVersion: '1.0',
    success: true,
    message: 'Repository map created.',
    outputType: 'repository_map_summary.v1',
    output: {
      artifactKind: 'REPOSITORY_MAP',
      outcome: 'CREATED',
      repositoryName: 'SkyServer',
      repositoryRoot: 'C:/Projects/SkyServer',
      fileName: 'SkyServer_RepoMap.md',
      artifactPath: 'C:/Projects/SkyServer/docs/SkyServer_RepoMap.md',
      format: 'MARKDOWN',
      durationMs: 100,
      directoriesDocumented: 42,
      filesDocumented: 468,
      directoriesExcluded: 8,
      filesExcluded: 12,
      outputBytes: 86123,
      topLevelEntries: ['apps', 'packages'],
      extensionCounts: { '.js': 200 },
      policy: {
        nodeModulesExcluded: true,
        sensitiveEnvironmentFilesExcluded: true,
        generatedArtifactsExcluded: true,
        e2eTestsExcluded: true,
      },
    },
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode: 'repo_map_generate',
    status: 'SUCCESS',
    durationMs: 100,
    executionId: 'repo-map-execution',
  };
}

function gitBranchSyncResult() {
  return {
    schemaVersion: '1.0',
    success: true,
    message: 'Main was synchronized into dev.',
    outputType: 'git_branch_sync_summary.v1',
    output: {
      operationKind: 'MAIN_TO_DEV_SYNC',
      outcome: 'SYNCHRONIZED',
      repositoryCode: 'SkyServer',
      repositoryName: 'SkyServer',
      repositoryRoot: 'C:/Projects/SkyServer',
      sourceBranch: 'main',
      targetBranch: 'dev',
      mainBranch: 'main',
      devBranch: 'dev',
      mainHeadSha: '3'.repeat(40),
      devHeadBeforeSha: '2'.repeat(40),
      devHeadAfterSha: '3'.repeat(40),
      synchronizedHeadSha: '3'.repeat(40),
      commitsApplied: 1,
      devAdvanced: true,
      branchesSynchronized: true,
      tagName: null,
      tagCreated: false,
      durationMs: 500,
      steps: {
        fetched: true,
        mainBranchSelected: true,
        mainBranchPulled: true,
        devBranchSelected: true,
        devBranchPulled: true,
        fastForwardMerged: true,
        mainBranchPushed: true,
        devBranchPushed: true,
        tagCreated: false,
        tagsPushed: false,
      },
    },
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode: 'main_merge',
    status: 'SUCCESS',
    durationMs: 500,
    executionId: 'main-merge-execution',
  };
}

function gitRepositoryStatusResult() {
  const sha = '4'.repeat(40);
  return {
    schemaVersion: '1.0',
    success: true,
    message: 'SkyServer is ready for development promotion.',
    outputType: 'git_repository_status.v1',
    output: {
      operationKind: 'REPOSITORY_STATUS',
      executionStrategy: 'CHECKOUT_FREE_INSPECTION',
      watcherSafe: true,
      outcome: 'READY',
      repositoryCode: 'SkyServer',
      repositoryName: 'SkyServer',
      repositoryRoot: 'C:/Projects/SkyServer',
      remote: 'origin',
      expectedBranch: 'dev',
      currentBranch: 'dev',
      detachedHead: false,
      fetchPerformed: true,
      fetchSucceeded: true,
      workingTree: {
        clean: false,
        hasChanges: true,
        staged: 0,
        modified: 4,
        untracked: 2,
        conflicted: 0,
        totalChanges: 6,
        entries: [],
      },
      branches: {
        main: {
          name: 'main',
          localSha: sha,
          remoteSha: sha,
          ahead: 0,
          behind: 0,
          localMatchesRemote: true,
          latestLocalCommit: null,
          latestRemoteCommit: null,
        },
        dev: {
          name: 'dev',
          localSha: sha,
          remoteSha: sha,
          ahead: 0,
          behind: 0,
          localMatchesRemote: true,
          latestLocalCommit: null,
          latestRemoteCommit: null,
        },
      },
      relationship: {
        localBranchesSynchronized: true,
        remoteBranchesSynchronized: true,
        localMainContainsDev: true,
        localDevContainsMain: true,
        mainContainsDev: true,
        devContainsMain: true,
        commonAncestorSha: sha,
      },
      repositoryState: {
        gitDir: 'C:/Projects/SkyServer/.git',
        commonDir: 'C:/Projects/SkyServer/.git',
        indexLockPresent: false,
        mergeInProgress: false,
        rebaseInProgress: false,
        cherryPickInProgress: false,
        revertInProgress: false,
        bisectInProgress: false,
        operationInProgress: false,
      },
      readyForDevelopmentPromotion: true,
      blockers: [],
      advisories: ['6 working-tree changes are available for commit.'],
      recommendedActions: [],
      recentCommits: [],
      startedAt: '2026-07-18T16:00:00.000Z',
      completedAt: '2026-07-18T16:00:01.000Z',
      durationMs: 1000,
    },
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode: 'git_repo_status',
    status: 'SUCCESS',
    durationMs: 1000,
    executionId: 'git-repository-status-execution',
  };
}

function promotionConditionResult({
  passed = true,
  trueTargetNodeKey = 'repo_map_node',
  falseTargetNodeKey = 'promotion_summary_node',
  onFalse = 'STOP_SUCCESS',
} = {}) {
  const branchLabel = passed ? 'TRUE' : 'FALSE';
  const branchTargetNodeKey = passed ? trueTargetNodeKey : falseTargetNodeKey;

  return {
    kind: 'condition_evaluation',
    status: passed ? 'PASSED' : 'FAILED',
    passed,
    route: branchLabel,
    reason: passed
      ? `Condition Promotion Ready resolved TRUE; routing to ${branchTargetNodeKey}.`
      : `Condition Promotion Ready resolved FALSE; routing to ${branchTargetNodeKey}.`,
    operator: 'TRUTHY',
    leftPath: 'nodes.repo_status_node.output.readyForDevelopmentPromotion',
    leftPathResolved: true,
    leftPathUsedFallback: false,
    leftValue: passed,
    leftExists: true,
    rightValue: null,
    rightType: 'AUTO',
    caseSensitive: false,
    onFalse,
    trueTargetNodeKey,
    falseTargetNodeKey,
    branchTargetNodeKey,
    branchLabel,
    branchTaken: true,
    summary: passed
      ? `Condition Promotion Ready resolved TRUE; routing to ${branchTargetNodeKey}.`
      : `Condition Promotion Ready resolved FALSE; routing to ${branchTargetNodeKey}.`,
    contextUpdates: {},
  };
}

function humanApprovalResult() {
  return {
    kind: 'human_approval',
    status: 'APPROVED',
    approved: true,
    rejected: false,
    timedOut: false,
    decision: 'APPROVED',
    action: 'CONTINUE',
    approvalTitle: 'Merge approval',
    approvalKey: 'merge_approval_node',
    requiredRoleCode: 'SUPER_ADMIN',
    decisionNote: 'Pull request merged successfully.',
    decidedByDisplayName: 'Paul-SuperAdmin',
    decidedAt: '2026-07-17T21:00:00.000Z',
    summary: 'Approval granted; continuing workflow.',
  };
}

function gitCommitResult() {
  return {
    schemaVersion: '1.0',
    success: true,
    message: 'Changes pushed.',
    outputType: 'git_commit_summary.v1',
    output: {
      operationKind: 'DEV_COMMIT',
      outcome: 'PUSHED',
      repositoryCode: 'SkyServer',
      repositoryName: 'SkyServer',
      repositoryRoot: 'C:/Projects/SkyServer',
      branch: 'dev',
      remote: 'origin',
      commitMessage: 'Test',
      previousHeadSha: '1'.repeat(40),
      currentHeadSha: '2'.repeat(40),
      commitSha: '2'.repeat(40),
      durationMs: 300,
      changedFiles: 6,
      changes: { added: 2, modified: 4, deleted: 0, renamed: 0, untracked: 0, other: 0 },
      steps: {
        fetched: true,
        switchedBranch: true,
        pulled: true,
        staged: true,
        committed: true,
        pushed: true,
      },
    },
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode: 'dev_commit',
    status: 'SUCCESS',
    durationMs: 300,
    executionId: 'dev-commit-execution',
  };
}

function databaseBuildResult() {
  return {
    schemaVersion: '1.0',
    success: true,
    message: 'skyserver_test was rebuilt successfully from 70 ordered SQL file(s).',
    outputType: 'database_build_summary.v1',
    output: {
      startedAt: '2026-07-22T05:00:00.000Z',
      completedAt: '2026-07-22T05:00:03.000Z',
      durationMs: 3000,
      targetDatabase: 'skyserver_test',
      status: 'BUILT',
      phase: 'COMPLETE',
      buildCompleted: true,
      databaseDropped: true,
      databaseCreated: true,
      sqlRoots: ['packages/db_build/src/migrations', 'packages/db_build/src/seeds'],
      sqlFilesDiscovered: 70,
      sqlFilesExecuted: 70,
      migrationFilesDiscovered: 40,
      migrationFilesExecuted: 40,
      seedFilesDiscovered: 30,
      seedFilesExecuted: 30,
      firstSqlFile: 'packages/db_build/src/migrations/00001__core.sql',
      lastSqlFile: 'packages/db_build/src/seeds/00070__db_build_structured_output_seed.sql',
      lastCompletedSqlFile:
        'packages/db_build/src/seeds/00070__db_build_structured_output_seed.sql',
      failedSqlFile: null,
      files: [],
    },
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode: 'db_build',
    status: 'SUCCESS',
    durationMs: 3000,
    executionId: 'db-build-execution',
  };
}


function databaseHealthResult() {
  return {
    schemaVersion: '1.0',
    success: true,
    message: '1 of 2 PostgreSQL databases are online.',
    outputType: 'database_health_summary.v1',
    output: {
      checkedAt: '2026-07-22T05:00:00.000Z',
      durationMs: 100,
      failWhenOffline: false,
      allOnline: false,
      requestedCount: 2,
      onlineCount: 1,
      offlineCount: 1,
      databases: [
        {
          databaseName: 'skyserver_dev',
          online: true,
          latencyMs: 20,
          currentUser: 'postgres',
          serverAddress: '::1',
          serverPort: 5432,
          serverVersion: '18.3',
          checkedAt: '2026-07-22T05:00:00.000Z',
          errorCode: null,
          errorMessage: null,
        },
        {
          databaseName: 'skycommand_test',
          online: false,
          latencyMs: 40,
          currentUser: null,
          serverAddress: null,
          serverPort: null,
          serverVersion: null,
          checkedAt: '2026-07-22T05:00:00.000Z',
          errorCode: '3D000',
          errorMessage: 'database does not exist',
        },
      ],
    },
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode: 'db_health',
    status: 'SUCCESS',
    durationMs: 100,
    executionId: 'db-health-execution',
  };
}

function databaseHealthConditionResult() {
  return {
    kind: 'condition_evaluation',
    status: 'PASSED',
    passed: true,
    branchLabel: 'TRUE',
    branchTargetNodeKey: 'db_build_node',
    branchTaken: true,
    leftPath: 'nodes.db_health_node.output.databases[0].online',
    leftPathResolved: true,
    leftPathUsedFallback: false,
    leftValue: true,
    operator: 'TRUTHY',
    rightValue: null,
    onFalse: 'STOP_SUCCESS',
    summary: 'Primary database is online.',
    durationMs: 0,
  };
}

function databaseComparisonResult({ match = false } = {}) {
  const differences = match
    ? []
    : [
        {
          kind: 'ONLY_IN_DATABASE_A',
          objectType: 'constraint',
          schemaName: 'core',
          objectName: 'tools',
          identity: 'tools_code_key',
          objectKey: 'constraint|core|tools|tools_code_key',
          databaseAFingerprint: 'a'.repeat(64),
          databaseBFingerprint: '',
        },
      ];

  return {
    schemaVersion: '1.0',
    success: true,
    message: match
      ? 'Databases contain matching PostgreSQL object definitions.'
      : 'Databases differ by 1 PostgreSQL object.',
    outputType: 'postgresql_database_comparison_summary.v1',
    output: {
      comparedAt: '2026-07-22T05:00:05.000Z',
      durationMs: 500,
      comparisonCompleted: true,
      databasesOnline: true,
      databasesMatch: match,
      status: match ? 'MATCH' : 'DIFFERENT',
      databaseA: 'skyserver_dev',
      databaseB: 'skycommand_test',
      databaseAFingerprint: 'a'.repeat(64),
      databaseBFingerprint: match ? 'a'.repeat(64) : 'b'.repeat(64),
      databaseAObjectCount: 3188,
      databaseBObjectCount: match ? 3188 : 3187,
      matchedObjectCount: match ? 3188 : 3187,
      onlyInDatabaseACount: match ? 0 : 1,
      onlyInDatabaseBCount: 0,
      definitionMismatchCount: 0,
      totalDifferenceCount: differences.length,
      differenceDetailsReturned: differences.length,
      differenceDetailsTruncated: false,
      byType: [
        {
          objectType: 'constraint',
          databaseACount: 896,
          databaseBCount: match ? 896 : 895,
          onlyInDatabaseA: match ? 0 : 1,
          onlyInDatabaseB: 0,
          definitionMismatches: 0,
        },
      ],
      differences,
    },
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode: 'db_object_compare',
    status: 'SUCCESS',
    durationMs: 500,
    executionId: 'db-compare-execution',
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

  const mapResult = repositoryMapResult();
  const mapLookup = buildConditionNodeLookup({}, { repo_map_node: mapResult });
  assert.equal(mapLookup.repo_map_node.output.filesDocumented, 468);
  assert.equal(mapLookup.repo_map_node.output.outputBytes, 86123);
  const mapKeyOutputs = buildSummaryKeyOutputs({ repo_map_node: mapResult });
  assert.equal(mapKeyOutputs.repo_map_node.output.filesDocumented, 468);
  assert.equal(
    Object.prototype.hasOwnProperty.call(mapKeyOutputs.repo_map_node.output, 'extensionCounts'),
    false,
  );
  const scheduledMap = buildScheduledToolResultSummary(mapResult);
  assert.equal(scheduledMap.repositoryMap.directoriesDocumented, 42);

  const repositoryStatusResult = gitRepositoryStatusResult();
  const repositoryStatusLookup = buildConditionNodeLookup(
    {},
    { repo_status_node: repositoryStatusResult },
  );
  assert.equal(
    repositoryStatusLookup.repo_status_node.output.readyForDevelopmentPromotion,
    true,
  );
  assert.equal(repositoryStatusLookup.repo_status_node.output.workingTree.totalChanges, 6);
  const repositoryStatusKeyOutputs = buildSummaryKeyOutputs({
    repo_status_node: repositoryStatusResult,
  });
  assert.equal(repositoryStatusKeyOutputs.repo_status_node.output.outcome, 'READY');
  assert.equal(repositoryStatusKeyOutputs.repo_status_node.output.blockerCount, 0);
  const scheduledRepositoryStatus = buildScheduledToolResultSummary(repositoryStatusResult);
  assert.equal(scheduledRepositoryStatus.gitRepositoryStatus.currentBranch, 'dev');
  assert.equal(
    scheduledRepositoryStatus.gitRepositoryStatus.readyForDevelopmentPromotion,
    true,
  );
  const scheduledRepositoryEvidence = getScheduledToolResultEvidence({
    toolResult: { available: true, ...scheduledRepositoryStatus },
  });
  assert.equal(scheduledRepositoryEvidence.outputType, 'git_repository_status.v1');
  assert.equal(scheduledRepositoryEvidence.gitRepositoryStatus.blockerCount, 0);
  assert.equal(getScheduledToolResultEvidence({ toolResult: { available: false } }), null);

  const commitResult = gitCommitResult();
  const commitLookup = buildConditionNodeLookup({}, { dev_commit_node: commitResult });
  assert.equal(commitLookup.dev_commit_node.output.changedFiles, 6);
  assert.equal(commitLookup.dev_commit_node.output.commitSha, '2'.repeat(40));
  const commitKeyOutputs = buildSummaryKeyOutputs({ dev_commit_node: commitResult });
  assert.equal(commitKeyOutputs.dev_commit_node.output.outcome, 'PUSHED');
  const scheduledCommit = buildScheduledToolResultSummary(commitResult);
  assert.equal(scheduledCommit.gitCommit.branch, 'dev');
  assert.equal(scheduledCommit.gitCommit.changedFiles, 6);

  const buildResult = databaseBuildResult();
  const buildLookup = buildConditionNodeLookup({}, { db_build_node: buildResult });
  assert.equal(buildLookup.db_build_node.output.buildCompleted, true);
  assert.equal(buildLookup.db_build_node.output.sqlFilesExecuted, 70);
  const buildKeyOutputs = buildSummaryKeyOutputs({ db_build_node: buildResult });
  assert.equal(buildKeyOutputs.db_build_node.output.targetDatabase, 'skyserver_test');
  assert.equal(buildKeyOutputs.db_build_node.output.sqlFilesExecuted, 70);
  assert.equal(
    Object.prototype.hasOwnProperty.call(buildKeyOutputs.db_build_node.output, 'files'),
    false,
  );
  const scheduledBuild = buildScheduledToolResultSummary(buildResult);
  assert.equal(scheduledBuild.databaseBuild.buildCompleted, true);
  assert.equal(scheduledBuild.databaseBuild.sqlFilesExecuted, 70);

  const branchSyncResult = gitBranchSyncResult();
  const branchSyncLookup = buildConditionNodeLookup({}, { main_merge_node: branchSyncResult });
  assert.equal(branchSyncLookup.main_merge_node.output.branchesSynchronized, true);
  assert.equal(branchSyncLookup.main_merge_node.output.commitsApplied, 1);
  const scheduledBranchSync = buildScheduledToolResultSummary(branchSyncResult);
  assert.equal(scheduledBranchSync.gitBranchSync.sourceBranch, 'main');
  assert.equal(scheduledBranchSync.gitBranchSync.targetBranch, 'dev');

  const promotionCondition = promotionConditionResult();
  const compactCondition = compactDomainOutput(promotionCondition);
  assert.equal(compactCondition.passed, true);
  assert.equal(compactCondition.branchTargetNodeKey, 'repo_map_node');

  const promotion = buildGitPromotionRollup({
    repo_status_node: repositoryStatusResult,
    promotion_gate_node: promotionCondition,
    repo_map_node: mapResult,
    repo_zip_node: repositoryResult,
    dev_commit_node: commitResult,
    merge_approval_node: humanApprovalResult(),
    main_merge_node: branchSyncResult,
  });
  assert.equal(promotion.outcome, 'PROMOTED');
  assert.equal(promotion.repositoryCode, 'SkyServer');
  assert.equal(promotion.pullRequestDirection, 'dev → main');
  assert.equal(promotion.synchronizationDirection, 'main → dev');
  assert.equal(promotion.approval.decision, 'APPROVED');
  assert.equal(promotion.stages.length, 7);
  assert.equal(promotion.preflight.readyForDevelopmentPromotion, true);
  assert.equal(promotion.preflight.condition.passed, true);
  assert.equal(promotion.preflight.condition.branchLabel, 'TRUE');
  assert.equal(promotion.branchesSynchronized, true);

  const blockedRepositoryStatus = gitRepositoryStatusResult();
  blockedRepositoryStatus.message = 'SkyServer is not ready for development promotion.';
  blockedRepositoryStatus.output.outcome = 'BLOCKED';
  blockedRepositoryStatus.output.readyForDevelopmentPromotion = false;
  blockedRepositoryStatus.output.blockers = ['Remote dev and main are not synchronized.'];
  blockedRepositoryStatus.output.relationship.remoteBranchesSynchronized = false;
  const blockedPromotion = buildGitPromotionRollup({
    repo_status_node: blockedRepositoryStatus,
    promotion_gate_node: promotionConditionResult({ passed: false }),
  });
  assert.equal(blockedPromotion.outcome, 'STOPPED');
  assert.equal(blockedPromotion.stages.length, 2);
  assert.equal(blockedPromotion.preflight.readyForDevelopmentPromotion, false);
  assert.equal(blockedPromotion.preflight.condition.passed, false);
  assert.equal(blockedPromotion.preflight.condition.branchLabel, 'FALSE');
  assert.equal(blockedPromotion.preflight.condition.branchTargetNodeKey, 'promotion_summary_node');

  const promotionStructured = buildStructuredResultRollup({
    repo_status_node: repositoryStatusResult,
    promotion_gate_node: promotionCondition,
    repo_map_node: mapResult,
    repo_zip_node: repositoryResult,
    dev_commit_node: commitResult,
    merge_approval_node: humanApprovalResult(),
    main_merge_node: branchSyncResult,
  });
  assert.equal(promotionStructured.outputTypes['git_repository_status.v1'], 1);
  assert.equal(promotionStructured.outputTypes['git_branch_sync_summary.v1'], 1);
  assert.equal(promotionStructured.gitPromotion.outcome, 'PROMOTED');

  const databaseSynchronization = buildDatabaseSynchronizationRollup({
    db_health_node: databaseHealthResult(),
    eval_db_health_node: databaseHealthConditionResult(),
    db_build_node: databaseBuildResult(),
    db_compare_node: databaseComparisonResult(),
  });
  assert.equal(databaseSynchronization.outcome, 'DIFFERENT');
  assert.equal(databaseSynchronization.validationPassed, false);
  assert.equal(databaseSynchronization.health.databases[0].online, true);
  assert.equal(databaseSynchronization.build.sqlFilesExecuted, 70);
  assert.equal(databaseSynchronization.build.migrationFilesDiscovered, 40);
  assert.equal(databaseSynchronization.build.seedFilesDiscovered, 30);
  assert.equal(
    databaseSynchronization.build.lastCompletedSqlFile,
    'packages/db_build/src/seeds/00070__db_build_structured_output_seed.sql',
  );
  assert.equal(databaseSynchronization.build.sqlRoots.length, 2);
  assert.equal(databaseSynchronization.comparison.totalDifferenceCount, 1);
  assert.equal(databaseSynchronization.comparison.byType[0].objectType, 'constraint');
  assert.equal(databaseSynchronization.stages.length, 4);

  const matchingDatabaseSynchronization = buildDatabaseSynchronizationRollup({
    db_health_node: databaseHealthResult(),
    eval_db_health_node: databaseHealthConditionResult(),
    db_build_node: databaseBuildResult(),
    db_compare_node: databaseComparisonResult({ match: true }),
  });
  assert.equal(matchingDatabaseSynchronization.outcome, 'MATCH');
  assert.equal(matchingDatabaseSynchronization.validationPassed, true);

  const databaseStructured = buildStructuredResultRollup({
    db_health_node: databaseHealthResult(),
    eval_db_health_node: databaseHealthConditionResult(),
    db_build_node: databaseBuildResult(),
    db_compare_node: databaseComparisonResult(),
  });
  assert.equal(databaseStructured.outputTypes['database_health_summary.v1'], 1);
  assert.equal(databaseStructured.outputTypes['database_build_summary.v1'], 1);
  assert.equal(
    databaseStructured.outputTypes['postgresql_database_comparison_summary.v1'],
    1,
  );
  assert.equal(databaseStructured.databaseSynchronization.outcome, 'DIFFERENT');

  console.log('[SkyCommand] Workflow result context self-test passed.');
}

run();
