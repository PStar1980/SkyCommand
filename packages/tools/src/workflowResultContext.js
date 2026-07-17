const MACRO_INGESTION_OUTPUT_TYPE = 'macro_ingestion_summary.v1';
const REPOSITORY_PACKAGE_OUTPUT_TYPE = 'repository_package_summary.v1';

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

function buildStructuredResultRollup(nodeOutputsByKey = {}) {
  const macroIngestion = buildMacroIngestionRollup(nodeOutputsByKey);
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

  return summary;
}

module.exports = {
  MACRO_INGESTION_OUTPUT_TYPE,
  REPOSITORY_PACKAGE_OUTPUT_TYPE,
  buildCanonicalNodeResultView,
  buildConditionNodeLookup,
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
