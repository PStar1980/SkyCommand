-- ============================================================
-- SkyServer Auth Tables
-- ============================================================

-- ------------------------------------------------------------
-- Users
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email TEXT NOT NULL,
    username TEXT,
    display_name TEXT,

    password_hash TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED', 'PENDING')),

    is_system_user BOOLEAN NOT NULL DEFAULT FALSE,

    failed_login_count INTEGER NOT NULL DEFAULT 0
        CHECK (failed_login_count >= 0),

    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    created_by UUID,
    updated_by UUID,

    CONSTRAINT users_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES auth.users (user_id)
        ON DELETE SET NULL,

    CONSTRAINT users_updated_by_fkey
        FOREIGN KEY (updated_by)
        REFERENCES auth.users (user_id)
        ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON auth.users (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
    ON auth.users (LOWER(username))
    WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_status_idx
    ON auth.users (status);

CREATE INDEX IF NOT EXISTS users_last_login_at_idx
    ON auth.users (last_login_at DESC);

COMMENT ON TABLE auth.users IS
'SkyServer user accounts for Admin-Web, API, CLI-adjacent audit ownership, and future service users.';

-- ------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    role_code TEXT NOT NULL UNIQUE
        CHECK (role_code = UPPER(role_code)),

    role_name TEXT NOT NULL,
    description TEXT,

    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS roles_active_idx
    ON auth.roles (active);

COMMENT ON TABLE auth.roles IS
'Named RBAC roles used to group permissions for SkyServer users.';

-- ------------------------------------------------------------
-- Permissions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.permissions (
    permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    permission_code TEXT NOT NULL UNIQUE
        CHECK (permission_code = UPPER(permission_code)),

    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT permissions_resource_action_key
        UNIQUE (resource, action)
);

CREATE INDEX IF NOT EXISTS permissions_active_idx
    ON auth.permissions (active);

CREATE INDEX IF NOT EXISTS permissions_resource_idx
    ON auth.permissions (resource);

COMMENT ON TABLE auth.permissions IS
'Atomic permissions used to authorize Admin-Web, API, SkyServer Core, database, ingestion, Git, and automation operations.';

-- ------------------------------------------------------------
-- User Roles
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.user_roles (
    user_id UUID NOT NULL,
    role_id UUID NOT NULL,

    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    PRIMARY KEY (user_id, role_id),

    CONSTRAINT user_roles_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES auth.users (user_id)
        ON DELETE CASCADE,

    CONSTRAINT user_roles_role_id_fkey
        FOREIGN KEY (role_id)
        REFERENCES auth.roles (role_id)
        ON DELETE CASCADE,

    CONSTRAINT user_roles_assigned_by_fkey
        FOREIGN KEY (assigned_by)
        REFERENCES auth.users (user_id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS user_roles_role_id_idx
    ON auth.user_roles (role_id);

CREATE INDEX IF NOT EXISTS user_roles_active_idx
    ON auth.user_roles (active);

COMMENT ON TABLE auth.user_roles IS
'User-to-role assignments for SkyServer RBAC authorization.';

-- ------------------------------------------------------------
-- Role Permissions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.role_permissions (
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,

    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by UUID,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    PRIMARY KEY (role_id, permission_id),

    CONSTRAINT role_permissions_role_id_fkey
        FOREIGN KEY (role_id)
        REFERENCES auth.roles (role_id)
        ON DELETE CASCADE,

    CONSTRAINT role_permissions_permission_id_fkey
        FOREIGN KEY (permission_id)
        REFERENCES auth.permissions (permission_id)
        ON DELETE CASCADE,

    CONSTRAINT role_permissions_granted_by_fkey
        FOREIGN KEY (granted_by)
        REFERENCES auth.users (user_id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS role_permissions_permission_id_idx
    ON auth.role_permissions (permission_id);

CREATE INDEX IF NOT EXISTS role_permissions_active_idx
    ON auth.role_permissions (active);

COMMENT ON TABLE auth.role_permissions IS
'Role-to-permission assignments for SkyServer RBAC authorization.';

-- ------------------------------------------------------------
-- Sessions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL,

    session_token_hash TEXT NOT NULL UNIQUE,
    refresh_token_hash TEXT UNIQUE,

    ip_address INET,
    user_agent TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ,

    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,

    CONSTRAINT sessions_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES auth.users (user_id)
        ON DELETE CASCADE,

    CONSTRAINT sessions_expires_after_created_check
        CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx
    ON auth.sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
    ON auth.sessions (expires_at);

CREATE INDEX IF NOT EXISTS sessions_active_idx
    ON auth.sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE auth.sessions IS
'Authenticated user sessions. Stores token hashes only, never raw tokens.';

-- ------------------------------------------------------------
-- Login Events
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.login_events (
    login_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID,
    session_id UUID,

    email_attempted TEXT,
    success BOOLEAN NOT NULL,
    failure_reason TEXT,

    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT login_events_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES auth.users (user_id)
        ON DELETE SET NULL,

    CONSTRAINT login_events_session_id_fkey
        FOREIGN KEY (session_id)
        REFERENCES auth.sessions (session_id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS login_events_user_id_created_at_idx
    ON auth.login_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS login_events_email_attempted_idx
    ON auth.login_events (LOWER(email_attempted), created_at DESC)
    WHERE email_attempted IS NOT NULL;

CREATE INDEX IF NOT EXISTS login_events_success_created_at_idx
    ON auth.login_events (success, created_at DESC);

COMMENT ON TABLE auth.login_events IS
'Login attempts, including successful and failed authentication attempts.';

-- ------------------------------------------------------------
-- Audit Events
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.audit_events (
    audit_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID,

    event_type TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    action TEXT NOT NULL,

    success BOOLEAN NOT NULL,
    message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT audit_events_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES auth.users (user_id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
    ON auth.audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_user_id_created_at_idx
    ON auth.audit_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_event_type_idx
    ON auth.audit_events (event_type);

CREATE INDEX IF NOT EXISTS audit_events_resource_idx
    ON auth.audit_events (resource_type, resource_id);

COMMENT ON TABLE auth.audit_events IS
'General audit event log for login activity, admin actions, authorization events, script execution, database actions, and operational workflows.';

-- ------------------------------------------------------------
-- Script Execution Log
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.script_execution_log (
    execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID,
    session_id UUID,

    script_name TEXT NOT NULL,
    script_file TEXT,
    category TEXT,

    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,

    status TEXT NOT NULL DEFAULT 'STARTED'
        CHECK (status IN ('STARTED', 'SUCCESS', 'FAILED', 'CANCELLED')),

    exit_code INTEGER,

    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,

    duration_ms BIGINT
        CHECK (duration_ms IS NULL OR duration_ms >= 0),

    stdout_path TEXT,
    stderr_path TEXT,

    summary TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT script_execution_log_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES auth.users (user_id)
        ON DELETE SET NULL,

    CONSTRAINT script_execution_log_session_id_fkey
        FOREIGN KEY (session_id)
        REFERENCES auth.sessions (session_id)
        ON DELETE SET NULL,

    CONSTRAINT script_execution_log_finished_after_started_check
        CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS script_execution_log_started_at_idx
    ON auth.script_execution_log (started_at DESC);

CREATE INDEX IF NOT EXISTS script_execution_log_user_id_started_at_idx
    ON auth.script_execution_log (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS script_execution_log_status_idx
    ON auth.script_execution_log (status);

CREATE INDEX IF NOT EXISTS script_execution_log_script_name_idx
    ON auth.script_execution_log (script_name);

COMMENT ON TABLE auth.script_execution_log IS
'Detailed execution history for scripts launched through SkyServer Core, Admin-Web, API, worker jobs, or future automation listeners.';

-- ------------------------------------------------------------
-- Updated-at Trigger Function
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- Updated-at Triggers
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS users_set_updated_at ON auth.users;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();

DROP TRIGGER IF EXISTS roles_set_updated_at ON auth.roles;

CREATE TRIGGER roles_set_updated_at
BEFORE UPDATE ON auth.roles
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();

DROP TRIGGER IF EXISTS permissions_set_updated_at ON auth.permissions;

CREATE TRIGGER permissions_set_updated_at
BEFORE UPDATE ON auth.permissions
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();

-- ------------------------------------------------------------
-- Ownership
-- ------------------------------------------------------------

ALTER TABLE auth.users OWNER TO postgres;
ALTER TABLE auth.roles OWNER TO postgres;
ALTER TABLE auth.permissions OWNER TO postgres;
ALTER TABLE auth.user_roles OWNER TO postgres;
ALTER TABLE auth.role_permissions OWNER TO postgres;
ALTER TABLE auth.sessions OWNER TO postgres;
ALTER TABLE auth.login_events OWNER TO postgres;
ALTER TABLE auth.audit_events OWNER TO postgres;
ALTER TABLE auth.script_execution_log OWNER TO postgres;

ALTER FUNCTION auth.set_updated_at() OWNER TO postgres;
