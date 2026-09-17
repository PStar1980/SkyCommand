-- R4 governed Workflow execution for coding-agent adapters.
-- This migration stores no credentials or secret values. Authority remains a
-- server-side principal/resource grant decision at admission time.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS auth.workflow_execution_principals (
  workflow_execution_principal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'REVOKED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workflow_execution_principals_code_ck
    CHECK (principal_code ~ '^[A-Za-z0-9_.:-]{1,128}$')
);

CREATE TABLE IF NOT EXISTS worker.workflow_execution_resource_grants (
  workflow_execution_resource_grant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_execution_principal_id UUID NOT NULL
    REFERENCES auth.workflow_execution_principals(workflow_execution_principal_id),
  repository_code TEXT NOT NULL,
  environment_code TEXT NOT NULL,
  config_profile_code TEXT NOT NULL,
  workflow_code TEXT NOT NULL,
  allowed_permission_codes JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(allowed_permission_codes) = 'array'),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'REVOKED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workflow_execution_resource_grant_scope_ck
    CHECK (
      length(trim(repository_code)) > 0
      AND length(trim(environment_code)) > 0
      AND length(trim(config_profile_code)) > 0
      AND length(trim(workflow_code)) > 0
    ),
  CONSTRAINT workflow_execution_resource_grant_unique_scope
    UNIQUE (
      workflow_execution_principal_id,
      repository_code,
      environment_code,
      config_profile_code,
      workflow_code
    )
);

CREATE TABLE IF NOT EXISTS worker.workflow_execution_admissions (
  workflow_execution_admission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_execution_principal_id UUID NOT NULL
    REFERENCES auth.workflow_execution_principals(workflow_execution_principal_id),
  workflow_execution_resource_grant_id UUID NOT NULL
    REFERENCES worker.workflow_execution_resource_grants(workflow_execution_resource_grant_id),
  workflow_run_record_id UUID NOT NULL UNIQUE,
  idempotency_key_hash TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  workflow_code TEXT NOT NULL,
  workflow_definition_id UUID NOT NULL,
  workflow_version_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  repository_code TEXT NOT NULL,
  environment_code TEXT NOT NULL,
  config_profile_code TEXT NOT NULL,
  validated_parameters JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(validated_parameters) = 'object'),
  parameter_contract JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(parameter_contract) = 'array'),
  status TEXT NOT NULL DEFAULT 'ADMITTED'
    CHECK (status IN ('ADMITTED', 'STARTING', 'STARTED', 'FAILED', 'CANCELED')),
  temporal_workflow_id TEXT,
  temporal_run_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workflow_execution_admission_key_ck
    CHECK (length(idempotency_key_hash) = 64 AND idempotency_key_hash ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT workflow_execution_admission_digest_ck
    CHECK (length(request_digest) = 64 AND request_digest ~ '^[A-Fa-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_execution_admission_principal_key
  ON worker.workflow_execution_admissions (
    workflow_execution_principal_id,
    idempotency_key_hash
  );

CREATE INDEX IF NOT EXISTS idx_workflow_execution_admission_run
  ON worker.workflow_execution_admissions (workflow_run_record_id);

CREATE INDEX IF NOT EXISTS idx_workflow_execution_admission_principal_status
  ON worker.workflow_execution_admissions (
    workflow_execution_principal_id,
    status,
    created_at DESC
  );

COMMENT ON TABLE auth.workflow_execution_principals IS
  'Server-side authenticated principals allowed to request governed Workflow execution; never stores credentials.';

COMMENT ON TABLE worker.workflow_execution_resource_grants IS
  'Exact principal/repository/environment/profile/workflow resource grants and permission closure.';

COMMENT ON TABLE worker.workflow_execution_admissions IS
  'Durable R4 admission, pinned-version, idempotency, digest, and safe Temporal correlation ledger.';

INSERT INTO auth.workflow_execution_principals (
  principal_code,
  display_name,
  auth_mode,
  status,
  metadata
)
VALUES (
  'assistant-http',
  'SkyCommand Assistant HTTP integration',
  'ASSISTANT_SERVICE_TOKEN',
  'ACTIVE',
  '{"managedBy":"00138__governed_workflow_agent_execution","scope":"R4"}'::jsonb
)
ON CONFLICT (principal_code)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  auth_mode = EXCLUDED.auth_mode,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = CURRENT_TIMESTAMP;

DO $$
DECLARE
  principal_id UUID;
  workflow_id UUID;
  workflow_version_id UUID;
BEGIN
  SELECT workflow_execution_principal_id
    INTO principal_id
    FROM auth.workflow_execution_principals
   WHERE principal_code = 'assistant-http'
     AND status = 'ACTIVE';

  SELECT workflow_definition_id, published_version_id
    INTO workflow_id, workflow_version_id
    FROM worker.vw_workflow_definitions
   WHERE workflow_code = 'repo-map-zip'
     AND enabled = TRUE
     AND status = 'ACTIVE'
     AND published_version_number = 4
   LIMIT 1;

  IF principal_id IS NULL THEN
    RAISE EXCEPTION 'R4 assistant-http principal seed is unavailable';
  END IF;

  IF workflow_id IS NULL OR workflow_version_id IS NULL THEN
    RAISE EXCEPTION 'R4 repo-map-zip version 4 must be active and published before grant seed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM core.vw_repository_paths
     WHERE LOWER(repo_code) = LOWER('SkyCommand')
       AND LOWER(profile_code) = LOWER('DEV_LOCAL')
  ) THEN
    RAISE EXCEPTION 'R4 SkyCommand DEV_LOCAL repository binding is unavailable';
  END IF;

  INSERT INTO worker.workflow_execution_resource_grants (
    workflow_execution_principal_id,
    repository_code,
    environment_code,
    config_profile_code,
    workflow_code,
    allowed_permission_codes,
    status,
    metadata
  )
  VALUES (
    principal_id,
    'SkyCommand',
    'DEV_LOCAL',
    'DEV_LOCAL',
    'repo-map-zip',
    '["WORKFLOW_RUN","REPO_MAP_GENERATE","REPO_ZIP_GENERATE","CAPABILITY_CATALOG_EXPORT","CORE_RUN_LOW_RISK_SCRIPT"]'::jsonb,
    'ACTIVE',
    jsonb_build_object(
      'managedBy', '00138__governed_workflow_agent_execution',
      'pinnedWorkflowDefinitionId', workflow_id,
      'pinnedWorkflowVersionId', workflow_version_id,
      'pinnedVersionNumber', 4,
      'scope', 'R4_acceptance'
    )
  )
  ON CONFLICT (
    workflow_execution_principal_id,
    repository_code,
    environment_code,
    config_profile_code,
    workflow_code
  )
  DO UPDATE SET
    allowed_permission_codes = EXCLUDED.allowed_permission_codes,
    status = EXCLUDED.status,
    metadata = EXCLUDED.metadata,
    updated_at = CURRENT_TIMESTAMP;
END $$;
