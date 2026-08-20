const assert = require('node:assert/strict');

const {
  buildDockerEventStreamId,
  getDockerEventStreamStatus,
  getReplayEvents,
  ingestDockerEventPayload,
  parseDockerEventStreamSequence,
  resetDockerEventStreamForTest,
  streamDockerEvents,
  subscribeDockerEvents,
} = require('./dockerEventStreamService');

resetDockerEventStreamForTest();
assert.equal(getDockerEventStreamStatus().status, 'WAITING');

const messages = [];
const unsubscribe = subscribeDockerEvents((message) => messages.push(message));

ingestDockerEventPayload({
  kind: 'BRIDGE_HEARTBEAT',
  providerCode: 'DOCKER',
  occurredAt: new Date().toISOString(),
  source: { hostname: 'TEST-HOST', transport: 'HOST_AGENT' },
  observerStatus: 'ONLINE',
});

assert.equal(getDockerEventStreamStatus().status, 'ONLINE');
assert.equal(getDockerEventStreamStatus().sourceHostname, 'TEST-HOST');
assert.equal(getDockerEventStreamStatus().sourceObserverStatus, 'ONLINE');
assert.equal(messages.at(-1).type, 'stream-status');

ingestDockerEventPayload({
  kind: 'BRIDGE_HEARTBEAT',
  providerCode: 'DOCKER',
  occurredAt: new Date().toISOString(),
  source: { hostname: 'TEST-HOST', transport: 'HOST_AGENT' },
  observerStatus: 'RETRYING',
});
assert.equal(getDockerEventStreamStatus().status, 'DEGRADED');

ingestDockerEventPayload({
  kind: 'BRIDGE_HEARTBEAT',
  providerCode: 'DOCKER',
  occurredAt: new Date().toISOString(),
  source: { hostname: 'TEST-HOST', transport: 'HOST_AGENT' },
  observerStatus: 'ONLINE',
});
assert.equal(getDockerEventStreamStatus().status, 'ONLINE');

const first = ingestDockerEventPayload({
  kind: 'DOCKER_EVENT',
  action: 'START',
  containerId: 'abc123',
  containerName: 'test-container',
  project: 'infra',
  service: 'api',
  image: 'example:latest',
  occurredAt: new Date().toISOString(),
  source: { hostname: 'TEST-HOST', transport: 'HOST_AGENT' },
});

const second = ingestDockerEventPayload({
  kind: 'DOCKER_EVENT',
  action: 'PAUSE',
  containerId: 'abc123',
  containerName: 'test-container',
  project: 'infra',
  service: 'api',
  occurredAt: new Date().toISOString(),
  source: { hostname: 'TEST-HOST', transport: 'HOST_AGENT' },
});

assert.equal(first.sequence, 1);
assert.equal(second.sequence, 2);
assert.equal(messages.at(-1).type, 'docker-event');
assert.equal(messages.at(-1).data.action, 'PAUSE');
assert.deepEqual(getReplayEvents({ afterSequence: 1 }).map((event) => event.sequence), [2]);
assert.equal(getDockerEventStreamStatus().totalEventsReceived, 2);
const streamId = buildDockerEventStreamId(2);
assert.equal(parseDockerEventStreamSequence(streamId), 2);
assert.equal(parseDockerEventStreamSequence(`different-instance:2`), 0);

const responseChunks = [];
const responseHeaders = {};
const requestListeners = {};
const request = {
  headers: {},
  query: {},
  once(eventName, listener) {
    requestListeners[eventName] = listener;
  },
};
const response = {
  statusCode: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(name, value) {
    responseHeaders[name] = value;
  },
  flushHeaders() {},
  write(chunk) {
    responseChunks.push(String(chunk));
    return true;
  },
};

streamDockerEvents(request, response);
assert.equal(response.statusCode, 200);
assert.equal(responseHeaders['Content-Type'], 'text/event-stream; charset=utf-8');
assert.equal(responseHeaders['X-Accel-Buffering'], 'no');
assert.match(responseChunks.join(''), /event: stream-status/);
assert.match(responseChunks.join(''), /event: docker-event/);
assert.equal(typeof requestListeners.close, 'function');
requestListeners.close();

assert.throws(
  () => ingestDockerEventPayload({ kind: 'DOCKER_EVENT', action: '', containerId: '' }),
  /requires an action and container identity/,
);

unsubscribe();
resetDockerEventStreamForTest();
console.log('Docker event stream service self-test passed.');
