const MACRO_INGESTION_OUTPUT_TYPE = 'macro_ingestion_summary.v1';
const REPOSITORY_PACKAGE_OUTPUT_TYPE = 'repository_package_summary.v1';
const REPOSITORY_MAP_OUTPUT_TYPE = 'repository_map_summary.v1';
const GIT_COMMIT_OUTPUT_TYPE = 'git_commit_summary.v1';
const GIT_BRANCH_SYNC_OUTPUT_TYPE = 'git_branch_sync_summary.v1';
const GIT_LOCAL_SYNC_OUTPUT_TYPE = 'git_local_sync_summary.v1';
const GIT_REPOSITORY_STATUS_OUTPUT_TYPE = 'git_repository_status.v1';
const DATABASE_HEALTH_OUTPUT_TYPE = 'database_health_summary.v1';
const DATABASE_BUILD_OUTPUT_TYPE = 'database_build_summary.v1';
const DATABASE_COMPARISON_OUTPUT_TYPE =
  'postgresql_database_comparison_summary.v1';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getSafeObject(value, fallback = {}) {
  return isPlainObject(value) ? value : fallback;
}

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJsonCompatible(value) {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return String(value);
  }
}

function isToolResultEnvelope(value) {
  return (
    isPlainObject(value) &&
    typeof value.schemaVersion === 'string' &&
    typeof value.success === 'boolean' &&
    typeof value.outputType === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'output')
  );
}

function getToolResultDomainOutput(value) {
  return isToolResultEnvelope(value) ? value.output : value;
}

function getResultSummary(result = {}, output = getToolResultDomainOutput(result)) {
  const safeResult = getSafeObject(result);
  const safeOutput = getSafeObject(output);

  return String(
    safeResult.summary || safeResult.message || safeOutput.summary || safeOutput.message || '',
  ).trim();
}

function getResultStatus(result = {}, output = getToolResultDomainOutput(result)) {
  const safeResult = getSafeObject(result);
  const safeOutput = getSafeObject(output);

  return String(
    safeResult.status ||
      safeOutput.status ||
      safeOutput.outcome ||
      (safeResult.success === false ? 'FAILED' : safeResult.success === true ? 'SUCCESS' : ''),
  )
    .trim()
    .toUpperCase();
}

