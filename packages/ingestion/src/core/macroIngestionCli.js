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
const { createMacroPerformanceTelemetry } = require('./macroIngestionPerformance');

const MACRO_INGESTION_OUTPUT_TYPE = 'macro_ingestion_summary.v1';

const MACRO_CLI_KEEPALIVE_MS = 2_147_483_647;

/**
 * Keeps the short-lived ingestion CLI alive until its asynchronous ToolResult
 * lifecycle has fully settled. Macro ingestion finishes with ledger/freshness
 * work that can run on unref'ed PostgreSQL sockets (allowExitOnIdle=true).
 * A bare top-level `main()` promise does not itself keep Node alive, so the
 * process can otherwise report exit code 0 before the structured-result sidecar
 * is emitted. The wrapper timeout remains the authoritative hang guard.
 */
function runMacroIngestionEntrypoint(run, { logger = console.error } = {}) {
  if (typeof run !== 'function') {
    throw new TypeError('runMacroIngestionEntrypoint requires a run function.');
  }

  const keepAlive = setTimeout(() => {}, MACRO_CLI_KEEPALIVE_MS);

  return Promise.resolve()
    .then(run)
    .catch((error) => {
      logger(`[Macro Ingestion] Unexpected CLI lifecycle failure: ${error?.stack || error?.message || String(error)}`);
      process.exitCode = 1;
      return null;
    })
    .finally(() => {
      clearTimeout(keepAlive);
    });
}

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
  let failurePerformanceTelemetry = null;
  const executeWithLedger = async (executionArgs, toolContext) => {
    const telemetry = createMacroPerformanceTelemetry();
    try {
      const batchResult = await telemetry.measure(
        'SOURCE_INGESTION_EXECUTION',
        'Source ingestion execution',
        () => execute(executionArgs, toolContext),
      );
      await telemetry.measure(
        'LEDGER_FRESHNESS_PERSISTENCE',
        'Ingestion ledger / freshness persistence',
        async () => {
          if (batchResult?.recoveryLedgerReference?.persisted) {
            ledgerReference = batchResult.recoveryLedgerReference;
          } else {
            ledgerReference = await persistMacroBatchResultSafely({
              sourceCode: normalizedSourceCode,
              toolCode,
              batchResult,
            }, logger);
          }
        },
      );

      batchResult.performanceTelemetry = telemetry.snapshot({
        workloadBreakdown: batchResult?.performanceTelemetry?.workloadBreakdown,
      });
      return batchResult;
    } catch (error) {
      await telemetry.measure(
        'LEDGER_FRESHNESS_PERSISTENCE',
        'Ingestion ledger / freshness persistence',
        async () => {
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
        },
      );
      failurePerformanceTelemetry = telemetry.snapshot();
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
        performanceTelemetry: failurePerformanceTelemetry,
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
  runMacroIngestionEntrypoint,
};
