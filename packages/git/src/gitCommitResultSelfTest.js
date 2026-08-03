const assert = require('node:assert/strict');
const {
  GIT_COMMIT_OUTPUT_TYPE,
  createGitCommitToolResult,
  parseGitStatusPorcelain,
} = require('./gitCommitResult');

function run() {
  const parsed = parseGitStatusPorcelain(
    ' M packages/a.js\nA  packages/b.js\n?? packages/c.js\nR  old.js -> new.js\nD  removed.js\n',
  );
  assert.equal(parsed.changedFiles, 5);
  assert.deepEqual(parsed.changes, {
    added: 1,
    modified: 1,
    deleted: 1,
    renamed: 1,
    untracked: 1,
    other: 0,
  });
  const result = createGitCommitToolResult({
    ok: true,
    outcome: 'PUSHED',
    repositoryCode: 'SkyCommand',
    repositoryName: 'SkyCommand',
    repositoryRoot: 'C:/Projects/SkyCommand',
    branch: 'dev',
    commitMessage: 'Test',
    previousHeadSha: '1'.repeat(40),
    currentHeadSha: '2'.repeat(40),
    commitSha: '2'.repeat(40),
    durationMs: 10,
    changedFiles: parsed.changedFiles,
    changes: parsed.changes,
    fetched: true,
    switchedBranch: true,
    pulled: true,
    staged: true,
    committed: true,
    pushed: true,
  });
  assert.equal(result.outputType, GIT_COMMIT_OUTPUT_TYPE);
  assert.equal(result.output.outcome, 'PUSHED');
  assert.equal(result.output.changedFiles, 5);
  const noChanges = createGitCommitToolResult({
    ok: true,
    outcome: 'NO_CHANGES',
    repositoryCode: 'SkyCommand',
    changes: {},
  });
  assert.equal(noChanges.success, true);
  assert.equal(noChanges.output.commitSha, null);
  console.log('[SkyCommand] Git commit result self-test passed.');
}
if (require.main === module) run();
module.exports = { run };
