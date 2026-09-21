const { sha256Digest, uniqueSorted } = require('./canonical');

const EXECUTION_SURFACES = Object.freeze([
  'REPOSITORY_FILE_EDIT',
  'LOCAL_SHELL',
  'SKYCOMMAND_MCP_API',
  'SKYCOMMAND_UI_COMPUTER_USE',
  'GENERAL_DESKTOP_COMPUTER_USE',
  'EXTERNAL_BROWSER',
  'CONNECTED_APP_READ',
  'CONNECTED_APP_MUTATION',
  'REMOTE_DEVICE',
  'PLAYWRIGHT_REGISTERED',
]);

const EXECUTION_SURFACE_MODES = Object.freeze([
  'ALLOW',
  'READ_ONLY',
  'DENY',
  'EXPLICIT_APPROVAL_REQUIRED',
]);

const SCOPE_DIMENSIONS = Object.freeze([
  'capabilities',
  'actions',
  'resources',
  'environments',
  'dataClasses',
]);

const RESTRICTIVENESS = Object.freeze({
  DENY: 0,
  EXPLICIT_APPROVAL_REQUIRED: 1,
  READ_ONLY: 2,
  ALLOW: 3,
});

const NUMERIC_CONSTRAINTS = Object.freeze([
  'maxDurationMs',
  'maxChildren',
  'maxConcurrentChildren',
]);

function normalizeScope(scope = {}) {
  return SCOPE_DIMENSIONS.reduce((result, dimension) => {
    result[dimension] = uniqueSorted(Array.isArray(scope?.[dimension]) ? scope[dimension] : []);
    return result;
  }, {});
}

function intersectLists(lists) {
  const [first = [], ...rest] = lists;
  return uniqueSorted(first.filter((value) => rest.every((list) => list.includes(value))));
}

function intersectScopes(scopes = []) {
  const normalized = scopes.map(normalizeScope);
  return SCOPE_DIMENSIONS.reduce((result, dimension) => {
    result[dimension] = intersectLists(normalized.map((scope) => scope[dimension]));
    return result;
  }, {});
}

function normalizeSurfaceLayer(layer = {}, defaultMode = 'DENY') {
  const bySurface = new Map();
  const entries = Array.isArray(layer?.surfaces) ? layer.surfaces : [];

  for (const surface of EXECUTION_SURFACES) {
    bySurface.set(surface, { surface, mode: defaultMode, reason: null });
  }

  for (const entry of entries) {
    if (!EXECUTION_SURFACES.includes(entry?.surface)) continue;
    const mode = EXECUTION_SURFACE_MODES.includes(entry?.mode) ? entry.mode : defaultMode;
    bySurface.set(entry.surface, {
      surface: entry.surface,
      mode,
      reason: entry.reason ? String(entry.reason) : null,
    });
  }

  return {
    surfaces: EXECUTION_SURFACES.map((surface) => bySurface.get(surface)),
    permittedTransitions: normalizeTransitions(layer?.permittedTransitions),
  };
}

