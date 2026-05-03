-- ------------------------------------------------------------
-- View: auth.vw_login_events_recent
-- Purpose:
-- Friendly login attempt history.
-- Useful for security review and Admin-Web account diagnostics.
-- ------------------------------------------------------------

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
    le.created_at
FROM auth.login_events le
LEFT JOIN auth.users u
    ON u.user_id = le.user_id;

ALTER VIEW auth.vw_login_events_recent OWNER TO postgres;

COMMENT ON VIEW auth.vw_login_events_recent IS
'Readable login attempt history, including successful and failed login events.';
