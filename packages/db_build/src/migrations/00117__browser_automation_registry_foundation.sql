-- Migration: 00117__browser_automation_registry_foundation.sql
-- Purpose: Adds first-class Playwright Browser Automation registry metadata, safety controls, and structured-output configuration.

BEGIN;

COMMENT ON TABLE core.browser_environments IS
  'Registered browser execution environments shared by Playwright Tests and Playwright Automation.';
COMMENT ON COLUMN core.browser_environments.base_url IS
  'Base URL used by browser execution runtimes for the selected environment.';

CREATE TABLE IF NOT EXISTS core.browser_automation_categories (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_automation_category_code_format
    CHECK (category_code ~ '^[a-z][a-z0-9_]*$')
);

ALTER TABLE core.browser_automation_categories OWNER TO postgres;

COMMENT ON TABLE core.browser_automation_categories IS
  'Playwright Automation catalogue categories used by registry and execution surfaces.';

CREATE TABLE IF NOT EXISTS core.browser_automations (
  automation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES core.browser_automation_categories(category_id) ON DELETE RESTRICT,
  automation_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  script_repo_id UUID NOT NULL REFERENCES core.repositories(repo_id) ON DELETE RESTRICT,
  script_path TEXT NOT NULL,
  browser_type TEXT NOT NULL DEFAULT 'chromium',
  default_environment_code TEXT NOT NULL REFERENCES core.browser_environments(environment_code) ON DELETE RESTRICT,
  timeout_seconds INTEGER NOT NULL DEFAULT 120,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  permission_code TEXT REFERENCES auth.permissions(permission_code),
  risk_code TEXT NOT NULL REFERENCES core.risk_levels(risk_code),
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_text TEXT,
  side_effect_level TEXT NOT NULL DEFAULT 'READ_ONLY',
  idempotency_mode TEXT NOT NULL DEFAULT 'READ_ONLY',
  output_type TEXT NOT NULL,
  output_schema_path TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  managed_by_skycommand BOOLEAN NOT NULL DEFAULT FALSE,
  registered_at TIMESTAMPTZ,
  registered_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_automation_code_format
    CHECK (automation_code ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT browser_automation_browser_type_supported
    CHECK (browser_type IN ('chromium')),
  CONSTRAINT browser_automation_timeout_range
    CHECK (timeout_seconds BETWEEN 1 AND 3600),
  CONSTRAINT browser_automation_retry_range
    CHECK (retry_count BETWEEN 0 AND 3),
  CONSTRAINT browser_automation_concurrency_range
    CHECK (max_concurrency BETWEEN 1 AND 8),
  CONSTRAINT browser_automation_side_effect_supported
    CHECK (side_effect_level IN ('READ_ONLY','MUTATING','HIGH_IMPACT')),
  CONSTRAINT browser_automation_idempotency_supported
    CHECK (idempotency_mode IN ('READ_ONLY','IDEMPOTENT','DEDUPLICATED','NON_IDEMPOTENT')),
  CONSTRAINT browser_automation_read_only_consistency
    CHECK (
      (side_effect_level = 'READ_ONLY' AND idempotency_mode = 'READ_ONLY')
      OR (side_effect_level <> 'READ_ONLY' AND idempotency_mode <> 'READ_ONLY')
    ),
  CONSTRAINT browser_automation_retry_safety
    CHECK (
      retry_count = 0
      OR idempotency_mode IN ('READ_ONLY','IDEMPOTENT','DEDUPLICATED')
    ),
  CONSTRAINT browser_automation_high_impact_confirmation
    CHECK (side_effect_level <> 'HIGH_IMPACT' OR requires_confirmation = TRUE),
  CONSTRAINT browser_automation_confirmation_text_consistency
    CHECK (
      requires_confirmation = FALSE
      OR (confirmation_text IS NOT NULL AND BTRIM(confirmation_text) <> '')
    ),
  CONSTRAINT browser_automation_output_type_format
    CHECK (output_type ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT browser_automation_output_schema_path_format
    CHECK (
      BTRIM(output_schema_path) <> ''
      AND output_schema_path !~ '(^|/)\.\.(/|$)'
      AND output_schema_path !~ '^[/\\]'
      AND output_schema_path ~ '\.schema\.json$'
    )
);

ALTER TABLE core.browser_automations OWNER TO postgres;

COMMENT ON TABLE core.browser_automations IS
  'Registered source-controlled Playwright operational automations. PostgreSQL stores execution/safety metadata while source remains canonical in Git.';
COMMENT ON COLUMN core.browser_automations.script_path IS
  'Repository-relative automation source path beneath browser-automation/scripts/. Source code remains canonical in Git.';
COMMENT ON COLUMN core.browser_automations.side_effect_level IS
  'Operational side-effect class: READ_ONLY, MUTATING, or HIGH_IMPACT.';
COMMENT ON COLUMN core.browser_automations.idempotency_mode IS
  'Retry-safety contract: READ_ONLY, IDEMPOTENT, DEDUPLICATED, or NON_IDEMPOTENT.';
COMMENT ON COLUMN core.browser_automations.retry_count IS
  'Maximum automatic retry count. Positive retries are rejected for NON_IDEMPOTENT automations.';
COMMENT ON COLUMN core.browser_automations.max_concurrency IS
  'Maximum concurrent executions permitted for this automation definition. Runtime enforcement is added with execution integration.';
COMMENT ON COLUMN core.browser_automations.output_type IS
  'Structured browser automation result contract identifier, for example browser_automation_summary.v1.';
COMMENT ON COLUMN core.browser_automations.output_schema_path IS
  'Repository-relative JSON Schema path used to validate structured automation output.';

CREATE TABLE IF NOT EXISTS core.browser_automation_environments (
  automation_id UUID NOT NULL REFERENCES core.browser_automations(automation_id) ON DELETE CASCADE,
  environment_code TEXT NOT NULL REFERENCES core.browser_environments(environment_code) ON DELETE CASCADE,
  PRIMARY KEY (automation_id, environment_code)
);

ALTER TABLE core.browser_automation_environments OWNER TO postgres;

COMMENT ON TABLE core.browser_automation_environments IS
  'Allow-list mapping between registered Playwright Automations and execution environments.';

CREATE TABLE IF NOT EXISTS core.browser_automation_parameters (
  parameter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES core.browser_automations(automation_id) ON DELETE CASCADE,
  parameter_name TEXT NOT NULL,
  label TEXT NOT NULL,
  param_type_code TEXT NOT NULL REFERENCES core.param_types(param_type_code),
  prompt TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  default_value TEXT,
  option_source_code TEXT REFERENCES core.option_sources(option_source_code),
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (automation_id, parameter_name),
  CONSTRAINT browser_automation_parameter_name_format
    CHECK (parameter_name ~ '^[A-Za-z][A-Za-z0-9_]*$')
);

ALTER TABLE core.browser_automation_parameters OWNER TO postgres;

COMMENT ON TABLE core.browser_automation_parameters IS
  'Typed runtime parameter metadata for registered Playwright Automations.';

CREATE TABLE IF NOT EXISTS core.browser_automation_parameter_options (
  option_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id UUID NOT NULL REFERENCES core.browser_automation_parameters(parameter_id) ON DELETE CASCADE,
  option_label TEXT NOT NULL,
  option_value TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (parameter_id, option_value)
);

ALTER TABLE core.browser_automation_parameter_options OWNER TO postgres;

COMMENT ON TABLE core.browser_automation_parameter_options IS
  'Static option values for select-style Playwright Automation parameters.';

CREATE INDEX IF NOT EXISTS idx_browser_automation_categories_enabled_order
  ON core.browser_automation_categories (enabled, display_order, category_code);

CREATE INDEX IF NOT EXISTS idx_browser_automations_catalogue
  ON core.browser_automations (enabled, category_id, display_order, automation_code);

CREATE INDEX IF NOT EXISTS idx_browser_automations_permission
  ON core.browser_automations (permission_code);

CREATE INDEX IF NOT EXISTS idx_browser_automations_safety
  ON core.browser_automations (side_effect_level, idempotency_mode, risk_code);

CREATE INDEX IF NOT EXISTS idx_browser_automation_parameters_order
  ON core.browser_automation_parameters (automation_id, enabled, display_order, parameter_name);

DROP TRIGGER IF EXISTS browser_automation_categories_set_updated_at ON core.browser_automation_categories;
CREATE TRIGGER browser_automation_categories_set_updated_at
BEFORE UPDATE ON core.browser_automation_categories
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS browser_automations_set_updated_at ON core.browser_automations;
CREATE TRIGGER browser_automations_set_updated_at
BEFORE UPDATE ON core.browser_automations
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS browser_automation_parameters_set_updated_at ON core.browser_automation_parameters;
CREATE TRIGGER browser_automation_parameters_set_updated_at
BEFORE UPDATE ON core.browser_automation_parameters
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

COMMIT;
