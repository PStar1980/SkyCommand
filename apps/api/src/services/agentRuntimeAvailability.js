const TERMINAL_RUNTIME_RELEASE_STATUSES = Object.freeze(['COMPLETED', 'FAILED', 'CANCELED', 'TIMED_OUT', 'RECOVERY_REQUIRED']);
const RUNTIME_OWNERSHIP_RELEASE_KEY = 'runtimeOwnershipRelease';

function assertAlias(value, fallback) {
  const alias = String(value || fallback || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('SQL alias must be a simple identifier.');
  return alias;
}

function runtimeOwnershipReleasedSql(operationAlias = 'uncertain') {
  const op = assertAlias(operationAlias, 'uncertain');
  return `COALESCE(${op}.outcome->'${RUNTIME_OWNERSHIP_RELEASE_KEY}'->>'released', 'false') = 'true'`;
}

function runtimeBusyConditionSql(runAlias = 'busy') {
  const run = assertAlias(runAlias, 'busy');
  const terminal = TERMINAL_RUNTIME_RELEASE_STATUSES.map((value) => `'${value}'`).join(', ');
  return `(
    ${run}.status NOT IN (${terminal})
    OR EXISTS (
      SELECT 1 FROM worker.agent_resource_leases lease
      WHERE lease.agent_run_id = ${run}.agent_run_id AND lease.lease_state IN ('ACTIVE', 'QUARANTINED')
    )
    OR EXISTS (
      SELECT 1 FROM auth.execution_grants grant_row
      WHERE grant_row.agent_run_id = ${run}.agent_run_id AND grant_row.grant_state = 'ACTIVE'
    )
    OR EXISTS (
      SELECT 1 FROM worker.agent_capability_effects effect
      WHERE effect.agent_run_id = ${run}.agent_run_id
        AND effect.dispatch_state IN ('INTENT', 'DISPATCHING', 'DISPATCHED', 'RECONCILING')
        AND effect.outcome_certainty IN ('UNKNOWN', 'NOT_CONFIRMED')
    )
    OR EXISTS (
      SELECT 1 FROM worker.agent_provider_operations uncertain
      WHERE uncertain.agent_run_id = ${run}.agent_run_id
        AND uncertain.operation_type = 'SUBMIT_TURN'
        AND (uncertain.outcome_certainty = 'UNKNOWN' OR uncertain.state IN ('UNKNOWN', 'RECOVERY_REQUIRED', 'JOURNALED', 'SENT', 'ACKNOWLEDGED', 'RECONCILING'))
        AND NOT (${runtimeOwnershipReleasedSql('uncertain')})
    )
  )`;
}

function releaseMarker({ previousRuntimeGeneration, currentRuntimeGeneration, sourceCursor, releasedAt }) {
  return {
    contract: 'agent_runtime_ownership_release.v1',
    released: true,
    outcomePreservedAsUnknown: true,
    previousRuntimeGeneration: previousRuntimeGeneration || null,
    currentRuntimeGeneration: currentRuntimeGeneration || null,
    sourceCursor: sourceCursor || null,
    releasedAt: releasedAt || new Date().toISOString(),
  };
}

module.exports = {
  RUNTIME_OWNERSHIP_RELEASE_KEY,
  TERMINAL_RUNTIME_RELEASE_STATUSES,
  releaseMarker,
  runtimeBusyConditionSql,
  runtimeOwnershipReleasedSql,
};
