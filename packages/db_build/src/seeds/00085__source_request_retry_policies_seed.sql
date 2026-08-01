-- Seed: 00085__source_request_retry_policies_seed.sql
-- Phase 16.5.1: Registers current production source request policies while
-- keeping the policy model generic and source metadata PostgreSQL-authoritative.

BEGIN;

WITH policies AS (
  SELECT *
  FROM (
    VALUES
      ('FRED',    100000, 4, 750, 10000, 240000, 0.2000::numeric, TRUE),
      ('BOC',      60000, 4, 750, 10000, 180000, 0.2000::numeric, TRUE),
      ('STATCAN',  60000, 4, 750, 10000, 180000, 0.2000::numeric, TRUE),
      ('MANUAL',   60000, 1,   0,     0,  60000, 0.0000::numeric, FALSE)
  ) AS values_table(
    source_code,
    request_timeout_ms,
    max_attempts,
    base_delay_ms,
    max_delay_ms,
    max_elapsed_ms,
    jitter_ratio,
    respect_retry_after
  )
),
resolved AS (
  SELECT
    source.source_id,
    policies.request_timeout_ms,
    policies.max_attempts,
    policies.base_delay_ms,
    policies.max_delay_ms,
    policies.max_elapsed_ms,
    policies.jitter_ratio,
    policies.respect_retry_after
  FROM policies
  JOIN data.domains domain
    ON domain.domain_code = 'MACRO'
  JOIN data.sources source
    ON source.domain_id = domain.domain_id
   AND source.source_code = policies.source_code
)
INSERT INTO data.source_request_policies (
  source_id,
  request_timeout_ms,
  max_attempts,
  base_delay_ms,
  max_delay_ms,
  max_elapsed_ms,
  jitter_ratio,
  respect_retry_after,
  retryable_http_statuses,
  retryable_error_codes,
  configuration,
  active
)
SELECT
  source_id,
  request_timeout_ms,
  max_attempts,
  base_delay_ms,
  max_delay_ms,
  max_elapsed_ms,
  jitter_ratio,
  respect_retry_after,
  ARRAY[408,425,429,500,502,503,504],
  ARRAY[
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETDOWN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ERR_NETWORK',
    'ETIMEDOUT'
  ],
  '{}'::jsonb,
  TRUE
FROM resolved
ON CONFLICT (source_id) DO UPDATE
SET request_timeout_ms = EXCLUDED.request_timeout_ms,
    max_attempts = EXCLUDED.max_attempts,
    base_delay_ms = EXCLUDED.base_delay_ms,
    max_delay_ms = EXCLUDED.max_delay_ms,
    max_elapsed_ms = EXCLUDED.max_elapsed_ms,
    jitter_ratio = EXCLUDED.jitter_ratio,
    respect_retry_after = EXCLUDED.respect_retry_after,
    retryable_http_statuses = EXCLUDED.retryable_http_statuses,
    retryable_error_codes = EXCLUDED.retryable_error_codes,
    configuration = EXCLUDED.configuration,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

-- The FRED compatibility facade remains available to the older dedicated
-- Temporal pilot, but production tools now use the common adapter runner.
UPDATE data.ingestion_tool_profiles profile
SET configuration = (COALESCE(profile.configuration, '{}'::jsonb) - 'legacyRunner')
      || '{"runner":"common_source_adapter","requestPolicy":"catalogue"}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
FROM core.tools tool
WHERE tool.tool_id = profile.tool_id
  AND tool.tool_code IN ('ingestion_fred', 'ingestion_boc', 'ingestion_statcan');

UPDATE data.ingestion_tool_profiles profile
SET configuration = COALESCE(profile.configuration, '{}'::jsonb)
      || '{"runner":"common_source_adapter"}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
FROM core.tools tool
WHERE tool.tool_id = profile.tool_id
  AND tool.tool_code = 'ingestion_manual';

COMMIT;
