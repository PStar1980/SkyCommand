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

ALTER TABLE auth.roles OWNER TO postgres;
