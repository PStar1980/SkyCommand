const MACRO_INGESTION_OUTPUT_TYPE = 'macro_ingestion_summary.v1';
const REPOSITORY_PACKAGE_OUTPUT_TYPE = 'repository_package_summary.v1';
const REPOSITORY_MAP_OUTPUT_TYPE = 'repository_map_summary.v1';
const GIT_COMMIT_OUTPUT_TYPE = 'git_commit_summary.v1';
const GIT_BRANCH_SYNC_OUTPUT_TYPE = 'git_branch_sync_summary.v1';
const GIT_REPOSITORY_STATUS_OUTPUT_TYPE = 'git_repository_status.v1';

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

  if (normalizedTotals.rowsInserted > 0 || normalizedTotals.indicatorsUpdated > 0) {
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
  let gitCommit = null;
  let approval = null;
  let branchSync = null;

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
        label: 'Main/development synchronization',
        status: result.success === false ? 'FAILED' : 'SUCCESS',
        outcome: output.outcome || null,
        summary: getResultSummary(result, output),
        outputType: result.outputType,
        durationMs,
        evidence: output.synchronizedHeadSha || output.devHeadAfterSha || `${normalizeNonNegativeNumber(output.commitsApplied)} commit(s) applied`,
      });
    }
  }

  if (!gitCommit && !branchSync) {
    return null;
  }

  const failed = stages.some((stage) => stage.status === 'FAILED');
  const stopped = stages.some((stage) => stage.status === 'STOPPED');
  const commitOutput = getSafeObject(gitCommit?.output);
  const syncOutput = getSafeObject(branchSync?.output);
  const approvalOutput = getSafeObject(approval?.output);
  const repositoryStatusOutput = getSafeObject(repositoryStatus?.output);
  const repositoryCode =
    syncOutput.repositoryCode ||
    commitOutput.repositoryCode ||
    repositoryStatusOutput.repositoryCode ||
    repositoryMap?.output?.repositoryName ||
    repositoryPackage?.output?.repositoryName ||
    null;
  const repositoryName =
    syncOutput.repositoryName ||
    commitOutput.repositoryName ||
    repositoryStatusOutput.repositoryName ||
    repositoryMap?.output?.repositoryName ||
    repositoryPackage?.output?.repositoryName ||
    repositoryCode;
  const developmentBranch = commitOutput.branch || syncOutput.targetBranch || syncOutput.devBranch || null;
  const mainBranch = syncOutput.sourceBranch || syncOutput.mainBranch || null;
  const outcome = failed
    ? 'FAILED'
    : stopped
      ? 'STOPPED'
      : branchSync
        ? 'PROMOTED'
        : approvalOutput.decision === 'APPROVED'
          ? 'APPROVED'
          : 'COMMITTED';

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
    devCommitSha: commitOutput.commitSha || commitOutput.currentHeadSha || null,
    synchronizedHeadSha: syncOutput.synchronizedHeadSha || syncOutput.devHeadAfterSha || null,
    changedFiles: normalizeNonNegativeNumber(commitOutput.changedFiles),
    commitsApplied: normalizeNonNegativeNumber(syncOutput.commitsApplied),
    branchesSynchronized: Boolean(syncOutput.branchesSynchronized),
    executionStrategy: syncOutput.executionStrategy || null,
    watcherSafe: syncOutput.watcherSafe !== false,
    localWorkspaceUpdated: Boolean(syncOutput.localWorkspaceUpdated),
    localWorkspaceRefreshRequired: Boolean(syncOutput.localWorkspaceRefreshRequired),
    localRefreshCommand: syncOutput.localRefreshCommand || null,
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

function buildStructuredResultRollup(nodeOutputsByKey = {}) {
  const macroIngestion = buildMacroIngestionRollup(nodeOutputsByKey);
  const gitPromotion = buildGitPromotionRollup(nodeOutputsByKey);
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

  return summary;
}

module.exports = {
  MACRO_INGESTION_OUTPUT_TYPE,
  GIT_COMMIT_OUTPUT_TYPE,
  GIT_BRANCH_SYNC_OUTPUT_TYPE,
  GIT_REPOSITORY_STATUS_OUTPUT_TYPE,
  REPOSITORY_MAP_OUTPUT_TYPE,
  REPOSITORY_PACKAGE_OUTPUT_TYPE,
  buildCanonicalNodeResultView,
  buildConditionNodeLookup,
  buildGitPromotionRollup,
  buildMacroIngestionRollup,
  buildScheduledToolResultSummary,
  buildStructuredResultRollup,
  buildSummaryKeyOutputs,
  cloneJsonCompatible,
  compactDomainOutput,
  getResultDurationMs,
  getResultStatus,
  getResultSummary,
  getToolResultDomainOutput,
  isToolResultEnvelope,
  normalizeMacroTotals,
};
