BEGIN;

ALTER TABLE core.repositories
  ADD COLUMN IF NOT EXISTS is_skycommand_repository BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN core.repositories.is_skycommand_repository IS
  'Designates the single repository whose active profile path is the trusted SkyCommand managed-file root.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_repositories_single_skycommand_repository
  ON core.repositories ((is_skycommand_repository))
  WHERE is_skycommand_repository = TRUE;

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
  r.is_skycommand_repository
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
