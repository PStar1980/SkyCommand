const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const repositoryRoot = path.resolve(__dirname, '../../../..');
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repositoryRoot, relativePath));

const requiredContracts = [
  'packages/tools/contracts/database_health_summary.v1.schema.json',
  'packages/tools/contracts/database_build_summary.v1.schema.json',
  'packages/tools/contracts/postgresql_database_comparison_summary.v1.schema.json',
];

for (const contractPath of requiredContracts) {
  assert(exists(contractPath), `Required Phase 15 proof contract is missing: ${contractPath}`);
  const parsed = JSON.parse(read(contractPath));
  assert(parsed && typeof parsed === 'object', `Contract must parse as JSON: ${contractPath}`);
}

assert(
  exists('packages/db_compare/src/db_object_compare.js'),
  'The managed PostgreSQL comparison implementation must exist at its registered src entrypoint.',
);
assert(
  !exists('packages/db_compare/skycommand.tool.json'),
  'The onboarding descriptor must not be retained in the managed comparison package.',
);
assert(
  !exists(
    'packages/db_compare/postgresql_database_comparison_summary.v1.schema.json',
  ),
  'The comparison schema must remain centralized under packages/tools/contracts.',
);

const runtimeFiles = [
  'apps/api/src/services/scriptExecutionService.js',
  'apps/api/src/services/workflowExecutorService.js',
  'apps/worker/src/jobs/scheduledToolRunner.js',
  'apps/worker/src/jobs/scheduledTemporalWorkflowRunner.js',
  'apps/worker/src/jobs/scheduledSkyserverWorkflowRunner.js',
  'packages/temporal/src/activities/skyserverWorkflowActivities.js',
];
const runtimeGatePattern = /previewFingerprint|fileHash|sha256|SHA-256/;

for (const runtimeFile of runtimeFiles) {
  assert(
    !runtimeGatePattern.test(read(runtimeFile)),
    `Onboarding-only hash/fingerprint evidence leaked into a runtime execution path: ${runtimeFile}`,
  );
}

const workflowConditionTest = read(
  'apps/api/src/services/workflowConditionSelfTest.js',
);
assert(
  workflowConditionTest.includes(
    'nodes.db_compare_node.output.databasesMatch',
  ),
  'Workflow condition regression coverage must include the managed comparison result path.',
);
assert(
  workflowConditionTest.includes("falseTargetNodeKey: 'difference_summary_node'"),
  'Workflow condition regression coverage must prove the comparison false branch.',
);

const workflowVisibilityTest = read(
  'apps/api/src/services/workflowToolVisibilitySelfTest.js',
);
assert(
  workflowVisibilityTest.includes("requiredVisibilityChannels: ['admin-web', 'api']"),
  'Workflow eligibility regression coverage must require Admin-Web and API visibility.',
);

const confirmationTest = read(
  'apps/api/src/services/workflowToolConfirmationPolicySelfTest.js',
);
assert(
  confirmationTest.includes("confirmationMode: 'WORKFLOW_AUTOMATION'"),
  'Workflow automation confirmation behavior must remain explicitly covered.',
);
assert(
  confirmationTest.includes('Tool permissions and risk permissions must still be enforced'),
  'Workflow confirmation coverage must retain permission and risk enforcement.',
);

const outputTest = read('apps/admin-web/src/pages/workflowDatabaseOutputSelfTest.js');
for (const renderer of [
  'DatabaseHealthOutput',
  'DatabaseBuildOutput',
  'DatabaseComparisonOutput',
  'DatabaseSynchronizationSummary',
]) {
  assert(
    outputTest.includes(`function ${renderer}`),
    `Purpose-built database output regression coverage is missing: ${renderer}`,
  );
}

const authoringGuide = read('docs/SkyCommand_Tool_Authoring_Guide.md');
assert(
  authoringGuide.includes('both** `admin-web` and `api`'),
  'The authoring guide must document workflow visibility requirements.',
);
assert(
  authoringGuide.includes('Selecting all four channels is a sensible broad-access default'),
  'The authoring guide must document the broad-access visibility recommendation.',
);

assert(
  exists('docs/SkyCommand_Phase_15_Regression_and_Recovery_Matrix.md'),
  'The Phase 15 regression and recovery matrix must exist.',
);

const packageJson = JSON.parse(read('package.json'));
const scripts = packageJson.scripts || {};
for (const scriptName of [
  'tool-onboarding:self-test',
  'tool-verification:self-test',
  'workflow-tool-confirmation:self-test',
  'workflow-tool-visibility:self-test',
  'workflow-condition:self-test',
  'workflow-database-output:self-test',
  'workflow-result-context:self-test',
]) {
  assert(scripts[scriptName], `Required Phase 15 regression command is missing: ${scriptName}`);
}

console.log('[SkyCommand] Phase 15 closure-readiness self-test passed.');
