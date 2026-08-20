const assert = require('node:assert/strict');

const {
  buildDockerSnapshot,
  normalizeContainer,
  parseJsonRecords,
  parseLabelMap,
} = require('./dockerSnapshot');

assert.deepEqual(parseJsonRecords('{"Name":"one"}\n{"Name":"two"}'), [
  { Name: 'one' },
  { Name: 'two' },
]);
assert.deepEqual(parseJsonRecords('[{"Name":"one"},{"Name":"two"}]'), [
  { Name: 'one' },
  { Name: 'two' },
]);
assert.deepEqual(parseLabelMap('com.docker.compose.project=skycommand,com.docker.compose.service=api'), {
  'com.docker.compose.project': 'skycommand',
  'com.docker.compose.service': 'api',
});

const container = normalizeContainer({
  ID: 'abc123',
  Names: 'skycommand-api-1',
  Image: 'skycommand-api',
  State: 'running',
  Status: 'Up 2 minutes (healthy)',
  Labels: 'com.docker.compose.project=skycommand,com.docker.compose.service=api',
});
assert.equal(container.project, 'skycommand');
assert.equal(container.service, 'api');
assert.equal(container.state, 'RUNNING');
assert.equal(container.health, 'HEALTHY');

const snapshot = buildDockerSnapshot({
  info: {
    ServerVersion: '28.0.0',
    Name: 'docker-desktop',
    OperatingSystem: 'Docker Desktop',
    OSType: 'linux',
    Architecture: 'x86_64',
    NCPU: 8,
    MemTotal: 17179869184,
    Driver: 'overlayfs',
  },
  compose: [{ Name: 'skycommand', Status: 'running(2)', ConfigFiles: 'compose.yaml' }],
  containers: [
    {
      ID: 'one',
      Names: 'skycommand-api-1',
      Image: 'skycommand-api',
      State: 'running',
      Status: 'Up 2 minutes (healthy)',
      Labels: 'com.docker.compose.project=skycommand,com.docker.compose.service=api',
    },
    {
      ID: 'two',
      Names: 'skycommand-web-1',
      Image: 'skycommand-web',
      State: 'running',
      Status: 'Up 2 minutes',
      Labels: 'com.docker.compose.project=skycommand,com.docker.compose.service=web',
    },
  ],
  images: [{ ID: 'img', Repository: 'skycommand-api', Tag: 'latest', Size: '500MB' }],
  volumes: [{ Name: 'skycommand_pgdata', Driver: 'local', Scope: 'local' }],
  networks: [{ ID: 'net', Name: 'skycommand_default', Driver: 'bridge', Scope: 'local' }],
});

assert.equal(snapshot.provider.code, 'DOCKER');
assert.equal(snapshot.provider.status, 'ONLINE');
assert.equal(snapshot.counts.projects, 1);
assert.equal(snapshot.counts.containers, 2);
assert.equal(snapshot.counts.running, 2);
assert.equal(snapshot.counts.healthy, 1);
assert.equal(snapshot.counts.unhealthy, 0);
assert.equal(snapshot.counts.images, 1);
assert.equal(snapshot.projects[0].state, 'RUNNING');
assert.equal(snapshot.projects[0].serviceCount, 2);

console.log('✅ SkyCommand Docker snapshot self-test passed.');
