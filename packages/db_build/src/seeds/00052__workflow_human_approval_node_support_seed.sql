-- ============================================================
-- Seed: 00052__workflow_human_approval_node_support_seed.sql
-- Purpose:
-- Enables HUMAN_APPROVAL nodes and approval queue permissions for
-- SkyServer Admin workflow orchestration.
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
  'HUMAN_APPROVAL',
  'Human Approval',
  'Creates a durable approval checkpoint. Temporal-backed workflows wait for an authorized approve/reject signal before continuing.',
  'HUMAN',
  NULL,
  'user-check',
  FALSE,
  TRUE,
  '{
    "builderCard": "human_approval",
    "initiallySupported": true,
    "phase": "10.25",
    "signalName": "humanApprovalDecision",
    "runtime": "temporal_signal_checkpoint",
    "decisions": ["APPROVED", "REJECTED", "TIMED_OUT"],
    "actions": ["STOP_SUCCESS", "FAIL_WORKFLOW", "CONTINUE"],
    "maxTimeoutMs": 2592000000
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

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
), permission_seed(permission_code, resource, action, description, active) AS (
  VALUES
    (
      'WORKFLOW_APPROVAL_READ',
      'workflow_approvals',
      'read',
      'Read pending and completed SkyServer workflow human approval requests.',
      TRUE
    ),
    (
      'WORKFLOW_APPROVAL_DECIDE',
      'workflow_approvals',
      'decide',
      'Approve or reject pending SkyServer workflow human approval checkpoints.',
      TRUE
    )
)
INSERT INTO auth.permissions (app_id, permission_code, resource, action, description, active)
SELECT
  admin_app.app_id,
  permission_seed.permission_code,
  permission_seed.resource,
  permission_seed.action,
  permission_seed.description,
  permission_seed.active
FROM permission_seed
CROSS JOIN admin_app
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

WITH approval_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN')
), approval_permissions(permission_code) AS (
  VALUES ('WORKFLOW_APPROVAL_READ'), ('WORKFLOW_APPROVAL_DECIDE')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN approval_roles ar
  ON ar.role_code = r.role_code
JOIN approval_permissions ap
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = ap.permission_code
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

COMMIT;
