'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');

const PORT = Number(process.env.CODEX_MCP_GATEWAY_PORT || 3981);
const TOOL_NAME = 'skycommand_browser_automation_run';
const PROTOCOL_VERSION = '2025-11-25';
const MAX_BODY_BYTES = 16 * 1024;
const SERVER_INFO = Object.freeze({ name: 'skycommand-managed-readonly-pilot', version: '19.3A0' });
const INVOCATION_ENABLED = process.env.CODEX_MCP_INVOCATION_ENABLED === 'true';
const RUNTIME_TOKEN_FILE = process.env.CODEX_RUNTIME_TOKEN_FILE || '/run/codex-runtime-control/runtime-control-token';
const API_TOKEN_FILE = process.env.CODEX_API_BRIDGE_TOKEN_FILE || '/run/codex-api-bridge/api-bridge-token';
const API_URL = process.env.CODEX_API_INTERNAL_URL || 'http://api:7171';
const EFFECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL = Object.freeze({
  name: TOOL_NAME,
  title: 'Run the registered read-only Command Center status snapshot',
  description: 'The bounded managed Codex pilot exposes exactly one registered read-only Command Center status snapshot. No native shell, filesystem, Git, Docker, messaging, spawning, or provider-native capability is exposed.',
  inputSchema: {
    type: 'object',
    properties: {
      automationCode: { type: 'string', const: 'command-center-status-snapshot' },
      environmentCode: { type: 'string', const: 'LOCAL' },
      parameters: { type: 'object', maxProperties: 0, additionalProperties: false },
    },
    required: ['automationCode', 'environmentCode', 'parameters'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large.'), { code: 'REQUEST_TOO_LARGE' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_error) { throw Object.assign(new Error('Invalid JSON.'), { code: 'INVALID_JSON' }); }
}

function readToken(filePath) {
  const value = fs.readFileSync(filePath, 'utf8').trim();
  if (value.length < 40) throw new Error('MCP gateway credential is invalid.');
  return value;
}

function constantTimeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function exactToolArguments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'automationCode,environmentCode,parameters') return false;
  return value.automationCode === 'command-center-status-snapshot'
    && value.environmentCode === 'LOCAL'
    && value.parameters && typeof value.parameters === 'object'
    && !Array.isArray(value.parameters)
    && Object.keys(value.parameters).length === 0;
}

function safeInvocation(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    effectId: value.effectId || null,
    effectKey: value.effectKey || null,
    requestDigest: value.requestDigest || null,
    dispatchState: value.dispatchState || null,
    outcomeCertainty: value.outcomeCertainty || null,
    browserAutomationRunId: value.browserAutomationRunId || null,
    nativeBrowserWorkflowId: value.nativeBrowserWorkflowId || null,
    browserResult: value.browserResult || value.result || null,
    denied: Boolean(value.denied),
    replayed: Boolean(value.replayed),
  };
}

