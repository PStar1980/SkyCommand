const assert = require('node:assert/strict');

const {
  buildDockerComposeControlArgs,
  executeDockerComposeControl,
  normalizeDockerComposeAction,
} = require('./dockerControl');

assert.equal(normalizeDockerComposeAction('restart'), 'RESTART');
assert.throws(
  () => normalizeDockerComposeAction('down'),
  (error) => error.code === 'SKYCOMMAND_DOCKER_ACTION_NOT_ALLOWED',
);

const args = buildDockerComposeControlArgs(
  {
    projectName: 'skydata-studio',
    action: 'STOP',
    configFiles: ['C:\\SkyDataStudio\\compose.yaml'],
  },
  { fileExists: () => true },
);
assert.deepEqual(args, [
  'compose',
  '--project-name',
  'skydata-studio',
  '--file',
  'C:\\SkyDataStudio\\compose.yaml',
  'stop',
]);

(async () => {
  const calls = [];
  const result = await executeDockerComposeControl(
    {
      projectName: 'skydata-studio',
      action: 'START',
      configFiles: ['C:\\SkyDataStudio\\compose.yaml'],
    },
    {
      fileExists: () => true,
      executor: async (command, commandArgs) => {
        calls.push([command, commandArgs]);
        return { stdout: 'started' };
      },
    },
  );

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.projectName, 'skydata-studio');
  assert.equal(result.action, 'START');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'docker');
  assert.deepEqual(calls[0][1].slice(-1), ['start']);

  console.log('✅ SkyCommand Docker Compose control self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
