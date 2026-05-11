-- Function: worker.set_updated_at
-- Purpose: Shared trigger function for maintaining updated_at timestamps in worker schema tables.

CREATE OR REPLACE FUNCTION worker.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION worker.set_updated_at() OWNER TO postgres;
