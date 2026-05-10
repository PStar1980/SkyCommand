-- ============================================================
-- SkyServer Auth Views
-- ============================================================

-- ------------------------------------------------------------
-- View: auth.vw_role_permissions
-- Purpose:
-- Shows each active role-to-permission relationship.
-- Useful for Admin-Web role screens and permission inspection.
-- ------------------------------------------------------------

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
    rp.granted_by
FROM auth.roles r
JOIN auth.role_permissions rp
    ON rp.role_id = r.role_id
JOIN auth.permissions p
    ON p.permission_id = rp.permission_id
WHERE r.active = TRUE
  AND p.active = TRUE
  AND rp.active = TRUE;

ALTER VIEW auth.vw_role_permissions OWNER TO postgres;

COMMENT ON VIEW auth.vw_role_permissions IS
'Active role-to-permission relationships for RBAC inspection and Admin-Web permission management.';


-- ------------------------------------------------------------
-- View: auth.vw_user_roles
-- Purpose:
-- Shows each active user-to-role assignment.
-- Useful for Admin-Web user management screens.
-- ------------------------------------------------------------

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
    ur.assigned_by
FROM auth.users u
JOIN auth.user_roles ur
    ON ur.user_id = u.user_id
JOIN auth.roles r
    ON r.role_id = ur.role_id
WHERE u.status = 'ACTIVE'
  AND r.active = TRUE
  AND ur.active = TRUE;

ALTER VIEW auth.vw_user_roles OWNER TO postgres;

COMMENT ON VIEW auth.vw_user_roles IS
'Active user-to-role assignments for Admin-Web user management and authorization inspection.';


-- ------------------------------------------------------------
-- View: auth.vw_user_permissions
-- Purpose:
-- One row per active user permission.
-- This is the main permission-checking view for API/Admin-Web.
-- ------------------------------------------------------------

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

    STRING_AGG(DISTINCT r.role_code, ', ' ORDER BY r.role_code) AS granted_through_roles
FROM auth.users u
JOIN auth.user_roles ur
    ON ur.user_id = u.user_id
JOIN auth.roles r
    ON r.role_id = ur.role_id
JOIN auth.role_permissions rp
    ON rp.role_id = r.role_id
JOIN auth.permissions p
    ON p.permission_id = rp.permission_id
WHERE u.status = 'ACTIVE'
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
    p.description;

ALTER VIEW auth.vw_user_permissions OWNER TO postgres;

COMMENT ON VIEW auth.vw_user_permissions IS
'Resolved active permissions by user. Intended for API/Admin-Web authorization checks.';


-- ------------------------------------------------------------
-- View: auth.vw_active_sessions
-- Purpose:
-- Shows currently active, unexpired, non-revoked sessions.
-- Does not expose token hashes.
-- ------------------------------------------------------------

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

    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP))::BIGINT AS seconds_until_expiry
FROM auth.sessions s
JOIN auth.users u
    ON u.user_id = s.user_id
WHERE s.revoked_at IS NULL
  AND s.expires_at > CURRENT_TIMESTAMP
  AND u.status = 'ACTIVE';

ALTER VIEW auth.vw_active_sessions OWNER TO postgres;

COMMENT ON VIEW auth.vw_active_sessions IS
'Currently active, non-revoked, unexpired user sessions. Token hashes are intentionally excluded.';


-- ------------------------------------------------------------
-- View: auth.vw_script_execution_recent
-- Purpose:
-- Friendly script execution history for Admin-Web.
-- Does not limit rows; consumers should ORDER/LIMIT as needed.
-- ------------------------------------------------------------

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
    sel.metadata
FROM auth.script_execution_log sel
LEFT JOIN auth.users u
    ON u.user_id = sel.user_id;

ALTER VIEW auth.vw_script_execution_recent OWNER TO postgres;

COMMENT ON VIEW auth.vw_script_execution_recent IS
'Readable script execution history for Admin-Web, API, worker jobs, and future automation monitoring.';


-- ------------------------------------------------------------
-- View: auth.vw_login_events_recent
-- Purpose:
-- Friendly login attempt history.
-- Useful for security review and Admin-Web account diagnostics.
-- ------------------------------------------------------------

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
    le.created_at
FROM auth.login_events le
LEFT JOIN auth.users u
    ON u.user_id = le.user_id;

ALTER VIEW auth.vw_login_events_recent OWNER TO postgres;

COMMENT ON VIEW auth.vw_login_events_recent IS
'Readable login attempt history, including successful and failed login events.';


-- ------------------------------------------------------------
-- View: auth.vw_audit_events_recent
-- Purpose:
-- Friendly audit event history.
-- Useful for Admin-Web audit screens and operational traceability.
-- ------------------------------------------------------------

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
    ae.created_at
FROM auth.audit_events ae
LEFT JOIN auth.users u
    ON u.user_id = ae.user_id;

ALTER VIEW auth.vw_audit_events_recent OWNER TO postgres;

COMMENT ON VIEW auth.vw_audit_events_recent IS
'Readable audit event history for Admin-Web, API activity, script execution, authorization events, and operational workflows.';
