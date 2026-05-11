-- Migration: 00020__worker_tables.sql
-- Purpose: Creates worker schema, tables, triggers, and views for scheduled/background execution and future listener workflows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;



-- Schema: worker
-- Purpose: Background worker, schedule, listener, and event orchestration schema.

CREATE SCHEMA IF NOT EXISTS worker;

ALTER SCHEMA worker OWNER TO postgres;

COMMENT ON SCHEMA worker IS 'SkyServer background worker schema for schedules, listener events, worker heartbeats, and schedule run history.';


-- Function: worker.set_updated_at
-- Purpose: Shared trigger function for maintaining updated_at timestamps in worker schema tables.

CREATE OR REPLACE FUNCTION worker.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION worker.set_updated_at() OWNER TO postgres;


-- Table: worker.worker_nodes
-- Purpose: Tracks active/background worker processes and heartbeat state.

CREATE TABLE IF NOT EXISTS worker.worker_nodes (
  worker_node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_name TEXT NOT NULL UNIQUE,
  process_id INTEGER,
  hostname TEXT,
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'ONLINE'
    CHECK (status IN ('ONLINE', 'OFFLINE', 'STOPPING', 'ERROR')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE worker.worker_nodes OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_worker_nodes_status_heartbeat
  ON worker.worker_nodes (status, last_heartbeat_at DESC);

COMMENT ON TABLE worker.worker_nodes IS 'Registered SkyServer worker processes with heartbeat timestamps and runtime metadata.';
COMMENT ON COLUMN worker.worker_nodes.node_name IS 'Stable worker node identifier, normally hostname plus process id or an explicit WORKER_NODE_NAME.';


-- Table: worker.schedules
-- Purpose: Stores database-configured schedules that execute existing core.tools entries.

CREATE TABLE IF NOT EXISTS worker.schedules (
  schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_code TEXT NOT NULL UNIQUE,
  schedule_name TEXT NOT NULL,
  description TEXT,

  tool_id UUID NOT NULL REFERENCES core.tools(tool_id),
  profile_id UUID REFERENCES core.config_profiles(profile_id),

  schedule_type TEXT NOT NULL
    CHECK (schedule_type IN ('ONCE', 'INTERVAL', 'CRON')),
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',

  run_at TIMESTAMPTZ,
  interval_value INTEGER CHECK (interval_value IS NULL OR interval_value > 0),
  interval_unit TEXT CHECK (interval_unit IS NULL OR interval_unit IN ('MINUTE', 'HOUR', 'DAY', 'WEEK')),
  cron_expression TEXT,

  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_concurrent_runs INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent_runs > 0),
  misfire_policy TEXT NOT NULL DEFAULT 'RUN_ONCE'
    CHECK (misfire_policy IN ('RUN_ONCE', 'SKIP', 'RUN_ALL')),

  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('QUEUED', 'STARTED', 'SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED')),

  created_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT worker_schedules_code_not_blank CHECK (btrim(schedule_code) <> ''),
  CONSTRAINT worker_schedules_name_not_blank CHECK (btrim(schedule_name) <> ''),
  CONSTRAINT worker_schedules_parameters_object CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT worker_schedules_once_shape CHECK (
    schedule_type <> 'ONCE'
    OR run_at IS NOT NULL
  ),
  CONSTRAINT worker_schedules_interval_shape CHECK (
    schedule_type <> 'INTERVAL'
    OR (interval_value IS NOT NULL AND interval_unit IS NOT NULL)
  ),
  CONSTRAINT worker_schedules_cron_shape CHECK (
    schedule_type <> 'CRON'
    OR NULLIF(btrim(cron_expression), '') IS NOT NULL
  )
);

ALTER TABLE worker.schedules OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_worker_schedules_due
  ON worker.schedules (enabled, next_run_at)
  WHERE enabled = TRUE AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_schedules_tool
  ON worker.schedules (tool_id);

CREATE INDEX IF NOT EXISTS idx_worker_schedules_profile
  ON worker.schedules (profile_id);

