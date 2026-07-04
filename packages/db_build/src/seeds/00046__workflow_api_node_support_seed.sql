-- ============================================================
-- Seed: 00046__workflow_api_node_support_seed.sql
-- Purpose:
-- Enables API_CALL as a supported Workflow Builder node type.
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
  'API_CALL',
  'Call API',
  'Calls an approved HTTP/API endpoint with configured method, headers, payload, timeout, and expected success status codes.',
  'INTEGRATION',
  'api.endpoint',
  'api',
  TRUE,
  TRUE,
  '{"builderCard":"api","initiallySupported":true,"phase":"10.19"}'::jsonb
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
