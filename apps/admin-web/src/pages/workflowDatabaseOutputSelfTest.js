const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = fs.readFileSync(path.join(__dirname, 'SkyWorkflows.jsx'), 'utf8');


assert(
  source.includes('function DatabaseHealthOutput({ toolResult })'),
  'Workflow Operations must have a purpose-built Database Health renderer.',
);
assert(
  source.includes('Health-check overview') && source.includes('Database results'),
  'The Database Health renderer must present overview and per-database tables.',
);
assert(
  source.includes("structuredToolResult?.outputType === 'database_health_summary.v1'"),
  'Focused node output must select the Database Health renderer by output contract.',
);
assert(
  source.includes('function DatabaseBuildOutput({ toolResult })'),
  'Workflow Operations must have a purpose-built Database Build renderer.',
);
assert(
  source.includes('SQL execution totals') && source.includes('Ordered SQL execution'),
  'The Database Build renderer must present grouped totals and ordered SQL rows.',
);
assert(
  source.includes("structuredToolResult?.outputType === 'database_build_summary.v1'"),
  'Focused node output must select the Database Build renderer by output contract.',
);

assert(
  source.includes('function DatabaseComparisonOutput({ toolResult })'),
  'Workflow Operations must have a purpose-built PostgreSQL comparison renderer.',
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
  'Workflow Operations must have a purpose-built database synchronization summary.',
);
assert(
  source.includes('Database synchronization proof'),
  'The database summary must clearly identify the workflow proof surface.',
);
assert(
  source.includes('Last completed SQL file') && source.includes('SQL roots'),
  'The database synchronization summary must include compact build checkpoints without copying every SQL row.',
);
assert(
  source.includes("structuredToolResult?.outputType === 'postgresql_database_comparison_summary.v1'"),
  'Focused node output must select the PostgreSQL comparison renderer by output contract.',
);

console.log('Workflow database output self-test passed.');
