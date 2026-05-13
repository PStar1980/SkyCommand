-- View: auth.vw_audit_events_recent
-- Purpose: Phase 8.6 app-aware auth view.

CREATE OR REPLACE VIEW auth.vw_audit_events_recent
AS
SELECT
    ae.audit_event_id,

    ae.user_id,
    u.email,
    u.username,
    u.display_name,

    ae.event_type,
    ae.resource_type,
    ae.resource_id,
    ae.action,
    ae.success,
    ae.message,
    ae.metadata,

    ae.ip_address,
    ae.user_agent,
    ae.created_at,

    ae.app_id,
    app.app_code,
    app.title AS app_title
FROM auth.audit_events ae
LEFT JOIN auth.users u
    ON u.user_id = ae.user_id
LEFT JOIN core.applications app
    ON app.app_id = ae.app_id;

ALTER VIEW auth.vw_audit_events_recent OWNER TO postgres;
