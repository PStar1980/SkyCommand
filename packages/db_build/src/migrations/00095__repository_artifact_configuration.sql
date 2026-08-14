-- ============================================================
-- Migration: 00095__repository_artifact_configuration.sql
-- Purpose:
--   Stores repository-specific output artifact configuration for the
--   Generate Repository Map and Generate Repository Zip tools. Tool/workflow
--   parameter binding is intentionally deferred to a later integration step.
-- ============================================================

BEGIN;

ALTER TABLE core.repositories
  ADD COLUMN IF NOT EXISTS repo_map_file_name TEXT,
  ADD COLUMN IF NOT EXISTS repo_map_output_path TEXT,
  ADD COLUMN IF NOT EXISTS repo_zip_file_name TEXT,
  ADD COLUMN IF NOT EXISTS repo_zip_output_path TEXT;

COMMENT ON COLUMN core.repositories.repo_map_file_name IS
  'Configured output file name for the Generate Repository Map tool.';
COMMENT ON COLUMN core.repositories.repo_map_output_path IS
  'Configured output directory for the Generate Repository Map tool; NULL allows the repository root to be used later by tool integration.';
COMMENT ON COLUMN core.repositories.repo_zip_file_name IS
  'Configured output archive file name for the Generate Repository Zip tool.';
COMMENT ON COLUMN core.repositories.repo_zip_output_path IS
  'Configured output directory for the Generate Repository Zip tool; NULL allows the repository root to be used later by tool integration.';

-- Extend the active repository/profile view now so the next integration step can
-- consume repository roots and generated-artifact configuration through one seam.
CREATE OR REPLACE VIEW core.vw_repository_paths AS
SELECT
  cp.profile_code,
  cp.profile_name,
  r.repo_id,
  r.repo_code,
  r.repo_name,
  r.remote_url,
  r.main_branch,
  r.dev_branch,
  r.display_order,
  rp.root_path,
  r.active AS repo_active,
  rp.active AS path_active,
  r.is_skycommand_repository,
  r.repo_map_file_name,
  r.repo_map_output_path,
  r.repo_zip_file_name,
  r.repo_zip_output_path
FROM core.repositories r
JOIN core.repository_paths rp
  ON rp.repo_id = r.repo_id
JOIN core.config_profiles cp
  ON cp.profile_id = rp.profile_id
WHERE r.active = TRUE
  AND rp.active = TRUE
  AND cp.active = TRUE;

ALTER VIEW core.vw_repository_paths OWNER TO postgres;

COMMIT;
