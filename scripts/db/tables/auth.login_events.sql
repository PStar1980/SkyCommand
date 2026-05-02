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

ALTER TABLE auth.login_events OWNER TO postgres;
