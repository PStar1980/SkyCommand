const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const gateway = require(path.join(ROOT, 'scripts/mcp/skycommandMcpGateway'));

const RETIRED_TOOL_NAMES = [
  'skycommand_database_upgrade_plan',
  'skycommand_database_upgrade_apply_request',
];

function config(overrides = {}) {
  return gateway.getGatewayConfig({
    SKYCOMMAND_MCP_GATEWAY_ENABLED: 'true',
    SKYCOMMAND_MCP_EXECUTION_ENABLED: 'false',
    SKYCOMMAND_MCP_DEV_PROMOTION_ENABLED: 'false',
    SKYCOMMAND_ASSISTANT_API_TOKEN: 'synthetic-test-token',
    SKYCOMMAND_MCP_AGENT_ID: 'r7-mcp-test',
    SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES: 'command-center-status-snapshot',
    ...overrides,
  });
}

function toolNames(gatewayConfig) {
  return gateway.getToolDefinitions(gatewayConfig).map((tool) => tool.name);
}

async function main() {
  const legacyEnvConfig = config({
    SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED: 'true',
    SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED: 'true',
    SKYCOMMAND_MCP_DB_UPGRADE_PLAN_ENABLED: 'true',
    SKYCOMMAND_MCP_DB_UPGRADE_APPLY_REQUEST_ENABLED: 'true',
  });

  for (const retiredField of [
    'databaseUpgradePlanEnabled',
    'databaseUpgradeApplyRequestEnabled',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(legacyEnvConfig, retiredField), false);
  }

  const readOnlyNames = toolNames(legacyEnvConfig);
  assert.ok(readOnlyNames.includes('skycommand_system_capabilities'));
  assert.ok(readOnlyNames.includes('skycommand_workflow_run_get'));
  for (const retiredToolName of RETIRED_TOOL_NAMES) {
    assert.equal(readOnlyNames.includes(retiredToolName), false);
  }

  const executionNames = toolNames(
    config({
      SKYCOMMAND_MCP_EXECUTION_ENABLED: 'true',
      SKYCOMMAND_MCP_DEV_PROMOTION_ENABLED: 'true',
    }),
  );
  assert.ok(executionNames.includes('skycommand_workflow_start'));
  assert.ok(executionNames.includes('skycommand_development_promotion_start'));
  for (const retiredToolName of RETIRED_TOOL_NAMES) {
    assert.equal(executionNames.includes(retiredToolName), false);
  }

  const statusText = JSON.stringify(gateway.gatewayStatus(legacyEnvConfig));
  assert.equal(statusText.includes('database_upgrade_plan'), false);
  assert.equal(statusText.includes('database_upgrade_apply_request'), false);

  const initialized = await gateway.handleJsonRpcMessage(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    legacyEnvConfig,
  );
  assert.equal(initialized.result.instructions.includes('D2'), false);
  assert.equal(initialized.result.instructions.includes('database-upgrade'), false);

  const listed = await gateway.handleJsonRpcMessage(
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    legacyEnvConfig,
  );
  const listedNames = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(listedNames, readOnlyNames);
  assert.equal(JSON.stringify(listed.result).includes('database_upgrade'), false);

  const capabilitiesCall = await gateway.handleToolCall(
    { name: 'skycommand_system_capabilities', arguments: {} },
    legacyEnvConfig,
    async ({ method, relativePath, body }) => {
      assert.equal(method, 'GET');
      assert.equal(relativePath, '/capabilities');
      assert.equal(body, undefined);
      return { capabilities: { integrationVersion: 'synthetic' } };
    },
  );
  assert.equal(capabilitiesCall.structuredContent.ok, true);
  assert.equal(capabilitiesCall.structuredContent.assistantApi.integrationVersion, 'synthetic');

  const retiredCall = await gateway.handleToolCall(
    { name: 'skycommand_database_upgrade_plan', arguments: {} },
    legacyEnvConfig,
  );
  assert.equal(retiredCall.isError, true);
  assert.equal(retiredCall.structuredContent.code, 'MCP_TOOL_NOT_FOUND');

  console.log('R7 MCP gateway cleanup self-test passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
