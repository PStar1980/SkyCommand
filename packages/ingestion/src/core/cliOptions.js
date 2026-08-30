const { randomUUID } = require('crypto');

function getArgValue(args, name) {
  const prefix = `--${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));

  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function getRepeatedArgValues(args, name) {
  const prefix = `--${name}=`;

  return args.filter((value) => value.startsWith(prefix)).map((value) => value.slice(prefix.length));
}

function getPositionalArgs(args) {
  return args.filter((value) => !String(value || '').startsWith('--'));
}

function looksNumeric(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function looksUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );
}

function isRecoveryControlValue(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return looksUuid(value)
    || ['INCREMENTAL', 'BACKFILL', 'FULL', 'TRUE', 'FALSE'].includes(normalized);
}

function getRequestedIndicators(args = []) {
  const values = [];

  values.push(...getRepeatedArgValues(args, 'indicator'));

  const indicatorsArg = getArgValue(args, 'indicators');

  if (indicatorsArg) {
    values.push(indicatorsArg);
  }

  const positionalArgs = getPositionalArgs(args);
  const firstPositional = positionalArgs.find(
    (value) => !looksNumeric(value) && !isRecoveryControlValue(value),
  );

  if (firstPositional) {
    values.push(firstPositional);
  }

  return values;
}


function getResumeRunId(args = []) {
  const explicit = getArgValue(args, 'resume-run-id');
  if (explicit) return looksUuid(explicit) ? explicit : null;
  return getPositionalArgs(args).find(looksUuid) || null;
}

function getRecoveryMode(args = []) {
  const explicit = getArgValue(args, 'mode');
  const positional = getPositionalArgs(args).find((value) =>
    ['INCREMENTAL', 'BACKFILL', 'FULL'].includes(String(value || '').trim().toUpperCase()),
  );
  return String(explicit || positional || 'INCREMENTAL').trim().toUpperCase();
}

function getRecoveryAssets(args = []) {
  const repeated = getRepeatedArgValues(args, 'asset');
  const values = repeated.length > 0 ? repeated : getRequestedIndicators(args);
  return [...new Set(values.flatMap((value) => String(value || '').split(/[\s,]+/))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean))];
}

function getConcurrency(args = [], envKey, fallback) {
  const explicitConcurrency = getArgValue(args, 'concurrency') || (envKey ? process.env[envKey] : null);

  if (explicitConcurrency) {
    return explicitConcurrency;
  }

  const positionalArgs = getPositionalArgs(args);
  const numericPositional = positionalArgs.find((value) => looksNumeric(value));

  return numericPositional || fallback;
}

function getRunId(args = [], envKey, prefix = 'ingestion-tool') {
  const explicitRunId = getArgValue(args, 'run-id') || (envKey ? process.env[envKey] : null);

  if (explicitRunId) {
    return explicitRunId;
  }

  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function printPipelineResult(result, args = []) {
  const summary = result.summary || {};

  console.log('');
  console.log(`${result.source || 'Ingestion'} ingestion summary`);
  console.log('------------------------------------------------------------');
  console.log(`  mode: ${result.mode || 'indicator_batch'}`);
  console.log(`  selected indicators: ${result.selectedIndicators ? 'yes' : 'no'}`);
  console.log(`  concurrency: ${result.concurrency || 'unknown'}`);
  console.log(`  batches: ${result.batchCount ?? 'unknown'}`);
  console.log(`  total: ${summary.total ?? 0}`);
  console.log(`  succeeded: ${summary.succeeded ?? 0}`);
  console.log(`  failed: ${summary.failed ?? 0}`);
  console.log(`  updated: ${summary.updated ?? 0}`);
  console.log(`  unchanged: ${summary.unchanged ?? 0}`);
  console.log(`  rows inserted: ${summary.rowsInserted ?? 0}`);
  console.log(`  rows updated: ${summary.rowsUpdated ?? 0}`);
  if (result.recoveryExecution?.request) {
    console.log(`  recovery request: ${result.recoveryExecution.request.recoveryRequestId}`);
    console.log(`  resumed from run: ${result.recoveryExecution.request.originalRunId}`);
    console.log(`  recovered assets: ${(result.recoveryExecution.request.requestedAssets || []).join(', ')}`);
  }

  if (hasFlag(args, 'json')) {
    console.log('');
    console.log(JSON.stringify(result, null, 2));
  }
}

module.exports = {
  getArgValue,
  getConcurrency,
  getRecoveryAssets,
  getRecoveryMode,
  getRequestedIndicators,
  getResumeRunId,
  getRunId,
  hasFlag,
  looksUuid,
  printPipelineResult,
};
