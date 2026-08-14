-- ============================================================
-- Migration: 00097__repository_registry_legacy_cleanup.sql
-- Purpose:
--   Repairs repository/tool registry state if the historical 00019 seed was
--   re-applied after the SkyServer -> SkyCommand rename.
--
--   That legacy seed could recreate active SkyServer / NeoFinTech repository
--   rows and repoint seeded core.tools.script_repo_id values at the obsolete
--   SkyServer repository path. This migration restores SkyCommand as the
--   canonical script repository and removes the retired repository records.
-- ============================================================

BEGIN;

DO $$
DECLARE
  skycommand_repo_id core.repositories.repo_id%TYPE;
  legacy_skyserver_repo_id core.repositories.repo_id%TYPE;
  neofintech_repo_id core.repositories.repo_id%TYPE;
  neofintech_tool_reference_count INTEGER;
BEGIN
  SELECT repo_id
  INTO skycommand_repo_id
  FROM core.repositories
  WHERE repo_code = 'SkyCommand';

  IF skycommand_repo_id IS NULL THEN
    RAISE EXCEPTION
      'Repository registry cleanup requires the canonical SkyCommand repository row.';
  END IF;

  SELECT repo_id
  INTO legacy_skyserver_repo_id
  FROM core.repositories
  WHERE repo_code = 'SkyServer';

  IF legacy_skyserver_repo_id IS NOT NULL THEN
    -- Re-applying the historical core seed could point every seeded tool back
    -- at the obsolete SkyServer repository. Preserve the tool rows while
    -- restoring their canonical script repository FK.
    UPDATE core.tools
    SET script_repo_id = skycommand_repo_id,
        updated_at = CURRENT_TIMESTAMP
    WHERE script_repo_id = legacy_skyserver_repo_id;

    -- repository_paths are removed automatically through ON DELETE CASCADE.
    DELETE FROM core.repositories
    WHERE repo_id = legacy_skyserver_repo_id;
  END IF;

  -- The retired NeoFinTech repository was intentionally removed from the
  -- workspace and remote hosting. Do not silently delete it if a tool has since
  -- been intentionally registered against that repository.
  SELECT repo_id
  INTO neofintech_repo_id
  FROM core.repositories
  WHERE repo_code = 'NeoFinTech';

  IF neofintech_repo_id IS NOT NULL THEN
    SELECT COUNT(*)::int
    INTO neofintech_tool_reference_count
    FROM core.tools
    WHERE script_repo_id = neofintech_repo_id;

    IF neofintech_tool_reference_count > 0 THEN
      RAISE EXCEPTION
        'Cannot remove retired NeoFinTech repository because % tool(s) still reference it.',
        neofintech_tool_reference_count;
    END IF;

    DELETE FROM core.repositories
    WHERE repo_id = neofintech_repo_id;
  END IF;

  -- These two tools are part of SkyCommand itself. Pin them explicitly to the
  -- canonical repository as a final guard even if no legacy row existed.
  UPDATE core.tools
  SET script_repo_id = skycommand_repo_id,
      updated_at = CURRENT_TIMESTAMP
  WHERE tool_code IN ('repo_map_generate', 'repo_zip_generate')
    AND script_repo_id IS DISTINCT FROM skycommand_repo_id;
END
$$;

DO $$
DECLARE
  stale_repository_count INTEGER;
  artifact_tool_mismatch_count INTEGER;
BEGIN
  SELECT COUNT(*)::int
  INTO stale_repository_count
  FROM core.repositories
  WHERE repo_code IN ('SkyServer', 'NeoFinTech');

  IF stale_repository_count <> 0 THEN
    RAISE EXCEPTION
      'Repository registry cleanup expected no SkyServer/NeoFinTech rows; found %.',
      stale_repository_count;
  END IF;

  SELECT COUNT(*)::int
  INTO artifact_tool_mismatch_count
  FROM core.tools tool
  JOIN core.repositories repository
    ON repository.repo_id = tool.script_repo_id
  WHERE tool.tool_code IN ('repo_map_generate', 'repo_zip_generate')
    AND repository.repo_code <> 'SkyCommand';

  IF artifact_tool_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'Repository artifact tools are not bound to the canonical SkyCommand script repository.';
  END IF;
END
$$;

COMMIT;
