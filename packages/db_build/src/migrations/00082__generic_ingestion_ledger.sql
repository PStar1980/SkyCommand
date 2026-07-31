-- Migration: 00082__generic_ingestion_ledger.sql
-- Phase 16.4.1: Adds the durable, domain-neutral ingestion run/item ledger.
-- The ledger records execution evidence independently of source, adapter, or KPI domain.

BEGIN;

CREATE TABLE IF NOT EXISTS data.ingestion_run_status_codes (
  status_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  terminal BOOLEAN NOT NULL DEFAULT FALSE,
  success_like BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_run_status_codes_code_check
    CHECK (status_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.ingestion_run_status_codes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS data.ingestion_item_outcome_codes (
  outcome_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  terminal BOOLEAN NOT NULL DEFAULT TRUE,
  success_like BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_item_outcome_codes_code_check
    CHECK (outcome_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.ingestion_item_outcome_codes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS data.ingestion_error_categories (
  error_category_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  retryable_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_error_categories_code_check
    CHECK (error_category_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.ingestion_error_categories OWNER TO postgres;

CREATE TABLE IF NOT EXISTS data.ingestion_runs (
  ingestion_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES data.domains(domain_id),
  source_id UUID NOT NULL REFERENCES data.sources(source_id),
  tool_id UUID REFERENCES core.tools(tool_id) ON DELETE SET NULL,
  script_execution_id UUID REFERENCES auth.script_execution_log(execution_id) ON DELETE SET NULL,
  workflow_run_record_id UUID REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE SET NULL,
  workflow_node_run_record_id UUID REFERENCES worker.workflow_node_run_records(workflow_node_run_record_id) ON DELETE SET NULL,
  resumed_from_run_id UUID REFERENCES data.ingestion_runs(ingestion_run_id) ON DELETE SET NULL,
  temporal_workflow_id TEXT,
  temporal_run_id TEXT,
  mode_code TEXT NOT NULL DEFAULT 'INCREMENTAL',
  trigger_code TEXT NOT NULL DEFAULT 'UNKNOWN',
  status_code TEXT NOT NULL DEFAULT 'RUNNING'
    REFERENCES data.ingestion_run_status_codes(status_code),
  contract_version TEXT NOT NULL DEFAULT 'ingestion_run_summary.v1',
  selected_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  capabilities_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  items_requested INTEGER NOT NULL DEFAULT 0,
  items_succeeded INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  items_unchanged INTEGER NOT NULL DEFAULT 0,
  rows_staged BIGINT NOT NULL DEFAULT 0,
  rows_detected_as_new BIGINT NOT NULL DEFAULT 0,
  rows_inserted BIGINT NOT NULL DEFAULT 0,
  rows_updated BIGINT NOT NULL DEFAULT 0,
  rows_unchanged BIGINT NOT NULL DEFAULT 0,
  rows_rejected BIGINT NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_category_code TEXT REFERENCES data.ingestion_error_categories(error_category_code),
  error_code TEXT,
  error_message TEXT,
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_runs_mode_code_check
    CHECK (mode_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_ingestion_runs_trigger_code_check
    CHECK (trigger_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_ingestion_runs_contract_check
    CHECK (contract_version ~ '^[a-z][a-z0-9_]*([.]v[1-9][0-9]*)?$'),
  CONSTRAINT data_ingestion_runs_selected_assets_check
    CHECK (jsonb_typeof(selected_assets) = 'array'),
  CONSTRAINT data_ingestion_runs_capabilities_check
    CHECK (jsonb_typeof(capabilities_snapshot) = 'object'),
  CONSTRAINT data_ingestion_runs_request_context_check
    CHECK (jsonb_typeof(request_context) = 'object'),
  CONSTRAINT data_ingestion_runs_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT data_ingestion_runs_counts_nonnegative_check
    CHECK (
      items_requested >= 0 AND items_succeeded >= 0 AND items_failed >= 0
      AND items_updated >= 0 AND items_unchanged >= 0
      AND rows_staged >= 0 AND rows_detected_as_new >= 0 AND rows_inserted >= 0
      AND rows_updated >= 0 AND rows_unchanged >= 0 AND rows_rejected >= 0
      AND attempt_count >= 0 AND retry_count >= 0
    ),
  CONSTRAINT data_ingestion_runs_duration_nonnegative_check
    CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT data_ingestion_runs_completed_after_started_check
    CHECK (completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT data_ingestion_runs_error_message_bounded_check
    CHECK (error_message IS NULL OR char_length(error_message) <= 4000)
);

ALTER TABLE data.ingestion_runs OWNER TO postgres;

COMMENT ON TABLE data.ingestion_runs IS
  'Durable generic ingestion-run ledger. Stores domain/source execution evidence independently of source implementation and presentation layer.';
COMMENT ON COLUMN data.ingestion_runs.script_execution_id IS
  'Optional link to auth.script_execution_log when the run originated from a SkyCommand tool execution.';
COMMENT ON COLUMN data.ingestion_runs.workflow_run_record_id IS
  'Optional link to the durable SkyCommand workflow run that launched the ingestion.';
COMMENT ON COLUMN data.ingestion_runs.resumed_from_run_id IS
  'Reserved recovery lineage for failed-only resume and replay support introduced later in Phase 16.';

CREATE INDEX IF NOT EXISTS idx_data_ingestion_runs_domain_source_started
  ON data.ingestion_runs (domain_id, source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_runs_status_started
  ON data.ingestion_runs (status_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_runs_script_execution
  ON data.ingestion_runs (script_execution_id)
  WHERE script_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_data_ingestion_runs_workflow_run
  ON data.ingestion_runs (workflow_run_record_id)
  WHERE workflow_run_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS data.ingestion_run_items (
  ingestion_run_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id UUID NOT NULL REFERENCES data.ingestion_runs(ingestion_run_id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES data.assets(asset_id),
  attempt_number INTEGER NOT NULL DEFAULT 1,
  outcome_code TEXT NOT NULL REFERENCES data.ingestion_item_outcome_codes(outcome_code),
  retryable BOOLEAN,
  http_status INTEGER,
  source_min_date DATE,
  source_max_date DATE,
  previous_target_max_date DATE,
  current_target_max_date DATE,
  rows_staged BIGINT NOT NULL DEFAULT 0,
  rows_detected_as_new BIGINT NOT NULL DEFAULT 0,
  rows_inserted BIGINT NOT NULL DEFAULT 0,
  rows_updated BIGINT NOT NULL DEFAULT 0,
  rows_unchanged BIGINT NOT NULL DEFAULT 0,
  rows_rejected BIGINT NOT NULL DEFAULT 0,
  error_category_code TEXT REFERENCES data.ingestion_error_categories(error_category_code),
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_run_items_attempt_check
    CHECK (attempt_number >= 1),
  CONSTRAINT data_ingestion_run_items_http_status_check
    CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599)),
  CONSTRAINT data_ingestion_run_items_counts_nonnegative_check
    CHECK (
      rows_staged >= 0 AND rows_detected_as_new >= 0 AND rows_inserted >= 0
      AND rows_updated >= 0 AND rows_unchanged >= 0 AND rows_rejected >= 0
    ),
  CONSTRAINT data_ingestion_run_items_duration_nonnegative_check
    CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT data_ingestion_run_items_completed_after_started_check
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  CONSTRAINT data_ingestion_run_items_diagnostics_check
    CHECK (jsonb_typeof(diagnostics) = 'object'),
  CONSTRAINT data_ingestion_run_items_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT data_ingestion_run_items_error_message_bounded_check
    CHECK (error_message IS NULL OR char_length(error_message) <= 4000),
  UNIQUE (ingestion_run_id, asset_id, attempt_number)
);

ALTER TABLE data.ingestion_run_items OWNER TO postgres;

COMMENT ON TABLE data.ingestion_run_items IS
  'Durable per-asset attempt evidence for an ingestion run. Multiple rows for one asset represent retries without overwriting prior evidence.';

CREATE INDEX IF NOT EXISTS idx_data_ingestion_run_items_run_asset
  ON data.ingestion_run_items (ingestion_run_id, asset_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_run_items_asset_created
  ON data.ingestion_run_items (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_run_items_outcome
  ON data.ingestion_run_items (outcome_code, created_at DESC);

CREATE OR REPLACE FUNCTION data.validate_ingestion_run_alignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_domain_id UUID;
  profile_domain_id UUID;
  profile_source_id UUID;
  node_parent_run_id UUID;
BEGIN
  SELECT domain_id INTO source_domain_id
  FROM data.sources
  WHERE source_id = NEW.source_id;

  IF source_domain_id IS DISTINCT FROM NEW.domain_id THEN
    RAISE EXCEPTION 'Ingestion run source % does not belong to domain %.', NEW.source_id, NEW.domain_id;
  END IF;

  IF NEW.tool_id IS NOT NULL THEN
    SELECT data_domain_id, source_id
      INTO profile_domain_id, profile_source_id
    FROM data.ingestion_tool_profiles
    WHERE tool_id = NEW.tool_id
      AND active = TRUE;

    IF profile_domain_id IS NOT NULL
       AND (profile_domain_id IS DISTINCT FROM NEW.domain_id OR profile_source_id IS DISTINCT FROM NEW.source_id) THEN
      RAISE EXCEPTION 'Ingestion run tool profile does not align to run domain/source.';
    END IF;
  END IF;

  IF NEW.workflow_node_run_record_id IS NOT NULL THEN
    SELECT workflow_run_record_id INTO node_parent_run_id
    FROM worker.workflow_node_run_records
    WHERE workflow_node_run_record_id = NEW.workflow_node_run_record_id;

    IF NEW.workflow_run_record_id IS NOT NULL
       AND node_parent_run_id IS DISTINCT FROM NEW.workflow_run_record_id THEN
      RAISE EXCEPTION 'Workflow node run does not belong to the supplied workflow run.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION data.validate_ingestion_run_alignment() OWNER TO postgres;

CREATE OR REPLACE FUNCTION data.validate_ingestion_run_item_alignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  run_domain_id UUID;
  run_source_id UUID;
  asset_domain_id UUID;
  source_binding_exists BOOLEAN;
BEGIN
  SELECT domain_id, source_id
    INTO run_domain_id, run_source_id
  FROM data.ingestion_runs
  WHERE ingestion_run_id = NEW.ingestion_run_id;

  SELECT domain_id INTO asset_domain_id
  FROM data.assets
  WHERE asset_id = NEW.asset_id;

  IF asset_domain_id IS DISTINCT FROM run_domain_id THEN
    RAISE EXCEPTION 'Ingestion run item asset does not belong to the run domain.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM data.asset_source_bindings binding
    WHERE binding.asset_id = NEW.asset_id
      AND binding.source_id = run_source_id
  ) INTO source_binding_exists;

  IF NOT source_binding_exists THEN
    RAISE EXCEPTION 'Ingestion run item asset is not bound to the run source.';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION data.validate_ingestion_run_item_alignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS ingestion_runs_validate_alignment ON data.ingestion_runs;
CREATE CONSTRAINT TRIGGER ingestion_runs_validate_alignment
AFTER INSERT OR UPDATE OF domain_id, source_id, tool_id, workflow_run_record_id, workflow_node_run_record_id
ON data.ingestion_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.validate_ingestion_run_alignment();

DROP TRIGGER IF EXISTS ingestion_run_items_validate_alignment ON data.ingestion_run_items;
CREATE CONSTRAINT TRIGGER ingestion_run_items_validate_alignment
AFTER INSERT OR UPDATE OF ingestion_run_id, asset_id
ON data.ingestion_run_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.validate_ingestion_run_item_alignment();

DROP TRIGGER IF EXISTS ingestion_run_status_codes_set_updated_at ON data.ingestion_run_status_codes;
CREATE TRIGGER ingestion_run_status_codes_set_updated_at
BEFORE UPDATE ON data.ingestion_run_status_codes
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS ingestion_item_outcome_codes_set_updated_at ON data.ingestion_item_outcome_codes;
CREATE TRIGGER ingestion_item_outcome_codes_set_updated_at
BEFORE UPDATE ON data.ingestion_item_outcome_codes
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS ingestion_error_categories_set_updated_at ON data.ingestion_error_categories;
CREATE TRIGGER ingestion_error_categories_set_updated_at
BEFORE UPDATE ON data.ingestion_error_categories
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS ingestion_runs_set_updated_at ON data.ingestion_runs;
CREATE TRIGGER ingestion_runs_set_updated_at
BEFORE UPDATE ON data.ingestion_runs
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS ingestion_run_items_set_updated_at ON data.ingestion_run_items;
CREATE TRIGGER ingestion_run_items_set_updated_at
BEFORE UPDATE ON data.ingestion_run_items
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

CREATE OR REPLACE VIEW data.vw_ingestion_runs AS
SELECT
  run.ingestion_run_id,
  domain.domain_id,
  domain.domain_code,
  domain.name AS domain_name,
  source.source_id,
  source.source_code,
  source.name AS source_name,
  run.tool_id,
  tool.tool_code,
  tool.label AS tool_label,
  run.script_execution_id,
  run.workflow_run_record_id,
  run.workflow_node_run_record_id,
  run.resumed_from_run_id,
  run.temporal_workflow_id,
  run.temporal_run_id,
  run.mode_code,
  run.trigger_code,
  run.status_code,
  status.name AS status_name,
  status.terminal,
  status.success_like,
  run.contract_version,
  run.selected_assets,
  run.capabilities_snapshot,
  run.request_context,
  run.items_requested,
  run.items_succeeded,
  run.items_failed,
  run.items_updated,
  run.items_unchanged,
  run.rows_staged,
  run.rows_detected_as_new,
  run.rows_inserted,
  run.rows_updated,
  run.rows_unchanged,
  run.rows_rejected,
  run.attempt_count,
  run.retry_count,
  run.error_category_code,
  run.error_code,
  run.error_message,
  run.summary,
  run.started_at,
  run.completed_at,
  run.duration_ms,
  run.metadata,
  run.created_at,
  run.updated_at
FROM data.ingestion_runs run
JOIN data.domains domain ON domain.domain_id = run.domain_id
JOIN data.sources source ON source.source_id = run.source_id
JOIN data.ingestion_run_status_codes status ON status.status_code = run.status_code
LEFT JOIN core.tools tool ON tool.tool_id = run.tool_id;

ALTER VIEW data.vw_ingestion_runs OWNER TO postgres;

CREATE OR REPLACE VIEW data.vw_ingestion_run_items AS
SELECT
  item.ingestion_run_item_id,
  item.ingestion_run_id,
  run.domain_id,
  run.domain_code,
  run.source_id,
  run.source_code,
  asset.asset_id,
  asset.asset_code,
  asset.name AS asset_name,
  item.attempt_number,
  item.outcome_code,
  outcome.name AS outcome_name,
  outcome.success_like,
  item.retryable,
  item.http_status,
  item.source_min_date,
  item.source_max_date,
  item.previous_target_max_date,
  item.current_target_max_date,
  item.rows_staged,
  item.rows_detected_as_new,
  item.rows_inserted,
  item.rows_updated,
  item.rows_unchanged,
  item.rows_rejected,
  item.error_category_code,
  item.error_code,
  item.error_message,
  item.started_at,
  item.completed_at,
  item.duration_ms,
  item.diagnostics,
  item.metadata,
  item.created_at,
  item.updated_at
FROM data.ingestion_run_items item
JOIN data.vw_ingestion_runs run ON run.ingestion_run_id = item.ingestion_run_id
JOIN data.assets asset ON asset.asset_id = item.asset_id
JOIN data.ingestion_item_outcome_codes outcome ON outcome.outcome_code = item.outcome_code;

ALTER VIEW data.vw_ingestion_run_items OWNER TO postgres;

COMMENT ON VIEW data.vw_ingestion_runs IS
  'Portable ingestion-run read model for APIs, operational surfaces, and downstream applications.';
COMMENT ON VIEW data.vw_ingestion_run_items IS
  'Portable per-asset attempt read model retaining retries and normalized diagnostics.';

COMMIT;
