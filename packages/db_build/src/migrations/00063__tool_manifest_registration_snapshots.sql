-- ============================================================
-- Migration: 00063__tool_manifest_registration_snapshots.sql
-- Purpose:
-- Persists validated repository-manifest snapshots for registered
-- tools so SkyCommand can prove which manifest, entrypoint, schema,
-- and contract sample were accepted at registration time.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS core.tool_manifest_snapshots (
  tool_manifest_snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES core.tools(tool_id) ON DELETE CASCADE,
  source_repo_id UUID NOT NULL REFERENCES core.repositories(repo_id),
  manifest_version TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  runtime_type TEXT NOT NULL,
  entrypoint_path TEXT NOT NULL,
  output_type TEXT NOT NULL,
  result_required BOOLEAN NOT NULL DEFAULT FALSE,
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  entrypoint_hash TEXT NOT NULL CHECK (entrypoint_hash ~ '^[a-f0-9]{64}$'),
  output_schema_hash TEXT CHECK (output_schema_hash IS NULL OR output_schema_hash ~ '^[a-f0-9]{64}$'),
  contract_sample_hash TEXT CHECK (contract_sample_hash IS NULL OR contract_sample_hash ~ '^[a-f0-9]{64}$'),
  validator_version TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'VALID'
    CHECK (validation_status IN ('VALID', 'DRIFTED', 'INVALID', 'MISSING', 'SUPERSEDED')),
  validation_details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(validation_details) = 'object'),
  manifest_snapshot JSONB NOT NULL
    CHECK (jsonb_typeof(manifest_snapshot) = 'object'),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tool_id, manifest_hash, entrypoint_hash)
);

ALTER TABLE core.tool_manifest_snapshots OWNER TO postgres;

COMMENT ON TABLE core.tool_manifest_snapshots IS
  'Versioned validated snapshots of repository skycommand.tool.json contracts associated with registered tools.';
COMMENT ON COLUMN core.tool_manifest_snapshots.manifest_path IS
  'Repository-relative path to the accepted skycommand.tool.json file.';
COMMENT ON COLUMN core.tool_manifest_snapshots.manifest_snapshot IS
  'Normalized, validated manifest captured at snapshot registration time.';
COMMENT ON COLUMN core.tool_manifest_snapshots.validation_details IS
  'Safe validation, mismatch, or drift findings. Never stores secret parameter values.';
COMMENT ON COLUMN core.tool_manifest_snapshots.is_current IS
  'Marks the accepted snapshot currently associated with a tool. Historical snapshots remain available.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_tool_manifest_snapshots_current
  ON core.tool_manifest_snapshots (tool_id)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_core_tool_manifest_snapshots_status
  ON core.tool_manifest_snapshots (validation_status, is_current);

CREATE INDEX IF NOT EXISTS idx_core_tool_manifest_snapshots_manifest_hash
  ON core.tool_manifest_snapshots (manifest_hash);

CREATE INDEX IF NOT EXISTS idx_core_tool_manifest_snapshots_entrypoint_hash
  ON core.tool_manifest_snapshots (entrypoint_hash);

DROP TRIGGER IF EXISTS tool_manifest_snapshots_set_updated_at
  ON core.tool_manifest_snapshots;

CREATE TRIGGER tool_manifest_snapshots_set_updated_at
BEFORE UPDATE ON core.tool_manifest_snapshots
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();

CREATE OR REPLACE VIEW core.vw_tool_manifest_snapshot_status AS
SELECT
  snapshot.tool_manifest_snapshot_id,
  tool.tool_id,
  tool.tool_code,
  tool.label AS tool_label,
  repository.repo_id AS source_repo_id,
  repository.repo_code AS source_repo_code,
  snapshot.manifest_version,
  snapshot.manifest_path,
  snapshot.runtime_type,
  snapshot.entrypoint_path,
  snapshot.output_type,
  snapshot.result_required,
  snapshot.manifest_hash,
  snapshot.entrypoint_hash,
  snapshot.output_schema_hash,
  snapshot.contract_sample_hash,
  snapshot.validator_version,
  snapshot.validation_status,
  snapshot.validation_details,
  snapshot.is_current,
  snapshot.registered_at,
  snapshot.validated_at,
  snapshot.last_checked_at,
  snapshot.superseded_at,
  snapshot.created_at,
  snapshot.updated_at
FROM core.tool_manifest_snapshots snapshot
JOIN core.tools tool
  ON tool.tool_id = snapshot.tool_id
JOIN core.repositories repository
  ON repository.repo_id = snapshot.source_repo_id;

ALTER VIEW core.vw_tool_manifest_snapshot_status OWNER TO postgres;

COMMENT ON VIEW core.vw_tool_manifest_snapshot_status IS
  'Current and historical tool-manifest snapshot status with registered tool and repository identity.';

COMMIT;
