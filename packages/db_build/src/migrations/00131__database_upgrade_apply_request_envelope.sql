-- Migration: 00131__database_upgrade_apply_request_envelope.sql
-- Purpose: Adds durable, human-decidable database-upgrade APPLY authorization
-- requests. This migration does not add or expose database APPLY execution.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.database_upgrade_apply_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED', 'STALE')),
  requested_by_agent_id TEXT NOT NULL
    CHECK (requested_by_agent_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  requested_by_actor_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(requested_by_actor_metadata) = 'object'),
  trigger_source TEXT NOT NULL DEFAULT 'ASSISTANT'
    CHECK (trigger_source = 'ASSISTANT'),
  database_name TEXT NOT NULL
    CHECK (database_name ~ '^[A-Za-z][A-Za-z0-9_]{0,62}$'),
  system_identifier TEXT NOT NULL
    CHECK (btrim(system_identifier) <> ''),
  baseline_ordinal INTEGER NOT NULL
    CHECK (baseline_ordinal = 128),
  source_revision TEXT,
  plan_digest CHAR(64) NOT NULL
    CHECK (plan_digest ~ '^[0-9A-Fa-f]{64}$'),
  pending_count INTEGER NOT NULL
    CHECK (pending_count > 0),
  pending_changes JSONB NOT NULL
    CHECK (jsonb_typeof(pending_changes) = 'array'),
  request_digest CHAR(64) NOT NULL
    CHECK (request_digest ~ '^[0-9A-Fa-f]{64}$'),
  policy_contract_version TEXT NOT NULL
    CHECK (policy_contract_version = 'database_upgrade_apply_request_policy.v1'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
    CHECK (expires_at > requested_at),
  human_decision_user_id UUID REFERENCES auth.users(user_id),
  human_decision_identity JSONB
    CHECK (human_decision_identity IS NULL OR jsonb_typeof(human_decision_identity) = 'object'),
  human_decision_at TIMESTAMPTZ,
  human_decision_note VARCHAR(4000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    status IN ('APPROVED', 'REJECTED')
    OR (
      human_decision_user_id IS NULL
      AND human_decision_identity IS NULL
      AND human_decision_at IS NULL
      AND human_decision_note IS NULL
    )
  ),
  CHECK (
    status NOT IN ('APPROVED', 'REJECTED')
    OR (
      human_decision_user_id IS NOT NULL
      AND human_decision_identity IS NOT NULL
      AND human_decision_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_database_upgrade_apply_request_pending_agent_plan
  ON core.database_upgrade_apply_requests (requested_by_agent_id, database_name, plan_digest)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS ix_database_upgrade_apply_requests_status_expiry
  ON core.database_upgrade_apply_requests (status, expires_at, requested_at DESC);

CREATE INDEX IF NOT EXISTS ix_database_upgrade_apply_requests_agent_requested
  ON core.database_upgrade_apply_requests (requested_by_agent_id, requested_at DESC);

COMMENT ON TABLE core.database_upgrade_apply_requests IS
  'Server-derived PLAN envelope awaiting a separate human APPLY authorization decision; envelope fields are immutable by the request service and no execution state is stored.';

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
INSERT INTO auth.permissions (
  app_id, permission_code, resource, action, description, active
)
SELECT admin_app.app_id, permission_code, 'database_upgrade', action, description, TRUE
FROM admin_app
CROSS JOIN (
  VALUES
    (
      'DB_UPGRADE_APPLY_REQUEST',
      'apply_request',
      'Create a bounded human-approval request for an exact governed database-upgrade PLAN; does not execute APPLY.'
    ),
    (
      'DB_UPGRADE_APPLY_APPROVE',
      'apply_approve',
      'Approve or reject an exact governed database-upgrade APPLY request as an authorized human administrator.'
    )
) AS permissions(permission_code, action, description)
ON CONFLICT (permission_code) DO UPDATE
SET app_id = EXCLUDED.app_id,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT role.role_id, permission.permission_id, TRUE
FROM auth.roles role
JOIN auth.permissions permission
  ON permission.permission_code = 'DB_UPGRADE_APPLY_APPROVE'
 AND permission.app_id = role.app_id
JOIN core.applications application
  ON application.app_id = role.app_id
 AND application.app_code = 'SKYSERVER_ADMIN'
WHERE role.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET active = TRUE,
    granted_at = CURRENT_TIMESTAMP;
