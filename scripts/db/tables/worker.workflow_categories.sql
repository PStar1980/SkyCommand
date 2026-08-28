-- Table: worker.workflow_categories
-- Purpose: First-class catalogue categories for SkyCommand workflow definitions.

CREATE TABLE IF NOT EXISTS worker.workflow_categories (
  workflow_category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 100 CHECK (display_order >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_categories_code_not_blank CHECK (btrim(category_code) <> ''),
  CONSTRAINT workflow_categories_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT workflow_categories_config_object CHECK (jsonb_typeof(config) = 'object')
);

ALTER TABLE worker.workflow_categories OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_categories_enabled_order
  ON worker.workflow_categories (enabled, display_order, display_name, category_code);

COMMENT ON TABLE worker.workflow_categories IS 'First-class catalogue categories used to organize SkyCommand workflow definitions independently from executable graph/version semantics.';
