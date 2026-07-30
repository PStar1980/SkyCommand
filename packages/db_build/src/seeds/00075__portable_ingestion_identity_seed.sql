-- Seed: 00075__portable_ingestion_identity_seed.sql
-- Phase 16.1: Registers the current macro domain and existing ingestion tools
-- through semantic category and profile metadata.

BEGIN;

UPDATE core.tool_categories
SET category_kind_code = 'INGESTION',
    updated_at = CURRENT_TIMESTAMP
WHERE category_code = 'data_ingestion_tools';

INSERT INTO data.domains (
  domain_code,
  name,
  description,
  schema_name,
  contract_version,
  active,
  configuration
)
VALUES (
  'MACRO',
  'Macroeconomic Data',
  'Current production macroeconomic data domain. Registered as a replaceable domain package rather than a core SkyCommand identity.',
  'macro',
  'data_domain.v1',
  TRUE,
  '{"compatibilityMode":"legacy_macro_tables"}'::jsonb
)
ON CONFLICT (domain_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    schema_name = EXCLUDED.schema_name,
    contract_version = EXCLUDED.contract_version,
    active = EXCLUDED.active,
    configuration = EXCLUDED.configuration,
    updated_at = CURRENT_TIMESTAMP;

WITH macro_domain AS (
  SELECT domain_id
  FROM data.domains
  WHERE domain_code = 'MACRO'
)
INSERT INTO data.sources (
  domain_id,
  source_code,
  name,
  provider_name,
  provider_type,
  description,
  observability_enabled,
  active,
  configuration
)
SELECT
  macro_domain.domain_id,
  source.source_code,
  source.name,
  source.provider_name,
  source.provider_type,
  source.description,
  source.observability_enabled,
  TRUE,
  source.configuration
FROM macro_domain
CROSS JOIN (
  VALUES
    (
      'FRED',
      'Federal Reserve Economic Data',
      'Federal Reserve Bank of St. Louis',
      'HTTP_API',
      'U.S. macroeconomic indicator ingestion from FRED.',
      TRUE,
      '{"legacyMacroIndicatorSource":"FRED"}'::jsonb
    ),
    (
      'BOC',
      'Bank of Canada',
      'Bank of Canada',
      'HTTP_API',
      'Canadian rates and foreign-exchange ingestion from Bank of Canada data services.',
      TRUE,
      '{"legacyMacroIndicatorSource":"BOC","aliases":["BANK_OF_CANADA","BANK-CANADA"]}'::jsonb
    ),
    (
      'STATCAN',
      'Statistics Canada',
      'Statistics Canada',
      'HTTP_API',
      'Canadian macroeconomic indicator ingestion from Statistics Canada vector data.',
      TRUE,
      '{"legacyMacroIndicatorSource":"STATCAN","aliases":["STATISTICS_CANADA","STATISTICS-CANADA"]}'::jsonb
    ),
    (
      'MANUAL',
      'Manual File Ingestion',
      'Configured local or supplied files',
      'FILE',
      'Manual spreadsheet or CSV ingestion. Discoverable as an ingestion tool while generic asset bindings are introduced.',
      FALSE,
      '{"legacyMacroIndicatorSource":null}'::jsonb
    )
) AS source(
  source_code,
  name,
  provider_name,
  provider_type,
  description,
  observability_enabled,
  configuration
)
ON CONFLICT (domain_id, source_code) DO UPDATE
SET name = EXCLUDED.name,
    provider_name = EXCLUDED.provider_name,
    provider_type = EXCLUDED.provider_type,
    description = EXCLUDED.description,
    observability_enabled = EXCLUDED.observability_enabled,
    active = EXCLUDED.active,
    configuration = EXCLUDED.configuration,
    updated_at = CURRENT_TIMESTAMP;

WITH profile_seed AS (
  SELECT *
  FROM (
    VALUES
      (
        'ingestion_fred',
        'FRED',
        'FRED',
        'macro_ingestion_summary.v1',
        TRUE,
        TRUE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        '{"legacyRunner":"fredBatchRunner"}'::jsonb
      ),
      (
        'ingestion_boc',
        'BOC',
        'BOC',
        'macro_ingestion_summary.v1',
        TRUE,
        TRUE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        '{}'::jsonb
      ),
      (
        'ingestion_statcan',
        'STATCAN',
        'STATCAN',
        'macro_ingestion_summary.v1',
        TRUE,
        TRUE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        '{}'::jsonb
      ),
      (
        'ingestion_manual',
        'MANUAL',
        'MANUAL_FILE',
        'legacy_unstructured.v1',
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        '{"legacyOutputType":null}'::jsonb
      )
  ) AS values_table(
    tool_code,
    source_code,
    adapter_code,
    contract_version,
    supports_incremental,
    supports_selected_assets,
    supports_backfill,
    supports_revisions,
    supports_resume,
    supports_dry_run,
    configuration
  )
),
resolved_profiles AS (
  SELECT
    tool.tool_id,
    domain.domain_id AS data_domain_id,
    source.source_id,
    profile_seed.adapter_code,
    profile_seed.contract_version,
    profile_seed.supports_incremental,
    profile_seed.supports_selected_assets,
    profile_seed.supports_backfill,
    profile_seed.supports_revisions,
    profile_seed.supports_resume,
    profile_seed.supports_dry_run,
    profile_seed.configuration
  FROM profile_seed
  JOIN core.tools tool ON tool.tool_code = profile_seed.tool_code
  JOIN data.domains domain ON domain.domain_code = 'MACRO'
  JOIN data.sources source
    ON source.domain_id = domain.domain_id
   AND source.source_code = profile_seed.source_code
)
INSERT INTO data.ingestion_tool_profiles (
  tool_id,
  data_domain_id,
  source_id,
  adapter_code,
  contract_version,
  supports_incremental,
  supports_selected_assets,
  supports_backfill,
  supports_revisions,
  supports_resume,
  supports_dry_run,
  configuration,
  active
)
SELECT
  tool_id,
  data_domain_id,
  source_id,
  adapter_code,
  contract_version,
  supports_incremental,
  supports_selected_assets,
  supports_backfill,
  supports_revisions,
  supports_resume,
  supports_dry_run,
  configuration,
  TRUE
FROM resolved_profiles
ON CONFLICT (tool_id) DO UPDATE
SET data_domain_id = EXCLUDED.data_domain_id,
    source_id = EXCLUDED.source_id,
    adapter_code = EXCLUDED.adapter_code,
    contract_version = EXCLUDED.contract_version,
    supports_incremental = EXCLUDED.supports_incremental,
    supports_selected_assets = EXCLUDED.supports_selected_assets,
    supports_backfill = EXCLUDED.supports_backfill,
    supports_revisions = EXCLUDED.supports_revisions,
    supports_resume = EXCLUDED.supports_resume,
    supports_dry_run = EXCLUDED.supports_dry_run,
    configuration = EXCLUDED.configuration,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
