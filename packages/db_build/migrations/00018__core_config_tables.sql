-- Migration: 00018__core_config_tables.sql

-- Purpose: Creates relational core configuration schema replacing SkyServer.json and repo_path.json.

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- Schema: core
-- Purpose: Relational configuration store for SkyServer Core, Admin-Web, repositories, tools, and script manifest data.

CREATE SCHEMA IF NOT EXISTS core;

ALTER SCHEMA core OWNER TO postgres;

COMMENT ON SCHEMA core IS 'SkyServer operational configuration schema for repositories, tools, manifests, visibility, parameters, and runtime metadata.';



-- Function: core.set_updated_at
-- Purpose: Shared trigger function for maintaining updated_at timestamps in core schema tables.

CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION core.set_updated_at() OWNER TO postgres;



-- Table: core.applications
-- Purpose: Stores application/manifest identity records such as SkyServer Core.

CREATE TABLE IF NOT EXISTS core.applications (
  app_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  manifest_version TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE core.applications OWNER TO postgres;

COMMENT ON TABLE core.applications IS 'Application manifest headers for SkyServer operational tools.';
COMMENT ON COLUMN core.applications.app_code IS 'Stable application code, e.g. SKYSERVER_CORE.';



-- Table: core.visibility_channels
-- Purpose: Stores supported interface/runtime channels where tools can be exposed.

CREATE TABLE IF NOT EXISTS core.visibility_channels (
  channel_code TEXT PRIMARY KEY,
  channel_name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE core.visibility_channels OWNER TO postgres;

COMMENT ON TABLE core.visibility_channels IS 'Visibility channels such as cli, admin-web, api, and worker.';



-- Table: core.runtimes
-- Purpose: Stores supported script runtimes.

CREATE TABLE IF NOT EXISTS core.runtimes (
  runtime_code TEXT PRIMARY KEY,
  runtime_name TEXT NOT NULL,
  executable TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE core.runtimes OWNER TO postgres;

COMMENT ON TABLE core.runtimes IS 'Configured script runtimes such as node, powershell, and pwsh.';



-- Table: core.risk_levels
-- Purpose: Stores sortable operational risk levels for configured tools.

CREATE TABLE IF NOT EXISTS core.risk_levels (
  risk_code TEXT PRIMARY KEY,
  risk_name TEXT NOT NULL,
  risk_rank INTEGER NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE core.risk_levels OWNER TO postgres;

COMMENT ON TABLE core.risk_levels IS 'Operational risk levels used by tool execution and UI confirmation flows.';



-- Table: core.config_profiles
-- Purpose: Stores environment/profile labels for machine-specific configuration.

CREATE TABLE IF NOT EXISTS core.config_profiles (
  profile_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code TEXT NOT NULL UNIQUE,
  profile_name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE core.config_profiles OWNER TO postgres;

COMMENT ON TABLE core.config_profiles IS 'Configuration profiles such as DEV_LOCAL, TEST_SERVER, and PROD_SERVER.';



-- Table: core.repositories
-- Purpose: Stores repository identity and branch conventions.

CREATE TABLE IF NOT EXISTS core.repositories (
  repo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_code TEXT NOT NULL UNIQUE,
  repo_name TEXT NOT NULL,
  description TEXT,
  remote_url TEXT,
  main_branch TEXT NOT NULL DEFAULT 'main',
  dev_branch TEXT NOT NULL DEFAULT 'dev',
  display_order INTEGER NOT NULL DEFAULT 999,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE core.repositories OWNER TO postgres;

COMMENT ON TABLE core.repositories IS 'Repository registry used by Git automation and repository option sources.';



-- Table: core.repository_paths
-- Purpose: Stores profile-specific local filesystem paths for configured repositories.

CREATE TABLE IF NOT EXISTS core.repository_paths (
  repo_path_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES core.repositories(repo_id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES core.config_profiles(profile_id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (repo_id, profile_id)
);

ALTER TABLE core.repository_paths OWNER TO postgres;

COMMENT ON TABLE core.repository_paths IS 'Environment/profile-specific repository root paths replacing repo_path.json.';



-- Table: core.tool_categories
-- Purpose: Stores configured tool menu categories.

CREATE TABLE IF NOT EXISTS core.tool_categories (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES core.applications(app_id) ON DELETE CASCADE,
  category_code TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (app_id, category_code)
);

ALTER TABLE core.tool_categories OWNER TO postgres;

COMMENT ON TABLE core.tool_categories IS 'Tool categories used by SkyServer Core CLI and Admin-Web manifests.';



-- Table: core.tool_category_visibility
-- Purpose: Junction table mapping categories to visibility channels.

CREATE TABLE IF NOT EXISTS core.tool_category_visibility (
  category_id UUID NOT NULL REFERENCES core.tool_categories(category_id) ON DELETE CASCADE,
  channel_code TEXT NOT NULL REFERENCES core.visibility_channels(channel_code),
  PRIMARY KEY (category_id, channel_code)
);

ALTER TABLE core.tool_category_visibility OWNER TO postgres;

COMMENT ON TABLE core.tool_category_visibility IS 'Category-to-channel visibility mapping.';



-- Table: core.tools
-- Purpose: Stores configured callable tools/scripts.

CREATE TABLE IF NOT EXISTS core.tools (
  tool_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES core.tool_categories(category_id) ON DELETE CASCADE,
  tool_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  script_repo_id UUID NOT NULL REFERENCES core.repositories(repo_id),
  script_path TEXT NOT NULL,
  runtime_code TEXT NOT NULL REFERENCES core.runtimes(runtime_code),
  permission_code TEXT REFERENCES auth.permissions(permission_code),
  risk_code TEXT NOT NULL REFERENCES core.risk_levels(risk_code),
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_text TEXT,
  captures_output BOOLEAN NOT NULL DEFAULT TRUE,
  allow_params BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE core.tools OWNER TO postgres;

COMMENT ON TABLE core.tools IS 'Callable tool/script manifest replacing the script entries in SkyServer.json.';
COMMENT ON COLUMN core.tools.script_path IS 'Repo-relative script file path. Do not expose directly to browsers unless needed for admin diagnostics.';



-- Table: core.tool_visibility
-- Purpose: Junction table mapping tools to visibility channels.

CREATE TABLE IF NOT EXISTS core.tool_visibility (
  tool_id UUID NOT NULL REFERENCES core.tools(tool_id) ON DELETE CASCADE,
  channel_code TEXT NOT NULL REFERENCES core.visibility_channels(channel_code),
  PRIMARY KEY (tool_id, channel_code)
);

ALTER TABLE core.tool_visibility OWNER TO postgres;

COMMENT ON TABLE core.tool_visibility IS 'Tool-to-channel visibility mapping.';



-- Table: core.param_types
-- Purpose: Stores supported parameter input types.

CREATE TABLE IF NOT EXISTS core.param_types (
  param_type_code TEXT PRIMARY KEY,
  param_type_name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE core.param_types OWNER TO postgres;

COMMENT ON TABLE core.param_types IS 'Supported tool parameter types such as string, repo, select, path, date, and boolean.';



-- Table: core.option_sources
-- Purpose: Stores dynamic option source identifiers for parameter dropdowns.

CREATE TABLE IF NOT EXISTS core.option_sources (
  option_source_code TEXT PRIMARY KEY,
  option_source_name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE core.option_sources OWNER TO postgres;

COMMENT ON TABLE core.option_sources IS 'Dynamic option source registry, e.g. repositories.';



-- Table: core.tool_parameters
-- Purpose: Stores parameter metadata for configured tools.

CREATE TABLE IF NOT EXISTS core.tool_parameters (
  parameter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES core.tools(tool_id) ON DELETE CASCADE,
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
  UNIQUE (tool_id, parameter_name)
);

ALTER TABLE core.tool_parameters OWNER TO postgres;

COMMENT ON TABLE core.tool_parameters IS 'Parameter definitions for configured tools/scripts.';



-- Table: core.tool_parameter_options
-- Purpose: Stores static dropdown options for select-style parameters.

CREATE TABLE IF NOT EXISTS core.tool_parameter_options (
  option_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id UUID NOT NULL REFERENCES core.tool_parameters(parameter_id) ON DELETE CASCADE,
  option_label TEXT NOT NULL,
  option_value TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (parameter_id, option_value)
);

ALTER TABLE core.tool_parameter_options OWNER TO postgres;

COMMENT ON TABLE core.tool_parameter_options IS 'Static parameter options for configured tool parameters.';



-- Indexes for core configuration tables.

CREATE INDEX IF NOT EXISTS idx_core_repository_paths_profile
  ON core.repository_paths (profile_id, active);

CREATE INDEX IF NOT EXISTS idx_core_tool_categories_app_order
  ON core.tool_categories (app_id, enabled, display_order);

CREATE INDEX IF NOT EXISTS idx_core_tools_category_order
  ON core.tools (category_id, enabled, display_order);

CREATE INDEX IF NOT EXISTS idx_core_tools_permission_code
  ON core.tools (permission_code);

CREATE INDEX IF NOT EXISTS idx_core_tool_parameters_tool_order
  ON core.tool_parameters (tool_id, enabled, display_order);



-- Trigger: core.applications_set_updated_at
-- Purpose: Maintains updated_at on core.applications.

DROP TRIGGER IF EXISTS applications_set_updated_at ON core.applications;

CREATE TRIGGER applications_set_updated_at
BEFORE UPDATE ON core.applications
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();



-- Trigger: core.repositories_set_updated_at
-- Purpose: Maintains updated_at on core.repositories.

DROP TRIGGER IF EXISTS repositories_set_updated_at ON core.repositories;

CREATE TRIGGER repositories_set_updated_at
BEFORE UPDATE ON core.repositories
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();



-- Trigger: core.repository_paths_set_updated_at
-- Purpose: Maintains updated_at on core.repository_paths.

DROP TRIGGER IF EXISTS repository_paths_set_updated_at ON core.repository_paths;

CREATE TRIGGER repository_paths_set_updated_at
BEFORE UPDATE ON core.repository_paths
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();



-- Trigger: core.tool_categories_set_updated_at
-- Purpose: Maintains updated_at on core.tool_categories.

DROP TRIGGER IF EXISTS tool_categories_set_updated_at ON core.tool_categories;

CREATE TRIGGER tool_categories_set_updated_at
BEFORE UPDATE ON core.tool_categories
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();



-- Trigger: core.tools_set_updated_at
-- Purpose: Maintains updated_at on core.tools.

DROP TRIGGER IF EXISTS tools_set_updated_at ON core.tools;

CREATE TRIGGER tools_set_updated_at
BEFORE UPDATE ON core.tools
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();



-- Trigger: core.tool_parameters_set_updated_at
-- Purpose: Maintains updated_at on core.tool_parameters.

DROP TRIGGER IF EXISTS tool_parameters_set_updated_at ON core.tool_parameters;

CREATE TRIGGER tool_parameters_set_updated_at
BEFORE UPDATE ON core.tool_parameters
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();



-- View: core.vw_repository_paths
-- Purpose: Display active repository paths by configuration profile.

CREATE OR REPLACE VIEW core.vw_repository_paths AS
SELECT
  cp.profile_code,
  cp.profile_name,
  r.repo_id,
  r.repo_code,
  r.repo_name,
  r.remote_url,
  r.main_branch,
  r.dev_branch,
  r.display_order,
  rp.root_path,
  r.active AS repo_active,
  rp.active AS path_active
FROM core.repositories r
JOIN core.repository_paths rp
  ON rp.repo_id = r.repo_id
JOIN core.config_profiles cp
  ON cp.profile_id = rp.profile_id
WHERE r.active = TRUE
  AND rp.active = TRUE
  AND cp.active = TRUE;

ALTER VIEW core.vw_repository_paths OWNER TO postgres;



-- View: core.vw_cli_categories
-- Purpose: CLI-visible enabled tool categories.

CREATE OR REPLACE VIEW core.vw_cli_categories AS
SELECT
  a.app_code,
  c.category_id,
  c.category_code,
  c.name,
  c.label,
  c.description,
  c.display_order,
  c.enabled
FROM core.tool_categories c
JOIN core.applications a
  ON a.app_id = c.app_id
JOIN core.tool_category_visibility cv
  ON cv.category_id = c.category_id
WHERE cv.channel_code = 'cli'
  AND c.enabled = TRUE
  AND a.active = TRUE;

ALTER VIEW core.vw_cli_categories OWNER TO postgres;



-- View: core.vw_cli_tools
-- Purpose: CLI-visible enabled tools, including executable metadata.

CREATE OR REPLACE VIEW core.vw_cli_tools AS
SELECT
  a.app_code,
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
  t.display_order,
  t.enabled
FROM core.tools t
JOIN core.tool_categories c ON c.category_id = t.category_id
JOIN core.applications a ON a.app_id = c.app_id
JOIN core.repositories r ON r.repo_id = t.script_repo_id
JOIN core.runtimes rt ON rt.runtime_code = t.runtime_code
JOIN core.risk_levels rl ON rl.risk_code = t.risk_code
JOIN core.tool_visibility tv ON tv.tool_id = t.tool_id
WHERE tv.channel_code = 'cli'
  AND t.enabled = TRUE
  AND c.enabled = TRUE
  AND a.active = TRUE;

ALTER VIEW core.vw_cli_tools OWNER TO postgres;



-- View: core.vw_admin_web_tools
-- Purpose: Admin-Web-visible enabled tools with safe display metadata.
-- Note: script_path is intentionally omitted from this view.

CREATE OR REPLACE VIEW core.vw_admin_web_tools AS
SELECT
  a.app_code,
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
  t.permission_code,
  t.risk_code,
  rl.risk_rank,
  t.requires_confirmation,
  t.captures_output,
  t.allow_params,
  t.display_order,
  t.enabled
FROM core.tools t
JOIN core.tool_categories c ON c.category_id = t.category_id
JOIN core.applications a ON a.app_id = c.app_id
JOIN core.risk_levels rl ON rl.risk_code = t.risk_code
JOIN core.tool_visibility tv ON tv.tool_id = t.tool_id
WHERE tv.channel_code = 'admin-web'
  AND t.enabled = TRUE
  AND c.enabled = TRUE
  AND a.active = TRUE;

ALTER VIEW core.vw_admin_web_tools OWNER TO postgres;



-- View: core.vw_tool_parameters
-- Purpose: Enabled tool parameter metadata.

CREATE OR REPLACE VIEW core.vw_tool_parameters AS
SELECT
  t.tool_id,
  t.tool_code,
  p.parameter_id,
  p.parameter_name,
  p.label,
  p.param_type_code,
  p.prompt,
  p.required,
  p.default_value,
  p.option_source_code,
  p.display_order,
  p.enabled
FROM core.tool_parameters p
JOIN core.tools t
  ON t.tool_id = p.tool_id
WHERE p.enabled = TRUE
  AND t.enabled = TRUE;

ALTER VIEW core.vw_tool_parameters OWNER TO postgres;



-- View: core.vw_tool_parameter_options
-- Purpose: Static parameter options for enabled parameters.

CREATE OR REPLACE VIEW core.vw_tool_parameter_options AS
SELECT
  t.tool_code,
  p.parameter_name,
  o.option_id,
  o.option_label,
  o.option_value,
  o.display_order,
  o.enabled
FROM core.tool_parameter_options o
JOIN core.tool_parameters p
  ON p.parameter_id = o.parameter_id
JOIN core.tools t
  ON t.tool_id = p.tool_id
WHERE o.enabled = TRUE
  AND p.enabled = TRUE
  AND t.enabled = TRUE;

ALTER VIEW core.vw_tool_parameter_options OWNER TO postgres;



-- View: core.vw_tool_manifest
-- Purpose: Full operational tool manifest for trusted API/service-side execution.

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
  t.enabled AS tool_enabled
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
