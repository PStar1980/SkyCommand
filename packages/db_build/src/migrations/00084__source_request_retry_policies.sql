-- Migration: 00084__source_request_retry_policies.sql
-- Phase 16.5.1: Adds PostgreSQL-authoritative request timeout and retry
-- policies for portable ingestion sources.

BEGIN;

CREATE TABLE IF NOT EXISTS data.source_request_policies (
  source_id UUID PRIMARY KEY REFERENCES data.sources(source_id) ON DELETE CASCADE,
  request_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  base_delay_ms INTEGER NOT NULL DEFAULT 750,
  max_delay_ms INTEGER NOT NULL DEFAULT 10000,
  max_elapsed_ms INTEGER NOT NULL DEFAULT 180000,
  jitter_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.2000,
  respect_retry_after BOOLEAN NOT NULL DEFAULT TRUE,
  retryable_http_statuses INTEGER[] NOT NULL DEFAULT ARRAY[408,425,429,500,502,503,504],
  retryable_error_codes TEXT[] NOT NULL DEFAULT ARRAY[
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETDOWN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ERR_NETWORK',
    'ETIMEDOUT'
  ],
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT source_request_policies_timeout_check CHECK (request_timeout_ms BETWEEN 1000 AND 900000),
  CONSTRAINT source_request_policies_attempts_check CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT source_request_policies_base_delay_check CHECK (base_delay_ms BETWEEN 0 AND 60000),
  CONSTRAINT source_request_policies_max_delay_check CHECK (max_delay_ms BETWEEN base_delay_ms AND 300000),
  CONSTRAINT source_request_policies_elapsed_check CHECK (max_elapsed_ms BETWEEN 1000 AND 3600000),
  CONSTRAINT source_request_policies_jitter_check CHECK (jitter_ratio BETWEEN 0 AND 1),
  CONSTRAINT source_request_policies_http_status_check CHECK (
    retryable_http_statuses <@ ARRAY[
      400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,
      421,422,423,424,425,426,428,429,431,451,500,501,502,503,504,505,506,507,508,510,511
    ]
  ),
  CONSTRAINT source_request_policies_configuration_object_check CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.source_request_policies OWNER TO postgres;

COMMENT ON TABLE data.source_request_policies IS
  'Portable source-level request timeout and retry policy used by the common ingestion adapter runner.';
COMMENT ON COLUMN data.source_request_policies.max_elapsed_ms IS
  'Maximum wall-clock budget for one source request including retries and backoff.';
COMMENT ON COLUMN data.source_request_policies.retryable_error_codes IS
  'Transport/runtime error codes eligible for retry. Authentication and validation failures are never inferred as retryable from this list.';

DROP TRIGGER IF EXISTS data_source_request_policies_set_updated_at
  ON data.source_request_policies;
CREATE TRIGGER data_source_request_policies_set_updated_at
BEFORE UPDATE ON data.source_request_policies
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

COMMIT;
