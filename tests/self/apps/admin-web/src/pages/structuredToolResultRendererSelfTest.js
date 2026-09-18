const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const cataloguePath = path.join(
  repositoryRoot,
  'docs/generated/SkyCommand_Capability_Catalog.json',
);
const rendererPath = path.join(
  repositoryRoot,
  'apps/admin-web/src/components/tools/StructuredToolResultDisplay.jsx',
);
const presenterPath = path.join(
  repositoryRoot,
  'apps/admin-web/src/components/tools/StructuredToolResultPresenters.jsx',
);
const warningHelperPath = path.join(
  repositoryRoot,
  'apps/admin-web/src/components/tools/structuredToolResultWarnings.cjs',
);
const workflowPath = path.join(repositoryRoot, 'apps/admin-web/src/pages/SkyWorkflows.jsx');

const catalogueSource = fs.readFileSync(cataloguePath, 'utf8');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');
const presenterSource = fs.readFileSync(presenterPath, 'utf8');
const warningHelperSource = fs.readFileSync(warningHelperPath, 'utf8');
const workflowSource = fs.readFileSync(workflowPath, 'utf8');

const catalogueTypes = new Set(
  [...catalogueSource.matchAll(/"outputType"\s*:\s*"([^"]+)"/g)].map((match) => match[1]),
);
const rendererTypes = new Set(
  [...rendererSource.matchAll(/'([^']+\.v1)'\s*:/g)].map((match) => match[1]),
);

assert.equal(
  catalogueTypes.size,
  20,
  'the current catalogue should expose 20 structured output types',
);
assert.deepEqual(
  [...catalogueTypes].filter((type) => !rendererTypes.has(type)),
  [],
  'every catalogue output type must be registered with the shared renderer',
);
assert.equal(
  rendererTypes.size,
  20,
  'the shared registry should cover the current catalogue exactly',
);

for (const type of catalogueTypes) {
  const fixture = {
    schemaVersion: '1.0',
    success: true,
    outputType: type,
    output: {
      status: 'SUCCESS',
      outcome: 'COMPLETE',
      durationMs: 17,
      warnings: [],
      values: [{ name: 'fixture', path: 'C:/fixture/value' }],
      secret: 'must-not-be-rendered',
    },
  };
  assert.equal(fixture.outputType, type);
  assert.ok(
    rendererSource.includes("'" + type + "':"),
    'fixture type is missing from the renderer registry: ' + type,
  );
}

const requiredPresenters = [
  'structured-output-browser-automation',
  'structured-output-capability-catalog',
  'structured-output-database-upgrade',
  'structured-output-dev-env-reconcile',
  'structured-output-dev-finalization-preflight',
  'structured-output-dev-finalization-lifecycle',
  'structured-output-dev-finalization-validation',
  'structured-output-dev-finalization-readiness',
  'structured-output-dev-finalization-receipt',
  'structured-output-git-dev-pull',
  'structured-output-generic-fallback',
];
for (const testId of requiredPresenters) {
  assert.ok(
    presenterSource.includes('data-testid="' + testId + '"'),
    'missing presenter fixture: ' + testId,
  );
}

for (const requiredContract of [
  'isStructuredToolResultEnvelope',
  'GenericStructuredToolResultOutput',
  'isStructuredToolResultRendererRegistered',
  'getStructuredToolResultRendererOutputTypes',
  'MAX_ROWS',
  'MAX_COLUMNS',
  '[redacted]',
  'getSafeObject',
  'getSafeArray',
]) {
  assert.ok(
    rendererSource.includes(requiredContract) || presenterSource.includes(requiredContract),
    'renderer contract is missing: ' + requiredContract,
  );
}

assert.match(
  rendererSource,
  /STRUCTURED_TOOL_RESULT_RENDERERS\[toolResult\?\.outputType\]\s*\|\|\s*isStructuredToolResultEnvelope/,
);
assert.match(
  workflowSource,
  /<StructuredToolResultDisplay toolResult=\{structuredToolResult\} \/>/,
);
assert.ok(
  !workflowSource.includes('macroIngestionResult'),
  'Workflow Operations must not keep a duplicate type branch',
);
assert.ok(
  !workflowSource.includes('databaseComparisonResult'),
  'Workflow Operations must not keep a duplicate type branch',
);
assert.ok(
  presenterSource.includes("typeof value === 'boolean'"),
  'boolean values need bounded presentation coverage',
);
assert.ok(
  presenterSource.includes('value === null || value === undefined'),
  'null and empty values need safe presentation coverage',
);
assert.ok(
  presenterSource.includes('truncate(value, 600)'),
  'long strings and digests need bounded presentation coverage',
);
assert.ok(presenterSource.includes('isSecretKey'), 'secret-like keys need redaction coverage');

assert.ok(
  presenterSource.includes('mergeStructuredWarnings(toolResult?.warnings, output?.warnings)'),
  'shared warning presentation must combine both warning sources',
);
assert.ok(
  warningHelperSource.includes('module.exports') &&
    warningHelperSource.includes('getStructuredWarningDisplayValue'),
  'warning normalization must remain a reusable helper',
);

const { mergeStructuredWarnings } = require(warningHelperPath);
const toolWarnings = ['known warning one', { code: 'KNOWN_TWO', message: 'known warning two' }];
const outputWarnings = [
  { message: 'known warning one' },
  { code: 'KNOWN_TWO', message: 'known warning two' },
  'distinct warning three',
];
const mergedWarnings = mergeStructuredWarnings(toolWarnings, outputWarnings);
assert.deepEqual(
  mergedWarnings,
  [...toolWarnings, 'distinct warning three'],
  'equivalent warning values must render once in first-seen order while distinct values remain',
);
assert.deepEqual(toolWarnings, [
  'known warning one',
  { code: 'KNOWN_TWO', message: 'known warning two' },
]);
assert.deepEqual(outputWarnings, [
  { message: 'known warning one' },
  { code: 'KNOWN_TWO', message: 'known warning two' },
  'distinct warning three',
]);

console.log(
  'Structured ToolResult renderer self-test passed for ' +
    catalogueTypes.size +
    ' catalogue types.',
);
