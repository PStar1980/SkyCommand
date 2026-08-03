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

COMMENT ON TABLE core.tools IS 'Callable tool/script manifest replacing the script entries in SkyCommand.json.';
COMMENT ON COLUMN core.tools.script_path IS 'Repo-relative script file path. Do not expose directly to browsers unless needed for admin diagnostics.';
