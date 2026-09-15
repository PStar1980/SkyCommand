-- Migration: 00129__database_upgrade_ledger.sql
-- Purpose: Adds the additive baseline and applied-change ledger used by the
-- non-destructive database upgrade engine.
--
-- This migration intentionally has no BEGIN/COMMIT wrapper. The upgrade runner
-- owns the transaction so a post-baseline SQL change and its receipt are atomic.
-- The destructive db:build path still consumes this file in its normal order.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.database_upgrade_baselines (
  baseline_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_contract TEXT NOT NULL
    CHECK (baseline_contract = 'skycommand_database_baseline.v1'),
  baseline_ordinal INTEGER NOT NULL
    CHECK (baseline_ordinal = 128),
  database_name TEXT NOT NULL
    CHECK (btrim(database_name) <> ''),
  database_server_version TEXT,
  source_revision TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_database_upgrade_baseline_contract_ordinal
  ON core.database_upgrade_baselines (baseline_contract, baseline_ordinal);

CREATE TABLE IF NOT EXISTS core.database_upgrade_ledger (
  change_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  baseline_id UUID NOT NULL
    REFERENCES core.database_upgrade_baselines (baseline_id),
  ordinal INTEGER PRIMARY KEY
    CHECK (ordinal > 128),
  change_kind TEXT NOT NULL
    CHECK (change_kind IN ('MIGRATION', 'SEED')),
  source_path TEXT NOT NULL UNIQUE
    CHECK (
      btrim(source_path) <> ''
      AND source_path NOT LIKE '/%'
      AND source_path NOT LIKE '%:%'
      AND source_path NOT LIKE '%..%'
      AND source_path NOT LIKE '%\\%'
    ),
  sha256 CHAR(64) NOT NULL
    CHECK (sha256 ~ '^[0-9A-Fa-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_revision TEXT,
  plan_digest CHAR(64)
    CHECK (plan_digest IS NULL OR plan_digest ~ '^[0-9A-Fa-f]{64}$'),
  runner_version TEXT NOT NULL DEFAULT 'database_upgrade.v1',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object')
);

COMMENT ON TABLE core.database_upgrade_baselines IS
  'Verified historical database baseline; historical SQL is not individually replayed or falsely ledgered.';
COMMENT ON TABLE core.database_upgrade_ledger IS
  'Immutable successful receipts for post-baseline incremental migration and seed changes.';
