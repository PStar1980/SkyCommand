-- Migration: 00066__tool_catalogue_administration.sql
-- Purpose: Adds Phase 15 tool catalogue administration metadata without changing runtime authority.

BEGIN;

ALTER TABLE core.tools
  ADD COLUMN IF NOT EXISTS output_type TEXT,
  ADD COLUMN IF NOT EXISTS output_schema_path TEXT,
  ADD COLUMN IF NOT EXISTS managed_by_skycommand BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS descriptor_path TEXT,
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registered_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

COMMENT ON COLUMN core.tools.output_type IS
  'Optional ToolResult outputType used for structured result rendering and schema validation.';
COMMENT ON COLUMN core.tools.output_schema_path IS
  'Optional repository-relative JSON Schema path for ToolResult.output reporting validation.';
COMMENT ON COLUMN core.tools.managed_by_skycommand IS
  'Indicates that the implementation files were promoted through the Phase 15 managed onboarding flow.';
COMMENT ON COLUMN core.tools.original_filename IS
  'Original uploaded entry-script filename retained as registration provenance.';
COMMENT ON COLUMN core.tools.descriptor_path IS
  'Optional repository-relative onboarding descriptor path. The descriptor is not a runtime authority.';
COMMENT ON COLUMN core.tools.registered_at IS
  'Timestamp when a managed tool was registered through SkyCommand.';
COMMENT ON COLUMN core.tools.registered_by IS
  'Administrator who registered the managed tool through SkyCommand.';
COMMENT ON COLUMN core.tools.file_hash IS
  'Optional file hash retained as registration evidence only; it is not a runtime launch gate.';

CREATE INDEX IF NOT EXISTS idx_core_tools_admin_filters
  ON core.tools (enabled, runtime_code, risk_code, category_id);

CREATE INDEX IF NOT EXISTS idx_core_tools_managed_registration
  ON core.tools (managed_by_skycommand, registered_at DESC);


-- Extend the trusted operational manifest with optional Phase 15 reporting metadata.
-- Existing runtime consumers select explicit columns, so these additive fields do not alter launch behavior.
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
  t.managed_by_skycommand
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

COMMIT;
