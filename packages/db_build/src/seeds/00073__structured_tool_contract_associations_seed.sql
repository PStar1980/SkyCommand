-- Seed: 00073__structured_tool_contract_associations_seed.sql
-- Purpose: Backfills the core.tools structured-output metadata for built-in tools
--          whose ToolResult contracts already exist in packages/tools/contracts.
--
-- The contract files are repository artifacts; the runtime association is stored
-- directly on core.tools through output_type and output_schema_path (migration 00066).

BEGIN;

WITH contract_map(tool_code, output_type, output_schema_path) AS (
  VALUES
    ('db_health',          'database_health_summary.v1',              'packages/tools/contracts/database_health_summary.v1.schema.json'),
    ('db_build',           'database_build_summary.v1',               'packages/tools/contracts/database_build_summary.v1.schema.json'),
    ('db_object_compare',  'postgresql_database_comparison_summary.v1','packages/tools/contracts/postgresql_database_comparison_summary.v1.schema.json'),
    ('git_repo_status',    'git_repository_status.v1',                'packages/tools/contracts/git_repository_status.v1.schema.json'),
    ('dev_commit',         'git_commit_summary.v1',                    'packages/tools/contracts/git_commit_summary.v1.schema.json'),
    ('main_merge',         'git_branch_sync_summary.v1',               'packages/tools/contracts/git_branch_sync_summary.v1.schema.json'),
    ('repo_map_generate',  'repository_map_summary.v1',                'packages/tools/contracts/repository_map_summary.v1.schema.json'),
    ('repo_zip_generate',  'repository_package_summary.v1',            'packages/tools/contracts/repository_package_summary.v1.schema.json'),
    ('ingestion_fred',     'macro_ingestion_summary.v1',               'packages/tools/contracts/macro_ingestion_summary.v1.schema.json'),
    ('ingestion_boc',      'macro_ingestion_summary.v1',               'packages/tools/contracts/macro_ingestion_summary.v1.schema.json'),
    ('ingestion_statcan',  'macro_ingestion_summary.v1',               'packages/tools/contracts/macro_ingestion_summary.v1.schema.json')
)
UPDATE core.tools AS tool
SET
  output_type = contract_map.output_type,
  output_schema_path = contract_map.output_schema_path,
  updated_at = NOW()
FROM contract_map
WHERE tool.tool_code = contract_map.tool_code
  AND (
    tool.output_type IS DISTINCT FROM contract_map.output_type
    OR tool.output_schema_path IS DISTINCT FROM contract_map.output_schema_path
  );

COMMIT;
