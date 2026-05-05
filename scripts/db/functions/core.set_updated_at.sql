-- Function: core.set_updated_at
-- Purpose: Shared trigger function for maintaining updated_at timestamps in core schema tables.

CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION core.set_updated_at() OWNER TO postgres;
