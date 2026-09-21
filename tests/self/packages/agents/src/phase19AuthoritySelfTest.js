const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EXECUTION_SURFACES,
  evaluateAuthority,
  intersectConstraints,
  intersectExecutionSurfacePolicies,
} = require(path.join(__dirname, '..', '..', '..', '..', '..', 'packages/agents/src/authority'));
const {
  evaluateRuntimeCompatibility,
  runtimeEligibility,
  safeRuntimeInstallation,
} = require(path.join(__dirname, '..', '..', '..', '..', '..', 'packages/agents/src/runtimeConfiguration'));
const { validateJsonSchema } = require(path.join(__dirname, '..', '..', '..', '..', '..', 'packages/tools/src/jsonSchemaValidator'));

const root = path.resolve(__dirname, '..', '..', '..', '..', '..');
const authoritySchema = JSON.parse(fs.readFileSync(path.join(root, 'packages/agents/contracts/agent_authority_snapshot.v1.schema.json'), 'utf8'));

function layer(entries) {
  return { surfaces: entries };
}

const scope = {
  capabilities: ['OBSERVE'],
  actions: ['READ'],
  resources: ['project:alpha'],
  environments: ['DEV_LOCAL'],
  dataClasses: ['INTERNAL'],
};
const runtimeConfiguration = {
  contract: 'agent_runtime_configuration_identity.v1',
  runtimeInstallationId: 'installation-1',
  reviewedSourceRevision: null,
  configurationRevision: 'config-1',
  configurationDigest: 'A'.repeat(64),
  capabilityManifestRevision: 'manifest-1',
  capabilityManifestDigest: 'B'.repeat(64),
  runtimeProfile: 'phase19-disabled',
  processGeneration: null,
  serviceGeneration: null,
  processStartedAt: null,
  observedAt: null,
  freshnessStatus: 'UNKNOWN',
  evidence: null,
};

const authority = evaluateAuthority({
  authorityKind: 'POLICY_EFFECTIVE',
  requested: scope,
  configured: scope,
  granted: scope,
  requestedSurfaces: layer([
    { surface: 'LOCAL_SHELL', mode: 'ALLOW', reason: 'Requested for comparison.' },
    { surface: 'CONNECTED_APP_MUTATION', mode: 'ALLOW', reason: 'Requested for deny proof.' },
  ]),
  configuredSurfaces: layer([
    { surface: 'LOCAL_SHELL', mode: 'READ_ONLY', reason: 'Configured read-only.' },
    { surface: 'CONNECTED_APP_MUTATION', mode: 'DENY', reason: 'Connected app mutation is denied.' },
  ]),
  grantedSurfaces: layer([
    { surface: 'LOCAL_SHELL', mode: 'ALLOW', reason: 'Capability allows shell.' },
    { surface: 'CONNECTED_APP_MUTATION', mode: 'ALLOW', reason: 'Capability cannot override configured deny.' },
  ]),
  constraints: { maxDurationMs: 10000, maxChildren: 10, maxConcurrentChildren: 8 },
  configuredConstraints: { maxDurationMs: 2000, maxChildren: 4, maxConcurrentChildren: 6 },
  grantedConstraints: { maxDurationMs: 3000, maxChildren: 2, maxConcurrentChildren: 7 },
  obligations: ['REGISTERED_WORKSPACE_ONLY'],
  runtimeConfiguration,
});

assert.doesNotThrow(() => validateJsonSchema(authority, authoritySchema, { schemaName: 'agent authority snapshot' }));
assert.equal(authority.executionSurfaces.granted.surfaces.find((entry) => entry.surface === 'LOCAL_SHELL').mode, 'READ_ONLY');
assert.equal(authority.executionSurfaces.granted.surfaces.find((entry) => entry.surface === 'CONNECTED_APP_MUTATION').mode, 'DENY');
assert.deepEqual(authority.constraints, { maxDurationMs: 2000, maxChildren: 2, maxConcurrentChildren: 6 });
assert.ok(authority.denials.some((item) => item.value === 'CONNECTED_APP_MUTATION'));
assert.ok(authority.differences.some((item) => item.dimension === 'executionSurface'));
assert.ok(authority.differences.some((item) => item.dimension === 'constraint'));
assert.match(authority.digest, /^[A-F0-9]{64}$/);
assert.equal(authority.authorityKind, 'POLICY_EFFECTIVE');

