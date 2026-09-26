'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const http = require('node:http');
const fs = require('node:fs');
const net = require('node:net');
const { addressIsPublic, hostAllowed, normalizeHost, parseAuthority } = require('./policy');
const { AuthAbPhaseJournal, projectAuthAbEvent } = require('./authAbDiagnostics');

const PORT = Number(process.env.CODEX_EGRESS_PROXY_PORT || 3128);
const POLICY_PATH = process.env.CODEX_EGRESS_ALLOWLIST_PATH || '/etc/skycommand/provider-allowlist.txt';
const MAX_EVENTS = 80;
const AUTH_AB_MODE = process.env.CODEX_EGRESS_AUTH_AB_MODE === '1';
const configuredFingerprintKey = process.env.CODEX_EGRESS_AUTH_AB_FINGERPRINT_KEY || '';
if (AUTH_AB_MODE && !/^[A-F0-9]{64}$/i.test(configuredFingerprintKey)) {
  throw new Error('Auth A/B diagnostic key is unavailable.');
}
const phaseJournal = new AuthAbPhaseJournal({
  maxEvents: MAX_EVENTS,
  ...(AUTH_AB_MODE ? { key: Buffer.from(configuredFingerprintKey, 'hex') } : {}),
});

function loadAllowlist() {
  const raw = fs.readFileSync(POLICY_PATH, 'utf8');
  const hosts = raw.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim().toLowerCase())
    .filter(Boolean);
  if (hosts.some((host) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))) {
    throw new Error('Codex provider egress policy contains a malformed hostname.');
  }
  return [...new Set(hosts)].sort();
}

function record(host, port, decision, reason, phaseToken) {
  const event = phaseJournal.finishConnect(phaseToken, host, port, decision, reason);
  const projected = AUTH_AB_MODE
    ? projectAuthAbEvent(event, phaseJournal.key)
    : { host: event.host, port: 443, decision: event.decision, reason: event.reason, observedAt: event.observedAt };
  process.stdout.write(`${JSON.stringify({ service: 'codex-egress-proxy', ...projected })}\n`);
}

function reply(socket, status, text) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024) throw new TypeError('Invalid diagnostic request.');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid diagnostic request.');
  return value;
}

async function connectAllowed(host, port) {
  const allowlist = loadAllowlist();
  if (port !== 443) return { allowed: false, reason: 'PORT_NOT_ALLOWED' };
  if (!hostAllowed(host, allowlist)) return { allowed: false, reason: 'HOST_NOT_ALLOWLISTED' };
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !addressIsPublic(record.address))) {
    return { allowed: false, reason: 'NON_PUBLIC_DNS_RESULT' };
  }
  return { allowed: true, address: records[0].address, family: records[0].family };
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    let allowlist;
    try {
      allowlist = loadAllowlist();
    } catch (_error) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, code: 'EGRESS_POLICY_INVALID' }));
      return;
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(POLICY_PATH)).digest('hex').toUpperCase();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, profile: 'CODEX_PROVIDER_ALLOWLIST', allowedHostCount: allowlist.length, policyDigest: digest }));
    return;
  }
  if (request.method === 'GET' && request.url === '/diagnostics') {
    if (AUTH_AB_MODE) {
      sendJson(response, 200, phaseJournal.safeSnapshot());
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      const events = phaseJournal.events.map(({ host, decision, reason, observedAt }) => ({ host, port: 443, decision, reason, observedAt }));
      response.end(JSON.stringify({ events }));
    }
    return;
  }
  if (AUTH_AB_MODE && request.method === 'POST' && request.url === '/auth-ab/phase/begin') {
    readJsonBody(request).then((body) => {
      if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(['phase'])) throw new TypeError('Invalid diagnostic request.');
      const boundary = phaseJournal.beginPhase(body.phase);
      sendJson(response, 200, {
        ok: true,
        phase: boundary.phase,
        token: boundary.token,
        startedMonotonicNs: boundary.startedMonotonicNs,
        beforeCursor: boundary.beforeCursor,
        beforeCount: boundary.beforeCount,
      });
    }).catch(() => sendJson(response, 400, { ok: false, code: 'PHASE_BOUNDARY_INVALID' }));
    return;
  }
  if (AUTH_AB_MODE && request.method === 'POST' && request.url === '/auth-ab/phase/end') {
    readJsonBody(request).then(async (body) => {
      if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(['token'])
        || typeof body.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.token)) {
        throw new TypeError('Invalid diagnostic request.');
      }
      sendJson(response, 200, { ok: true, ...(await phaseJournal.endPhase(body.token)) });
    }).catch(() => sendJson(response, 409, { ok: false, code: 'PHASE_BOUNDARY_INVALID' }));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.on('connect', async (request, client, head) => {
  const phaseToken = phaseJournal.beginConnect();
  const authority = parseAuthority(request.url);
  const host = authority?.host || 'INVALID';
  if (!authority || !Number.isInteger(authority.port) || !net.isIP(authority.host) && !host.includes('.')) {
    record(host, authority?.port || 443, 'DENY', 'INVALID_AUTHORITY', phaseToken);
    reply(client, '403 Forbidden', 'Denied');
    return;
  }
  let target;
  try {
    target = await connectAllowed(authority.host, authority.port);
  } catch (_error) {
    record(host, authority.port, 'DENY', 'DNS_LOOKUP_FAILED', phaseToken);
    reply(client, '502 Bad Gateway', 'Denied');
    return;
  }
  if (!target.allowed) {
    record(host, authority.port, 'DENY', target.reason, phaseToken);
    reply(client, '403 Forbidden', 'Denied');
    return;
  }

  const upstream = net.connect({ host: target.address, port: authority.port, family: target.family });
  let settled = false;
  upstream.setTimeout(30000, () => upstream.destroy(new Error('Upstream connect timeout.')));
  upstream.once('connect', () => {
    if (settled) return;
    settled = true;
    record(host, authority.port, 'ALLOW', 'PUBLIC_ALLOWLISTED_TLS', phaseToken);
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: SkyCommand-Codex-Egress\r\n\r\n');
    if (head?.length) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.once('error', () => {
    if (settled) return;
    settled = true;
    record(host, authority.port, 'DENY', 'UPSTREAM_CONNECT_FAILED', phaseToken);
    if (!client.destroyed) reply(client, '502 Bad Gateway', 'Unavailable');
  });
  client.once('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  const allowlist = loadAllowlist();
  const digest = crypto.createHash('sha256').update(fs.readFileSync(POLICY_PATH)).digest('hex').toUpperCase();
  process.stdout.write(`${JSON.stringify({ service: 'codex-egress-proxy', status: 'ONLINE', allowedHostCount: allowlist.length, policyDigest: digest })}\n`);
});

module.exports = { connectAllowed, loadAllowlist, phaseJournal, record, server };
