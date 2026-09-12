#!/usr/bin/env node

const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MCP_PROTOCOL_VERSION = '2025-11-25';
const GATEWAY_VERSION = '0.1.0';
const MAX_INPUT_BUFFER_BYTES = 1024 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value, fallback, minimum = 1, maximum = 300000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function normalizeAgentId(value) {
  const normalized = String(value || 'skycommand-mcp-local').trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(normalized) ? normalized : 'skycommand-mcp-local';
}

function parseAutomationAllowlist(value) {
  const codes = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set(codes);
}

function loadRootEnv() {
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  }
}

function getGatewayConfig(env = process.env) {
  const apiPort = parsePositiveInteger(env.API_PORT || env.ADMIN_PORT, 7171, 1, 65535);
  const apiBaseUrl = String(
    env.SKYCOMMAND_MCP_API_BASE_URL || `http://127.0.0.1:${apiPort}/api/assistant`,
  ).replace(/\/+$/, '');

  return {
    enabled: parseBoolean(env.SKYCOMMAND_MCP_GATEWAY_ENABLED, false),
    executionEnabled: parseBoolean(env.SKYCOMMAND_MCP_EXECUTION_ENABLED, false),
    apiBaseUrl,
    apiToken: String(env.SKYCOMMAND_ASSISTANT_API_TOKEN || '').trim(),
    agentId: normalizeAgentId(env.SKYCOMMAND_MCP_AGENT_ID),
    allowedAutomationCodes: parseAutomationAllowlist(env.SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES),
    requestTimeoutMs: parsePositiveInteger(env.SKYCOMMAND_MCP_REQUEST_TIMEOUT_MS, 65000, 1000, 300000),
    logLevel: String(env.SKYCOMMAND_MCP_LOG_LEVEL || 'info').trim().toLowerCase(),
  };
}

function automationIsAllowed(config, automationCode) {
  if (!automationCode) return false;
  return config.allowedAutomationCodes.has('*') || config.allowedAutomationCodes.has(automationCode);
}

function gatewayStatus(config) {
  return {
    gatewayVersion: `skycommand_mcp_gateway.v1`,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: 'STDIO',
    agentId: config.agentId,
    apiBaseUrl: config.apiBaseUrl,
    executionEnabled: config.executionEnabled,
    allowedAutomationCodes: [...config.allowedAutomationCodes],
    safety: {
      assistantApiTokenRequired: true,
      assistantOptInStillRequired: true,
      assistantPermissionScopeStillRequired: true,
      confirmationRequiredAutomationsRemainBlocked: true,
      registeredEnvironmentStillEnforced: true,
      mcpExecutionKillSwitch: true,
      mcpAutomationAllowlist: true,
      interactiveExecutionUnavailable: true,
    },
  };
}

