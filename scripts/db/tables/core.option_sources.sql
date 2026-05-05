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
