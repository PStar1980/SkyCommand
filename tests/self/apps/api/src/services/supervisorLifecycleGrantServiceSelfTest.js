#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);


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

    return authorizeRuntimeControl({
      action: 'REBUILD_WEB',
      confirmed: true,
      actor: { userId: 'user-1', username: 'paul' },
      session: { sessionId: 'session-1', appCode: 'SKYSERVER_ADMIN' },
      requestContext: { ipAddress: '127.0.0.1', userAgent: 'self-test' },
      auditRecorder: async (event) => auditEvents.push(event),
      nowMs: nowMs + 1000,
    });
  })
  .then((rebuildResult) => {
    assert.equal(rebuildResult.authorization.action, 'REBUILD_WEB');
    verifyLifecycleGrant(rebuildResult.authorization.grant, {
      secret: process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
      action: 'REBUILD_WEB',
      nowMs: nowMs + 5_000,
    });
    assert.equal(auditEvents.length, 2);

    return authorizeRuntimeControl({
      action: 'REBUILD_BACKEND',
      confirmed: true,
      actor: { userId: 'user-1', username: 'paul' },
      session: { sessionId: 'session-1', appCode: 'SKYSERVER_ADMIN' },
      requestContext: { ipAddress: '127.0.0.1', userAgent: 'self-test' },
      auditRecorder: async (event) => auditEvents.push(event),
      nowMs: nowMs + 2000,
    });
  })
  .then((backendRebuildResult) => {
    assert.equal(backendRebuildResult.authorization.action, 'REBUILD_BACKEND');
    verifyLifecycleGrant(backendRebuildResult.authorization.grant, {
      secret: process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
      action: 'REBUILD_BACKEND',
      nowMs: nowMs + 5_000,
    });
    assert.equal(auditEvents.length, 3);

    return authorizeRuntimeControl({
      action: 'REBUILD_CODEX_BOOTSTRAP',
      operationId: '123e4567-e89b-12d3-a456-426614174000',
      confirmed: true,
      actor: { userId: 'user-1', username: 'paul' },
      session: { sessionId: 'session-1', appCode: 'SKYSERVER_ADMIN' },
      requestContext: { ipAddress: '127.0.0.1', userAgent: 'self-test' },
      auditRecorder: async (event) => auditEvents.push(event),
      nowMs: nowMs + 3000,
    });
  })
  .then((codexRebuildResult) => {
    assert.equal(codexRebuildResult.authorization.action, 'REBUILD_CODEX_BOOTSTRAP');
    const claims = verifyLifecycleGrant(codexRebuildResult.authorization.grant, {
      secret: process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
      action: 'REBUILD_CODEX_BOOTSTRAP',
      nowMs: nowMs + 5_000,
    });
    assert.equal(claims.operationId, '123e4567-e89b-12d3-a456-426614174000');
    assert.equal(auditEvents.at(-1).metadata.operationId, '123e4567-e89b-12d3-a456-426614174000');
    assert.match(auditEvents.at(-1).message, /managed Codex bootstrap runtime cell/i);


    return authorizeRuntimeControl({
      action: 'REBUILD_AGENT_SESSION_RUNTIME',
      operationId: '223e4567-e89b-42d3-a456-426614174001',
      permissionCode: 'DEV_RUNTIME_LIFECYCLE',
      confirmed: true,
      actor: { userId: 'user-1', username: 'paul' },
      session: { sessionId: 'session-1', appCode: 'SKYSERVER_ADMIN' },
      requestContext: { ipAddress: '127.0.0.1', userAgent: 'self-test' },
      auditRecorder: async (event) => auditEvents.push(event),
      nowMs: nowMs + 4000,
    });
  })
  .then((agentSessionRefreshResult) => {
    assert.equal(agentSessionRefreshResult.authorization.action, 'REBUILD_AGENT_SESSION_RUNTIME');
    const claims = verifyLifecycleGrant(agentSessionRefreshResult.authorization.grant, {
      secret: process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
      action: 'REBUILD_AGENT_SESSION_RUNTIME',
      nowMs: nowMs + 5_000,
    });
    assert.equal(claims.operationId, '223e4567-e89b-42d3-a456-426614174001');
    assert.match(auditEvents.at(-1).message, /Agent Session API \+ Node Worker runtime slice/i);

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
