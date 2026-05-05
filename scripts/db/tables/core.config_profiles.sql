-- Table: core.config_profiles
-- Purpose: Stores environment/profile labels for machine-specific configuration.

CREATE TABLE IF NOT EXISTS core.config_profiles (
  profile_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code TEXT NOT NULL UNIQUE,
  profile_name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE core.config_profiles OWNER TO postgres;

COMMENT ON TABLE core.config_profiles IS 'Configuration profiles such as DEV_LOCAL, TEST_SERVER, and PROD_SERVER.';
