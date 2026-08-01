-- Seed: 00089__portable_quality_policies_seed.sql
-- Phase 16.6.2: Default check enablement and production source quality policies.

BEGIN;

UPDATE data.ingestion_quality_check_codes
SET enabled_default = CASE check_code
  WHEN 'EMPTY_RESPONSE' THEN TRUE
  WHEN 'NO_VALID_ROWS' THEN TRUE
  WHEN 'INVALID_DATE' THEN TRUE
  WHEN 'INVALID_NUMERIC' THEN TRUE
  WHEN 'DUPLICATE_KEY' THEN TRUE
  WHEN 'SOURCE_DATE_REGRESSION' THEN TRUE
  WHEN 'TRANSFORMATION_FAILED' THEN TRUE
  ELSE FALSE
END,
updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.source_quality_policies (
  source_id, check_code, enabled, severity_code, blocking, parameters, active
)
SELECT
  source.source_id,
  policy.check_code,
  policy.enabled,
  policy.severity_code,
  policy.blocking,
  policy.parameters,
  TRUE
FROM data.sources source
JOIN data.domains domain ON domain.domain_id = source.domain_id
CROSS JOIN (VALUES
  ('SOURCE_DATE_REGRESSION', TRUE, 'WARNING', FALSE, '{}'::jsonb),
  ('FREQUENCY_INCOMPATIBLE', TRUE, 'ERROR', TRUE, '{}'::jsonb)
) AS policy(check_code, enabled, severity_code, blocking, parameters)
WHERE domain.domain_code = 'MACRO'
  AND source.source_code IN ('FRED', 'BOC', 'STATCAN')
ON CONFLICT (source_id, check_code) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  severity_code = EXCLUDED.severity_code,
  blocking = EXCLUDED.blocking,
  parameters = EXCLUDED.parameters,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
