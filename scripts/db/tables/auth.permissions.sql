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
'Atomic permissions used to authorize Admin-Web, API, SkyCommand Core, database, ingestion, Git, and automation operations.';

ALTER TABLE auth.permissions OWNER TO postgres;