COMMENT ON TABLE worker.schedules IS 'Configured scheduled jobs that execute existing core.tools records through the SkyServer worker.';
COMMENT ON COLUMN worker.schedules.parameters IS 'JSON object passed to the target tool as its parameter payload.';
COMMENT ON COLUMN worker.schedules.next_run_at IS 'Next due timestamp used by the worker poller. Null means no pending run.';
COMMENT ON COLUMN worker.schedules.misfire_policy IS 'Initial scheduler policy for missed runs. RUN_ONCE is implemented in v1; RUN_ALL is reserved.';


-- Table: worker.schedule_runs
-- Purpose: Tracks each scheduler-triggered run and links it to auth.script_execution_log.

CREATE TABLE IF NOT EXISTS worker.schedule_runs (
  schedule_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES worker.schedules(schedule_id) ON DELETE CASCADE,
  worker_node_id UUID REFERENCES worker.worker_nodes(worker_node_id) ON DELETE SET NULL,
  execution_id UUID REFERENCES auth.script_execution_log(execution_id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'STARTED', 'SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED')),

  queued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT worker_schedule_runs_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT worker_schedule_runs_finished_after_started CHECK (
    finished_at IS NULL
    OR started_at IS NULL
    OR finished_at >= started_at
  )
);

ALTER TABLE worker.schedule_runs OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_worker_schedule_runs_schedule_started
  ON worker.schedule_runs (schedule_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_schedule_runs_status
  ON worker.schedule_runs (status);

CREATE INDEX IF NOT EXISTS idx_worker_schedule_runs_execution
  ON worker.schedule_runs (execution_id);

COMMENT ON TABLE worker.schedule_runs IS 'Run history for worker.schedules; execution_id links to auth.script_execution_log for stdout/stderr and script lifecycle details.';


-- Table: worker.listeners
-- Purpose: Stores database-configured listener definitions for future event-driven tool execution.

CREATE TABLE IF NOT EXISTS worker.listeners (
  listener_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listener_code TEXT NOT NULL UNIQUE,
  listener_name TEXT NOT NULL,
  description TEXT,

  listener_type TEXT NOT NULL
    CHECK (listener_type IN ('FILE_DROP', 'DB_POLL', 'WEBHOOK')),
  tool_id UUID NOT NULL REFERENCES core.tools(tool_id),
  profile_id UUID REFERENCES core.config_profiles(profile_id),

  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  parameters_template JSONB NOT NULL DEFAULT '{}'::jsonb,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_seconds > 0),

  last_checked_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('DETECTED', 'QUEUED', 'STARTED', 'SUCCESS', 'FAILED', 'IGNORED')),

  created_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT worker_listeners_code_not_blank CHECK (btrim(listener_code) <> ''),
  CONSTRAINT worker_listeners_name_not_blank CHECK (btrim(listener_name) <> ''),
  CONSTRAINT worker_listeners_config_object CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT worker_listeners_template_object CHECK (jsonb_typeof(parameters_template) = 'object')
);

ALTER TABLE worker.listeners OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_worker_listeners_type_enabled
  ON worker.listeners (listener_type, enabled);

CREATE INDEX IF NOT EXISTS idx_worker_listeners_tool
  ON worker.listeners (tool_id);

COMMENT ON TABLE worker.listeners IS 'Event listener definitions. Listener execution is reserved for Phase 8 listener implementation; schema is created now for configuration continuity.';
COMMENT ON COLUMN worker.listeners.config IS 'Listener-specific configuration, such as folder/pattern for FILE_DROP or SQL/watermark for DB_POLL.';
COMMENT ON COLUMN worker.listeners.parameters_template IS 'Base parameter object to merge with listener event payload before tool execution.';


-- Table: worker.listener_events
-- Purpose: Tracks deduplicated events detected by configured listeners.

