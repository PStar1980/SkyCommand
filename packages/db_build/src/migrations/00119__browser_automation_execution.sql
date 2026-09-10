-- Migration: 00119__browser_automation_execution.sql
-- Purpose: Adds durable Playwright Automation execution history and artifact metadata for Phase 7.

BEGIN;

CREATE TABLE IF NOT EXISTS worker.browser_automation_runs (
  browser_automation_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id TEXT NOT NULL UNIQUE,
  automation_id UUID NOT NULL REFERENCES core.browser_automations(automation_id) ON DELETE RESTRICT,
  automation_code TEXT NOT NULL,
  automation_label TEXT NOT NULL,
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
  execution_mode TEXT NOT NULL DEFAULT 'HEADLESS',
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_repo_code TEXT,
  source_commit_sha TEXT,
  side_effect_level TEXT NOT NULL,
  idempotency_mode TEXT NOT NULL,
  risk_code TEXT NOT NULL,
  artifact_root TEXT,
  result_summary JSONB,
  failure_summary JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_automation_run_parameters_object CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT browser_automation_run_status_supported CHECK (
    status IN ('STARTED','RUNNING','SUCCESS','FAILED','CANCELED','TERMINATED','TIMED_OUT')
  ),
  CONSTRAINT browser_automation_run_temporal_status_supported CHECK (
    temporal_status IN ('STARTED','RUNNING','COMPLETED','FAILED','CANCELED','TERMINATED','CONTINUED_AS_NEW','TIMED_OUT','UNKNOWN')
  ),
  CONSTRAINT browser_automation_run_execution_mode_supported CHECK (
    execution_mode IN ('HEADLESS','INTERACTIVE')
  ),
  CONSTRAINT browser_automation_run_side_effect_supported CHECK (
    side_effect_level IN ('READ_ONLY','MUTATING','HIGH_IMPACT')
  ),
  CONSTRAINT browser_automation_run_idempotency_supported CHECK (
    idempotency_mode IN ('READ_ONLY','IDEMPOTENT','DEDUPLICATED','NON_IDEMPOTENT')
  ),
  CONSTRAINT browser_automation_run_source_sha_format CHECK (
    source_commit_sha IS NULL OR source_commit_sha ~ '^[0-9a-fA-F]{40}$'
  )
);

ALTER TABLE worker.browser_automation_runs OWNER TO postgres;

COMMENT ON TABLE worker.browser_automation_runs IS
  'Durable SkyCommand ledger for registered Playwright Automation executions. Temporal orchestrates execution while this table stores inputs, safety snapshots, structured results, lineage, and artifacts.';
COMMENT ON COLUMN worker.browser_automation_runs.status IS
  'Operator-facing automation outcome. SUCCESS means the operational task completed successfully.';
COMMENT ON COLUMN worker.browser_automation_runs.execution_mode IS
  'HEADLESS uses the dedicated Browser Worker; INTERACTIVE uses headed Chromium through the host-native SkyCommand Host Agent.';
COMMENT ON COLUMN worker.browser_automation_runs.side_effect_level IS
  'Safety snapshot copied from the automation definition at execution start.';
COMMENT ON COLUMN worker.browser_automation_runs.idempotency_mode IS
  'Retry/idempotency snapshot copied from the automation definition at execution start.';

CREATE TABLE IF NOT EXISTS worker.browser_automation_artifacts (
  artifact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_automation_run_id UUID NOT NULL REFERENCES worker.browser_automation_runs(browser_automation_run_id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL,
  artifact_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (browser_automation_run_id, relative_path),
  CONSTRAINT browser_automation_artifact_kind_supported CHECK (
    artifact_kind IN ('TRACE','SCREENSHOT','VIDEO','REPORT','ATTACHMENT','DOWNLOAD','FILE')
  ),
  CONSTRAINT browser_automation_artifact_path_relative CHECK (
    relative_path <> '' AND relative_path !~ '(^|/)\.\.(/|$)' AND relative_path !~ '^[/\\]'
  )
);

ALTER TABLE worker.browser_automation_artifacts OWNER TO postgres;

COMMENT ON TABLE worker.browser_automation_artifacts IS
  'Metadata references for Playwright Automation screenshots, downloads, videos, traces, and other artifacts. Artifact bytes remain on disk.';

CREATE INDEX IF NOT EXISTS idx_browser_automation_runs_started
  ON worker.browser_automation_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_automation_runs_automation_started
  ON worker.browser_automation_runs (automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_automation_runs_status_started
  ON worker.browser_automation_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_automation_runs_environment_started
  ON worker.browser_automation_runs (environment_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_automation_artifacts_run_kind
  ON worker.browser_automation_artifacts (browser_automation_run_id, artifact_kind, created_at);

DROP TRIGGER IF EXISTS browser_automation_runs_set_updated_at ON worker.browser_automation_runs;
CREATE TRIGGER browser_automation_runs_set_updated_at
BEFORE UPDATE ON worker.browser_automation_runs
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

CREATE OR REPLACE VIEW worker.vw_browser_automation_runs AS
SELECT
  r.browser_automation_run_id,
  r.execution_id,
  r.automation_id,
  r.automation_code,
  r.automation_label,
  r.category_code,
  bac.label AS category_label,
  r.temporal_workflow_id,
  r.temporal_run_id,
  r.temporal_status,
  r.status,
  r.trigger_source,
  r.initiated_by_user_id,
  COALESCE(r.initiated_by_label, u.username, u.email) AS initiated_by,
  r.environment_code,
  r.browser_type,
  r.execution_mode,
  r.parameters,
  r.source_repo_code,
  r.source_commit_sha,
  r.side_effect_level,
  r.idempotency_mode,
  r.risk_code,
  r.artifact_root,
  r.result_summary,
  r.failure_summary,
  r.started_at,
  r.completed_at,
  r.duration_ms,
  r.created_at,
  r.updated_at,
  (SELECT COUNT(*) FROM worker.browser_automation_artifacts a WHERE a.browser_automation_run_id = r.browser_automation_run_id) AS artifact_count
FROM worker.browser_automation_runs r
LEFT JOIN core.browser_automations ba ON ba.automation_id = r.automation_id
LEFT JOIN core.browser_automation_categories bac ON bac.category_id = ba.category_id
LEFT JOIN auth.users u ON u.user_id = r.initiated_by_user_id;

ALTER VIEW worker.vw_browser_automation_runs OWNER TO postgres;

COMMIT;
