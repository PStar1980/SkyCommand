const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const readme = read('README.md');
const architecture = read('docs/SkyCommand_Docker_Infrastructure_Control_Plane.md');
const changeLog = read('change.log');
const validate = read('scripts/validate.js');
const packageJson = JSON.parse(read('package.json'));

assert.match(readme, /\*\*Phase 17 is complete\*\*/);
assert.match(readme, /\| Phase 17 \| ✅ Complete \|/);
assert.match(readme, /SkyCommand_Docker_Infrastructure_Control_Plane\.md/);
assert.match(readme, /Kubernetes.*future sibling provider/s);

assert.match(architecture, /Durable control plane/);
assert.match(architecture, /Live observability plane/);
assert.match(architecture, /INFRASTRUCTURE_DOCKER_READ/);
assert.match(architecture, /INFRASTRUCTURE_DOCKER_CONTROL/);
assert.match(architecture, /INFRASTRUCTURE_DOCKER_CLEANUP/);
assert.match(architecture, /Failure-state model/);
assert.match(architecture, /last-known/i);
assert.match(architecture, /volume deletion is intentionally not exposed/i);
assert.match(architecture, /future sibling provider/i);

assert.match(changeLog, /Phase 17\.9 Docker integration hardening and completion/);
assert.match(validate, /'docker-integration:self-test'/);
assert.equal(Boolean(packageJson.scripts?.['docker-integration:self-test']), true);

console.log('✅ SkyCommand Docker Phase 17 closure self-test passed.');
