-- ============================================================
-- Seed: 00053__workflow_retry_policy_hotfix.sql
-- Purpose:
-- Restores retry/timeout defaults for macro ingestion workflow
-- nodes whose retry_policy was flattened by earlier graph editor
-- saves before retry policies were visible/preserved in the UI.
-- ============================================================

BEGIN;

WITH retry_defaults(target_code, retry_policy, timeout_ms) AS (
  VALUES
    ('ingestion_fred',   '{"maximumAttempts":3,"initialIntervalSeconds":30}'::jsonb, 1800000),
    ('ingestion_boc',    '{"maximumAttempts":3,"initialIntervalSeconds":30}'::jsonb, 1800000),
    ('ingestion_statcan','{"maximumAttempts":3,"initialIntervalSeconds":30}'::jsonb, 1800000)
)
UPDATE worker.workflow_nodes wn
SET retry_policy = CASE
      WHEN wn.retry_policy = '{}'::jsonb THEN retry_defaults.retry_policy
      ELSE wn.retry_policy
    END,
    timeout_ms = COALESCE(wn.timeout_ms, retry_defaults.timeout_ms),
    config = COALESCE(wn.config, '{}'::jsonb) || jsonb_build_object(
      'retryPolicyHotfix', true,
      'retryPolicyHotfixSeed', '00053__workflow_retry_policy_hotfix',
      'retryPolicyHotfixAppliedAt', CURRENT_TIMESTAMP
    ),
    updated_at = CURRENT_TIMESTAMP
FROM retry_defaults, worker.workflow_versions wv, worker.workflow_definitions wd
WHERE wv.workflow_version_id = wn.workflow_version_id
  AND wd.workflow_definition_id = wv.workflow_definition_id
  AND wd.workflow_code = 'macro-refresh-pipeline'
  AND wv.status = 'PUBLISHED'
  AND wn.node_type_code = 'TOOL'
  AND wn.target_code = retry_defaults.target_code
  AND (
    wn.retry_policy = '{}'::jsonb
    OR wn.timeout_ms IS NULL
  );

COMMIT;