function normalizeTransitions(transitions = []) {
  const seen = new Set();
  return (Array.isArray(transitions) ? transitions : [])
    .filter((transition) => EXECUTION_SURFACES.includes(transition?.from) && EXECUTION_SURFACES.includes(transition?.to))
    .map((transition) => ({
      from: transition.from,
      to: transition.to,
      reason: String(transition.reason || 'Policy permits this transition.'),
    }))
    .filter((transition) => {
      const key = `${transition.from}\u0000${transition.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));
}

function mostRestrictive(entries) {
  return entries.reduce((selected, entry) => {
    if (!selected || RESTRICTIVENESS[entry.mode] < RESTRICTIVENESS[selected.mode]) return entry;
    return selected;
  }, null);
}

function combineSurfaceEntries(entries) {
  const modes = new Set(entries.map((entry) => entry.mode));
  if (modes.has('DENY')) {
    return {
      surface: entries[0].surface,
      mode: 'DENY',
      reason: entries.find((entry) => entry.mode === 'DENY')?.reason || 'At least one policy layer denies this surface.',
    };
  }

  // v1 has one mode field and therefore cannot express READ_ONLY plus an
  // approval gate at the same time. Failing closed is safer than silently
  // selecting one restriction and broadening the other away.
  if (modes.has('READ_ONLY') && modes.has('EXPLICIT_APPROVAL_REQUIRED')) {
    return {
      surface: entries[0].surface,
      mode: 'DENY',
      reason: 'READ_ONLY and EXPLICIT_APPROVAL_REQUIRED cannot both be represented by execution_surface_policy.v1.',
    };
  }

  const selected = mostRestrictive(entries);
  return {
    surface: selected.surface,
    mode: selected.mode,
    reason: selected.reason || null,
  };
}

function normalizeConstraintValue(value) {
  if (value === undefined || value === null) return null;
  if (Number.isInteger(value) && value >= 0) return value;
  // Invalid caller/configuration input must not become an unbounded value.
  return 0;
}

function normalizeConstraints(constraints = {}) {
  return NUMERIC_CONSTRAINTS.reduce((result, key) => {
    result[key] = normalizeConstraintValue(constraints?.[key]);
    return result;
  }, {});
}

function intersectConstraints(layers = []) {
  const normalized = layers.map(normalizeConstraints);
  return NUMERIC_CONSTRAINTS.reduce((result, key) => {
    const bounded = normalized
      .map((layer) => layer[key])
      .filter((value) => value !== null);
    result[key] = bounded.length > 0 ? Math.min(...bounded) : null;
    return result;
  }, {});
}

function intersectExecutionSurfacePolicies({ requested = {}, configured = {}, granted = {}, policyRevision = 'agent-policy.v1' } = {}) {
  const layers = [
    normalizeSurfaceLayer(requested),
    normalizeSurfaceLayer(configured),
    normalizeSurfaceLayer(granted),
  ];
  const effective = layers[0].surfaces.map((_, index) => {
    const entries = layers.map((layer) => layer.surfaces[index]);
    return combineSurfaceEntries(entries);
  });

  const transitionSets = layers.map((layer) => layer.permittedTransitions || []);
  const effectiveModes = new Map(effective.map((entry) => [entry.surface, entry.mode]));
  const transitions = transitionSets.length === 0
    ? []
    : transitionSets[0]
        .filter((candidate) => transitionSets.slice(1).every((set) => set.some((item) => item.from === candidate.from && item.to === candidate.to)))
        .filter((candidate) => effectiveModes.get(candidate.from) !== 'DENY' && effectiveModes.get(candidate.to) !== 'DENY');

  return {
    contract: 'execution_surface_policy.v1',
    policyRevision,
    requested: { surfaces: layers[0].surfaces },
    configured: { surfaces: layers[1].surfaces },
    granted: { surfaces: effective },
    permittedTransitions: transitions,
  };
}

function decision(value, dimension, reason) {
  return { dimension, value: String(value), reason };
}

function calculateDifferences(requested, effective, surfacePolicy) {
  const differences = [];

  for (const dimension of SCOPE_DIMENSIONS) {
    const requestedValues = requested[dimension] || [];
    const effectiveValues = effective[dimension] || [];
    for (const value of requestedValues) {
      if (!effectiveValues.includes(value)) {
        differences.push({ dimension, requested: value, effective: 'DENY' });
      }
    }
  }

  const requestedModes = new Map(surfacePolicy.requested.surfaces.map((entry) => [entry.surface, entry.mode]));
  for (const entry of surfacePolicy.granted.surfaces) {
    if (requestedModes.get(entry.surface) !== entry.mode) {
      differences.push({ dimension: 'executionSurface', requested: `${entry.surface}:${requestedModes.get(entry.surface)}`, effective: `${entry.surface}:${entry.mode}` });
    }
  }

  return differences;
}

function calculateConstraintDifferences(requested, effective) {
  return NUMERIC_CONSTRAINTS
    .filter((key) => requested[key] !== null && requested[key] !== effective[key])
    .map((key) => ({
      dimension: 'constraint',
      requested: `${key}:${requested[key]}`,
      effective: `${key}:${effective[key] === null ? 'UNBOUNDED' : effective[key]}`,
    }));
}

function evaluateAuthority({
  snapshotId,
  authorityKind = 'POLICY_EFFECTIVE',
  policyRevision = 'agent-policy.v1',
  sourcePolicyRevision = null,
  requested = {},
  configured = {},
  granted = {},
  requestedSurfaces = {},
  configuredSurfaces = {},
  grantedSurfaces = {},
  constraints = {},
  requestedConstraints,
  configuredConstraints = {},
  grantedConstraints = {},
  obligations = [],
  additionalDenials = [],
  runtimeConfiguration,
  now = new Date().toISOString(),
} = {}) {
  const normalizedRequested = normalizeScope(requested);
  const normalizedConfigured = normalizeScope(configured);
  const normalizedGranted = normalizeScope(granted);
  const effective = intersectScopes([normalizedRequested, normalizedConfigured, normalizedGranted]);
  const executionSurfaces = intersectExecutionSurfacePolicies({
    requested: requestedSurfaces,
    configured: configuredSurfaces,
    granted: grantedSurfaces,
    policyRevision,
  });
  const normalizedRequestedConstraints = normalizeConstraints(requestedConstraints ?? constraints);
  const effectiveConstraints = intersectConstraints([
    normalizedRequestedConstraints,
    configuredConstraints,
    grantedConstraints,
  ]);
  const denials = Array.isArray(additionalDenials) ? additionalDenials.filter(Boolean) : [];

  for (const dimension of SCOPE_DIMENSIONS) {
    for (const value of normalizedRequested[dimension]) {
      if (!effective[dimension].includes(value)) denials.push(decision(value, dimension, 'The requested value is absent from at least one configured or granted policy layer.'));
    }
  }
  for (const entry of executionSurfaces.granted.surfaces) {
    if (entry.mode === 'DENY') denials.push(decision(entry.surface, 'executionSurface', entry.reason || 'The effective execution-surface policy denies this surface.'));
  }

  const safeRuntimeConfiguration = runtimeConfiguration || {
    contract: 'agent_runtime_configuration_identity.v1',
    runtimeInstallationId: 'UNREGISTERED',
    configurationRevision: 'UNKNOWN',
    configurationDigest: sha256Digest({ runtime: 'UNREGISTERED' }),
    capabilityManifestRevision: 'UNKNOWN',
    capabilityManifestDigest: sha256Digest({ capabilities: 'UNKNOWN' }),
    runtimeProfile: 'UNKNOWN',
    freshnessStatus: 'UNKNOWN',
    reviewedSourceRevision: null,
    processGeneration: null,
    serviceGeneration: null,
    processStartedAt: null,
    observedAt: null,
    evidence: null,
  };
  const differences = [
    ...calculateDifferences(normalizedRequested, effective, executionSurfaces),
    ...calculateConstraintDifferences(normalizedRequestedConstraints, effectiveConstraints),
  ];
  const snapshotBody = {
    contract: 'agent_authority_snapshot.v1',
    authorityKind: authorityKind === 'RUNTIME_COMPATIBLE' ? 'RUNTIME_COMPATIBLE' : 'POLICY_EFFECTIVE',
    policyRevision,
    sourcePolicyRevision,
    requested: normalizedRequested,
    configured: normalizedConfigured,
    granted: effective,
    executionSurfaces,
    constraints: effectiveConstraints,
    obligations: uniqueSorted(obligations),
    denials,
    differences,
    runtimeConfiguration: safeRuntimeConfiguration,
  };
  const digest = sha256Digest(snapshotBody);

  return {
    ...snapshotBody,
    snapshotId: snapshotId || `authority-${digest.slice(0, 16)}`,
    digest,
    evaluatedAt: now,
  };
}

module.exports = {
  EXECUTION_SURFACES,
  EXECUTION_SURFACE_MODES,
  SCOPE_DIMENSIONS,
  normalizeScope,
  normalizeSurfaceLayer,
  normalizeConstraints,
  intersectConstraints,
  intersectScopes,
  intersectExecutionSurfacePolicies,
  evaluateAuthority,
};
