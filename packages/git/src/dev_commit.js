#!/usr/bin/env node

/**
 * Commits and pushes existing repository changes to the configured dev branch.
 * Repository-map and repository-zip generation are intentionally separate tools
 * and can be orchestrated before this tool by a SkyCommand workflow.
 *
 * Usage: node dev_commit.js <repoName> <commitMessage>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: sleep } = require('timers/promises');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createGitCommitFailureToolResult,
  createGitCommitToolResult,
  parseGitStatusPorcelain,
} = require('./gitCommitResult');
const { getTemporalConfig } = require('../../temporal/src/config');
const { DEFAULT_HOST_AGENT_TASK_QUEUE } = require('../../host-agent/src/config');
const { createGitPerformanceTelemetry } = require('./gitPerformanceTelemetry');

const SKY_SERVER_ROOT = path.resolve(__dirname, '../../..');
const TOOL_CODE = 'dev_commit';
const OUTPUT_TYPE = 'git_commit_summary.v1';
const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 60000;
const DOCKER_LOCAL_PROFILE = 'DOCKER_LOCAL';
dotenv.config({ path: path.join(SKY_SERVER_ROOT, '.env') });
const { pool } = require('../../db/src/connection');

const ORCHESTRATED_EXECUTION = Boolean(
  process.env.SKYCOMMAND_TOOL_RESULT_PATH || process.env.SKYCOMMAND_EXECUTION_ID,
);
const GIT_COMMAND_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.SKYCOMMAND_GIT_COMMAND_TIMEOUT_MS || DEFAULT_GIT_COMMAND_TIMEOUT_MS),
);

const PROFILE_CODE =
  process.env.SKYCOMMAND_DEV_COMMIT_PROFILE ||
  process.env.SKYCOMMAND_CONFIG_PROFILE || process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYCOMMAND_CORE_PROFILE || process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

function toBoolean(value) {
  return (
    value === true ||
    value === 1 ||
    String(value || '').trim().toLowerCase() === 'true' ||
    String(value || '').trim() === '1'
  );
}

function isDockerRuntime() {
  return String(process.env.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase() === 'docker';
}

function isDockerLocalProfile(profileCode = PROFILE_CODE) {
  return String(profileCode || '').trim().toUpperCase() === DOCKER_LOCAL_PROFILE;
}

function getHostAgentTaskQueue() {
  return (
    String(process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE).trim() ||
    DEFAULT_HOST_AGENT_TASK_QUEUE
  );
}

function fail(message) {
  throw new Error(message);
}

function getCommandEnvironment() {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
  };

  if (isDockerLocalProfile()) {
    env.GIT_OPTIONAL_LOCKS = '0';
  }

  return env;
}

function runCommand(command, args, cwd, label = command) {
  console.log(`> ${label} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    env: getCommandEnvironment(),
  });
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    fail(
      timedOut
        ? `${label} command timed out after ${GIT_COMMAND_TIMEOUT_MS} ms: ${label} ${args.join(' ')}`
        : `${label} command failed: ${result.error.message}`,
    );
  }
  if (result.status !== 0) fail(`${label} command failed: ${label} ${args.join(' ')}`);
}
function runGit(args, cwd) {
  runCommand('git', args, cwd, 'git');
}

function runGitCaptured(args, cwd) {
  console.log(`> git ${args.join(' ')}`);
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    env: getCommandEnvironment(),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`Git command failed: ${result.error.message}`);
  return result;
}

function isRetryableGitIndexFailure(result) {
  const message = `${result?.stdout || ''}
${result?.stderr || ''}`.toLowerCase();
  return (
    message.includes('unable to write new index file') ||
    message.includes('index.lock') ||
    message.includes('could not lock index') ||
    message.includes('another git process seems to be running')
  );
}

async function stageChangesWithRetry(cwd) {
  const delaysMs = [0, 500, 1000, 2000];

  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    if (delaysMs[attempt] > 0) {
      console.log(`⏳ Git index is busy; retrying git add -A in ${delaysMs[attempt]} ms...`);
      await sleep(delaysMs[attempt]);
    }

    const result = runGitCaptured(['add', '-A'], cwd);
    if (result.status === 0) return;
    if (!isRetryableGitIndexFailure(result) || attempt === delaysMs.length - 1) {
      fail('git command failed: git add -A');
    }
  }
}

function getAheadCount(cwd, branch) {
  const output = getGitOutput(['rev-list', '--count', `origin/${branch}..${branch}`], cwd);
  const parsed = Number.parseInt(output, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
function getGitOutput(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    env: getCommandEnvironment(),
  });
  if (result.error) fail(`Git command failed: ${result.error.message}`);
  if (result.status !== 0) fail(`Git command failed: git ${args.join(' ')}`);
  return result.stdout.trim();
}

function getHeadState(cwd) {
  const output = getGitOutput(['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], cwd);
  const [headSha, branch] = output.split(/\r?\n/);
  if (!headSha || !branch) fail('Unable to resolve Git HEAD and current branch.');
  return { headSha: headSha.trim(), branch: branch.trim() };
}

function isGitAncestor(ancestorRef, descendantRef, cwd) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestorRef, descendantRef], {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    env: getCommandEnvironment(),
  });

  if (result.error) fail(`Git command failed: ${result.error.message}`);
  if (![0, 1].includes(result.status)) {
    fail(`Git command failed: git merge-base --is-ancestor ${ancestorRef} ${descendantRef}`);
  }

  return result.status === 0;
}

async function listAvailableRepositories() {
  const result = await pool.query(
    `SELECT r.repo_code FROM core.repositories r JOIN core.repository_paths rp ON rp.repo_id = r.repo_id JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id WHERE cp.profile_code = $1 AND cp.active = TRUE AND r.active = TRUE AND rp.active = TRUE ORDER BY r.display_order, r.repo_code`,
    [PROFILE_CODE],
  );
  return result.rows.map((row) => row.repo_code);
}

async function loadRepository(repoName) {
  if (!repoName) fail('Missing repoName. Usage: node dev_commit.js <repoName> <commitMessage>');
  const result = await pool.query(
    `SELECT r.repo_code, r.repo_name, r.main_branch, r.dev_branch, rp.root_path FROM core.repositories r JOIN core.repository_paths rp ON rp.repo_id = r.repo_id JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id WHERE cp.profile_code = $1 AND cp.active = TRUE AND r.active = TRUE AND rp.active = TRUE AND (LOWER(r.repo_code) = LOWER($2) OR LOWER(r.repo_name) = LOWER($2)) LIMIT 1`,
    [PROFILE_CODE, repoName],
  );
  if (result.rowCount === 0)
    fail(
      `Unknown repo '${repoName}'. Available repos: ${(await listAvailableRepositories()).join(', ')}`,
    );
  const repo = result.rows[0];
  if (!repo.root_path || !fs.existsSync(repo.root_path))
    fail(`Repo path does not exist: ${repo.root_path}`);
  return {
    repoCode: repo.repo_code,
    repoName: repo.repo_name,
    mainBranch: repo.main_branch || 'main',
    devBranch: repo.dev_branch || 'dev',
    rootPath: repo.root_path,
  };
}

async function executeDevCommitViaHostAgent(args = []) {
  const transportStartedUptimeMs = process.uptime() * 1000;
  const transportTelemetry = createGitPerformanceTelemetry();
  const positional = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const [repoName, commitMessage] = positional;

  if (!toBoolean(process.env.SKYCOMMAND_HOST_AGENT_ENABLED)) {
    fail(
      'SkyCommand Host Agent dispatch is disabled. Set SKYCOMMAND_HOST_AGENT_ENABLED=true and start npm run host-agent before routing Dev Commit to the host.',
    );
  }

  const { temporal, hostTaskQueue, workflowId } = transportTelemetry.measureSync(
    'TEMPORAL_DISPATCH_SETUP',
    'Temporal configuration / dispatch setup',
    () => ({
      temporal: getTemporalConfig(),
      hostTaskQueue: getHostAgentTaskQueue(),
      workflowId: [
        'skycommand-host-dev-commit',
        String(repoName || 'repository').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80),
        randomUUID().slice(0, 8),
      ].join('-'),
    }),
  );
  const { Connection, Client } = transportTelemetry.measureSync(
    'TEMPORAL_CLIENT_LOAD',
    'Temporal client module load',
    () => require('@temporalio/client'),
  );

  console.log('');
  console.log(`[SkyCommand Host Agent] Dispatching ${TOOL_CODE} to host task queue ${hostTaskQueue}`);
  console.log(`[SkyCommand Host Agent] Temporal address=${temporal.address}`);
  console.log(`[SkyCommand Host Agent] workflowId=${workflowId}`);

  let connection = null;
  let routedResult = null;
  let routedError = null;

  try {
    connection = await transportTelemetry.measure(
      'TEMPORAL_CONNECTION',
      'Temporal connection',
      () => Connection.connect({ address: temporal.address }),
    );
    const client = new Client({ connection, namespace: temporal.namespace });
    const response = await transportTelemetry.measure(
      'HOST_WORKFLOW_DISPATCH_WAIT',
      'Host workflow dispatch + wait',
      () =>
        client.workflow.execute('skyCommandHostAgentToolWorkflow', {
          taskQueue: temporal.taskQueue,
          workflowId,
          args: [
            {
              toolCode: TOOL_CODE,
              repoName,
              commitMessage,
              hostTaskQueue,
            },
          ],
        }),
    );

    if (!response?.ok) {
      const remoteError = response?.error || {};
      const error = new Error(remoteError.message || 'SkyCommand Host Agent Dev Commit failed.');
      error.code = remoteError.code || 'DEV_COMMIT_HOST_AGENT_FAILED';
      throw error;
    }

    routedResult = {
      ...(response.result || {}),
      transport: 'temporal_host_agent',
      executionTarget: 'HOST',
    };
  } catch (error) {
    routedError = error;
  } finally {
    if (connection) {
      try {
        await transportTelemetry.measure(
          'TEMPORAL_CONNECTION_SHUTDOWN',
          'Temporal connection shutdown',
          () => connection.close(),
        );
      } catch (closeError) {
        routedError ||= closeError;
      }
    }
  }

  const transportSnapshot = {
    ...transportTelemetry.snapshot(),
    processUptimeAtStartMs: transportStartedUptimeMs,
    processUptimeAtCompleteMs: process.uptime() * 1000,
  };
  if (routedError) {
    routedError.transportTelemetry = transportSnapshot;
    throw routedError;
  }

  return {
    ...routedResult,
    transportTelemetry: transportSnapshot,
  };
}

async function executeDevCommitRouted(args = []) {
  if ((isDockerRuntime() || isDockerLocalProfile()) && toBoolean(process.env.SKYCOMMAND_HOST_AGENT_ENABLED)) {
    return executeDevCommitViaHostAgent(args);
  }

  return executeDevCommit(args);
}

async function executeDevCommit(args = [], options = {}) {
  const startedAt = new Date().toISOString();
  const telemetry = createGitPerformanceTelemetry();
  const orchestratedExecution =
    options.orchestratedExecution === undefined
      ? ORCHESTRATED_EXECUTION
      : Boolean(options.orchestratedExecution);
  const executionTarget = String(options.executionTarget || (isDockerRuntime() ? 'DOCKER' : 'HOST'));
  const transport = String(options.transport || 'git_cli');
  const [repoName, commitMessage] = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  if (!commitMessage || commitMessage.trim() === '')
    fail('Missing commitMessage. Usage: node dev_commit.js <repoName> <commitMessage>');
  const repo = await telemetry.measure(
    'CONFIGURATION_REPOSITORY_RESOLUTION',
    'Configuration / repository resolution',
    () => loadRepository(repoName),
  );

  console.log('');
  console.log(`🚀 Starting dev commit for repo: ${repo.repoCode}`);
  console.log(`📂 Repo path: ${repo.rootPath}`);
  console.log(`🌿 Dev branch: ${repo.devBranch}`);
  console.log('🧩 Repository map and zip generation are handled by separate workflow nodes.');
  console.log('');

  const { previousHeadSha, currentBranch } = telemetry.measureSync(
    'LOCAL_HEAD_INSPECTION',
    'Local head / branch inspection',
    () => {
      const headState = getHeadState(repo.rootPath);
      return { previousHeadSha: headState.headSha, currentBranch: headState.branch };
    },
  );

  telemetry.measureSync('REMOTE_REFRESH', 'Remote refresh', () => {
    runGit(['fetch', '--prune', 'origin'], repo.rootPath);
  });

  let switchedBranch = false;
  let pulled = false;

  if (orchestratedExecution) {
    if (currentBranch !== repo.devBranch) {
      fail(
        `Watcher-safe Dev Commit requires the repository to already be on ${repo.devBranch}. Current branch: ${currentBranch}. Switch branches before starting the workflow.`,
      );
    }

    telemetry.measureSync('WATCHER_SAFE_GUARDRAILS', 'Watcher-safe branch guardrails', () => {
      const remoteDevHeadSha = getGitOutput(
        ['rev-parse', `refs/remotes/origin/${repo.devBranch}`],
        repo.rootPath,
      );

      if (!isGitAncestor(remoteDevHeadSha, previousHeadSha, repo.rootPath)) {
        fail(
          `Local ${repo.devBranch} is behind or diverged from origin/${repo.devBranch}. Pull or reconcile the branch before starting the workflow.`,
        );
      }
    });

    console.log('🛡️ Watcher-safe mode: branch switching and pull-based working-tree rewrites are disabled.');
  } else {
    telemetry.measureSync('BRANCH_PREPARATION', 'Branch selection / pull', () => {
      runGit(['switch', repo.devBranch], repo.rootPath);
      switchedBranch = currentBranch !== repo.devBranch;
      runGit(['pull', '--ff-only', 'origin', repo.devBranch], repo.rootPath);
      pulled = true;
    });
  }

  const status = telemetry.measureSync('WORKING_TREE_SCAN', 'Working-tree scan', () =>
    getGitOutput(['status', '--porcelain'], repo.rootPath),
  );
  const changeSummary = parseGitStatusPorcelain(status);

  if (status === '') {
    const aheadCount = telemetry.measureSync('AHEAD_CHECK', 'Unpushed commit check', () =>
      getAheadCount(repo.rootPath, repo.devBranch),
    );
    let pushedExistingCommit = false;

    if (aheadCount > 0) {
      console.log(`📤 Working tree is clean, but ${aheadCount} local commit(s) still need to be pushed.`);
      telemetry.measureSync('REMOTE_PUSH', 'Remote push', () => {
        runGit(['push', 'origin', repo.devBranch], repo.rootPath);
      });
      pushedExistingCommit = true;
    }

    const currentHeadSha = telemetry.measureSync('FINAL_HEAD_READ', 'Final head read', () =>
      getGitOutput(['rev-parse', 'HEAD'], repo.rootPath),
    );
    const completedAt = new Date().toISOString();
    console.log(
      pushedExistingCommit
        ? '🎉 Existing local commit(s) pushed successfully.'
        : '✨ Nothing to commit — working directory clean.',
    );
    return {
      ok: true,
      outcome: pushedExistingCommit ? 'PUSHED_EXISTING' : 'NO_CHANGES',
      repositoryCode: repo.repoCode,
      repositoryName: repo.repoName,
      repositoryRoot: repo.rootPath,
      branch: repo.devBranch,
      remote: 'origin',
      commitMessage,
      previousHeadSha,
      currentHeadSha,
      commitSha: null,
      startedAt,
      completedAt,
      durationMs: Math.max(0, new Date(completedAt) - new Date(startedAt)),
      ...changeSummary,
      fetched: true,
      switchedBranch,
      pulled,
      staged: false,
      committed: false,
      pushed: pushedExistingCommit,
      profileCode: PROFILE_CODE,
      executionTarget,
      transport,
      performanceTelemetry: telemetry.snapshot(),
    };
  }

  await telemetry.measure('STAGING', 'Stage repository changes', () =>
    stageChangesWithRetry(repo.rootPath),
  );
  telemetry.measureSync('COMMIT', 'Create Git commit', () => {
    runGit(['commit', '-m', commitMessage], repo.rootPath);
  });
  const commitSha = telemetry.measureSync('COMMIT_HEAD_READ', 'Committed head read', () =>
    getGitOutput(['rev-parse', 'HEAD'], repo.rootPath),
  );
  telemetry.measureSync('REMOTE_PUSH', 'Remote push', () => {
    runGit(['push', 'origin', repo.devBranch], repo.rootPath);
  });
  const completedAt = new Date().toISOString();
  console.log('');
  console.log('🎉 Dev commit completed successfully!');
  console.log(`🔖 Commit: ${commitSha}`);
  console.log('');

  return {
    ok: true,
    outcome: 'PUSHED',
    repositoryCode: repo.repoCode,
    repositoryName: repo.repoName,
    repositoryRoot: repo.rootPath,
    branch: repo.devBranch,
    remote: 'origin',
    commitMessage,
    previousHeadSha,
    currentHeadSha: commitSha,
    commitSha,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt) - new Date(startedAt)),
    ...changeSummary,
    fetched: true,
    switchedBranch,
    pulled,
    staged: true,
    committed: true,
    pushed: true,
    profileCode: PROFILE_CODE,
    executionTarget,
    transport,
    performanceTelemetry: telemetry.snapshot(),
  };
}

function printDevCommitResult(result) {
  if (result.outcome === 'NO_CHANGES') {
    console.log(`📋 Structured result: ${result.repositoryCode} had no changes to commit.`);
  } else {
    console.log(
      `📋 Structured result: ${result.changedFiles} changed file(s) committed to ${result.branch}.`,
    );
  }
}

async function closePool() {
  try {
    await pool.end();
  } catch {
    /* CLI shutdown */
  }
}

async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  try {
    return await runToolCli({
      toolCode: TOOL_CODE,
      outputType: OUTPUT_TYPE,
      args,
      execute: executeDevCommitRouted,
      createToolResult: createGitCommitToolResult,
      createFailureToolResult: (error) =>
        createGitCommitFailureToolResult({
          error,
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      renderConsole: printDevCommitResult,
    });
  } finally {
    await closePool();
  }
}

if (require.main === module) main();

module.exports = {
  OUTPUT_TYPE,
  TOOL_CODE,
  executeDevCommit,
  executeDevCommitRouted,
  executeDevCommitViaHostAgent,
  main,
  printDevCommitResult,
};
