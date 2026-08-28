-- ============================================================
-- Migration: 00107__workflow_category_foundation.sql
-- Purpose:
-- Adds first-class workflow categories without changing workflow
-- execution/version semantics. Existing workflows are safely
-- assigned to GENERAL until the companion seed reclassifies them.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS worker;

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

CREATE INDEX IF NOT EXISTS idx_workflow_categories_enabled_order
  ON worker.workflow_categories (enabled, display_order, display_name, category_code);

DROP TRIGGER IF EXISTS workflow_categories_set_updated_at ON worker.workflow_categories;
CREATE TRIGGER workflow_categories_set_updated_at
BEFORE UPDATE ON worker.workflow_categories
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

INSERT INTO worker.workflow_categories (
  category_code,
  display_name,
  description,
  display_order,
  enabled,
  config
)
VALUES (
  'GENERAL',
  'General',
  'Default category for workflows that have not been assigned to a more specific catalogue group.',
  999,
  TRUE,
  '{"systemDefault":true}'::jsonb
)
ON CONFLICT (category_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    enabled = TRUE,
    config = worker.workflow_categories.config || EXCLUDED.config;

ALTER TABLE worker.workflow_definitions
  ADD COLUMN IF NOT EXISTS workflow_category_id UUID;

UPDATE worker.workflow_definitions definition
SET workflow_category_id = category.workflow_category_id
FROM worker.workflow_categories category
WHERE definition.workflow_category_id IS NULL
  AND category.category_code = 'GENERAL';

ALTER TABLE worker.workflow_definitions
  ALTER COLUMN workflow_category_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflow_definitions_workflow_category_fk'
      AND conrelid = 'worker.workflow_definitions'::regclass
  ) THEN
    ALTER TABLE worker.workflow_definitions
      ADD CONSTRAINT workflow_definitions_workflow_category_fk
      FOREIGN KEY (workflow_category_id)
      REFERENCES worker.workflow_categories(workflow_category_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_category_status
  ON worker.workflow_definitions (
    workflow_category_id,
    status,
    enabled,
    visible_in_admin,
    workflow_code
  );

CREATE OR REPLACE VIEW worker.vw_workflow_definitions AS
WITH version_counts AS (
  SELECT
    workflow_definition_id,
    COUNT(*)::INTEGER AS version_count,
    MAX(version_number) AS latest_version_number,
    MAX(version_number) FILTER (WHERE status = 'PUBLISHED') AS published_version_number
  FROM worker.workflow_versions
  GROUP BY workflow_definition_id
), graph_counts AS (
  SELECT
    v.workflow_definition_id,
    v.workflow_version_id,
    COUNT(DISTINCT n.workflow_node_id)::INTEGER AS node_count,
    COUNT(DISTINCT e.workflow_edge_id)::INTEGER AS edge_count
  FROM worker.workflow_versions v
  LEFT JOIN worker.workflow_nodes n
    ON n.workflow_version_id = v.workflow_version_id
  LEFT JOIN worker.workflow_edges e
    ON e.workflow_version_id = v.workflow_version_id
  GROUP BY v.workflow_definition_id, v.workflow_version_id
)
SELECT
  d.workflow_definition_id,
  d.workflow_code,
  d.display_name,
  d.description,
  d.status,
  d.visible_in_admin,
  d.enabled,
  d.start_permission_code,
  d.cancel_permission_code,
  d.config,
  d.created_by_user_id,
  creator.email AS created_by_email,
  creator.display_name AS created_by_display_name,
  d.updated_by_user_id,
  updater.email AS updated_by_email,
  updater.display_name AS updated_by_display_name,
  d.created_at,
  d.updated_at,
  COALESCE(vc.version_count, 0) AS version_count,
  vc.latest_version_number,
  vc.published_version_number,
  latest.workflow_version_id AS latest_version_id,
  published.workflow_version_id AS published_version_id,
  COALESCE(latest_counts.node_count, 0) AS latest_node_count,
  COALESCE(latest_counts.edge_count, 0) AS latest_edge_count,
  COALESCE(published_counts.node_count, 0) AS published_node_count,
  COALESCE(published_counts.edge_count, 0) AS published_edge_count,
  d.workflow_category_id,
  category.category_code,
  category.display_name AS category_display_name,
  category.description AS category_description,
  category.display_order AS category_display_order,
  category.enabled AS category_enabled
FROM worker.workflow_definitions d
JOIN worker.workflow_categories category
  ON category.workflow_category_id = d.workflow_category_id
LEFT JOIN version_counts vc
  ON vc.workflow_definition_id = d.workflow_definition_id
LEFT JOIN worker.workflow_versions latest
  ON latest.workflow_definition_id = d.workflow_definition_id
 AND latest.version_number = vc.latest_version_number
LEFT JOIN worker.workflow_versions published
  ON published.workflow_definition_id = d.workflow_definition_id
 AND published.version_number = vc.published_version_number
LEFT JOIN graph_counts latest_counts
  ON latest_counts.workflow_version_id = latest.workflow_version_id
LEFT JOIN graph_counts published_counts
  ON published_counts.workflow_version_id = published.workflow_version_id
LEFT JOIN auth.users creator
  ON creator.user_id = d.created_by_user_id
LEFT JOIN auth.users updater
  ON updater.user_id = d.updated_by_user_id;

ALTER TABLE worker.workflow_categories OWNER TO postgres;
ALTER VIEW worker.vw_workflow_definitions OWNER TO postgres;

COMMENT ON TABLE worker.workflow_categories IS 'First-class catalogue categories used to organize SkyCommand workflow definitions independently from executable graph/version semantics.';
COMMENT ON COLUMN worker.workflow_definitions.workflow_category_id IS 'Primary catalogue category for this workflow definition. Category changes do not create workflow graph versions.';
COMMENT ON VIEW worker.vw_workflow_definitions IS 'SkyCommand workflow definitions with category metadata, version counts, and graph summary counts.';
