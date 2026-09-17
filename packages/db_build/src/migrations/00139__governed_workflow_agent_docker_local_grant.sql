-- R4 corrective grant for the normal Docker-local control plane.
-- This migration adds one exact least-privilege resource grant and stores no credentials.

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
    RAISE EXCEPTION 'R4 assistant-http principal is unavailable for Docker-local grant';
  END IF;

  IF workflow_id IS NULL OR workflow_version_id IS NULL THEN
    RAISE EXCEPTION 'R4 repo-map-zip version 4 must be active and published for Docker-local grant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM core.vw_repository_paths
     WHERE LOWER(repo_code) = LOWER('SkyCommand')
       AND LOWER(profile_code) = LOWER('DOCKER_LOCAL')
  ) THEN
    RAISE EXCEPTION 'R4 SkyCommand DOCKER_LOCAL repository binding is unavailable';
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
    'DOCKER_LOCAL',
    'DOCKER_LOCAL',
    'repo-map-zip',
    '["WORKFLOW_RUN","REPO_MAP_GENERATE","REPO_ZIP_GENERATE","CAPABILITY_CATALOG_EXPORT","CORE_RUN_LOW_RISK_SCRIPT"]'::jsonb,
    'ACTIVE',
    jsonb_build_object(
      'managedBy', '00139__governed_workflow_agent_docker_local_grant',
      'pinnedWorkflowDefinitionId', workflow_id,
      'pinnedWorkflowVersionId', workflow_version_id,
      'pinnedVersionNumber', 4,
      'scope', 'R4_normal_docker_runtime'
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
