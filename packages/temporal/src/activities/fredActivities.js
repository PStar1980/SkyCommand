const fs = require('fs');
const path = require('path');

const { getIndicators } = require('../../../ingestion/src/sources/indicators');
const { downloadFredCSV } = require('../../../ingestion/src/sources/fred');
const { normalizeFredCSV } = require('../../../ingestion/src/transform/csvNormalizer');
const { copyIntoTable } = require('../../../ingestion/src/loaders/copyLoader');
const { parsePositiveInteger } = require('../config');

const SKY_SERVER_ROOT = path.resolve(__dirname, '../../../..');
const DEFAULT_FRED_ACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_TAIL_LENGTH = 12000;
const MAX_FRED_INDICATORS_PER_RUN = 250;

function tail(value, maxLength = OUTPUT_TAIL_LENGTH) {
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(text.length - maxLength);
}

function normalizeIndicatorCode(value) {
  const code = String(value || '').trim().toUpperCase();

  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new Error(`Invalid FRED indicator code: ${value}`);
  }

  return code;
}

function normalizeIndicatorCodes(values = []) {
  const seen = new Set();
  const codes = [];

  for (const value of values) {
    const code = normalizeIndicatorCode(value);

    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }

  return codes;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanupTempDir(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return;
  }

  fs.rmSync(dir, {
    recursive: true,
    force: true,
  });
}

function getFredTempDir(workflowId, indicatorCode) {
  const safeWorkflowId = String(workflowId || 'manual')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120);
  const safeIndicatorCode = normalizeIndicatorCode(indicatorCode);

  return path.join(
    SKY_SERVER_ROOT,
    'packages',
    'ingestion',
    'src',
    'tmp',
    'temporal-fred',
    safeWorkflowId,
    safeIndicatorCode,
  );
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
  const selectedIndicators = Array.isArray(input.indicators)
    ? normalizeIndicatorCodes(input.indicators)
    : [];

  if (selectedIndicators.length > 0) {
    return {
      ok: true,
      source: 'FRED',
      selected: true,
      count: selectedIndicators.length,
      indicators: selectedIndicators.slice(0, MAX_FRED_INDICATORS_PER_RUN),
    };
  }

  const indicators = normalizeIndicatorCodes(getIndicators('FRED')).slice(
    0,
    MAX_FRED_INDICATORS_PER_RUN,
  );

  return {
    ok: true,
    source: 'FRED',
    selected: false,
    count: indicators.length,
    indicators,
  };
}

async function loadFredIndicatorActivity(input = {}) {
  const indicatorCode = normalizeIndicatorCode(input.indicatorCode);
  const workflowId = input.workflowId || 'manual_temporal_pilot';
  const startedAt = new Date();
  const tempDir = getFredTempDir(workflowId, indicatorCode);

  console.log(`🔥 [Temporal:FRED] Processing ${indicatorCode}`);

  ensureDir(tempDir);

  try {
    const filePath = await downloadFredCSV(indicatorCode, tempDir);

    normalizeFredCSV(filePath, indicatorCode);
    copyIntoTable(indicatorCode, filePath);

    const finishedAt = new Date();

    console.log(`✅ [Temporal:FRED] Loaded ${indicatorCode}`);

    return {
      ok: true,
      source: 'FRED',
      indicatorCode,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } finally {
    cleanupTempDir(tempDir);
  }
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

  const result = await runNodeScript(scriptPath, [], {
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
