const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const workflow = read('packages/temporal/src/workflows/agentRunWorkflow.js');
assert.doesNotMatch(workflow, /runtimeKind\s*===\s*['"]OPENAI_CODEX_APP_SERVER['"]/);
assert.doesNotMatch(workflow, /realCodexRuntime/);
assert.doesNotMatch(workflow, /runtimeKind:\s*['"]OPENAI_CODEX_APP_SERVER['"]/);
assert.match(workflow, /observationRequired/);
assert.match(workflow, /recovery\.runtimeKind/);
assert.match(workflow, /runtimeMode/);
assert.match(workflow, /providerBacked/);
assert.doesNotMatch(workflow, /codex-read-only-pilot/);
assert.match(workflow, /managedCapabilityCase = operation\.managedCapabilityCase \|\| managedCapabilityCase/);

const runtimeActivities = read('apps/agent-runtime-worker/src/activities.js');
assert.match(runtimeActivities, /observationRequired: result\.sendAcceptance === 'ACKNOWLEDGED'/);
assert.match(runtimeActivities, /runtimeMode: 'PROVIDER_BACKED'/);
assert.match(runtimeActivities, /runtimeMode: 'FIXTURE'/);

const executionService = read('apps/api/src/services/agentExecutionService.js');
assert.match(executionService, /runtimeMode: realCodexRuntime \? 'PROVIDER_BACKED' : 'FIXTURE'/);
assert.match(executionService, /recoverySupported: realCodexRuntime/);
assert.doesNotMatch(executionService, /row\.runtime_code\s*!==\s*['"]OPENAI_CODEX_APP_SERVER['"]/);
assert.match(executionService, /ar\.execution_context/);
assert.match(executionService, /resolvePersistedRecoveryRuntime/);
assert.doesNotMatch(executionService, /runtimeContext\.runtimeKind !== row\.runtime_code/);


assert.match(executionService, /durableTerminalObservation/);
assert.match(executionService, /AGENT_PROVIDER_TERMINAL_OBSERVATION_V1/);
assert.match(executionService, /t\.provider_turn_id, t\.provider_session_reference/);

const { resolvePersistedRecoveryRuntime } = require(path.join(ROOT, 'packages/agents/src/runtimeConfiguration.js'));
assert.deepEqual(
  resolvePersistedRecoveryRuntime({
    executionContext: {
      runtime: {
        runtimeKind: 'OPENAI_CODEX_APP_SERVER',
        runtimeMode: 'PROVIDER_BACKED',
        providerBacked: true,
        recoverySupported: true,
        adapterVersion: 'codex-app-server.v1',
      },
    },
    expectedRuntimeKind: 'OPENAI_CODEX_APP_SERVER',
  }),
  {
    status: 'READY',
    runtime: {
      runtimeKind: 'OPENAI_CODEX_APP_SERVER',
      runtimeMode: 'PROVIDER_BACKED',
      providerBacked: true,
      recoverySupported: true,
      adapterVersion: 'codex-app-server.v1',
    },
  },
);
assert.equal(resolvePersistedRecoveryRuntime({ executionContext: {}, expectedRuntimeKind: 'OPENAI_CODEX_APP_SERVER' }).status, 'UNSUPPORTED');
assert.equal(resolvePersistedRecoveryRuntime({
  executionContext: { runtime: { runtimeKind: 'OPENAI_CODEX_APP_SERVER', runtimeMode: 'PROVIDER_BACKED', providerBacked: true, recoverySupported: true } },
  expectedRuntimeKind: 'FUTURE_PROVIDER',
}).status, 'IDENTITY_MISMATCH');
assert.equal(resolvePersistedRecoveryRuntime({
  executionContext: { runtime: { runtimeKind: 'FUTURE_PROVIDER', runtimeMode: 'PROVIDER_BACKED', providerBacked: false, recoverySupported: true } },
  expectedRuntimeKind: 'FUTURE_PROVIDER',
}).status, 'INVALID');

const contextSchema = JSON.parse(read('packages/agents/contracts/execution_context.v1.schema.json'));
assert.deepEqual(contextSchema.properties.runtime.properties.runtimeMode.enum, ['FIXTURE', 'PROVIDER_BACKED']);
assert.equal(contextSchema.properties.runtime.properties.providerBacked.type, 'boolean');
assert.equal(contextSchema.properties.runtime.properties.recoverySupported.type, 'boolean');

const assistantService = read('apps/api/src/services/assistantIntegrationService.js');
assert.match(assistantService, /getCapabilitiesWithRuntimeReadiness/);
assert.match(assistantService, /legacyAssistantExecutionAuthorized: false/);
assert.match(assistantService, /authority: 'AGENT_RUN_SERVICE_ONLY'/);
assert.match(assistantService, /managedCodexBootstrapService\.getBootstrapReadiness/);

const appServerClient = read('apps/codex-agent-runtime-worker/src/appServerClient.js');
assert.match(appServerClient, /sendAcceptance: 'ACKNOWLEDGED'/);
assert.match(appServerClient, /providerTerminalStatus: providerStatus/);
assert.match(appServerClient, /'model\/list'/);
assert.match(appServerClient, /'mcpServerStatus\/list'/);
assert.match(appServerClient, /safeAdditionalDetails/);
assert.match(appServerClient, /provider-model-rerouted/);
assert.match(appServerClient, /provider-model-verification/);

const codexRuntimeWorker = read('apps/codex-agent-runtime-worker/src/index.js');
assert.match(codexRuntimeWorker, /result\.providerTerminalStatus === 'COMPLETED'/);

const runActivities = read('packages/temporal/src/activities/agentRunActivities.js');
assert.match(runActivities, /providerTerminalFailed/);
assert.match(runActivities, /PROVIDER_TERMINAL_FAILED/);
assert.match(runActivities, /recordProviderObservationActivity/);
assert.match(runActivities, /PROVIDER_TERMINAL_OBSERVED/);
assert.match(runActivities, /providerErrorAdditionalDetails/);
assert.match(runActivities, /durableTerminalObservation/);
assert.match(runActivities, /grant_kind IN \('ROOT_RUN', 'MANAGED_CAPABILITY'\)/);
assert.match(workflow, /validDurableTerminalObservation/);
assert.match(workflow, /recordProviderObservationActivity/);

const bootstrapService = read('apps/api/src/services/managedCodexBootstrapService.js');
assert.match(bootstrapService, /persistObservation = true/);
assert.match(bootstrapService, /getManagedCodex[\s\S]*persistObservation: false/);
assert.match(bootstrapService, /getBootstrapReadiness[\s\S]*persistObservation: false/);
assert.match(bootstrapService, /getCompatibilityDiagnostics/);



const assistantRoutes = read('apps/api/src/routes/assistantIntegration.routes.js');
assert.match(assistantRoutes, /managed-codex\/diagnostics/);
assert.match(assistantService, /getManagedCodexDiagnostics/);
const controlBridge = read('apps/codex-control-bridge/src/index.js');
assert.match(controlBridge, /v1\/diagnostics\/compatibility/);
assert.match(codexRuntimeWorker, /diagnostics\/compatibility/);
assert.match(appServerClient, /APP_SERVER_CATALOG_NOT_ENTITLEMENT_PROOF/);

const recoveryHardeningMigration = read('packages/db_build/src/migrations/00165__agent_turn_failed_status_and_recovery_segment_hardening.sql');
assert.match(recoveryHardeningMigration, /DROP CONSTRAINT IF EXISTS agent_turns_status_check/);
assert.match(recoveryHardeningMigration, /ADD CONSTRAINT agent_turns_status_check/);
assert.match(recoveryHardeningMigration, /'ACKNOWLEDGED'[\s\S]*'FAILED'[\s\S]*'RECOVERY_REQUIRED'/);
assert.match(runActivities, /providerTerminalFailed \? 'FAILED'/);
assert.match(executionService, /segment_kind AS \"segmentKind\"/);
assert.match(executionService, /const recoverySegments = segments\.rows\.filter/);
assert.match(executionService, /const activeSegments = segments\.rows\.filter/);
assert.doesNotMatch(executionService, /WHERE agent_run_id = \$1 AND segment_kind = 'RECOVERY'/);

const migrationFiles = fs.readdirSync(path.join(ROOT, 'packages/db_build/src/migrations'));
assert.equal(migrationFiles.includes('00163__agent_real_codex_read_only_run.sql'), true);
assert.equal(migrationFiles.includes('00165__agent_turn_failed_status_and_recovery_segment_hardening.sql'), true);
assert.equal(read('packages/db_build/src/migrations/00163__agent_real_codex_read_only_run.sql').includes('CREATE'), true);



const catalogAlignmentSeed = read('packages/db_build/src/seeds/00166__phase19_3a1_codex_model_catalog_alignment.sql');
assert.match(catalogAlignmentSeed, /revision\s*=\s*1[\s\S]*gpt-6-sol[\s\S]*reasoningEffort'[\s\S]*low/);
assert.match(catalogAlignmentSeed, /revision[\s\S]*2[\s\S]*gpt-5\.6-sol[\s\S]*reasoningEffort'[\s\S]*low/);
assert.match(catalogAlignmentSeed, /phase19\.3a1\.codex-readonly\.catalog-v2/);
assert.match(catalogAlignmentSeed, /phase19\.3a1\.acceptance\.catalog-v2/);
assert.match(catalogAlignmentSeed, /THEN 'ACTIVE'[\s\S]*ELSE 'INACTIVE'/);
assert.match(catalogAlignmentSeed, /revision = 1[\s\S]*allow_state = 'ACTIVE'/);
assert.doesNotMatch(catalogAlignmentSeed, /UPDATE\s+core\.agent_definition_versions/i);
const seedFiles = fs.readdirSync(path.join(ROOT, 'packages/db_build/src/seeds'));
assert.equal(seedFiles.includes('00164__phase19_3a1_codex_read_only_pilot.sql'), true);
assert.equal(seedFiles.includes('00166__phase19_3a1_codex_model_catalog_alignment.sql'), true);

console.log('[phase19.3a1-corrective:self-test] PASS');

const kernel = read('packages/agents/src/agentRunKernel.js');
assert.match(kernel, /Managed Codex Agent Run requires recovery or failed before a successful result/);
assert.match(runActivities, /defaultRuntimeSourceKind/);
assert.match(runActivities, /OPENAI_CODEX_APP_SERVER/);
