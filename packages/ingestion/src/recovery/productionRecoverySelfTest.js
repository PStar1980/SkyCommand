const {
  getRecoveryCliOptions,
} = require('./productionRecovery');
const {
  getRequestedIndicators,
  getResumeRunId,
} = require('../core/cliOptions');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const runId = '123e4567-e89b-42d3-a456-426614174000';
  const named = getRecoveryCliOptions([
    `--resume-run-id=${runId}`,
    '--asset=DFF',
    '--asset=CPIAUCSL',
    '--mode=incremental',
    '--force-refresh',
  ]);
  assert(named.originalRunId === runId, 'Named resume run ID was not parsed.');
  assert(named.failedOnly === true, 'Recovery should default to failed-only.');
  assert(JSON.stringify(named.assets) === JSON.stringify(['DFF', 'CPIAUCSL']), 'Repeated asset parsing failed.');
  assert(named.modeCode === 'INCREMENTAL', 'Recovery mode normalization failed.');
  assert(named.forceRefresh === true, 'Force-refresh flag was not parsed.');

  const positional = ['3', runId, 'FULL', 'true'];
  assert(getResumeRunId(positional) === runId, 'Tool-position resume run ID was not parsed.');
  assert(getRequestedIndicators(positional).length === 0, 'Recovery control values leaked into indicator selection.');

  const subset = getRecoveryCliOptions(['DFF,CPIAUCSL', '1', runId, 'INCREMENTAL', 'false']);
  assert(JSON.stringify(subset.assets) === JSON.stringify(['DFF', 'CPIAUCSL']), 'Tool-position failed subset was not parsed.');
  assert(subset.forceRefresh === false, 'Concurrency value 1 must not be interpreted as force refresh.');
  const forced = getRecoveryCliOptions(['1', runId, 'INCREMENTAL', 'true']);
  assert(forced.forceRefresh === true, 'Tool-position force refresh was not parsed.');

  assert(getRecoveryCliOptions(['DFF', '1']) === null, 'Normal ingestion args must not enter recovery mode.');
  console.log('✅ Phase 16.7.2 production recovery CLI contract self-test passed.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
