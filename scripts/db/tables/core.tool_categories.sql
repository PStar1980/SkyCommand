-- Table: core.tool_categories
-- Purpose: Stores configured tool menu categories.

CREATE TABLE IF NOT EXISTS core.tool_categories (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES core.applications(app_id) ON DELETE CASCADE,
  category_code TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (app_id, category_code)
);

ALTER TABLE core.tool_categories OWNER TO postgres;

COMMENT ON TABLE core.tool_categories IS 'Tool categories used by SkyServer Core CLI and Admin-Web manifests.';
