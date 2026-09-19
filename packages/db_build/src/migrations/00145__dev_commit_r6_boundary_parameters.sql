-- Migration: 00145__dev_commit_r6_boundary_parameters.sql
-- Purpose:
--   Correct the registered dev_commit Tool contract for the R6 governed
--   commit boundary. The two boundary ids remain optional for legacy/manual
--   execution, but are registered in the exact positional order consumed by
--   packages/git/src/dev_commit.js when supplied together.

DO $$
DECLARE
  dev_commit_tool_id UUID;
  existing_parameter_count INTEGER;
BEGIN
  SELECT tool_id
  INTO dev_commit_tool_id
  FROM core.tools
  WHERE tool_code = 'dev_commit'
  LIMIT 1;

  IF dev_commit_tool_id IS NULL THEN
    RAISE EXCEPTION '00145: registered dev_commit Tool is missing';
  END IF;

  SELECT COUNT(*)
  INTO existing_parameter_count
  FROM core.tool_parameters
  WHERE tool_id = dev_commit_tool_id
    AND parameter_name IN ('repoName', 'commitMessage')
    AND display_order IN (10, 20);

  IF existing_parameter_count <> 2 THEN
    RAISE EXCEPTION '00145: existing dev_commit positional parameters must remain repoName=10 and commitMessage=20';
  END IF;
END;
$$;

WITH boundary_parameters (
  parameter_name,
  label,
  prompt,
  display_order
) AS (
  VALUES
    (
      'finalizationWorkflowRunId',
      'Reviewed Finalization Workflow Run ID',
      'Optional reviewed DEV finalization workflow run record ID. Required together with workflowRunId for governed R6 execution.',
      30
    ),
    (
      'workflowRunId',
      'Promotion Workflow Run ID',
      'Optional governed promotion workflow run record ID. Required together with finalizationWorkflowRunId for governed R6 execution.',
      40
    )
)
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
  t.tool_id,
  p.parameter_name,
  p.label,
  'string',
  p.prompt,
  FALSE,
  NULL,
  NULL,
  p.display_order,
  TRUE,
  'POSITIONAL',
  NULL
FROM core.tools t
CROSS JOIN boundary_parameters p
WHERE t.tool_id = (
  SELECT tool_id
  FROM core.tools
  WHERE tool_code = 'dev_commit'
  LIMIT 1
)
ON CONFLICT (tool_id, parameter_name)
DO UPDATE SET
  label = EXCLUDED.label,
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

DO $$
DECLARE
  parameter_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO parameter_count
  FROM core.vw_tool_parameters
  WHERE tool_code = 'dev_commit'
    AND parameter_name IN (
      'repoName',
      'commitMessage',
      'finalizationWorkflowRunId',
      'workflowRunId'
    )
    AND (
      (parameter_name = 'repoName' AND display_order = 10 AND required = TRUE)
      OR (parameter_name = 'commitMessage' AND display_order = 20 AND required = TRUE)
      OR (parameter_name = 'finalizationWorkflowRunId' AND display_order = 30 AND required = FALSE)
      OR (parameter_name = 'workflowRunId' AND display_order = 40 AND required = FALSE)
    );

  IF parameter_count <> 4 THEN
    RAISE EXCEPTION '00145: dev_commit registered parameter contract invariant failed';
  END IF;
END;
$$;
