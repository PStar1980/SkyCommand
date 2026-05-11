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
