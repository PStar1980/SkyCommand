const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const TOOL_RESULT_FILE_EXTENSION = '.tool-result';

const {
  ToolResultContractError,
  normalizeMaximumBytes,
  validateToolResult,
} = require('./toolResultContract');

function getSkyServerRoot() {
  return path.resolve(__dirname, '../../..');
}

function assertPathInsideRoot(candidatePath, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relativePath = path.relative(resolvedRoot, resolvedCandidate);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return resolvedCandidate;
  }

  throw new ToolResultContractError(
    'TOOL_RESULT_PATH_OUTSIDE_ROOT',
    'Structured tool result path resolves outside the wrapper-owned result directory.',
    { resolvedRoot, resolvedCandidate },
  );
}

function assertRealPathInsideRoot(candidatePath, rootPath) {
  const realRoot = fs.realpathSync(rootPath);
  const realCandidate = fs.realpathSync(candidatePath);
  return assertPathInsideRoot(realCandidate, realRoot);
}

function normalizeFileToken(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized || fallback;
}

function getDefaultResultDirectory(rootDirectory = getSkyServerRoot()) {
  return path.join(rootDirectory, 'logs', 'tool-results');
}

function resolveWriterPaths(resultPath, allowedDirectory) {
  if (!path.isAbsolute(resultPath)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_PATH_NOT_ABSOLUTE',
      'SKYCOMMAND_TOOL_RESULT_PATH must be an absolute wrapper-owned path.',
      { resultPath },
    );
  }

  if (!allowedDirectory) {
    throw new ToolResultContractError(
      'TOOL_RESULT_DIRECTORY_NOT_CONFIGURED',
      'The wrapper-owned structured result directory was not provided.',
    );
  }

  const outputDirectory = path.dirname(resultPath);

  if (!fs.existsSync(outputDirectory)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_DIRECTORY_MISSING',
      'The wrapper-owned structured result directory does not exist.',
      { outputDirectory },
    );
  }

  const realAllowedDirectory = fs.realpathSync(allowedDirectory);
  const realOutputDirectory = assertRealPathInsideRoot(outputDirectory, realAllowedDirectory);
  const resolvedResultPath = assertPathInsideRoot(
    path.join(realOutputDirectory, path.basename(resultPath)),
    realAllowedDirectory,
  );

  return {
    allowedDirectory: realAllowedDirectory,
    outputDirectory: realOutputDirectory,
    resultPath: resolvedResultPath,
  };
}

function writeToolResult(toolResult, options = {}) {
  const resultPath = options.resultPath || process.env.SKYCOMMAND_TOOL_RESULT_PATH;

  if (!resultPath) {
    return {
      emitted: false,
      reason: 'result_path_not_configured',
    };
  }

  const allowedDirectory =
    options.resultDirectory || process.env.SKYCOMMAND_TOOL_RESULT_DIRECTORY;
  const resolvedPaths = resolveWriterPaths(resultPath, allowedDirectory);
  const maximumBytes = normalizeMaximumBytes(
    options.maxBytes
      ?? process.env.SKYCOMMAND_TOOL_RESULT_MAX_BYTES
      ?? process.env.TOOL_RESULT_MAX_BYTES,
  );
  const normalized = validateToolResult(toolResult, {
    maxBytes: maximumBytes,
    expectedOutputType: options.expectedOutputType,
    outputSchema: options.outputSchema,
  });
  const serialized = JSON.stringify(normalized);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  const temporaryPath = `${resolvedPaths.resultPath}.tmp`;

  if (fs.existsSync(resolvedPaths.resultPath) || fs.existsSync(temporaryPath)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_PATH_ALREADY_EXISTS',
      'Structured tool result transport path has already been used.',
      { resultPath: resolvedPaths.resultPath },
    );
  }

  fs.writeFileSync(temporaryPath, serialized, {
    encoding: 'utf8',
    flag: 'wx',
  });
  fs.renameSync(temporaryPath, resolvedPaths.resultPath);

  return {
    emitted: true,
    resultPath: resolvedPaths.resultPath,
    outputType: normalized.outputType,
    schemaVersion: normalized.schemaVersion,
    byteLength,
  };
}

