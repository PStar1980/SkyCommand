-- View: auth.vw_login_events_recent
-- Purpose: Phase 8.6 app-aware auth view.

CREATE OR REPLACE VIEW auth.vw_login_events_recent
AS
SELECT
    le.login_event_id,

    le.user_id,
    u.email AS matched_user_email,
    u.username,
    u.display_name,

    le.session_id,
    le.email_attempted,
    le.success,
    le.failure_reason,

    le.ip_address,
    le.user_agent,
    le.created_at,

    le.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.login_events le
LEFT JOIN auth.users u
    ON u.user_id = le.user_id
LEFT JOIN core.applications app
    ON app.app_id = le.app_id;

ALTER VIEW auth.vw_login_events_recent OWNER TO postgres;
