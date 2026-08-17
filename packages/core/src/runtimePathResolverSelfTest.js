const assert = require('node:assert/strict');
const { isDockerRuntime, translateWorkspacePath } = require('./runtimePathResolver');

const dockerEnvironment = {
  SKYCOMMAND_RUNTIME_ENV: 'docker',
  SKYCOMMAND_CONFIG_PROFILE: 'DOCKER_LOCAL',
  SKYCOMMAND_DOCKER_HOST_WORKSPACE_ROOT: 'C:/Users/test/Dropbox/Programming/SkyEco System',
  SKYCOMMAND_DOCKER_CONTAINER_WORKSPACE_ROOT: '/workspace/SkyEco System',
};

assert.equal(isDockerRuntime(dockerEnvironment), true);
assert.equal(
  translateWorkspacePath(
    'C:\\Users\\test\\Dropbox\\Programming\\SkyEco System\\SkyCommand System\\SkyCommand\\docs',
    { environment: dockerEnvironment },
  ),
  '/workspace/SkyEco System/SkyCommand System/SkyCommand/docs',
);
assert.equal(
  translateWorkspacePath('/workspace/SkyEco System/SkyData System/SkyDataStudio', {
    environment: dockerEnvironment,
  }),
  '/workspace/SkyEco System/SkyData System/SkyDataStudio',
);
assert.equal(
  translateWorkspacePath('D:\\Portable\\SkyEco System\\SkyWeb System\\SkyWeb', {
    environment: {
      SKYCOMMAND_CONFIG_PROFILE: 'DOCKER_LOCAL',
      SKYCOMMAND_DOCKER_CONTAINER_WORKSPACE_ROOT: '/workspace/SkyEco System',
    },
  }),
  '/workspace/SkyEco System/SkyWeb System/SkyWeb',
);
assert.equal(
  translateWorkspacePath('C:\\outside\\file.txt', { environment: dockerEnvironment }),
  'C:\\outside\\file.txt',
);
assert.equal(
  translateWorkspacePath('C:\\Users\\test\\SkyEco System\\SkyCommand', {
    environment: { SKYCOMMAND_CONFIG_PROFILE: 'DEV_LOCAL' },
  }),
  'C:\\Users\\test\\SkyEco System\\SkyCommand',
);

console.log('[SkyCommand] Docker runtime path resolver self-test passed.');
