#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);


const assert = require('node:assert/strict');
const path = require('node:path');
const {
  DEFAULT_BACKEND_REBUILD_SERVICES,
  DEFAULT_RUNTIME_SERVICES,
  getSupervisorConfig,
  parseBackendRebuildServices,
  parseRuntimeServices,
} = require('./config');
const {
  buildComposeArgs,
  getRuntimeStatus,
  parseComposePsOutput,
  rebuildBackend,
  rebuildWeb,
} = require('./runtimeLifecycle');

assert.deepEqual(parseRuntimeServices(''), DEFAULT_RUNTIME_SERVICES);
assert.deepEqual(parseRuntimeServices('api,postgres,api'), ['api', 'postgres']);
assert.deepEqual(parseBackendRebuildServices(''), DEFAULT_BACKEND_REBUILD_SERVICES);
assert.deepEqual(parseBackendRebuildServices('api,node-worker,api'), ['api', 'node-worker']);

const repositoryRoot = path.resolve(sourceDir, '../../..');
const config = getSupervisorConfig(repositoryRoot);
assert.equal(config.projectName, process.env.SKYCOMMAND_SUPERVISOR_PROJECT_NAME || process.env.SKYCOMMAND_DOCKER_SELF_PROJECT_NAME || 'skycommand');
assert.ok(config.runtimeServices.includes('api'));
assert.ok(config.runtimeServices.includes('browser-worker'));
assert.ok(config.backendRebuildServices.includes('browser-worker'));
assert.ok(!config.runtimeServices.includes('web'));
assert.deepEqual(config.backendRebuildServices, DEFAULT_BACKEND_REBUILD_SERVICES);

const args = buildComposeArgs(config, ['stop', 'api']);
assert.deepEqual(args.slice(0, 5), ['compose', '--project-name', config.projectName, '--file', config.composeFile]);
assert.equal(args.at(-2), 'stop');
assert.equal(args.at(-1), 'api');

const parsedArray = parseComposePsOutput('[{"Service":"api","State":"running","Health":"healthy"}]');
assert.equal(parsedArray.length, 1);
assert.equal(parsedArray[0].Service, 'api');

const parsedLines = parseComposePsOutput('{"Service":"api","State":"running"}\n{"Service":"postgres","State":"exited"}');
assert.equal(parsedLines.length, 2);

const fakeExecutor = async (_command, dockerArgs) => {
  assert.ok(dockerArgs.includes('ps'));
  return {
    stdout: config.runtimeServices
      .map((service) => JSON.stringify({ Service: service, State: 'running', Health: service === 'api' ? 'healthy' : '' }))
      .join('\n'),
    stderr: '',
  };
};

getRuntimeStatus(config, { executor: fakeExecutor })
  .then((status) => {
    assert.equal(status.engineStatus, 'ONLINE');
    assert.equal(status.runtimeStatus, 'ONLINE');
    assert.equal(status.runningCount, config.runtimeServices.length);

    let rebuildObserved = false;
    const rebuildExecutor = async (_command, dockerArgs) => {
      if (dockerArgs.includes('--build')) {
        rebuildObserved = true;
        assert.deepEqual(dockerArgs.slice(-4), ['up', '-d', '--build', config.webService]);
        return { stdout: 'web rebuilt', stderr: '' };
      }
      return fakeExecutor(_command, dockerArgs);
    };

    return rebuildWeb(config, { executor: rebuildExecutor }).then(async (result) => {
      assert.equal(result.action, 'REBUILD_WEB');
      assert.equal(rebuildObserved, true);

      let backendRebuildObserved = false;
      const backendRebuildExecutor = async (_command, dockerArgs) => {
        if (dockerArgs.includes('--force-recreate')) {
          backendRebuildObserved = true;
          assert.deepEqual(
            dockerArgs.slice(-(4 + config.backendRebuildServices.length)),
            ['up', '-d', '--build', '--force-recreate', ...config.backendRebuildServices],
          );
          return { stdout: 'backend rebuilt', stderr: '' };
        }
        return fakeExecutor(_command, dockerArgs);
      };

      const backendResult = await rebuildBackend(config, { executor: backendRebuildExecutor });
      assert.equal(backendResult.action, 'REBUILD_BACKEND');
      assert.equal(backendRebuildObserved, true);
      console.log('✅ SkyCommand Supervisor self-test passed.');
    });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
