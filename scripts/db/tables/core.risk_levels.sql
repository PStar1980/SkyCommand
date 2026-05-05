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
