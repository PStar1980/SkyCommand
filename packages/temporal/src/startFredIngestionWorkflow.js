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

function getTailLineLimit() {
  const arg = cliArgs.find((value) => value.startsWith('--tail-lines='));
  const rawValue = arg
    ? arg.split('=')[1]
    : process.env.TEMPORAL_FRED_OUTPUT_TAIL_LINES;

  return parsePositiveInteger(rawValue, 120, 5000);
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

function printResult(result) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const activity = result?.activity || {};
  const tailLineLimit = getTailLineLimit();
  const stdoutTail = lastLines(activity.stdoutTail, tailLineLimit);
  const stderrTail = lastLines(activity.stderrTail, tailLineLimit);
  const statusIcon = result?.ok && activity?.ok ? '✅' : '⚠️';

  console.log('');
  console.log(`[Temporal] Workflow complete ${statusIcon}`);
  console.log('');
  console.log('Workflow');
  console.log(`  name: ${result.workflow || 'unknown'}`);
  console.log(`  started: ${result.startedAt || 'unknown'}`);
  console.log(`  completed: ${result.completedAt || 'unknown'}`);
  console.log('');
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

  if (!jsonMode) {
    console.log('[Temporal] Starting FRED ingestion workflow');
    console.log(`[Temporal] address=${config.address}`);
    console.log(`[Temporal] namespace=${config.namespace}`);
    console.log(`[Temporal] taskQueue=${config.taskQueue}`);
    console.log(`[Temporal] workflowId=${workflowId}`);
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
