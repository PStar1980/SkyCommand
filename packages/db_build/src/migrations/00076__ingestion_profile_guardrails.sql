-- Phase 16.1.2: portable ingestion profile administration guardrails.
--
-- The profile row and tool row are written in the same transaction. Deferred constraint
-- triggers therefore validate the completed transaction instead of rejecting the temporary
-- state between the two statements.

CREATE OR REPLACE FUNCTION data.assert_ingestion_tool_profile_contract(p_tool_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  state RECORD;
BEGIN
  SELECT
    tool.tool_id,
    tool.tool_code,
    tool.enabled AS tool_enabled,
    category.category_code,
    category.category_kind_code,
    profile.tool_id AS profile_tool_id,
    profile.active AS profile_active,
    profile.data_domain_id,
    profile.source_id,
    source.domain_id AS source_domain_id
  INTO state
  FROM core.tools tool
  JOIN core.tool_categories category ON category.category_id = tool.category_id
  LEFT JOIN data.ingestion_tool_profiles profile ON profile.tool_id = tool.tool_id
  LEFT JOIN data.sources source ON source.source_id = profile.source_id
  WHERE tool.tool_id = p_tool_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF state.category_kind_code = 'INGESTION' THEN
    IF state.profile_tool_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Ingestion tool %s requires a portable ingestion profile.',
          state.tool_code
        ),
        DETAIL = 'INGESTION_PROFILE_REQUIRED';
    END IF;

    IF state.source_domain_id IS DISTINCT FROM state.data_domain_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Ingestion tool %s source must belong to the selected data domain.',
          state.tool_code
        ),
        DETAIL = 'INGESTION_PROFILE_SOURCE_DOMAIN_MISMATCH';
    END IF;

    IF state.tool_enabled AND NOT COALESCE(state.profile_active, FALSE) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Enabled ingestion tool %s requires an active ingestion profile.',
          state.tool_code
        ),
        DETAIL = 'INGESTION_PROFILE_ACTIVE_REQUIRED';
    END IF;
  ELSIF state.profile_tool_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'Tool %s may only have an ingestion profile while assigned to an INGESTION category.',
        state.tool_code
      ),
      DETAIL = 'INGESTION_PROFILE_CATEGORY_KIND_REQUIRED';
  END IF;
END;
$$;

ALTER FUNCTION data.assert_ingestion_tool_profile_contract(UUID) OWNER TO postgres;

CREATE OR REPLACE FUNCTION data.enforce_ingestion_tool_profile_from_tool()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM data.assert_ingestion_tool_profile_contract(NEW.tool_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION data.enforce_ingestion_tool_profile_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM data.assert_ingestion_tool_profile_contract(OLD.tool_id);
    RETURN OLD;
  END IF;

  PERFORM data.assert_ingestion_tool_profile_contract(NEW.tool_id);

  IF TG_OP = 'UPDATE' AND OLD.tool_id IS DISTINCT FROM NEW.tool_id THEN
    PERFORM data.assert_ingestion_tool_profile_contract(OLD.tool_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION data.enforce_ingestion_tool_profile_from_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_tool RECORD;
BEGIN
  FOR affected_tool IN
    SELECT tool_id
    FROM core.tools
    WHERE category_id = NEW.category_id
  LOOP
    PERFORM data.assert_ingestion_tool_profile_contract(affected_tool.tool_id);
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION data.enforce_ingestion_tool_profile_from_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_profile RECORD;
BEGIN
  FOR affected_profile IN
    SELECT tool_id
    FROM data.ingestion_tool_profiles
    WHERE source_id = NEW.source_id
  LOOP
    PERFORM data.assert_ingestion_tool_profile_contract(affected_profile.tool_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ingestion_tool_profile_contract_tool ON core.tools;
CREATE CONSTRAINT TRIGGER ingestion_tool_profile_contract_tool
AFTER INSERT OR UPDATE ON core.tools
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.enforce_ingestion_tool_profile_from_tool();

DROP TRIGGER IF EXISTS ingestion_tool_profile_contract_profile ON data.ingestion_tool_profiles;
CREATE CONSTRAINT TRIGGER ingestion_tool_profile_contract_profile
AFTER INSERT OR UPDATE OR DELETE ON data.ingestion_tool_profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.enforce_ingestion_tool_profile_from_profile();

DROP TRIGGER IF EXISTS ingestion_tool_profile_contract_category ON core.tool_categories;
CREATE CONSTRAINT TRIGGER ingestion_tool_profile_contract_category
AFTER UPDATE ON core.tool_categories
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.enforce_ingestion_tool_profile_from_category();

DROP TRIGGER IF EXISTS ingestion_tool_profile_contract_source ON data.sources;
CREATE CONSTRAINT TRIGGER ingestion_tool_profile_contract_source
AFTER UPDATE ON data.sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.enforce_ingestion_tool_profile_from_source();

COMMENT ON FUNCTION data.assert_ingestion_tool_profile_contract(UUID) IS
  'Deferred invariant: INGESTION-category tools require a same-domain profile, enabled tools require an active profile, and GENERAL tools cannot retain one.';

DO $$
DECLARE
  tool_record RECORD;
BEGIN
  FOR tool_record IN SELECT tool_id FROM core.tools LOOP
    PERFORM data.assert_ingestion_tool_profile_contract(tool_record.tool_id);
  END LOOP;
END;
$$;
