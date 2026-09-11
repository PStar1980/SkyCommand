-- Migration: 00121__browser_test_suites.sql
-- Purpose: Adds Playwright Test Suite definitions, membership, and durable suite execution summaries.

BEGIN;

CREATE TABLE IF NOT EXISTS core.browser_test_suites (
  suite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  default_environment_code TEXT NOT NULL DEFAULT 'LOCAL' REFERENCES core.browser_environments(environment_code),
  execution_mode TEXT NOT NULL DEFAULT 'HEADLESS',
  stop_on_failure BOOLEAN NOT NULL DEFAULT FALSE,
  permission_code TEXT NOT NULL DEFAULT 'BROWSER_TEST_SUITE_RUN' REFERENCES auth.permissions(permission_code),
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  managed_by_skycommand BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registered_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_test_suite_code_format CHECK (suite_code ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT browser_test_suite_execution_mode_supported CHECK (execution_mode IN ('HEADLESS'))
);

ALTER TABLE core.browser_test_suites OWNER TO postgres;

COMMENT ON TABLE core.browser_test_suites IS
  'Reusable ordered Playwright Test Suite definitions. Phase 8 executes suites in the dedicated Browser Worker as background/headless work.';
COMMENT ON COLUMN core.browser_test_suites.stop_on_failure IS
  'When true, later suite members remain NOT_RUN after the first failed member.';

CREATE TABLE IF NOT EXISTS core.browser_test_suite_members (
  suite_member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id UUID NOT NULL REFERENCES core.browser_test_suites(suite_id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES core.browser_tests(test_id) ON DELETE RESTRICT,
  environment_code TEXT REFERENCES core.browser_environments(environment_code),
  parameter_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (suite_id, test_id),
  CONSTRAINT browser_test_suite_member_parameters_object CHECK (jsonb_typeof(parameter_overrides) = 'object')
);

ALTER TABLE core.browser_test_suite_members OWNER TO postgres;

COMMENT ON TABLE core.browser_test_suite_members IS
  'Ordered Browser Test membership for Playwright Test Suites, with optional environment and parameter overrides.';

CREATE TABLE IF NOT EXISTS worker.browser_test_suite_runs (
  browser_test_suite_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id TEXT NOT NULL UNIQUE,
  suite_id UUID NOT NULL REFERENCES core.browser_test_suites(suite_id) ON DELETE RESTRICT,
  suite_code TEXT NOT NULL,
  suite_label TEXT NOT NULL,
  temporal_workflow_id TEXT NOT NULL UNIQUE,
  temporal_run_id TEXT,
  temporal_status TEXT NOT NULL DEFAULT 'STARTED',
  status TEXT NOT NULL DEFAULT 'STARTED',
  trigger_source TEXT NOT NULL DEFAULT 'MANUAL',
  initiated_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  initiated_by_label TEXT,
  environment_code TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'HEADLESS',
  stop_on_failure BOOLEAN NOT NULL DEFAULT FALSE,
  source_commit_sha TEXT,
  result_summary JSONB,
  failure_summary JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_test_suite_run_status_supported CHECK (
    status IN ('STARTED','RUNNING','PASSED','FAILED','PARTIAL','CANCELED','TERMINATED','TIMED_OUT')
  ),
  CONSTRAINT browser_test_suite_temporal_status_supported CHECK (
    temporal_status IN ('STARTED','RUNNING','COMPLETED','FAILED','CANCELED','TERMINATED','CONTINUED_AS_NEW','TIMED_OUT','UNKNOWN')
  ),
  CONSTRAINT browser_test_suite_run_execution_mode_supported CHECK (execution_mode IN ('HEADLESS')),
  CONSTRAINT browser_test_suite_run_source_sha_format CHECK (
    source_commit_sha IS NULL OR source_commit_sha ~ '^[0-9a-fA-F]{40}$'
  )
);

ALTER TABLE worker.browser_test_suite_runs OWNER TO postgres;

CREATE TABLE IF NOT EXISTS worker.browser_test_suite_member_runs (
  suite_member_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_test_suite_run_id UUID NOT NULL REFERENCES worker.browser_test_suite_runs(browser_test_suite_run_id) ON DELETE CASCADE,
  suite_member_id UUID,
  test_id UUID NOT NULL REFERENCES core.browser_tests(test_id) ON DELETE RESTRICT,
  test_code TEXT NOT NULL,
  test_label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  status TEXT NOT NULL,
  duration_ms BIGINT,
  execution_id TEXT,
  artifact_root TEXT,
  result_summary JSONB,
  failure_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_test_suite_member_run_status_supported CHECK (status IN ('PASSED','FAILED','NOT_RUN'))
);

ALTER TABLE worker.browser_test_suite_member_runs OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_browser_test_suites_catalogue
  ON core.browser_test_suites (enabled, display_order, suite_code);
CREATE INDEX IF NOT EXISTS idx_browser_test_suite_members_order
  ON core.browser_test_suite_members (suite_id, enabled, display_order);
CREATE INDEX IF NOT EXISTS idx_browser_test_suite_runs_started
  ON worker.browser_test_suite_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_test_suite_runs_status
  ON worker.browser_test_suite_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_test_suite_member_runs_order
  ON worker.browser_test_suite_member_runs (browser_test_suite_run_id, display_order);

DROP TRIGGER IF EXISTS browser_test_suites_set_updated_at ON core.browser_test_suites;
CREATE TRIGGER browser_test_suites_set_updated_at
BEFORE UPDATE ON core.browser_test_suites
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS browser_test_suite_members_set_updated_at ON core.browser_test_suite_members;
CREATE TRIGGER browser_test_suite_members_set_updated_at
BEFORE UPDATE ON core.browser_test_suite_members
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS browser_test_suite_runs_set_updated_at ON worker.browser_test_suite_runs;
CREATE TRIGGER browser_test_suite_runs_set_updated_at
BEFORE UPDATE ON worker.browser_test_suite_runs
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE OR REPLACE VIEW worker.vw_browser_test_suite_runs AS
SELECT
  r.browser_test_suite_run_id,
  r.execution_id,
  r.suite_id,
  r.suite_code,
  r.suite_label,
  r.temporal_workflow_id,
  r.temporal_run_id,
  r.temporal_status,
  r.status,
  r.trigger_source,
  r.initiated_by_user_id,
  COALESCE(r.initiated_by_label, u.username, u.email) AS initiated_by,
  r.environment_code,
  r.execution_mode,
  r.stop_on_failure,
  r.source_commit_sha,
  r.result_summary,
  r.failure_summary,
  r.started_at,
  r.completed_at,
  r.duration_ms,
  r.created_at,
  r.updated_at,
  (SELECT COUNT(*) FROM core.browser_test_suite_members m WHERE m.suite_id = r.suite_id AND m.enabled = TRUE) AS member_count
FROM worker.browser_test_suite_runs r
LEFT JOIN auth.users u ON u.user_id = r.initiated_by_user_id;

ALTER VIEW worker.vw_browser_test_suite_runs OWNER TO postgres;

COMMIT;
