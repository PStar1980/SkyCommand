const os = require('node:os');
const { sha256Digest } = require('./canonical');
const { validateJsonSchema } = require('../../tools/src/jsonSchemaValidator');
const eventSchema = require('../contracts/agent_event.v1.schema.json');
const fakeCaseSchema = require('../contracts/fake_runtime_case.v1.schema.json');
const { AGENT_RUNTIME_ADAPTER_CONTRACT } = require('./runtimeWorker');

const FAKE_RUNTIME_FIXTURES = Object.freeze({
  'persistent-delayed-usage': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'persistent-delayed-usage',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'DELAYED',
    sendAcceptance: 'ACKNOWLEDGED',
    expectedDisposition: 'OBSERVE_AND_RECONCILE',
    notes: 'Usage is observed as a separate late telemetry event.',
  }),
  'ephemeral-absent-usage': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'ephemeral-absent-usage',
    runtimeKind: 'FAKE_EPHEMERAL',
    sessionModel: 'EPHEMERAL',
    usageBehavior: 'ABSENT',
    sendAcceptance: 'ACKNOWLEDGED',
    expectedDisposition: 'OBSERVE_AND_RECONCILE',
    notes: 'Usage is not reported and is never inferred as zero.',
  }),
  'ambiguous-send': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'ambiguous-send',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'DELAYED',
    sendAcceptance: 'UNKNOWN',
    expectedDisposition: 'RECOVERY_REQUIRED',
    notes: 'The same provider operation is reconciled without a speculative second turn.',
  }),
  'rejected-before-acceptance': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'rejected-before-acceptance',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'ABSENT',
    sendAcceptance: 'REJECTED_BEFORE_ACCEPTANCE',
    expectedDisposition: 'SAFE_TO_REJECT',
    notes: 'The provider rejected before accepting the turn.',
  }),
  'browser-capability-success': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'browser-capability-success',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'DELAYED',
    sendAcceptance: 'ACKNOWLEDGED',
    expectedDisposition: 'OBSERVE_AND_RECONCILE',
    notes: 'The fake runtime requests one bounded managed Browser Automation capability.',
  }),
  'browser-capability-duplicate-retry': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'browser-capability-duplicate-retry',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'DELAYED',
    sendAcceptance: 'ACKNOWLEDGED',
    expectedDisposition: 'OBSERVE_AND_RECONCILE',
    notes: 'The fake runtime deliberately delivers the same managed capability request twice.',
  }),
  'browser-capability-revoked-before-dispatch': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'browser-capability-revoked-before-dispatch',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'DELAYED',
    sendAcceptance: 'ACKNOWLEDGED',
    expectedDisposition: 'OBSERVE_AND_RECONCILE',
    notes: 'The managed capability grant is revoked before native Browser dispatch.',
  }),
  'browser-capability-unknown-dispatch': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'browser-capability-unknown-dispatch',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'DELAYED',
    sendAcceptance: 'ACKNOWLEDGED',
    expectedDisposition: 'OBSERVE_AND_RECONCILE',
    notes: 'Native Browser start acknowledgement is treated as unknown and reconciled by its preallocated id.',
  }),
  'browser-capability-unknown-send': Object.freeze({
    contract: 'fake_runtime_case.v1',
    caseId: 'browser-capability-unknown-send',
    runtimeKind: 'FAKE_PERSISTENT',
    sessionModel: 'PERSISTENT',
    usageBehavior: 'DELAYED',
    sendAcceptance: 'UNKNOWN',
    expectedDisposition: 'RECOVERY_REQUIRED',
    notes: 'The fake provider send is UNKNOWN while the managed Browser effect remains durably reconciled.',
  }),
});

const MANAGED_BROWSER_CASES = new Set([
  'browser-capability-success',
  'browser-capability-duplicate-retry',
  'browser-capability-revoked-before-dispatch',
  'browser-capability-unknown-dispatch',
  'browser-capability-unknown-send',
]);

function isManagedBrowserCase(caseId) {
  return MANAGED_BROWSER_CASES.has(String(caseId || '').trim());
}

function normalizeWorkerIdentity(input = {}) {
  return String(input.workerIdentity || process.env.AGENT_RUNTIME_WORKER_IDENTITY || `${os.hostname()}:${process.pid}`).trim();
}

function resolveFakeRuntimeCase(caseId, runtimeKind) {
  const fixture = FAKE_RUNTIME_FIXTURES[String(caseId || '').trim()];
  if (!fixture) {
    const error = new Error('The requested fake runtime fixture is not source-controlled.');
    error.code = 'FAKE_RUNTIME_CASE_NOT_ALLOWED';
    throw error;
  }
  if (runtimeKind && fixture.runtimeKind !== runtimeKind) {
    const error = new Error('The fake runtime fixture does not match the pinned runtime kind.');
    error.code = 'FAKE_RUNTIME_KIND_MISMATCH';
    throw error;
  }
  const { runtimeKind: _runtimeKind, ...contractFixture } = fixture;
  validateJsonSchema(contractFixture, fakeCaseSchema, { schemaName: 'fake runtime case' });
  return fixture;
}

