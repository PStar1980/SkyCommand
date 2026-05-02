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

ALTER TABLE auth.sessions OWNER TO postgres;
