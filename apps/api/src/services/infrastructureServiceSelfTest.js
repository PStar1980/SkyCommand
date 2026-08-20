const assert = require('node:assert/strict');

const {
  buildDockerTarget,
  buildUnavailableDockerOverview,
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
        projects: [{ name: 'skycommand', state: 'RUNNING' }],
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
  assert.equal(overview.error, null);

  console.log('✅ SkyCommand infrastructure service self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
