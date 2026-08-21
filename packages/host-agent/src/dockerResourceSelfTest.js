const assert = require('node:assert/strict');
const {
  executeDockerResourceControl,
  executeDockerResourceDetail,
  normalizeImageDetail,
  normalizeNetworkDetail,
  normalizeVolumeDetail,
} = require('./dockerResource');

const image = normalizeImageDetail(
  {
    Id: 'sha256:abc',
    RepoTags: ['skycommand:test'],
    RepoDigests: ['skycommand@sha256:def'],
    Size: 1234,
    Config: { Labels: { purpose: 'test' }, Env: ['SECRET=redacted'] },
  },
  [],
  'skycommand:test',
);
assert.equal(image.cleanup.eligible, true);
assert.equal(image.usageCount, 0);
assert.equal(Object.hasOwn(image, 'environment'), false);
assert.equal(image.labels[0].value, '[redacted]');

const volume = normalizeVolumeDetail({ Name: 'data', Labels: {} }, []);
assert.equal(volume.cleanup.eligible, false);
assert.equal(volume.cleanup.mode, 'DATA_PROTECTED');

const network = normalizeNetworkDetail({ Name: 'bridge', Containers: {} }, []);
assert.equal(network.cleanup.eligible, false);
assert.equal(network.cleanup.mode, 'SYSTEM_PROTECTED');

const customNetwork = normalizeNetworkDetail({ Name: 'demo_default', Containers: {} }, []);
assert.equal(customNetwork.cleanup.eligible, true);

async function detailProof() {
  const calls = [];
  const executor = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'image' && args[1] === 'inspect') {
      return { stdout: JSON.stringify([{ Id: 'sha256:abc', RepoTags: ['demo:test'], Size: 100 }]) };
    }
    if (args[0] === 'container') return { stdout: '' };
    throw new Error(`Unexpected args ${args.join(' ')}`);
  };

  const result = await executeDockerResourceDetail(
    { resourceType: 'IMAGE', reference: 'demo:test' },
    { executor },
  );
  assert.equal(result.resource.reference, 'demo:test');
  assert.equal(result.resource.cleanup.eligible, true);
  assert.equal(calls.length, 2);
}

async function controlProof() {
  const calls = [];
  const executor = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'network' && args[1] === 'inspect') {
      return { stdout: JSON.stringify([{ Name: 'demo_default', Id: 'abc', Containers: {} }]) };
    }
    if (args[0] === 'container') return { stdout: '' };
    if (args[0] === 'network' && args[1] === 'rm') return { stdout: 'demo_default' };
    throw new Error(`Unexpected args ${args.join(' ')}`);
  };
  const result = await executeDockerResourceControl(
    { resourceType: 'NETWORK', reference: 'demo_default', action: 'REMOVE' },
    { executor },
  );
  assert.equal(result.status, 'SUCCESS');
  assert.match(calls.map((args) => args.join(' ')).join('\n'), /network rm demo_default/);
}

Promise.all([detailProof(), controlProof()])
  .then(() => console.log('✅ SkyCommand Docker resource inspection/control self-test passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
