'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');

const PORT = Number(process.env.CODEX_CONTROL_BRIDGE_PORT || 4220);
const API_CONTROL_BIND_HOST = 'codex-control-bridge-api-control';
const WORKER_URL =
  process.env.CODEX_RUNTIME_WORKER_URL || 'http://codex-agent-runtime-worker-runtime-control:4219';
const API_TOKEN_FILE =
  process.env.CODEX_BRIDGE_TOKEN_FILE || '/run/codex-api-bridge/api-bridge-token';
const RUNTIME_TOKEN_FILE =
  process.env.CODEX_RUNTIME_TOKEN_FILE || '/run/codex-runtime-control/runtime-control-token';
const ROUTES = new Map([
  ['/v1/enrollment/start', ['POST', '/enrollment/start']],
  ['/v1/enrollment/reconcile', ['POST', '/enrollment/reconcile']],
  ['/v1/enrollment/cancel', ['POST', '/enrollment/cancel']],
  ['/v1/runtime/health', ['GET', '/health']],
  ['/v1/account/read', ['POST', '/account/read']],
  ['/v1/account/metadata', ['POST', '/account/metadata']],
  ['/v1/account/logout', ['POST', '/account/logout']],
]);
const MAX_BODY_BYTES = 16 * 1024;
const SAFE_RPC_METHODS = new Set([
  'account/read', 'account/login/start', 'account/login/cancel', 'account/logout',
  'account/rateLimits/read', 'account/usage/read',
]);
const RPC_STAGE_BY_METHOD = Object.freeze({
  'account/read': 'ACCOUNT_READ',
  'account/login/start': 'DEVICE_CODE_LOGIN_START',
  'account/login/cancel': 'DEVICE_CODE_LOGIN_CANCEL',
  'account/logout': 'ACCOUNT_LOGOUT',
  'account/rateLimits/read': 'ACCOUNT_RATE_LIMITS_READ',
  'account/usage/read': 'ACCOUNT_USAGE_READ',
});
const SAFE_RPC_OUTCOMES = new Set(['SUCCEEDED', 'JSON_RPC_ERROR', 'TIMEOUT', 'TRANSPORT_ERROR']);
const ACCOUNT_READ_ERROR_CLASSIFICATIONS = new Set([
  'WORKSPACE_ROUTING_DUPLICATE',
  'WORKSPACE_ROUTING_TIMEOUT',
  'WORKSPACE_ROUTING_UNAUTHORIZED',
  'WORKSPACE_ROUTING_UNAVAILABLE',
  'WORKSPACE_ROUTING_DISCOVERY_ERROR',
  'ACCOUNT_READ_INTERNAL_ERROR',
]);
const ACCOUNT_READ_DATA_KINDS = new Set(['NULL', 'STRING', 'OBJECT', 'ARRAY', 'OTHER']);
const ACCOUNT_READ_LEXICAL_SIGNAL_NAMES = Object.freeze([
  'workspace', 'routing', 'discovery', 'duplicate', 'timeout',
  'unauthorized', 'unavailable', 'account', 'auth',
]);
const SAFE_DIAGNOSTIC_SECRET_MARKERS = new Set([
  'TOKEN', 'SECRET', 'COOKIE', 'CREDENTIAL', 'PASSWORD', 'BEARER', 'AUTHORIZATION',
  'ACCESS', 'REFRESH', 'DEVICE', 'USER', 'VERIFICATION', 'URL', 'LOGIN_ID', 'EMAIL', 'HEADER',
]);
const LOGIN_NOTIFICATION_TYPES = new Set(['account/login/completed', 'account/updated']);
const PROVIDER_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function safeDiagnosticCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,5}$/.test(normalized)) return null;
  if (normalized.split('_').some((part) => SAFE_DIAGNOSTIC_SECRET_MARKERS.has(part))) return null;
  return normalized;
}

function safeTimestamp(value) {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function safeLexicalSignals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(ACCOUNT_READ_LEXICAL_SIGNAL_NAMES.map((name) => [name, value[name] === true]));
}

function safeDiagnosticDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toUpperCase() : null;
}

function safeRpcDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const method = SAFE_RPC_METHODS.has(value.method) ? value.method : null;
  const stage = method ? RPC_STAGE_BY_METHOD[method] : null;
  const outcome = SAFE_RPC_OUTCOMES.has(value.outcome) ? value.outcome : null;
  const observedAt = safeTimestamp(value.observedAt);
  if (!method || !stage || !outcome || !observedAt) return null;
  const rpcCode = Number.isSafeInteger(value.rpcCode) && Math.abs(value.rpcCode) <= 1_000_000_000
    ? value.rpcCode
    : null;
  if (outcome === 'JSON_RPC_ERROR' && rpcCode === null) return null;
  const requestId = Number.isSafeInteger(value.requestId) && value.requestId > 0
    ? value.requestId
    : null;
  if (requestId === null) return null;
  const diagnostic = {
    method,
    requestId,
    rpcCode,
    type: safeDiagnosticCode(value.type),
    reason: safeDiagnosticCode(value.reason),
    stage,
    outcome,
    failureCode: safeDiagnosticCode(value.failureCode),
    observedAt,
  };
  if (method === 'account/read' && outcome === 'JSON_RPC_ERROR') {
    diagnostic.accountReadClassification = ACCOUNT_READ_ERROR_CLASSIFICATIONS.has(value.accountReadClassification)
      ? value.accountReadClassification
      : 'ACCOUNT_READ_INTERNAL_ERROR';
    const messageSignals = safeLexicalSignals(value.messageSignals);
    const dataSignals = value.dataKind === 'STRING' ? safeLexicalSignals(value.dataSignals) : null;
    if (typeof value.messagePresent === 'boolean'
      && ACCOUNT_READ_DATA_KINDS.has(value.dataKind)
      && messageSignals
      && (value.dataKind !== 'STRING' || dataSignals)) {
      diagnostic.messagePresent = value.messagePresent;
      diagnostic.dataKind = value.dataKind;
      diagnostic.messageDigest = safeDiagnosticDigest(value.messageDigest);
      diagnostic.messageSignals = messageSignals;
      diagnostic.dataDigest = value.dataKind === 'STRING' ? safeDiagnosticDigest(value.dataDigest) : null;
      diagnostic.dataSignals = dataSignals;
    }
  }
  return diagnostic;
}

function safeLoginStateDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const operationId = typeof value.enrollmentOperationId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.enrollmentOperationId)
    ? value.enrollmentOperationId
    : null;
  const appServerGeneration = typeof value.appServerGeneration === 'string'
    && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.appServerGeneration)
    ? value.appServerGeneration
    : null;
  const timestamps = value.timestamps && typeof value.timestamps === 'object' ? value.timestamps : {};
  return {
    enrollmentOperationId: operationId,
    appServerGeneration,
    state: ['PENDING_USER', 'COMPLETED', 'FAILED'].includes(value.state) ? value.state : 'UNKNOWN',
    latestNotificationType: LOGIN_NOTIFICATION_TYPES.has(value.latestNotificationType) ? value.latestNotificationType : null,
    latestRpc: safeRpcDiagnostic(value.latestRpc),
    timestamps: {
      loginStartedAt: safeTimestamp(timestamps.loginStartedAt),
      loginCompletedAt: safeTimestamp(timestamps.loginCompletedAt),
      latestNotificationAt: safeTimestamp(timestamps.latestNotificationAt),
      latestRpcAt: safeTimestamp(timestamps.latestRpcAt),
    },
  };
}

function safeProviderDestinations(value) {
  return (Array.isArray(value) ? value : []).filter((event) =>
    PROVIDER_HOST_PATTERN.test(String(event?.host || ''))
      && event?.decision === 'DENY'
      && event?.reason === 'HOST_NOT_ALLOWLISTED')
    .slice(-20)
    .map((event) => ({
      host: String(event.host).toLowerCase(),
      decision: 'DENY',
      reason: 'HOST_NOT_ALLOWLISTED',
      observedAt: safeTimestamp(event.observedAt),
    }));
}

function safeWorkerErrorPayload(payload) {
  const code = typeof payload?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(payload.code)
    ? payload.code
    : 'CODEX_RUNTIME_OPERATION_FAILED';
  const details = {};
  const rpcDiagnostic = safeRpcDiagnostic(payload?.details?.rpcDiagnostic);
  if (rpcDiagnostic) details.rpcDiagnostic = rpcDiagnostic;
  if (code === 'CODEX_PROVIDER_EGRESS_BLOCKED') {
    const observedProviderDestinations = safeProviderDestinations(payload?.details?.observedProviderDestinations);
    if (observedProviderDestinations.length) details.observedProviderDestinations = observedProviderDestinations;
  }
  return { ok: false, code, ...(Object.keys(details).length ? { details } : {}) };
}

function apiControlBindingError() {
  return Object.assign(new Error('Control bridge API-control network binding is unavailable.'), {
    code: 'CODEX_CONTROL_BRIDGE_BINDING_UNAVAILABLE',
  });
}

async function resolveApiControlAddress({
  lookup = dns.lookup,
  networkInterfaces = os.networkInterfaces(),
} = {}) {
  let records;
  try {
    records = await lookup(API_CONTROL_BIND_HOST, { all: true, verbatim: true });
  } catch (_error) {
    throw apiControlBindingError();
  }
  if (!Array.isArray(records) || records.length !== 1) throw apiControlBindingError();
  const [record] = records;
  if (
    ![4, 'IPv4'].includes(record?.family) ||
    typeof record?.address !== 'string' ||
    !net.isIPv4(record?.address) ||
    record.address === '0.0.0.0' ||
    record.address.startsWith('127.')
  ) {
    throw apiControlBindingError();
  }
  const localAssignments = Object.values(networkInterfaces || {})
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .filter((item) => item?.family === 'IPv4' || item?.family === 4)
    .filter((item) => item?.internal === false && item.address === record.address);
  if (localAssignments.length !== 1) throw apiControlBindingError();
  return record.address;
}

