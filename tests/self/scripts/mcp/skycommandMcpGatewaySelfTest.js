const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../..');
const gateway = require(path.join(ROOT, 'scripts/mcp/skycommandMcpGateway'));

function config(overrides = {}) {
  return {
    enabled: true,
    executionEnabled: false,
    apiBaseUrl: 'http://127.0.0.1:7171/api/assistant',
    apiToken: 'test-token',
    agentId: 'codex-local',
    allowedAutomationCodes: new Set(['command-center-status-snapshot']),
    requestTimeoutMs: 5000,
    logLevel: 'error',
    ...overrides,
  };
}


async function verifyStdioTransport() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/mcp/skycommandMcpGateway.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      SKYCOMMAND_MCP_GATEWAY_ENABLED: 'true',
      SKYCOMMAND_MCP_EXECUTION_ENABLED: 'false',
      SKYCOMMAND_ASSISTANT_API_TOKEN: 'self-test-token',
      SKYCOMMAND_MCP_AGENT_ID: 'self-test-agent',
      SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES: 'command-center-status-snapshot',
      SKYCOMMAND_MCP_LOG_LEVEL: 'error',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const waitForLines = async (count) => {
    const started = Date.now();
    while (Date.now() - started < 3000) {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length >= count) return lines.map((line) => JSON.parse(line));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`MCP STDIO self-test timed out. stdout=${stdout} stderr=${stderr}`);
  };

  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 101,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stdio-self-test', version: '1.0.0' } },
  })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'tools/list', params: {} })}\n`);

  try {
    const responses = await waitForLines(2);
    assert.equal(responses[0].id, 101);
    assert.equal(responses[0].result.protocolVersion, '2025-11-25');
    assert.equal(responses[1].id, 102);
    const names = responses[1].result.tools.map((tool) => tool.name);
    assert.ok(names.includes('skycommand_system_capabilities'));
    assert.ok(!names.includes('skycommand_browser_automation_run'));
  } finally {
    child.stdin.end();
    child.kill();
  }
}

async function run() {
  assert.equal(gateway.MCP_PROTOCOL_VERSION, '2025-11-25');
  assert.equal(gateway.automationIsAllowed(config(), 'command-center-status-snapshot'), true);
  assert.equal(gateway.automationIsAllowed(config(), 'not-allowed'), false);
  assert.equal(gateway.automationIsAllowed(config({ allowedAutomationCodes: new Set(['*']) }), 'anything'), true);

  const readOnlyTools = gateway.getToolDefinitions(config()).map((tool) => tool.name);
  assert.ok(readOnlyTools.includes('skycommand_system_capabilities'));
  assert.ok(readOnlyTools.includes('skycommand_browser_automations_list'));
  assert.ok(!readOnlyTools.includes('skycommand_browser_automation_run'));

  const executionTools = gateway.getToolDefinitions(config({ executionEnabled: true })).map((tool) => tool.name);
  assert.ok(executionTools.includes('skycommand_browser_automation_run'));

  const initialize = await gateway.handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'self-test', version: '1.0.0' } },
  }, config());
  assert.equal(initialize.result.protocolVersion, '2025-11-25');
  assert.ok(initialize.result.capabilities.tools);

  const probe = await gateway.handleJsonRpcMessage({ jsonrpc: '2.0', id: 2, method: 'server/discover', params: {} }, config());
  assert.equal(probe.error.code, -32601);

  const requests = [];
  const requestImpl = async ({ method, relativePath, body }) => {
    requests.push({ method, relativePath, body });
    if (relativePath.startsWith('/browser-automations?')) {
      return {
        ok: true,
        items: [
          { automationCode: 'command-center-status-snapshot', assistant: { enabled: true, executable: true } },
          { automationCode: 'other-enabled-automation', assistant: { enabled: true, executable: true } },
        ],
      };
    }
    if (relativePath === '/browser-automations/command-center-status-snapshot') {
      return { ok: true, automation: { automationCode: 'command-center-status-snapshot' } };
    }
    if (relativePath === '/browser-automations/command-center-status-snapshot/runs') {
      return { ok: true, execution: { workflowId: 'wf-123', status: 'STARTED' } };
    }
    if (relativePath === '/browser-automation-runs/wf-123') {
      return { ok: true, run: { workflowId: 'wf-123', status: 'SUCCESS', terminal: true } };
    }
    if (relativePath === '/capabilities') return { ok: true, capabilities: { enabled: true } };
    throw new Error(`Unexpected self-test request ${method} ${relativePath}`);
  };

  const list = await gateway.handleToolCall({ name: 'skycommand_browser_automations_list', arguments: {} }, config(), requestImpl);
  assert.equal(list.structuredContent.items.length, 1);
  assert.equal(list.structuredContent.items[0].automationCode, 'command-center-status-snapshot');

  const denied = await gateway.handleToolCall({
    name: 'skycommand_browser_automation_get',
    arguments: { automationCode: 'other-enabled-automation' },
  }, config(), requestImpl);
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.code, 'MCP_AUTOMATION_NOT_ALLOWED');

  const executionDisabled = await gateway.handleToolCall({
    name: 'skycommand_browser_automation_run',
    arguments: { automationCode: 'command-center-status-snapshot' },
  }, config(), requestImpl);
  assert.equal(executionDisabled.isError, true);
  assert.equal(executionDisabled.structuredContent.code, 'MCP_EXECUTION_DISABLED');

  const started = await gateway.handleToolCall({
    name: 'skycommand_browser_automation_run',
    arguments: { automationCode: 'command-center-status-snapshot', environmentCode: 'LOCAL', parameters: {} },
  }, config({ executionEnabled: true }), requestImpl);
  assert.equal(started.isError, undefined);
  assert.equal(started.structuredContent.execution.workflowId, 'wf-123');

  const runStatus = await gateway.handleToolCall({
    name: 'skycommand_browser_automation_run_get',
    arguments: { workflowId: 'wf-123' },
  }, config(), requestImpl);
  assert.equal(runStatus.structuredContent.run.status, 'SUCCESS');

  assert.ok(requests.some((item) => item.method === 'POST' && item.body.environmentCode === 'LOCAL'));

  const gatewayConfig = gateway.getGatewayConfig({
    API_PORT: '7171',
    SKYCOMMAND_MCP_GATEWAY_ENABLED: 'true',
    SKYCOMMAND_MCP_EXECUTION_ENABLED: 'true',
    SKYCOMMAND_ASSISTANT_API_TOKEN: 'secret',
    SKYCOMMAND_MCP_AGENT_ID: 'openclaw-local',
    SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES: 'command-center-status-snapshot,other',
  });
  assert.equal(gatewayConfig.enabled, true);
  assert.equal(gatewayConfig.executionEnabled, true);
  assert.equal(gatewayConfig.agentId, 'openclaw-local');
  assert.equal(gatewayConfig.allowedAutomationCodes.has('other'), true);

  await verifyStdioTransport();

  console.log('[mcp-gateway:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
