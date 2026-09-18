const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../..');
const migration140Path = path.join(
  repositoryRoot,
  'packages/db_build/src/migrations/00140__dev_change_finalize_r5.sql',
);
const migration141Path = path.join(
  repositoryRoot,
  'packages/db_build/src/migrations/00141__r5_final_naming_convention.sql',
);
const cataloguePath = path.join(
  repositoryRoot,
  'docs/generated/SkyCommand_Capability_Catalog.json',
);

const migration140Source = fs.readFileSync(migration140Path);
const migration141Source = fs.readFileSync(migration141Path, 'utf8');
const catalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf8'));
const migration140Sha256 = crypto
  .createHash('sha256')
  .update(migration140Source)
  .digest('hex')
  .toUpperCase();

assert.equal(
  migration140Sha256,
  '1AEAB3DC0DF8CA20E95DDDCB5475D0BE0AA5DCDE39C20DE627487B3EECCB8B06',
  'migration 00140 must remain byte-identical',
);
assert.match(migration141Path, /00141__r5_final_naming_convention\.sql$/);
for (const acceptedLabel of [
  'Run Dev Finalization Preflight',
  'Rebuild Allowlisted Runtime',
  'Validate Dev Finalization',
  'Check Dev Finalization Readiness',
  'Persist Dev Finalization Receipt',
]) {
  assert.ok(
    migration141Source.includes(acceptedLabel),
    'migration is missing label: ' + acceptedLabel,
  );
}
assert.ok(migration141Source.includes("'Dev Change Finalization'"));
assert.ok(migration141Source.includes('UPDATE core.tools'));
assert.ok(migration141Source.includes('UPDATE worker.workflow_definitions'));
assert.ok(migration141Source.includes('jsonb_set'));
assert.ok(!migration141Source.includes('INSERT INTO core.tools'));
assert.ok(!migration141Source.includes('INSERT INTO worker.workflow_definitions'));

const tools = catalogue.resources?.tools || [];
const expectedTools = new Map([
  ['dev_finalization_preflight', 'Run Dev Finalization Preflight'],
  ['dev_runtime_lifecycle', 'Rebuild Allowlisted Runtime'],
  ['dev_finalization_validate', 'Validate Dev Finalization'],
  ['dev_finalization_readiness', 'Check Dev Finalization Readiness'],
  ['dev_finalization_receipt', 'Persist Dev Finalization Receipt'],
]);
const r5Tools = tools.filter((tool) => expectedTools.has(tool.code));
assert.equal(r5Tools.length, expectedTools.size, 'catalogue must contain exactly five R5 Tools');
assert.equal(new Set(r5Tools.map((tool) => tool.code)).size, expectedTools.size);
for (const tool of r5Tools) {
  assert.equal(
    tool.label,
    expectedTools.get(tool.code),
    'accepted label mismatch for ' + tool.code,
  );
}
assert.deepEqual(
  r5Tools.map((tool) => tool.name).sort(),
  [
    'devFinalizationPreflight',
    'devFinalizationReceipt',
    'devFinalizationReadiness',
    'devFinalizationValidate',
    'devRuntimeLifecycle',
  ].sort(),
  'stable internal Tool names must remain unchanged',
);

const workflows = catalogue.resources?.workflows || [];
const r5Workflows = workflows.filter((workflow) => workflow.code === 'dev_change_finalize');
assert.equal(r5Workflows.length, 1, 'catalogue must contain one dev_change_finalize workflow');
assert.equal(r5Workflows[0].name, 'Dev Change Finalization');
assert.equal(r5Workflows[0].code, 'dev_change_finalize');

console.log('R5 final naming migration and catalogue self-test passed.');
