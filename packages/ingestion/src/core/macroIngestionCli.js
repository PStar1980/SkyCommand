const {
  createMacroIngestionFailureToolResult,
  createMacroIngestionToolResult,
} = require('./macroIngestionResult');
const { writeToolResult } = require('../../../tools/src/toolResultTransport');

function hasFlag(args = [], name) {
  return args.includes(`--${name}`);
}

function setProcessExitCode(code) {
  process.exitCode = code;
}

function logError(prefix, error, logger = console.error) {
  logger(prefix);
  logger(error?.stack || error?.message || String(error));
}

function emitMacroIngestionToolResult(toolResult, emitResult = writeToolResult) {
  return emitResult(toolResult);
}

async function runMacroIngestionCli({
  sourceCode,
  args = process.argv.slice(2),
  execute,
  printResult = null,
  emitResult = writeToolResult,
  setExitCode = setProcessExitCode,
  logger = console.error,
} = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('runMacroIngestionCli requires an execute function.');
  }

  const normalizedSourceCode = String(sourceCode || 'UNKNOWN').toUpperCase();
  const startedAt = new Date().toISOString();
  let result;

  try {
    result = await execute(args);
  } catch (error) {
    const completedAt = new Date().toISOString();
    const toolResult = createMacroIngestionFailureToolResult({
      sourceCode: normalizedSourceCode,
      error,
      startedAt,
      completedAt,
    });

    logError(`[${normalizedSourceCode}] Ingestion failed`, error, logger);

    try {
      emitMacroIngestionToolResult(toolResult, emitResult);
    } catch (resultError) {
      logError(
        `[${normalizedSourceCode}] Structured ToolResult emission failed`,
        resultError,
        logger,
      );
    }

    setExitCode(1);

    return {
      result: null,
      toolResult,
      error,
    };
  }

  let toolResult;

  try {
    toolResult = createMacroIngestionToolResult({
      sourceCode: normalizedSourceCode,
      batchResult: result,
    });
  } catch (error) {
    logError(
      `[${normalizedSourceCode}] Structured ToolResult creation failed`,
      error,
      logger,
    );
    setExitCode(1);

    return {
      result,
      toolResult: null,
      emission: null,
      error,
    };
  }

  if (typeof printResult === 'function') {
    try {
      printResult(result, args);
    } catch (error) {
      logError(`[${normalizedSourceCode}] Console summary rendering failed`, error, logger);
    }
  }

  try {
    const emission = emitMacroIngestionToolResult(toolResult, emitResult);

    if (!result.ok && !hasFlag(args, 'allow-failures')) {
      setExitCode(1);
    }

    return {
      result,
      toolResult,
      emission,
    };
  } catch (error) {
    logError(
      `[${normalizedSourceCode}] Structured ToolResult emission failed`,
      error,
      logger,
    );
    setExitCode(1);

    return {
      result,
      toolResult,
      emission: null,
      error,
    };
  }
}

module.exports = {
  emitMacroIngestionToolResult,
  hasFlag,
  runMacroIngestionCli,
};
