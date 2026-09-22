const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'docker/agent-runtime-worker.Dockerfile'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'apps/agent-runtime-worker/src/index.js'), 'utf8');
const activities = fs.readFileSync(path.join(root, 'apps/agent-runtime-worker/src/activities.js'), 'utf8');
const health = fs.readFileSync(path.join(root, 'apps/agent-runtime-worker/src/health.js'), 'utf8');

const serviceStart = compose.indexOf('  agent-runtime-worker:');
const nextService = compose.indexOf('\n  browser-worker:', serviceStart + 4);
const service = compose.slice(serviceStart, nextService > serviceStart ? nextService : undefined);
assert.notEqual(serviceStart, -1, 'dedicated Agent Runtime Worker service is declared');
assert.match(service, /docker\/agent-runtime-worker\.Dockerfile/);
assert.match(service, /TEMPORAL_ADDRESS: temporal:7233/);
assert.match(service, /AGENT_RUNTIME_TASK_QUEUE/);
assert.match(service, /read_only: true/);
assert.match(service, /no-new-privileges:true/);
assert.match(service, /cap_drop:\s*\n\s*- ALL/);
assert.match(service, /tmpfs:/);
assert.match(service, /user: ['"]?1000:1000/);
assert.doesNotMatch(service, /privileged:\s*true|env_file:|volumes:|secrets:|docker\.sock|network_mode:\s*host/i);

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
