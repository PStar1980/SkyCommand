-- Migration: 00100__host_agent_local_repository_sync.sql
-- Purpose:
--   Promotes Local Repository Sync from host CLI-only execution to the guarded
--   SkyCommand Host Agent transport. Docker/API/workflow processes may now invoke
--   the tool because the script dispatches host mutation through a dedicated
--   Temporal activity queue; the Linux container still never mutates Windows-owned
--   Git refs directly.

BEGIN;

UPDATE core.tools
SET description = 'Guarded host repository synchronization dispatched through the SkyCommand Host Agent. Fast-forwards local main/dev only after exact trusted Dev Commit and approved synchronized-head checks pass.',
    confirmation_text = 'This operation requests the SkyCommand Host Agent to fast-forward host-owned local Git refs only after all repository safety guardrails prove the exact expected source and target SHAs.',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_code = 'local_repo_sync';

WITH local_sync AS (
  SELECT tool_id
  FROM core.tools
  WHERE tool_code = 'local_repo_sync'
  LIMIT 1
), channels(channel_code) AS (
  VALUES ('cli'), ('admin-web'), ('api'), ('worker')
)
INSERT INTO core.tool_visibility (tool_id, channel_code)
SELECT local_sync.tool_id, channels.channel_code
FROM local_sync
CROSS JOIN channels
ON CONFLICT (tool_id, channel_code) DO NOTHING;

DO $$
DECLARE
  local_sync_tool_id UUID;
  required_channel TEXT;
BEGIN
  SELECT tool_id
    INTO local_sync_tool_id
    FROM core.tools
   WHERE tool_code = 'local_repo_sync'
   LIMIT 1;

  IF local_sync_tool_id IS NULL THEN
    RAISE EXCEPTION '00100: local_repo_sync tool is missing; apply migration 00099 first';
  END IF;

  FOREACH required_channel IN ARRAY ARRAY['cli', 'admin-web', 'api', 'worker']
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM core.tool_visibility
       WHERE tool_id = local_sync_tool_id
         AND channel_code = required_channel
    ) THEN
      RAISE EXCEPTION '00100: local_repo_sync visibility missing for channel %', required_channel;
    END IF;
  END LOOP;

  IF (
    SELECT COUNT(*)
      FROM core.tool_parameters
     WHERE tool_id = local_sync_tool_id
       AND enabled = TRUE
       AND parameter_name IN (
         'repoName',
         'expectedLocalDevSha',
         'expectedSynchronizedHeadSha'
       )
  ) <> 3 THEN
    RAISE EXCEPTION '00100: local_repo_sync parameter registration is incomplete';
  END IF;
END;
$$;

COMMIT;
