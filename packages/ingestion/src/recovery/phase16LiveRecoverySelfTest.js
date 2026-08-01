const assert = require('assert');

const live = require('./phase16LiveRecoveryClosure');
const workflow = require('./phase16WorkflowRecoveryClosure');

const prepare = live.parseArgs(['prepare', '--lane', 'workflow', '--fresh']);
assert.equal(prepare.command, 'prepare');
assert.equal(prepare.lane, 'WORKFLOW');
assert.equal(prepare.fresh, true);

const verify = live.parseArgs([
  'verify',
  '--lane=interactive',
  '--run-id=3aedeb06-6aed-4093-b14b-fda3c037aeb4',
]);
assert.equal(verify.command, 'verify');
assert.equal(verify.lane, 'INTERACTIVE');
assert.equal(verify.originalRunId, '3aedeb06-6aed-4093-b14b-fda3c037aeb4');

assert.throws(
  () => live.normalizeLane('manual'),
  /INTERACTIVE or WORKFLOW/,
);

assert.equal(workflow.EXPECTED_RUNTIME_PARAMETERS.length, 9);
assert.deepEqual(
  Object.keys(workflow.EXPECTED_NODE_PARAMETERS).sort(),
  ['boc_ingestion', 'fred_ingestion', 'statcan_ingestion'],
);

console.log('✅ Phase 16.7.3 live recovery closure contract self-test passed.');