const runtimeCompatibleAuthority = evaluateAuthority({
  authorityKind: 'RUNTIME_COMPATIBLE',
  requested: scope,
  configured: scope,
  granted: { capabilities: [], actions: [], resources: [], environments: [], dataClasses: [] },
  requestedSurfaces: layer([{ surface: 'LOCAL_SHELL', mode: 'ALLOW' }]),
  configuredSurfaces: layer([{ surface: 'LOCAL_SHELL', mode: 'ALLOW' }]),
  grantedSurfaces: layer([{ surface: 'LOCAL_SHELL', mode: 'DENY', reason: 'Runtime compatibility failed.' }]),
  constraints: { maxDurationMs: 10000, maxChildren: 10, maxConcurrentChildren: 8 },
  configuredConstraints: { maxDurationMs: 2000, maxChildren: 4, maxConcurrentChildren: 6 },
  grantedConstraints: { maxDurationMs: 0, maxChildren: 0, maxConcurrentChildren: 0 },
  obligations: ['RUNTIME_COMPATIBILITY_FAILED'],
  runtimeConfiguration,
});
assert.equal(runtimeCompatibleAuthority.authorityKind, 'RUNTIME_COMPATIBLE');
assert.deepEqual(runtimeCompatibleAuthority.granted.capabilities, []);
assert.equal(runtimeCompatibleAuthority.executionSurfaces.granted.surfaces.find((entry) => entry.surface === 'LOCAL_SHELL').mode, 'DENY');
const phase19ExecutionAdmission = {
  admitted: false,
  executionEnabled: false,
  code: 'AGENT_EXECUTION_DISABLED_PHASE_19_1',
};
assert.equal(phase19ExecutionAdmission.admitted, false);
assert.equal(phase19ExecutionAdmission.executionEnabled, false);

assert.deepEqual(intersectConstraints([
  { maxDurationMs: 100, maxChildren: 5, maxConcurrentChildren: 3 },
  { maxDurationMs: 50, maxChildren: 8, maxConcurrentChildren: null },
  { maxDurationMs: null, maxChildren: 2, maxConcurrentChildren: 4 },
]), { maxDurationMs: 50, maxChildren: 2, maxConcurrentChildren: 3 });

function surfaceMode(requested, configured, granted) {
  return intersectExecutionSurfacePolicies({
    requested: { surfaces: [{ surface: 'LOCAL_SHELL', mode: requested, reason: 'requested' }] },
    configured: { surfaces: [{ surface: 'LOCAL_SHELL', mode: configured, reason: 'configured' }] },
    granted: { surfaces: [{ surface: 'LOCAL_SHELL', mode: granted, reason: 'granted' }] },
  }).granted.surfaces.find((entry) => entry.surface === 'LOCAL_SHELL');
}

const surfaceCases = [
  ['ALLOW', 'ALLOW', 'ALLOW', 'ALLOW'],
  ['ALLOW', 'READ_ONLY', 'ALLOW', 'READ_ONLY'],
  ['ALLOW', 'EXPLICIT_APPROVAL_REQUIRED', 'ALLOW', 'EXPLICIT_APPROVAL_REQUIRED'],
  ['ALLOW', 'READ_ONLY', 'EXPLICIT_APPROVAL_REQUIRED', 'DENY'],
  ['ALLOW', 'EXPLICIT_APPROVAL_REQUIRED', 'READ_ONLY', 'DENY'],
  ['READ_ONLY', 'READ_ONLY', 'ALLOW', 'READ_ONLY'],
  ['EXPLICIT_APPROVAL_REQUIRED', 'EXPLICIT_APPROVAL_REQUIRED', 'ALLOW', 'EXPLICIT_APPROVAL_REQUIRED'],
  ['DENY', 'ALLOW', 'ALLOW', 'DENY'],
  ['READ_ONLY', 'DENY', 'EXPLICIT_APPROVAL_REQUIRED', 'DENY'],
];
for (const [requested, configured, granted, expected] of surfaceCases) {
  assert.equal(surfaceMode(requested, configured, granted).mode, expected, `${requested} × ${configured} × ${granted}`);
}

const restrictiveness = { DENY: 0, EXPLICIT_APPROVAL_REQUIRED: 1, READ_ONLY: 2, ALLOW: 3 };
for (const requested of Object.keys(restrictiveness)) {
  for (const configured of Object.keys(restrictiveness)) {
    for (const granted of Object.keys(restrictiveness)) {
      const expected = requested === 'DENY' || configured === 'DENY' || granted === 'DENY'
        || ([requested, configured, granted].includes('READ_ONLY') && [requested, configured, granted].includes('EXPLICIT_APPROVAL_REQUIRED'))
        ? 'DENY'
        : [requested, configured, granted].sort((left, right) => restrictiveness[left] - restrictiveness[right])[0];
      assert.equal(surfaceMode(requested, configured, granted).mode, expected, `full intersection ${requested} × ${configured} × ${granted}`);
    }
  }
}