function getToolDefinitions(config) {
  const tools = [
    {
      name: 'skycommand_system_capabilities',
      title: 'SkyCommand capabilities',
      description: 'Read the bounded SkyCommand Assistant integration capabilities available to this MCP gateway.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'skycommand_browser_automations_list',
      title: 'List allowed browser automations',
      description: 'List Assistant-enabled Playwright Automations that are also allowed by this MCP gateway.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'skycommand_browser_automation_get',
      title: 'Get browser automation',
      description: 'Read one Assistant-enabled Playwright Automation contract that this MCP gateway is allowed to expose.',
      inputSchema: {
        type: 'object',
        properties: { automationCode: { type: 'string', minLength: 1 } },
        required: ['automationCode'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'skycommand_browser_automation_run_get',
      title: 'Get browser automation run',
      description: 'Read status, structured result, and artifact metadata for an Assistant-originated browser automation run.',
      inputSchema: {
        type: 'object',
        properties: { workflowId: { type: 'string', minLength: 1 } },
        required: ['workflowId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  if (config.executionEnabled) {
    tools.push({
      name: 'skycommand_browser_automation_run',
      title: 'Run browser automation',
      description: 'Start an allowed SkyCommand Playwright Automation through the bounded Assistant API. Execution is HEADLESS and all server-side opt-in, permission, risk, confirmation, and environment policies remain enforced.',
      inputSchema: {
        type: 'object',
        properties: {
          automationCode: { type: 'string', minLength: 1 },
          environmentCode: { type: 'string', minLength: 1 },
          parameters: { type: 'object', additionalProperties: true },
        },
        required: ['automationCode'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    });
  }

  return tools;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`${label} must be an object.`);
    error.code = 'MCP_INVALID_ARGUMENTS';
    throw error;
  }
  return value;
}

function assertString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    const error = new Error(`${label} is required.`);
    error.code = 'MCP_INVALID_ARGUMENTS';
    throw error;
  }
  return normalized;
}

function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function mcpErrorPayload(error) {
  return {
    ok: false,
    error: error.message || 'SkyCommand MCP tool call failed.',
    code: error.code || error.details?.code || 'SKYCOMMAND_MCP_TOOL_FAILED',
    statusCode: error.statusCode || null,
    details: error.details || null,
  };
}

function requestJson(config, method, relativePath, body = undefined, requestImpl = null) {
  if (requestImpl) return requestImpl({ config, method, relativePath, body });

  const url = new URL(`${config.apiBaseUrl}${relativePath}`);
  const transport = url.protocol === 'https:' ? https : http;
  const bodyText = body === undefined ? null : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiToken}`,
        'X-SkyCommand-Agent-Id': config.agentId,
        ...(bodyText ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyText) } : {}),
      },
    }, (response) => {
      let size = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_HTTP_RESPONSE_BYTES) {
          request.destroy(new Error('SkyCommand Assistant API response exceeded the MCP gateway limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch (_error) {
            const parseError = new Error('SkyCommand Assistant API returned invalid JSON.');
            parseError.statusCode = response.statusCode;
            parseError.details = { responseSnippet: text.slice(0, 500) };
            reject(parseError);
            return;
          }
        }
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
          const apiError = new Error(parsed.error || `SkyCommand Assistant API returned HTTP ${response.statusCode}.`);
          apiError.statusCode = response.statusCode;
          apiError.code = parsed.code || parsed.details?.code || 'SKYCOMMAND_ASSISTANT_API_ERROR';
          apiError.details = parsed.details || null;
          reject(apiError);
          return;
        }
        resolve(parsed);
      });
    });

    request.setTimeout(config.requestTimeoutMs, () => {
      request.destroy(new Error(`SkyCommand Assistant API request timed out after ${config.requestTimeoutMs} ms.`));
    });
    request.on('error', reject);
    if (bodyText) request.write(bodyText);
    request.end();
  });
}

async function handleToolCall({ name, arguments: rawArguments = {} }, config, requestImpl = null) {
  const args = assertObject(rawArguments || {}, 'arguments');

  try {
    if (name === 'skycommand_system_capabilities') {
      const api = await requestJson(config, 'GET', '/capabilities', undefined, requestImpl);
      return toolResult({ ok: true, gateway: gatewayStatus(config), assistantApi: api.capabilities || api });
    }

    if (name === 'skycommand_browser_automations_list') {
      const limit = parsePositiveInteger(args.limit, 25, 1, 100);
      const offset = Number.isInteger(Number(args.offset)) && Number(args.offset) >= 0 ? Number(args.offset) : 0;
      const api = await requestJson(config, 'GET', `/browser-automations?limit=${limit}&offset=${offset}`, undefined, requestImpl);
      const items = (api.items || []).filter((item) => automationIsAllowed(config, item.automationCode));
      return toolResult({
        ok: true,
        items,
        gatewayAllowlistApplied: true,
        executionEnabled: config.executionEnabled,
      });
    }

    if (name === 'skycommand_browser_automation_get') {
      const automationCode = assertString(args.automationCode, 'automationCode');
      if (!automationIsAllowed(config, automationCode)) {
        const error = new Error(`Playwright Automation '${automationCode}' is not allowed by this MCP gateway.`);
        error.code = 'MCP_AUTOMATION_NOT_ALLOWED';
        throw error;
      }
      const api = await requestJson(config, 'GET', `/browser-automations/${encodeURIComponent(automationCode)}`, undefined, requestImpl);
      return toolResult(api);
    }

    if (name === 'skycommand_browser_automation_run_get') {
      const workflowId = assertString(args.workflowId, 'workflowId');
      const api = await requestJson(config, 'GET', `/browser-automation-runs/${encodeURIComponent(workflowId)}`, undefined, requestImpl);
      return toolResult(api);
    }

    if (name === 'skycommand_browser_automation_run') {
      if (!config.executionEnabled) {
        const error = new Error('MCP execution is disabled by SKYCOMMAND_MCP_EXECUTION_ENABLED.');
        error.code = 'MCP_EXECUTION_DISABLED';
        throw error;
      }
      const automationCode = assertString(args.automationCode, 'automationCode');
      if (!automationIsAllowed(config, automationCode)) {
        const error = new Error(`Playwright Automation '${automationCode}' is not allowed by this MCP gateway.`);
        error.code = 'MCP_AUTOMATION_NOT_ALLOWED';
        throw error;
      }
      const api = await requestJson(
        config,
        'POST',
        `/browser-automations/${encodeURIComponent(automationCode)}/runs`,
        {
          ...(args.environmentCode ? { environmentCode: args.environmentCode } : {}),
          parameters: args.parameters || {},
        },
        requestImpl,
      );
      return toolResult(api);
    }

    const error = new Error(`Unknown SkyCommand MCP tool '${name}'.`);
    error.code = 'MCP_TOOL_NOT_FOUND';
    throw error;
  } catch (error) {
    return toolResult(mcpErrorPayload(error), { isError: true });
  }
}

function jsonRpcError(id, code, message, data = undefined) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

async function handleJsonRpcMessage(message, config, requestImpl = null) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }

  const method = String(message.method || '');
  const isNotification = message.id === undefined || message.id === null;

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
  if (isNotification) return null;

  if (method === 'initialize') {
    return jsonRpcResult(message.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'skycommand-mcp-gateway', version: GATEWAY_VERSION },
      instructions: 'Use SkyCommand tools as a governed local execution surface. Read discovery tools first. The browser automation run tool is present only when the local MCP execution kill switch is enabled, and SkyCommand server-side safety policy always remains authoritative.',
    });
  }

  if (method === 'ping') return jsonRpcResult(message.id, {});
  if (method === 'tools/list') return jsonRpcResult(message.id, { tools: getToolDefinitions(config) });
  if (method === 'tools/call') {
    try {
      const params = assertObject(message.params || {}, 'params');
      const name = assertString(params.name, 'tool name');
      const result = await handleToolCall({ name, arguments: params.arguments || {} }, config, requestImpl);
      return jsonRpcResult(message.id, result);
    } catch (error) {
      return jsonRpcResult(message.id, toolResult(mcpErrorPayload(error), { isError: true }));
    }
  }

  // A 2026-era auto-negotiating client may probe server/discover first. Returning
  // Method not found is deliberate: clients that support legacy MCP can then fall
  // back to the 2025-11-25 initialize handshake used by this zero-dependency gateway.
  return jsonRpcError(message.id, -32601, 'Method not found');
}

function writeMessage(message, stdout = process.stdout) {
  stdout.write(`${JSON.stringify(message)}\n`);
}

function log(config, level, message) {
  const rank = { error: 0, warn: 1, info: 2, debug: 3 };
  const configured = rank[config.logLevel] ?? rank.info;
  const requested = rank[level] ?? rank.info;
  if (requested <= configured) process.stderr.write(`[SkyCommand MCP] ${message}\n`);
}

function validateStartupConfig(config) {
  if (!config.enabled) throw new Error('SkyCommand MCP Gateway is disabled. Set SKYCOMMAND_MCP_GATEWAY_ENABLED=true.');
  if (!config.apiToken) throw new Error('SKYCOMMAND_ASSISTANT_API_TOKEN is required by the MCP Gateway.');
  if (!config.allowedAutomationCodes.size) {
    log(config, 'warn', 'No automation codes are allowed. Discovery will be empty until SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES is configured.');
  }
}

async function runStdioServer(config, stdin = process.stdin, stdout = process.stdout) {
  validateStartupConfig(config);
  let buffer = '';
  let chain = Promise.resolve();

  log(config, 'info', `starting v${GATEWAY_VERSION} for agent '${config.agentId}' (${config.executionEnabled ? 'execution enabled' : 'read-only'})`);

  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > MAX_INPUT_BUFFER_BYTES) {
      log(config, 'error', 'input buffer limit exceeded; terminating gateway');
      process.exitCode = 1;
      stdin.pause();
      return;
    }

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      chain = chain.then(async () => {
        let message;
        try {
          message = JSON.parse(trimmed);
        } catch (_error) {
          writeMessage(jsonRpcError(null, -32700, 'Parse error'), stdout);
          return;
        }
        const response = await handleJsonRpcMessage(message, config);
        if (response) writeMessage(response, stdout);
      }).catch((error) => {
        log(config, 'error', error.stack || error.message || String(error));
      });
    }
  });

  stdin.on('end', () => {
    chain.catch(() => {}).finally(() => log(config, 'debug', 'stdio closed'));
  });
}

if (require.main === module) {
  loadRootEnv();
  const config = getGatewayConfig();
  try {
    runStdioServer(config);
  } catch (error) {
    process.stderr.write(`[SkyCommand MCP] startup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  GATEWAY_VERSION,
  MCP_PROTOCOL_VERSION,
  automationIsAllowed,
  gatewayStatus,
  getGatewayConfig,
  getToolDefinitions,
  handleJsonRpcMessage,
  handleToolCall,
  mcpErrorPayload,
  normalizeAgentId,
  parseAutomationAllowlist,
  parseBoolean,
  requestJson,
  toolResult,
  validateStartupConfig,
};