CREATE TABLE IF NOT EXISTS worker.listener_events (
  listener_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listener_id UUID NOT NULL REFERENCES worker.listeners(listener_id) ON DELETE CASCADE,
  worker_node_id UUID REFERENCES worker.worker_nodes(worker_node_id) ON DELETE SET NULL,
  execution_id UUID REFERENCES auth.script_execution_log(execution_id) ON DELETE SET NULL,

  event_key TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'DETECTED'
    CHECK (status IN ('DETECTED', 'QUEUED', 'STARTED', 'SUCCESS', 'FAILED', 'IGNORED')),

  detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,

  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT worker_listener_events_key_not_blank CHECK (btrim(event_key) <> ''),
  CONSTRAINT worker_listener_events_payload_object CHECK (jsonb_typeof(event_payload) = 'object'),
  CONSTRAINT worker_listener_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (listener_id, event_key)
);

ALTER TABLE worker.listener_events OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_worker_listener_events_listener_detected
  ON worker.listener_events (listener_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_listener_events_status
  ON worker.listener_events (status);

CREATE INDEX IF NOT EXISTS idx_worker_listener_events_execution
  ON worker.listener_events (execution_id);

COMMENT ON TABLE worker.listener_events IS 'Detected listener events with idempotent event_key deduplication and optional link to auth.script_execution_log.';


-- Trigger: worker.worker_nodes_set_updated_at
-- Purpose: Maintains updated_at on worker.worker_nodes.

DROP TRIGGER IF EXISTS worker_nodes_set_updated_at ON worker.worker_nodes;

CREATE TRIGGER worker_nodes_set_updated_at
BEFORE UPDATE ON worker.worker_nodes
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();


-- Trigger: worker.schedules_set_updated_at
-- Purpose: Maintains updated_at on worker.schedules.

DROP TRIGGER IF EXISTS schedules_set_updated_at ON worker.schedules;

CREATE TRIGGER schedules_set_updated_at
BEFORE UPDATE ON worker.schedules
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();


-- Trigger: worker.schedule_runs_set_updated_at
-- Purpose: Maintains updated_at on worker.schedule_runs.

DROP TRIGGER IF EXISTS schedule_runs_set_updated_at ON worker.schedule_runs;

CREATE TRIGGER schedule_runs_set_updated_at
BEFORE UPDATE ON worker.schedule_runs
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();


-- Trigger: worker.listeners_set_updated_at
-- Purpose: Maintains updated_at on worker.listeners.

DROP TRIGGER IF EXISTS listeners_set_updated_at ON worker.listeners;

CREATE TRIGGER listeners_set_updated_at
BEFORE UPDATE ON worker.listeners
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();


-- Trigger: worker.listener_events_set_updated_at
-- Purpose: Maintains updated_at on worker.listener_events.

DROP TRIGGER IF EXISTS listener_events_set_updated_at ON worker.listener_events;

CREATE TRIGGER listener_events_set_updated_at
BEFORE UPDATE ON worker.listener_events
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();


-- View: worker.vw_worker_nodes
-- Purpose: Operational worker node heartbeat view.

CREATE OR REPLACE VIEW worker.vw_worker_nodes AS
SELECT
  worker_node_id,
  node_name,
  process_id,
  hostname,
  app_version,
  status,
  started_at,
  last_heartbeat_at,
  FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_heartbeat_at)))::int AS seconds_since_heartbeat,
  metadata,
  created_at,
  updated_at
FROM worker.worker_nodes;

ALTER VIEW worker.vw_worker_nodes OWNER TO postgres;


-- View: worker.vw_schedules
-- Purpose: Admin-friendly schedule configuration view with tool/profile metadata.

CREATE OR REPLACE VIEW worker.vw_schedules AS
SELECT
  s.schedule_id,
  s.schedule_code,
  s.schedule_name,
  s.description,
  s.schedule_type,
  s.timezone,
  s.run_at,
  s.interval_value,
  s.interval_unit,
  s.cron_expression,
  s.parameters,
  s.enabled,
  s.max_concurrent_runs,
  s.misfire_policy,
  s.next_run_at,
  s.last_run_at,
  s.last_status,
  t.tool_id,
  t.tool_code,
  t.label AS tool_label,
  t.risk_code,
  t.permission_code,
  cp.profile_id,
  cp.profile_code,
  cp.profile_name,
  creator.user_id AS created_by_user_id,
  creator.email AS created_by_email,
  creator.display_name AS created_by_display_name,
  updater.user_id AS updated_by_user_id,
  updater.email AS updated_by_email,
  updater.display_name AS updated_by_display_name,
  s.created_at,
  s.updated_at
