-- View: auth.vw_script_execution_recent
-- Purpose: Phase 8.6 app-aware auth view.

CREATE OR REPLACE VIEW auth.vw_script_execution_recent
AS
SELECT
    sel.execution_id,

    sel.user_id,
    u.email,
    u.username,
    u.display_name,

    sel.session_id,

    sel.script_name,
    sel.script_file,
    sel.category,
    sel.parameters,

    sel.status,
    sel.exit_code,

    sel.started_at,
    sel.finished_at,

    sel.duration_ms,
    ROUND(
        (
            COALESCE(
                sel.duration_ms::NUMERIC,
                EXTRACT(EPOCH FROM (COALESCE(sel.finished_at, CURRENT_TIMESTAMP) - sel.started_at)) * 1000
            ) / 1000
        ),
        3
    ) AS duration_seconds,

    sel.stdout_path,
    sel.stderr_path,
    sel.summary,
    sel.metadata,

    sel.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.script_execution_log sel
LEFT JOIN auth.users u
    ON u.user_id = sel.user_id
LEFT JOIN core.applications app
    ON app.app_id = sel.app_id;

ALTER VIEW auth.vw_script_execution_recent OWNER TO postgres;
