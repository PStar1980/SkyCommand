#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  assertExpectedSupervisorProcess,
  executeSupervisorProcessLifecycle,
  getPaths,
  killSupervisorProcessTree,
  launchSupervisorProcess,
  listSupervisorProcesses,
  normalizeAction,
} = require(path.join(sourceDir, 'supervisorProcessLifecycle.js'));

const repositoryRoot = path.resolve(sourceDir, '../../../..');
const paths = getPaths(repositoryRoot);
const expectedProcess = {
  processId: 4321,
  name: 'node.exe',
  commandLine: `\"C:\\Program Files\\nodejs\\node.exe\" \"${paths.serverScript}\"`,
};

assert.equal(normalizeAction('start'), 'START');
assert.equal(normalizeAction('RESTART'), 'RESTART');
assert.throws(() => normalizeAction('STOP'), /not allowlisted/i);
assert.equal(assertExpectedSupervisorProcess(expectedProcess, paths).processId, 4321);
assert.throws(
  () => assertExpectedSupervisorProcess({ ...expectedProcess, name: 'python.exe' }, paths),
  (error) => error.code === 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_MISMATCH',
);
assert.throws(
  () => assertExpectedSupervisorProcess({
    ...expectedProcess,
    commandLine: 'node.exe C:\\OtherRepo\\packages\\supervisor\\src\\server.js',
  }, paths),
  (error) => error.code === 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_MISMATCH',
);

const boundLegacyProcess = {
  processId: 4322,
  name: 'node.exe',
  commandLine: 'node.exe packages/supervisor/src/server.js',
  ownsConfiguredPort: true,
};
assert.equal(
  assertExpectedSupervisorProcess(boundLegacyProcess, { ...paths, allowBoundRelative: true }).identityMode,
  'BOUND_LEGACY_RELATIVE_PATH',
);
assert.equal(
  assertExpectedSupervisorProcess({
    ...boundLegacyProcess,
    processId: 4324,
    commandLine: 'node.exe packages\\supervisor\\src\\server.js',
  }, { ...paths, allowBoundRelative: true }).identityMode,
  'BOUND_LEGACY_RELATIVE_PATH',
);
assert.throws(
  () => assertExpectedSupervisorProcess({
    ...boundLegacyProcess,
    processId: 4323,
    commandLine: 'node.exe C:\\OtherRepo\\packages\\supervisor\\src\\server.js',
  }, { ...paths, allowBoundRelative: true }),
  (error) => error.code === 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_MISMATCH',
);

