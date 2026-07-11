-- Table: worker.workflow_definitions
-- Purpose: User/config-defined SkyServer workflow orchestration containers.

CREATE TABLE IF NOT EXISTS worker.workflow_definitions (
  workflow_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'INACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  visible_in_admin BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_permission_code TEXT,
  cancel_permission_code TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_definitions_code_not_blank CHECK (btrim(workflow_code) <> ''),
  CONSTRAINT workflow_definitions_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT workflow_definitions_config_object CHECK (jsonb_typeof(config) = 'object')
);

ALTER TABLE worker.workflow_definitions OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_status_enabled
  ON worker.workflow_definitions (status, enabled, visible_in_admin, workflow_code);

COMMENT ON TABLE worker.workflow_definitions IS 'SkyServer workflow definitions. These are user/config-defined orchestration graphs, not raw Temporal workflow types.';
