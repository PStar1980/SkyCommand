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
  repo_map_file_name TEXT,
  repo_map_output_path TEXT,
  repo_zip_file_name TEXT,
  repo_zip_output_path TEXT,
  display_order INTEGER NOT NULL DEFAULT 999,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE core.repositories OWNER TO postgres;

COMMENT ON TABLE core.repositories IS 'Repository registry used by Git automation and repository option sources.';
COMMENT ON COLUMN core.repositories.repo_map_file_name IS 'Configured output file name for the Generate Repository Map tool.';
COMMENT ON COLUMN core.repositories.repo_map_output_path IS 'Configured output directory for the Generate Repository Map tool.';
COMMENT ON COLUMN core.repositories.repo_zip_file_name IS 'Configured output archive file name for the Generate Repository Zip tool.';
COMMENT ON COLUMN core.repositories.repo_zip_output_path IS 'Configured output directory for the Generate Repository Zip tool.';
