const assert = require('node:assert/strict');
const { validateJsonSchema } = require('../../../../../packages/tools/src/jsonSchemaValidator');
const {
  GITHUB_DEV_PR_MERGE_OUTPUT_TYPE,
  createGithubDevPrMergeToolResult,
} = require('../../../../../packages/git/src/githubDevPrMergeResult');
const {
  GithubDevPrMergeError,
  executeGithubDevPrMerge,
  normalizePr,
  parseArguments,
  parseGithubRepository,
} = require('../../../../../packages/git/src/github_dev_pr_merge');

const DEV_SHA = 'a'.repeat(40);
const MAIN_SHA = 'b'.repeat(40);
const MERGED_SHA = 'c'.repeat(40);
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const repository = {
  repoCode: 'SkyCommand',
  repoName: 'SkyCommand',
  remoteUrl: 'https://github.com/PStar1980/SkyCommand.git',
  githubRepository: 'PStar1980/SkyCommand',
  mainBranch: 'main',
  devBranch: 'dev',
  rootPath: process.cwd(),
};

function input() {
  return {
    repositoryName: 'SkyCommand',
    expectedDevSha: DEV_SHA,
    workflowRunId: RUN_ID,
    expectedMainSha: MAIN_SHA,
  };
}

function basePr(overrides = {}) {
  return normalizePr({
    number: 42,
    url: 'https://github.com/PStar1980/SkyCommand/pull/42',
    headRefName: 'dev',
    baseRefName: 'main',
    headRefOid: DEV_SHA,
    baseRefOid: MAIN_SHA,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [],
    ...overrides,
  });
}

function adapterFor({ open = [basePr()], merged = [], baseBeforeSha = MAIN_SHA, afterMainSha = MERGED_SHA, createPr = null, viewPr = null } = {}) {
  let branchCalls = 0;
  let openPrs = open;
  return {
    authStatus() { return 'authenticated'; },
    async getBranchSha(branch) {
      branchCalls += 1;
      if (branch === 'dev') return DEV_SHA;
      return branchCalls >= 3 ? afterMainSha : baseBeforeSha;
    },
    async listOpenPrs() { return openPrs; },
    async listMergedPrs() { return merged; },
    async createPr() {
      if (createPr) createPr();
      openPrs = [basePr({ number: 43, url: 'https://github.com/PStar1980/SkyCommand/pull/43' })];
      return { url: 'https://github.com/PStar1980/SkyCommand/pull/43' };
    },
    async mergePr() { return { merged: true }; },
    async viewPr() { return viewPr || basePr({ state: 'MERGED', mergedAt: '2026-09-18T12:00:00.000Z', mergeCommit: { oid: MERGED_SHA } }); },
  };
}

async function expectCode(run, code) {
  await assert.rejects(run, (error) => error instanceof GithubDevPrMergeError && error.code === code);
}

async function run() {
  assert.deepEqual(parseArguments(['SkyCommand', DEV_SHA, RUN_ID, MAIN_SHA]), input());
  assert.throws(() => parseArguments(['SkyCommand', DEV_SHA, RUN_ID]), (error) => error.code === 'GITHUB_DEV_PR_MERGE_ARGUMENTS_INVALID');
  assert.equal(parseGithubRepository('https://github.com/PStar1980/SkyCommand.git'), 'PStar1980/SkyCommand');
  assert.equal(parseGithubRepository('git@github.com:PStar1980/SkyCommand.git'), 'PStar1980/SkyCommand');
  assert.throws(() => parseGithubRepository('https://gitlab.com/PStar1980/SkyCommand.git'), (error) => error.code === 'GITHUB_DEV_PR_MERGE_REMOTE_INVALID');

  const merged = await executeGithubDevPrMerge([], { input: input(), repository, githubAdapter: adapterFor() });
  assert.equal(merged.outcome, 'MERGED');
  assert.equal(merged.prNumber, 42);
  assert.equal(merged.mergedMainSha, MERGED_SHA);
  assert.equal(merged.verification.devHeadVerified, true);
  assert.equal(merged.verification.baseHeadVerified, true);

  let createCount = 0;
  const created = await executeGithubDevPrMerge([], {
    input: input(),
    repository,
    githubAdapter: adapterFor({ open: [], createPr: () => { createCount += 1; } }),
  });
  assert.equal(created.outcome, 'MERGED');
  assert.equal(created.prCreated, true);
  assert.equal(createCount, 1);

  const alreadyMerged = await executeGithubDevPrMerge([], {
    input: input(),
    repository,
    githubAdapter: adapterFor({ open: [], merged: [basePr({ state: 'MERGED', mergedAt: '2026-09-18T11:00:00.000Z' })] }),
  });
  assert.equal(alreadyMerged.outcome, 'ALREADY_MERGED');

  await expectCode(
    () => executeGithubDevPrMerge([], { input: input(), repository, githubAdapter: adapterFor({ open: [basePr(), basePr({ number: 43 })] }) }),
    'GITHUB_DEV_PR_MERGE_DUPLICATE_PR',
  );
  await expectCode(
    () => executeGithubDevPrMerge([], { input: { ...input(), expectedDevSha: 'd'.repeat(40) }, repository, githubAdapter: adapterFor() }),
    'GITHUB_DEV_PR_MERGE_HEAD_MISMATCH',
  );
  await expectCode(
    () => executeGithubDevPrMerge([], { input: input(), repository, githubAdapter: adapterFor({ open: [basePr({ headRefOid: 'd'.repeat(40) })] }) }),
    'GITHUB_DEV_PR_MERGE_PR_HEAD_MISMATCH',
  );
  await expectCode(
    () => executeGithubDevPrMerge([], { input: input(), repository, githubAdapter: adapterFor({ open: [basePr({ mergeStateStatus: 'BLOCKED' })] }) }),
    'GITHUB_DEV_PR_MERGE_BRANCH_PROTECTION',
  );
  await expectCode(
    () => executeGithubDevPrMerge([], { input: input(), repository, githubAdapter: adapterFor({ open: [basePr({ statusCheckRollup: [{ status: 'IN_PROGRESS' }] })] }) }),
    'GITHUB_DEV_PR_MERGE_CHECKS_PENDING',
  );
  await expectCode(
    () => executeGithubDevPrMerge([], { input: input(), repository, githubAdapter: adapterFor({ open: [basePr({ headRefName: 'feature' })] }) }),
    'GITHUB_DEV_PR_MERGE_PR_DIRECTION_INVALID',
  );
  await expectCode(
    () => executeGithubDevPrMerge([], { input: input(), repository, githubAdapter: adapterFor({ open: [], merged: [], baseBeforeSha: 'e'.repeat(40) }) }),
    'GITHUB_DEV_PR_MERGE_BASE_CHANGED',
  );

  const envelope = createGithubDevPrMergeToolResult(merged);
  assert.equal(envelope.outputType, GITHUB_DEV_PR_MERGE_OUTPUT_TYPE);
  assert.equal(envelope.success, true);
  assert.equal(JSON.stringify(envelope).includes('gho_'), false);
  validateJsonSchema(envelope.output, require('../../../../../packages/tools/contracts/github_dev_pr_merge_summary.v1.schema.json'), { schemaName: GITHUB_DEV_PR_MERGE_OUTPUT_TYPE });

  console.log('[github-dev-pr-merge:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
