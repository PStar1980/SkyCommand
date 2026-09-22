const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), quiet: true });

const { pool, query } = require(path.join(repositoryRoot, 'packages/db/src/connection.js'));
const agentExecutionService = require(path.join(repositoryRoot, 'apps/api/src/services/agentExecutionService.js'));
const agentInteractionService = require(path.join(repositoryRoot, 'apps/api/src/services/agentInteractionService.js'));

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED']);
const CONTAINMENT_KEYS = [
  'liveCheckoutMount',
  'dockerSocket',
  'githubCredentials',
  'hostAgentCredentials',
  'supervisorCredentials',
  'providerCredentials',
  'arbitraryHostFilesystem',
  'directGit',
  'browserState',
  'apiControlPlaneSecrets',
];

const internalRequest = Object.freeze({
  id: 'phase19-2c-live-acceptance',
  session: { authMode: 'INTERNAL_SERVICE_TOKEN', appCode: 'SKYSERVER_ADMIN' },
  user: null,
  permissions: [
    { permissionCode: 'AGENT_RUN' },
    { permissionCode: 'AGENT_ROOT_STOP' },
  ],
  headers: {},
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, read, predicate, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(1000);
  }
  const error = new Error(`Timed out waiting for ${label}.`);
  error.last = last;
  throw error;
}

async function loadFixture() {
  const result = await query(
    `SELECT p.project_id AS "projectId",
            p.project_code AS "projectCode",
            pw.project_workspace_id AS "projectWorkspaceId",
            d.definition_id AS "definitionId",
            d.agent_code AS "agentCode",
            v.definition_version_id AS "definitionVersionId",
            r.runtime_code AS "runtimeCode"
       FROM core.projects p
       JOIN core.project_workspaces pw
         ON pw.project_id = p.project_id AND pw.active = TRUE
       JOIN core.project_agent_allow_rules par
         ON par.project_id = p.project_id AND par.allow_state = 'ACTIVE'
       JOIN core.agent_definitions d
         ON d.definition_id = par.definition_id AND d.active = TRUE
       JOIN core.agent_definition_versions v
         ON v.definition_id = d.definition_id
        AND (par.definition_version_id IS NULL OR par.definition_version_id = v.definition_version_id)
       JOIN core.agent_runtime_installations i ON i.installation_id = v.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
      WHERE p.project_code = 'PHASE19_2B_BROWSER_CAPABILITY_ACCEPTANCE'
        AND r.runtime_code = 'FAKE_PERSISTENT'
      ORDER BY v.revision DESC
      LIMIT 1`,
  );
  assert.equal(result.rowCount, 1, 'The source-controlled persistent fake-runtime acceptance fixture must be registered.');
  const fixture = result.rows[0];
  const actorResult = await query(
    `SELECT up.user_id AS "testUserId"
       FROM auth.vw_user_permissions up
      WHERE up.app_code = 'SKYSERVER_ADMIN'
        AND up.permission_code = 'BROWSER_AUTOMATION_RUN'
        AND (
          EXISTS (
            SELECT 1
              FROM auth.user_roles ur
              JOIN auth.roles role ON role.role_id = ur.role_id AND role.active = TRUE
              JOIN core.applications app ON app.app_id = role.app_id AND app.active = TRUE
             WHERE ur.user_id = up.user_id
               AND ur.active = TRUE
               AND app.app_code = 'SKYSERVER_ADMIN'
               AND role.role_code IN ('SUPER_ADMIN', 'ADMIN_ALL')
          )
          OR EXISTS (
            SELECT 1
              FROM core.project_members pm
              JOIN core.project_member_rights pmr
                ON pmr.project_member_id = pm.project_member_id
               AND pmr.right_code = 'PROJECT_READ'
               AND pmr.active = TRUE
             WHERE pm.project_id = $1
               AND pm.user_id = up.user_id
               AND pm.membership_state = 'ACTIVE'
          )
        )
      ORDER BY up.user_id
      LIMIT 1`,
    [fixture.projectId],
  );
  assert.equal(actorResult.rowCount, 1, 'The live acceptance fixture requires an eligible project reader with Browser permission.');
  fixture.testUserId = actorResult.rows[0].testUserId;
  return fixture;
}

