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
'SkyCommand user accounts for Admin-Web, API, CLI-adjacent audit ownership, and future service users.';

ALTER TABLE auth.users OWNER TO postgres;
