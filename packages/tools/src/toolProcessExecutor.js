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


function buildProcessEnvelopeTelemetry(toolResult, childProcessDurationMs) {
  const output = toolResult?.output;
  const transport = output && typeof output === 'object' && !Array.isArray(output)
    ? output.transportTelemetry
    : null;
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)) {
    return null;
  }

  const childDuration = Number(childProcessDurationMs);
  const transportDuration = Number(transport.instrumentedTotalMs);
  const transportStartUptime = Number(transport.processUptimeAtStartMs);
  const transportCompleteUptime = Number(transport.processUptimeAtCompleteMs);
  if (!Number.isFinite(childDuration) || !Number.isFinite(transportDuration)) {
    return null;
  }

  const preTransportMs = Number.isFinite(transportStartUptime)
    ? Math.max(0, transportStartUptime)
    : null;
  const postTransportMs = Number.isFinite(transportCompleteUptime)
    ? Math.max(0, childDuration - transportCompleteUptime)
    : null;

  return {
    childProcessDurationMs: Math.max(0, childDuration),
    transportInstrumentedTotalMs: Math.max(0, transportDuration),
    processStartToTransportStartMs: preTransportMs,
    transportCompleteToProcessCloseMs: postTransportMs,
    uninstrumentedProcessEnvelopeMs: Math.max(0, childDuration - transportDuration),
  };
}

function attachProcessEnvelopeTelemetry(toolResult, childProcessDurationMs) {
  const telemetry = buildProcessEnvelopeTelemetry(toolResult, childProcessDurationMs);
  if (!telemetry || !toolResult) return toolResult;

  return {
    ...toolResult,
    metadata: {
      ...(toolResult.metadata || {}),
      processEnvelopeTelemetry: telemetry,
    },
  };
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
  toolResultMaxBytes,
  toolResultExpectedOutputType = null,
  toolResultOutputSchema = null,
  rootDirectory,
} = {}) {
  let resultTransport = null;
  let transportInitializationError = null;

  try {
    resultTransport = createToolResultTransport({
      executionId,
      toolCode,
      maxBytes: toolResultMaxBytes,
      expectedOutputType: toolResultExpectedOutputType,
      outputSchema: toolResultOutputSchema,
      rootDirectory,
    });
  } catch (error) {
    transportInitializationError = error;
    resultTransport = {
      cleanup() {},
      getEnvironment() { return {}; },
      readResult() {
        return {
          status: 'UNAVAILABLE',
          toolResult: null,
          byteLength: 0,
        };
      },
    };
  }

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
    let contractError = transportInitializationError;

    if (!contractError) {
      try {
        readResult = resultTransport.readResult();
      } catch (error) {
        contractError = error;
      }
    } else {
      readResult = resultTransport.readResult();
    }

    const toolResult = attachProcessEnvelopeTelemetry(
      readResult?.toolResult || null,
      processResult.durationMs,
    );
    const businessResultFailed = toolResult?.success === false;
    const finalStatus =
      processResult.processStatus === 'SUCCESS' && !businessResultFailed
        ? 'SUCCESS'
        : 'FAILED';
    const contractStatus = contractError
      ? 'INVALID'
      : readResult?.status || 'NOT_EMITTED';
    const contractDiagnostic = contractError
      ? `[SkyCommand ToolResult Warning] ${contractError.code}: ${contractError.message}`
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
        required: false,
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
