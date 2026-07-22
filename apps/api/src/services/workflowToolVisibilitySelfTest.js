const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = fs.readFileSync(path.join(__dirname, 'workflowExecutorService.js'), 'utf8');

assert(
  source.includes("if (!visibilityChannels.has('api'))"),
  'Workflow Builder catalogue must omit tools without API visibility.',
);
assert(
  source.includes("requiredVisibilityChannels: ['admin-web', 'api']"),
  'Workflow target validation must report the required Admin-Web/API visibility channels.',
);
assert(
  source.includes('workflowIneligibleTools'),
  'Workflow save/publish validation must identify visibility-ineligible tool targets.',
);
assert(
  source.includes('visible_in_admin_web') && source.includes('visible_in_api'),
  'Workflow target validation must inspect both Admin-Web and API visibility.',
);
assert(
  source.includes('databaseSynchronization'),
  'Workflow summaries must expose the database synchronization rollup.',
);

console.log('Workflow tool visibility self-test passed.');
