-- ============================================================
-- Seed: 00048__workflow_temporal_template_node_support_seed.sql
-- Purpose:
-- Enables TEMPORAL_WORKFLOW template nodes as a supported
-- Workflow Builder node type for approved Temporal-native
-- subprocesses inside SkyServer workflow graphs.
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
  'TEMPORAL_WORKFLOW',
  'Run Temporal Workflow Template',
  'Starts an approved Temporal-native workflow template as a child Temporal execution and waits for completion through the SkyServer workflow executor.',
  'WORKFLOW',
  'worker.temporal_workflow_definitions',
  'temporal',
  TRUE,
  TRUE,
  '{"builderCard":"temporal","initiallySupported":true,"phase":"10.22"}'::jsonb
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