function requestBody(fixture, caseId, suffix) {
  return {
    projectId: fixture.projectId,
    definitionId: fixture.definitionId,
    definitionVersionId: fixture.definitionVersionId,
    projectWorkspaceId: fixture.projectWorkspaceId,
    instruction: `Phase 19.2C live acceptance ${caseId}`,
    deadlineMs: 120000,
    fakeRuntimeCaseId: caseId,
    idempotencyKey: `phase19-2c-live-${suffix}-${Date.now()}`,
  };
}

async function admit(fixture, caseId, suffix) {
  const result = await agentExecutionService.admitAgentRun(
    { ...internalRequest, user: { userId: fixture.testUserId }, id: `phase19-2c-admit-${suffix}`, headers: { 'x-request-id': `phase19-2c-admit-${suffix}` } },
    requestBody(fixture, caseId, suffix),
  );
  assert.equal(result.accepted, true);
  assert.ok(result.runId, `Admission for ${caseId} must return a durable Agent Run ID.`);
  return result.runId;
}

async function readRun(runId) {
  const result = await query(
    `SELECT ar.agent_run_id AS "runId",
       ar.execution_scope_id AS "rootExecutionId",
            ar.status,
            ar.fake_runtime_case_id AS "caseId",
            ar.execution_context AS "executionContext",
            rc.runtime_kind AS "runtimeKind",
            rc.worker_identity AS "workerIdentity",
            rc.worker_generation AS "workerGeneration",
            rc.task_queue AS "taskQueue",
            rc.readiness_status AS "readinessStatus",
            rc.observed_at AS "observedAt",
            rc.heartbeat_at AS "heartbeatAt",
            rc.containment_profile AS "containmentProfile",
            rc.quarantine_state AS "quarantineState",
            po.provider_operation_id AS "operationId",
            po.state AS "operationState",
            po.outcome_certainty AS "outcomeCertainty",
            po.outcome AS "operationOutcome",
            res.result_status AS "resultStatus",
            res.result AS "result"
       FROM worker.agent_runs ar
       LEFT JOIN worker.agent_runtime_cells rc ON rc.agent_run_id = ar.agent_run_id
       LEFT JOIN worker.agent_provider_operations po ON po.agent_run_id = ar.agent_run_id
       LEFT JOIN worker.agent_results res ON res.agent_run_id = ar.agent_run_id
      WHERE ar.agent_run_id = $1
      ORDER BY po.created_at DESC
      LIMIT 1`,
    [runId],
  );
  assert.equal(result.rowCount, 1, `Agent Run ${runId} must remain readable.`);
  return result.rows[0];
}

async function readInteractions(runId) {
  const result = await query(
    `SELECT r.agent_interaction_request_id AS "interactionId",
            r.interaction_type AS "interactionType",
            r.status,
            r.status_reason AS "statusReason",
            r.expires_at AS "expiresAt",
            d.agent_interaction_decision_id AS "decisionId",
            d.delivery_state AS "deliveryState",
            d.application_status AS "applicationStatus",
            d.application_reason AS "applicationReason",
            d.application_result AS "applicationResult"
       FROM worker.agent_interaction_requests r
       LEFT JOIN worker.agent_interaction_decisions d
         ON d.agent_interaction_decision_id = r.decision_id
      WHERE r.agent_run_id = $1
      ORDER BY r.created_at`,
    [runId],
  );
  return result.rows;
}

async function readEvents(runId) {
  const result = await query(
    `SELECT event_type AS "eventType", source_kind AS "sourceKind", source_instance AS "sourceInstance", payload
       FROM worker.agent_events
      WHERE agent_run_id = $1
      ORDER BY event_sequence`,
    [runId],
  );
  return result.rows;
}

