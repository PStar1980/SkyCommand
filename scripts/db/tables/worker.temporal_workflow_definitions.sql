-- Table: worker.temporal_workflow_definitions
-- Purpose: Approved Temporal workflow templates exposed by SkyServer Core/API.

CREATE TABLE IF NOT EXISTS worker.temporal_workflow_definitions (
  definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_code TEXT NOT NULL UNIQUE,
  workflow_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,

  task_queue_name TEXT,
  task_queue_config_key TEXT NOT NULL DEFAULT 'TEMPORAL_TASK_QUEUE',
  workflow_id_prefix TEXT NOT NULL,
  run_source_default TEXT NOT NULL DEFAULT 'api_manual',

  default_timeout_ms INTEGER NOT NULL DEFAULT 1800000 CHECK (default_timeout_ms > 0),
  max_timeout_ms INTEGER NOT NULL DEFAULT 86400000 CHECK (max_timeout_ms > 0),
  default_concurrency INTEGER CHECK (default_concurrency IS NULL OR default_concurrency > 0),
  max_concurrency INTEGER CHECK (max_concurrency IS NULL OR max_concurrency > 0),

  start_permission_code TEXT,
  cancel_permission_code TEXT,
  terminate_permission_code TEXT,

  visible_in_admin BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT temporal_workflow_definitions_code_not_blank CHECK (btrim(workflow_code) <> ''),
  CONSTRAINT temporal_workflow_definitions_type_not_blank CHECK (btrim(workflow_type) <> ''),
  CONSTRAINT temporal_workflow_definitions_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT temporal_workflow_definitions_prefix_not_blank CHECK (btrim(workflow_id_prefix) <> ''),
  CONSTRAINT temporal_workflow_definitions_config_object CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT temporal_workflow_definitions_timeout_bounds CHECK (max_timeout_ms >= default_timeout_ms),
  CONSTRAINT temporal_workflow_definitions_concurrency_bounds CHECK (
    default_concurrency IS NULL
    OR max_concurrency IS NULL
    OR max_concurrency >= default_concurrency
  )
);

ALTER TABLE worker.temporal_workflow_definitions OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_temporal_workflow_definitions_enabled
  ON worker.temporal_workflow_definitions (enabled, visible_in_admin, workflow_code);

COMMENT ON TABLE worker.temporal_workflow_definitions IS 'Approved Temporal workflow templates that SkyServer Core/API may expose to Admin-Web and other clients.';
COMMENT ON COLUMN worker.temporal_workflow_definitions.workflow_code IS 'Stable SkyServer template code, such as fred-ingestion.';
COMMENT ON COLUMN worker.temporal_workflow_definitions.workflow_type IS 'Temporal workflow type registered by a worker, such as fredIngestionWorkflow.';
COMMENT ON COLUMN worker.temporal_workflow_definitions.config IS 'Template-specific configuration reserved for future engines, schedules, and Admin-Web rendering hints.';
