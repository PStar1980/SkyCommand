#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../../../..');
const seedPath = path.join(
  repositoryRoot,
  'packages/db_build/src/seeds/00073__structured_tool_contract_associations_seed.sql',
);
const seedSource = fs.readFileSync(seedPath, 'utf8');

const expectedAssociations = {
  db_health: 'database_health_summary.v1',
  db_build: 'database_build_summary.v1',
  db_object_compare: 'postgresql_database_comparison_summary.v1',
  git_repo_status: 'git_repository_status.v1',
  dev_commit: 'git_commit_summary.v1',
  main_merge: 'git_branch_sync_summary.v1',
  repo_map_generate: 'repository_map_summary.v1',
  repo_zip_generate: 'repository_package_summary.v1',
  ingestion_fred: 'macro_ingestion_summary.v1',
  ingestion_boc: 'macro_ingestion_summary.v1',
  ingestion_statcan: 'macro_ingestion_summary.v1',
};

for (const [toolCode, outputType] of Object.entries(expectedAssociations)) {
  assert.match(
    seedSource,
    new RegExp(`\\('${toolCode}'\\s*,\\s*'${outputType.replaceAll('.', '\\.')}'`),
    `${toolCode} must be associated with ${outputType}.`,
  );

  const schemaPath = path.join(
    repositoryRoot,
    'packages/tools/contracts',
    `${outputType}.schema.json`,
  );
  assert.ok(fs.existsSync(schemaPath), `Missing contract file for ${outputType}.`);
}

assert.match(seedSource, /UPDATE core\.tools AS tool/);
assert.match(seedSource, /output_type = contract_map\.output_type/);
assert.match(seedSource, /output_schema_path = contract_map\.output_schema_path/);

console.log('Structured tool contract association self-test passed.');
