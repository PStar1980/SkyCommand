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
'User-to-role assignments for SkyCommand RBAC authorization.';

ALTER TABLE auth.user_roles OWNER TO postgres;
