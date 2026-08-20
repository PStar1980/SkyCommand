const assert = require('node:assert/strict');

const {
  buildBridgeHeartbeat,
  getDockerEventIngressUrl,
  normalizeDockerEvent,
  postDockerEventPayload,
} = require('./dockerEventBridge');

async function main() {
  const previousApiPort = process.env.API_PORT;
  const previousIngressUrl = process.env.SKYCOMMAND_DOCKER_EVENT_INGEST_URL;

  process.env.API_PORT = '7171';
  delete process.env.SKYCOMMAND_DOCKER_EVENT_INGEST_URL;
  assert.equal(
    getDockerEventIngressUrl(),
    'http://127.0.0.1:7171/api/infrastructure/providers/docker/events/ingest',
  );

  process.env.SKYCOMMAND_DOCKER_EVENT_INGEST_URL = 'http://127.0.0.1:9999/custom';
  assert.equal(getDockerEventIngressUrl(), 'http://127.0.0.1:9999/custom');

  const normalized = normalizeDockerEvent(
    {
      Type: 'container',
      Action: 'health_status: healthy',
      Actor: {
        ID: 'abcdef123456',
        Attributes: {
          name: 'skydata-studio-airflow-api-server',
          image: 'apache/airflow:3.3.0',
          'com.docker.compose.project': 'infra',
          'com.docker.compose.service': 'airflow-api-server',
        },
      },
      scope: 'local',
      time: 1787265000,
    },
    { hostname: 'TEST-HOST' },
  );

  assert.equal(normalized.action, 'HEALTH_STATUS_HEALTHY');
  assert.equal(normalized.containerId, 'abcdef123456');
  assert.equal(normalized.containerName, 'skydata-studio-airflow-api-server');
  assert.equal(normalized.project, 'infra');
  assert.equal(normalized.service, 'airflow-api-server');
  assert.equal(normalized.source.hostname, 'TEST-HOST');
  assert.equal(normalized.resourceType, 'CONTAINER');
  assert.equal(normalizeDockerEvent({ Type: 'network', Action: 'create', id: 'network-1' }), null);
  assert.equal(normalizeDockerEvent({ Type: 'container', Action: 'exec_start', id: 'abc123' }), null);

  const heartbeat = buildBridgeHeartbeat({ hostname: 'TEST-HOST', observerStatus: 'ONLINE' });
  assert.equal(heartbeat.kind, 'BRIDGE_HEARTBEAT');
  assert.equal(heartbeat.source.hostname, 'TEST-HOST');
  assert.equal(heartbeat.observerStatus, 'ONLINE');

  let capturedRequest = null;
  await postDockerEventPayload(normalized, {
    ingressUrl: 'http://127.0.0.1:7171/test',
    internalToken: 'unit-test-token',
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      capturedRequest = { url, options };
      return {
        ok: true,
        status: 202,
        text: async () => '',
      };
    },
  });

  assert.equal(capturedRequest.url, 'http://127.0.0.1:7171/test');
  assert.equal(capturedRequest.options.method, 'POST');
  assert.equal(
    capturedRequest.options.headers['X-SkyCommand-Internal-Token'],
    'unit-test-token',
  );
  assert.equal(JSON.parse(capturedRequest.options.body).action, 'HEALTH_STATUS_HEALTHY');

  if (previousApiPort === undefined) delete process.env.API_PORT;
  else process.env.API_PORT = previousApiPort;
  if (previousIngressUrl === undefined) delete process.env.SKYCOMMAND_DOCKER_EVENT_INGEST_URL;
  else process.env.SKYCOMMAND_DOCKER_EVENT_INGEST_URL = previousIngressUrl;

  console.log('Docker event bridge self-test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
