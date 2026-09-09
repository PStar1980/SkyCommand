-- Migration: 00115__browser_test_observability.sql
-- Purpose: Adds a durable Playwright Test execution ledger, structured results, source lineage, and artifact metadata.

BEGIN;

CREATE TABLE IF NOT EXISTS worker.browser_test_runs (
  browser_test_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id TEXT NOT NULL UNIQUE,
  test_id UUID NOT NULL REFERENCES core.browser_tests(test_id) ON DELETE RESTRICT,
  test_code TEXT NOT NULL,
  test_label TEXT NOT NULL,
  category_code TEXT,
  temporal_workflow_id TEXT NOT NULL UNIQUE,
  temporal_run_id TEXT,
  temporal_status TEXT NOT NULL DEFAULT 'STARTED',
  status TEXT NOT NULL DEFAULT 'STARTED',
  trigger_source TEXT NOT NULL DEFAULT 'MANUAL',
  initiated_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  initiated_by_label TEXT,
  environment_code TEXT NOT NULL,
  browser_type TEXT NOT NULL DEFAULT 'chromium',
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_repo_code TEXT,
  source_commit_sha TEXT,
  artifact_root TEXT,
  result_summary JSONB,
  failure_summary JSONB,
  linked_workflow_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_test_run_parameters_object CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT browser_test_run_linked_workflows_array CHECK (jsonb_typeof(linked_workflow_ids) = 'array'),
  CONSTRAINT browser_test_run_status_supported CHECK (
    status IN ('STARTED','RUNNING','PASSED','FAILED','CANCELED','TERMINATED','TIMED_OUT')
  ),
  CONSTRAINT browser_test_run_temporal_status_supported CHECK (
    temporal_status IN ('STARTED','RUNNING','COMPLETED','FAILED','CANCELED','TERMINATED','CONTINUED_AS_NEW','TIMED_OUT','UNKNOWN')
  ),
  CONSTRAINT browser_test_run_source_sha_format CHECK (
    source_commit_sha IS NULL OR source_commit_sha ~ '^[0-9a-fA-F]{40}$'
  )
);

ALTER TABLE worker.browser_test_runs OWNER TO postgres;

COMMENT ON TABLE worker.browser_test_runs IS
  'Durable SkyCommand ledger for registered Playwright Test executions. Temporal remains the orchestrator while this table stores operator-facing test status, input snapshots, source lineage, and structured results.';
COMMENT ON COLUMN worker.browser_test_runs.status IS
  'Operator-facing Playwright Test status. PASSED/FAILED reflect test outcome rather than only Temporal workflow completion.';
COMMENT ON COLUMN worker.browser_test_runs.artifact_root IS
  'Repository-relative artifact directory for this execution, normally artifacts/browser/tests/<execution-id>.';

CREATE TABLE IF NOT EXISTS worker.browser_test_artifacts (
  artifact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_test_run_id UUID NOT NULL REFERENCES worker.browser_test_runs(browser_test_run_id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL,
  artifact_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (browser_test_run_id, relative_path),
  CONSTRAINT browser_test_artifact_kind_supported CHECK (
    artifact_kind IN ('TRACE','SCREENSHOT','VIDEO','REPORT','ATTACHMENT','DOWNLOAD')
  ),
  CONSTRAINT browser_test_artifact_path_relative CHECK (
    relative_path <> '' AND relative_path !~ '(^|/)\.\.(/|$)' AND relative_path !~ '^[/\\]'
  )
);

ALTER TABLE worker.browser_test_artifacts OWNER TO postgres;

COMMENT ON TABLE worker.browser_test_artifacts IS
  'Metadata references for Playwright traces, screenshots, videos, reports, and other browser-test evidence. Artifact bytes remain on the filesystem.';

CREATE INDEX IF NOT EXISTS idx_browser_test_runs_started
  ON worker.browser_test_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_test_runs_test_started
  ON worker.browser_test_runs (test_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_test_runs_status_started
  ON worker.browser_test_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_test_runs_environment_started
  ON worker.browser_test_runs (environment_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_test_artifacts_run_kind
  ON worker.browser_test_artifacts (browser_test_run_id, artifact_kind, created_at);

DROP TRIGGER IF EXISTS browser_test_runs_set_updated_at ON worker.browser_test_runs;
CREATE TRIGGER browser_test_runs_set_updated_at
BEFORE UPDATE ON worker.browser_test_runs
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

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
  (SELECT COUNT(*) FROM worker.browser_test_artifacts a WHERE a.browser_test_run_id = r.browser_test_run_id) AS artifact_count
FROM worker.browser_test_runs r
LEFT JOIN core.browser_tests bt ON bt.test_id = r.test_id
LEFT JOIN core.browser_test_categories btc ON btc.category_id = bt.category_id
LEFT JOIN auth.users u ON u.user_id = r.initiated_by_user_id;

ALTER VIEW worker.vw_browser_test_runs OWNER TO postgres;

COMMIT;
