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
const SOURCE_TOOL_CODES = {
  FRED: 'ingestion_fred',
  BOC: 'ingestion_boc',
  STATCAN: 'ingestion_statcan',
};

function hasFlag(args = [], name) {
  return args.includes(`--${name}`);
}

function setProcessExitCode(code) {
  process.exitCode = code;
}

function emitMacroIngestionToolResult(toolResult, emitResult = writeToolResult, options = {}) {
  return emitResult(toolResult, options);
}

function getMacroToolCode(sourceCode) {
  const normalizedSourceCode = String(sourceCode || '').toUpperCase();
  const toolCode = SOURCE_TOOL_CODES[normalizedSourceCode];

  if (!toolCode) {
    throw new Error(
      `No macro-ingestion tool code is configured for source ${normalizedSourceCode || '(blank)'}.`,
    );
  }

  return toolCode;
}

function runMacroIngestionCli({
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

  const toolCode = getMacroToolCode(normalizedSourceCode);
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
  SOURCE_TOOL_CODES,
  emitMacroIngestionToolResult,
  getMacroToolCode,
  hasFlag,
  runMacroIngestionCli,
};
