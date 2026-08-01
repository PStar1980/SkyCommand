-- Migration: 00090__ingestion_recovery_foundation.sql
-- Phase 16.7.1: Durable, domain-neutral recovery requests for failed-only ingestion resume.

BEGIN;

CREATE TABLE IF NOT EXISTS data.ingestion_recovery_status_codes (
  status_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  terminal BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_recovery_status_codes_code_check
    CHECK (status_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.ingestion_recovery_status_codes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS data.ingestion_recovery_requests (
  recovery_request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_run_id UUID NOT NULL REFERENCES data.ingestion_runs(ingestion_run_id) ON DELETE RESTRICT,
  recovery_run_id UUID REFERENCES data.ingestion_runs(ingestion_run_id) ON DELETE SET NULL,
  domain_id UUID NOT NULL REFERENCES data.domains(domain_id),
  source_id UUID NOT NULL REFERENCES data.sources(source_id),
  tool_id UUID REFERENCES core.tools(tool_id) ON DELETE SET NULL,
  selection_code TEXT NOT NULL DEFAULT 'FAILED_ONLY',
  mode_code TEXT NOT NULL DEFAULT 'INCREMENTAL',
  trigger_code TEXT NOT NULL DEFAULT 'RECOVERY',
  requested_assets JSONB NOT NULL,
  failed_assets_snapshot JSONB NOT NULL,
  force_refresh BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  status_code TEXT NOT NULL DEFAULT 'PLANNED'
    REFERENCES data.ingestion_recovery_status_codes(status_code),
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_ingestion_recovery_requests_selection_check
    CHECK (selection_code IN ('FAILED_ONLY', 'EXPLICIT_ASSETS')),
  CONSTRAINT data_ingestion_recovery_requests_mode_check
    CHECK (mode_code IN ('INCREMENTAL', 'BACKFILL', 'FULL')),
  CONSTRAINT data_ingestion_recovery_requests_trigger_check
    CHECK (trigger_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_ingestion_recovery_requests_requested_assets_check
    CHECK (jsonb_typeof(requested_assets) = 'array' AND jsonb_array_length(requested_assets) > 0),
  CONSTRAINT data_ingestion_recovery_requests_failed_assets_check
    CHECK (jsonb_typeof(failed_assets_snapshot) = 'array'),
  CONSTRAINT data_ingestion_recovery_requests_context_check
    CHECK (jsonb_typeof(request_context) = 'object'),
  CONSTRAINT data_ingestion_recovery_requests_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT data_ingestion_recovery_requests_timing_check
    CHECK (
      (started_at IS NULL OR started_at >= requested_at)
      AND (completed_at IS NULL OR completed_at >= COALESCE(started_at, requested_at))
    ),
  CONSTRAINT data_ingestion_recovery_requests_error_bounded_check
    CHECK (error_message IS NULL OR char_length(error_message) <= 4000)
);

ALTER TABLE data.ingestion_recovery_requests OWNER TO postgres;

COMMENT ON TABLE data.ingestion_recovery_requests IS
  'Durable recovery intent and lineage for failed-only or explicit-asset ingestion reruns.';
COMMENT ON COLUMN data.ingestion_recovery_requests.failed_assets_snapshot IS
  'Terminal non-success assets reconstructed from the original durable run at planning time.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_ingestion_recovery_requests_recovery_run
  ON data.ingestion_recovery_requests (recovery_run_id)
  WHERE recovery_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_data_ingestion_recovery_requests_original
  ON data.ingestion_recovery_requests (original_run_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_ingestion_recovery_requests_status
  ON data.ingestion_recovery_requests (status_code, requested_at DESC);

CREATE OR REPLACE FUNCTION data.validate_ingestion_recovery_request_alignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  original_record data.ingestion_runs%ROWTYPE;
  recovery_record data.ingestion_runs%ROWTYPE;
  invalid_asset_count INTEGER;
  missing_failed_count INTEGER;
BEGIN
  SELECT * INTO original_record
  FROM data.ingestion_runs
  WHERE ingestion_run_id = NEW.original_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery request original run % does not exist.', NEW.original_run_id;
  END IF;

  IF original_record.domain_id <> NEW.domain_id
     OR original_record.source_id <> NEW.source_id
     OR original_record.tool_id IS DISTINCT FROM NEW.tool_id THEN
    RAISE EXCEPTION 'Recovery request identity does not match original run %.', NEW.original_run_id;
  END IF;

  SELECT COUNT(*)::int INTO invalid_asset_count
  FROM jsonb_array_elements_text(NEW.requested_assets) requested(asset_code)
  WHERE NOT EXISTS (
    SELECT 1
    FROM data.assets asset
    JOIN data.asset_source_bindings binding
      ON binding.asset_id = asset.asset_id
     AND binding.source_id = NEW.source_id
    WHERE asset.domain_id = NEW.domain_id
      AND asset.asset_code = upper(requested.asset_code)
  );

  IF invalid_asset_count > 0 THEN
    RAISE EXCEPTION 'Recovery request contains asset(s) not bound to its domain/source.';
  END IF;

  IF NEW.selection_code = 'FAILED_ONLY' THEN
    SELECT COUNT(*)::int INTO missing_failed_count
    FROM jsonb_array_elements_text(NEW.requested_assets) requested(asset_code)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(NEW.failed_assets_snapshot) failed(asset_code)
      WHERE upper(failed.asset_code) = upper(requested.asset_code)
    );

    IF missing_failed_count > 0 THEN
      RAISE EXCEPTION 'FAILED_ONLY recovery may contain only assets that failed in the original run.';
    END IF;
  END IF;

  IF NEW.recovery_run_id IS NOT NULL THEN
    SELECT * INTO recovery_record
    FROM data.ingestion_runs
    WHERE ingestion_run_id = NEW.recovery_run_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recovery run % does not exist.', NEW.recovery_run_id;
    END IF;

    IF recovery_record.resumed_from_run_id IS DISTINCT FROM NEW.original_run_id
       OR recovery_record.domain_id <> NEW.domain_id
       OR recovery_record.source_id <> NEW.source_id
       OR recovery_record.tool_id IS DISTINCT FROM NEW.tool_id THEN
      RAISE EXCEPTION 'Recovery run % is not aligned to request %.', NEW.recovery_run_id, NEW.recovery_request_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ingestion_recovery_request_validate_alignment
  ON data.ingestion_recovery_requests;
CREATE CONSTRAINT TRIGGER ingestion_recovery_request_validate_alignment
AFTER INSERT OR UPDATE ON data.ingestion_recovery_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION data.validate_ingestion_recovery_request_alignment();

CREATE OR REPLACE FUNCTION data.validate_resumed_ingestion_run_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.resumed_from_run_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM data.ingestion_recovery_requests request
    WHERE request.original_run_id = NEW.resumed_from_run_id
      AND request.recovery_run_id = NEW.ingestion_run_id
  ) THEN
    RAISE EXCEPTION 'Resumed ingestion run % has no aligned recovery request.', NEW.ingestion_run_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ingestion_run_validate_recovery_request
  ON data.ingestion_runs;
CREATE CONSTRAINT TRIGGER ingestion_run_validate_recovery_request
AFTER INSERT OR UPDATE OF resumed_from_run_id ON data.ingestion_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION data.validate_resumed_ingestion_run_request();

CREATE OR REPLACE VIEW data.vw_ingestion_recovery_requests AS
SELECT
  request.recovery_request_id,
  request.original_run_id,
  request.recovery_run_id,
  domain.domain_code,
  domain.name AS domain_name,
  source.source_code,
  source.name AS source_name,
  tool.tool_code,
  tool.label AS tool_label,
  profile.adapter_code,
  profile.supports_selected_assets,
  profile.supports_resume,
  request.selection_code,
  request.mode_code,
  request.trigger_code,
  request.requested_assets,
  request.failed_assets_snapshot,
  request.force_refresh,
  request.dry_run,
  request.status_code,
  status.name AS status_name,
  status.terminal,
  request.request_context,
  request.error_code,
  request.error_message,
  request.requested_at,
  request.started_at,
  request.completed_at,
  request.metadata,
  request.created_at,
  request.updated_at
FROM data.ingestion_recovery_requests request
JOIN data.domains domain ON domain.domain_id = request.domain_id
JOIN data.sources source ON source.source_id = request.source_id
LEFT JOIN core.tools tool ON tool.tool_id = request.tool_id
LEFT JOIN data.ingestion_tool_profiles profile ON profile.tool_id = request.tool_id
JOIN data.ingestion_recovery_status_codes status ON status.status_code = request.status_code;

ALTER VIEW data.vw_ingestion_recovery_requests OWNER TO postgres;

COMMIT;
