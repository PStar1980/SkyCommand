-- ------------------------------------------------------------
-- View: auth.vw_audit_events_recent
-- Purpose:
-- Friendly audit event history.
-- Useful for Admin-Web audit screens and operational traceability.
-- ------------------------------------------------------------

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
    ae.created_at
FROM auth.audit_events ae
LEFT JOIN auth.users u
    ON u.user_id = ae.user_id;

ALTER VIEW auth.vw_audit_events_recent OWNER TO postgres;

COMMENT ON VIEW auth.vw_audit_events_recent IS
'Readable audit event history for Admin-Web, API activity, script execution, authorization events, and operational workflows.';
