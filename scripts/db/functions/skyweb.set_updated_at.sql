-- Function: skyweb.set_updated_at
-- Purpose: Maintains updated_at columns for SkyWeb-owned tables.

CREATE OR REPLACE FUNCTION skyweb.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION skyweb.set_updated_at() OWNER TO postgres;
