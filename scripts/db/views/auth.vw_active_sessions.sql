-- View: auth.vw_active_sessions
-- Purpose: Phase 8.6 app-aware auth view.

CREATE OR REPLACE VIEW auth.vw_active_sessions
AS
SELECT
    s.session_id,
    s.user_id,

    u.email,
    u.username,
    u.display_name,
    u.status AS user_status,

    s.ip_address,
    s.user_agent,
    s.metadata,

    s.created_at,
    s.expires_at,
    s.last_seen_at,

    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP))::BIGINT AS seconds_until_expiry,

    s.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.sessions s
JOIN auth.users u
    ON u.user_id = s.user_id
JOIN core.applications app
    ON app.app_id = s.app_id
JOIN auth.user_applications ua
    ON ua.user_id = u.user_id
   AND ua.app_id = s.app_id
WHERE s.revoked_at IS NULL
  AND s.expires_at > CURRENT_TIMESTAMP
  AND u.status = 'ACTIVE'
  AND ua.status = 'ACTIVE'
  AND app.active = TRUE;

ALTER VIEW auth.vw_active_sessions OWNER TO postgres;
