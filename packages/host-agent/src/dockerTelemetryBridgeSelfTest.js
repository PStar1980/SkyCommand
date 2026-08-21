const assert = require('node:assert/strict');
const {
  buildMetadataMap,
  buildTelemetryHeartbeat,
  captureDockerTelemetrySnapshot,
  getDockerTelemetryConfig,
  normalizeDockerTelemetryStat,
  parseBytePair,
  parseByteValue,
  parsePercent,
} = require('./dockerTelemetryBridge');

assert.equal(parseByteValue('1KiB'), 1024);
assert.equal(parseByteValue('1.5MiB'), 1572864);
assert.equal(parseByteValue('2GB'), 2000000000);
assert.deepEqual(parseBytePair('12.5MiB / 2GiB'), {
  first: 13107200,
  second: 2147483648,
});
assert.equal(parsePercent('4.93%'), 4.93);

const metadata = buildMetadataMap([
  {
    Id: 'abc123456789ffff',
    Name: '/skydata-studio-airflow-api-server',
    Config: {
      Image: 'apache/airflow:3.3.0',
      Labels: {
        'com.docker.compose.project': 'infra',
        'com.docker.compose.service': 'airflow-api-server',
        SECRET_LABEL: 'must-not-leak',
      },
      Env: ['DATABASE_PASSWORD=must-not-leak'],
    },
  },
]);

const normalized = normalizeDockerTelemetryStat(
  {
    Container: 'abc123456789',
    Name: 'fallback-name',
    CPUPerc: '2.50%',
    MemUsage: '256MiB / 4GiB',
    MemPerc: '6.25%',
    NetIO: '1MiB / 2MiB',
    BlockIO: '3MiB / 4MiB',
    PIDs: '17',
  },
  metadata,
);

assert.equal(normalized.containerName, 'skydata-studio-airflow-api-server');
assert.equal(normalized.project, 'infra');
assert.equal(normalized.service, 'airflow-api-server');
assert.equal(normalized.cpuPercent, 2.5);
assert.equal(normalized.memoryBytes, 268435456);
assert.equal(normalized.networkTxBytes, 2097152);
assert.equal(normalized.blockWriteBytes, 4194304);
assert.equal(normalized.pids, 17);
assert.equal(Object.hasOwn(normalized, 'labels'), false);
assert.equal(Object.hasOwn(normalized, 'environment'), false);

const calls = [];
const executor = async (_command, args) => {
  calls.push(args);
  if (args[0] === 'stats') {
    return {
      stdout: JSON.stringify({
        Container: 'abc123456789',
        Name: 'skydata-studio-airflow-api-server',
        CPUPerc: '1.25%',
        MemUsage: '128MiB / 4GiB',
        MemPerc: '3.13%',
        NetIO: '10MiB / 5MiB',
        BlockIO: '20MiB / 10MiB',
        PIDs: '11',
      }),
    };
  }
  if (args[0] === 'inspect') {
    return {
      stdout: JSON.stringify({
        Id: 'abc123456789ffff',
        Name: '/skydata-studio-airflow-api-server',
        Config: {
          Image: 'apache/airflow:3.3.0',
          Labels: {
            'com.docker.compose.project': 'infra',
            'com.docker.compose.service': 'airflow-api-server',
          },
        },
      }),
    };
  }
  throw new Error(`Unexpected docker call: ${args.join(' ')}`);
};

(async () => {
  const snapshot = await captureDockerTelemetrySnapshot({
    executor,
    hostname: 'Entity007',
    intervalMs: 5000,
  });
  assert.equal(snapshot.kind, 'DOCKER_TELEMETRY_SNAPSHOT');
  assert.equal(snapshot.source.hostname, 'Entity007');
  assert.equal(snapshot.containers.length, 1);
  assert.equal(snapshot.containers[0].project, 'infra');
  assert.equal(calls.length, 2);

  calls.length = 0;
  let nowValue = 1000;
  const metadataCache = { signature: '', lastRefreshedAt: 0, map: new Map() };
  await captureDockerTelemetrySnapshot({
    executor,
    hostname: 'Entity007',
    intervalMs: 5000,
    metadataCache,
    now: () => nowValue,
  });
  nowValue += 5000;
  await captureDockerTelemetrySnapshot({
    executor,
    hostname: 'Entity007',
    intervalMs: 5000,
    metadataCache,
    now: () => nowValue,
  });
  assert.equal(calls.filter((args) => args[0] === 'stats').length, 2);
  assert.equal(calls.filter((args) => args[0] === 'inspect').length, 1);

  const heartbeat = buildTelemetryHeartbeat({
    hostname: 'Entity007',
    observerStatus: 'ERROR',
    errorCode: 'TEST_ERROR',
  });
  assert.equal(heartbeat.kind, 'DOCKER_TELEMETRY_HEARTBEAT');
  assert.equal(heartbeat.observerStatus, 'ERROR');

  const previousInterval = process.env.SKYCOMMAND_DOCKER_TELEMETRY_INTERVAL_MS;
  process.env.SKYCOMMAND_DOCKER_TELEMETRY_INTERVAL_MS = '1000';
  assert.equal(getDockerTelemetryConfig().intervalMs, 5000);
  if (previousInterval === undefined) delete process.env.SKYCOMMAND_DOCKER_TELEMETRY_INTERVAL_MS;
  else process.env.SKYCOMMAND_DOCKER_TELEMETRY_INTERVAL_MS = previousInterval;

  console.log('✅ SkyCommand Docker telemetry bridge self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
