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

ALTER TABLE auth.role_permissions OWNER TO postgres;
