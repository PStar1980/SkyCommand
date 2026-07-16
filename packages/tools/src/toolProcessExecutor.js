const { spawn } = require('child_process');
const { serializeContractError } = require('./toolResultContract');
const { createToolResultTransport } = require('./toolResultTransport');

function collectOutput(bufferState, chunk, maximumBytes) {
  const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

  if (bufferState.totalBytes >= maximumBytes) {
    bufferState.truncated = true;
    return;
  }

  const remainingBytes = maximumBytes - bufferState.totalBytes;
  const accepted = input.length <= remainingBytes ? input : input.subarray(0, remainingBytes);

  bufferState.buffers.push(accepted);
  bufferState.totalBytes += accepted.length;

  if (accepted.length < input.length) {
    bufferState.truncated = true;
  }
}

function stringifyOutput(bufferState, maximumBytes, truncationLabel) {
  const output = Buffer.concat(bufferState.buffers).toString('utf8');

  if (!bufferState.truncated) {
    return output;
  }

  return `${output}\n\n[${truncationLabel}] Output truncated at ${maximumBytes} bytes.`;
}

function appendDiagnostic(stderr, diagnostic) {
  return [stderr, diagnostic].filter(Boolean).join('\n').trim();
}

function getBusinessFailureDiagnostic(toolResult) {
  if (!toolResult || toolResult.success !== false) {
    return null;
  }

  const message = toolResult.error?.message || toolResult.message || 'ToolResult reported failure.';
  return `[SkyCommand ToolResult] Business result reported failure: ${message}`;
}

async function executeToolProcess({
  command,
  commandArgs = [],
  cwd,
  env = process.env,
  timeoutMs = 180000,
  maxOutputBytes = 250000,
  outputTruncationLabel = 'SkyCommand',
  executionId,
  toolCode,
  toolResultRequired = false,
  toolResultMaxBytes,
  toolResultExpectedOutputType = null,
  toolResultOutputSchema = null,
  rootDirectory,
} = {}) {
  const resultTransport = createToolResultTransport({
    executionId,
    toolCode,
    required: toolResultRequired,
    maxBytes: toolResultMaxBytes,
    expectedOutputType: toolResultExpectedOutputType,
    outputSchema: toolResultOutputSchema,
    rootDirectory,
  });

  try {
    const processResult = await new Promise((resolve) => {
      const startedAt = Date.now();
      const stdoutState = { buffers: [], totalBytes: 0, truncated: false };
      const stderrState = { buffers: [], totalBytes: 0, truncated: false };
      let timedOut = false;
      let settled = false;

      const child = spawn(command, commandArgs, {
        cwd,
        shell: false,
        env: {
          ...env,
          ...resultTransport.getEnvironment(),
        },
        windowsHide: true,
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout.on('data', (chunk) => collectOutput(stdoutState, chunk, maxOutputBytes));
      child.stderr.on('data', (chunk) => collectOutput(stderrState, chunk, maxOutputBytes));

      child.on('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        resolve({
          processStatus: 'FAILED',
          exitCode: null,
          durationMs: Date.now() - startedAt,
          stdout: stringifyOutput(stdoutState, maxOutputBytes, outputTruncationLabel),
          stderr: appendDiagnostic(
            stringifyOutput(stderrState, maxOutputBytes, outputTruncationLabel),
            error.message,
          ),
          timedOut,
        });
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        const exitCode = timedOut ? -1 : code;

        resolve({
          processStatus: exitCode === 0 ? 'SUCCESS' : 'FAILED',
          exitCode,
          durationMs: Date.now() - startedAt,
          stdout: stringifyOutput(stdoutState, maxOutputBytes, outputTruncationLabel),
          stderr: stringifyOutput(stderrState, maxOutputBytes, outputTruncationLabel),
          timedOut,
        });
      });
    });

    let readResult = null;
    let contractError = null;

    try {
      readResult = resultTransport.readResult();
    } catch (error) {
      contractError = error;
    }

    const toolResult = readResult?.toolResult || null;
    const businessResultFailed = toolResult?.success === false;
    const finalStatus =
      processResult.processStatus === 'SUCCESS' && !contractError && !businessResultFailed
        ? 'SUCCESS'
        : 'FAILED';
    const contractStatus = contractError
      ? contractError.code === 'TOOL_RESULT_MISSING'
        ? 'MISSING_REQUIRED'
        : 'INVALID'
      : readResult?.status || 'NOT_EMITTED';
    const contractDiagnostic = contractError
      ? `[SkyCommand ToolResult] ${contractError.code}: ${contractError.message}`
      : null;
    const businessDiagnostic = getBusinessFailureDiagnostic(toolResult);

    return {
      ...processResult,
      status: finalStatus,
      stderr: appendDiagnostic(
        appendDiagnostic(processResult.stderr, contractDiagnostic),
        businessDiagnostic,
      ),
      toolResult,
      toolResultContract: {
        required: Boolean(toolResultRequired),
        expectedOutputType: toolResultExpectedOutputType,
        schemaValidated: Boolean(toolResultOutputSchema),
        status: contractStatus,
        schemaVersion: toolResult?.schemaVersion || null,
        outputType: toolResult?.outputType || null,
        byteLength: readResult?.byteLength || 0,
        businessSuccess: toolResult?.success ?? null,
        error: serializeContractError(contractError),
      },
    };
  } finally {
    resultTransport.cleanup();
  }
}

module.exports = {
  executeToolProcess,
};
