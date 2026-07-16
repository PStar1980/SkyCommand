const path = require('path');

const {
  createMacroIngestionFailureToolResult,
  createMacroIngestionToolResult,
} = require('./macroIngestionResult');
const { runToolCli } = require('../../../tools/src/toolCliAdapter');
const { writeToolResult } = require('../../../tools/src/toolResultTransport');

const SOURCE_MANIFEST_DIRECTORIES = {
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

function getDefaultMacroManifestPath(sourceCode) {
  const normalizedSourceCode = String(sourceCode || '').toUpperCase();
  const manifestDirectory = SOURCE_MANIFEST_DIRECTORIES[normalizedSourceCode];

  if (!manifestDirectory) {
    throw new Error(`No macro-ingestion manifest is configured for source ${normalizedSourceCode || '(blank)'}.`);
  }

  return path.resolve(
    __dirname,
    '../../manifests',
    manifestDirectory,
    'skycommand.tool.json',
  );
}

function runMacroIngestionCli({
  sourceCode,
  manifestPath = null,
  args = process.argv.slice(2),
  execute,
  printResult = null,
  emitResult = writeToolResult,
  setExitCode = setProcessExitCode,
  logger = console.error,
  writer = console.log,
  repositoryRoot,
} = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('runMacroIngestionCli requires an execute function.');
  }

  const normalizedSourceCode = String(sourceCode || 'UNKNOWN').toUpperCase();
  const startedAt = new Date().toISOString();

  return runToolCli({
    manifestPath: manifestPath || getDefaultMacroManifestPath(normalizedSourceCode),
    repositoryRoot,
    args,
    execute,
    createToolResult: (result) => createMacroIngestionToolResult({
      sourceCode: normalizedSourceCode,
      batchResult: result,
    }),
    createFailureToolResult: (error) => createMacroIngestionFailureToolResult({
      sourceCode: normalizedSourceCode,
      error,
      startedAt,
      completedAt: new Date().toISOString(),
    }),
    renderConsole: printResult,
    shouldFailProcess: ({ result }) => !result.ok && !hasFlag(args, 'allow-failures'),
    emitResult,
    setExitCode,
    logger,
    writer,
  });
}

module.exports = {
  SOURCE_MANIFEST_DIRECTORIES,
  emitMacroIngestionToolResult,
  getDefaultMacroManifestPath,
  hasFlag,
  runMacroIngestionCli,
};
