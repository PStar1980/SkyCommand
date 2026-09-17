-- Migration: 00132__database_upgrade_apply_execution_receipt.sql
-- Purpose: Adds separate durable D2B.2 execution evidence for an approved
-- database-upgrade request. It does not change the D2B.1 decision lifecycle.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.database_upgrade_apply_execution_receipts (
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL
    REFERENCES core.database_upgrade_apply_requests(request_id),
  request_digest CHAR(64) NOT NULL
    CHECK (request_digest ~ '^[0-9A-Fa-f]{64}$'),
  plan_digest CHAR(64) NOT NULL
    CHECK (plan_digest ~ '^[0-9A-Fa-f]{64}$'),
  database_name TEXT NOT NULL
    CHECK (database_name ~ '^[A-Za-z][A-Za-z0-9_]{0,62}$'),
  system_identifier TEXT NOT NULL
    CHECK (btrim(system_identifier) <> ''),
  executed_by_user_id UUID NOT NULL REFERENCES auth.users(user_id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  outcome TEXT NOT NULL CHECK (outcome IN ('STARTED', 'APPLIED', 'FAILED')),
  applied_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  result_identifiers JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(result_identifiers) = 'array'),
  before_ledger_state JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(before_ledger_state) = 'object'),
  after_ledger_state JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(after_ledger_state) = 'object'),
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (outcome = 'STARTED' AND completed_at IS NULL)
    OR (outcome IN ('APPLIED', 'FAILED') AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_database_upgrade_apply_execution_receipt_request
  ON core.database_upgrade_apply_execution_receipts (request_id);

CREATE INDEX IF NOT EXISTS ix_database_upgrade_apply_execution_receipt_outcome
  ON core.database_upgrade_apply_execution_receipts (outcome, started_at DESC);

COMMENT ON TABLE core.database_upgrade_apply_execution_receipts IS
  'Separate D2B.2 evidence for the single governed execution of a durable D2B.1 APPROVED request; contains safe identifiers and ledger state only.';
