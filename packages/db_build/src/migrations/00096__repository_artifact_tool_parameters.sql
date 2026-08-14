-- ============================================================
-- Migration: 00096__repository_artifact_tool_parameters.sql
-- Purpose:
--   Simplifies Generate Repository Map / Generate Repository Zip so the only
--   configured tool input is Repository. Repository root and generated-artifact
--   file/path settings are resolved from core.vw_repository_paths.
--
--   Existing workflow nodes are stripped of the retired location/fileName/
--   outputPath values so Development Promotion workflows can be rebound to a
--   workflow-level repository parameter without stale tool configuration.
-- ============================================================

BEGIN;

-- Retire the three filesystem parameters previously maintained separately on
-- each tool. Static options are removed automatically through ON DELETE CASCADE.
DELETE FROM core.tool_parameters parameter
USING core.tools tool
WHERE parameter.tool_id = tool.tool_id
  AND tool.tool_code IN ('repo_map_generate', 'repo_zip_generate')
  AND parameter.parameter_name IN ('location', 'fileName', 'outputPath');

-- Both artifact tools now consume the same repository selector used by the Git
-- tools. The selected repo code is passed to the script as the sole positional
-- argument; the script resolves the rest from the active configuration profile.
INSERT INTO core.tool_parameters (
  tool_id,
  parameter_name,
  label,
  param_type_code,
  prompt,
  required,
  default_value,
  option_source_code,
  display_order,
  enabled
)
SELECT
  tool.tool_id,
  'repoName',
  'Repository',
  'repo',
  'Select repository',
  TRUE,
  NULL,
  'repositories',
  10,
  TRUE
FROM core.tools tool
WHERE tool.tool_code IN ('repo_map_generate', 'repo_zip_generate')
ON CONFLICT (tool_id, parameter_name) DO UPDATE
SET label = EXCLUDED.label,
    param_type_code = EXCLUDED.param_type_code,
    prompt = EXCLUDED.prompt,
    required = EXCLUDED.required,
    default_value = EXCLUDED.default_value,
    option_source_code = EXCLUDED.option_source_code,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

-- Remove stale per-node values everywhere these tools are used. The two current
-- Development Promotion workflows therefore reopen with these tool nodes blank,
-- ready for the workflow-level repository binding the user will configure.
UPDATE worker.workflow_nodes
SET input_parameters = input_parameters - 'location' - 'fileName' - 'outputPath'
WHERE node_type_code = 'TOOL'
  AND target_code IN ('repo_map_generate', 'repo_zip_generate')
  AND input_parameters ?| ARRAY['location', 'fileName', 'outputPath'];

COMMIT;
