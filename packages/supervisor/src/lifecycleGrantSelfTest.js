#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  issueLifecycleGrant,
  verifyLifecycleGrant,
} = require('./lifecycleGrant');

const secret = 'test-only-supervisor-grant-secret';
const nowMs = Date.UTC(2026, 8, 3, 20, 0, 0);
const issued = issueLifecycleGrant({
  secret,
  action: 'restart',
  subject: 'user-123',
  sessionId: 'session-456',
  ttlSeconds: 45,
  nowMs,
  nonce: 'grant-test-nonce',
});

assert.ok(issued.token.includes('.'));
assert.equal(issued.payload.action, 'RESTART');
assert.equal(issued.payload.sub, 'user-123');
assert.equal(issued.payload.sid, 'session-456');
assert.equal(issued.payload.nonce, 'grant-test-nonce');

const verified = verifyLifecycleGrant(issued.token, {
  secret,
  action: 'RESTART',
  nowMs: nowMs + 10_000,
});
assert.equal(verified.nonce, 'grant-test-nonce');

assert.throws(
  () => verifyLifecycleGrant(issued.token, { secret: 'wrong-secret', action: 'RESTART', nowMs }),
  /signature is invalid/i,
);
assert.throws(
  () => verifyLifecycleGrant(issued.token, { secret, action: 'STOP', nowMs }),
  /claims are invalid/i,
);
assert.throws(
  () => verifyLifecycleGrant(issued.token, { secret, action: 'RESTART', nowMs: nowMs + 180_000 }),
  /expired/i,
);

console.log('✅ SkyCommand Supervisor lifecycle-grant self-test passed.');