function createToolResultTransport({
  executionId,
  toolCode,
  required = false,
  rootDirectory = getSkyServerRoot(),
  resultDirectory = getDefaultResultDirectory(rootDirectory),
  maxBytes,
  expectedOutputType = null,
  outputSchema = null,
} = {}) {
  const maximumBytes = normalizeMaximumBytes(
    maxBytes
      ?? process.env.SKYCOMMAND_TOOL_RESULT_MAX_BYTES
      ?? process.env.TOOL_RESULT_MAX_BYTES,
  );
  const resolvedRootDirectory = path.resolve(rootDirectory);

  fs.mkdirSync(resolvedRootDirectory, { recursive: true });

  const resolvedResultDirectory = assertPathInsideRoot(
    path.resolve(resultDirectory),
    resolvedRootDirectory,
  );

  fs.mkdirSync(resolvedResultDirectory, { recursive: true });

  const realRootDirectory = fs.realpathSync(resolvedRootDirectory);
  const realResultDirectory = assertRealPathInsideRoot(
    resolvedResultDirectory,
    realRootDirectory,
  );
  const safeExecutionId = normalizeFileToken(executionId, 'execution');
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const resultPath = assertPathInsideRoot(
    path.join(realResultDirectory, `${safeExecutionId}-${token}${TOOL_RESULT_FILE_EXTENSION}`),
    realResultDirectory,
  );

  function getEnvironment() {
    return {
      SKYCOMMAND_TOOL_RESULT_PATH: resultPath,
      SKYCOMMAND_TOOL_RESULT_DIRECTORY: realResultDirectory,
      SKYCOMMAND_EXECUTION_ID: String(executionId || ''),
      SKYCOMMAND_TOOL_CODE: String(toolCode || ''),
      SKYCOMMAND_TOOL_RESULT_REQUIRED: required ? 'true' : 'false',
      SKYCOMMAND_TOOL_RESULT_MAX_BYTES: String(maximumBytes),
    };
  }

  function readResult() {
    if (!fs.existsSync(resultPath)) {
      if (required) {
        throw new ToolResultContractError(
          'TOOL_RESULT_MISSING',
          'Tool process completed, but the required structured workflow result was not produced.',
          { executionId: executionId || null, toolCode: toolCode || null },
        );
      }

      return {
        status: 'NOT_EMITTED',
        toolResult: null,
        byteLength: 0,
      };
    }

    const fileStats = fs.lstatSync(resultPath);

    if (!fileStats.isFile()) {
      throw new ToolResultContractError(
        'TOOL_RESULT_NOT_FILE',
        'Structured tool result transport target is not a regular file.',
        { resultPath },
      );
    }

    if (fileStats.size > maximumBytes) {
      throw new ToolResultContractError(
        'TOOL_RESULT_TOO_LARGE',
        `Structured tool result exceeds the maximum size of ${maximumBytes} bytes.`,
        { byteLength: fileStats.size, maximumBytes },
      );
    }

    const raw = fs.readFileSync(resultPath, 'utf8');
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ToolResultContractError(
        'TOOL_RESULT_INVALID_JSON',
        `Structured tool result is not valid JSON: ${error.message}`,
        { resultPath },
      );
    }

    const toolResult = validateToolResult(parsed, {
      maxBytes: maximumBytes,
      expectedOutputType,
      outputSchema,
    });

    return {
      status: 'VALID',
      toolResult,
      byteLength: Buffer.byteLength(raw, 'utf8'),
    };
  }

  function cleanup() {
    [resultPath, `${resultPath}.tmp`].forEach((candidate) => {
      try {
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      } catch (_error) {
        // Best-effort cleanup only. Contract diagnostics are retained in execution metadata.
      }
    });
  }

  return {
    cleanup,
    getEnvironment,
    maxBytes: maximumBytes,
    readResult,
    required: Boolean(required),
    expectedOutputType,
    resultDirectory: realResultDirectory,
    resultPath,
  };
}

module.exports = {
  TOOL_RESULT_FILE_EXTENSION,
  createToolResultTransport,
  getDefaultResultDirectory,
  getSkyServerRoot,
  writeToolResult,
};
