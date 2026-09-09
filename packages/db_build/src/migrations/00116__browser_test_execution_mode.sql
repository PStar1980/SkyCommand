-- Migration: 00116__browser_test_execution_mode.sql
-- Purpose: Persists Playwright Test execution mode so background Browser Worker runs and host-interactive runs remain observable.

BEGIN;

ALTER TABLE worker.browser_test_runs
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'HEADLESS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'browser_test_run_execution_mode_supported'
      AND conrelid = 'worker.browser_test_runs'::regclass
  ) THEN
    ALTER TABLE worker.browser_test_runs
      ADD CONSTRAINT browser_test_run_execution_mode_supported
      CHECK (execution_mode IN ('HEADLESS','INTERACTIVE'));
  END IF;
END $$;

COMMENT ON COLUMN worker.browser_test_runs.execution_mode IS
  'Playwright presentation mode. HEADLESS executes in the dedicated Browser Worker; INTERACTIVE executes headed Chromium through the host-native SkyCommand Host Agent.';

-- Phase 5 initially promoted Playwright trace-resource images into the evidence ledger.
-- They are implementation details of trace.zip rather than operator-facing screenshots.
DELETE FROM worker.browser_test_artifacts
WHERE relative_path LIKE '%/.playwright-artifacts-%'
   OR relative_path LIKE '.playwright-artifacts-%'
   OR relative_path LIKE '%/traces/resources/%'
   OR relative_path LIKE 'traces/resources/%'
   OR relative_path LIKE 'report/data/%';

CREATE OR REPLACE VIEW worker.vw_browser_test_runs AS
SELECT
  r.browser_test_run_id,
  r.execution_id,
  r.test_id,
  r.test_code,
  r.test_label,
  r.category_code,
  btc.label AS category_label,
  r.temporal_workflow_id,
  r.temporal_run_id,
  r.temporal_status,
  r.status,
  r.trigger_source,
  r.initiated_by_user_id,
  COALESCE(r.initiated_by_label, u.username, u.email) AS initiated_by,
  r.environment_code,
  r.browser_type,
  r.parameters,
  r.source_repo_code,
  r.source_commit_sha,
  r.artifact_root,
  r.result_summary,
  r.failure_summary,
  r.linked_workflow_ids,
  r.started_at,
  r.completed_at,
  r.duration_ms,
  r.created_at,
  r.updated_at,
  (SELECT COUNT(*) FROM worker.browser_test_artifacts a WHERE a.browser_test_run_id = r.browser_test_run_id) AS artifact_count,
  r.execution_mode
FROM worker.browser_test_runs r
LEFT JOIN core.browser_tests bt ON bt.test_id = r.test_id
LEFT JOIN core.browser_test_categories btc ON btc.category_id = bt.category_id
LEFT JOIN auth.users u ON u.user_id = r.initiated_by_user_id;

ALTER VIEW worker.vw_browser_test_runs OWNER TO postgres;

COMMIT;
