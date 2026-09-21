-- Seed: 00150__agent_registry_permissions.sql
-- Purpose: Phase 19.1 Agent registry and authority-preview permissions.
-- Only SUPER_ADMIN receives the permissions. No Agent Run or provider-launch
-- permission is created or granted by this seed.

WITH permission_seed(permission_code, resource, action, description) AS (
  VALUES
    ('AGENT_READ', 'agent_registry', 'read', 'Read registered Agent definitions and safe runtime metadata.'),
    ('AGENT_MANAGE', 'agent_registry', 'manage', 'Manage registered Agent definitions and immutable revisions.'),
    ('AGENT_PROJECT_READ', 'agent_project', 'read', 'Read visible Agent Projects and registered workspace bindings.'),
    ('AGENT_PROJECT_MANAGE', 'agent_project', 'manage', 'Manage Agent Projects, memberships, repositories, and workspace bindings.'),
    ('AGENT_RUNTIME_READ', 'agent_runtime', 'read', 'Read registered runtime, installation, capability, and account metadata.'),
    ('AGENT_RUNTIME_MANAGE', 'agent_runtime', 'manage', 'Manage registered runtime, installation, capability, and account metadata.'),
    ('AGENT_ACCOUNT_USE', 'agent_account', 'use', 'Select an already registered account binding for authority preview.'),
    ('AGENT_AUTHORITY_PREVIEW', 'agent_authority', 'preview', 'Calculate and audit an advisory effective-authority preview.')
)
INSERT INTO auth.permissions (
  app_id, permission_code, resource, action, description, active
)
SELECT a.app_id, s.permission_code, s.resource, s.action, s.description, TRUE
FROM core.applications a
CROSS JOIN permission_seed s
WHERE a.app_code = 'SKYSERVER_ADMIN'
  AND a.active = TRUE
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN auth.permissions p
  ON p.permission_code IN (
    'AGENT_READ',
    'AGENT_MANAGE',
    'AGENT_PROJECT_READ',
    'AGENT_PROJECT_MANAGE',
    'AGENT_RUNTIME_READ',
    'AGENT_RUNTIME_MANAGE',
    'AGENT_ACCOUNT_USE',
    'AGENT_AUTHORITY_PREVIEW'
  )
WHERE r.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;
