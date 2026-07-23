const fs = require('fs');
const path = require('path');
const { isBlankValue } = require('./workflowParameterUtils');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const value of [undefined, null, '', '   ', '\t', '\n']) {
  assert(isBlankValue(value), `Expected blank value: ${JSON.stringify(value)}`);
}

for (const value of [false, true, 0, 1, '0', 'false', 'value']) {
  assert(!isBlankValue(value), `Expected non-blank value: ${JSON.stringify(value)}`);
}

const serviceRoot = __dirname;
const executorSource = fs.readFileSync(
  path.join(serviceRoot, 'workflowExecutorService.js'),
  'utf8',
);
const conditionSource = fs.readFileSync(
  path.join(serviceRoot, 'workflowConditionService.js'),
  'utf8',
);

for (const [label, source] of [
  ['workflow executor', executorSource],
  ['workflow condition service', conditionSource],
]) {
  assert(
    source.includes("const { isBlankValue } = require('./workflowParameterUtils');"),
    `${label} must import the shared blank-value helper.`,
  );
}

assert(
  /function parseWaitDurationMs[\s\S]*?isBlankValue\(rawDurationMs\)/.test(executorSource),
  'WAIT parameter parsing must use the shared blank-value helper.',
);
assert(
  /function parseHumanApprovalTimeoutMs[\s\S]*?isBlankValue\(rawTimeoutMs\)[\s\S]*?isBlankValue\(rawDuration\)/.test(
    executorSource,
  ),
  'HUMAN_APPROVAL timeout parsing must use the shared blank-value helper.',
);
assert(
  !conditionSource.includes('function isBlankValue('),
  'Condition logic must not retain a private duplicate of the shared helper.',
);

console.log('[SkyCommand] Workflow node parameter utility self-test passed.');
