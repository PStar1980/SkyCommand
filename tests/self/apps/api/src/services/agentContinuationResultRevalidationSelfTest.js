const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../../..');
const {
  parseSingleContinuationResult,
  selectFinalRevalidatableContinuationResult,
} = require(path.join(root, 'packages/agents/src/continuationResult'));

const executionSource = fs.readFileSync(path.join(root, 'apps/api/src/services/agentExecutionService.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'apps/api/src/controllers/agentRunController.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'apps/api/src/routes/agentRun.routes.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'apps/codex-agent-runtime-worker/src/appServerClient.js'), 'utf8');
const temporalActivitiesSource = fs.readFileSync(path.join(root, 'packages/temporal/src/activities/agentRunActivities.js'), 'utf8');
const validateSource = fs.readFileSync(path.join(root, 'scripts/validate.js'), 'utf8');

const provisional = {
  previous_task_summary: 'The preceding task requested the governed read-only snapshot.',
  capability_result: {
    ok: false,
    effectId: '',
    dispatchState: 'PENDING',
    outcomeCertainty: 'PENDING',
    browserAutomationRunId: '',
  },
};
const finalResult = {
  previous_task_summary: 'The preceding task requested the governed read-only snapshot.',
  capability_result: {
    ok: true,
    effectId: 'effect-1',
    dispatchState: 'COMPLETED',
    outcomeCertainty: 'ACKNOWLEDGED',
    browserAutomationRunId: 'browser-1',
  },
};
const adjacent = `${JSON.stringify(provisional)}${JSON.stringify(finalResult)}`;

assert.equal(parseSingleContinuationResult(adjacent).valid, false, 'Normal live validation remains a single-root JSON contract.');
const selected = selectFinalRevalidatableContinuationResult(adjacent);
assert.equal(selected.valid, true);
assert.equal(selected.valueCount, 2);
assert.equal(selected.selectedIndex, 1);
assert.deepEqual(selected.normalized, finalResult);

const nested = `${JSON.stringify({ ...provisional, note: undefined })}${JSON.stringify({
  previous_task_summary: 'A string containing braces { and } and an escaped quote \\" remains safe.',
  capability_result: finalResult.capability_result,
})}`;
const nestedSelected = selectFinalRevalidatableContinuationResult(nested);
assert.equal(nestedSelected.valid, true);
assert.equal(nestedSelected.selectedIndex, 1);

assert.equal(selectFinalRevalidatableContinuationResult('not-json').valid, false);
assert.equal(selectFinalRevalidatableContinuationResult(JSON.stringify(provisional)).valid, false, 'A provisional-only object cannot be revalidated as success.');

assert.match(adapterSource, /activeAgentMessage/);
assert.match(adapterSource, /finalAgentMessageId/);
assert.match(adapterSource, /parseSingleContinuationResult/);
assert.match(adapterSource, /enum: \['COMPLETED'\]/);
assert.match(adapterSource, /enum: \['ACKNOWLEDGED'\]/);

assert.match(executionSource, /inspectContinuationResultRevalidation/);
assert.match(executionSource, /revalidateContinuationResult/);
assert.match(executionSource, /AGENT_CONTINUATION_REVALIDATION_INTERNAL_ONLY/);
assert.match(executionSource, /AGENT_CONTINUATION_RESULT_REVALIDATED/);
assert.match(executionSource, /CODEX_CONTINUATION_RESULT_INVALID/);
assert.match(executionSource, /selectFinalRevalidatableContinuationResult/);
assert.match(executionSource, /noProviderTurnSubmitted: true/);
assert.match(executionSource, /noBrowserExecutionCreated: true/);
assert.match(executionSource, /status = 'COMPLETED', outcome = 'SUCCESS'/);
assert.match(executionSource, /SET status = 'ACTIVE'/);
assert.doesNotMatch(executionSource, /UPDATE worker\.agent_results/, 'Immutable published result history must not be rewritten.');


assert.match(temporalActivitiesSource, /outcome = COALESCE\(outcome, '\{\}'::jsonb\) \|\| \$4::jsonb/, 'Run finalization must merge runtimeResult/reconciliation into provider outcome so an existing durableTerminalObservation survives.');
assert.doesNotMatch(temporalActivitiesSource, /outcome = \$4::jsonb/, 'Run finalization must not replace the whole provider-operation outcome document.');

assert.match(executionSource, /PROVIDER_TERMINAL_OBSERVED/);
assert.match(executionSource, /PROVIDER_TERMINAL_OBSERVED_EVENT/);
assert.match(executionSource, /historicalObservationMatchesRuntimeResult/);
assert.match(executionSource, /source_cursor = \$2/);
assert.match(executionSource, /eventRow\.availability !== 'REPORTED'/);
assert.match(executionSource, /eventRow\.freshness !== 'CURRENT'/);
assert.match(executionSource, /sha256Text\(runtimeMessage\) === sha256Text\(observationMessage\)/, 'Historical event fallback must cross-check the durable candidate message against provider-operation runtimeResult rather than trusting the event alone.');
assert.match(executionSource, /durableProviderObservationSource/);
assert.match(executionSource, /const messageDigest = message \? sha256Text\(message\) : null/, 'The revalidation fingerprint must use the raw UTF-8 provider message SHA-256 observed by R5C, not canonical JSON-string hashing.');

assert.match(controllerSource, /continuationResultRevalidation/);
assert.match(controllerSource, /revalidateContinuationResult/);
assert.match(routeSource, /continuation-result-revalidation/);
assert.match(routeSource, /revalidate-continuation-result/);
assert.match(validateSource, /agent-continuation-result-revalidation:self-test/);

console.log('[agent-continuation-result-revalidation:self-test] PASS: R5D keeps live assistant messages item-scoped and supports audited deterministic revalidation from durable provider/Browser evidence without another provider Turn or Browser execution.');