function buildEvent({ operationId, sequence, eventType, scope = 'RUN', workerIdentity, availability = 'REPORTED', freshness = 'CURRENT', payload = {} }) {
  const event = {
    contract: 'agent_event.v1',
    eventId: `${operationId}:event:${sequence}`,
    eventType,
    scope,
    observedAt: new Date().toISOString(),
    source: {
      kind: 'FAKE_RUNTIME_WORKER',
      instance: workerIdentity,
      cursor: `${operationId}:${sequence}`,
    },
    availability,
    freshness,
    payload,
  };
  validateJsonSchema(event, eventSchema, { schemaName: 'agent event' });
  return event;
}

function executeFakeRuntime({ caseId, runtimeKind, operationId, runId, sessionId, instruction, workerIdentity, cancellationRequested = false, managedCapabilityRequest = null } = {}) {
  const fixture = resolveFakeRuntimeCase(caseId, runtimeKind);
  const instance = normalizeWorkerIdentity({ workerIdentity });
  const instructionDigest = sha256Digest({ instruction: String(instruction || '') });
  const providerTurnId = `fake-turn-${sha256Digest({ operationId, instructionDigest }).slice(0, 24)}`;
  const providerSessionReference = fixture.sessionModel === 'PERSISTENT'
    ? `fake-session-${sha256Digest({ sessionId, runtimeKind }).slice(0, 24)}`
    : null;
  const events = [];
  let sequence = 1;

  events.push(buildEvent({
    operationId,
    sequence: sequence++,
    eventType: 'RUNTIME_STARTED',
    workerIdentity: instance,
    payload: { adapterContract: AGENT_RUNTIME_ADAPTER_CONTRACT, runtimeKind, sessionModel: fixture.sessionModel },
  }));

  if (cancellationRequested) {
    events.push(buildEvent({
      operationId,
      sequence: sequence++,
      eventType: 'STOP_CONFIRMED',
      workerIdentity: instance,
      payload: { physicalStopState: 'CONFIRMED', reason: 'authority_revoked_before_fake_send' },
    }));
    return {
      adapterContract: AGENT_RUNTIME_ADAPTER_CONTRACT,
      adapterVersion: 'fake-runtime-adapter.v1',
      runtimeKind,
      fixture,
      providerTurnId: null,
      providerSessionReference,
      sendAcceptance: 'NOT_STARTED_PROVEN',
      outcomeCertainty: 'NOT_STARTED_PROVEN',
      events,
      usage: { availability: 'NOT_REPORTED', observationsRef: operationId, scope: 'RUN', source: runtimeKind, freshness: 'UNKNOWN', measurements: [] },
      taskOutputCandidate: null,
      capabilityInvocations: [],
      physicalStop: { state: 'CONFIRMED', evidence: 'fake_runtime_never_sent' },
      worker: { identity: instance, generation: String(process.env.AGENT_RUNTIME_WORKER_GENERATION || `local-${process.pid}`), processId: process.pid, hostname: os.hostname() },
    };
  }

  const sendEvent = fixture.sendAcceptance === 'ACKNOWLEDGED'
    ? { eventType: 'TURN_ACKNOWLEDGED', availability: 'REPORTED', freshness: 'CURRENT', payload: { providerTurnId } }
    : fixture.sendAcceptance === 'UNKNOWN'
      ? { eventType: 'TURN_ACCEPTANCE_UNKNOWN', availability: 'ERROR', freshness: 'CURRENT', payload: { providerTurnId, certainty: 'UNKNOWN' } }
      : { eventType: 'TURN_REJECTED', availability: 'ERROR', freshness: 'CURRENT', payload: { rejection: 'FAKE_REJECTED_BEFORE_ACCEPTANCE' } };
  events.push(buildEvent({ operationId, sequence: sequence++, eventType: sendEvent.eventType, availability: sendEvent.availability, freshness: sendEvent.freshness, workerIdentity: instance, payload: sendEvent.payload }));

  const capabilityInvocations = [];
  if (isManagedBrowserCase(fixture.caseId) && managedCapabilityRequest) {
    const deliveryCount = fixture.caseId === 'browser-capability-duplicate-retry' ? 2 : 1;
    for (let deliveryIndex = 1; deliveryIndex <= deliveryCount; deliveryIndex += 1) {
      events.push(buildEvent({
        operationId,
        sequence: sequence++,
        eventType: 'CAPABILITY_INVOCATION_REQUESTED',
        workerIdentity: instance,
        payload: {
          effectId: managedCapabilityRequest.effectId || null,
          effectKey: managedCapabilityRequest.effectKey || null,
          capabilityKind: managedCapabilityRequest.capabilityKind || null,
          capabilityCode: managedCapabilityRequest.capabilityCode || null,
          capabilityVersion: managedCapabilityRequest.capabilityVersion || null,
          requestDigest: managedCapabilityRequest.requestDigest || null,
          deliveryIndex,
        },
      }));
      capabilityInvocations.push({
        effectId: managedCapabilityRequest.effectId || null,
        effectKey: managedCapabilityRequest.effectKey || null,
        credential: managedCapabilityRequest.credential || null,
        audience: managedCapabilityRequest.audience || null,
        capabilityKind: managedCapabilityRequest.capabilityKind || null,
        capabilityCode: managedCapabilityRequest.capabilityCode || null,
        capabilityVersion: managedCapabilityRequest.capabilityVersion || null,
        requestDigest: managedCapabilityRequest.requestDigest || null,
        deliveryIndex,
      });
    }
  }

  if (fixture.sendAcceptance === 'ACKNOWLEDGED') {
    events.push(buildEvent({ operationId, sequence: sequence++, eventType: 'PROGRESS', workerIdentity: instance, payload: { phase: 'structured_result_ready', progress: 1 } }));
    events.push(buildEvent({ operationId, sequence: sequence++, eventType: 'RESULT_CANDIDATE', workerIdentity: instance, payload: { resultSchema: 'fake-runtime-result.v1' } }));
  }

  const usage = fixture.usageBehavior === 'ABSENT'
    ? { availability: 'NOT_REPORTED', observationsRef: operationId, scope: 'RUN', source: runtimeKind, freshness: 'UNKNOWN', measurements: [] }
    : { availability: 'REPORTED', observationsRef: `${operationId}:late-usage`, scope: 'RUN', source: runtimeKind, freshness: 'STALE', measurements: [{ name: 'fake_turns', value: 1, unit: 'turn', availability: 'REPORTED' }] };
  events.push(buildEvent({ operationId, sequence: sequence++, eventType: 'USAGE_OBSERVED', workerIdentity: instance, availability: usage.availability, freshness: usage.freshness, payload: { measurements: usage.measurements, delayed: fixture.usageBehavior === 'DELAYED' } }));

  const taskOutputCandidate = fixture.sendAcceptance === 'ACKNOWLEDGED'
    ? { message: 'Deterministic fake runtime result.', caseId: fixture.caseId, runtimeKind, providerTurnId, sessionModel: fixture.sessionModel, instructionDigest, capabilitiesExecuted: [] }
    : null;
  return {
    adapterContract: AGENT_RUNTIME_ADAPTER_CONTRACT,
    adapterVersion: 'fake-runtime-adapter.v1',
    runtimeKind,
    fixture,
    providerTurnId,
    providerSessionReference,
    sendAcceptance: fixture.sendAcceptance,
    outcomeCertainty: fixture.sendAcceptance === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : fixture.sendAcceptance === 'REJECTED_BEFORE_ACCEPTANCE' ? 'REJECTED' : 'UNKNOWN',
    events,
    usage,
    capabilityInvocations,
    taskOutputCandidate,
    physicalStop: { state: 'NOT_REQUESTED', evidence: 'fake_runtime_completed_without_stop_request' },
    worker: { identity: instance, generation: String(process.env.AGENT_RUNTIME_WORKER_GENERATION || `local-${process.pid}`), processId: process.pid, hostname: os.hostname() },
  };
}