async function readCapabilityEffects(runId) {
  const result = await query(
    `SELECT agent_capability_effect_id AS "effectId", dispatch_state AS "dispatchState", outcome_certainty AS "outcomeCertainty", denial_reason AS "denialReason", browser_automation_run_id AS "browserAutomationRunId"
       FROM worker.agent_capability_effects
      WHERE agent_run_id = $1
      ORDER BY created_at`,
    [runId],
  );
  return result.rows;
}

async function waitForRun(runId) {
  await waitFor(`Agent Run ${runId} to reach a terminal state`, () => readRun(runId), (row) => TERMINAL_RUN_STATUSES.has(row.status));
  const run = await readRun(runId);
  const interactions = await readInteractions(runId);
  const events = await readEvents(runId);
  const capabilityEffects = await readCapabilityEffects(runId);
  return { run, interactions, events, capabilityEffects };
}

function assertRuntimeEvidence(evidence, readiness, { resultStatus = 'COMPLETED' } = {}) {
  const { run } = evidence;
  assert.equal(run.taskQueue, readiness.taskQueue);
  assert.equal(run.taskQueue, 'skycommand-agent-runtime-local');
  assert.equal(run.runtimeKind, 'FAKE_PERSISTENT');
  assert.ok(run.workerIdentity);
  assert.ok(run.workerGeneration);
  assert.equal(run.workerIdentity, readiness.workerIdentity);
  assert.equal(run.readinessStatus, 'CURRENT');
  assert.ok(run.observedAt && run.heartbeatAt, 'Runtime cell must carry observed and heartbeat timestamps.');
  assert.ok(new Date(run.heartbeatAt).getTime() >= Date.now() - 10 * 60 * 1000, 'Runtime heartbeat must be fresh.');
  assert.equal(run.quarantineState, 'HEALTHY');
  for (const key of CONTAINMENT_KEYS) assert.equal(run.containmentProfile?.[key], false, `Containment control ${key} must be false/absent.`);
  assert.equal(run.executionContext?.runtime?.workerTaskQueue, run.taskQueue);
  // Admission records the Temporal poller identity; the runtime cell records the
  // generation returned by the dedicated worker that actually executed the run.
  assert.equal(run.executionContext?.runtime?.workerGeneration, run.workerIdentity);
  assert.equal(run.resultStatus, resultStatus);
  assert.equal(run.result?.extensions?.fakeRuntime, true);
  assert.equal(run.result?.runtimeKind, 'FAKE_PERSISTENT');
  assert.ok(run.operationId && run.operationState);
}

function assertRuntimeEventEvidence(evidence) {
  assert.ok(evidence.events.some((event) => event.eventType === 'RUNTIME_STARTED'));
  assert.ok(evidence.events.some((event) => event.eventType === 'RUN_TERMINAL_RESULT_PUBLISHED'));
  for (const event of evidence.events.filter((item) => item.sourceKind === 'FAKE_RUNTIME_WORKER')) {
    assert.equal(event.sourceInstance, evidence.run.workerIdentity);
    assert.doesNotMatch(JSON.stringify(event), /git|playwright|browser_context|docker.sock/i);
  }
}

async function runPersistentCase(fixture, readiness) {
  const runId = await admit(fixture, 'persistent-delayed-usage', 'persistent');
  const evidence = await waitForRun(runId);
  assert.equal(evidence.run.status, 'COMPLETED');
  assert.equal(evidence.run.operationState, 'COMPLETED');
  assert.equal(evidence.run.outcomeCertainty, 'ACKNOWLEDGED');
  assertRuntimeEvidence(evidence, readiness);
  assertRuntimeEventEvidence(evidence);
  assert.equal(evidence.interactions.length, 0);
  return { caseId: evidence.run.caseId, runId, workerGeneration: evidence.run.workerGeneration, workerIdentity: evidence.run.workerIdentity, taskQueue: evidence.run.taskQueue, status: evidence.run.status, operationState: evidence.run.operationState, outcomeCertainty: evidence.run.outcomeCertainty, containment: evidence.run.containmentProfile };
}

