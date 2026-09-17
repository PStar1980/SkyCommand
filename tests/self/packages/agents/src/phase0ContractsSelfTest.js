const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const CONTRACTS = path.join(ROOT, 'packages/agents/contracts');
const FIXTURES = path.join(ROOT, 'tests/fixtures/agentic-ai/phase-0');
const APPROVED_PLAN_RELATIVE_PATH =
  'docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.1_APPROVED.md';
const { validateJsonSchema } = require(path.join(ROOT, 'packages/tools/src/jsonSchemaValidator'));
const { validateToolResult } = require(path.join(ROOT, 'packages/tools/src/toolResultContract'));

const schemaFiles = [
  'agent_command.v1.schema.json',
  'agent_authority_snapshot.v1.schema.json',
  'agent_runtime_locator.v1.schema.json',
  'agent_capability_manifest.v1.schema.json',
  'agent_event.v1.schema.json',
  'agent_run_summary.v1.schema.json',
  'agent_error.v1.schema.json',
  'fake_runtime_case.v1.schema.json',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function sha256(relativePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, relativePath)))
    .digest('hex')
    .toUpperCase();
}

function assertValid(value, schema, label) {
  assert.doesNotThrow(() => validateJsonSchema(value, schema, { schemaName: label }), label);
}

function assertInvalid(value, schema, label) {
  assert.equal(
    validateJsonSchema(value, schema, { schemaName: label, throwOnError: false }).valid,
    false,
    label,
  );
}

