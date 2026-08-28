-- Migration: 00109__workflow_run_category_projection.sql
-- Purpose: Project workflow category metadata into workflow run history.
-- New runs preserve the category snapshot captured at start time; legacy runs
-- fall back to the workflow definition's current category for catalogue usability.

-- PostgreSQL CREATE OR REPLACE VIEW requires existing columns to retain
-- their names and ordinal positions. Category projection columns are therefore
-- appended after the legacy view contract instead of inserted into the middle.

CREATE OR REPLACE VIEW worker.vw_workflow_run_records AS
SELECT
  r.workflow_run_record_id,
  r.workflow_definition_id,
  d.workflow_code AS definition_workflow_code,
  d.display_name AS workflow_display_name,
  r.workflow_version_id,
  v.version_number AS definition_version_number,
  r.workflow_code,
  r.version_number,
  r.run_source,
  r.trigger_type,
  r.status,
  r.temporal_workflow_id,
  r.temporal_run_id,
  r.input,
  r.request_context,
  r.summary,
  r.started_by_user_id,
  u.email AS started_by_email,
  u.display_name AS started_by_display_name,
  r.started_at,
  r.completed_at,
  r.metadata,
  r.created_at,
  r.updated_at,
  COALESCE(
    NULLIF(BTRIM(r.metadata ->> 'workflowCategoryCode'), ''),
    c.category_code,
    'GENERAL'
  ) AS workflow_category_code,
  COALESCE(
    NULLIF(BTRIM(r.metadata ->> 'workflowCategoryDisplayName'), ''),
    c.display_name,
    'General'
  ) AS workflow_category_display_name,
  CASE
    WHEN NULLIF(BTRIM(r.metadata ->> 'workflowCategoryCode'), '') IS NOT NULL THEN 'SNAPSHOT'
    WHEN c.category_code IS NOT NULL THEN 'CURRENT_DEFINITION'
    ELSE 'DEFAULT'
  END AS workflow_category_source
FROM worker.workflow_run_records r
LEFT JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = r.workflow_definition_id
LEFT JOIN worker.workflow_categories c
  ON c.workflow_category_id = d.workflow_category_id
LEFT JOIN worker.workflow_versions v
  ON v.workflow_version_id = r.workflow_version_id
LEFT JOIN auth.users u
  ON u.user_id = r.started_by_user_id;

ALTER VIEW worker.vw_workflow_run_records OWNER TO postgres;

COMMENT ON VIEW worker.vw_workflow_run_records IS
  'SkyCommand workflow run records joined to user, workflow, and category metadata. Category snapshots are preferred; legacy runs fall back to the current workflow category.';
