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

ALTER TABLE auth.script_execution_log OWNER TO postgres;
