const DEV_BASELINE_STATES = Object.freeze({
  TRUSTED_BASELINE: 'TRUSTED_BASELINE',
  APPROVED_LINEAGE_INTERMEDIATE: 'APPROVED_LINEAGE_INTERMEDIATE',
  ALREADY_SYNCHRONIZED: 'ALREADY_SYNCHRONIZED',
  REJECTED: 'REJECTED',
});

function classifyDevBaseline({
  localDevSha,
  expectedLocalDevSha,
  expectedSynchronizedHeadSha,
  isAncestor,
} = {}) {
  if (localDevSha === expectedLocalDevSha) {
    return {
      state: DEV_BASELINE_STATES.TRUSTED_BASELINE,
      accepted: true,
      descendsFromTrustedBaseline: true,
      canFastForwardToApprovedHead: true,
    };
  }

  if (localDevSha === expectedSynchronizedHeadSha) {
    return {
      state: DEV_BASELINE_STATES.ALREADY_SYNCHRONIZED,
      accepted: true,
      descendsFromTrustedBaseline: true,
      canFastForwardToApprovedHead: true,
    };
  }

  const ancestryCheck = typeof isAncestor === 'function' ? isAncestor : () => false;
  const descendsFromTrustedBaseline = ancestryCheck(expectedLocalDevSha, localDevSha);
  const canFastForwardToApprovedHead = ancestryCheck(localDevSha, expectedSynchronizedHeadSha);
  const accepted = descendsFromTrustedBaseline && canFastForwardToApprovedHead;

  return {
    state: accepted
      ? DEV_BASELINE_STATES.APPROVED_LINEAGE_INTERMEDIATE
      : DEV_BASELINE_STATES.REJECTED,
    accepted,
    descendsFromTrustedBaseline,
    canFastForwardToApprovedHead,
  };
}

module.exports = {
  DEV_BASELINE_STATES,
  classifyDevBaseline,
};
