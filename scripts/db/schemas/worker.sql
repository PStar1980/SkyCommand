-- Schema: worker
-- Purpose: Background worker, schedule, listener, and event orchestration schema.

CREATE SCHEMA IF NOT EXISTS worker;

ALTER SCHEMA worker OWNER TO postgres;

COMMENT ON SCHEMA worker IS 'SkyServer background worker schema for schedules, listener events, worker heartbeats, and schedule run history.';
