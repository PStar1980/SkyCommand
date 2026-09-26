'use strict';

const http = require('node:http');

const PORT = Number(process.env.CODEX_MCP_GATEWAY_PORT || 3981);
const TOOL_NAME = 'skycommand_browser_automation_run';
const PROTOCOL_VERSION = '2025-11-25';
const MAX_BODY_BYTES = 16 * 1024;
const SERVER_INFO = Object.freeze({ name: 'skycommand-managed-readonly-pilot', version: '19.3A0' });
const TOOL = Object.freeze({
  name: TOOL_NAME,
  title: 'Run the registered read-only Command Center status snapshot',
  description: 'The Phase 19.3A0 bootstrap advertises only the single registered read-only pilot automation. Invocation is disabled until separately authorized; no Browser capability is executed during bootstrap.',
  inputSchema: {
    type: 'object',
    properties: {
      automationCode: { type: 'string', const: 'command-center-status-snapshot' },
      environmentCode: { type: 'string', const: 'LOCAL' },
      parameters: { type: 'object', maxProperties: 0, additionalProperties: false },
    },
    required: ['automationCode'],
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

function handleMessage(message) {
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
          serverInfo: SERVER_INFO,
          instructions: 'Bootstrap and status discovery only. Tool calls are disabled pending Phase 19.3A1 authorization.',
        },
      },
    };
  }
  if (message.method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { tools: [TOOL] } } };
  }
  if (message.method === 'tools/call') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: 'Managed capability invocation is disabled during Phase 19.3A0 bootstrap.' }],
          structuredContent: { ok: false, code: 'CODEX_PILOT_CAPABILITY_NOT_ENABLED' },
        },
      },
    };
  }
  return { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } } };
}

function createServer() {
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://codex-mcp.local').pathname;
    if (request.method === 'GET' && pathname === '/healthz') {
      return sendJson(response, 200, { ok: true, profile: 'CODEX_MANAGED_READ_ONLY_PILOT', toolCount: 1, invocationEnabled: false });
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
      const result = handleMessage(message);
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

module.exports = { PROTOCOL_VERSION, SERVER_INFO, TOOL, TOOL_NAME, createServer, handleMessage };
