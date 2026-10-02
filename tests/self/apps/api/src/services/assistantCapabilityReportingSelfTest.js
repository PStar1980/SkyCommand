const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
const assistantIntegrationService = require(
  path.join(ROOT, 'apps/api/src/services/assistantIntegrationService'),
);

(async () => {
  const legacy = assistantIntegrationService.getCapabilities({ agentId: 'codex-local' });
  assert.equal(legacy.managedCodexBootstrap.executionEnabled, false);
  assert.equal(legacy.managedCodexBootstrap.legacyAssistantExecutionAuthorized, false);
  assert.equal(legacy.managedCodexBootstrap.authorityScope, 'LEGACY_ASSISTANT_BOOTSTRAP_ONLY');

  const ready = await assistantIntegrationService.getCapabilitiesWithRuntimeReadiness({
    agentId: 'codex-local',
    runtimeReadiness: {
      ok: true,
      readiness: 'CURRENT',
      readinessReason: 'test-ready',
      executionEnabled: true,
      runtimeGeneration: 'test-generation',
      observedAt: '2026-09-29T00:00:00.000Z',
    },
  });
  assert.equal(ready.managedCodexBootstrap.executionEnabled, false);
  assert.equal(ready.managedCodexRuntime.ready, true);
  assert.equal(ready.managedCodexRuntime.executionEnabled, true);
  assert.equal(ready.managedCodexRuntime.readiness, 'CURRENT');
  assert.equal(ready.managedCodexRuntime.authority, 'AGENT_RUN_SERVICE_ONLY');
  assert.equal(ready.managedCodexRuntime.legacyAssistantExecutionAuthorized, false);
  assert.equal(ready.managedCodexRuntime.source, 'managedCodexBootstrapService.getBootstrapReadiness');

  const blocked = await assistantIntegrationService.getCapabilitiesWithRuntimeReadiness({
    agentId: 'codex-local',
    runtimeReadiness: {
      ok: false,
      readiness: 'MCP_UNREACHABLE',
      readinessReason: 'test-blocked',
      executionEnabled: false,
    },
  });
  assert.equal(blocked.managedCodexRuntime.ready, false);
  assert.equal(blocked.managedCodexRuntime.freshness, 'STALE_BLOCKED');
  assert.equal(blocked.managedCodexBootstrap.executionEnabled, false);

  console.log('[assistant-capability-reporting:self-test] PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
