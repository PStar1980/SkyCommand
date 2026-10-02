'use strict';

const crypto = require('node:crypto');

const AUTH_AB_PHASES = Object.freeze([
  'APP_SERVER_STARTUP',
  'INITIALIZE',
  'POST_INITIALIZE_IDLE',
  'ACCOUNT_LOGIN_START',
  'POST_REQUEST_PROCESSING',
]);
const SAFE_REASONS = new Set([
  'INVALID_AUTHORITY', 'DNS_LOOKUP_FAILED', 'PORT_NOT_ALLOWED', 'HOST_NOT_ALLOWLISTED',
  'NON_PUBLIC_DNS_RESULT', 'UPSTREAM_CONNECT_FAILED', 'PUBLIC_ALLOWLISTED_TLS',
]);
const AUTH_AB_EVENT_DOMAIN = 'skycommand-codex-auth-ab-destination-v1\0';

function monotonicNs() {
  return process.hrtime.bigint().toString();
}

function destinationFingerprint(host, key) {
  if (typeof host !== 'string' || !host || host.length > 253
    || !Buffer.isBuffer(key) || key.length < 32) throw new TypeError('Invalid diagnostic input.');
  return crypto.createHmac('sha256', key)
    .update(AUTH_AB_EVENT_DOMAIN)
    .update(host.trim().toLowerCase().replace(/\.$/, ''))
    .digest('hex').toUpperCase();
}

function projectAuthAbEvent(event, key) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || typeof event.host !== 'string' || event.host.length < 1 || event.host.length > 253
    || !Number.isSafeInteger(event.cursor) || event.cursor < 1
    || !Number.isSafeInteger(event.port) || event.port < 1 || event.port > 65535
    || !['ALLOW', 'DENY'].includes(event.decision) || !SAFE_REASONS.has(event.reason)
    || typeof event.observedAt !== 'string'
    || typeof event.observedMonotonicNs !== 'string' || !/^\d{1,40}$/.test(event.observedMonotonicNs)) {
    throw new TypeError('Invalid diagnostic event.');
  }
  return {
    cursor: event.cursor,
    destinationClassification: event.host.trim().toLowerCase().replace(/\.$/, '') === 'auth.openai.com'
      ? 'APPROVED_AUTH_HOST' : 'OTHER_HOST_REDACTED',
    destinationFingerprint: destinationFingerprint(event.host, key),
    port: event.port,
    decision: event.decision,
    reason: event.reason,
    observedAt: event.observedAt,
    observedMonotonicNs: event.observedMonotonicNs,
    count: 1,
  };
}

function projectAuthAbPhase(phase) {
  return {
    phase: phase.phase,
    boundarySource: 'PROXY_PHASE_CURSOR',
    startedMonotonicNs: phase.startedMonotonicNs,
    endedMonotonicNs: phase.endedMonotonicNs,
    beforeCursor: phase.beforeCursor,
    afterCursor: phase.afterCursor,
    beforeCount: phase.beforeCount,
    afterCount: phase.afterCount,
    count: phase.count,
    events: phase.events,
  };
}

class AuthAbPhaseJournal {
  constructor(options = {}) {
    this.maxEvents = Number.isSafeInteger(options.maxEvents) ? options.maxEvents : 80;
    this.key = options.key || crypto.randomBytes(32);
    this.now = options.now || (() => new Date().toISOString());
    this.readMonotonicNs = options.monotonicNs || monotonicNs;
    this.events = [];
    this.cursor = 0;
    this.pendingConnects = 0;
    this.active = null;
    this.phaseCounts = new Map();
    this.pendingByPhase = new Map();
    this.waiters = new Map();
  }

  beginConnect() {
    this.pendingConnects += 1;
    const token = this.active?.token || null;
    if (token) this.pendingByPhase.set(token, (this.pendingByPhase.get(token) || 0) + 1);
    return token;
  }

  finishConnect(token, host, port, decision, reason) {
    this.pendingConnects = Math.max(0, this.pendingConnects - 1);
    const event = {
      host,
      port,
      decision,
      reason,
      cursor: ++this.cursor,
      observedAt: this.now(),
      observedMonotonicNs: this.readMonotonicNs(),
      phaseToken: token,
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    if (token) {
      this.phaseCounts.set(token, (this.phaseCounts.get(token) || 0) + 1);
      const pending = Math.max(0, (this.pendingByPhase.get(token) || 1) - 1);
      this.pendingByPhase.set(token, pending);
      if (pending === 0) this.waiters.get(token)?.();
    }
    return event;
  }

  beginPhase(phase) {
    if (!AUTH_AB_PHASES.includes(phase) || this.active) throw new TypeError('Invalid diagnostic phase.');
    const boundary = {
      phase,
      token: crypto.randomUUID(),
      startedMonotonicNs: this.readMonotonicNs(),
      beforeCursor: this.cursor,
      beforeCount: this.events.length,
      startedAt: this.now(),
    };
    this.active = boundary;
    this.phaseCounts.set(boundary.token, 0);
    this.pendingByPhase.set(boundary.token, 0);
    return { ...boundary };
  }

  async waitForPhaseConnections(token, timeoutMs = 2000) {
    if ((this.pendingByPhase.get(token) || 0) === 0) return true;
    let timer;
    const idle = new Promise((resolve) => { this.waiters.set(token, resolve); });
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const settled = await Promise.race([idle.then(() => true), timeout]);
    clearTimeout(timer);
    this.waiters.delete(token);
    return settled;
  }

  async endPhase(token) {
    const boundary = this.active;
    if (!boundary || boundary.token !== token) throw new TypeError('Invalid diagnostic phase.');
    const drained = await this.waitForPhaseConnections(token);
    if (!drained) {
      this.active = null;
      throw new TypeError('Diagnostic phase did not drain.');
    }
    const endedMonotonicNs = this.readMonotonicNs();
    const afterCursor = this.cursor;
    const afterCount = this.events.length;
    const rawEvents = this.events.filter((event) => event.phaseToken === token);
    const expectedCount = this.phaseCounts.get(token) || 0;
    if (rawEvents.length !== expectedCount || expectedCount > this.maxEvents
      || afterCursor - boundary.beforeCursor !== rawEvents.length
      || (rawEvents.length > 0 && rawEvents[0].cursor <= boundary.beforeCursor)) {
      this.active = null;
      throw new TypeError('Diagnostic phase evidence is incomplete.');
    }
    const result = {
      phase: boundary.phase,
      startedMonotonicNs: boundary.startedMonotonicNs,
      endedMonotonicNs,
      beforeCursor: boundary.beforeCursor,
      afterCursor,
      beforeCount: boundary.beforeCount,
      afterCount,
      count: rawEvents.reduce((count, event) => count + 1, 0),
      events: rawEvents.map((event) => projectAuthAbEvent(event, this.key)),
    };
    this.active = null;
    this.pendingByPhase.delete(token);
    this.phaseCounts.delete(token);
    this.waiters.delete(token);
    return projectAuthAbPhase(result);
  }

  safeSnapshot() {
    return {
      cursor: this.cursor,
      pendingConnects: this.pendingConnects,
      count: this.events.length,
      events: this.events.map((event) => projectAuthAbEvent(event, this.key)),
    };
  }
}

module.exports = {
  AUTH_AB_PHASES,
  AuthAbPhaseJournal,
  destinationFingerprint,
  projectAuthAbEvent,
  projectAuthAbPhase,
};
