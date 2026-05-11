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