async function dispatchBoundCapability(context, options = {}) {
  if (!context?.effectId || !context.credential) throw Object.assign(new Error('A server-prepared managed capability context is required.'), { code: 'CODEX_MANAGED_CAPABILITY_CONTEXT_REQUIRED' });
  const response = await (options.fetcher || fetch)(`${String(options.apiUrl || API_URL).replace(/\/$/, '')}/_internal/codex/managed-capability-dispatch`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiToken || readToken(API_TOKEN_FILE)}`,
    },
    body: JSON.stringify({
      effectId: context.effectId,
      credential: context.credential,
      runtimeWorker: { identity: 'codex-mcp-gateway', generation: context.generation || null, taskQueue: 'codex-managed-mcp', source: 'CODEX_APP_SERVER' },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) throw Object.assign(new Error('The governed Browser capability dispatch failed.'), { code: payload.code || 'CODEX_MANAGED_CAPABILITY_DISPATCH_FAILED' });
  return payload.effect || payload;
}

function handleMessage(message, options = {}) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { status: 400, body: { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } } };
  }
  const id = message.id;
  if (message.method === 'notifications/initialized') return { status: 202, body: null };
  if (message.method === 'initialize') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { ...SERVER_INFO, version: INVOCATION_ENABLED ? '19.3A1' : SERVER_INFO.version },
          instructions: INVOCATION_ENABLED
            ? 'Bounded read-only pilot only: use the registered Command Center status snapshot. Native shell, filesystem, Git, Docker, messaging, spawning, provider-native tools, and alternate capabilities are unavailable.'
            : 'Bootstrap and status discovery only. Tool calls are disabled pending Phase 19.3A1 authorization.',
        },
      },
    };
  }
  if (message.method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { tools: [TOOL] } } };
  }
  if (message.method === 'tools/call') {
    if (!INVOCATION_ENABLED || !options.context) {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: 'Managed capability invocation is disabled until the bounded Phase 19.3A1 runtime context is bound.' }],
            structuredContent: { ok: false, code: 'CODEX_PILOT_CAPABILITY_NOT_ENABLED' },
          },
        },
      };
    }
    if (message.params?.name !== TOOL_NAME || !exactToolArguments(message.params?.arguments)) {
      return Promise.resolve({
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: { isError: true, content: [{ type: 'text', text: 'Only the exact registered read-only Command Center status snapshot is allowlisted.' }], structuredContent: { ok: false, code: 'CODEX_PILOT_CAPABILITY_ARGUMENTS_DENIED' } },
        },
      });
    }
    const dispatch = options.context.dispatchPromise || (options.context.dispatchPromise = dispatchBoundCapability(options.context, options));
    return dispatch.then((effect) => {
      options.context.result = effect;
      options.context.invocation = safeInvocation(effect);
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            isError: Boolean(effect.denied),
            content: [{ type: 'text', text: effect.denied ? 'The governed Browser capability was denied.' : 'The governed Command Center status snapshot completed.' }],
            structuredContent: { ok: !effect.denied, ...safeInvocation(effect) },
          },
        },
      };
    }).catch((error) => ({
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: 'The governed Browser capability could not be completed.' }], structuredContent: { ok: false, code: error.code || 'CODEX_MANAGED_CAPABILITY_DISPATCH_FAILED' } },
      },
    }));
  }
  return { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } } };
}

function createServer(options = {}) {
  const context = options.context || { effectId: null, credential: null, invocation: null, result: null, dispatchPromise: null };
  const runtimeToken = options.runtimeToken || (INVOCATION_ENABLED ? readToken(RUNTIME_TOKEN_FILE) : null);
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://codex-mcp.local').pathname;
    if (request.method === 'GET' && pathname === '/healthz') {
      return sendJson(response, 200, { ok: true, profile: 'CODEX_MANAGED_READ_ONLY_PILOT', toolCount: 1, invocationEnabled: INVOCATION_ENABLED });
    }
    if (pathname === '/context/bind' || pathname === '/context/result') {
      const supplied = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || ''))?.[1] || '';
      if (!runtimeToken || !constantTimeEqual(supplied, runtimeToken)) return sendJson(response, 401, { ok: false, code: 'CODEX_MCP_CONTEXT_UNAUTHORIZED' });
      if (!INVOCATION_ENABLED) return sendJson(response, 409, { ok: false, code: 'CODEX_PILOT_CAPABILITY_NOT_ENABLED' });
      if (request.method === 'POST' && pathname === '/context/bind') {
        try {
          const body = await readJson(request);
          if (!EFFECT_ID_PATTERN.test(String(body.effectId || '')) || typeof body.credential !== 'string' || body.credential.length < 20 || body.credential.length > 512) return sendJson(response, 400, { ok: false, code: 'CODEX_MCP_CONTEXT_INVALID' });
          context.effectId = String(body.effectId);
          context.credential = body.credential;
          context.invocation = null;
          context.result = null;
          context.dispatchPromise = null;
          context.generation = String(body.generation || '').slice(0, 128) || null;
          return sendJson(response, 200, { ok: true, contextBound: true, effectId: context.effectId });
        } catch (error) { return sendJson(response, 400, { ok: false, code: error.code || 'CODEX_MCP_CONTEXT_INVALID' }); }
      }
      if (request.method === 'GET' && pathname === '/context/result') return sendJson(response, 200, { ok: true, invocation: context.invocation });
      return sendJson(response, 404, { ok: false, code: 'MCP_CONTEXT_ROUTE_NOT_FOUND' });
    }
    if (request.method !== 'POST' || pathname !== '/mcp') {
      return sendJson(response, 404, { ok: false, code: 'MCP_ROUTE_NOT_FOUND' });
    }
    const contentType = String(request.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return sendJson(response, 415, { ok: false, code: 'MCP_JSON_REQUIRED' });
    }
    try {
      const message = await readJson(request);
      const result = await handleMessage(message, { ...options, context, runtimeToken });
      if (result.body === null) {
        response.writeHead(result.status, { 'cache-control': 'no-store' });
        return response.end();
      }
      return sendJson(response, result.status, result.body);
    } catch (error) {
      return sendJson(response, error.code === 'REQUEST_TOO_LARGE' ? 413 : 400, { ok: false, code: error.code || 'MCP_REQUEST_INVALID' });
    }
  });
}

const server = createServer();
server.requestTimeout = 15000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.listen(PORT, '0.0.0.0');

module.exports = { PROTOCOL_VERSION, SERVER_INFO, TOOL, TOOL_NAME, INVOCATION_ENABLED, createServer, dispatchBoundCapability, handleMessage, exactToolArguments };
