-- ============================================================
-- Migration: 00022__auth_application_scope.sql
-- Purpose:
-- Adds application-scoped authentication foundations so shared
-- auth.users identities can be safely used by SkyServer Admin,
-- SkyServer Core/Worker, and future SkyWeb users.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Application registry seed required before auth app FKs.
-- This mirrors/extends core configuration seed data so app-scoped
-- auth can be used even before seed scripts run.
-- ------------------------------------------------------------

INSERT INTO core.applications (app_code, title, manifest_version, description, active)
VALUES
  (
    'SKYSERVER_ADMIN',
    'SkyCommand',
    '1.0.0',
    'Private administrative web console for SkyServer control-plane operations.',
    TRUE
  ),
  (
    'SKYSERVER_CORE',
    'SkyServer Core',
    '2.0.0',
    'Shared operational manifest for SkyServer Core CLI and Admin-Web/API tool execution.',
    TRUE
  ),
  (
    'SKYSERVER_WORKER',
    'SkyServer Worker',
    '1.0.0',
    'Background automation worker for schedules, listeners, and event-driven operations.',
    TRUE
  ),
  (
    'SKYWEB',
    'SkyWeb',
    '0.1.0',
    'Future public-facing web application and macro/dashboard experience.',
    TRUE
  )
ON CONFLICT (app_code) DO UPDATE
SET title = EXCLUDED.title,
    manifest_version = EXCLUDED.manifest_version,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- App-scope columns.
-- Roles and permissions become app-owned authorization concepts.
-- Sessions become app-scoped so a token issued for one application
-- cannot silently become authorization for another.
-- Operational logs keep nullable app_id for historical compatibility
-- and future reporting.
-- ------------------------------------------------------------

ALTER TABLE auth.roles
  ADD COLUMN IF NOT EXISTS app_id UUID;

ALTER TABLE auth.permissions
  ADD COLUMN IF NOT EXISTS app_id UUID;

ALTER TABLE auth.sessions
  ADD COLUMN IF NOT EXISTS app_id UUID;

ALTER TABLE auth.login_events
  ADD COLUMN IF NOT EXISTS app_id UUID;

ALTER TABLE auth.audit_events
  ADD COLUMN IF NOT EXISTS app_id UUID;

ALTER TABLE auth.script_execution_log
  ADD COLUMN IF NOT EXISTS app_id UUID;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
UPDATE auth.roles r
SET app_id = admin_app.app_id
FROM admin_app
WHERE r.app_id IS NULL;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
UPDATE auth.permissions p
SET app_id = admin_app.app_id
FROM admin_app
WHERE p.app_id IS NULL;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
UPDATE auth.sessions s
SET app_id = admin_app.app_id
FROM admin_app
WHERE s.app_id IS NULL;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
UPDATE auth.login_events le
SET app_id = admin_app.app_id
FROM admin_app
WHERE le.app_id IS NULL;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
UPDATE auth.audit_events ae
SET app_id = admin_app.app_id
FROM admin_app
WHERE ae.app_id IS NULL;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
UPDATE auth.script_execution_log sel
SET app_id = admin_app.app_id
FROM admin_app
WHERE sel.app_id IS NULL;

ALTER TABLE auth.roles
  ALTER COLUMN app_id SET NOT NULL;

ALTER TABLE auth.permissions
  ALTER COLUMN app_id SET NOT NULL;

