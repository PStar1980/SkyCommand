const {
  createMacroIngestionFailureToolResult,
  createMacroIngestionToolResult,
} = require('./macroIngestionResult');
const { runToolCli } = require('../../../tools/src/toolCliAdapter');
const {
  persistMacroBatchResultSafely,
  persistMacroToolResultSafely,
} = require('../ledger/ingestionLedgerIntegration');
const { writeToolResult } = require('../../../tools/src/toolResultTransport');

const MACRO_INGESTION_OUTPUT_TYPE = 'macro_ingestion_summary.v1';

function hasFlag(args = [], name) {
  return args.includes(`--${name}`);
}

function setProcessExitCode(code) {
  process.exitCode = code;
}

function emitMacroIngestionToolResult(toolResult, emitResult = writeToolResult, options = {}) {
  return emitResult(toolResult, options);
}

function getMacroToolCode(sourceCode, explicitToolCode) {
  const normalizedSourceCode = String(sourceCode || '').trim().toUpperCase();
  const toolCode = String(explicitToolCode || '').trim();

  if (!toolCode) {
    throw new Error(
      `Macro compatibility execution for source ${normalizedSourceCode || '(blank)'} requires an explicit toolCode from its ingestion profile boundary.`,
    );
  }

  return toolCode;
}

function runMacroIngestionCli({
  sourceCode,
  toolCode: explicitToolCode,
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

  const toolCode = getMacroToolCode(normalizedSourceCode, explicitToolCode);
  let ledgerReference = null;
  const executeWithLedger = async (executionArgs, toolContext) => {
    try {
      const batchResult = await execute(executionArgs, toolContext);
      ledgerReference = await persistMacroBatchResultSafely({
        sourceCode: normalizedSourceCode,
        toolCode,
        batchResult,
      }, logger);

      return batchResult;
    } catch (error) {
      const failureToolResult = createMacroIngestionFailureToolResult({
        sourceCode: normalizedSourceCode,
        error,
        startedAt,
        completedAt: new Date().toISOString(),
      });

      ledgerReference = await persistMacroToolResultSafely({
        sourceCode: normalizedSourceCode,
        toolCode,
        toolResult: failureToolResult,
        refreshFreshness: true,
      }, logger);

      throw error;
    }
  };

  return runToolCli({
    toolCode,
    outputType: MACRO_INGESTION_OUTPUT_TYPE,
    args,
    execute: executeWithLedger,
    createToolResult: (result) => createMacroIngestionToolResult({
      sourceCode: normalizedSourceCode,
      batchResult: {
        ...result,
        ledger: ledgerReference,
      },
    }),
    createFailureToolResult: (error) => {
      const failureResult = createMacroIngestionFailureToolResult({
        sourceCode: normalizedSourceCode,
        error,
        startedAt,
        completedAt: new Date().toISOString(),
      });

      return {
        ...failureResult,
        metadata: {
          ...(failureResult.metadata || {}),
          ingestionLedger: ledgerReference,
        },
      };
    },
    renderConsole: printResult,
    shouldFailProcess: ({ result }) => !result.ok && !hasFlag(args, 'allow-failures'),
    emitResult,
    setExitCode,
    logger,
  });
}

module.exports = {
  MACRO_INGESTION_OUTPUT_TYPE,
  emitMacroIngestionToolResult,
  getMacroToolCode,
  hasFlag,
  runMacroIngestionCli,
};
