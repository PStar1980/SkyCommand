-- ============================================================
-- Seed: 00047__workflow_child_node_support_seed.sql
-- Purpose:
-- Enables WORKFLOW child nodes as a supported Workflow Builder
-- node type for composing active SkyServer workflows.
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
  'WORKFLOW',
  'Run Child Workflow',
  'Starts another active SkyServer workflow definition as a child/composed workflow node and waits for completion through the Temporal-backed executor.',
  'WORKFLOW',
  'worker.workflow_definitions',
  'workflow',
  TRUE,
  TRUE,
  '{"builderCard":"workflow","initiallySupported":true,"phase":"10.20"}'::jsonb
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
