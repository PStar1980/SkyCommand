-- Migration: 00086__revision_quality_foundation.sql
-- Phase 16.6.1: Adds portable revision and data-quality evidence to the generic ingestion ledger.

BEGIN;

CREATE TABLE IF NOT EXISTS data.ingestion_quality_status_codes (
  quality_status_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  successful BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_quality_status_codes_code_check
    CHECK (quality_status_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.ingestion_quality_status_codes OWNER TO postgres;

-- Bootstrap referenced statuses so this migration remains independently executable
-- before the richer descriptive seed is applied.
INSERT INTO data.ingestion_quality_status_codes (
  quality_status_code, name, description, successful, active
)
VALUES
  ('PASS', 'Pass', 'No blocking or warning quality findings were recorded.', TRUE, TRUE),
  ('WARN', 'Warning', 'Non-blocking quality findings were recorded.', TRUE, TRUE),
  ('FAIL', 'Fail', 'A blocking quality finding prevented trustworthy loading.', FALSE, TRUE)
ON CONFLICT (quality_status_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS data.ingestion_quality_severity_codes (
  severity_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_quality_severity_codes_code_check
    CHECK (severity_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_ingestion_quality_severity_codes_order_check
    CHECK (display_order >= 0)
);

ALTER TABLE data.ingestion_quality_severity_codes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS data.ingestion_quality_check_codes (
  check_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_severity_code TEXT NOT NULL
    REFERENCES data.ingestion_quality_severity_codes(severity_code),
  blocking_default BOOLEAN NOT NULL DEFAULT FALSE,
  row_level BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_quality_check_codes_code_check
    CHECK (check_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.ingestion_quality_check_codes OWNER TO postgres;

ALTER TABLE data.ingestion_runs
  ADD COLUMN IF NOT EXISTS revisions_detected BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_issue_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_status_code TEXT NOT NULL DEFAULT 'PASS';

ALTER TABLE data.ingestion_runs
  DROP CONSTRAINT IF EXISTS data_ingestion_runs_quality_status_fk;
ALTER TABLE data.ingestion_runs
  ADD CONSTRAINT data_ingestion_runs_quality_status_fk
  FOREIGN KEY (quality_status_code)
  REFERENCES data.ingestion_quality_status_codes(quality_status_code)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE data.ingestion_runs
  DROP CONSTRAINT IF EXISTS data_ingestion_runs_revision_quality_counts_check;
ALTER TABLE data.ingestion_runs
  ADD CONSTRAINT data_ingestion_runs_revision_quality_counts_check
  CHECK (revisions_detected >= 0 AND quality_issue_count >= 0);

ALTER TABLE data.ingestion_run_items
  ADD COLUMN IF NOT EXISTS revisions_detected BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_issue_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_status_code TEXT NOT NULL DEFAULT 'PASS';

ALTER TABLE data.ingestion_run_items
  DROP CONSTRAINT IF EXISTS data_ingestion_run_items_quality_status_fk;
ALTER TABLE data.ingestion_run_items
  ADD CONSTRAINT data_ingestion_run_items_quality_status_fk
  FOREIGN KEY (quality_status_code)
  REFERENCES data.ingestion_quality_status_codes(quality_status_code)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE data.ingestion_run_items
  DROP CONSTRAINT IF EXISTS data_ingestion_run_items_revision_quality_counts_check;
ALTER TABLE data.ingestion_run_items
  ADD CONSTRAINT data_ingestion_run_items_revision_quality_counts_check
  CHECK (revisions_detected >= 0 AND quality_issue_count >= 0);

CREATE TABLE IF NOT EXISTS data.ingestion_revision_events (
  revision_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id UUID NOT NULL
    REFERENCES data.ingestion_runs(ingestion_run_id) ON DELETE CASCADE,
  ingestion_run_item_id UUID NOT NULL
    REFERENCES data.ingestion_run_items(ingestion_run_item_id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES data.assets(asset_id),
  observation_key TEXT NOT NULL,
  observation_date DATE,
  old_value JSONB NOT NULL,
  new_value JSONB NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_revision_events_key_check
    CHECK (char_length(observation_key) BETWEEN 1 AND 1000),
  CONSTRAINT data_ingestion_revision_events_old_value_check
    CHECK (jsonb_typeof(old_value) IN ('object', 'array', 'string', 'number', 'boolean', 'null')),
  CONSTRAINT data_ingestion_revision_events_new_value_check
    CHECK (jsonb_typeof(new_value) IN ('object', 'array', 'string', 'number', 'boolean', 'null')),
  CONSTRAINT data_ingestion_revision_events_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (ingestion_run_item_id, observation_key)
);

ALTER TABLE data.ingestion_revision_events OWNER TO postgres;

COMMENT ON TABLE data.ingestion_revision_events IS
  'Durable revision evidence recording old/new values when a provider changes an existing observation or record.';

CREATE INDEX IF NOT EXISTS idx_data_ingestion_revision_events_asset_detected
  ON data.ingestion_revision_events (asset_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_revision_events_run_item
  ON data.ingestion_revision_events (ingestion_run_id, ingestion_run_item_id);

CREATE TABLE IF NOT EXISTS data.ingestion_quality_events (
  quality_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id UUID NOT NULL
    REFERENCES data.ingestion_runs(ingestion_run_id) ON DELETE CASCADE,
  ingestion_run_item_id UUID NOT NULL
    REFERENCES data.ingestion_run_items(ingestion_run_item_id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES data.assets(asset_id),
  check_code TEXT NOT NULL REFERENCES data.ingestion_quality_check_codes(check_code),
  severity_code TEXT NOT NULL REFERENCES data.ingestion_quality_severity_codes(severity_code),
  blocking BOOLEAN NOT NULL DEFAULT FALSE,
  observation_key TEXT,
  source_row_number BIGINT,
  message TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_quality_events_row_number_check
    CHECK (source_row_number IS NULL OR source_row_number >= 1),
  CONSTRAINT data_ingestion_quality_events_message_check
    CHECK (char_length(message) BETWEEN 1 AND 4000),
  CONSTRAINT data_ingestion_quality_events_evidence_check
    CHECK (jsonb_typeof(evidence) = 'object')
);

ALTER TABLE data.ingestion_quality_events OWNER TO postgres;

COMMENT ON TABLE data.ingestion_quality_events IS
  'Portable run/item quality evidence for blocking and non-blocking validation findings.';

CREATE INDEX IF NOT EXISTS idx_data_ingestion_quality_events_run_item
  ON data.ingestion_quality_events (ingestion_run_id, ingestion_run_item_id);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_quality_events_asset_check
  ON data.ingestion_quality_events (asset_id, check_code, created_at DESC);

CREATE TABLE IF NOT EXISTS data.ingestion_rejection_events (
  rejection_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id UUID NOT NULL
    REFERENCES data.ingestion_runs(ingestion_run_id) ON DELETE CASCADE,
  ingestion_run_item_id UUID NOT NULL
    REFERENCES data.ingestion_run_items(ingestion_run_item_id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES data.assets(asset_id),
  check_code TEXT NOT NULL REFERENCES data.ingestion_quality_check_codes(check_code),
  severity_code TEXT NOT NULL REFERENCES data.ingestion_quality_severity_codes(severity_code),
  source_row_number BIGINT,
  observation_key TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_rejection_events_row_number_check
    CHECK (source_row_number IS NULL OR source_row_number >= 1),
  CONSTRAINT data_ingestion_rejection_events_message_check
    CHECK (char_length(message) BETWEEN 1 AND 4000),
  CONSTRAINT data_ingestion_rejection_events_raw_payload_check
    CHECK (jsonb_typeof(raw_payload) = 'object'),
  CONSTRAINT data_ingestion_rejection_events_normalized_payload_check
    CHECK (jsonb_typeof(normalized_payload) = 'object'),
  CONSTRAINT data_ingestion_rejection_events_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

ALTER TABLE data.ingestion_rejection_events OWNER TO postgres;

COMMENT ON TABLE data.ingestion_rejection_events IS
  'Rejected-row evidence retained instead of silently discarding invalid or duplicate source records.';

CREATE INDEX IF NOT EXISTS idx_data_ingestion_rejection_events_run_item
  ON data.ingestion_rejection_events (ingestion_run_id, ingestion_run_item_id);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_rejection_events_asset_check
  ON data.ingestion_rejection_events (asset_id, check_code, created_at DESC);

CREATE OR REPLACE FUNCTION data.validate_ingestion_revision_event_alignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  item_run_id UUID;
  item_asset_id UUID;
BEGIN
  SELECT ingestion_run_id, asset_id
  INTO item_run_id, item_asset_id
  FROM data.ingestion_run_items
  WHERE ingestion_run_item_id = NEW.ingestion_run_item_id;

  IF item_run_id IS NULL OR item_asset_id IS NULL THEN
    RAISE EXCEPTION 'Revision event references a missing ingestion item.';
  END IF;

  IF NEW.ingestion_run_id <> item_run_id OR NEW.asset_id <> item_asset_id THEN
    RAISE EXCEPTION 'Revision event run/item/asset identity is not aligned.';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION data.validate_ingestion_revision_event_alignment() OWNER TO postgres;

CREATE OR REPLACE FUNCTION data.validate_ingestion_quality_event_alignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  item_run_id UUID;
  item_asset_id UUID;
BEGIN
  SELECT ingestion_run_id, asset_id
  INTO item_run_id, item_asset_id
  FROM data.ingestion_run_items
  WHERE ingestion_run_item_id = NEW.ingestion_run_item_id;

  IF item_run_id IS NULL OR item_asset_id IS NULL THEN
    RAISE EXCEPTION 'Quality evidence references a missing ingestion item.';
  END IF;

  IF NEW.ingestion_run_id <> item_run_id OR NEW.asset_id <> item_asset_id THEN
    RAISE EXCEPTION 'Quality evidence run/item/asset identity is not aligned.';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION data.validate_ingestion_quality_event_alignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS ingestion_revision_events_validate_alignment
  ON data.ingestion_revision_events;
CREATE CONSTRAINT TRIGGER ingestion_revision_events_validate_alignment
AFTER INSERT OR UPDATE ON data.ingestion_revision_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION data.validate_ingestion_revision_event_alignment();

DROP TRIGGER IF EXISTS ingestion_quality_events_validate_alignment
  ON data.ingestion_quality_events;
CREATE CONSTRAINT TRIGGER ingestion_quality_events_validate_alignment
AFTER INSERT OR UPDATE ON data.ingestion_quality_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION data.validate_ingestion_quality_event_alignment();

DROP TRIGGER IF EXISTS ingestion_rejection_events_validate_alignment
  ON data.ingestion_rejection_events;
CREATE CONSTRAINT TRIGGER ingestion_rejection_events_validate_alignment
AFTER INSERT OR UPDATE ON data.ingestion_rejection_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION data.validate_ingestion_quality_event_alignment();

DROP TRIGGER IF EXISTS ingestion_quality_status_codes_set_updated_at
  ON data.ingestion_quality_status_codes;
CREATE TRIGGER ingestion_quality_status_codes_set_updated_at
BEFORE UPDATE ON data.ingestion_quality_status_codes
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS ingestion_quality_severity_codes_set_updated_at
  ON data.ingestion_quality_severity_codes;
CREATE TRIGGER ingestion_quality_severity_codes_set_updated_at
BEFORE UPDATE ON data.ingestion_quality_severity_codes
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS ingestion_quality_check_codes_set_updated_at
  ON data.ingestion_quality_check_codes;
CREATE TRIGGER ingestion_quality_check_codes_set_updated_at
BEFORE UPDATE ON data.ingestion_quality_check_codes
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
  run.updated_at,
  run.revisions_detected,
  run.quality_issue_count,
  run.quality_status_code
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
  item.updated_at,
  item.revisions_detected,
  item.quality_issue_count,
  item.quality_status_code
FROM data.ingestion_run_items item
JOIN data.vw_ingestion_runs run ON run.ingestion_run_id = item.ingestion_run_id
JOIN data.assets asset ON asset.asset_id = item.asset_id
JOIN data.ingestion_item_outcome_codes outcome ON outcome.outcome_code = item.outcome_code;

ALTER VIEW data.vw_ingestion_run_items OWNER TO postgres;

CREATE OR REPLACE VIEW data.vw_ingestion_revision_events AS
SELECT
  event.revision_event_id,
  event.ingestion_run_id,
  event.ingestion_run_item_id,
  run.domain_code,
  run.source_code,
  asset.asset_code,
  asset.name AS asset_name,
  event.observation_key,
  event.observation_date,
  event.old_value,
  event.new_value,
  event.detected_at,
  event.metadata,
  event.created_at
FROM data.ingestion_revision_events event
JOIN data.vw_ingestion_runs run ON run.ingestion_run_id = event.ingestion_run_id
JOIN data.assets asset ON asset.asset_id = event.asset_id;

ALTER VIEW data.vw_ingestion_revision_events OWNER TO postgres;

CREATE OR REPLACE VIEW data.vw_ingestion_quality_events AS
SELECT
  event.quality_event_id,
  event.ingestion_run_id,
  event.ingestion_run_item_id,
  run.domain_code,
  run.source_code,
  asset.asset_code,
  asset.name AS asset_name,
  event.check_code,
  check_code.name AS check_name,
  event.severity_code,
  event.blocking,
  event.observation_key,
  event.source_row_number,
  event.message,
  event.evidence,
  event.created_at
FROM data.ingestion_quality_events event
JOIN data.vw_ingestion_runs run ON run.ingestion_run_id = event.ingestion_run_id
JOIN data.assets asset ON asset.asset_id = event.asset_id
JOIN data.ingestion_quality_check_codes check_code ON check_code.check_code = event.check_code;

ALTER VIEW data.vw_ingestion_quality_events OWNER TO postgres;

CREATE OR REPLACE VIEW data.vw_ingestion_rejection_events AS
SELECT
  event.rejection_event_id,
  event.ingestion_run_id,
  event.ingestion_run_item_id,
  run.domain_code,
  run.source_code,
  asset.asset_code,
  asset.name AS asset_name,
  event.check_code,
  check_code.name AS check_name,
  event.severity_code,
  event.source_row_number,
  event.observation_key,
  event.raw_payload,
  event.normalized_payload,
  event.message,
  event.metadata,
  event.created_at
FROM data.ingestion_rejection_events event
JOIN data.vw_ingestion_runs run ON run.ingestion_run_id = event.ingestion_run_id
JOIN data.assets asset ON asset.asset_id = event.asset_id
JOIN data.ingestion_quality_check_codes check_code ON check_code.check_code = event.check_code;

ALTER VIEW data.vw_ingestion_rejection_events OWNER TO postgres;

COMMIT;
