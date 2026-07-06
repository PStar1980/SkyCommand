-- ============================================================
-- Seed: 00049__workflow_condition_node_support_seed.sql
-- Purpose:
-- Enables CONDITION nodes as supported Workflow Builder gates.
-- Condition nodes evaluate safe expressions against workflow input
-- and prior node outputs, then decide whether the remaining linear
-- workflow should continue, stop successfully, or fail.
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
  'CONDITION',
  'Condition / Branch',
  'Evaluates a safe condition against workflow input, previous node output, or named node outputs. False can stop successfully, fail the workflow, or continue.',
  'CONTROL',
  NULL,
  'branch',
  FALSE,
  TRUE,
  '{
    "builderCard": "condition",
    "initiallySupported": true,
    "phase": "10.23",
    "operators": [
      "TRUTHY",
      "FALSY",
      "EXISTS",
      "NOT_EXISTS",
      "EQUALS",
      "NOT_EQUALS",
      "CONTAINS",
      "NOT_CONTAINS",
      "GREATER_THAN",
      "GREATER_OR_EQUAL",
      "LESS_THAN",
      "LESS_OR_EQUAL"
    ],
    "falseActions": [
      "STOP_SUCCESS",
      "FAIL_WORKFLOW",
      "CONTINUE"
    ],
    "contextPaths": [
      "input.*",
      "previous.*",
      "nodes.<node_key>.*"
    ]
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