function listenOnApiControlAddress(server, address, port = PORT) {
  if (
    typeof address !== 'string' ||
    !net.isIPv4(address) ||
    address === '0.0.0.0' ||
    address.startsWith('127.')
  ) {
    throw apiControlBindingError();
  }
  server.listen(port, address);
}

function readToken(filePath) {
  const value = fs.readFileSync(filePath, 'utf8').trim();
  if (value.length < 40) throw new Error('Control bridge credential is invalid.');
  return value;
}

function constantTimeEqual(left, right) {
  const a = crypto
    .createHash('sha256')
    .update(String(left || ''), 'utf8')
    .digest();
  const b = crypto
    .createHash('sha256')
    .update(String(right || ''), 'utf8')
    .digest();
  return crypto.timingSafeEqual(a, b);
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES)
      throw Object.assign(new Error('Request too large.'), { code: 'REQUEST_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_error) {
    throw Object.assign(new Error('Invalid JSON.'), { code: 'INVALID_JSON' });
  }
}

async function forward(method, path, body = {}) {
  const response = await fetch(new URL(path, `${WORKER_URL.replace(/\/+$/, '')}/`), {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${readToken(RUNTIME_TOKEN_FILE)}`,
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response
    .json()
    .catch(() => ({ ok: false, code: 'CODEX_RUNTIME_RESPONSE_INVALID' }));
  return { status: response.status, payload };
}

function createServer(options = {}) {
  const token = options.token || readToken(API_TOKEN_FILE);
  const fetcher = options.fetcher || forward;
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://codex-control.local').pathname;
    if (request.method === 'GET' && pathname === '/healthz') {
      try {
        const worker = await fetcher('GET', '/health', {});
        const healthy = worker.status === 200 && worker.payload?.ok === true;
        return send(response, healthy ? 200 : 503, {
          ok: healthy,
          service: 'CODEX_CONTROL_BRIDGE',
          profile: 'CODEX_MANAGED_BOOTSTRAP',
          runtimeReadiness: worker.payload?.readiness || 'RUNTIME_OFFLINE',
        });
      } catch (_error) {
        return send(response, 503, {
          ok: false,
          service: 'CODEX_CONTROL_BRIDGE',
          code: 'CODEX_RUNTIME_UNAVAILABLE',
        });
      }
    }
    const supplied =
      /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || ''))?.[1] || '';
    if (!constantTimeEqual(supplied, token))
      return send(response, 401, { ok: false, code: 'CODEX_CONTROL_BRIDGE_UNAUTHORIZED' });
    const route = ROUTES.get(pathname);
    if (!route || request.method !== route[0])
      return send(response, 404, { ok: false, code: 'CODEX_CONTROL_BRIDGE_ROUTE_NOT_FOUND' });
    try {
      const body = await readBody(request);
      const result = await fetcher(route[0], route[1], body);
      if (pathname === '/v1/runtime/health') {
        const health = result.payload && typeof result.payload === 'object' ? { ...result.payload } : {};
        if (Object.hasOwn(health, 'loginStateDiagnostic')) {
          health.loginStateDiagnostic = safeLoginStateDiagnostic(health.loginStateDiagnostic);
        }
        return send(response, result.status === 200 ? 200 : 503, {
          ok: true,
          health,
        });
      }
      return send(response, result.status, result.payload?.ok === false
        ? safeWorkerErrorPayload(result.payload)
        : result.payload);
    } catch (error) {
      return send(response, 503, { ok: false, code: error.code || 'CODEX_RUNTIME_UNAVAILABLE' });
    }
  });
}

if (require.main === module) {
  resolveApiControlAddress()
    .then((bindAddress) => {
      const server = createServer();
      server.requestTimeout = 65000;
      server.headersTimeout = 15000;
      server.keepAliveTimeout = 5000;
      listenOnApiControlAddress(server, bindAddress);
      for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
    })
    .catch(() => {
      console.error('CODEX_CONTROL_BRIDGE_BINDING_UNAVAILABLE');
      process.exitCode = 1;
    });
}

module.exports = {
  API_CONTROL_BIND_HOST,
  PORT,
  ROUTES,
  WORKER_URL,
  constantTimeEqual,
  createServer,
  forward,
  listenOnApiControlAddress,
  readBody,
  readToken,
  resolveApiControlAddress,
  safeLoginStateDiagnostic,
  safeRpcDiagnostic,
  safeWorkerErrorPayload,
};
