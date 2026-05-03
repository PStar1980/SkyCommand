-- ------------------------------------------------------------
-- View: auth.vw_active_sessions
-- Purpose:
-- Shows currently active, unexpired, non-revoked sessions.
-- Does not expose token hashes.
-- ------------------------------------------------------------

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

    EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP))::BIGINT AS seconds_until_expiry
FROM auth.sessions s
JOIN auth.users u
    ON u.user_id = s.user_id
WHERE s.revoked_at IS NULL
  AND s.expires_at > CURRENT_TIMESTAMP
  AND u.status = 'ACTIVE';

ALTER VIEW auth.vw_active_sessions OWNER TO postgres;

COMMENT ON VIEW auth.vw_active_sessions IS
'Currently active, non-revoked, unexpired user sessions. Token hashes are intentionally excluded.';