FROM worker.schedules s
JOIN core.tools t
  ON t.tool_id = s.tool_id
LEFT JOIN core.config_profiles cp
  ON cp.profile_id = s.profile_id
LEFT JOIN auth.users creator
  ON creator.user_id = s.created_by_user_id
LEFT JOIN auth.users updater
  ON updater.user_id = s.updated_by_user_id;

ALTER VIEW worker.vw_schedules OWNER TO postgres;


-- View: worker.vw_schedule_runs_recent
-- Purpose: Recent scheduler run history with linked script execution metadata.

CREATE OR REPLACE VIEW worker.vw_schedule_runs_recent AS
SELECT
  sr.schedule_run_id,
  sr.schedule_id,
  s.schedule_code,
  s.schedule_name,
  t.tool_code,
  t.label AS tool_label,
  sr.worker_node_id,
  wn.node_name,
  sr.execution_id,
  sr.status,
  sr.queued_at,
  sr.started_at,
  sr.finished_at,
  sr.message,
  sr.metadata,
  el.script_name,
  el.script_file,
  el.category,
  el.parameters AS execution_parameters,
  el.status AS execution_status,
  el.exit_code,
  el.duration_ms,
  el.summary AS execution_summary,
  sr.created_at,
  sr.updated_at
FROM worker.schedule_runs sr
JOIN worker.schedules s
  ON s.schedule_id = sr.schedule_id
JOIN core.tools t
  ON t.tool_id = s.tool_id
LEFT JOIN worker.worker_nodes wn
  ON wn.worker_node_id = sr.worker_node_id
LEFT JOIN auth.script_execution_log el
  ON el.execution_id = sr.execution_id
ORDER BY sr.queued_at DESC;

ALTER VIEW worker.vw_schedule_runs_recent OWNER TO postgres;


-- View: worker.vw_listeners
-- Purpose: Admin-friendly listener configuration view with tool/profile metadata.

CREATE OR REPLACE VIEW worker.vw_listeners AS
SELECT
  l.listener_id,
  l.listener_code,
  l.listener_name,
  l.description,
  l.listener_type,
  l.config,
  l.parameters_template,
  l.enabled,
  l.poll_interval_seconds,
  l.last_checked_at,
  l.last_event_at,
  l.last_status,
  t.tool_id,
  t.tool_code,
  t.label AS tool_label,
  t.risk_code,
  t.permission_code,
  cp.profile_id,
  cp.profile_code,
  cp.profile_name,
  l.created_by_user_id,
  l.updated_by_user_id,
  l.created_at,
  l.updated_at
FROM worker.listeners l
JOIN core.tools t
  ON t.tool_id = l.tool_id
LEFT JOIN core.config_profiles cp
  ON cp.profile_id = l.profile_id;

ALTER VIEW worker.vw_listeners OWNER TO postgres;


-- View: worker.vw_listener_events_recent
-- Purpose: Recent listener event history with linked script execution metadata.

CREATE OR REPLACE VIEW worker.vw_listener_events_recent AS
SELECT
  le.listener_event_id,
  le.listener_id,
  l.listener_code,
  l.listener_name,
  l.listener_type,
  le.worker_node_id,
  wn.node_name,
  le.execution_id,
  le.event_key,
  le.event_payload,
  le.status,
  le.detected_at,
  le.processed_at,
  le.message,
  le.metadata,
  el.script_name,
  el.status AS execution_status,
  el.exit_code,
  el.duration_ms,
  el.summary AS execution_summary,
  le.created_at,
  le.updated_at
FROM worker.listener_events le
JOIN worker.listeners l
  ON l.listener_id = le.listener_id
LEFT JOIN worker.worker_nodes wn
  ON wn.worker_node_id = le.worker_node_id
LEFT JOIN auth.script_execution_log el
  ON el.execution_id = le.execution_id
ORDER BY le.detected_at DESC;

ALTER VIEW worker.vw_listener_events_recent OWNER TO postgres;
