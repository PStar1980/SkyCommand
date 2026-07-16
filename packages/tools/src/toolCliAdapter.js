const { validateToolResult } = require('./toolResultContract');
const { writeToolResult } = require('./toolResultTransport');
const {
  ToolManifestContractError,
  loadToolManifest,
  summarizeToolManifest,
} = require('./toolManifestContract');

const DESCRIBE_FLAG = '--skycommand-describe';
const CONTRACT_CHECK_FLAG = '--skycommand-contract-check';

function setProcessExitCode(code) {
  process.exitCode = code;
}

function hasArg(args, name) {
  return Array.isArray(args) && args.includes(name);
}

function logError(prefix, error, logger = console.error) {
  logger(prefix);
  logger(error?.stack || error?.message || String(error));
}

function writeJsonLine(value, writer = console.log) {
  writer(JSON.stringify(value, null, 2));
}

function validateAgainstManifest(toolResult, loadedManifest, options = {}) {
  const { manifest, outputSchema } = loadedManifest;

  return validateToolResult(toolResult, {
    maxBytes: options.maxBytes,
    expectedOutputType: manifest.resultContract.outputType,
    outputSchema,
  });
}

function emitValidatedToolResult(toolResult, loadedManifest, emitResult = writeToolResult) {
  return emitResult(toolResult, {
    expectedOutputType: loadedManifest.manifest.resultContract.outputType,
    outputSchema: loadedManifest.outputSchema,
  });
}

function runDescribeMode(loadedManifest, writer = console.log) {
  const description = {
    kind: 'skycommand_tool_description.v1',
    status: 'VALID',
    tool: summarizeToolManifest(loadedManifest),
  };

  writeJsonLine(description, writer);

  return {
    mode: 'describe',
    manifest: loadedManifest.manifest,
    description,
  };
}

function runContractCheckMode(loadedManifest, options = {}) {
  const sampleToolResult = loadedManifest.sampleToolResult;

  if (!sampleToolResult) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_CONTRACT_SAMPLE_REQUIRED',
      `Tool ${loadedManifest.manifest.toolCode} does not declare a contract-check sample.`,
      { toolCode: loadedManifest.manifest.toolCode },
    );
  }

  const toolResult = validateAgainstManifest(sampleToolResult, loadedManifest, options);
  const emission = emitValidatedToolResult(
    toolResult,
    loadedManifest,
    options.emitResult || writeToolResult,
  );
  const report = {
    kind: 'skycommand_tool_contract_check.v1',
    status: 'VALID',
    toolCode: loadedManifest.manifest.toolCode,
    manifestVersion: loadedManifest.manifest.manifestVersion,
    outputType: toolResult.outputType,
    schemaVersion: toolResult.schemaVersion,
    schemaValidated: Boolean(loadedManifest.outputSchema),
    emitted: Boolean(emission?.emitted),
    hashes: loadedManifest.hashes,
    sampleResult: toolResult,
  };

  writeJsonLine(report, options.writer || console.log);

  return {
    mode: 'contract_check',
    manifest: loadedManifest.manifest,
    toolResult,
    emission,
    report,
  };
}