function getResultDurationMs(result = {}, output = getToolResultDomainOutput(result)) {
  const safeResult = getSafeObject(result);
  const safeOutput = getSafeObject(output);
  const candidates = [safeResult.durationMs, safeOutput.durationMs];

  for (const candidate of candidates) {
    const parsed = Number(candidate);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function isPromotionReadinessConditionOutput(value = {}) {
  const output = getSafeObject(value);
  const leftPath = String(output.leftPath || '').trim();

  return (
    output.kind === 'condition_evaluation' &&
    (leftPath === 'nodes.repo_status_node.output.readyForDevelopmentPromotion' ||
      leftPath.endsWith('.output.readyForDevelopmentPromotion'))
  );
}

function buildCanonicalNodeResultView({ nodeKey = '', rawResult = {}, existingNode = {} } = {}) {
  const result = getSafeObject(rawResult);
  const output = cloneJsonCompatible(getToolResultDomainOutput(result));
  const outputObject = getSafeObject(output);
  const safeExistingNode = getSafeObject(existingNode);
  const summary = getResultSummary(result, output);
  const status = getResultStatus(result, output);
  const durationMs = safeExistingNode.durationMs ?? getResultDurationMs(result, output);

  return {
    ...outputObject,
    ...safeExistingNode,
    nodeKey: nodeKey || safeExistingNode.nodeKey || null,
    result,
    output,
    warnings: isToolResultEnvelope(result)
      ? getSafeArray(result.warnings)
      : getSafeArray(safeExistingNode.warnings),
    error: isToolResultEnvelope(result) ? result.error || null : safeExistingNode.error || null,
    metadata: isToolResultEnvelope(result)
      ? getSafeObject(result.metadata)
      : getSafeObject(safeExistingNode.metadata),
    summary,
    nodeStatus: safeExistingNode.status || null,
    runStatus: safeExistingNode.status || null,
    outputStatus: status || null,
    outputSummary: summary,
    durationMs,
  };
}

function buildConditionNodeLookup(runtimeNodes = {}, nodeOutputsByKey = {}) {
  const lookup = { ...getSafeObject(runtimeNodes) };

  for (const [rawNodeKey, rawOutput] of Object.entries(getSafeObject(nodeOutputsByKey))) {
    const nodeKey = String(rawNodeKey || '').trim();
    const normalizedNodeKey =
      nodeKey.replace(/[^A-Za-z0-9_.:-]+/g, '_').replace(/^_+|_+$/g, '') || 'node';
    const existingNode = getSafeObject(lookup[nodeKey] || lookup[normalizedNodeKey]);
    const value = buildCanonicalNodeResultView({
      nodeKey,
      rawResult: rawOutput,
      existingNode,
    });

    if (nodeKey) {
      lookup[nodeKey] = value;
    }

    lookup[normalizedNodeKey] = value;
  }

  return lookup;
}

function normalizeNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeMacroTotals(value = {}) {
  const totals = getSafeObject(value);

  return {
    indicatorsRequested: normalizeNonNegativeNumber(totals.indicatorsRequested),
    indicatorsSucceeded: normalizeNonNegativeNumber(totals.indicatorsSucceeded),
    indicatorsFailed: normalizeNonNegativeNumber(totals.indicatorsFailed),
    indicatorsUpdated: normalizeNonNegativeNumber(totals.indicatorsUpdated),
    indicatorsUnchanged: normalizeNonNegativeNumber(totals.indicatorsUnchanged),
    rowsStaged: normalizeNonNegativeNumber(totals.rowsStaged),
    rowsDetectedAsNew: normalizeNonNegativeNumber(totals.rowsDetectedAsNew),
    rowsInserted: normalizeNonNegativeNumber(totals.rowsInserted),
    rowsUpdated: normalizeNonNegativeNumber(totals.rowsUpdated),
  };
}

function getMacroOutcome({ totals = {}, sourceOutcomes = [] } = {}) {
  const normalizedTotals = normalizeMacroTotals(totals);
  const outcomes = sourceOutcomes
    .map((value) =>
      String(value || '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  const failedSourceCount = outcomes.filter((value) => value === 'FAILED').length;
  const partialSourceCount = outcomes.filter((value) => value === 'PARTIAL').length;

  if (normalizedTotals.indicatorsFailed > 0 || failedSourceCount > 0 || partialSourceCount > 0) {
    const succeeded = normalizedTotals.indicatorsSucceeded;
    return succeeded > 0 || failedSourceCount < outcomes.length ? 'PARTIAL' : 'FAILED';
  }

  if (
    normalizedTotals.rowsInserted > 0 ||
    normalizedTotals.rowsUpdated > 0 ||
    normalizedTotals.indicatorsUpdated > 0
  ) {
    return 'UPDATED';
  }

  return outcomes.length > 0 ? 'UNCHANGED' : 'UNKNOWN';
}

function buildMacroIngestionSourceSummary(nodeKey, result) {
  if (!isToolResultEnvelope(result) || result.outputType !== MACRO_INGESTION_OUTPUT_TYPE) {
    return null;
  }

  const output = getSafeObject(result.output);
  const totals = normalizeMacroTotals(output.totals);

  return {
    nodeKey,
    toolCode: result.toolCode || result.metadata?.toolCode || null,
    sourceCode: String(output.sourceCode || result.toolCode || nodeKey || 'MACRO').trim(),
    outputType: result.outputType,
    status: getResultStatus(result, output),
    outcome: String(output.outcome || getResultStatus(result, output) || 'UNKNOWN')
      .trim()
      .toUpperCase(),
    success: result.success !== false,
    message: getResultSummary(result, output),
    selectedIndicators: Boolean(output.selectedIndicators),
    durationMs: getResultDurationMs(result, output),
    totals,
    warnings: getSafeArray(result.warnings),
    error: result.error || null,
  };
}

function buildMacroIngestionRollup(nodeOutputsByKey = {}) {
  const sources = Object.entries(getSafeObject(nodeOutputsByKey))
    .map(([nodeKey, rawResult]) =>
      buildMacroIngestionSourceSummary(nodeKey, getSafeObject(rawResult)),
    )
    .filter(Boolean);

  if (sources.length === 0) {
    return null;
  }

  const totals = sources.reduce((accumulator, source) => {
    for (const [key, value] of Object.entries(source.totals)) {
      accumulator[key] += normalizeNonNegativeNumber(value);
    }
    return accumulator;
  }, normalizeMacroTotals());

  const durationMs = sources.reduce(
    (sum, source) => sum + normalizeNonNegativeNumber(source.durationMs),
    0,
  );
  const warnings = sources.flatMap((source) =>
    source.warnings.map((warning) => ({
      nodeKey: source.nodeKey,
      sourceCode: source.sourceCode,
      message: String(warning),
    })),
  );
  const errors = sources
    .filter((source) => source.error)
    .map((source) => ({
      nodeKey: source.nodeKey,
      sourceCode: source.sourceCode,
      ...getSafeObject(source.error, { message: String(source.error) }),
    }));

  return {
    outputType: MACRO_INGESTION_OUTPUT_TYPE,
    outcome: getMacroOutcome({
      totals,
      sourceOutcomes: sources.map((source) => source.outcome),
    }),
    sourceCount: sources.length,
    durationMs,
    totals,
    sources,
    warnings,
    errors,
  };
}

function compactDomainOutput(result = {}) {
  const output = getToolResultDomainOutput(result);
  const safeOutput = getSafeObject(output);

  if (isToolResultEnvelope(result) && result.outputType === MACRO_INGESTION_OUTPUT_TYPE) {
    return {
      sourceCode: safeOutput.sourceCode || null,
      outcome: safeOutput.outcome || null,
      selectedIndicators: Boolean(safeOutput.selectedIndicators),
      durationMs: getResultDurationMs(result, safeOutput),
      totals: normalizeMacroTotals(safeOutput.totals),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === REPOSITORY_PACKAGE_OUTPUT_TYPE) {
    return {
      outcome: safeOutput.outcome || null,
      repositoryName: safeOutput.repositoryName || null,
      fileName: safeOutput.fileName || null,
      artifactPath: safeOutput.artifactPath || null,
      filesIncluded: normalizeNonNegativeNumber(safeOutput.filesIncluded),
      archiveBytes: normalizeNonNegativeNumber(safeOutput.archiveBytes),
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === REPOSITORY_MAP_OUTPUT_TYPE) {
    return {
      outcome: safeOutput.outcome || null,
      repositoryName: safeOutput.repositoryName || null,
      fileName: safeOutput.fileName || null,
      artifactPath: safeOutput.artifactPath || null,
      directoriesDocumented: normalizeNonNegativeNumber(safeOutput.directoriesDocumented),
      filesDocumented: normalizeNonNegativeNumber(safeOutput.filesDocumented),
      outputBytes: normalizeNonNegativeNumber(safeOutput.outputBytes),
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === GIT_REPOSITORY_STATUS_OUTPUT_TYPE) {
    const workingTree = getSafeObject(safeOutput.workingTree);
    const relationship = getSafeObject(safeOutput.relationship);

    return {
      outcome: safeOutput.outcome || null,
      repositoryCode: safeOutput.repositoryCode || null,
      currentBranch: safeOutput.currentBranch || null,
      expectedBranch: safeOutput.expectedBranch || null,
      readyForDevelopmentPromotion: Boolean(safeOutput.readyForDevelopmentPromotion),
      blockerCount: getSafeArray(safeOutput.blockers).length,
      totalChanges: normalizeNonNegativeNumber(workingTree.totalChanges),
      remoteBranchesSynchronized: Boolean(relationship.remoteBranchesSynchronized),
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === GIT_COMMIT_OUTPUT_TYPE) {
    return {
      outcome: safeOutput.outcome || null,
      repositoryCode: safeOutput.repositoryCode || null,
      branch: safeOutput.branch || null,
      commitSha: safeOutput.commitSha || safeOutput.currentHeadSha || null,
      changedFiles: normalizeNonNegativeNumber(safeOutput.changedFiles),
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === GIT_BRANCH_SYNC_OUTPUT_TYPE) {
    return {
      outcome: safeOutput.outcome || null,
      repositoryCode: safeOutput.repositoryCode || null,
      sourceBranch: safeOutput.sourceBranch || safeOutput.mainBranch || null,
      targetBranch: safeOutput.targetBranch || safeOutput.devBranch || null,
      synchronizedHeadSha: safeOutput.synchronizedHeadSha || safeOutput.devHeadAfterSha || null,
      commitsApplied: normalizeNonNegativeNumber(safeOutput.commitsApplied),
      branchesSynchronized: Boolean(safeOutput.branchesSynchronized),
      tagName: safeOutput.tagName || null,
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === GIT_LOCAL_SYNC_OUTPUT_TYPE) {
    return {
      outcome: safeOutput.outcome || null,
      repositoryCode: safeOutput.repositoryCode || null,
      expectedLocalDevSha: safeOutput.expectedLocalDevSha || null,
      expectedSynchronizedHeadSha: safeOutput.expectedSynchronizedHeadSha || null,
      fourWaySynchronized: Boolean(safeOutput.fourWaySynchronized),
      workingTreeCleanAfter: Boolean(safeOutput.workingTreeCleanAfter),
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === DATABASE_HEALTH_OUTPUT_TYPE) {
    return {
      checkedAt: safeOutput.checkedAt || null,
      allOnline: Boolean(safeOutput.allOnline),
      requestedCount: normalizeNonNegativeNumber(safeOutput.requestedCount),
      onlineCount: normalizeNonNegativeNumber(safeOutput.onlineCount),
      offlineCount: normalizeNonNegativeNumber(safeOutput.offlineCount),
      primaryDatabase: safeOutput.databases?.[0]?.databaseName || null,
      primaryOnline: Boolean(safeOutput.databases?.[0]?.online),
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === DATABASE_BUILD_OUTPUT_TYPE) {
    return {
      targetDatabase: safeOutput.targetDatabase || null,
      status: safeOutput.status || null,
      phase: safeOutput.phase || null,
      buildCompleted: Boolean(safeOutput.buildCompleted),
      databaseCreated: Boolean(safeOutput.databaseCreated),
      sqlFilesDiscovered: normalizeNonNegativeNumber(safeOutput.sqlFilesDiscovered),
      sqlFilesExecuted: normalizeNonNegativeNumber(safeOutput.sqlFilesExecuted),
      migrationFilesExecuted: normalizeNonNegativeNumber(safeOutput.migrationFilesExecuted),
      seedFilesExecuted: normalizeNonNegativeNumber(safeOutput.seedFilesExecuted),
      failedSqlFile: safeOutput.failedSqlFile || null,
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isToolResultEnvelope(result) && result.outputType === DATABASE_COMPARISON_OUTPUT_TYPE) {
    return {
      comparedAt: safeOutput.comparedAt || null,
      status: safeOutput.status || null,
      comparisonCompleted: Boolean(safeOutput.comparisonCompleted),
      databasesOnline: Boolean(safeOutput.databasesOnline),
      databasesMatch: Boolean(safeOutput.databasesMatch),
      databaseA: safeOutput.databaseA || null,
      databaseB: safeOutput.databaseB || null,
      databaseAObjectCount: normalizeNonNegativeNumber(safeOutput.databaseAObjectCount),
      databaseBObjectCount: normalizeNonNegativeNumber(safeOutput.databaseBObjectCount),
      matchedObjectCount: normalizeNonNegativeNumber(safeOutput.matchedObjectCount),
      onlyInDatabaseACount: normalizeNonNegativeNumber(safeOutput.onlyInDatabaseACount),
      onlyInDatabaseBCount: normalizeNonNegativeNumber(safeOutput.onlyInDatabaseBCount),
      definitionMismatchCount: normalizeNonNegativeNumber(safeOutput.definitionMismatchCount),
      totalDifferenceCount: normalizeNonNegativeNumber(safeOutput.totalDifferenceCount),
      differenceDetailsReturned: normalizeNonNegativeNumber(safeOutput.differenceDetailsReturned),
      differenceDetailsTruncated: Boolean(safeOutput.differenceDetailsTruncated),
      differingObjectTypeCount: getSafeArray(safeOutput.byType).filter(
        (item) =>
          normalizeNonNegativeNumber(item?.onlyInDatabaseA) > 0 ||
          normalizeNonNegativeNumber(item?.onlyInDatabaseB) > 0 ||
          normalizeNonNegativeNumber(item?.definitionMismatches) > 0,
      ).length,
      durationMs: getResultDurationMs(result, safeOutput),
    };
  }

  if (isPromotionReadinessConditionOutput(output)) {
    return {
      passed: Boolean(output.passed),
      status: output.status || null,
      branchLabel: output.branchLabel || output.route || null,
      branchTargetNodeKey: output.branchTargetNodeKey || null,
      branchTaken: Boolean(output.branchTaken),
      leftPath: output.leftPath || null,
      leftPathResolved: Boolean(output.leftPathResolved),
      leftPathUsedFallback: Boolean(output.leftPathUsedFallback),
      leftValue: cloneJsonCompatible(output.leftValue),
      operator: output.operator || null,
      rightValue: cloneJsonCompatible(output.rightValue),
      onFalse: output.onFalse || null,
      summary: output.summary || output.reason || null,
    };
  }

  if (!isPlainObject(output)) {
    return cloneJsonCompatible(output);
  }

  const compact = {};
  const entries = Object.entries(output).slice(0, 20);

  for (const [key, value] of entries) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      compact[key] = cloneJsonCompatible(value);
    } else if (Array.isArray(value)) {
      compact[key] = { count: value.length };
    } else if (isPlainObject(value)) {
      const scalarEntries = Object.entries(value)
        .filter(
          ([, nestedValue]) =>
            nestedValue === null || ['string', 'number', 'boolean'].includes(typeof nestedValue),
        )
        .slice(0, 12);
      compact[key] =
        scalarEntries.length > 0
          ? Object.fromEntries(
              scalarEntries.map(([nestedKey, nestedValue]) => [
                nestedKey,
                cloneJsonCompatible(nestedValue),
              ]),
            )
          : { fieldCount: Object.keys(value).length };
    }
  }

  return compact;
}

function buildSummaryKeyOutputs(nodeOutputsByKey = {}) {
  return Object.entries(getSafeObject(nodeOutputsByKey)).reduce(
    (accumulator, [nodeKey, rawResult]) => {
      const result = getSafeObject(rawResult);
      const output = getSafeObject(getToolResultDomainOutput(result));

      if (result.kind === 'workflow_run_summary' || output.kind === 'workflow_run_summary') {
        return accumulator;
      }

      accumulator[nodeKey] = {
        nodeKey,
        kind: result.kind || output.kind || 'node_output',
        toolCode: result.toolCode || null,
        status: getResultStatus(result, output) || null,
        success: isToolResultEnvelope(result) ? result.success : null,
        summary: getResultSummary(result, output),
        outputType: isToolResultEnvelope(result) ? result.outputType : null,
        output: compactDomainOutput(result),
        warningCount: isToolResultEnvelope(result) ? getSafeArray(result.warnings).length : 0,
        error: isToolResultEnvelope(result) ? result.error || null : null,
        executionId: result.executionId || null,
        durationMs: getResultDurationMs(result, output),
      };

      return accumulator;
    },
    {},
  );
}

function buildGitPromotionRollup(nodeOutputsByKey = {}) {
  const stages = [];
  let repositoryStatus = null;
  let repositoryMap = null;
  let repositoryPackage = null;
  let preflightCondition = null;
  let gitCommit = null;
  let approval = null;
  let branchSync = null;
  let localSync = null;

  for (const [nodeKey, rawResult] of Object.entries(getSafeObject(nodeOutputsByKey))) {
    const result = getSafeObject(rawResult);
    const output = getSafeObject(getToolResultDomainOutput(result));
    const durationMs = getResultDurationMs(result, output);

    if (isToolResultEnvelope(result) && result.outputType === GIT_REPOSITORY_STATUS_OUTPUT_TYPE) {
      repositoryStatus = { nodeKey, result, output };
      const ready = Boolean(output.readyForDevelopmentPromotion);
      const blockerCount = getSafeArray(output.blockers).length;
      stages.push({
        nodeKey,
        stageCode: 'REPOSITORY_PREFLIGHT',
        label: 'Repository preflight',
        status: result.success === false ? 'FAILED' : ready ? 'SUCCESS' : 'STOPPED',
        outcome: output.outcome || null,
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: ready
          ? `${normalizeNonNegativeNumber(output.workingTree?.totalChanges)} working-tree change(s); baseline synchronized`
          : `${blockerCount} promotion blocker(s)`,
      });
      continue;
    }

    if (isToolResultEnvelope(result) && result.outputType === REPOSITORY_MAP_OUTPUT_TYPE) {
      repositoryMap = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'REPOSITORY_MAP',
        label: 'Repository map',
        status: result.success === false ? 'FAILED' : 'SUCCESS',
        outcome: output.outcome || null,
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: `${normalizeNonNegativeNumber(output.filesDocumented)} file(s) documented`,
      });
      continue;
    }

    if (isToolResultEnvelope(result) && result.outputType === REPOSITORY_PACKAGE_OUTPUT_TYPE) {
      repositoryPackage = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'REPOSITORY_PACKAGE',
        label: 'Repository package',
        status: result.success === false ? 'FAILED' : 'SUCCESS',
        outcome: output.outcome || null,
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: `${normalizeNonNegativeNumber(output.filesIncluded)} file(s) packaged`,
      });
      continue;
    }

    if (isPromotionReadinessConditionOutput(output)) {
      preflightCondition = { nodeKey, output };
      const passed = Boolean(output.passed);
      const onFalse = String(output.onFalse || 'STOP_SUCCESS').trim().toUpperCase();
      const stageStatus = passed
        ? 'SUCCESS'
        : onFalse === 'FAIL_WORKFLOW'
          ? 'FAILED'
          : onFalse === 'CONTINUE'
            ? 'WARNING'
            : 'STOPPED';

      stages.push({
        nodeKey,
        stageCode: 'REPOSITORY_PREFLIGHT_CONDITION',
        label: 'Promotion readiness condition',
        status: stageStatus,
        outcome: passed ? 'PASSED' : 'FAILED',
        summary: output.summary || output.reason || '',
        outputType: 'condition_evaluation',
        durationMs,
        evidence: `${output.leftPath || 'promotion readiness'} = ${String(output.leftValue)}`,
      });
      continue;
    }

    if (isToolResultEnvelope(result) && result.outputType === GIT_COMMIT_OUTPUT_TYPE) {
      gitCommit = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'DEV_COMMIT',
        label: 'Development commit',
        status: result.success === false ? 'FAILED' : 'SUCCESS',
        outcome: output.outcome || null,
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: output.commitSha || output.currentHeadSha || `${normalizeNonNegativeNumber(output.changedFiles)} change(s)`,
      });
      continue;
    }

    if (output.kind === 'human_approval') {
      approval = { nodeKey, output };
      const decision = String(output.decision || output.status || 'UNKNOWN').toUpperCase();
      stages.push({
        nodeKey,
        stageCode: 'MERGE_APPROVAL',
        label: output.approvalTitle || 'Merge approval',
        status: decision === 'APPROVED' ? 'SUCCESS' : decision === 'REJECTED' ? 'STOPPED' : 'FAILED',
        outcome: decision,
        summary: output.summary || '',
        outputType: 'human_approval',
        durationMs,
        evidence: output.decidedByDisplayName || output.requiredRoleCode || 'Human decision',
      });
      continue;
    }

    if (isToolResultEnvelope(result) && result.outputType === GIT_BRANCH_SYNC_OUTPUT_TYPE) {
      branchSync = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'BRANCH_SYNC',
        label: 'Remote main/development synchronization',
        status: result.success === false ? 'FAILED' : 'SUCCESS',
        outcome: output.outcome || null,
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: output.synchronizedHeadSha || output.devHeadAfterSha || `${normalizeNonNegativeNumber(output.commitsApplied)} commit(s) applied`,
      });
      continue;
    }

    if (isToolResultEnvelope(result) && result.outputType === GIT_LOCAL_SYNC_OUTPUT_TYPE) {
      localSync = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'LOCAL_REPOSITORY_SYNC',
        label: 'Host local repository synchronization',
        status: result.success === false ? 'FAILED' : output.fourWaySynchronized ? 'SUCCESS' : 'WARNING',
        outcome: output.outcome || null,
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: output.fourWaySynchronized
          ? output.expectedSynchronizedHeadSha || 'Four-way synchronization verified'
          : 'Four-way synchronization not verified',
      });
    }
  }

  if (!preflightCondition && !gitCommit && !branchSync && !localSync) {
    return null;
  }

  const failed = stages.some((stage) => stage.status === 'FAILED');
  const stopped = stages.some((stage) => stage.status === 'STOPPED');
  const commitOutput = getSafeObject(gitCommit?.output);
  const syncOutput = getSafeObject(branchSync?.output);
  const localSyncOutput = getSafeObject(localSync?.output);
  const approvalOutput = getSafeObject(approval?.output);
  const repositoryStatusOutput = getSafeObject(repositoryStatus?.output);
  const preflightConditionOutput = getSafeObject(preflightCondition?.output);
  const repositoryCode =
    localSyncOutput.repositoryCode ||
    syncOutput.repositoryCode ||
    commitOutput.repositoryCode ||
    repositoryStatusOutput.repositoryCode ||
    repositoryMap?.output?.repositoryName ||
    repositoryPackage?.output?.repositoryName ||
    null;
  const repositoryName =
    localSyncOutput.repositoryName ||
    syncOutput.repositoryName ||
    commitOutput.repositoryName ||
    repositoryStatusOutput.repositoryName ||
    repositoryMap?.output?.repositoryName ||
    repositoryPackage?.output?.repositoryName ||
    repositoryCode;
  const developmentBranch = commitOutput.branch || syncOutput.targetBranch || syncOutput.devBranch || null;
  const mainBranch = syncOutput.sourceBranch || syncOutput.mainBranch || null;
  const devCommitSha = commitOutput.currentHeadSha || commitOutput.commitSha || null;
  const synchronizedHeadSha = syncOutput.synchronizedHeadSha || syncOutput.devHeadAfterSha || null;
  const localSyncCommand =
    syncOutput.localHostSyncRequired && repositoryCode && devCommitSha && synchronizedHeadSha
      ? `npm run repository:sync:local -- "${String(repositoryCode).replace(/"/g, '\\"')}" "${devCommitSha}" "${synchronizedHeadSha}"`
      : null;
  const outcome = failed
    ? 'FAILED'
    : stopped
      ? 'STOPPED'
      : branchSync
        ? localSync
          ? localSyncOutput.fourWaySynchronized
            ? 'PROMOTED'
            : 'REMOTE_PROMOTED'
          : syncOutput.localHostSyncRequired
            ? 'REMOTE_PROMOTED'
            : 'PROMOTED'
        : approvalOutput.decision === 'APPROVED'
          ? 'APPROVED'
          : gitCommit
            ? 'COMMITTED'
            : preflightConditionOutput.passed
              ? 'READY'
              : 'STOPPED';

  return {
    outcome,
    repositoryCode,
    repositoryName,
    developmentBranch,
    mainBranch,
    pullRequestDirection:
      developmentBranch && mainBranch ? `${developmentBranch} → ${mainBranch}` : null,
    synchronizationDirection:
      mainBranch && developmentBranch ? `${mainBranch} → ${developmentBranch}` : null,
    devCommitSha,
    synchronizedHeadSha,
    changedFiles: normalizeNonNegativeNumber(commitOutput.changedFiles),
    commitsApplied: normalizeNonNegativeNumber(syncOutput.commitsApplied),
    branchesSynchronized: Boolean(syncOutput.branchesSynchronized),
    executionStrategy: syncOutput.executionStrategy || null,
    watcherSafe: syncOutput.watcherSafe !== false,
    localWorkspaceUpdated: Boolean(syncOutput.localWorkspaceUpdated),
    localWorkspaceRefreshRequired: Boolean(syncOutput.localWorkspaceRefreshRequired),
    localRefreshCommand: syncOutput.localRefreshCommand || null,
    localHostSyncRequired: Boolean(syncOutput.localHostSyncRequired) && !Boolean(localSyncOutput.fourWaySynchronized),
    deferredLocalBranches: getSafeArray(syncOutput.deferredLocalBranches).map(String),
    localSyncCommandTemplate: syncOutput.localSyncCommandTemplate || null,
    localSyncCommand,
    localSyncInputs:
      syncOutput.localHostSyncRequired && repositoryCode && devCommitSha && synchronizedHeadSha
        ? {
            repoName: repositoryCode,
            expectedLocalDevSha: devCommitSha,
            expectedSynchronizedHeadSha: synchronizedHeadSha,
          }
        : null,
    localSyncCompleted: Boolean(localSyncOutput.fourWaySynchronized),
    localSync: localSync
      ? {
          nodeKey: localSync.nodeKey,
          outcome: localSyncOutput.outcome || null,
          expectedLocalDevSha: localSyncOutput.expectedLocalDevSha || null,
          expectedSynchronizedHeadSha: localSyncOutput.expectedSynchronizedHeadSha || null,
          localMainAfterSha: localSyncOutput.localMainAfterSha || null,
          localDevAfterSha: localSyncOutput.localDevAfterSha || null,
          remoteMainAfterSha: localSyncOutput.remoteMainAfterSha || null,
          remoteDevAfterSha: localSyncOutput.remoteDevAfterSha || null,
          fourWaySynchronized: Boolean(localSyncOutput.fourWaySynchronized),
        }
      : null,
    tagName: syncOutput.tagName || null,
    tagCreated: Boolean(syncOutput.tagCreated),
    preflight: repositoryStatus
      ? {
          nodeKey: repositoryStatus.nodeKey,
          outcome: repositoryStatusOutput.outcome || null,
          readyForDevelopmentPromotion: Boolean(
            repositoryStatusOutput.readyForDevelopmentPromotion,
          ),
          currentBranch: repositoryStatusOutput.currentBranch || null,
          expectedBranch: repositoryStatusOutput.expectedBranch || null,
          blockerCount: getSafeArray(repositoryStatusOutput.blockers).length,
          workingTreeChanges: normalizeNonNegativeNumber(
            repositoryStatusOutput.workingTree?.totalChanges,
          ),
          remoteBranchesSynchronized: Boolean(
            repositoryStatusOutput.relationship?.remoteBranchesSynchronized,
          ),
          condition: preflightCondition
            ? {
                nodeKey: preflightCondition.nodeKey,
                passed: Boolean(preflightConditionOutput.passed),
                status: preflightConditionOutput.status || null,
                branchLabel:
                  preflightConditionOutput.branchLabel || preflightConditionOutput.route || null,
                branchTargetNodeKey: preflightConditionOutput.branchTargetNodeKey || null,
                leftPath: preflightConditionOutput.leftPath || null,
                leftValue: cloneJsonCompatible(preflightConditionOutput.leftValue),
                operator: preflightConditionOutput.operator || null,
                rightValue: cloneJsonCompatible(preflightConditionOutput.rightValue),
                onFalse: preflightConditionOutput.onFalse || null,
                summary:
                  preflightConditionOutput.summary || preflightConditionOutput.reason || null,
              }
            : null,
        }
      : preflightCondition
        ? {
            nodeKey: null,
            outcome: preflightConditionOutput.passed ? 'READY' : 'BLOCKED',
            readyForDevelopmentPromotion: Boolean(preflightConditionOutput.passed),
            currentBranch: null,
            expectedBranch: null,
            blockerCount: preflightConditionOutput.passed ? 0 : 1,
            workingTreeChanges: 0,
            remoteBranchesSynchronized: false,
            condition: {
              nodeKey: preflightCondition.nodeKey,
              passed: Boolean(preflightConditionOutput.passed),
              status: preflightConditionOutput.status || null,
              branchLabel:
                preflightConditionOutput.branchLabel || preflightConditionOutput.route || null,
              branchTargetNodeKey: preflightConditionOutput.branchTargetNodeKey || null,
              leftPath: preflightConditionOutput.leftPath || null,
              leftValue: cloneJsonCompatible(preflightConditionOutput.leftValue),
              operator: preflightConditionOutput.operator || null,
              rightValue: cloneJsonCompatible(preflightConditionOutput.rightValue),
              onFalse: preflightConditionOutput.onFalse || null,
              summary: preflightConditionOutput.summary || preflightConditionOutput.reason || null,
            },
          }
        : null,
    approval: approval
      ? {
          nodeKey: approval.nodeKey,
          decision: approvalOutput.decision || approvalOutput.status || null,
          action: approvalOutput.action || null,
          title: approvalOutput.approvalTitle || null,
          requiredRoleCode: approvalOutput.requiredRoleCode || null,
          decidedByDisplayName: approvalOutput.decidedByDisplayName || null,
          decidedAt: approvalOutput.decidedAt || null,
          decisionNote: approvalOutput.decisionNote || null,
        }
      : null,
    artifacts: {
      repositoryMap: repositoryMap
        ? {
            nodeKey: repositoryMap.nodeKey,
            fileName: repositoryMap.output.fileName || null,
            artifactPath: repositoryMap.output.artifactPath || null,
            filesDocumented: normalizeNonNegativeNumber(repositoryMap.output.filesDocumented),
          }
        : null,
      repositoryPackage: repositoryPackage
        ? {
            nodeKey: repositoryPackage.nodeKey,
            fileName: repositoryPackage.output.fileName || null,
            artifactPath: repositoryPackage.output.artifactPath || null,
            filesIncluded: normalizeNonNegativeNumber(repositoryPackage.output.filesIncluded),
            archiveBytes: normalizeNonNegativeNumber(repositoryPackage.output.archiveBytes),
          }
        : null,
    },
    durationMs: stages.reduce(
      (sum, stage) => sum + normalizeNonNegativeNumber(stage.durationMs),
      0,
    ),
    stages,
  };
}


function isDatabaseHealthConditionOutput(value = {}) {
  const output = getSafeObject(value);
  const leftPath = String(output.leftPath || '').trim();

  return (
    output.kind === 'condition_evaluation' &&
    leftPath.includes('.output.databases') &&
    leftPath.endsWith('.online')
  );
}

function buildDatabaseSynchronizationRollup(nodeOutputsByKey = {}) {
  const stages = [];
  let health = null;
  let healthCondition = null;
  let build = null;
  let comparison = null;

  for (const [nodeKey, rawResult] of Object.entries(getSafeObject(nodeOutputsByKey))) {
    const result = getSafeObject(rawResult);
    const output = getSafeObject(getToolResultDomainOutput(result));
    const durationMs = getResultDurationMs(result, output);

    if (isToolResultEnvelope(result) && result.outputType === DATABASE_HEALTH_OUTPUT_TYPE) {
      health = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'DATABASE_HEALTH',
        label: 'Database health',
        status: result.success === false ? 'FAILED' : 'SUCCESS',
        outcome: output.allOnline ? 'ONLINE' : 'PARTIAL',
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: `${normalizeNonNegativeNumber(output.onlineCount)} of ${normalizeNonNegativeNumber(output.requestedCount)} database(s) online`,
      });
      continue;
    }

    if (isDatabaseHealthConditionOutput(output)) {
      healthCondition = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'PRIMARY_DATABASE_GATE',
        label: 'Primary database gate',
        status: output.passed ? 'SUCCESS' : 'STOPPED',
        outcome: output.passed ? 'PASSED' : 'BLOCKED',
        summary: output.summary || output.reason || getResultSummary(result, output),
        outputType: null,
        durationMs,
        evidence: `${output.leftPath || 'database health path'} = ${String(output.leftValue)}`,
      });
      continue;
    }

    if (isToolResultEnvelope(result) && result.outputType === DATABASE_BUILD_OUTPUT_TYPE) {
      build = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'DATABASE_BUILD',
        label: 'Database build',
        status: result.success === false || !output.buildCompleted ? 'FAILED' : 'SUCCESS',
        outcome: output.status || (output.buildCompleted ? 'BUILT' : 'FAILED'),
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: output.buildCompleted
          ? `${normalizeNonNegativeNumber(output.sqlFilesExecuted)} ordered SQL file(s) applied`
          : output.failedSqlFile || output.phase || 'Build incomplete',
      });
      continue;
    }

    if (isToolResultEnvelope(result) && result.outputType === DATABASE_COMPARISON_OUTPUT_TYPE) {
      comparison = { nodeKey, result, output };
      stages.push({
        nodeKey,
        stageCode: 'DATABASE_COMPARISON',
        label: 'Database object comparison',
        status: result.success === false || !output.comparisonCompleted ? 'FAILED' : 'SUCCESS',
        outcome: output.status || (output.databasesMatch ? 'MATCH' : 'DIFFERENT'),
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: output.comparisonCompleted
          ? `${normalizeNonNegativeNumber(output.matchedObjectCount)} matched; ${normalizeNonNegativeNumber(output.totalDifferenceCount)} difference(s)`
          : 'Comparison incomplete',
      });
    }
  }

  if (!health && !build && !comparison) {
    return null;
  }

  const healthOutput = getSafeObject(health?.output);
  const conditionOutput = getSafeObject(healthCondition?.output);
  const buildOutput = getSafeObject(build?.output);
  const comparisonOutput = getSafeObject(comparison?.output);
  const stageFailed = stages.some((stage) => stage.status === 'FAILED');
  const conditionBlocked = healthCondition && !conditionOutput.passed;
  const comparisonComplete = Boolean(comparisonOutput.comparisonCompleted);
  const databasesMatch = Boolean(comparisonOutput.databasesMatch);
  const outcome = stageFailed
    ? 'FAILED'
    : conditionBlocked
      ? 'BLOCKED'
      : comparisonComplete
        ? databasesMatch
          ? 'MATCH'
          : 'DIFFERENT'
        : buildOutput.buildCompleted
          ? 'BUILT'
          : 'INCOMPLETE';
  const comparisonDifferences = getSafeArray(comparisonOutput.differences);
  const summaryDifferences = comparisonDifferences.slice(0, 100);

  return {
    outcome,
    validationPassed: outcome === 'MATCH',
    health: health
      ? {
          nodeKey: health.nodeKey,
          checkedAt: healthOutput.checkedAt || null,
          allOnline: Boolean(healthOutput.allOnline),
          requestedCount: normalizeNonNegativeNumber(healthOutput.requestedCount),
          onlineCount: normalizeNonNegativeNumber(healthOutput.onlineCount),
          offlineCount: normalizeNonNegativeNumber(healthOutput.offlineCount),
          databases: getSafeArray(healthOutput.databases).map((database) => ({
            databaseName: database?.databaseName || null,
            online: Boolean(database?.online),
            latencyMs: normalizeNonNegativeNumber(database?.latencyMs),
            serverVersion: database?.serverVersion || null,
            errorCode: database?.errorCode || null,
            errorMessage: database?.errorMessage || null,
          })),
          durationMs: getResultDurationMs(health.result, healthOutput),
        }
      : null,
    condition: healthCondition
      ? {
          nodeKey: healthCondition.nodeKey,
          passed: Boolean(conditionOutput.passed),
          branchLabel: conditionOutput.branchLabel || conditionOutput.route || null,
          branchTargetNodeKey: conditionOutput.branchTargetNodeKey || null,
          leftPath: conditionOutput.leftPath || null,
          leftValue: cloneJsonCompatible(conditionOutput.leftValue),
          operator: conditionOutput.operator || null,
          onFalse: conditionOutput.onFalse || null,
          summary: conditionOutput.summary || conditionOutput.reason || null,
        }
      : null,
    build: build
      ? {
          nodeKey: build.nodeKey,
          targetDatabase: buildOutput.targetDatabase || null,
          status: buildOutput.status || null,
          phase: buildOutput.phase || null,
          buildCompleted: Boolean(buildOutput.buildCompleted),
          databaseDropped: Boolean(buildOutput.databaseDropped),
          databaseCreated: Boolean(buildOutput.databaseCreated),
          sqlRoots: getSafeArray(buildOutput.sqlRoots).slice(0, 10),
          sqlFilesDiscovered: normalizeNonNegativeNumber(buildOutput.sqlFilesDiscovered),
          sqlFilesExecuted: normalizeNonNegativeNumber(buildOutput.sqlFilesExecuted),
          migrationFilesDiscovered: normalizeNonNegativeNumber(buildOutput.migrationFilesDiscovered),
          migrationFilesExecuted: normalizeNonNegativeNumber(buildOutput.migrationFilesExecuted),
          seedFilesDiscovered: normalizeNonNegativeNumber(buildOutput.seedFilesDiscovered),
          seedFilesExecuted: normalizeNonNegativeNumber(buildOutput.seedFilesExecuted),
          firstSqlFile: buildOutput.firstSqlFile || null,
          lastSqlFile: buildOutput.lastSqlFile || null,
          lastCompletedSqlFile: buildOutput.lastCompletedSqlFile || null,
          failedSqlFile: buildOutput.failedSqlFile || null,
          durationMs: getResultDurationMs(build.result, buildOutput),
        }
      : null,
    comparison: comparison
      ? {
          nodeKey: comparison.nodeKey,
          comparedAt: comparisonOutput.comparedAt || null,
          status: comparisonOutput.status || null,
          comparisonCompleted: comparisonComplete,
          databasesOnline: Boolean(comparisonOutput.databasesOnline),
          databasesMatch,
          databaseA: comparisonOutput.databaseA || null,
          databaseB: comparisonOutput.databaseB || null,
          databaseAFingerprint: comparisonOutput.databaseAFingerprint || null,
          databaseBFingerprint: comparisonOutput.databaseBFingerprint || null,
          databaseAObjectCount: normalizeNonNegativeNumber(
            comparisonOutput.databaseAObjectCount,
          ),
          databaseBObjectCount: normalizeNonNegativeNumber(
            comparisonOutput.databaseBObjectCount,
          ),
          matchedObjectCount: normalizeNonNegativeNumber(comparisonOutput.matchedObjectCount),
          onlyInDatabaseACount: normalizeNonNegativeNumber(
            comparisonOutput.onlyInDatabaseACount,
          ),
          onlyInDatabaseBCount: normalizeNonNegativeNumber(
            comparisonOutput.onlyInDatabaseBCount,
          ),
          definitionMismatchCount: normalizeNonNegativeNumber(
            comparisonOutput.definitionMismatchCount,
          ),
          totalDifferenceCount: normalizeNonNegativeNumber(
            comparisonOutput.totalDifferenceCount,
          ),
          differenceDetailsReturned: normalizeNonNegativeNumber(
            comparisonOutput.differenceDetailsReturned,
          ),
          differenceDetailsTruncated:
            Boolean(comparisonOutput.differenceDetailsTruncated) ||
            comparisonDifferences.length > summaryDifferences.length,
          byType: getSafeArray(comparisonOutput.byType).map((item) => ({
            objectType: item?.objectType || null,
            databaseACount: normalizeNonNegativeNumber(item?.databaseACount),
            databaseBCount: normalizeNonNegativeNumber(item?.databaseBCount),
            onlyInDatabaseA: normalizeNonNegativeNumber(item?.onlyInDatabaseA),
            onlyInDatabaseB: normalizeNonNegativeNumber(item?.onlyInDatabaseB),
            definitionMismatches: normalizeNonNegativeNumber(item?.definitionMismatches),
          })),
          differences: summaryDifferences.map((difference) => ({
            kind: difference?.kind || null,
            objectType: difference?.objectType || null,
            schemaName: difference?.schemaName || null,
            objectName: difference?.objectName || null,
            identity: difference?.identity || null,
          })),
          durationMs: getResultDurationMs(comparison.result, comparisonOutput),
        }
      : null,
    durationMs: stages.reduce(
      (sum, stage) => sum + normalizeNonNegativeNumber(stage.durationMs),
      0,
    ),
    stages,
  };
}

