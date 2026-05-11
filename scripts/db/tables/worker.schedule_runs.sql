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
