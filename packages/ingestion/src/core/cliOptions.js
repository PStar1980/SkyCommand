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

function getRequestedIndicators(args = []) {
  const values = [];

  values.push(...getRepeatedArgValues(args, 'indicator'));

  const indicatorsArg = getArgValue(args, 'indicators');

  if (indicatorsArg) {
    values.push(indicatorsArg);
  }

  const positionalArgs = getPositionalArgs(args);
  const firstPositional = positionalArgs[0];

  if (firstPositional && !looksNumeric(firstPositional)) {
    values.push(firstPositional);
  }

  return values;
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

  if (hasFlag(args, 'json')) {
    console.log('');
    console.log(JSON.stringify(result, null, 2));
  }
}

module.exports = {
  getArgValue,
  getConcurrency,
  getRequestedIndicators,
  getRunId,
  hasFlag,
  printPipelineResult,
};
