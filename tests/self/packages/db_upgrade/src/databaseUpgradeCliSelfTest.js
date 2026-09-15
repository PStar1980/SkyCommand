const assert = require('node:assert/strict');
const path = require('node:path');
const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');

const sourceDir = sourceDirectoryForTest(__filename);
const root = path.resolve(sourceDir, '../../..');
const enginePath = path.join(root, 'packages/db_upgrade/src/databaseUpgradeEngine.js');
const cliPath = path.join(root, 'packages/db_upgrade/src/db_upgrade.js');

const engine = require(enginePath);

async function run() {
  const originalExecuteDatabaseUpgrade = engine.executeDatabaseUpgrade;
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalResultPath = process.env.SKYCOMMAND_TOOL_RESULT_PATH;
  const originalResultDirectory = process.env.SKYCOMMAND_TOOL_RESULT_DIRECTORY;
  const originalConsoleLog = console.log;
  const calls = [];
  const renderedLines = [];

  engine.executeDatabaseUpgrade = async (options) => {
    calls.push(options);
    if (calls.length === 1) {
      const result = engine.createInitialUpgradeOutput('PLAN', Date.now());
      result.outcome = 'PLAN_READY';
      result.planDigest = { algorithm: 'SHA-256', digest: 'A'.repeat(64) };
      return result;
    }

    const error = new Error('simulated CLI execution failure');
    error.code = 'DATABASE_UPGRADE_CLI_TEST_FAILURE';
    throw error;
  };
  const { main, renderUpgrade } = require(cliPath);

  delete process.env.SKYCOMMAND_TOOL_RESULT_PATH;
  delete process.env.SKYCOMMAND_TOOL_RESULT_DIRECTORY;
  process.exitCode = undefined;

  try {
    console.log = (...args) => renderedLines.push(args.join(' '));

    renderUpgrade({
      mode: 'PLAN',
      outcome: 'PLAN_READY',
      pendingCount: 0,
      appliedCount: 0,
      ledger: { appliedCount: 1 },
      planDigest: { digest: 'B'.repeat(64) },
    });
    assert.equal(
      renderedLines.pop(),
      `[SkyCommand DB Upgrade] PLAN PLAN_READY: 0 pending, 1 ledgered, plan ${'B'.repeat(64)}`,
      'PLAN renders cumulative ledger count separately from current-run applied count',
    );

    renderUpgrade({
      mode: 'APPLY',
      outcome: 'APPLIED',
      pendingCount: 0,
      appliedCount: 1,
      ledger: { appliedCount: 2 },
      planDigest: { digest: 'C'.repeat(64) },
    });
    assert.equal(
      renderedLines.pop(),
      `[SkyCommand DB Upgrade] APPLY APPLIED: 1 applied this run, 2 ledgered, plan ${'C'.repeat(64)}`,
      'APPLY labels current-run and cumulative counts distinctly',
    );

    process.argv = ['node', cliPath, 'plan'];
    const successfulRun = await main();
    assert.equal(successfulRun.mode, 'execute');
    assert.equal(successfulRun.toolResult.success, true);
    assert.equal(successfulRun.toolResult.outputType, 'database_upgrade_summary.v1');
    assert.equal(successfulRun.structuredResultWarning, null);

    process.argv = ['node', cliPath, 'plan'];
    const failedRun = await main();
    assert.equal(failedRun.mode, 'execute');
    assert.equal(failedRun.toolResult.success, false);
    assert.equal(failedRun.toolResult.error.code, 'DATABASE_UPGRADE_CLI_TEST_FAILURE');
    assert.equal(failedRun.error.code, 'DATABASE_UPGRADE_CLI_TEST_FAILURE');
    assert.equal(process.exitCode, 1);
    assert.equal(calls.length, 2);

    console.log('[db-upgrade:cli-self-test] PASS');
  } finally {
    engine.executeDatabaseUpgrade = originalExecuteDatabaseUpgrade;
    process.argv = originalArgv;
    process.exitCode = originalExitCode === undefined ? 0 : originalExitCode;
    if (originalResultPath === undefined) delete process.env.SKYCOMMAND_TOOL_RESULT_PATH;
    else process.env.SKYCOMMAND_TOOL_RESULT_PATH = originalResultPath;
    if (originalResultDirectory === undefined) delete process.env.SKYCOMMAND_TOOL_RESULT_DIRECTORY;
    else process.env.SKYCOMMAND_TOOL_RESULT_DIRECTORY = originalResultDirectory;
    console.log = originalConsoleLog;
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