function reconcileFakeRuntime({ fixture, operationId, workerIdentity, reconciliationOutcome = null } = {}) {
  const resolvedFixture = typeof fixture === 'string' ? resolveFakeRuntimeCase(fixture) : resolveFakeRuntimeCase(fixture?.caseId, fixture?.runtimeKind);
  const instance = normalizeWorkerIdentity({ workerIdentity });
  const outcome = reconciliationOutcome || (resolvedFixture.sendAcceptance === 'UNKNOWN' ? 'RECOVERY_REQUIRED' : 'ACKNOWLEDGED');
  if (outcome === 'NOT_STARTED_PROVEN') {
    return {
      operationId,
      disposition: 'OBSERVE_AND_RECONCILE',
      outcomeCertainty: 'NOT_STARTED_PROVEN',
      safeResubmissionAllowed: true,
      substantiveResubmissionCount: 0,
      workerIdentity: instance,
    };
  }
  if (outcome === 'ACKNOWLEDGED') {
    return {
      operationId,
      disposition: 'OBSERVE_AND_RECONCILE',
      outcomeCertainty: 'ACKNOWLEDGED',
      safeResubmissionAllowed: false,
      substantiveResubmissionCount: 0,
      workerIdentity: instance,
    };
  }
  return {
    operationId,
    disposition: 'RECOVERY_REQUIRED',
    outcomeCertainty: 'UNKNOWN',
    safeResubmissionAllowed: false,
    substantiveResubmissionCount: 0,
    workerIdentity: instance,
  };
}

module.exports = {
  FAKE_RUNTIME_FIXTURES,
  resolveFakeRuntimeCase,
  executeFakeRuntime,
  reconcileFakeRuntime,
};
