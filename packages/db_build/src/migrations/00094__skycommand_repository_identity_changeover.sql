-- ============================================================
-- Migration: 00094__skycommand_repository_identity_changeover.sql
-- Purpose:
--   Completes the repository-level SkyServer -> SkyCommand rename while
--   preserving stable repository/application primary keys, permissions,
--   roles, sessions, tool relationships, workflow history, and audit data.
--
-- Compatibility boundary:
--   SKYSERVER_ADMIN, SKYSERVER_CORE, and SKYSERVER_WORKER remain stable
--   PostgreSQL application codes. They are machine identifiers, not current
--   product labels, and changing them would invalidate existing scoped data.
-- ============================================================

BEGIN;

DO $$
DECLARE
  legacy_repo_id core.repositories.repo_id%TYPE;
  canonical_repo_id core.repositories.repo_id%TYPE;
  resolved_repo_id core.repositories.repo_id%TYPE;
BEGIN
  SELECT repo_id
  INTO legacy_repo_id
  FROM core.repositories
  WHERE repo_code = 'SkyServer';

  SELECT repo_id
  INTO canonical_repo_id
  FROM core.repositories
  WHERE repo_code = 'SkyCommand';

  IF legacy_repo_id IS NOT NULL
     AND canonical_repo_id IS NOT NULL
     AND legacy_repo_id <> canonical_repo_id THEN
    RAISE EXCEPTION
      'SkyCommand identity changeover found separate SkyServer (%) and SkyCommand (%) repository rows. Reconcile them before applying migration 00094.',
      legacy_repo_id,
      canonical_repo_id;
  END IF;

  resolved_repo_id := COALESCE(canonical_repo_id, legacy_repo_id);

  IF resolved_repo_id IS NULL THEN
    RAISE EXCEPTION
      'SkyCommand identity changeover could not find a SkyServer or SkyCommand repository row.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM core.repositories
    WHERE is_skycommand_repository = TRUE
      AND repo_id <> resolved_repo_id
  ) THEN
    RAISE EXCEPTION
      'SkyCommand identity changeover found a different repository already designated as the SkyCommand repository.';
  END IF;

  UPDATE core.repositories
  SET repo_code = 'SkyCommand',
      repo_name = 'SkyCommand',
      description = 'SkyCommand workflow automation control plane, administrative application, PostgreSQL platform, ingestion engine, and repository automation hub.',
      remote_url = 'https://github.com/PStar1980/SkyCommand.git',
      is_skycommand_repository = TRUE,
      updated_at = CURRENT_TIMESTAMP
  WHERE repo_id = resolved_repo_id;

  -- Preserve every configured profile while replacing the old physical folder
  -- segment wherever it still exists.
  UPDATE core.repository_paths
  SET root_path = replace(
        root_path,
        $legacy_path$SkyServer System\SkyServer$legacy_path$,
        $canonical_path$SkyCommand System\SkyCommand$canonical_path$
      ),
      updated_at = CURRENT_TIMESTAMP
  WHERE repo_id = resolved_repo_id
    AND root_path LIKE $legacy_like$%SkyServer System\SkyServer%$legacy_like$;

  -- Paul's active local profile is the authoritative development path used by
  -- repository tools, managed onboarding, Dev Commit, and Main Merge.
  UPDATE core.repository_paths rp
  SET root_path = $dev_path$C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyCommand System\SkyCommand$dev_path$,
      active = TRUE,
      updated_at = CURRENT_TIMESTAMP
  FROM core.config_profiles cp
  WHERE rp.profile_id = cp.profile_id
    AND rp.repo_id = resolved_repo_id
    AND cp.profile_code = 'DEV_LOCAL';
END
$$;

-- Keep stable application codes while completing their visible product titles.
UPDATE core.applications
SET title = CASE app_code
      WHEN 'SKYSERVER_ADMIN' THEN 'SkyCommand'
      WHEN 'SKYSERVER_CORE' THEN 'SkyCommand Core'
      WHEN 'SKYSERVER_WORKER' THEN 'SkyCommand Worker'
      ELSE title
    END,
    description = CASE app_code
      WHEN 'SKYSERVER_ADMIN' THEN 'Private SkyCommand administrative web console and workflow automation control plane.'
      WHEN 'SKYSERVER_CORE' THEN 'Shared operational catalogue for SkyCommand Core CLI and API/Admin-Web tool execution.'
      WHEN 'SKYSERVER_WORKER' THEN 'SkyCommand background automation worker for schedules, listeners, tools, and workflow operations.'
      ELSE description
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE app_code IN ('SKYSERVER_ADMIN', 'SKYSERVER_CORE', 'SKYSERVER_WORKER');

UPDATE core.visibility_channels
SET description = CASE channel_code
      WHEN 'cli' THEN 'SkyCommand Core command-line interface.'
      WHEN 'admin-web' THEN 'Private SkyCommand Admin-Web interface.'
      ELSE description
    END
WHERE channel_code IN ('cli', 'admin-web');

UPDATE core.config_profiles
SET description = 'Local Windows development profile for Paul and SkyCommand.'
WHERE profile_code = 'DEV_LOCAL';

-- Human-facing catalogue descriptions follow the new product name while stable
-- tool codes and option-source codes remain unchanged for workflow compatibility.
UPDATE core.tools
SET description = replace(description, 'SkyServer', 'SkyCommand'),
    confirmation_text = replace(confirmation_text, 'SkyServer', 'SkyCommand'),
    updated_at = CURRENT_TIMESTAMP
WHERE description LIKE '%SkyServer%'
   OR confirmation_text LIKE '%SkyServer%';

UPDATE core.option_sources
SET description = replace(description, 'SkyServer', 'SkyCommand')
WHERE description LIKE '%SkyServer%';

DO $$
DECLARE
  repository_count INTEGER;
  configured_path TEXT;
BEGIN
  SELECT COUNT(*)
  INTO repository_count
  FROM core.repositories
  WHERE repo_code = 'SkyCommand'
    AND repo_name = 'SkyCommand'
    AND remote_url = 'https://github.com/PStar1980/SkyCommand.git';

  IF repository_count <> 1 THEN
    RAISE EXCEPTION
      'SkyCommand identity changeover expected exactly one canonical repository row; found %.',
      repository_count;
  END IF;

  SELECT rp.root_path
  INTO configured_path
  FROM core.repository_paths rp
  JOIN core.repositories r
    ON r.repo_id = rp.repo_id
  JOIN core.config_profiles cp
    ON cp.profile_id = rp.profile_id
  WHERE r.repo_code = 'SkyCommand'
    AND cp.profile_code = 'DEV_LOCAL';

  IF configured_path IS DISTINCT FROM $dev_path$C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyCommand System\SkyCommand$dev_path$ THEN
    RAISE EXCEPTION
      'SkyCommand DEV_LOCAL repository path was not updated correctly. Current value: %',
      configured_path;
  END IF;
END
$$;

COMMIT;
