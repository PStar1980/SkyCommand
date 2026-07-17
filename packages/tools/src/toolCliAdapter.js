const { validateToolResult } = require('./toolResultContract');
const { writeToolResult } = require('./toolResultTransport');

function setProcessExitCode(code) {
  process.exitCode = code;
}

function logError(prefix, error, logger = console.error) {
  logger(prefix);
  logger(error?.stack || error?.message || String(error));
}

function logWarning(prefix, error, logger = console.error) {
  logger(`${prefix}: ${error?.message || String(error)}`);
}

function validateConfiguredToolResult(toolResult, options = {}) {
  return validateToolResult(toolResult, {
    maxBytes: options.maxBytes,
    expectedOutputType: options.outputType || null,
    outputSchema: options.outputSchema || null,
  });
}

function emitValidatedToolResult(toolResult, options = {}) {
  return (options.emitResult || writeToolResult)(toolResult, {
    expectedOutputType: options.outputType || null,
    outputSchema: options.outputSchema || null,
    maxBytes: options.maxBytes,
  });
}

/**
 * Runs a reusable SkyCommand tool without requiring repository manifests,
 * accepted snapshots, hashes, or contract-sample files.
 *
 * Domain execution is authoritative. Structured-result validation/emission is
 * deliberately fail-open after successful domain work: a transport or schema
 * problem is reported as a warning, but it never changes a successfully
 * created artifact or completed tool operation into a failed execution.
 */
async function runToolCli({
  toolCode = 'skycommand_tool',
  outputType = null,
  outputSchema = null,
  args = process.argv.slice(2),
  execute,
  createToolResult,
  createFailureToolResult,
  renderConsole = null,
  shouldFailProcess = null,
  emitResult = writeToolResult,
  setExitCode = setProcessExitCode,
  logger = console.error,
  maxBytes,
} = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('runToolCli requires an execute function.');
  }

  if (typeof createToolResult !== 'function') {
    throw new TypeError('runToolCli requires a createToolResult function.');
  }

  const toolContext = {
    toolCode: String(toolCode || 'skycommand_tool'),
    outputType: outputType || null,
  };
  let result;

  try {
    result = await execute(args, toolContext);
  } catch (error) {
    if (typeof createFailureToolResult !== 'function') {
      logError(`[${toolContext.toolCode}] Tool execution failed`, error, logger);
      setExitCode(1);

      return {
        mode: 'execute',
        tool: toolContext,
        result: null,
        toolResult: null,
        emission: null,
        error,
      };
    }

    let toolResult = null;
    let emission = null;
    let resultError = null;

    try {
      toolResult = validateConfiguredToolResult(
        createFailureToolResult(error, toolContext),
        { outputType, outputSchema, maxBytes },
      );
    } catch (contractError) {
      resultError = contractError;
      logWarning(
        `[${toolContext.toolCode}] Failure ToolResult validation warning`,
        contractError,
        logger,
      );
    }

    if (toolResult) {
      try {
        emission = emitValidatedToolResult(toolResult, {
          outputType,
          outputSchema,
          maxBytes,
          emitResult,
        });
      } catch (emissionError) {
        resultError = emissionError;
        logWarning(
          `[${toolContext.toolCode}] Failure ToolResult emission warning`,
          emissionError,
          logger,
        );
      }
    }

    logError(`[${toolContext.toolCode}] Tool execution failed`, error, logger);
    setExitCode(1);

    return {
      mode: 'execute',
      tool: toolContext,
      result: null,
      toolResult,
      emission,
      error,
      structuredResultWarning: resultError,
    };
  }

  if (typeof renderConsole === 'function') {
    try {
      renderConsole(result, args, null, toolContext);
    } catch (error) {
      logWarning(`[${toolContext.toolCode}] Console rendering warning`, error, logger);
    }
  }

  let toolResult = null;
  let emission = null;
  let structuredResultWarning = null;

  try {
    toolResult = validateConfiguredToolResult(
      createToolResult(result, toolContext),
      { outputType, outputSchema, maxBytes },
    );
  } catch (error) {
    structuredResultWarning = error;
    logWarning(
      `[${toolContext.toolCode}] Structured ToolResult validation warning`,
      error,
      logger,
    );
  }

  if (toolResult) {
    try {
      emission = emitValidatedToolResult(toolResult, {
        outputType,
        outputSchema,
        maxBytes,
        emitResult,
      });
    } catch (error) {
      structuredResultWarning = error;
      logWarning(
        `[${toolContext.toolCode}] Structured ToolResult emission warning`,
        error,
        logger,
      );
    }
  }

  const shouldFail = typeof shouldFailProcess === 'function'
    ? Boolean(shouldFailProcess({ result, toolResult, args, tool: toolContext }))
    : toolResult?.success === false || result?.ok === false;

  if (shouldFail) {
    setExitCode(1);
  }

  return {
    mode: 'execute',
    tool: toolContext,
    result,
    toolResult,
    emission,
    structuredResultWarning,
  };
}

module.exports = {
  emitValidatedToolResult,
  runToolCli,
  validateConfiguredToolResult,
};
