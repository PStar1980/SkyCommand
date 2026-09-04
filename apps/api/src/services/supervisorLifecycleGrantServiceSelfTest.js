#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  verifyLifecycleGrant,
} = require('../../../../packages/supervisor/src/lifecycleGrant');
const {
  authorizeRuntimeControl,
} = require('./supervisorLifecycleGrantService');

const originalGrantSecret = process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET;
const originalControlToken = process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN;
process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET = 'self-test-supervisor-lifecycle-secret';
process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN = '';

const auditEvents = [];
const nowMs = Date.UTC(2026, 8, 3, 20, 0, 0);

authorizeRuntimeControl({
  action: 'restart',
  confirmed: true,
  actor: { userId: 'user-1', username: 'paul' },
  session: { sessionId: 'session-1', appCode: 'SKYSERVER_ADMIN' },
  requestContext: { ipAddress: '127.0.0.1', userAgent: 'self-test' },
  auditRecorder: async (event) => auditEvents.push(event),
  nowMs,
})
  .then((result) => {
    assert.equal(result.authorization.action, 'RESTART');
    assert.ok(result.authorization.grant);
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].eventType, 'SKYCOMMAND_RUNTIME_CONTROL_AUTHORIZED');
    assert.equal(auditEvents[0].metadata.transport, 'SUPERVISOR_SIGNED_GRANT');

    const claims = verifyLifecycleGrant(result.authorization.grant, {
      secret: process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
      action: 'RESTART',
      nowMs: nowMs + 5_000,
    });
    assert.equal(claims.sub, 'user-1');
    assert.equal(claims.sid, 'session-1');

    return assert.rejects(
      () => authorizeRuntimeControl({ action: 'STOP', confirmed: false }),
      /explicit confirmation/i,
    );
  })
  .then(() => {
    console.log('✅ SkyCommand Supervisor lifecycle authorization self-test passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (originalGrantSecret === undefined) delete process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET;
    else process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET = originalGrantSecret;
    if (originalControlToken === undefined) delete process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN;
    else process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN = originalControlToken;
  });
