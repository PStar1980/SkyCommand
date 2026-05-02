-- ------------------------------------------------------------
-- Updated-at Trigger Function
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

ALTER FUNCTION auth.set_updated_at() OWNER TO postgres;
