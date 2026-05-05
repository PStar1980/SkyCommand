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
