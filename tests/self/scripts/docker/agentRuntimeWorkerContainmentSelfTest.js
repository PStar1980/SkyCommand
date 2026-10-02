const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'docker/agent-runtime-worker.Dockerfile'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'apps/agent-runtime-worker/src/index.js'), 'utf8');
const activities = fs.readFileSync(path.join(root, 'apps/agent-runtime-worker/src/activities.js'), 'utf8');
const health = fs.readFileSync(path.join(root, 'apps/agent-runtime-worker/src/health.js'), 'utf8');

const serviceHeader = '  agent-runtime-worker:';
const serviceStart = compose.indexOf(serviceHeader);
assert.notEqual(serviceStart, -1, 'dedicated Agent Runtime Worker service is declared');
const afterHeader = serviceStart + serviceHeader.length;
const nextServiceMatch = compose.slice(afterHeader).match(/\n  [A-Za-z0-9_-]+:\s*\n/);
const nextService = nextServiceMatch ? afterHeader + nextServiceMatch.index : compose.length;
const service = compose.slice(serviceStart, nextService);
assert.match(service, /docker\/agent-runtime-worker\.Dockerfile/);
assert.match(service, /TEMPORAL_ADDRESS: temporal:7233/);
assert.match(service, /AGENT_RUNTIME_TASK_QUEUE/);
assert.match(service, /read_only: true/);
assert.match(service, /no-new-privileges:true/);
assert.match(service, /cap_drop:\s*\n\s*- ALL/);
assert.match(service, /tmpfs:/);
assert.match(service, /user: ['"]?1000:1000/);
assert.match(service, /CODEX_CONTROL_BRIDGE_TOKEN_FILE:\s*\/run\/codex-api-bridge\/api-bridge-token/);
const volumeBlock = service.match(/\n\s{4}volumes:\s*\n((?:\s{6}- [^\n]+(?:\n|$))*)/);
assert.ok(volumeBlock, 'Agent Runtime Worker declares the bounded control-bridge token volume');
const volumeEntries = volumeBlock[1]
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => line.replace(/^-\s*/, ''));
assert.deepEqual(volumeEntries, [
  'codex_api_bridge_token:/run/codex-api-bridge:ro',
], 'Agent Runtime Worker may mount only the read-only Codex API bridge token volume');
assert.match(compose, /^  codex_api_bridge_token:\s*\n\s+name:\s*skycommand_codex_api_bridge_token\s*$/m);
assert.doesNotMatch(service, /privileged:\s*true|env_file:|secrets:|docker\.sock|network_mode:\s*host/i);
assert.doesNotMatch(service, /codex_runtime_control_token|codex_managed_home/);

assert.match(dockerfile, /FROM node:/);
assert.match(dockerfile, /COPY[^\n]*packages\/agents/);
assert.match(dockerfile, /COPY[^\n]*apps\/agent-runtime-worker/);
assert.match(dockerfile, /USER 1000|USER node/);
assert.doesNotMatch(dockerfile, /(^|\n)COPY \. \.|docker\.sock|(^|\n)COPY[^\n]*\.env/i);
assert.match(worker, /Worker\.create/);
assert.match(worker, /getAgentRuntimeTaskQueue/);
assert.match(worker, /enableNonLocalActivities: true/);
assert.doesNotMatch(worker, /packages\/db|apps\/api|dotenv|process\.env\.PG|SKYCOMMAND_INTERNAL_API_TOKEN/);
assert.match(activities, /executeFakeRuntime/);
assert.match(activities, /resolveFakeRuntimeCase/);
assert.match(activities, /containmentProfile/);
assert.match(health, /SKYCOMMAND_INTERNAL_API_TOKEN/);
assert.match(health, /false/);

console.log('✅ Phase 19.2A dedicated Agent Runtime Worker containment self-test passed.');
