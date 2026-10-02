
-- Phase 19.3A1 C12: preserve immutable revision 1 and register a catalog-aligned
-- revision 2 for the managed Codex read-only observer. The current app-server
-- catalog advertises gpt-5.6-sol with low reasoning, while gpt-6-sol is absent.
-- This seed changes only the immutable Agent definition selection; provider,
-- account, capability, workspace, MCP, and network policy remain unchanged.

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM core.agent_definitions d
    JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
    WHERE d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
      AND v.revision = 1
      AND v.configuration ->> 'model' = 'gpt-6-sol'
      AND v.configuration ->> 'reasoningEffort' = 'low'
  ) THEN
    RAISE EXCEPTION 'Phase 19.3A1 revision 1 baseline is missing or no longer matches the reviewed gpt-6-sol/low definition.';
  END IF;
END
$preflight$;

WITH source_version AS (
  SELECT
    d.definition_id,
    v.installation_id,
    v.account_binding_id,
    v.capability_profile_id,
    v.configuration || jsonb_build_object(
      'model', 'gpt-5.6-sol',
      'reasoningEffort', 'low'
    ) AS configuration
  FROM core.agent_definitions d
  JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
  WHERE d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
    AND v.revision = 1
), prepared AS (
  SELECT
    s.*,
    upper(encode(digest(convert_to(
      jsonb_build_object(
        'agentCode', 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER',
        'revision', 2,
        'policyRevision', 'phase19.3a1.codex-readonly.catalog-v2',
        'configuration', s.configuration
      )::text,
      'UTF8'
    ), 'sha256'), 'hex')) AS content_digest,
    upper(encode(digest(convert_to(
      'work-order:phase19.3a1/catalog-aligned-read-only-run',
      'UTF8'
    ), 'sha256'), 'hex')) AS instruction_digest
  FROM source_version s
)
INSERT INTO core.agent_definition_versions (
  definition_id,
  revision,
  content_digest,
  instruction_reference,
  instruction_digest,
  installation_id,
  account_binding_id,
  capability_profile_id,
  policy_revision,
  configuration
)
SELECT
  p.definition_id,
  2,
  p.content_digest,
  'work-order:phase19.3a1/catalog-aligned-read-only-run',
  p.instruction_digest,
  p.installation_id,
  p.account_binding_id,
  p.capability_profile_id,
  'phase19.3a1.codex-readonly.catalog-v2',
  p.configuration
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM core.agent_definition_versions existing
  WHERE existing.definition_id = p.definition_id
    AND existing.revision = 2
);

DO $verify_revision$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM core.agent_definitions d
    JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
    WHERE d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
      AND v.revision = 2
      AND v.policy_revision = 'phase19.3a1.codex-readonly.catalog-v2'
      AND v.configuration ->> 'provider' = 'OPENAI_CODEX'
      AND v.configuration ->> 'runtimeKind' = 'OPENAI_CODEX_APP_SERVER'
      AND v.configuration ->> 'managedCapabilityCase' = 'codex-read-only-pilot'
      AND v.configuration ->> 'model' = 'gpt-5.6-sol'
      AND v.configuration ->> 'reasoningEffort' = 'low'
      AND v.configuration ->> 'sessionModel' = 'PERSISTENT'
  ) THEN
    RAISE EXCEPTION 'Phase 19.3A1 catalog-aligned revision 2 is missing or does not match the reviewed model configuration.';
  END IF;
END
$verify_revision$;

WITH project_row AS (
  SELECT project_id
  FROM core.projects
  WHERE project_code = 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE'
), version_row AS (
  SELECT d.definition_id, v.definition_version_id
  FROM core.agent_definitions d
  JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
  WHERE d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
    AND v.revision = 2
)
INSERT INTO core.project_agent_allow_rules (
  project_id,
  definition_id,
  definition_version_id,
  allow_state,
  policy_revision
)
SELECT
  p.project_id,
  v.definition_id,
  v.definition_version_id,
  'ACTIVE',
  'phase19.3a1.acceptance.catalog-v2'
FROM project_row p
CROSS JOIN version_row v
ON CONFLICT DO NOTHING;

-- The prior immutable version remains auditable but is no longer executable
-- through the Phase 19.3A1 acceptance Project.
UPDATE core.project_agent_allow_rules rule
SET allow_state = CASE
      WHEN rule.definition_version_id = (
        SELECT v.definition_version_id
        FROM core.agent_definitions d
        JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
        WHERE d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
          AND v.revision = 2
      ) THEN 'ACTIVE'
      ELSE 'INACTIVE'
    END,
    policy_revision = 'phase19.3a1.acceptance.catalog-v2',
    updated_at = CURRENT_TIMESTAMP
WHERE rule.project_id = (
    SELECT project_id
    FROM core.projects
    WHERE project_code = 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE'
  )
  AND rule.definition_id = (
    SELECT definition_id
    FROM core.agent_definitions
    WHERE agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
  );

DO $verify_allow_rule$
DECLARE
  active_count INTEGER;
BEGIN
  SELECT count(*) INTO active_count
  FROM core.project_agent_allow_rules rule
  JOIN core.projects p ON p.project_id = rule.project_id
  JOIN core.agent_definitions d ON d.definition_id = rule.definition_id
  JOIN core.agent_definition_versions v ON v.definition_version_id = rule.definition_version_id
  WHERE p.project_code = 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE'
    AND d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
    AND rule.allow_state = 'ACTIVE'
    AND v.revision = 2;

  IF active_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active Phase 19.3A1 revision 2 allow rule, found %.', active_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM core.project_agent_allow_rules rule
    JOIN core.projects p ON p.project_id = rule.project_id
    JOIN core.agent_definitions d ON d.definition_id = rule.definition_id
    JOIN core.agent_definition_versions v ON v.definition_version_id = rule.definition_version_id
    WHERE p.project_code = 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE'
      AND d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
      AND v.revision = 1
      AND rule.allow_state = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Phase 19.3A1 revision 1 remains ACTIVE after catalog alignment.';
  END IF;
END
$verify_allow_rule$;