async function main() {
  let inventoryCommand = '';
  const inventory = await listSupervisorProcesses({
    platform: 'win32',
    repositoryRoot,
    serverScript: paths.serverScript,
    environment: { SKYCOMMAND_SUPERVISOR_PORT: '17170' },
    executor: async (executable, args) => {
      assert.equal(executable, 'powershell.exe');
      inventoryCommand = args[args.length - 1];
      return {
        stdout: JSON.stringify({
          ProcessId: 8111,
          Name: 'node.exe',
          CommandLine: 'node.exe packages/supervisor/src/server.js',
          OwnsConfiguredPort: true,
          DiscoverySource: 'NETSTAT',
        }),
      };
    },
  });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].processId, 8111);
  assert.equal(inventory[0].commandLine, 'node.exe packages/supervisor/src/server.js');
  assert.equal(inventory[0].discoverySource, 'NETSTAT');
  assert.match(inventoryCommand, /Get-NetTCPConnection/);
  assert.match(inventoryCommand, /netstat\.exe -ano -p tcp/);
  assert.doesNotMatch(inventoryCommand, /isSupervisor/);
  assert.equal(
    assertExpectedSupervisorProcess(inventory[0], { ...paths, allowBoundRelative: true }).identityMode,
    'BOUND_LEGACY_RELATIVE_PATH',
  );

  let spawnOptions = null;
  const fileCalls = [];
  const launchedDirect = launchSupervisorProcess({
    repositoryRoot,
    serverScript: paths.serverScript,
    nodeExecutable: 'node.exe',
    environment: {},
    fileSystem: {
      existsSync: () => true,
      mkdirSync: (...args) => fileCalls.push(['mkdirSync', ...args]),
      openSync: (...args) => fileCalls.push(['openSync', ...args]),
      closeSync: (...args) => fileCalls.push(['closeSync', ...args]),
    },
    spawner: (_exe, _args, options) => {
      spawnOptions = options;
      return { pid: 8122, unref() {} };
    },
  });
  assert.equal(launchedDirect.processId, 8122);
  assert.equal(spawnOptions.stdio, 'ignore');
  assert.deepEqual(fileCalls, [], 'Supervisor lifecycle must not create unmanaged append-only host logs');

  // Exercise the real default process-tree killer directly. Higher-level lifecycle
  // tests inject a processKiller, so this contract needs dedicated coverage to
  // prevent option-plumbing regressions from hiding behind dependency injection.
  const killCalls = [];
  const killedPid = await killSupervisorProcessTree(
    {
      processId: 8133,
      name: 'node.exe',
      commandLine: `node.exe \"${paths.serverScript}\"`,
      ownsConfiguredPort: true,
    },
    {
      repositoryRoot,
      serverScript: paths.serverScript,
      executor: async (executable, args, options) => {
        killCalls.push({ executable, args, options });
        return { stdout: '', stderr: '' };
      },
    },
  );
  assert.equal(killedPid, 8133);
  assert.equal(killCalls.length, 1);
  assert.equal(killCalls[0].executable, 'taskkill.exe');
  assert.deepEqual(killCalls[0].args, ['/PID', '8133', '/T', '/F']);
  assert.equal(killCalls[0].options.cwd, repositoryRoot);

  let rejectedKillExecutorCalls = 0;
  await assert.rejects(
    () => killSupervisorProcessTree(
      {
        processId: 8134,
        name: 'node.exe',
        commandLine: 'node.exe C:\\OtherRepo\\packages\\supervisor\\src\\server.js',
        ownsConfiguredPort: true,
      },
      {
        repositoryRoot,
        serverScript: paths.serverScript,
        executor: async () => {
          rejectedKillExecutorCalls += 1;
          return { stdout: '', stderr: '' };
        },
      },
    ),
    (error) => error.code === 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_MISMATCH',
  );
  assert.equal(
    rejectedKillExecutorCalls,
    0,
    'foreign Supervisor identity must be rejected before taskkill is invoked',
  );

  let processes = [];
  let launchCount = 0;
  let killCount = 0;
  let nextPid = 5000;
  const processLister = async () => processes.map((item) => ({ ...item }));
  const processLauncher = async () => {
    launchCount += 1;
    const launched = {
      processId: nextPid++,
      name: 'node.exe',
      commandLine: `node.exe \"${paths.serverScript}\"`,
    };
    processes = [launched];
    return { processId: launched.processId };
  };
  const processKiller = async (processInfo) => {
    assertExpectedSupervisorProcess(processInfo, paths);
    killCount += 1;
    processes = processes.filter((item) => item.processId !== processInfo.processId);
  };
  const healthChecker = async () => ({ url: 'http://127.0.0.1:17170/health', payload: { ok: true } });
  const noSleep = async () => {};

  const started = await executeSupervisorProcessLifecycle(
    { action: 'START', operationId: '123e4567-e89b-42d3-a456-426614174001' },
    {
      platform: 'win32',
      repositoryRoot,
      processLister,
      processLauncher,
      processKiller,
      healthChecker,
      sleeper: noSleep,
    },
  );
  assert.equal(started.outcome, 'COMPLETED');
  assert.equal(started.processId, 5000);
  assert.equal(launchCount, 1);
  assert.equal(killCount, 0);

  const duplicateStart = await executeSupervisorProcessLifecycle(
    { action: 'START', operationId: '123e4567-e89b-42d3-a456-426614174002' },
    {
      platform: 'win32',
      repositoryRoot,
      processLister,
      processLauncher,
      processKiller,
      healthChecker,
      sleeper: noSleep,
    },
  );
  assert.equal(duplicateStart.outcome, 'ALREADY_RUNNING');
  assert.equal(duplicateStart.processId, 5000);
  assert.equal(launchCount, 1, 'idempotent START must not launch a duplicate Supervisor');

  const restarted = await executeSupervisorProcessLifecycle(
    { action: 'RESTART', operationId: '123e4567-e89b-42d3-a456-426614174003' },
    {
      platform: 'win32',
      repositoryRoot,
      processLister,
      processLauncher,
      processKiller,
      healthChecker,
      sleeper: noSleep,
    },
  );
  assert.equal(restarted.outcome, 'COMPLETED');
  assert.equal(restarted.processId, 5001);
  assert.deepEqual(restarted.previousProcessIds, [5000]);
  assert.equal(killCount, 1);
  assert.equal(launchCount, 2);

  processes = [{
    processId: 7777,
    name: 'node.exe',
    commandLine: 'node.exe C:\\OtherRepo\\packages\\supervisor\\src\\server.js',
  }];
  await assert.rejects(
    () => executeSupervisorProcessLifecycle(
      { action: 'RESTART' },
      {
        platform: 'win32',
        repositoryRoot,
        processLister,
        processLauncher,
        processKiller,
        healthChecker,
        sleeper: noSleep,
      },
    ),
    (error) => error.code === 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_MISMATCH',
  );
  assert.equal(launchCount, 2, 'mismatched process identity must fail before launch');

  console.log('✅ SkyCommand Host Agent Supervisor process lifecycle self-test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
