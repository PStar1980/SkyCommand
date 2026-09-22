const { sha256Digest } = require('../../../agents/src/canonical');
const {
  assertTransition,
  buildTerminalSummary,
  isTerminalStatus,
  resultDigest,
} = require('../../../agents/src/agentRunKernel');
const { query, pool } = require('../../../db/src/connection');
const agentCapabilityAuthorizationService = require('../../../../apps/api/src/services/agentCapabilityAuthorizationService');

function safeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function serialize(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function appendEvent(client, {
  runId,
  sessionId,
  executionScopeId,
  turnId = null,
  eventType,
  eventScope = 'RUN',
  sourceKind = 'SKYCOMMAND_AGENT_RUN_WORKFLOW',
  sourceInstance = 'control-plane',
  sourceCursor = null,
  availability = 'REPORTED',
  freshness = 'CURRENT',
  observedAt = new Date().toISOString(),
  payload = {},
}) {
  const next = await client.query(
    'SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence FROM worker.agent_events WHERE agent_run_id = $1',
    [runId],
  );
  const eventSequence = Number(next.rows[0].next_sequence);
  const result = await client.query(
    `INSERT INTO worker.agent_events (
       agent_run_id, session_id, execution_scope_id, agent_turn_id,
       event_sequence, event_type, event_scope, source_kind, source_instance,
       source_cursor, availability, freshness, observed_at, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
     ON CONFLICT (agent_run_id, source_kind, source_instance, source_cursor) DO NOTHING
     RETURNING agent_event_id, event_sequence`,
    [
      runId,
      sessionId,
      executionScopeId,
      turnId,
      eventSequence,
      eventType,
      eventScope,
      sourceKind,
      sourceInstance,
      sourceCursor,
      availability,
      freshness,
      observedAt,
      JSON.stringify(payload || {}),
    ],
  );
  return result.rows[0] || null;
}

async function loadRun(client, runId, forUpdate = false) {
  const result = await client.query(
    `SELECT ar.*, s.session_model, s.status AS session_status,
            es.status AS scope_status, es.revocation_epoch AS scope_revocation_epoch,
            d.agent_code, v.revision AS agent_revision,
            r.runtime_code, i.adapter_version, i.runtime_profile,
            pw.environment_code, pw.workspace_mode
       FROM worker.agent_runs ar
       JOIN worker.agent_sessions s ON s.session_id = ar.session_id
       JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id
       JOIN core.agent_definitions d ON d.definition_id = ar.definition_id
       JOIN core.agent_definition_versions v ON v.definition_version_id = ar.definition_version_id
       JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
       JOIN core.project_workspaces pw ON pw.project_workspace_id = ar.project_workspace_id
      WHERE ar.agent_run_id = $1
      ${forUpdate ? 'FOR UPDATE OF ar, s, es' : ''}`,
    [runId],
  );
  return result.rows[0] || null;
}

async function markAgentRunStateActivity({ runId, status, reason = null } = {}) {
  return withTransaction(async (client) => {
    const run = await loadRun(client, runId, true);
    if (!run) throw new Error('Agent Run not found while updating workflow state.');
    if (isTerminalStatus(run.status)) return { runId, status: run.status, skipped: true };
    if (['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(run.status)) return { runId, status: run.status, skipped: true };
    if (run.status !== status) assertTransition(run.status, status);

    if (run.status !== status) {
      await client.query(
        `UPDATE worker.agent_runs SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE agent_run_id = $1`,
        [runId, status],
      );
      await appendEvent(client, {
        runId,
        sessionId: run.session_id,
        executionScopeId: run.execution_scope_id,
        eventType: 'RUN_STATE_CHANGED',
        sourceCursor: `state:${run.status}:${status}`,
        payload: { from: run.status, to: status, reason },
      });
    }
    return { runId, status };
  });
}

async function prepareProviderOperationActivity({ runId, instruction, deadlineAt = null } = {}) {
  return withTransaction(async (client) => {
    const run = await loadRun(client, runId, true);
    if (!run) throw new Error('Agent Run not found while preparing provider operation.');
    if (['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(run.status) || run.scope_status !== 'ACTIVE') {
      return { canceled: true, runId, fenceEpoch: Math.max(run.revocation_epoch, run.scope_revocation_epoch) };
    }

    const turnInputDigest = sha256Digest({ instruction: String(instruction || '') });
    const turnResult = await client.query(
      `INSERT INTO worker.agent_turns (agent_run_id, session_id, turn_number, input_digest, status)
       VALUES ($1, $2, 1, $3, 'PREPARED')
       ON CONFLICT (agent_run_id, turn_number) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [runId, run.session_id, turnInputDigest],
    );
    const turn = turnResult.rows[0];
    const operationKey = `${runId}:SUBMIT_TURN:1`;
    const operationResult = await client.query(
      `INSERT INTO worker.agent_provider_operations (
         operation_key, agent_run_id, agent_turn_id, session_id, operation_type,
         provider_operation_reference, input_digest, fence_epoch, deadline_at,
         state, outcome_certainty
       ) VALUES ($1, $2, $3, $4, 'SUBMIT_TURN', $5, $6, $7, $8, 'JOURNALED', 'UNKNOWN')
       ON CONFLICT (operation_key) DO NOTHING
       RETURNING *`,
      [operationKey, runId, turn.agent_turn_id, run.session_id, `fake-operation:${operationKey}`, turnInputDigest, Math.max(run.revocation_epoch, run.scope_revocation_epoch), deadlineAt],
    );
    const operation = operationResult.rows[0] || (await client.query('SELECT * FROM worker.agent_provider_operations WHERE operation_key = $1', [operationKey])).rows[0];
    await client.query(
      `UPDATE worker.agent_runs SET status = CASE WHEN status IN ('ADMITTED', 'QUEUED', 'STARTING') THEN 'RUNNING' ELSE status END WHERE agent_run_id = $1`,
      [runId],
    );
    await client.query(`UPDATE worker.agent_turns SET status = 'SUBMITTED' WHERE agent_turn_id = $1`, [turn.agent_turn_id]);
    await appendEvent(client, {
      runId,
      sessionId: run.session_id,
      executionScopeId: run.execution_scope_id,
      turnId: turn.agent_turn_id,
      eventType: 'PROVIDER_OPERATION_JOURNALED',
      sourceCursor: `operation:${operation.provider_operation_id}:journaled`,
      payload: {
        operationId: operation.provider_operation_id,
        operationType: operation.operation_type,
        inputDigest: operation.input_digest,
        fenceEpoch: operation.fence_epoch,
        resubmissionAllowed: false,
      },
    });
    return {
      canceled: false,
      operationId: operation.provider_operation_id,
      operationKey,
      turnId: turn.agent_turn_id,
      sessionId: run.session_id,
      runId,
      fenceEpoch: operation.fence_epoch,
      inputDigest: operation.input_digest,
      runtimeKind: run.runtime_code,
      runtimeProfile: run.runtime_profile,
      fakeRuntimeCaseId: run.fake_runtime_case_id,
      instruction: String(instruction || ''),
    };
  });
}

async function prepareManagedCapabilityEffectActivity({ runId, operationId, turnId, caseId } = {}) {
  return agentCapabilityAuthorizationService.prepareManagedCapabilityEffect({ runId, operationId, turnId, caseId });
}

async function revokeManagedCapabilityBeforeDispatchActivity({ runId, effectId } = {}) {
  return agentCapabilityAuthorizationService.revokeBeforeDispatch({ runId, effectId });
}

async function dispatchManagedCapabilityActivity({ effectId, credential, runtimeWorker, simulateUnknownDispatch = false } = {}) {
  return agentCapabilityAuthorizationService.dispatchManagedCapability({ effectId, credential, runtimeWorker, simulateUnknownDispatch });
}

function normalizeRuntimeEvents(runtimeResult = {}) {
  return Array.isArray(runtimeResult.events) ? runtimeResult.events : [];
}

async function finalizeAgentRunActivity({ runId, operation = null, runtimeResult = null, reconciliation = null, temporalRunId = null, capabilityEffects = [] } = {}) {
  return withTransaction(async (client) => {
    const run = await loadRun(client, runId, true);
    if (!run) throw new Error('Agent Run not found while finalizing.');

    const stopRequested = ['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(run.status) || run.scope_status !== 'ACTIVE';
    const recoveryRequired = reconciliation?.disposition === 'RECOVERY_REQUIRED'
      || runtimeResult?.sendAcceptance === 'UNKNOWN' && !reconciliation;
    const rejected = runtimeResult?.sendAcceptance === 'REJECTED_BEFORE_ACCEPTANCE';
    const status = stopRequested ? 'CANCELED' : recoveryRequired ? 'RECOVERY_REQUIRED' : rejected ? 'FAILED' : 'COMPLETED';
    const outcome = stopRequested ? 'CANCELED' : recoveryRequired ? 'RECOVERY_REQUIRED' : rejected ? 'SAFE_TO_REJECT' : 'SUCCESS';
    const stopState = stopRequested
      ? (runtimeResult?.physicalStop?.state === 'CONFIRMED' ? 'CONFIRMED' : 'UNCONFIRMED')
      : 'NONE';
    const worker = safeObject(runtimeResult?.worker);
    const runtimeEvents = normalizeRuntimeEvents(runtimeResult);

    if (operation?.operationId) {
      const operationState = stopRequested
        ? 'CANCELED'
        : recoveryRequired
          ? 'RECOVERY_REQUIRED'
          : rejected
            ? 'REJECTED'
            : 'COMPLETED';
      const certainty = stopRequested
        ? 'NOT_CONFIRMED'
        : recoveryRequired
          ? 'UNKNOWN'
          : rejected
            ? 'REJECTED'
            : 'ACKNOWLEDGED';
      await client.query(
        `UPDATE worker.agent_provider_operations
            SET state = $2, outcome_certainty = $3, outcome = $4::jsonb
          WHERE provider_operation_id = $1`,
        [operation.operationId, operationState, certainty, JSON.stringify({ runtimeResult: runtimeResult || null, reconciliation: reconciliation || null })],
      );
      await client.query(
        `UPDATE worker.agent_turns
            SET provider_turn_id = $2, provider_session_reference = $3,
                status = $4, output_digest = $5
          WHERE agent_turn_id = $1`,
        [operation.turnId, runtimeResult?.providerTurnId || null, runtimeResult?.providerSessionReference || null, stopRequested ? 'CANCELED' : recoveryRequired ? 'RECOVERY_REQUIRED' : rejected ? 'REJECTED' : 'COMPLETED', runtimeResult?.taskOutputCandidate ? sha256Digest(runtimeResult.taskOutputCandidate) : null],
      );
    }

    if (runtimeResult) {
      await client.query(
        `INSERT INTO worker.agent_runtime_cells (
           agent_run_id, runtime_kind, adapter_version, task_queue,
           worker_identity, worker_generation, worker_process_id, worker_hostname,
           readiness_status, observed_at, heartbeat_at, containment_profile
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CURRENT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $9::jsonb)
         ON CONFLICT (agent_run_id) DO UPDATE SET
           runtime_kind = EXCLUDED.runtime_kind,
           adapter_version = EXCLUDED.adapter_version,
           task_queue = EXCLUDED.task_queue,
           worker_identity = EXCLUDED.worker_identity,
           worker_generation = EXCLUDED.worker_generation,
           worker_process_id = EXCLUDED.worker_process_id,
           worker_hostname = EXCLUDED.worker_hostname,
           readiness_status = EXCLUDED.readiness_status,
           observed_at = EXCLUDED.observed_at,
           heartbeat_at = EXCLUDED.heartbeat_at,
           containment_profile = EXCLUDED.containment_profile,
           updated_at = CURRENT_TIMESTAMP`,
        [runId, run.runtime_code, runtimeResult.adapterVersion || 'fake-runtime-adapter.v1', runtimeResult.worker?.taskQueue || 'skycommand-agent-runtime-local', worker.identity || null, worker.generation || null, worker.processId || null, worker.hostname || null, JSON.stringify(runtimeResult.containmentProfile || { liveCheckoutMount: false, arbitraryHostFilesystem: false, dockerSocket: false, githubCredentials: false, hostAgentCredentials: false, supervisorCredentials: false, providerCredentials: false })],
      );
    }

    for (const event of runtimeEvents) {
      await appendEvent(client, {
        runId,
        sessionId: run.session_id,
        executionScopeId: run.execution_scope_id,
        turnId: operation?.turnId || null,
        eventType: event.eventType || 'RUNTIME_EVENT',
        eventScope: event.scope || 'RUN',
        sourceKind: event.source?.kind || 'FAKE_RUNTIME_WORKER',
        sourceInstance: event.source?.instance || 'unknown-runtime-worker',
        sourceCursor: event.source?.cursor || `${event.eventId || 'event'}:${event.eventType || 'RUNTIME_EVENT'}`,
        availability: ['REPORTED', 'NOT_REPORTED', 'UNSUPPORTED', 'ERROR'].includes(event.availability) ? event.availability : 'ERROR',
        freshness: ['CURRENT', 'STALE', 'UNKNOWN'].includes(event.freshness) ? event.freshness : 'UNKNOWN',
        observedAt: event.observedAt || new Date().toISOString(),
        payload: { contract: event.contract, eventId: event.eventId, payload: safeObject(event.payload), measurements: event.measurements || null },
      });
    }
    if (reconciliation) {
      await appendEvent(client, {
        runId,
        sessionId: run.session_id,
        executionScopeId: run.execution_scope_id,
        turnId: operation?.turnId || null,
        eventType: 'PROVIDER_OPERATION_RECONCILED',
        sourceKind: 'SKYCOMMAND_AGENT_RUNTIME_ADAPTER',
        sourceInstance: reconciliation.workerIdentity || 'runtime-worker',
        sourceCursor: `${reconciliation.operationId}:reconciled`,
        availability: reconciliation.disposition === 'RECOVERY_REQUIRED' ? 'ERROR' : 'REPORTED',
        freshness: 'CURRENT',
        payload: serialize(reconciliation),
      });
    }

    const safeCapabilityEffects = (Array.isArray(capabilityEffects) ? capabilityEffects : []).map((effect) => ({
      effectId: effect?.effectId || null,
      effectKey: effect?.effectKey || null,
      capabilityKind: effect?.capabilityKind || null,
      capabilityCode: effect?.capabilityCode || null,
      capabilityVersion: effect?.capabilityVersion || null,
      authorityDecision: effect?.authorityDecision || null,
      authorityEpoch: effect?.authorityEpoch ?? null,
      policyRevision: effect?.policyRevision || null,
      executionSurfaceDecision: effect?.executionSurfaceDecision || {},
      managedCredential: effect?.managedCredential ? {
        grantId: effect.managedCredential.grantId || null,
        reference: effect.managedCredential.reference || null,
        credentialFingerprint: effect.managedCredential.credentialFingerprint || null,
        audience: effect.managedCredential.audience || null,
        issuedAt: effect.managedCredential.issuedAt || null,
        expiresAt: effect.managedCredential.expiresAt || null,
        state: effect.managedCredential.state === 'ACTIVE' ? 'EXPIRED' : effect.managedCredential.state || null,
        closedAt: effect.managedCredential.closedAt || null,
        revokedAt: effect.managedCredential.revokedAt || null,
        expiredAt: effect.managedCredential.expiredAt || null,
        statusReason: effect.managedCredential.statusReason || null,
        revocationEpoch: effect.managedCredential.revocationEpoch ?? null,
      } : null,
      nativeBrowserExecutionId: effect?.nativeBrowserExecutionId || null,
      nativeBrowserWorkflowId: effect?.nativeBrowserWorkflowId || null,
      browserAutomationRunId: effect?.browserAutomationRunId || null,
      runtimeWorker: effect?.runtimeWorker || null,
      dispatchState: effect?.dispatchState || null,
      outcomeCertainty: effect?.outcomeCertainty || null,
      denialReason: effect?.denialReason || null,
      reconciliation: effect?.reconciliation || {},
      result: effect?.result || null,
      browserResult: effect?.browserResult || null,
      replayed: Boolean(effect?.replayed),
      denied: Boolean(effect?.denied),
    }));
    for (const effect of safeCapabilityEffects) {
      await appendEvent(client, {
        runId,
        sessionId: run.session_id,
        executionScopeId: run.execution_scope_id,
        turnId: operation?.turnId || null,
        eventType: 'AGENT_CAPABILITY_EFFECT_RECORDED',
        sourceKind: 'SKYCOMMAND_AGENT_CAPABILITY_AUTHORIZATION',
        sourceInstance: effect.runtimeWorker?.identity || 'control-plane',
        sourceCursor: `capability:${effect.effectId}:final:${effect.dispatchState || 'UNKNOWN'}`,
        availability: effect.denied ? 'ERROR' : 'REPORTED',
        freshness: 'CURRENT',
        payload: effect,
      });
    }

    const summary = buildTerminalSummary({
      runId,
      sessionId: run.session_id,
      projectId: run.project_id,
      agentDefinitionId: run.definition_id,
      agentRevision: run.agent_revision,
      runtimeKind: run.runtime_code,
      rootExecutionId: run.execution_scope_id,
      rootAgentRunId: runId,
      initiatingUserId: run.initiating_user_id,
      initiatingActor: safeObject(run.initiating_actor_snapshot, { kind: run.initiating_actor_kind, id: run.initiating_actor_id, displayNameSnapshot: null }),
      triggerSource: run.trigger_source,
      status,
      outcome,
      taskOutput: status === 'COMPLETED' ? runtimeResult?.taskOutputCandidate || null : null,
      usage: runtimeResult?.usage || null,
      operationId: operation?.operationId || null,
      caseId: run.fake_runtime_case_id,
      stopState,
      errorCode: recoveryRequired ? 'PROVIDER_SEND_UNKNOWN' : rejected ? 'PROVIDER_REJECTED_BEFORE_ACCEPTANCE' : null,
      capabilityEffects: safeCapabilityEffects,
    });
    const digest = resultDigest(summary);
    const resultInsert = await client.query(
      `INSERT INTO worker.agent_results (agent_run_id, result_status, result_digest, result)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (agent_run_id) DO NOTHING
       RETURNING agent_result_id`,
      [runId, status, digest, JSON.stringify(summary)],
    );
    const resultId = resultInsert.rows[0]?.agent_result_id || (await client.query('SELECT agent_result_id FROM worker.agent_results WHERE agent_run_id = $1', [runId])).rows[0]?.agent_result_id;

    if (!isTerminalStatus(run.status)) {
      await client.query(
        `UPDATE worker.agent_runs
            SET status = $2, outcome = $3, stop_state = $4, terminal_at = CURRENT_TIMESTAMP
          WHERE agent_run_id = $1`,
        [runId, status, outcome, stopState],
      );
    }
    await client.query(
      `UPDATE worker.agent_resource_leases
          SET lease_state = CASE WHEN $2 = 'CANCELED' THEN 'REVOKED' ELSE 'RELEASED' END,
              released_at = CURRENT_TIMESTAMP
        WHERE agent_run_id = $1 AND lease_state = 'ACTIVE'`,
      [runId, status],
    );
    await client.query(
      `UPDATE worker.agent_sessions SET status = CASE WHEN $2 IN ('CANCELED', 'RECOVERY_REQUIRED') THEN 'RECOVERY_REQUIRED' ELSE 'CLOSED' END WHERE session_id = $1`,
      [run.session_id, status],
    );
    await client.query(
      `UPDATE auth.execution_grants
          SET grant_state = 'EXPIRED',
              revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
              grant_metadata = jsonb_set(
                COALESCE(grant_metadata, '{}'::jsonb),
                '{lifecycleReason}',
                to_jsonb('AGENT_RUN_TERMINAL'::text),
                TRUE
              )
        WHERE agent_run_id = $1
          AND grant_kind = 'MANAGED_CAPABILITY'
          AND grant_state = 'ACTIVE'`,
      [runId],
    );
    if (temporalRunId) {
      await client.query(
        `UPDATE worker.agent_temporal_segments SET status = $2, ended_at = CURRENT_TIMESTAMP WHERE agent_run_id = $1 AND temporal_run_id = $3`,
        [runId, status === 'COMPLETED' ? 'COMPLETED' : status === 'CANCELED' ? 'CANCELED' : 'FAILED', temporalRunId],
      );
    }
    await appendEvent(client, {
      runId,
      sessionId: run.session_id,
      executionScopeId: run.execution_scope_id,
      turnId: operation?.turnId || null,
      eventType: 'RUN_TERMINAL_RESULT_PUBLISHED',
      sourceCursor: `result:${resultId || digest}`,
      payload: { status, outcome, resultId, resultDigest: digest, stopState },
    });

    return { runId, status, outcome, resultId, resultDigest: digest, summary };
  });
}

async function getAgentRunStateActivity({ runId } = {}) {
  const result = await query(
    `SELECT ar.agent_run_id AS "runId", ar.status, ar.revocation_epoch AS "revocationEpoch",
            es.status AS "scopeStatus", es.revocation_epoch AS "scopeRevocationEpoch",
            g.grant_state AS "grantState"
       FROM worker.agent_runs ar
       JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id
       LEFT JOIN auth.execution_grants g ON g.agent_run_id = ar.agent_run_id AND g.grant_kind = 'ROOT_RUN'
      WHERE ar.agent_run_id = $1`,
    [runId],
  );
  return result.rows[0] || null;
}

module.exports = {
  markAgentRunStateActivity,
  prepareProviderOperationActivity,
  prepareManagedCapabilityEffectActivity,
  revokeManagedCapabilityBeforeDispatchActivity,
  dispatchManagedCapabilityActivity,
  finalizeAgentRunActivity,
  getAgentRunStateActivity,
};