const transitions = intersectExecutionSurfacePolicies({
  requested: { surfaces: [{ surface: 'LOCAL_SHELL', mode: 'ALLOW' }, { surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }], permittedTransitions: [{ from: 'LOCAL_SHELL', to: 'SKYCOMMAND_MCP_API', reason: 'registered' }] },
  configured: { surfaces: [{ surface: 'LOCAL_SHELL', mode: 'ALLOW' }, { surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }], permittedTransitions: [{ from: 'LOCAL_SHELL', to: 'SKYCOMMAND_MCP_API', reason: 'configured' }] },
  granted: { surfaces: [{ surface: 'LOCAL_SHELL', mode: 'ALLOW' }, { surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }], permittedTransitions: [{ from: 'LOCAL_SHELL', to: 'SKYCOMMAND_MCP_API', reason: 'granted' }] },
});
assert.deepEqual(transitions.permittedTransitions, [{ from: 'LOCAL_SHELL', to: 'SKYCOMMAND_MCP_API', reason: 'registered' }]);

const blockedTransitions = intersectExecutionSurfacePolicies({
  requested: { surfaces: [{ surface: 'LOCAL_SHELL', mode: 'ALLOW' }, { surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }], permittedTransitions: [{ from: 'LOCAL_SHELL', to: 'SKYCOMMAND_MCP_API', reason: 'requested' }] },
  configured: { surfaces: [{ surface: 'LOCAL_SHELL', mode: 'READ_ONLY' }, { surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }], permittedTransitions: [{ from: 'LOCAL_SHELL', to: 'SKYCOMMAND_MCP_API', reason: 'configured' }] },
  granted: { surfaces: [{ surface: 'LOCAL_SHELL', mode: 'EXPLICIT_APPROVAL_REQUIRED' }, { surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }], permittedTransitions: [{ from: 'LOCAL_SHELL', to: 'SKYCOMMAND_MCP_API', reason: 'granted' }] },
});
assert.equal(blockedTransitions.granted.surfaces.find((entry) => entry.surface === 'LOCAL_SHELL').mode, 'DENY');
assert.deepEqual(blockedTransitions.permittedTransitions, []);
assert.equal(EXECUTION_SURFACES.length, 10);

const defaultInstallation = safeRuntimeInstallation({});
assert.equal(defaultInstallation.certificationState, 'UNVERIFIED');
assert.equal(defaultInstallation.freshnessStatus, 'UNKNOWN');
assert.equal(defaultInstallation.enabled, false);
assert.equal(defaultInstallation.executionEnabled, false);

const declaredButUnverified = evaluateRuntimeCompatibility({
  installation: {
    enabled: false,
    certificationState: 'UNVERIFIED',
    freshnessStatus: 'UNKNOWN',
    executionEnabled: false,
    capabilityManifest: { scope: { capabilities: ['OBSERVE'] } },
  },
  requiredCapabilities: ['OBSERVE'],
});
assert.equal(declaredButUnverified.declaredCapabilities.includes('OBSERVE'), true);
assert.equal(declaredButUnverified.missingCapabilities.length, 0);
assert.equal(declaredButUnverified.compatible, false);
assert.ok(declaredButUnverified.reasons.includes('RUNTIME_INSTALLATION_DISABLED'));
assert.ok(declaredButUnverified.reasons.includes('RUNTIME_NOT_CERTIFIED'));
assert.ok(declaredButUnverified.reasons.includes('RUNTIME_FRESHNESS_UNKNOWN'));

const staleRuntime = evaluateRuntimeCompatibility({
  installation: {
    enabled: true,
    certificationState: 'CERTIFIED',
    freshnessStatus: 'STALE_BLOCKED',
    executionEnabled: false,
    capabilityManifest: { scope: { capabilities: ['OBSERVE'] } },
  },
  requiredCapabilities: ['OBSERVE'],
});
assert.equal(staleRuntime.compatible, false);
assert.ok(staleRuntime.reasons.includes('RUNTIME_FRESHNESS_STALE_BLOCKED'));

const currentRuntime = evaluateRuntimeCompatibility({
  installation: {
    enabled: true,
    certificationState: 'CERTIFIED',
    freshnessStatus: 'CURRENT',
    executionEnabled: false,
    capabilityManifest: { scope: { capabilities: ['OBSERVE'] } },
  },
  requiredCapabilities: ['OBSERVE'],
});
assert.equal(currentRuntime.compatible, true);
const eligibleCurrentRuntime = runtimeEligibility({
  installation: { enabled: true, certificationState: 'CERTIFIED', freshnessStatus: 'CURRENT', executionEnabled: false, capabilityManifest: { scope: { capabilities: ['OBSERVE'] } } },
  account: { accountState: 'CONFIGURED', executionEnabled: false },
  requiredCapabilities: ['OBSERVE'],
});
assert.equal(eligibleCurrentRuntime.eligible, true);
assert.equal(eligibleCurrentRuntime.executionEnabled, false);

console.log('✅ Phase 19.1 authority evaluator self-test passed.');
