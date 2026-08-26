const assert = require('node:assert/strict');
const {
  DEV_BASELINE_STATES,
  classifyDevBaseline,
} = require('./localRepoSyncLineage');

function sha(character) {
  return String(character).repeat(40);
}

function run() {
  const baseline = sha('1');
  const intermediate = sha('2');
  const approved = sha('3');
  const divergent = sha('4');
  const ahead = sha('5');

  assert.deepEqual(
    classifyDevBaseline({
      localDevSha: baseline,
      expectedLocalDevSha: baseline,
      expectedSynchronizedHeadSha: approved,
    }),
    {
      state: DEV_BASELINE_STATES.TRUSTED_BASELINE,
      accepted: true,
      descendsFromTrustedBaseline: true,
      canFastForwardToApprovedHead: true,
    },
  );

  assert.equal(
    classifyDevBaseline({
      localDevSha: approved,
      expectedLocalDevSha: baseline,
      expectedSynchronizedHeadSha: approved,
    }).state,
    DEV_BASELINE_STATES.ALREADY_SYNCHRONIZED,
  );

  const approvedEdges = new Set([
    `${baseline}->${intermediate}`,
    `${intermediate}->${approved}`,
  ]);
  const acceptedIntermediate = classifyDevBaseline({
    localDevSha: intermediate,
    expectedLocalDevSha: baseline,
    expectedSynchronizedHeadSha: approved,
    isAncestor: (ancestor, descendant) => approvedEdges.has(`${ancestor}->${descendant}`),
  });
  assert.equal(acceptedIntermediate.state, DEV_BASELINE_STATES.APPROVED_LINEAGE_INTERMEDIATE);
  assert.equal(acceptedIntermediate.accepted, true);
  assert.equal(acceptedIntermediate.descendsFromTrustedBaseline, true);
  assert.equal(acceptedIntermediate.canFastForwardToApprovedHead, true);

  const rejectedDivergence = classifyDevBaseline({
    localDevSha: divergent,
    expectedLocalDevSha: baseline,
    expectedSynchronizedHeadSha: approved,
    isAncestor: () => false,
  });
  assert.equal(rejectedDivergence.state, DEV_BASELINE_STATES.REJECTED);
  assert.equal(rejectedDivergence.accepted, false);

  const rejectedAhead = classifyDevBaseline({
    localDevSha: ahead,
    expectedLocalDevSha: baseline,
    expectedSynchronizedHeadSha: approved,
    isAncestor: (ancestor, descendant) => ancestor === baseline && descendant === ahead,
  });
  assert.equal(rejectedAhead.state, DEV_BASELINE_STATES.REJECTED);
  assert.equal(rejectedAhead.descendsFromTrustedBaseline, true);
  assert.equal(rejectedAhead.canFastForwardToApprovedHead, false);

  console.log('[SkyCommand] Local Repository Sync approved-lineage self-test passed.');
}

if (require.main === module) run();

module.exports = { run };
