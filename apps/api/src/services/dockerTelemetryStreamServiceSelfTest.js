const assert = require('node:assert/strict');
const telemetry = require('./dockerTelemetryStreamService');

telemetry.resetDockerTelemetryStreamForTest();

const first = telemetry.ingestDockerTelemetryPayload({
  kind: 'DOCKER_TELEMETRY_SNAPSHOT',
  sampleIntervalMs: 5000,
  capturedAt: '2026-08-20T23:00:00.000Z',
  source: { hostname: 'Entity007', transport: 'HOST_AGENT' },
  containers: [
    {
      containerId: 'one',
      containerName: 'skydata-studio-api',
      project: 'infra',
      service: 'api',
      image: 'skydata-api:local',
      cpuPercent: 2.5,
      memoryBytes: 100,
      memoryLimitBytes: 1000,
      memoryPercent: 10,
      networkRxBytes: 1000,
      networkTxBytes: 2000,
      blockReadBytes: 3000,
      blockWriteBytes: 4000,
      pids: 5,
      environment: ['SECRET=must-not-survive'],
    },
  ],
});
assert.equal(first.accepted, true);

telemetry.ingestDockerTelemetryPayload({
  kind: 'DOCKER_TELEMETRY_SNAPSHOT',
  sampleIntervalMs: 5000,
  capturedAt: '2026-08-20T23:00:05.000Z',
  source: { hostname: 'Entity007', transport: 'HOST_AGENT' },
  containers: [
    {
      containerId: 'one',
      containerName: 'skydata-studio-api',
      project: 'infra',
      service: 'api',
      image: 'skydata-api:local',
      cpuPercent: 5,
      memoryBytes: 200,
      memoryLimitBytes: 1000,
      memoryPercent: 20,
      networkRxBytes: 6000,
      networkTxBytes: 7000,
      blockReadBytes: 8000,
      blockWriteBytes: 9000,
      pids: 7,
    },
  ],
});

const replay = telemetry.getReplaySamples();
assert.equal(replay.length, 2);
const latest = replay[1];
assert.equal(latest.totals.cpuPercent, 5);
assert.equal(latest.totals.memoryBytes, 200);
assert.equal(latest.totals.networkRxRateBytesPerSec, 1000);
assert.equal(latest.totals.networkTxRateBytesPerSec, 1000);
assert.equal(latest.containers[0].blockReadRateBytesPerSec, 1000);
assert.equal(latest.projects[0].project, 'infra');
assert.equal(Object.hasOwn(latest.containers[0], 'environment'), false);
assert.equal(telemetry.getDockerTelemetryStreamStatus().status, 'ONLINE');

const streamId = telemetry.buildDockerTelemetryStreamId(latest.sequence);
assert.equal(telemetry.parseDockerTelemetryStreamSequence(streamId), latest.sequence);
assert.equal(telemetry.parseDockerTelemetryStreamSequence('other-instance:999'), 0);

telemetry.ingestDockerTelemetryPayload({
  kind: 'DOCKER_TELEMETRY_HEARTBEAT',
  observerStatus: 'ERROR',
  errorCode: 'SKYCOMMAND_DOCKER_ENGINE_UNAVAILABLE',
  source: { hostname: 'Entity007', transport: 'HOST_AGENT' },
});
assert.equal(telemetry.getDockerTelemetryStreamStatus().status, 'ERROR');
assert.equal(
  telemetry.getDockerTelemetryStreamStatus().sourceErrorCode,
  'SKYCOMMAND_DOCKER_ENGINE_UNAVAILABLE',
);

telemetry.ingestDockerTelemetryPayload({
  kind: 'DOCKER_TELEMETRY_HEARTBEAT',
  observerStatus: 'STOPPED',
  source: { hostname: 'Entity007', transport: 'HOST_AGENT' },
});
assert.equal(telemetry.getDockerTelemetryStreamStatus().status, 'OFFLINE');

assert.throws(
  () => telemetry.ingestDockerTelemetryPayload({ kind: 'RAW_DOCKER_STATS', containers: [] }),
  /Unsupported Docker telemetry payload kind/,
);

console.log('✅ SkyCommand Docker telemetry stream self-test passed.');
