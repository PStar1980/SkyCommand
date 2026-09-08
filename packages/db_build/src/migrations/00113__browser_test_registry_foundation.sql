-- Migration: 00113__browser_test_registry_foundation.sql
-- Purpose: Adds first-class Browser Test registry metadata for Playwright-backed execution.

BEGIN;

CREATE TABLE IF NOT EXISTS core.browser_environments (
  environment_code TEXT PRIMARY KEY,
  environment_name TEXT NOT NULL,
  description TEXT,
  base_url TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_environment_code_format
    CHECK (environment_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE core.browser_environments OWNER TO postgres;

COMMENT ON TABLE core.browser_environments IS
  'Registered browser execution environments such as LOCAL, DEV, STAGING, and PRODUCTION.';
COMMENT ON COLUMN core.browser_environments.base_url IS
  'Base URL used by the dedicated Browser Worker when executing a registered browser test in this environment.';

CREATE TABLE IF NOT EXISTS core.browser_test_categories (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_test_category_code_format
    CHECK (category_code ~ '^[a-z][a-z0-9_]*$')
);

ALTER TABLE core.browser_test_categories OWNER TO postgres;

COMMENT ON TABLE core.browser_test_categories IS
  'Browser Test catalogue categories used by Browser Tests administration and execution surfaces.';

CREATE TABLE IF NOT EXISTS core.browser_tests (
  test_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES core.browser_test_categories(category_id) ON DELETE RESTRICT,
  test_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  script_repo_id UUID NOT NULL REFERENCES core.repositories(repo_id) ON DELETE RESTRICT,
  script_path TEXT NOT NULL,
  browser_type TEXT NOT NULL DEFAULT 'chromium',
  default_environment_code TEXT NOT NULL REFERENCES core.browser_environments(environment_code) ON DELETE RESTRICT,
  timeout_seconds INTEGER NOT NULL DEFAULT 60,
  retry_count INTEGER NOT NULL DEFAULT 0,
  grep_pattern TEXT,
  permission_code TEXT REFERENCES auth.permissions(permission_code),
  risk_code TEXT NOT NULL REFERENCES core.risk_levels(risk_code),
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_text TEXT,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  managed_by_skycommand BOOLEAN NOT NULL DEFAULT FALSE,
  registered_at TIMESTAMPTZ,
  registered_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT browser_test_code_format
    CHECK (test_code ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT browser_test_browser_type_supported
    CHECK (browser_type IN ('chromium')),
  CONSTRAINT browser_test_timeout_range
    CHECK (timeout_seconds BETWEEN 1 AND 3600),
  CONSTRAINT browser_test_retry_range
    CHECK (retry_count BETWEEN 0 AND 3),
  CONSTRAINT browser_test_confirmation_text_consistency
    CHECK (
      requires_confirmation = FALSE
      OR (confirmation_text IS NOT NULL AND BTRIM(confirmation_text) <> '')
    )
);

ALTER TABLE core.browser_tests OWNER TO postgres;

COMMENT ON TABLE core.browser_tests IS
  'Registered source-controlled Playwright browser tests. PostgreSQL stores execution metadata while source remains in Git.';
COMMENT ON COLUMN core.browser_tests.script_path IS
  'Repository-relative Playwright spec path beneath tests/browser/specs/. Source code remains canonical in Git.';
COMMENT ON COLUMN core.browser_tests.permission_code IS
  'Optional additional execution permission required beyond the Browser Test run permission.';
COMMENT ON COLUMN core.browser_tests.grep_pattern IS
  'Optional Playwright grep filter used to select a named/tagged test within the registered spec.';

CREATE TABLE IF NOT EXISTS core.browser_test_environments (
  test_id UUID NOT NULL REFERENCES core.browser_tests(test_id) ON DELETE CASCADE,
  environment_code TEXT NOT NULL REFERENCES core.browser_environments(environment_code) ON DELETE CASCADE,
  PRIMARY KEY (test_id, environment_code)
);

ALTER TABLE core.browser_test_environments OWNER TO postgres;

COMMENT ON TABLE core.browser_test_environments IS
  'Allow-list mapping between registered Browser Tests and execution environments.';

CREATE TABLE IF NOT EXISTS core.browser_test_parameters (
  parameter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES core.browser_tests(test_id) ON DELETE CASCADE,
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
  UNIQUE (test_id, parameter_name),
  CONSTRAINT browser_test_parameter_name_format
    CHECK (parameter_name ~ '^[A-Za-z][A-Za-z0-9_]*$')
);

ALTER TABLE core.browser_test_parameters OWNER TO postgres;

COMMENT ON TABLE core.browser_test_parameters IS
  'Runtime parameter metadata for registered Browser Tests. Parameter snapshots are passed to Playwright as execution input.';

CREATE TABLE IF NOT EXISTS core.browser_test_parameter_options (
  option_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id UUID NOT NULL REFERENCES core.browser_test_parameters(parameter_id) ON DELETE CASCADE,
  option_label TEXT NOT NULL,
  option_value TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (parameter_id, option_value)
);

ALTER TABLE core.browser_test_parameter_options OWNER TO postgres;

COMMENT ON TABLE core.browser_test_parameter_options IS
  'Static option values for select-style Browser Test parameters.';

CREATE INDEX IF NOT EXISTS idx_browser_environments_enabled_order
  ON core.browser_environments (enabled, display_order, environment_code);

CREATE INDEX IF NOT EXISTS idx_browser_test_categories_enabled_order
  ON core.browser_test_categories (enabled, display_order, category_code);

CREATE INDEX IF NOT EXISTS idx_browser_tests_catalogue
  ON core.browser_tests (enabled, category_id, display_order, test_code);

CREATE INDEX IF NOT EXISTS idx_browser_tests_permission
  ON core.browser_tests (permission_code);

CREATE INDEX IF NOT EXISTS idx_browser_test_parameters_order
  ON core.browser_test_parameters (test_id, enabled, display_order, parameter_name);

DROP TRIGGER IF EXISTS browser_environments_set_updated_at ON core.browser_environments;
CREATE TRIGGER browser_environments_set_updated_at
BEFORE UPDATE ON core.browser_environments
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS browser_test_categories_set_updated_at ON core.browser_test_categories;
CREATE TRIGGER browser_test_categories_set_updated_at
BEFORE UPDATE ON core.browser_test_categories
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS browser_tests_set_updated_at ON core.browser_tests;
CREATE TRIGGER browser_tests_set_updated_at
BEFORE UPDATE ON core.browser_tests
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

DROP TRIGGER IF EXISTS browser_test_parameters_set_updated_at ON core.browser_test_parameters;
CREATE TRIGGER browser_test_parameters_set_updated_at
BEFORE UPDATE ON core.browser_test_parameters
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

COMMIT;
