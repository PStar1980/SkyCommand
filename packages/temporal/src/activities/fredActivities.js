const path = require('path');

const {
  listFredIndicators,
  loadFredIndicator,
  normalizeIndicatorCode,
  parsePositiveInteger,
} = require('../../../ingestion/src/fred/fredBatchRunner');

const SKY_SERVER_ROOT = path.resolve(__dirname, '../../../..');
const DEFAULT_FRED_ACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_TAIL_LENGTH = 12000;

function tail(value, maxLength = OUTPUT_TAIL_LENGTH) {
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(text.length - maxLength);
}

function runNodeScript(scriptPath, args = [], options = {}) {
  const { spawn } = require('child_process');

  return new Promise((resolve, reject) => {
    const startedAt = new Date();
    const timeoutMs = parsePositiveInteger(
      options.timeoutMs,
      DEFAULT_FRED_ACTIVITY_TIMEOUT_MS,
      24 * 60 * 60 * 1000,
    );

    let stdout = '';
    let stderr = '';
    let didTimeout = false;

    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: SKY_SERVER_ROOT,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      shell: false,
    });

    const timeout = setTimeout(() => {
      didTimeout = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);

      const finishedAt = new Date();
      const result = {
        command: `${process.execPath} ${scriptPath}`,
        code,
        signal,
        didTimeout,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
      };

      if (didTimeout) {
        const error = new Error(`Script timed out after ${timeoutMs}ms: ${scriptPath}`);
        error.result = result;
        reject(error);
        return;
      }

      if (code !== 0) {
        const error = new Error(`Script exited with code ${code}: ${scriptPath}`);
        error.result = result;
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

async function listFredIndicatorsActivity(input = {}) {
  return listFredIndicators({
    indicators: input.indicators || [],
  });
}

async function loadFredIndicatorActivity(input = {}) {
  const indicatorCode = normalizeIndicatorCode(input.indicatorCode);

  console.log(`🔥 [Temporal:FRED] Processing ${indicatorCode}`);

  const result = await loadFredIndicator({
    indicatorCode,
    runId: input.workflowId || 'manual_temporal_pilot',
    workflowId: input.workflowId || 'manual_temporal_pilot',
    cleanupQuiet: true,
  });

  console.log(`✅ [Temporal:FRED] Loaded ${indicatorCode}`);

  return result;
}

async function loadFredMacroDataActivity(input = {}) {
  const scriptPath = path.join(
    SKY_SERVER_ROOT,
    'packages',
    'ingestion',
    'src',
    'loadFREDMacroData.js',
  );
  const timeoutMs = parsePositiveInteger(
    input.timeoutMs || process.env.TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS,
    DEFAULT_FRED_ACTIVITY_TIMEOUT_MS,
    24 * 60 * 60 * 1000,
  );
  const args = [];

  if (Array.isArray(input.indicators) && input.indicators.length > 0) {
    args.push(`--indicators=${input.indicators.join(',')}`);
  }

  if (input.concurrency || input.batchSize) {
    args.push(`--concurrency=${input.concurrency || input.batchSize}`);
  }

  const result = await runNodeScript(scriptPath, args, {
    timeoutMs,
    env: {
      TEMPORAL_WORKFLOW_ID: input.workflowId || '',
      TEMPORAL_RUN_SOURCE: input.runSource || 'manual_temporal_pilot',
    },
  });

  return {
    ok: true,
    source: 'FRED',
    timeoutMs,
    ...result,
  };
}

module.exports = {
  listFredIndicatorsActivity,
  loadFredIndicatorActivity,
  loadFredMacroDataActivity,
};