async function runUnknownSendCase(fixture, readiness) {
  const runId = await admit(fixture, 'browser-capability-unknown-send', 'unknown-send');
  const evidence = await waitForRun(runId);
  assert.equal(evidence.run.status, 'RECOVERY_REQUIRED');
  assert.equal(evidence.run.operationState, 'RECOVERY_REQUIRED');
  assert.equal(evidence.run.outcomeCertainty, 'UNKNOWN');
  assertRuntimeEvidence(evidence, readiness, { resultStatus: 'RECOVERY_REQUIRED' });
  assertRuntimeEventEvidence(evidence);
  assert.ok(evidence.events.some((event) => event.eventType === 'PROVIDER_OPERATION_RECONCILED'));
  assert.equal(evidence.capabilityEffects.length, 1);
  assert.equal(evidence.capabilityEffects[0].dispatchState, 'COMPLETED');
  return { caseId: evidence.run.caseId, runId, workerGeneration: evidence.run.workerGeneration, workerIdentity: evidence.run.workerIdentity, taskQueue: evidence.run.taskQueue, status: evidence.run.status, operationState: evidence.run.operationState, outcomeCertainty: evidence.run.outcomeCertainty, reconciliationEvent: 'PROVIDER_OPERATION_RECONCILED', capabilityDispatch: evidence.capabilityEffects[0].dispatchState, containment: evidence.run.containmentProfile };
}

async function runApprovalCase(fixture, readiness) {
  const runId = await admit(fixture, 'approval-required-success', 'approval');
  const pending = await waitFor(`approval interaction for ${runId}`, () => readInteractions(runId), (rows) => rows.length === 1 && ['PENDING', 'SAVED', 'DELIVERED'].includes(rows[0].status));
  const decision = await agentInteractionService.submitAgentInteractionDecision(internalRequest, pending[0].interactionId, { decision: 'APPROVE' });
  assert.equal(decision.saved, true);
  const evidence = await waitForRun(runId);
  assert.equal(evidence.run.status, 'COMPLETED');
  assertRuntimeEvidence(evidence, readiness);
  assert.equal(evidence.interactions.length, 1);
  assert.equal(evidence.interactions[0].status, 'APPLIED');
  assert.equal(evidence.interactions[0].deliveryState, 'ACKNOWLEDGED');
  assert.equal(evidence.interactions[0].applicationStatus, 'APPLIED');
  assert.equal(evidence.capabilityEffects.length, 1);
  assert.equal(evidence.capabilityEffects[0].dispatchState, 'COMPLETED');
  assert.ok(evidence.capabilityEffects[0].browserAutomationRunId);
  return { caseId: evidence.run.caseId, runId, interactionId: evidence.interactions[0].interactionId, interactionStatus: evidence.interactions[0].status, deliveryState: evidence.interactions[0].deliveryState, applicationStatus: evidence.interactions[0].applicationStatus, nativeBrowserEffect: evidence.capabilityEffects[0].dispatchState, browserAutomationRunId: evidence.capabilityEffects[0].browserAutomationRunId, workerGeneration: evidence.run.workerGeneration };
}

async function runUserInputCase(fixture, readiness) {
  const runId = await admit(fixture, 'user-input-success', 'user-input');
  const pending = await waitFor(`user-input interaction for ${runId}`, () => readInteractions(runId), (rows) => rows.length === 1 && ['PENDING', 'SAVED', 'DELIVERED'].includes(rows[0].status));
  const decision = await agentInteractionService.submitAgentInteractionDecision(internalRequest, pending[0].interactionId, { decision: 'SUBMIT', input: { answer: 'phase-19-2c-approved-answer' } });
  assert.equal(decision.saved, true);
  const evidence = await waitForRun(runId);
  assert.equal(evidence.run.status, 'COMPLETED');
  assertRuntimeEvidence(evidence, readiness);
  assert.equal(evidence.interactions[0].status, 'APPLIED');
  assert.equal(evidence.interactions[0].applicationStatus, 'APPLIED');
  assert.equal(evidence.run.result?.taskOutput?.userInputAccepted, true);
  assert.ok(evidence.run.result?.taskOutput?.userInputDigest);
  return { caseId: evidence.run.caseId, runId, interactionId: evidence.interactions[0].interactionId, interactionStatus: evidence.interactions[0].status, applicationStatus: evidence.interactions[0].applicationStatus, userInputAccepted: evidence.run.result.taskOutput.userInputAccepted, workerGeneration: evidence.run.workerGeneration };
}

