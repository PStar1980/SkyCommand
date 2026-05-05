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
