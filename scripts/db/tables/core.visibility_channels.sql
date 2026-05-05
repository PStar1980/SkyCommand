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
