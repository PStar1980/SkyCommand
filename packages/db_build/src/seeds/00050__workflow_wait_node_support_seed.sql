-- ============================================================
-- Seed: 00050__workflow_wait_node_support_seed.sql
-- Purpose:
-- Enables WAIT nodes as supported Workflow Builder delay gates.
-- WAIT nodes pause the active workflow for a configured duration
-- before continuing to the next sequential node.
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
  'WAIT',
  'Wait / Delay',
  'Pauses the workflow for a configured duration before continuing to the next sequential node. Temporal-backed executions use durable timers.',
  'CONTROL',
  NULL,
  'timer',
  FALSE,
  TRUE,
  '{
    "builderCard": "wait",
    "initiallySupported": true,
    "phase": "10.24",
    "maxDurationMs": 86400000,
    "units": [
      "MILLISECONDS",
      "SECONDS",
      "MINUTES",
      "HOURS"
    ],
    "runtime": "temporal_durable_timer"
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