function buildStructuredResultRollup(nodeOutputsByKey = {}) {
  const macroIngestion = buildMacroIngestionRollup(nodeOutputsByKey);
  const gitPromotion = buildGitPromotionRollup(nodeOutputsByKey);
  const databaseSynchronization = buildDatabaseSynchronizationRollup(nodeOutputsByKey);
  const outputTypes = {};

  for (const rawResult of Object.values(getSafeObject(nodeOutputsByKey))) {
    const result = getSafeObject(rawResult);

    if (!isToolResultEnvelope(result)) {
      continue;
    }

    outputTypes[result.outputType] = (outputTypes[result.outputType] || 0) + 1;
  }

  return {
    resultCount: Object.values(outputTypes).reduce((sum, count) => sum + count, 0),
    outputTypes,
    macroIngestion,
    gitPromotion,
    databaseSynchronization,
  };
}

function buildScheduledToolResultSummary(toolResult = {}) {
  const result = getSafeObject(toolResult);

  if (!isToolResultEnvelope(result)) {
    return null;
  }

  const summary = {
    schemaVersion: result.schemaVersion,
    outputType: result.outputType,
    success: result.success,
    message: result.message || '',
    warnings: getSafeArray(result.warnings).length,
    errorCode: result.error?.code || null,
  };

  if (result.outputType === MACRO_INGESTION_OUTPUT_TYPE) {
    const source = buildMacroIngestionSourceSummary('', result);
    summary.macroIngestion = source
      ? {
          sourceCode: source.sourceCode,
          outcome: source.outcome,
          selectedIndicators: source.selectedIndicators,
          durationMs: source.durationMs,
          totals: source.totals,
        }
      : null;
  }

  if (result.outputType === REPOSITORY_PACKAGE_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.repositoryPackage = {
      outcome: output.outcome || null,
      repositoryName: output.repositoryName || null,
      fileName: output.fileName || null,
      artifactPath: output.artifactPath || null,
      filesIncluded: Number(output.filesIncluded || 0),
      sourceBytes: Number(output.sourceBytes || 0),
      archiveBytes: Number(output.archiveBytes || 0),
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === REPOSITORY_MAP_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.repositoryMap = {
      outcome: output.outcome || null,
      repositoryName: output.repositoryName || null,
      fileName: output.fileName || null,
      artifactPath: output.artifactPath || null,
      directoriesDocumented: Number(output.directoriesDocumented || 0),
      filesDocumented: Number(output.filesDocumented || 0),
      outputBytes: Number(output.outputBytes || 0),
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === GIT_REPOSITORY_STATUS_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.gitRepositoryStatus = {
      outcome: output.outcome || null,
      repositoryCode: output.repositoryCode || null,
      currentBranch: output.currentBranch || null,
      expectedBranch: output.expectedBranch || null,
      readyForDevelopmentPromotion: Boolean(output.readyForDevelopmentPromotion),
      blockerCount: getSafeArray(output.blockers).length,
      totalChanges: Number(output.workingTree?.totalChanges || 0),
      remoteBranchesSynchronized: Boolean(
        output.relationship?.remoteBranchesSynchronized,
      ),
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === GIT_COMMIT_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.gitCommit = {
      outcome: output.outcome || null,
      repositoryCode: output.repositoryCode || null,
      branch: output.branch || null,
      commitSha: output.commitSha || output.currentHeadSha || null,
      changedFiles: Number(output.changedFiles || 0),
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === GIT_BRANCH_SYNC_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.gitBranchSync = {
      outcome: output.outcome || null,
      repositoryCode: output.repositoryCode || null,
      sourceBranch: output.sourceBranch || output.mainBranch || null,
      targetBranch: output.targetBranch || output.devBranch || null,
      synchronizedHeadSha: output.synchronizedHeadSha || output.devHeadAfterSha || null,
      commitsApplied: Number(output.commitsApplied || 0),
      branchesSynchronized: Boolean(output.branchesSynchronized),
      tagName: output.tagName || null,
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === GIT_LOCAL_SYNC_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.gitLocalSync = {
      outcome: output.outcome || null,
      repositoryCode: output.repositoryCode || null,
      expectedLocalDevSha: output.expectedLocalDevSha || null,
      expectedSynchronizedHeadSha: output.expectedSynchronizedHeadSha || null,
      localMainAfterSha: output.localMainAfterSha || null,
      localDevAfterSha: output.localDevAfterSha || null,
      fourWaySynchronized: Boolean(output.fourWaySynchronized),
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === DATABASE_HEALTH_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.databaseHealth = {
      allOnline: Boolean(output.allOnline),
      requestedCount: Number(output.requestedCount || 0),
      onlineCount: Number(output.onlineCount || 0),
      offlineCount: Number(output.offlineCount || 0),
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === DATABASE_COMPARISON_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.databaseComparison = {
      status: output.status || null,
      comparisonCompleted: Boolean(output.comparisonCompleted),
      databasesMatch: Boolean(output.databasesMatch),
      databaseA: output.databaseA || null,
      databaseB: output.databaseB || null,
      matchedObjectCount: Number(output.matchedObjectCount || 0),
      totalDifferenceCount: Number(output.totalDifferenceCount || 0),
      durationMs: getResultDurationMs(result, output),
    };
  }

  if (result.outputType === DATABASE_BUILD_OUTPUT_TYPE) {
    const output = getSafeObject(result.output);
    summary.databaseBuild = {
      targetDatabase: output.targetDatabase || null,
      status: output.status || null,
      phase: output.phase || null,
      buildCompleted: Boolean(output.buildCompleted),
      sqlFilesDiscovered: Number(output.sqlFilesDiscovered || 0),
      sqlFilesExecuted: Number(output.sqlFilesExecuted || 0),
      failedSqlFile: output.failedSqlFile || null,
      durationMs: getResultDurationMs(result, output),
    };
  }

  return summary;
}

function getScheduledToolResultEvidence(metadata = {}) {
  const value = getSafeObject(metadata);
  const toolResult = getSafeObject(value.toolResult);

  if (toolResult.available !== true || !toolResult.outputType) {
    return null;
  }

  return cloneJsonCompatible(toolResult);
}

module.exports = {
  MACRO_INGESTION_OUTPUT_TYPE,
  GIT_COMMIT_OUTPUT_TYPE,
  GIT_BRANCH_SYNC_OUTPUT_TYPE,
  GIT_LOCAL_SYNC_OUTPUT_TYPE,
  GIT_REPOSITORY_STATUS_OUTPUT_TYPE,
  DATABASE_HEALTH_OUTPUT_TYPE,
  DATABASE_BUILD_OUTPUT_TYPE,
  DATABASE_COMPARISON_OUTPUT_TYPE,
  REPOSITORY_MAP_OUTPUT_TYPE,
  REPOSITORY_PACKAGE_OUTPUT_TYPE,
  buildCanonicalNodeResultView,
  buildConditionNodeLookup,
  buildGitPromotionRollup,
  buildDatabaseSynchronizationRollup,
  buildMacroIngestionRollup,
  buildScheduledToolResultSummary,
  buildStructuredResultRollup,
  buildSummaryKeyOutputs,
  cloneJsonCompatible,
  compactDomainOutput,
  getResultDurationMs,
  getResultStatus,
  getResultSummary,
  getScheduledToolResultEvidence,
  getToolResultDomainOutput,
  isPromotionReadinessConditionOutput,
  isToolResultEnvelope,
  normalizeMacroTotals,
};
