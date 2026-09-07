-- ============================================================
-- Migration: 00112__tool_parameter_cli_binding.sql
-- Purpose:
--   Adds explicit command-line binding metadata to tool parameters so a
--   registered Boolean can emit a named CLI flag instead of a positional
--   true/false value. Existing parameters remain POSITIONAL by default.
--
--   Generate Repository Zip is upgraded to use includeTests as the first
--   FLAG-bound parameter proof: true -> --include-tests; false -> omitted.
-- ============================================================

BEGIN;

ALTER TABLE core.tool_parameters
  ADD COLUMN IF NOT EXISTS argument_mode TEXT NOT NULL DEFAULT 'POSITIONAL',
  ADD COLUMN IF NOT EXISTS cli_flag TEXT;

ALTER TABLE core.tool_parameters
  DROP CONSTRAINT IF EXISTS tool_parameters_argument_mode_check;

ALTER TABLE core.tool_parameters
  ADD CONSTRAINT tool_parameters_argument_mode_check
  CHECK (argument_mode IN ('POSITIONAL', 'FLAG'));

ALTER TABLE core.tool_parameters
  DROP CONSTRAINT IF EXISTS tool_parameters_cli_flag_check;

ALTER TABLE core.tool_parameters
  ADD CONSTRAINT tool_parameters_cli_flag_check
  CHECK (
    (argument_mode = 'POSITIONAL' AND cli_flag IS NULL)
    OR
    (argument_mode = 'FLAG' AND cli_flag ~ '^--[A-Za-z0-9][A-Za-z0-9-]*$')
  );

COMMENT ON COLUMN core.tool_parameters.argument_mode IS
  'Command-line binding mode. POSITIONAL appends the value; FLAG emits cli_flag only when a Boolean parameter resolves true.';

COMMENT ON COLUMN core.tool_parameters.cli_flag IS
  'Named CLI switch emitted for FLAG-bound Boolean parameters, for example --include-tests.';

-- Promote the repository ZIP include-tests choice from a select workaround to
-- a first-class Boolean flag binding. This is idempotent whether the parameter
-- was manually configured beforehand or does not yet exist.
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
  enabled,
  argument_mode,
  cli_flag
)
SELECT
  tool.tool_id,
  'includeTests',
  'Include Tests',
  'boolean',
  'Include the top-level tests directory in the generated repository ZIP.',
  FALSE,
  'false',
  NULL,
  20,
  TRUE,
  'FLAG',
  '--include-tests'
FROM core.tools tool
WHERE tool.tool_code = 'repo_zip_generate'
ON CONFLICT (tool_id, parameter_name) DO UPDATE
SET label = EXCLUDED.label,
    param_type_code = EXCLUDED.param_type_code,
    prompt = EXCLUDED.prompt,
    required = EXCLUDED.required,
    default_value = EXCLUDED.default_value,
    option_source_code = EXCLUDED.option_source_code,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    argument_mode = EXCLUDED.argument_mode,
    cli_flag = EXCLUDED.cli_flag,
    updated_at = CURRENT_TIMESTAMP;

DELETE FROM core.tool_parameter_options option_row
USING core.tool_parameters parameter, core.tools tool
WHERE option_row.parameter_id = parameter.parameter_id
  AND parameter.tool_id = tool.tool_id
  AND tool.tool_code = 'repo_zip_generate'
  AND parameter.parameter_name = 'includeTests';

CREATE OR REPLACE VIEW core.vw_tool_parameters AS
SELECT
  t.tool_id,
  t.tool_code,
  p.parameter_id,
  p.parameter_name,
  p.label,
  p.param_type_code,
  p.prompt,
  p.required,
  p.default_value,
  p.option_source_code,
  p.display_order,
  p.enabled,
  p.argument_mode,
  p.cli_flag
FROM core.tool_parameters p
JOIN core.tools t
  ON t.tool_id = p.tool_id
WHERE p.enabled = TRUE
  AND t.enabled = TRUE;

ALTER VIEW core.vw_tool_parameters OWNER TO postgres;

COMMIT;
