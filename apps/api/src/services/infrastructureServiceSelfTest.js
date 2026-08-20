const assert = require('node:assert/strict');

const {
  buildDockerTarget,
  buildProjectControl,
  buildUnavailableDockerOverview,
  controlDockerComposeProject,
  getDockerOverview,
} = require('./infrastructureService');

const target = buildDockerTarget({
  enabled: true,
  online: true,
  status: 'ONLINE',
  taskQueue: 'skycommand-host-local',
  availabilitySource: 'HEARTBEAT',
  latestHeartbeat: {
    hostname: 'dev-host',
    metadata: { profileCode: 'DEV_LOCAL' },
  },
});
assert.equal(target.providerCode, 'DOCKER');
assert.equal(target.transport, 'HOST_AGENT');
assert.equal(target.status, 'ONLINE');
assert.equal(target.hostname, 'dev-host');

const unavailable = buildUnavailableDockerOverview({
  enabled: false,
  online: false,
  status: 'DISABLED',
  taskQueue: 'skycommand-host-local',
});
assert.equal(unavailable.provider.status, 'DISABLED');
assert.equal(unavailable.error.code, 'SKYCOMMAND_HOST_AGENT_DISABLED');

const externalControl = buildProjectControl({
  name: 'skydata',
  state: 'STOPPED',
  configFileList: ['C:\\SkyDataStudio\\compose.yaml'],
});
assert.equal(externalControl.allowed, true);
assert.equal(externalControl.actions.start, true);
assert.equal(externalControl.actions.stop, false);

const selfControl = buildProjectControl({
  name: 'skycommand',
  state: 'RUNNING',
  configFileList: ['C:\\SkyCommand\\compose.yaml'],
});
assert.equal(selfControl.allowed, false);
assert.equal(selfControl.mode, 'SELF_MANAGED_PROTECTED');

(async () => {
  const overview = await getDockerOverview({
    availabilityLoader: async () => ({
      enabled: true,
      online: true,
      status: 'ONLINE',
      taskQueue: 'skycommand-host-local',
      availabilitySource: 'TEMPORAL_PROBE',
      liveProbe: { hostname: 'dev-host', profileCode: 'DEV_LOCAL' },
    }),
    dispatcher: async () => ({
      ok: true,
      result: {
        provider: { code: 'DOCKER', status: 'ONLINE', engineVersion: '28.0.0' },
        host: { hostname: 'dev-host' },
        counts: { projects: 1, containers: 2 },
        projects: [
          {
            name: 'skycommand',
            state: 'RUNNING',
            configFiles: 'C:\\SkyCommand\\compose.yaml',
          },
        ],
        containers: [],
        images: [],
        volumes: [],
        networks: [],
        capturedAt: new Date().toISOString(),
      },
    }),
  });

  assert.equal(overview.target.providerCode, 'DOCKER');
  assert.equal(overview.target.status, 'ONLINE');
  assert.equal(overview.provider.engineVersion, '28.0.0');
  assert.equal(overview.counts.projects, 1);
  assert.equal(overview.projects[0].control.mode, 'SELF_MANAGED_PROTECTED');
  assert.equal(overview.error, null);

  const audits = [];
  const snapshots = [
    {
      target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
      error: null,
      projects: [
        {
          name: 'skydata',
          state: 'STOPPED',
          configFileList: ['C:\\SkyDataStudio\\compose.yaml'],
        },
      ],
    },
    {
      target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
      error: null,
      projects: [
        {
          name: 'skydata',
          state: 'RUNNING',
          configFileList: ['C:\\SkyDataStudio\\compose.yaml'],
        },
      ],
    },
  ];
  let overviewIndex = 0;
  const controlResult = await controlDockerComposeProject({
    projectName: 'skydata',
    action: 'START',
    confirmed: true,
    actor: { userId: '11111111-1111-1111-1111-111111111111' },
    session: { appCode: 'SKYSERVER_ADMIN' },
    overviewLoader: async () => snapshots[Math.min(overviewIndex++, snapshots.length - 1)],
    dispatcher: async (input) => {
      assert.equal(input.projectName, 'skydata');
      assert.equal(input.action, 'START');
      assert.equal(input.configFiles.length, 1);
      return { ok: true, result: { status: 'SUCCESS' } };
    },
    auditRecorder: async (event) => audits.push(event),
  });

  assert.equal(controlResult.operation.status, 'SUCCESS');
  assert.equal(controlResult.operation.previousState, 'STOPPED');
  assert.equal(controlResult.operation.resultingState, 'RUNNING');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].eventType, 'DOCKER_COMPOSE_CONTROL');
  assert.equal(audits[0].success, true);

  const blockedAudits = [];
  await assert.rejects(
    () => controlDockerComposeProject({
      projectName: 'skycommand',
      action: 'STOP',
      confirmed: true,
      overviewLoader: async () => ({
        target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
        error: null,
        projects: [
          {
            name: 'skycommand',
            state: 'RUNNING',
            configFileList: ['C:\\SkyCommand\\compose.yaml'],
          },
        ],
      }),
      dispatcher: async () => {
        throw new Error('dispatcher should not run for self control');
      },
      auditRecorder: async (event) => blockedAudits.push(event),
    }),
    (error) => error.details?.code === 'SKYCOMMAND_DOCKER_SELF_CONTROL_BLOCKED',
  );
  assert.equal(blockedAudits.length, 1);
  assert.equal(blockedAudits[0].success, false);

  console.log('✅ SkyCommand infrastructure service self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