ALTER TABLE auth.sessions
  ALTER COLUMN app_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_app_id_fkey'
  ) THEN
    ALTER TABLE auth.roles
      ADD CONSTRAINT roles_app_id_fkey
      FOREIGN KEY (app_id)
      REFERENCES core.applications(app_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permissions_app_id_fkey'
  ) THEN
    ALTER TABLE auth.permissions
      ADD CONSTRAINT permissions_app_id_fkey
      FOREIGN KEY (app_id)
      REFERENCES core.applications(app_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_app_id_fkey'
  ) THEN
    ALTER TABLE auth.sessions
      ADD CONSTRAINT sessions_app_id_fkey
      FOREIGN KEY (app_id)
      REFERENCES core.applications(app_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'login_events_app_id_fkey'
  ) THEN
    ALTER TABLE auth.login_events
      ADD CONSTRAINT login_events_app_id_fkey
      FOREIGN KEY (app_id)
      REFERENCES core.applications(app_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_app_id_fkey'
  ) THEN
    ALTER TABLE auth.audit_events
      ADD CONSTRAINT audit_events_app_id_fkey
      FOREIGN KEY (app_id)
      REFERENCES core.applications(app_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'script_execution_log_app_id_fkey'
  ) THEN
    ALTER TABLE auth.script_execution_log
      ADD CONSTRAINT script_execution_log_app_id_fkey
      FOREIGN KEY (app_id)
      REFERENCES core.applications(app_id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS roles_app_id_idx
  ON auth.roles (app_id);

CREATE UNIQUE INDEX IF NOT EXISTS roles_app_role_code_key
  ON auth.roles (app_id, role_code);

ALTER TABLE auth.permissions
  DROP CONSTRAINT IF EXISTS permissions_resource_action_key;

CREATE INDEX IF NOT EXISTS permissions_app_id_idx
  ON auth.permissions (app_id);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_app_permission_code_key
  ON auth.permissions (app_id, permission_code);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_app_resource_action_key
  ON auth.permissions (app_id, resource, action);

CREATE INDEX IF NOT EXISTS sessions_app_id_idx
  ON auth.sessions (app_id);

CREATE INDEX IF NOT EXISTS sessions_app_user_active_idx
  ON auth.sessions (app_id, user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS login_events_app_created_at_idx
  ON auth.login_events (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_app_created_at_idx
  ON auth.audit_events (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS script_execution_log_app_started_at_idx
  ON auth.script_execution_log (app_id, started_at DESC);

-- ------------------------------------------------------------
-- User application membership.
-- This is the explicit boundary between shared identity and the
-- applications a user can access.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.user_applications (
  user_id UUID NOT NULL,
  app_id UUID NOT NULL,

  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISABLED', 'PENDING')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  created_by UUID,
  updated_by UUID,

  PRIMARY KEY (user_id, app_id),

  CONSTRAINT user_applications_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT user_applications_app_id_fkey
    FOREIGN KEY (app_id)
    REFERENCES core.applications(app_id)
    ON DELETE CASCADE,

  CONSTRAINT user_applications_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES auth.users(user_id)
    ON DELETE SET NULL,

  CONSTRAINT user_applications_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES auth.users(user_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS user_applications_app_status_idx
  ON auth.user_applications (app_id, status);

CREATE INDEX IF NOT EXISTS user_applications_user_status_idx
  ON auth.user_applications (user_id, status);

DROP TRIGGER IF EXISTS user_applications_set_updated_at ON auth.user_applications;

CREATE TRIGGER user_applications_set_updated_at
BEFORE UPDATE ON auth.user_applications
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();

ALTER TABLE auth.user_applications OWNER TO postgres;

COMMENT ON TABLE auth.user_applications IS
'Application membership records for shared auth.users identities. Controls which apps a user can access.';

COMMENT ON COLUMN auth.user_applications.status IS
'ACTIVE users may authenticate to the application. DISABLED/PENDING users may exist without active access.';

-- Existing users are current SkyServer Admin users until future SkyWeb onboarding is introduced.
WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
INSERT INTO auth.user_applications (user_id, app_id, status, created_by, updated_by)
SELECT
  u.user_id,
  admin_app.app_id,
  'ACTIVE',
  u.created_by,
  u.updated_by
FROM auth.users u
CROSS JOIN admin_app
ON CONFLICT (user_id, app_id) DO UPDATE
SET status = CASE WHEN auth.user_applications.status = 'PENDING' THEN 'PENDING' ELSE EXCLUDED.status END,
    updated_by = EXCLUDED.updated_by,
    updated_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- App-aware auth views.
-- Existing columns are preserved first; app columns are appended
-- to avoid PostgreSQL CREATE OR REPLACE VIEW column-order errors.
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW auth.vw_user_applications
AS
SELECT
  ua.user_id,
  u.email,
  u.username,
  u.display_name,
  u.status AS user_status,
  u.is_system_user,

  ua.app_id,
  app.app_code,
  app.title AS app_title,
  app.active AS app_active,

  ua.status AS user_application_status,
  ua.created_at,
  ua.updated_at,
  ua.created_by,
  ua.updated_by
FROM auth.user_applications ua
JOIN auth.users u
  ON u.user_id = ua.user_id
JOIN core.applications app
  ON app.app_id = ua.app_id;

ALTER VIEW auth.vw_user_applications OWNER TO postgres;

COMMENT ON VIEW auth.vw_user_applications IS
'Readable user-to-application membership view for shared identity and app-specific access administration.';

CREATE OR REPLACE VIEW auth.vw_role_permissions
AS
SELECT
    r.role_id,
    r.role_code,
    r.role_name,
    r.description AS role_description,
    r.is_system_role,
    r.active AS role_active,

    p.permission_id,
    p.permission_code,
    p.resource,
    p.action,
    p.description AS permission_description,
    p.active AS permission_active,

    rp.active AS role_permission_active,
    rp.granted_at,
    rp.granted_by,

    r.app_id AS role_app_id,
    role_app.app_code AS role_app_code,
    role_app.title AS role_app_title,
    p.app_id AS permission_app_id,
    permission_app.app_code AS permission_app_code,
    permission_app.title AS permission_app_title
FROM auth.roles r
JOIN core.applications role_app
    ON role_app.app_id = r.app_id
JOIN auth.role_permissions rp
    ON rp.role_id = r.role_id
JOIN auth.permissions p
    ON p.permission_id = rp.permission_id
   AND p.app_id = r.app_id
JOIN core.applications permission_app
    ON permission_app.app_id = p.app_id
WHERE r.active = TRUE
  AND p.active = TRUE
  AND rp.active = TRUE
  AND role_app.active = TRUE
  AND permission_app.active = TRUE;

ALTER VIEW auth.vw_role_permissions OWNER TO postgres;

CREATE OR REPLACE VIEW auth.vw_user_roles
AS
SELECT
    u.user_id,
    u.email,
    u.username,
    u.display_name,
    u.status AS user_status,
    u.is_system_user,

    r.role_id,
    r.role_code,
    r.role_name,
    r.description AS role_description,
    r.is_system_role,
    r.active AS role_active,

    ur.active AS user_role_active,
    ur.assigned_at,
    ur.assigned_by,

    r.app_id,
    app.app_code,
    app.title AS app_title,
    ua.status AS user_application_status
FROM auth.users u
JOIN auth.user_roles ur
    ON ur.user_id = u.user_id
JOIN auth.roles r
    ON r.role_id = ur.role_id
JOIN core.applications app
    ON app.app_id = r.app_id
JOIN auth.user_applications ua
    ON ua.user_id = u.user_id
   AND ua.app_id = r.app_id
WHERE u.status = 'ACTIVE'
  AND r.active = TRUE
  AND ur.active = TRUE
  AND ua.status = 'ACTIVE'
  AND app.active = TRUE;

ALTER VIEW auth.vw_user_roles OWNER TO postgres;

CREATE OR REPLACE VIEW auth.vw_user_permissions
AS
SELECT
    u.user_id,
    u.email,
    u.username,
    u.display_name,
    u.status AS user_status,

    p.permission_id,
    p.permission_code,
    p.resource,
    p.action,
    p.description AS permission_description,

    STRING_AGG(DISTINCT r.role_code, ', ' ORDER BY r.role_code) AS granted_through_roles,

    p.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.users u
JOIN auth.user_applications ua
    ON ua.user_id = u.user_id
JOIN core.applications app
    ON app.app_id = ua.app_id
JOIN auth.user_roles ur
    ON ur.user_id = u.user_id
JOIN auth.roles r
    ON r.role_id = ur.role_id
   AND r.app_id = ua.app_id
JOIN auth.role_permissions rp
    ON rp.role_id = r.role_id
JOIN auth.permissions p
    ON p.permission_id = rp.permission_id
   AND p.app_id = r.app_id
WHERE u.status = 'ACTIVE'
  AND ua.status = 'ACTIVE'
  AND app.active = TRUE
  AND ur.active = TRUE
  AND r.active = TRUE
  AND rp.active = TRUE
  AND p.active = TRUE
GROUP BY
    u.user_id,
    u.email,
    u.username,
    u.display_name,
    u.status,
    p.permission_id,
    p.permission_code,
    p.resource,
    p.action,
    p.description,
    p.app_id,
    app.app_code,
    app.title;

ALTER VIEW auth.vw_user_permissions OWNER TO postgres;

CREATE OR REPLACE VIEW auth.vw_active_sessions
AS
SELECT
    s.session_id,
    s.user_id,

    u.email,
    u.username,
    u.display_name,
    u.status AS user_status,

    s.ip_address,
    s.user_agent,
    s.metadata,

    s.created_at,
    s.expires_at,
    s.last_seen_at,

    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP))::BIGINT AS seconds_until_expiry,

    s.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.sessions s
JOIN auth.users u
    ON u.user_id = s.user_id
JOIN core.applications app
    ON app.app_id = s.app_id
JOIN auth.user_applications ua
    ON ua.user_id = u.user_id
   AND ua.app_id = s.app_id
WHERE s.revoked_at IS NULL
  AND s.expires_at > CURRENT_TIMESTAMP
  AND u.status = 'ACTIVE'
  AND ua.status = 'ACTIVE'
  AND app.active = TRUE;

ALTER VIEW auth.vw_active_sessions OWNER TO postgres;

CREATE OR REPLACE VIEW auth.vw_login_events_recent
AS
SELECT
    le.login_event_id,

    le.user_id,
    u.email AS matched_user_email,
    u.username,
    u.display_name,

    le.session_id,
    le.email_attempted,
    le.success,
    le.failure_reason,

    le.ip_address,
    le.user_agent,
    le.created_at,

    le.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.login_events le
LEFT JOIN auth.users u
    ON u.user_id = le.user_id
LEFT JOIN core.applications app
    ON app.app_id = le.app_id;

ALTER VIEW auth.vw_login_events_recent OWNER TO postgres;

CREATE OR REPLACE VIEW auth.vw_audit_events_recent
AS
SELECT
    ae.audit_event_id,

    ae.user_id,
    u.email,
    u.username,
    u.display_name,

    ae.event_type,
    ae.resource_type,
    ae.resource_id,
    ae.action,
    ae.success,
    ae.message,
    ae.metadata,

    ae.ip_address,
    ae.user_agent,
    ae.created_at,

    ae.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.audit_events ae
LEFT JOIN auth.users u
    ON u.user_id = ae.user_id
LEFT JOIN core.applications app
    ON app.app_id = ae.app_id;

ALTER VIEW auth.vw_audit_events_recent OWNER TO postgres;

CREATE OR REPLACE VIEW auth.vw_script_execution_recent
AS
SELECT
    sel.execution_id,

    sel.user_id,
    u.email,
    u.username,
    u.display_name,

    sel.session_id,

    sel.script_name,
    sel.script_file,
    sel.category,
    sel.parameters,

    sel.status,
    sel.exit_code,

    sel.started_at,
    sel.finished_at,

    sel.duration_ms,
    ROUND(
        (
            COALESCE(
                sel.duration_ms::NUMERIC,
                EXTRACT(EPOCH FROM (COALESCE(sel.finished_at, CURRENT_TIMESTAMP) - sel.started_at)) * 1000
            ) / 1000
        ),
        3
    ) AS duration_seconds,

    sel.stdout_path,
    sel.stderr_path,
    sel.summary,
    sel.metadata,

    sel.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.script_execution_log sel
LEFT JOIN auth.users u
    ON u.user_id = sel.user_id
LEFT JOIN core.applications app
    ON app.app_id = sel.app_id;

ALTER VIEW auth.vw_script_execution_recent OWNER TO postgres;

COMMIT;