async function runExpiryCase(fixture) {
  const runId = await admit(fixture, 'approval-expiry', 'expiry');
  const evidence = await waitForRun(runId);
  assert.equal(evidence.run.status, 'FAILED');
  assert.equal(evidence.interactions.length, 1);
  assert.equal(evidence.interactions[0].status, 'EXPIRED');
  assert.equal(evidence.interactions[0].applicationStatus, null);
  assert.equal(evidence.capabilityEffects.length, 1);
  assert.equal(evidence.capabilityEffects[0].dispatchState, 'DENIED');
  assert.equal(evidence.capabilityEffects[0].browserAutomationRunId, null);
  return { caseId: evidence.run.caseId, runId, interactionStatus: evidence.interactions[0].status, capabilityDispatch: evidence.capabilityEffects[0].dispatchState, nativeBrowserRuns: 0 };
}

async function runRootStopCase(fixture) {
  const runId = await admit(fixture, 'user-input-restart', 'root-stop');
  const pending = await waitFor(`root-stop interaction for ${runId}`, () => readInteractions(runId), (rows) => rows.length === 1 && ['PENDING', 'SAVED', 'DELIVERED'].includes(rows[0].status));
  assert.ok(pending[0].interactionId);
  const initialRun = await readRun(runId);
  const stop = await agentExecutionService.stopExecutionScope(internalRequest, initialRun.rootExecutionId);
  assert.equal(stop.status, 'STOP_REQUESTED');
  const evidence = await waitForRun(runId);
  assert.equal(evidence.run.status, 'CANCELED');
  assert.equal(evidence.interactions[0].status, 'CANCELED');
  assert.equal(evidence.run.result?.extensions?.stopState, 'CONFIRMED');
  assert.equal(evidence.capabilityEffects.length, 0);
  return { caseId: evidence.run.caseId, runId, rootExecutionId: initialRun.rootExecutionId, rootStopStatus: stop.status, runStatus: evidence.run.status, interactionStatus: evidence.interactions[0].status, stopState: evidence.run.result.extensions.stopState };
}

async function run() {
  const readiness = await agentExecutionService.getRuntimeWorkerReadiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.taskQueue, 'skycommand-agent-runtime-local');
  assert.ok(readiness.workerIdentity, 'The dedicated Agent Runtime Worker poller identity is required.');
  const fixture = await loadFixture();
  const evidence = {
    readiness: {
      ready: readiness.ready,
      taskQueue: readiness.taskQueue,
      namespace: readiness.namespace,
      workerIdentity: readiness.workerIdentity,
      pollerCount: readiness.pollerCount,
      observedAt: readiness.observedAt,
    },
    persistent: await runPersistentCase(fixture, readiness),
    unknownSend: await runUnknownSendCase(fixture, readiness),
    approval: await runApprovalCase(fixture, readiness),
    userInput: await runUserInputCase(fixture, readiness),
    expiry: await runExpiryCase(fixture),
    rootStop: await runRootStopCase(fixture),
  };
  assert.equal(evidence.persistent.workerGeneration, evidence.unknownSend.workerGeneration);
  assert.equal(evidence.persistent.workerGeneration, evidence.approval.workerGeneration);
  assert.equal(evidence.persistent.workerGeneration, evidence.userInput.workerGeneration);
  console.log(JSON.stringify({ phase: '19.2C', liveContainerizedAgentRuntimeWorkerAcceptance: evidence }, null, 2));
  console.log('✅ Phase 19.2C live interaction/recovery acceptance passed through the dedicated Agent Runtime Worker.');
}

run()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
