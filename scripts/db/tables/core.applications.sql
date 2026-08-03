-- Table: core.applications
-- Purpose: Stores application/manifest identity records such as SkyCommand Core.

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

COMMENT ON TABLE core.applications IS 'Application manifest headers for SkyCommand operational tools.';
COMMENT ON COLUMN core.applications.app_code IS 'Stable application code, e.g. SKYSERVER_CORE.';
