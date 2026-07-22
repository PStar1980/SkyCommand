const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = fs.readFileSync(path.join(__dirname, 'SkyWorkflows.jsx'), 'utf8');

assert(
  source.includes('function DatabaseComparisonOutput({ toolResult })'),
  'Workflow History must have a purpose-built PostgreSQL comparison renderer.',
);
assert(
  source.includes('Differences by object type'),
  'The PostgreSQL comparison renderer must present grouped object-type evidence.',
);
assert(
  source.includes('Difference details'),
  'The PostgreSQL comparison renderer must present tabular difference details.',
);
assert(
  source.includes('function DatabaseSynchronizationSummary({ synchronization })'),
  'Workflow History must have a purpose-built database synchronization summary.',
);
assert(
  source.includes('Database synchronization proof'),
  'The database summary must clearly identify the workflow proof surface.',
);
assert(
  source.includes("structuredToolResult?.outputType === 'postgresql_database_comparison_summary.v1'"),
  'Focused node output must select the PostgreSQL comparison renderer by output contract.',
);

console.log('Workflow database output self-test passed.');
