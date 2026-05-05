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
