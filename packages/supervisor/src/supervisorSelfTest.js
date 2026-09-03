#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  DEFAULT_RUNTIME_SERVICES,
  getSupervisorConfig,
  parseRuntimeServices,
} = require('./config');
const {
  buildComposeArgs,
  getRuntimeStatus,
  parseComposePsOutput,
} = require('./runtimeLifecycle');

assert.deepEqual(parseRuntimeServices(''), DEFAULT_RUNTIME_SERVICES);
assert.deepEqual(parseRuntimeServices('api,postgres,api'), ['api', 'postgres']);

const repositoryRoot = path.resolve(__dirname, '../../..');
const config = getSupervisorConfig(repositoryRoot);
assert.equal(config.projectName, process.env.SKYCOMMAND_SUPERVISOR_PROJECT_NAME || process.env.SKYCOMMAND_DOCKER_SELF_PROJECT_NAME || 'skycommand');
assert.ok(config.runtimeServices.includes('api'));
assert.ok(!config.runtimeServices.includes('web'));

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
    console.log('✅ SkyCommand Supervisor self-test passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
