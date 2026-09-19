const assert = require('node:assert/strict');
const {
  assertRemoteHeadsMatchExpected,
  reconcileRemoteTrackingRefs,
} = require('../../../../../packages/git/src/local_repo_sync');

const TARGET = 'a'.repeat(40);
const STALE_MAIN = 'b'.repeat(40);
const STALE_DEV = 'c'.repeat(40);
const MAIN_REF = 'refs/remotes/origin/main';
const DEV_REF = 'refs/remotes/origin/dev';

function state() {
  return {};
}

function run() {
  const staleRefs = { [MAIN_REF]: STALE_MAIN, [DEV_REF]: STALE_DEV };
  const staleUpdates = [];
  const staleState = state();
  reconcileRemoteTrackingRefs({
    remote: 'origin',
    mainBranch: 'main',
    devBranch: 'dev',
    expectedSynchronizedHeadSha: TARGET,
    cwd: process.cwd(),
    state: staleState,
    getRefs: () => ({ ...staleRefs }),
    updateRef: ({ ref, targetSha, expectedOldSha }) => {
      staleUpdates.push({ ref, targetSha, expectedOldSha });
      staleRefs[ref] = targetSha;
    },
  });
  assert.deepEqual(staleUpdates, [
    { ref: MAIN_REF, targetSha: TARGET, expectedOldSha: STALE_MAIN },
    { ref: DEV_REF, targetSha: TARGET, expectedOldSha: STALE_DEV },
  ]);
  assert.equal(staleState.trackingMainBeforeSha, STALE_MAIN);
  assert.equal(staleState.trackingDevBeforeSha, STALE_DEV);
  assert.equal(staleState.trackingMainAfterSha, TARGET);
  assert.equal(staleState.trackingDevAfterSha, TARGET);
  assert.equal(staleState.trackingRefsSynchronized, true);

  const currentUpdates = [];
  const currentState = state();
  reconcileRemoteTrackingRefs({
    remote: 'origin',
    mainBranch: 'main',
    devBranch: 'dev',
    expectedSynchronizedHeadSha: TARGET,
    cwd: process.cwd(),
    state: currentState,
    getRefs: () => ({ [MAIN_REF]: TARGET, [DEV_REF]: TARGET }),
    updateRef: () => currentUpdates.push(true),
  });
  assert.deepEqual(currentUpdates, []);
  assert.equal(currentState.trackingRefsSynchronized, true);

  const missingRefs = {};
  const missingUpdates = [];
  const missingState = state();
  reconcileRemoteTrackingRefs({
    remote: 'origin',
    mainBranch: 'main',
    devBranch: 'dev',
    expectedSynchronizedHeadSha: TARGET,
    cwd: process.cwd(),
    state: missingState,
    getRefs: () => ({ ...missingRefs }),
    updateRef: ({ ref, targetSha, expectedOldSha }) => {
      missingUpdates.push({ ref, targetSha, expectedOldSha });
      missingRefs[ref] = targetSha;
    },
  });
  assert.equal(missingUpdates[0].expectedOldSha, null);
  assert.equal(missingUpdates[1].expectedOldSha, null);
  assert.equal(missingState.trackingRefsSynchronized, true);

  const concurrentState = state();
  assert.throws(
    () => reconcileRemoteTrackingRefs({
      remote: 'origin',
      mainBranch: 'main',
      devBranch: 'dev',
      expectedSynchronizedHeadSha: TARGET,
      cwd: process.cwd(),
      state: concurrentState,
      getRefs: () => ({ [MAIN_REF]: STALE_MAIN, [DEV_REF]: STALE_DEV }),
      updateRef: () => {
        const error = new Error('compare-and-swap rejected');
        error.code = 'LOCAL_REPOSITORY_SYNC_BLOCKED_REMOTE_TRACKING_CHANGED';
        throw error;
      },
    }),
    (error) => error.code === 'LOCAL_REPOSITORY_SYNC_BLOCKED_REMOTE_TRACKING_CHANGED',
  );

  assert.throws(
    () => assertRemoteHeadsMatchExpected({
      remoteHeads: { main: STALE_MAIN, dev: TARGET },
      mainBranch: 'main',
      devBranch: 'dev',
      expectedSynchronizedHeadSha: TARGET,
      state: concurrentState,
    }),
    (error) => error.code === 'LOCAL_REPOSITORY_SYNC_BLOCKED_REMOTE_CHANGED_DURING_SYNC',
  );

  console.log('[local-repo-sync-tracking-refs:self-test] PASS');
}

run();
