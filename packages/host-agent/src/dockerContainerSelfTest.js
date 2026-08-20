const assert = require('node:assert/strict');

const {
  buildContainerDetail,
  executeDockerContainerControl,
  executeDockerContainerDetail,
  normalizeContainerAction,
  normalizeContainerId,
  normalizeLogTail,
} = require('./dockerContainer');

assert.equal(normalizeContainerId('ABCDEF123456'), 'abcdef123456');
assert.equal(normalizeContainerAction('pause'), 'PAUSE');
assert.equal(normalizeLogTail(5000), 1000);
assert.throws(
  () => normalizeContainerId('skycommand-api-1'),
  (error) => error.code === 'SKYCOMMAND_DOCKER_CONTAINER_ID_INVALID',
);
assert.throws(
  () => normalizeContainerAction('exec'),
  (error) => error.code === 'SKYCOMMAND_DOCKER_CONTAINER_ACTION_NOT_ALLOWED',
);

const detail = buildContainerDetail({
  Id: 'abcdef1234567890',
  Name: '/skydata-api-1',
  Image: 'sha256:image',
  Platform: 'linux',
  Created: '2026-08-20T12:00:00Z',
  RestartCount: 2,
  Config: {
    Image: 'skydata-api:local',
    Env: ['TOP_SECRET=do-not-return'],
    Labels: {
      'com.docker.compose.project': 'infra',
      'com.docker.compose.service': 'api',
    },
    Cmd: ['node', 'server.js'],
  },
  State: {
    Status: 'running',
    Running: true,
    Pid: 123,
    ExitCode: 0,
    StartedAt: '2026-08-20T12:01:00Z',
    Health: {
      Status: 'healthy',
      FailingStreak: 0,
      Log: [{ End: '2026-08-20T12:02:00Z', ExitCode: 0, Output: 'ok' }],
    },
  },
  HostConfig: {
    RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
  },
  Mounts: [
    {
      Type: 'volume',
      Name: 'infra_data',
      Source: '/var/lib/docker/volumes/infra_data',
      Destination: '/data',
      RW: true,
    },
  ],
  NetworkSettings: {
    Networks: {
      infra_default: {
        NetworkID: 'network-id',
        IPAddress: '172.20.0.10',
        Gateway: '172.20.0.1',
      },
    },
    Ports: {
      '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }],
    },
  },
});

assert.equal(detail.name, 'skydata-api-1');
assert.equal(detail.project, 'infra');
assert.equal(detail.service, 'api');
assert.equal(detail.state.health, 'HEALTHY');
assert.equal(detail.restartCount, 2);
assert.equal(detail.mounts[0].destination, '/data');
assert.equal(detail.networks[0].ipAddress, '172.20.0.10');
assert.equal(detail.ports[0].hostBindings[0].hostPort, '8080');
assert.equal(detail.security.environmentRedacted, true);
assert.equal(Object.prototype.hasOwnProperty.call(detail, 'Env'), false);
assert.equal(JSON.stringify(detail).includes('TOP_SECRET'), false);

(async () => {
  const detailCalls = [];
  const detailResult = await executeDockerContainerDetail(
    { containerId: 'abcdef123456', tail: 25 },
    {
      executor: async (command, args) => {
        detailCalls.push([command, args]);
        if (args[1] === 'inspect') {
          return {
            stdout: JSON.stringify([{
              Id: 'abcdef1234567890',
              Name: '/skydata-api-1',
              Config: { Image: 'skydata-api:local', Labels: {} },
              State: { Status: 'running', Running: true },
              HostConfig: { RestartPolicy: { Name: 'no' } },
              NetworkSettings: { Networks: {}, Ports: {} },
              Mounts: [],
            }]),
            stderr: '',
          };
        }
        return { stdout: '2026-08-20T12:00:00Z hello\n', stderr: '' };
      },
    },
  );

  assert.equal(detailResult.container.name, 'skydata-api-1');
  assert.equal(detailResult.logs.stdout.includes('hello'), true);
  assert.equal(detailResult.logs.tail, 25);
  assert.equal(detailCalls.length, 2);
  assert.deepEqual(detailCalls[0][1], ['container', 'inspect', 'abcdef123456']);
  assert.deepEqual(detailCalls[1][1], [
    'container',
    'logs',
    '--timestamps',
    '--tail',
    '25',
    'abcdef123456',
  ]);

  const controlCalls = [];
  const controlResult = await executeDockerContainerControl(
    { containerId: 'abcdef123456', action: 'UNPAUSE' },
    {
      executor: async (command, args) => {
        controlCalls.push([command, args]);
        return { stdout: '' };
      },
    },
  );

  assert.equal(controlResult.status, 'SUCCESS');
  assert.equal(controlResult.action, 'UNPAUSE');
  assert.deepEqual(controlCalls[0][1], ['container', 'unpause', 'abcdef123456']);

  console.log('✅ SkyCommand Docker container inspection/control self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
