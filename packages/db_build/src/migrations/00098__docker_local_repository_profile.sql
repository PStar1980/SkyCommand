-- Migration: 00098__docker_local_repository_profile.sql
-- Purpose: Add a Docker-local repository profile that maps the Windows SkyEco
--          workspace into the canonical Linux container mount.

BEGIN;

INSERT INTO core.config_profiles (
  profile_code,
  profile_name,
  description,
  active
)
VALUES (
  'DOCKER_LOCAL',
  'Docker Local Development',
  'Local Docker worker profile mounted beneath /workspace/SkyEco System.',
  TRUE
)
ON CONFLICT (profile_code) DO UPDATE
SET profile_name = EXCLUDED.profile_name,
    description = EXCLUDED.description,
    active = EXCLUDED.active;

WITH source_paths AS (
  SELECT
    rp.repo_id,
    rp.active,
    replace(rp.root_path, E'\\', '/') AS normalized_path
  FROM core.repository_paths rp
  JOIN core.config_profiles cp
    ON cp.profile_id = rp.profile_id
  WHERE cp.profile_code = 'DEV_LOCAL'
), translated_paths AS (
  SELECT
    repo_id,
    active,
    '/workspace' || substring(
      normalized_path
      FROM position('/skyeco system/' IN lower(normalized_path))
    ) AS root_path
  FROM source_paths
  WHERE position('/skyeco system/' IN lower(normalized_path)) > 0
)
INSERT INTO core.repository_paths (
  repo_id,
  profile_id,
  root_path,
  active
)
SELECT
  translated.repo_id,
  docker_profile.profile_id,
  translated.root_path,
  translated.active
FROM translated_paths translated
CROSS JOIN core.config_profiles docker_profile
WHERE docker_profile.profile_code = 'DOCKER_LOCAL'
ON CONFLICT (repo_id, profile_id) DO UPDATE
SET root_path = EXCLUDED.root_path,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

DO $$
DECLARE
  skycommand_path TEXT;
BEGIN
  SELECT rp.root_path
  INTO skycommand_path
  FROM core.repository_paths rp
  JOIN core.repositories r
    ON r.repo_id = rp.repo_id
  JOIN core.config_profiles cp
    ON cp.profile_id = rp.profile_id
  WHERE r.repo_code = 'SkyCommand'
    AND cp.profile_code = 'DOCKER_LOCAL';

  IF skycommand_path IS NULL THEN
    RAISE EXCEPTION 'DOCKER_LOCAL migration could not derive the SkyCommand repository path from DEV_LOCAL.';
  END IF;

  IF skycommand_path NOT LIKE '/workspace/SkyEco System/%' THEN
    RAISE EXCEPTION 'Unexpected DOCKER_LOCAL SkyCommand path: %', skycommand_path;
  END IF;
END $$;

COMMIT;
