const path = require('path');
const { randomUUID } = require('crypto');

const cliArgs = process.argv.slice(2);
const jsonMode = cliArgs.includes('--json');

require('dotenv').config({
  path: path.join(__dirname, '../../../.env'),
  quiet: jsonMode,
});

const { Connection, Client } = require('@temporalio/client');

const { getTemporalConfig, parsePositiveInteger } = require('./config');

function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = cliArgs.find((value) => value.startsWith(prefix));

  return arg ? arg.slice(prefix.length) : null;
}

function getTailLineLimit() {
  const rawValue = getArgValue('tail-lines') || process.env.TEMPORAL_FRED_OUTPUT_TAIL_LINES;

  return parsePositiveInteger(rawValue, 120, 5000);
}

function getConcurrency() {
  const rawValue = getArgValue('concurrency') || process.env.TEMPORAL_FRED_CONCURRENCY;

  return parsePositiveInteger(rawValue, 3, 10);
}

function getRequestedIndicators() {
  const values = [];

  for (const arg of cliArgs) {
    if (arg.startsWith('--indicator=')) {
      values.push(arg.slice('--indicator='.length));
    }

    if (arg.startsWith('--indicators=')) {
      values.push(...arg.slice('--indicators='.length).split(','));
    }
  }

  const seen = new Set();
  const indicators = [];

  for (const value of values) {
    const code = String(value || '').trim().toUpperCase();

    if (code && !seen.has(code)) {
      seen.add(code);
      indicators.push(code);
    }
  }

  return indicators;
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 'unknown';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function lastLines(value, limit) {
  if (!value) {
    return '';
  }

  const lines = String(value).replace(/\r\n/g, '\n').split('\n');
  return lines.slice(-limit).join('\n').trim();
}

function printLegacyActivityResult(result) {
  const activity = result?.activity || {};
  const tailLineLimit = getTailLineLimit();
  const stdoutTail = lastLines(activity.stdoutTail, tailLineLimit);
  const stderrTail = lastLines(activity.stderrTail, tailLineLimit);

  console.log('Activity');
  console.log(`  source: ${activity.source || 'unknown'}`);
  console.log(`  exit code: ${activity.code ?? 'unknown'}`);
  console.log(`  duration: ${formatDuration(activity.durationMs)}`);
  console.log(`  timeout: ${activity.didTimeout ? 'yes' : 'no'}`);
  console.log(`  timeout limit: ${formatDuration(activity.timeoutMs)}`);
  console.log(`  signal: ${activity.signal || 'none'}`);

  if (activity.command) {
    console.log(`  command: ${activity.command}`);
  }

  console.log('');
  console.log(`FRED output tail — latest ${tailLineLimit} line(s)`);
  console.log('------------------------------------------------------------');
  console.log(stdoutTail || 'No stdout tail returned.');

  if (stderrTail) {
    console.log('');
    console.log(`FRED stderr tail — latest ${tailLineLimit} line(s)`);
    console.log('------------------------------------------------------------');
    console.log(stderrTail);
  }
}

function printIndicatorBatchResult(result) {
  const summary = result.summary || {};
  const failures = Array.isArray(result.results)
    ? result.results.filter((item) => !item.ok)
    : [];
  const successfulResults = Array.isArray(result.results)
    ? result.results.filter((item) => item.ok)
    : [];

  console.log('FRED indicator batch');
  console.log(`  source: ${result.source || 'FRED'}`);
  console.log(`  selected indicators: ${result.selectedIndicators ? 'yes' : 'no'}`);
  console.log(`  concurrency: ${result.concurrency || 'unknown'}`);
  console.log(`  batches: ${result.batchCount ?? 'unknown'}`);
  console.log(`  total: ${summary.total ?? successfulResults.length + failures.length}`);
  console.log(`  succeeded: ${summary.succeeded ?? successfulResults.length}`);
  console.log(`  failed: ${summary.failed ?? failures.length}`);

  if (successfulResults.length > 0) {
    console.log('');
    console.log('Successful indicators');
    console.log('------------------------------------------------------------');

    for (const item of successfulResults) {
      console.log(
        `  ✅ ${item.indicatorCode}: ${formatDuration(item.durationMs)} (${item.finishedAt || 'done'})`,
      );
    }
  }

  if (failures.length > 0) {
    console.log('');
    console.log('Failed indicators');
    console.log('------------------------------------------------------------');

    for (const item of failures) {
      console.log(`  ⚠️ ${item.indicatorCode}: ${item.error || 'unknown error'}`);
    }
  }
}

function printResult(result) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const statusIcon = result?.ok ? '✅' : '⚠️';

  console.log('');
  console.log(`[Temporal] Workflow complete ${statusIcon}`);
  console.log('');
  console.log('Workflow');
  console.log(`  name: ${result.workflow || 'unknown'}`);
  console.log(`  mode: ${result.mode || 'legacy_activity'}`);
  console.log(`  started: ${result.startedAt || 'unknown'}`);
  console.log(`  completed: ${result.completedAt || 'unknown'}`);
  console.log('');

  if (result.mode === 'indicator_batch') {
    printIndicatorBatchResult(result);
    return;
  }

  printLegacyActivityResult(result);
}

async function main() {
  const config = getTemporalConfig();
  const workflowId = `${config.fredWorkflowIdPrefix}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const timeoutMs = parsePositiveInteger(
    process.env.TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS,
    30 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );
  const indicators = getRequestedIndicators();
  const concurrency = getConcurrency();

  if (!jsonMode) {
    console.log('[Temporal] Starting FRED ingestion workflow');
    console.log(`[Temporal] address=${config.address}`);
    console.log(`[Temporal] namespace=${config.namespace}`);
    console.log(`[Temporal] taskQueue=${config.taskQueue}`);
    console.log(`[Temporal] workflowId=${workflowId}`);
    console.log(`[Temporal] concurrency=${concurrency}`);

    if (indicators.length > 0) {
      console.log(`[Temporal] indicators=${indicators.join(',')}`);
    }
  }

  const connection = await Connection.connect({
    address: config.address,
  });

  const client = new Client({
    connection,
    namespace: config.namespace,
  });

  const handle = await client.workflow.start('fredIngestionWorkflow', {
    taskQueue: config.taskQueue,
    workflowId,
    args: [
      {
        workflowId,
        runSource: 'manual_temporal_pilot',
        timeoutMs,
        indicators,
        concurrency,
      },
    ],
  });

  if (!jsonMode) {
    console.log(`[Temporal] Started workflow: ${handle.workflowId}`);
    console.log('[Temporal] Waiting for result...');
  }

  const result = await handle.result();
  printResult(result);
}

main().catch((error) => {
  console.error('[Temporal] Failed to start/run FRED ingestion workflow');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
