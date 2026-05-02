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

ALTER TABLE auth.audit_events OWNER TO postgres;
