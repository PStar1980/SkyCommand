#!/usr/bin/env node

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { verifyLifecycleGrant } = require('./lifecycleGrant');
const { getSupervisorConfig } = require('./config');
const { controlRuntime, getRuntimeStatus } = require('./runtimeLifecycle');

const repositoryRoot = path.resolve(__dirname, '../../..');
const config = getSupervisorConfig(repositoryRoot);
let activeOperation = null;
let lastOperation = null;
const consumedGrantNonces = new Map();

function json(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function getOrigin(req) {
  return String(req.headers.origin || '').trim();
}

function getCorsHeaders(req) {
  const origin = getOrigin(req);
  if (!origin || !config.bootstrapOrigins.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-SkyCommand-Bootstrap,X-SkyCommand-Supervisor-Token,X-SkyCommand-Supervisor-Grant',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
  };
}

function isBootstrapRequestAllowed(req) {
  const origin = getOrigin(req);
  const marker = String(req.headers['x-skycommand-bootstrap'] || '').trim().toLowerCase();
  return config.bootstrapOrigins.has(origin) && marker === 'start';
}

function tokenMatches(candidate) {
  if (!config.controlToken || !candidate) return false;
  const expected = Buffer.from(config.controlToken);
  const supplied = Buffer.from(String(candidate));
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}

function requireControlToken(req) {
  return tokenMatches(req.headers['x-skycommand-supervisor-token']);
}

function pruneConsumedGrants(nowSeconds = Math.floor(Date.now() / 1000)) {
  for (const [nonce, expiresAt] of consumedGrantNonces.entries()) {
    if (Number(expiresAt) < nowSeconds - 5) consumedGrantNonces.delete(nonce);
  }
}

function authorizeLifecycleGrant(req, action) {
  const token = String(req.headers['x-skycommand-supervisor-grant'] || '').trim();
  if (!token) return null;

  const payload = verifyLifecycleGrant(token, {
    secret: config.grantSecret,
    action,
  });

  pruneConsumedGrants();
  if (consumedGrantNonces.has(payload.nonce)) {
    const error = new Error('SkyCommand Supervisor lifecycle grant has already been used.');
    error.code = 'SKYCOMMAND_SUPERVISOR_GRANT_REPLAYED';
    throw error;
  }

  consumedGrantNonces.set(payload.nonce, payload.exp);
  return {
    method: 'SIGNED_GRANT',
    grantId: payload.nonce,
  };
}

function authorizeControlRequest(req, action) {
  if (requireControlToken(req)) return { method: 'CONTROL_TOKEN' };
  return authorizeLifecycleGrant(req, action);
}

async function handleStatus(req, res) {
  const status = await getRuntimeStatus(config);
  json(res, 200, {
    ok: true,
    service: 'SkyCommand Supervisor',
    supervisor: 'ONLINE',
    operation: activeOperation,
    lastOperation,
    ...status,
  }, getCorsHeaders(req));
}

async function handleControl(req, res, action) {
  if (activeOperation) {
    json(res, 409, {
      ok: false,
      code: 'SKYCOMMAND_SUPERVISOR_BUSY',
      error: `SkyCommand Supervisor is already processing ${activeOperation.action}.`,
      operation: activeOperation,
    }, getCorsHeaders(req));
    return;
  }

  if (action === 'START') {
    if (!isBootstrapRequestAllowed(req) && !requireControlToken(req)) {
      json(res, 403, {
        ok: false,
        code: 'SKYCOMMAND_SUPERVISOR_BOOTSTRAP_DENIED',
        error: 'SkyCommand runtime start is restricted to the configured local bootstrap origin.',
      }, getCorsHeaders(req));
      return;
    }
  } else {
    let authorization = null;
    try {
      authorization = authorizeControlRequest(req, action);
    } catch (authorizationError) {
      json(res, 403, {
        ok: false,
        code: authorizationError?.code || 'SKYCOMMAND_SUPERVISOR_CONTROL_DENIED',
        error: authorizationError?.message || 'SkyCommand runtime control authorization failed.',
      }, getCorsHeaders(req));
      return;
    }

    if (!authorization) {
      json(res, 403, {
        ok: false,
        code: 'SKYCOMMAND_SUPERVISOR_CONTROL_DENIED',
        error: 'SkyCommand runtime stop/restart requires an authenticated lifecycle grant.',
      }, getCorsHeaders(req));
      return;
    }
  }

  const operation = {
    action,
    requestedAt: new Date().toISOString(),
  };
  activeOperation = operation;

  json(res, 202, {
    ok: true,
    accepted: true,
    operation,
  }, getCorsHeaders(req));

  setImmediate(async () => {
    try {
      const result = await controlRuntime(config, action);
      lastOperation = {
        ...operation,
        status: 'SUCCEEDED',
        completedAt: new Date().toISOString(),
        runtimeStatus: result?.status?.runtimeStatus || null,
      };
      console.log(`[SkyCommand Supervisor] ${action} completed: ${result.status.runtimeStatus}`);
    } catch (error) {
      lastOperation = {
        ...operation,
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        code: error?.code || 'SKYCOMMAND_SUPERVISOR_ERROR',
        error: error?.message || 'SkyCommand Supervisor action failed.',
      };
      console.error(`[SkyCommand Supervisor] ${action} failed:`, error?.message || error);
    } finally {
      activeOperation = null;
    }
  });
}

async function requestHandler(req, res) {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    if (!Object.keys(corsHeaders).length) {
      json(res, 403, { ok: false, error: 'Origin not allowed.' });
      return;
    }
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      json(res, 200, {
        ok: true,
        service: 'SkyCommand Supervisor',
        status: 'ONLINE',
        projectName: config.projectName,
      }, corsHeaders);
      return;
    }

    if (req.method === 'GET' && req.url === '/runtime/status') {
      await handleStatus(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/runtime/start') {
      await handleControl(req, res, 'START');
      return;
    }

    if (req.method === 'POST' && req.url === '/runtime/stop') {
      await handleControl(req, res, 'STOP');
      return;
    }

    if (req.method === 'POST' && req.url === '/runtime/restart') {
      await handleControl(req, res, 'RESTART');
      return;
    }

    if (req.method === 'POST' && req.url === '/runtime/rebuild-web') {
      await handleControl(req, res, 'REBUILD_WEB');
      return;
    }

    json(res, 404, { ok: false, error: 'Route not found.' }, corsHeaders);
  } catch (error) {
    const statusCode = error?.code === 'SKYCOMMAND_SUPERVISOR_DOCKER_UNAVAILABLE' ? 503 : 500;
    json(res, statusCode, {
      ok: false,
      code: error?.code || 'SKYCOMMAND_SUPERVISOR_ERROR',
      error: error?.message || 'SkyCommand Supervisor request failed.',
    }, corsHeaders);
  }
}

const server = http.createServer(requestHandler);
server.requestTimeout = 15000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;

server.listen(config.port, config.host, () => {
  console.log(`[SkyCommand Supervisor] Listening on ${config.host}:${config.port}`);
  console.log(`[SkyCommand Supervisor] Project=${config.projectName}`);
  console.log(`[SkyCommand Supervisor] Runtime services=${config.runtimeServices.join(',')}`);
});

function shutdown(signal) {
  console.log(`[SkyCommand Supervisor] ${signal} received; stopping.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
