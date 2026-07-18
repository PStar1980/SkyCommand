const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const {
  buildPromotionReadiness,
  parseAheadBehind,
  parseCommitRecord,
  parsePorcelainStatus,
} = require('./gitRepositoryStatusInspector');
const {
  GIT_REPOSITORY_STATUS_OUTPUT_TYPE,
  createGitRepositoryStatusFailureToolResult,
  createGitRepositoryStatusToolResult,
} = require('./gitRepositoryStatusResult');
const { validateToolResult } = require('../../tools/src/toolResultContract');

function branch({ name, sha, ahead = 0, behind = 0 } = {}) {
  return {
    name,
    localSha: sha,
    remoteSha: sha,
    ahead,
    behind,
    localMatchesRemote: true,
    latestLocalCommit: null,
    latestRemoteCommit: null,
  };
}

function repositoryState(overrides = {}) {
  return {
    gitDir: 'C:/Projects/SkyServer/.git',
    commonDir: 'C:/Projects/SkyServer/.git',
    indexLockPresent: false,
    mergeInProgress: false,
    rebaseInProgress: false,
    cherryPickInProgress: false,
    revertInProgress: false,
    bisectInProgress: false,
    operationInProgress: false,
    ...overrides,
  };
}

function relationship(overrides = {}) {
  return {
    localBranchesSynchronized: true,
    remoteBranchesSynchronized: true,
    localMainContainsDev: true,
    localDevContainsMain: true,
    mainContainsDev: true,
    devContainsMain: true,
    commonAncestorSha: 'a'.repeat(40),
    ...overrides,
  };
}

function run() {
  const outputSchema = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../tools/contracts/git_repository_status.v1.schema.json'),
      'utf8',
    ),
  );

  const workingTree = parsePorcelainStatus(
    [' M modified.js', 'A  staged.js', '?? new.js', 'UU conflict.js'].join('\n'),
  );
  assert.equal(workingTree.totalChanges, 4);
  assert.equal(workingTree.modified, 1);
  assert.equal(workingTree.staged, 1);
  assert.equal(workingTree.untracked, 1);
  assert.equal(workingTree.conflicted, 1);

  assert.deepEqual(parseAheadBehind('2\t3'), { ahead: 2, behind: 3 });
  assert.equal(
    parseCommitRecord(
      `${'a'.repeat(40)}\x1f${'a'.repeat(7)}\x1fHEAD -> dev\x1fTest commit\x1fPaul\x1f2026-07-18T12:00:00-04:00\x1e`,
    ).subject,
    'Test commit',
  );

  const sha = 'a'.repeat(40);
  const readyWorkingTree = parsePorcelainStatus(' M apps/api/src/service.js\n?? notes.txt');
  const ready = buildPromotionReadiness({
    currentBranch: 'dev',
    expectedBranch: 'dev',
    detachedHead: false,
    fetchSucceeded: true,
    workingTree: readyWorkingTree,
    repositoryState: repositoryState(),
    mainBranch: branch({ name: 'main', sha }),
    devBranch: branch({ name: 'dev', sha }),
    relationship: relationship(),
    remote: 'origin',
  });
  assert.equal(ready.outcome, 'READY');
  assert.equal(ready.readyForDevelopmentPromotion, true);
  assert.equal(ready.blockers.length, 0);
  assert.match(ready.advisories[0], /working-tree change/);

  const blocked = buildPromotionReadiness({
    currentBranch: 'main',
    expectedBranch: 'dev',
    detachedHead: false,
    fetchSucceeded: true,
    workingTree: parsePorcelainStatus('UU conflicted.js'),
    repositoryState: repositoryState({ indexLockPresent: true }),
    mainBranch: branch({ name: 'main', sha: 'b'.repeat(40) }),
    devBranch: {
      ...branch({ name: 'dev', sha }),
      behind: 2,
      localMatchesRemote: false,
    },
    relationship: relationship({ remoteBranchesSynchronized: false }),
    remote: 'origin',
  });
  const blockerCodes = blocked.blockers.map((item) => item.code);
  assert.equal(blocked.outcome, 'BLOCKED');
  assert.equal(blocked.readyForDevelopmentPromotion, false);
  assert.ok(blockerCodes.includes('WRONG_ACTIVE_BRANCH'));
  assert.ok(blockerCodes.includes('INDEX_LOCK_PRESENT'));
  assert.ok(blockerCodes.includes('MERGE_CONFLICTS_PRESENT'));
  assert.ok(blockerCodes.includes('LOCAL_DEV_BEHIND_REMOTE'));
  assert.ok(blockerCodes.includes('REMOTE_BRANCHES_NOT_SYNCHRONIZED'));

  const result = createGitRepositoryStatusToolResult({
    ok: true,
    outcome: 'READY',
    executionStrategy: 'CHECKOUT_FREE_INSPECTION',
    watcherSafe: true,
    repositoryCode: 'SkyServer',
    repositoryName: 'SkyServer',
    repositoryRoot: 'C:/Projects/SkyServer',
    remote: 'origin',
    expectedBranch: 'dev',
    currentBranch: 'dev',
    detachedHead: false,
    fetchPerformed: true,
    fetchSucceeded: true,
    workingTree: readyWorkingTree,
    branches: {
      main: branch({ name: 'main', sha }),
      dev: branch({ name: 'dev', sha }),
    },
    relationship: relationship(),
    repositoryState: repositoryState(),
    readyForDevelopmentPromotion: true,
    blockers: [],
    advisories: ready.advisories,
    recommendedActions: [],
    recentCommits: [
      {
        sha,
        shortSha: sha.slice(0, 7),
        decorations: 'HEAD -> dev, origin/dev, origin/main, main',
        subject: 'Phase 14.13 repository intelligence',
        authorName: 'Paul',
        authoredAt: '2026-07-18T12:00:00-04:00',
      },
    ],
    startedAt: '2026-07-18T16:00:00.000Z',
    completedAt: '2026-07-18T16:00:01.000Z',
    durationMs: 1000,
    profileCode: 'DEV_LOCAL',
  });

  assert.equal(result.outputType, GIT_REPOSITORY_STATUS_OUTPUT_TYPE);
  assert.equal(result.success, true);
  assert.equal(result.output.outcome, 'READY');
  assert.equal(result.output.readyForDevelopmentPromotion, true);
  assert.equal(result.output.workingTree.totalChanges, 2);
  validateToolResult(result, {
    expectedOutputType: GIT_REPOSITORY_STATUS_OUTPUT_TYPE,
    outputSchema,
  });

  const failure = createGitRepositoryStatusFailureToolResult({
    error: Object.assign(new Error('Not a Git repository.'), { code: 'NOT_A_GIT_WORK_TREE' }),
    startedAt: '2026-07-18T16:00:00.000Z',
    completedAt: '2026-07-18T16:00:01.000Z',
  });
  assert.equal(failure.success, false);
  assert.equal(failure.output.outcome, 'FAILED');
  assert.equal(failure.error.code, 'NOT_A_GIT_WORK_TREE');
  validateToolResult(failure, {
    expectedOutputType: GIT_REPOSITORY_STATUS_OUTPUT_TYPE,
    outputSchema,
  });

  console.log('[SkyCommand] Git repository status result self-test passed.');
}

if (require.main === module) run();

module.exports = { run };