function run() {
  const schemas = Object.fromEntries(
    schemaFiles.map((fileName) => [fileName, readJson(`packages/agents/contracts/${fileName}`)]),
  );
  const baseline = readJson('docs/agentic-ai/phase-0/baseline-manifest.json');
  assert.equal(
    fs.existsSync(path.join(ROOT, APPROVED_PLAN_RELATIVE_PATH)),
    true,
    'active approved plan is installed at the authoritative path',
  );
  assert.equal(
    baseline.baselineValidationFindings.length,
    2,
    'two baseline validation findings are persisted',
  );
  baseline.baselineValidationFindings.forEach((finding) => {
    assert.equal(finding.classification, 'EXISTING_UNRELATED_FAILURE');
    assert.equal(finding.phase0Regression, false);
  });

  schemaFiles.forEach((fileName) => {
    assert.equal(typeof schemas[fileName].$id, 'string', `${fileName} has an id`);
    assert.doesNotMatch(
      JSON.stringify(schemas[fileName]),
      /Codex|OpenClaw|providerThread|providerSpecific/i,
      `${fileName} stays provider-neutral`,
    );
  });

  const command = {
    contract: 'agent_command.v1',
    commandId: 'cmd-phase0-1',
    requestId: 'req-phase0-1',
    commandType: 'START_RUN',
    idempotencyKey: 'phase0-key-1',
    admissionScope: 'ROOT',
    submittedAt: '2026-09-14T00:00:00.000Z',
    inputDigest: { algorithm: 'SHA-256', digest: 'digest-1' },
    clientInput: { task: 'read-only observation' },
    serverContext: null,
  };
  assertValid(command, schemas['agent_command.v1.schema.json'], 'agent command');
  assertInvalid(
    { ...command, inputDigest: { algorithm: 'MD5', digest: 'digest-1' } },
    schemas['agent_command.v1.schema.json'],
    'agent command rejects weak digest',
  );

  const scope = {
    actions: ['AGENT_READ'],
    resources: ['project:read-only'],
    environments: ['LOCAL'],
    dataClasses: ['PUBLIC'],
  };
  const authority = {
    contract: 'agent_authority_snapshot.v1',
    snapshotId: 'authority-phase0-1',
    policyRevision: 'policy-1',
    digest: 'authority-digest-1',
    evaluatedAt: '2026-09-14T00:00:00.000Z',
    requested: scope,
    configured: scope,
    granted: scope,
    constraints: { maxDurationMs: 60000, maxChildren: 0, maxConcurrentChildren: 0 },
    obligations: ['READ_ONLY'],
  };
  assertValid(authority, schemas['agent_authority_snapshot.v1.schema.json'], 'authority snapshot');

  const locator = {
    contract: 'agent_runtime_locator.v1',
    runtimeKind: 'FAKE_PERSISTENT',
    installationId: 'installation-1',
    accountBindingId: 'account-1',
    cellInstanceId: 'cell-1',
    cellGeneration: 1,
    sessionId: 'session-1',
    runId: 'run-1',
    turnId: null,
    leaseEpoch: 4,
    providerConversation: { namespace: 'fake', reference: 'conversation-1', generation: 1 },
    providerTurnReference: null,
  };
  assertValid(locator, schemas['agent_runtime_locator.v1.schema.json'], 'runtime locator');

  const manifest = {
    contract: 'agent_capability_manifest.v1',
    runtimeKind: 'FAKE_PERSISTENT',
    adapterVersion: 'fixture-1',
    protocolSchemaDigest: 'fixture-schema-1',
    features: [
      {
        name: 'reconciliation',
        status: 'SUPPORTED',
        evidence: 'fixture supports explicit reconciliation',
      },
      { name: 'usage', status: 'UNVERIFIED', evidence: 'fixture delays usage and may omit it' },
    ],
    extensions: null,
  };
  assertValid(manifest, schemas['agent_capability_manifest.v1.schema.json'], 'capability manifest');

  const event = {
    contract: 'agent_event.v1',
    eventId: 'event-1',
    eventType: 'USAGE_OBSERVED',
    scope: 'RUN',
    observedAt: '2026-09-14T00:00:01.000Z',
    source: { kind: 'FAKE_RUNTIME', instance: 'fixture-1', cursor: 'cursor-1' },
    availability: 'REPORTED',
    payload: { phase: 'late-telemetry' },
    measurements: [
      { name: 'input_tokens', value: null, unit: 'tokens', availability: 'NOT_REPORTED' },
    ],
  };
  assertValid(event, schemas['agent_event.v1.schema.json'], 'agent event');

  const summary = {
    runId: 'run-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    agentDefinitionId: 'agent-definition-1',
    agentRevision: 1,
    runtimeKind: 'FAKE_PERSISTENT',
    rootExecutionId: 'root-1',
    rootAgentRunId: 'run-1',
    parentAgentRunId: null,
    initiatingUserId: 'user-1',
    initiatingActor: { kind: 'USER', id: 'user-1', displayNameSnapshot: 'Phase 0 Fixture User' },
    triggerSource: 'MANUAL',
    status: 'COMPLETED',
    outcome: 'SUCCESS',
    summary: 'Fixture result',
    taskOutput: { observation: 'fixture result' },
    taskOutputSchema: 'observation.v1',
    artifacts: [
      {
        artifactId: 'artifact-1',
        origin: 'SUPERVISOR',
        integrity: { algorithm: 'SHA-256', digest: 'artifact-digest-1' },
        mediaType: 'text/plain',
        sizeBytes: 16,
        classification: 'PUBLIC',
        reference: 'artifact-ref-1',
      },
    ],
    changes: [
      {
        changeId: 'change-1',
        kind: 'FILE_CHANGE',
        path: 'src/example.js',
        evidenceRef: 'artifact-1',
        reportedBy: 'SUPERVISOR',
      },
    ],
    childRuns: [
      { runId: 'child-run-1', status: 'COMPLETED', outcome: 'SUCCESS', relationship: 'DELEGATED' },
    ],
    usage: {
      availability: 'NOT_REPORTED',
      observationsRef: 'usage-observation-1',
      scope: 'RUN',
      source: 'FAKE_RUNTIME',
      freshness: 'UNKNOWN',
      measurements: [
        { name: 'input_tokens', value: null, unit: 'tokens', availability: 'NOT_REPORTED' },
      ],
    },
    cost: {
      availability: 'NOT_REPORTED',
      amount: null,
      currency: null,
      scope: 'RUN',
      basis: null,
      reliability: null,
      priceSourceRevision: null,
      observationsRef: null,
    },
    recommendations: [
      {
        text: 'No provider usage was reported.',
        kind: 'OBSERVABILITY',
        evidenceRef: 'usage-observation-1',
      },
    ],
    extensions: { fixture: { caseId: 'persistent-delayed-usage' } },
  };
  assertValid(summary, schemas['agent_run_summary.v1.schema.json'], 'agent run summary');
  assertInvalid(
    { ...summary, status: 'SUCCESS' },
    schemas['agent_run_summary.v1.schema.json'],
    'agent run summary keeps outcome separate from execution status',
  );
  const toolResult = validateToolResult(
    {
      schemaVersion: '1.0',
      success: true,
      message: 'Phase 0 fixture result',
      outputType: 'agent_run_summary.v1',
      output: summary,
    },
    {
      expectedOutputType: 'agent_run_summary.v1',
      outputSchema: schemas['agent_run_summary.v1.schema.json'],
    },
  );
  assert.equal(toolResult.output.status, 'COMPLETED');
  assert.equal(toolResult.output.outcome, 'SUCCESS');

  const error = {
    contract: 'agent_error.v1',
    code: 'PROVIDER_SEND_UNKNOWN',
    phase: 'SUBMIT_TURN',
    message: 'Provider acceptance is unknown; reconciliation is required.',
    retryable: false,
    uncertainty: 'ACCEPTANCE_UNKNOWN',
    details: { resubmissionAllowed: false },
  };
  assertValid(error, schemas['agent_error.v1.schema.json'], 'agent error');

  const fixtureNames = [
    'fake-runtime-persistent-delayed-usage.json',
    'fake-runtime-ephemeral-absent-usage.json',
    'fake-runtime-ambiguous-send.json',
    'fake-runtime-rejected-send.json',
  ];
  fixtureNames.forEach((fileName) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, fileName), 'utf8'));
    assertValid(fixture, schemas['fake_runtime_case.v1.schema.json'], fileName);
  });

  const gate = readJson('tests/fixtures/agentic-ai/phase-0/phase0-gate.json');
  Object.entries(gate).forEach(([name, value]) =>
    assert.equal(value, false, `Phase 0 gate ${name} remains disabled`),
  );
  const migrationNames = fs
    .readdirSync(path.join(ROOT, 'packages/db_build/src/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const seedNames = fs
    .readdirSync(path.join(ROOT, 'packages/db_build/src/seeds'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.equal(
    migrationNames.length,
    baseline.databaseBuildInventory.migrationCount,
    'baseline migration count remains reproducible',
  );
  assert.equal(
    migrationNames.at(-1),
    baseline.databaseBuildInventory.lastMigration,
    'baseline last migration remains unchanged',
  );
  assert.equal(
    seedNames.length,
    baseline.databaseBuildInventory.seedCount,
    'baseline seed count remains reproducible',
  );
  assert.equal(
    seedNames.at(-1),
    baseline.databaseBuildInventory.lastSeed,
    'baseline last seed remains unchanged',
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'packages/agents/src')),
    false,
    'Phase 0 adds no Agent runtime source',
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'packages/db_build/src/migrations/00128__agent_phase0.sql')),
    false,
    'Phase 0 adds no migration',
  );

  console.log('[agent-phase0:self-test] PASS');
}

run();
