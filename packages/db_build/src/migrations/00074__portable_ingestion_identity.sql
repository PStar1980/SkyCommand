-- Migration: 00074__portable_ingestion_identity.sql
-- Phase 16.1: Adds semantic ingestion-category identity and the minimum
-- portable catalogue required to discover ingestion tools without relying
-- on labels, filenames, source names, or script paths.

BEGIN;

CREATE TABLE IF NOT EXISTS core.tool_category_kinds (
  category_kind_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tool_category_kinds_code_check
    CHECK (category_kind_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE core.tool_category_kinds OWNER TO postgres;

COMMENT ON TABLE core.tool_category_kinds IS
  'Semantic category kinds used by SkyCommand to identify special tool behaviours independently of visible labels and category codes.';

INSERT INTO core.tool_category_kinds (
  category_kind_code,
  name,
  description,
  active
)
VALUES
  ('GENERAL', 'General', 'Standard tool category with no ingestion-specific platform behaviour.', TRUE),
  ('INGESTION', 'Ingestion', 'Reserved semantic category for tools that ingest data through a registered ingestion profile.', TRUE)
ON CONFLICT (category_kind_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

ALTER TABLE core.tool_categories
  ADD COLUMN IF NOT EXISTS category_kind_code TEXT;

UPDATE core.tool_categories
SET category_kind_code = 'GENERAL'
WHERE category_kind_code IS NULL;

ALTER TABLE core.tool_categories
  ALTER COLUMN category_kind_code SET DEFAULT 'GENERAL',
  ALTER COLUMN category_kind_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tool_categories_category_kind_code_fkey'
      AND conrelid = 'core.tool_categories'::regclass
  ) THEN
    ALTER TABLE core.tool_categories
      ADD CONSTRAINT tool_categories_category_kind_code_fkey
      FOREIGN KEY (category_kind_code)
      REFERENCES core.tool_category_kinds(category_kind_code);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_core_tool_categories_kind
  ON core.tool_categories (category_kind_code, enabled, display_order);

COMMENT ON COLUMN core.tool_categories.category_kind_code IS
  'Semantic category kind. INGESTION identifies ingestion tools without depending on category labels, codes, filenames, or paths.';

CREATE SCHEMA IF NOT EXISTS data;
ALTER SCHEMA data OWNER TO postgres;

COMMENT ON SCHEMA data IS
  'Portable data-platform catalogue and ingestion evidence schema. Macro is registered as one replaceable data domain.';

CREATE OR REPLACE FUNCTION data.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION data.set_updated_at() OWNER TO postgres;

CREATE TABLE IF NOT EXISTS data.domains (
  domain_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  schema_name TEXT,
  contract_version TEXT NOT NULL DEFAULT 'data_domain.v1',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_domains_code_check
    CHECK (domain_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_domains_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.domains OWNER TO postgres;

COMMENT ON TABLE data.domains IS
  'Replaceable business/data domains such as MACRO, CLIENT_SERVICES, OPERATIONS, or FINANCE.';

CREATE TABLE IF NOT EXISTS data.sources (
  source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES data.domains(domain_id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  name TEXT NOT NULL,
  provider_name TEXT,
  provider_type TEXT NOT NULL DEFAULT 'OTHER',
  description TEXT,
  observability_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain_id, source_code),
  CONSTRAINT data_sources_code_check
    CHECK (source_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_sources_provider_type_check
    CHECK (provider_type ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_sources_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.sources OWNER TO postgres;

COMMENT ON TABLE data.sources IS
  'Registered providers or input channels used by portable ingestion profiles.';
COMMENT ON COLUMN data.sources.observability_enabled IS
  'Whether the source is ready to appear on generic source-status surfaces. Manual ingestion remains discoverable as a tool even when no source asset catalogue exists yet.';

CREATE INDEX IF NOT EXISTS idx_data_sources_domain_active
  ON data.sources (domain_id, active, source_code);

CREATE TABLE IF NOT EXISTS data.ingestion_tool_profiles (
  tool_id UUID PRIMARY KEY REFERENCES core.tools(tool_id) ON DELETE CASCADE,
  data_domain_id UUID NOT NULL REFERENCES data.domains(domain_id),
  source_id UUID NOT NULL REFERENCES data.sources(source_id),
  adapter_code TEXT NOT NULL,
  contract_version TEXT NOT NULL DEFAULT 'ingestion_run_summary.v1',
  supports_incremental BOOLEAN NOT NULL DEFAULT FALSE,
  supports_selected_assets BOOLEAN NOT NULL DEFAULT FALSE,
  supports_backfill BOOLEAN NOT NULL DEFAULT FALSE,
  supports_revisions BOOLEAN NOT NULL DEFAULT FALSE,
  supports_resume BOOLEAN NOT NULL DEFAULT FALSE,
  supports_dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ingestion_tool_profiles_adapter_code_check
    CHECK (adapter_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT ingestion_tool_profiles_contract_version_check
    CHECK (contract_version ~ '^[a-z][a-z0-9_]*([.]v[1-9][0-9]*)?$'),
  CONSTRAINT ingestion_tool_profiles_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.ingestion_tool_profiles OWNER TO postgres;

COMMENT ON TABLE data.ingestion_tool_profiles IS
  'PostgreSQL-authoritative ingestion capabilities for tools in semantic INGESTION categories.';
COMMENT ON COLUMN data.ingestion_tool_profiles.configuration IS
  'Non-secret adapter/profile configuration. Credentials remain in environment or approved secret storage.';

CREATE INDEX IF NOT EXISTS idx_ingestion_tool_profiles_source_active
  ON data.ingestion_tool_profiles (source_id, active);

DROP TRIGGER IF EXISTS tool_category_kinds_set_updated_at ON core.tool_category_kinds;
CREATE TRIGGER tool_category_kinds_set_updated_at
BEFORE UPDATE ON core.tool_category_kinds
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS data_domains_set_updated_at ON data.domains;
CREATE TRIGGER data_domains_set_updated_at
BEFORE UPDATE ON data.domains
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS data_sources_set_updated_at ON data.sources;
CREATE TRIGGER data_sources_set_updated_at
BEFORE UPDATE ON data.sources
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS ingestion_tool_profiles_set_updated_at ON data.ingestion_tool_profiles;
CREATE TRIGGER ingestion_tool_profiles_set_updated_at
BEFORE UPDATE ON data.ingestion_tool_profiles
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

-- Preserve the Phase 15 manifest while appending semantic category identity.
CREATE OR REPLACE VIEW core.vw_tool_manifest AS
SELECT
  a.app_code,
  a.title AS app_title,
  a.manifest_version,
  c.category_id,
  c.category_code,
  c.label AS category_label,
  c.description AS category_description,
  c.display_order AS category_display_order,
  t.tool_id,
  t.tool_code,
  t.name,
  t.label,
  t.description,
  r.repo_code AS script_repo_code,
  t.script_path,
  t.runtime_code,
  rt.executable AS runtime_executable,
  t.permission_code,
  t.risk_code,
  rl.risk_rank,
  t.requires_confirmation,
  t.confirmation_text,
  t.captures_output,
  t.allow_params,
  t.display_order AS tool_display_order,
  t.enabled AS tool_enabled,
  t.output_type,
  t.output_schema_path,
  t.managed_by_skycommand,
  c.category_kind_code
FROM core.tools t
JOIN core.tool_categories c ON c.category_id = t.category_id
JOIN core.applications a ON a.app_id = c.app_id
JOIN core.repositories r ON r.repo_id = t.script_repo_id
JOIN core.runtimes rt ON rt.runtime_code = t.runtime_code
JOIN core.risk_levels rl ON rl.risk_code = t.risk_code
WHERE t.enabled = TRUE
  AND c.enabled = TRUE
  AND a.active = TRUE;

ALTER VIEW core.vw_tool_manifest OWNER TO postgres;

CREATE OR REPLACE VIEW data.vw_ingestion_tools AS
SELECT
  application.app_id,
  application.app_code,
  application.active AS application_active,
  category.category_id,
  category.category_code,
  category.label AS category_label,
  category.category_kind_code,
  category.enabled AS category_enabled,
  category_kind.active AS category_kind_active,
  tool.tool_id,
  tool.tool_code,
  tool.name AS tool_name,
  tool.label AS tool_label,
  tool.description AS tool_description,
  tool.script_path,
  tool.runtime_code,
  tool.permission_code,
  tool.output_type,
  tool.enabled AS tool_enabled,
  profile.adapter_code,
  profile.contract_version,
  profile.supports_incremental,
  profile.supports_selected_assets,
  profile.supports_backfill,
  profile.supports_revisions,
  profile.supports_resume,
  profile.supports_dry_run,
  profile.configuration AS profile_configuration,
  profile.active AS profile_active,
  domain.domain_id,
  domain.domain_code,
  domain.name AS domain_name,
  domain.active AS domain_active,
  source.source_id,
  source.source_code,
  source.name AS source_name,
  source.provider_name,
  source.provider_type,
  source.description AS source_description,
  source.observability_enabled,
  source.configuration AS source_configuration,
  source.active AS source_active,
  COALESCE(
    ARRAY_AGG(DISTINCT visibility.channel_code ORDER BY visibility.channel_code)
      FILTER (WHERE visibility.channel_code IS NOT NULL),
    ARRAY[]::text[]
  ) AS visibility_channels,
  (
    application.active
    AND category.enabled
    AND category_kind.active
    AND tool.enabled
    AND profile.active
    AND domain.active
    AND source.active
  ) AS discoverable
FROM core.tools tool
JOIN core.tool_categories category ON category.category_id = tool.category_id
JOIN core.tool_category_kinds category_kind
  ON category_kind.category_kind_code = category.category_kind_code
JOIN core.applications application ON application.app_id = category.app_id
JOIN data.ingestion_tool_profiles profile ON profile.tool_id = tool.tool_id
JOIN data.domains domain ON domain.domain_id = profile.data_domain_id
JOIN data.sources source ON source.source_id = profile.source_id
LEFT JOIN core.tool_visibility visibility ON visibility.tool_id = tool.tool_id
WHERE category.category_kind_code = 'INGESTION'
GROUP BY
  application.app_id,
  application.app_code,
  application.active,
  category.category_id,
  category.category_code,
  category.label,
  category.category_kind_code,
  category.enabled,
  category_kind.active,
  tool.tool_id,
  tool.tool_code,
  tool.name,
  tool.label,
  tool.description,
  tool.script_path,
  tool.runtime_code,
  tool.permission_code,
  tool.output_type,
  tool.enabled,
  profile.adapter_code,
  profile.contract_version,
  profile.supports_incremental,
  profile.supports_selected_assets,
  profile.supports_backfill,
  profile.supports_revisions,
  profile.supports_resume,
  profile.supports_dry_run,
  profile.configuration,
  profile.active,
  domain.domain_id,
  domain.domain_code,
  domain.name,
  domain.active,
  source.source_id,
  source.source_code,
  source.name,
  source.provider_name,
  source.provider_type,
  source.description,
  source.observability_enabled,
  source.configuration,
  source.active;

ALTER VIEW data.vw_ingestion_tools OWNER TO postgres;

COMMENT ON VIEW data.vw_ingestion_tools IS
  'Semantic discovery seam for all registered ingestion tools and their portable capabilities.';

CREATE OR REPLACE VIEW data.vw_ingestion_sources AS
SELECT
  domain_id,
  domain_code,
  domain_name,
  source_id,
  source_code,
  source_name,
  provider_name,
  provider_type,
  source_description,
  observability_enabled,
  source_configuration,
  BOOL_OR(discoverable) AS discoverable,
  ARRAY_AGG(tool_id ORDER BY tool_code) AS tool_ids,
  ARRAY_AGG(tool_code ORDER BY tool_code) AS tool_codes,
  ARRAY_AGG(script_path ORDER BY tool_code) AS script_paths,
  ARRAY_AGG(adapter_code ORDER BY tool_code) AS adapter_codes
FROM data.vw_ingestion_tools
GROUP BY
  domain_id,
  domain_code,
  domain_name,
  source_id,
  source_code,
  source_name,
  provider_name,
  provider_type,
  source_description,
  observability_enabled,
  source_configuration;

ALTER VIEW data.vw_ingestion_sources OWNER TO postgres;

COMMENT ON VIEW data.vw_ingestion_sources IS
  'Data-driven ingestion-source discovery aggregated from semantic tool profiles.';

COMMIT;