async function runToolCli({
  manifestPath,
  repositoryRoot,
  args = process.argv.slice(2),
  execute,
  createToolResult,
  createFailureToolResult,
  renderConsole = null,
  shouldFailProcess = null,
  emitResult = writeToolResult,
  setExitCode = setProcessExitCode,
  logger = console.error,
  writer = console.log,
  maxBytes,
} = {}) {
  let loadedManifest;

  try {
    loadedManifest = loadToolManifest(manifestPath, { repositoryRoot });
  } catch (error) {
    logError('[SkyCommand] Tool manifest validation failed', error, logger);
    setExitCode(1);

    return {
      mode: 'manifest_error',
      manifest: null,
      result: null,
      toolResult: null,
      emission: null,
      error,
    };
  }

  try {
    if (hasArg(args, DESCRIBE_FLAG)) {
      return runDescribeMode(loadedManifest, writer);
    }

    if (hasArg(args, CONTRACT_CHECK_FLAG)) {
      return runContractCheckMode(loadedManifest, {
        emitResult,
        writer,
        maxBytes,
      });
    }
  } catch (error) {
    logError('[SkyCommand] Tool contract validation failed', error, logger);
    setExitCode(1);

    return {
      mode: 'contract_error',
      manifest: loadedManifest.manifest,
      result: null,
      toolResult: null,
      emission: null,
      error,
    };
  }

  if (typeof execute !== 'function') {
    throw new TypeError('runToolCli requires an execute function for normal execution.');
  }

  if (typeof createToolResult !== 'function') {
    throw new TypeError('runToolCli requires a createToolResult function for normal execution.');
  }

  let result;

  try {
    result = await execute(args, loadedManifest.manifest);
  } catch (error) {
    if (typeof createFailureToolResult !== 'function') {
      logError(`[${loadedManifest.manifest.toolCode}] Tool execution failed`, error, logger);
      setExitCode(1);

      return {
        mode: 'execute',
        manifest: loadedManifest.manifest,
        result: null,
        toolResult: null,
        emission: null,
        error,
      };
    }

    let toolResult;

    try {
      toolResult = validateAgainstManifest(
        createFailureToolResult(error, loadedManifest.manifest),
        loadedManifest,
        { maxBytes },
      );
    } catch (contractError) {
      logError(`[${loadedManifest.manifest.toolCode}] Failure ToolResult validation failed`, contractError, logger);
      setExitCode(1);

      return {
        mode: 'execute',
        manifest: loadedManifest.manifest,
        result: null,
        toolResult: null,
        emission: null,
        error: contractError,
        executionError: error,
      };
    }

    logError(`[${loadedManifest.manifest.toolCode}] Tool execution failed`, error, logger);

    try {
      const emission = emitValidatedToolResult(toolResult, loadedManifest, emitResult);
      setExitCode(1);

      return {
        mode: 'execute',
        manifest: loadedManifest.manifest,
        result: null,
        toolResult,
        emission,
        error,
      };
    } catch (emissionError) {
      logError(`[${loadedManifest.manifest.toolCode}] Structured ToolResult emission failed`, emissionError, logger);
      setExitCode(1);

      return {
        mode: 'execute',
        manifest: loadedManifest.manifest,
        result: null,
        toolResult,
        emission: null,
        error: emissionError,
        executionError: error,
      };
    }
  }

  let toolResult;

  try {
    toolResult = validateAgainstManifest(
      createToolResult(result, loadedManifest.manifest),
      loadedManifest,
      { maxBytes },
    );
  } catch (error) {
    logError(`[${loadedManifest.manifest.toolCode}] Structured ToolResult validation failed`, error, logger);
    setExitCode(1);

    return {
      mode: 'execute',
      manifest: loadedManifest.manifest,
      result,
      toolResult: null,
      emission: null,
      error,
    };
  }

  if (typeof renderConsole === 'function') {
    try {
      renderConsole(result, args, toolResult, loadedManifest.manifest);
    } catch (error) {
      logError(`[${loadedManifest.manifest.toolCode}] Console rendering failed`, error, logger);
    }
  }

  try {
    const emission = emitValidatedToolResult(toolResult, loadedManifest, emitResult);
    const shouldFail = typeof shouldFailProcess === 'function'
      ? Boolean(shouldFailProcess({ result, toolResult, args, manifest: loadedManifest.manifest }))
      : toolResult.success === false;

    if (shouldFail) {
      setExitCode(1);
    }

    return {
      mode: 'execute',
      manifest: loadedManifest.manifest,
      result,
      toolResult,
      emission,
    };
  } catch (error) {
    logError(`[${loadedManifest.manifest.toolCode}] Structured ToolResult emission failed`, error, logger);
    setExitCode(1);

    return {
      mode: 'execute',
      manifest: loadedManifest.manifest,
      result,
      toolResult,
      emission: null,
      error,
    };
  }
}

module.exports = {
  CONTRACT_CHECK_FLAG,
  DESCRIBE_FLAG,
  emitValidatedToolResult,
  runContractCheckMode,
  runDescribeMode,
  runToolCli,
  validateAgainstManifest,
};
