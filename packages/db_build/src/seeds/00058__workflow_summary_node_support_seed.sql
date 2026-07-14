-- ============================================================
-- Seed: 00058__workflow_summary_node_support_seed.sql
-- Purpose:
-- Enables SUMMARY nodes so SkyCommand workflows can generate
-- structured, human-readable run summaries from params, context,
-- node outputs, errors, and timings.
-- ============================================================

BEGIN;

INSERT INTO worker.workflow_node_types (
  node_type_code,
  display_name,
  description,
  category,
  target_kind,
  icon,
  requires_target,
  enabled,
  config
)
VALUES (
  'SUMMARY',
  'Run Summary',
  'Generates a structured workflow run summary from workflow parameters, runtime context, node outputs, errors, and timings.',
  'CONTROL',
  NULL,
  'file-text',
  FALSE,
  TRUE,
  '{
    "builderCard": "summary",
    "initiallySupported": true,
    "phase": "13.8",
    "runtime": "workflow_run_summary",
    "reads": ["params", "context", "nodes", "previousOutputs"],
    "writes": ["workflow_run_records.summary", "workflow_run_node_outputs", "workflow_run_context_values"],
    "supportsTemplates": true
  }'::jsonb
)
ON CONFLICT (node_type_code)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  target_kind = EXCLUDED.target_kind,
  icon = EXCLUDED.icon,
  requires_target = EXCLUDED.requires_target,
  enabled = EXCLUDED.enabled,
  config = worker.workflow_node_types.config || EXCLUDED.config,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
