-- R5 operator-facing naming correction.
--
-- This additive migration changes display metadata only. Stable Tool codes,
-- internal callable names, permissions, execution paths, and the published
-- workflow graph remain immutable.

DO $r5_naming_preflight$
DECLARE
  tool_count INTEGER;
  workflow_count INTEGER;
  published_version_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tool_count
  FROM core.tools
  WHERE tool_code IN (
    'dev_finalization_preflight',
    'dev_runtime_lifecycle',
    'dev_finalization_validate',
    'dev_finalization_readiness',
    'dev_finalization_receipt'
  );

  IF tool_count <> 5 THEN
    RAISE EXCEPTION '00141: expected exactly five R5 Tools, found %', tool_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('dev_finalization_preflight', 'devFinalizationPreflight'),
      ('dev_runtime_lifecycle', 'devRuntimeLifecycle'),
      ('dev_finalization_validate', 'devFinalizationValidate'),
      ('dev_finalization_readiness', 'devFinalizationReadiness'),
      ('dev_finalization_receipt', 'devFinalizationReceipt')
    ) AS expected(tool_code, tool_name)
    LEFT JOIN core.tools t
      ON t.tool_code = expected.tool_code
     AND t.name = expected.tool_name
    WHERE t.tool_id IS NULL
  ) THEN
    RAISE EXCEPTION '00141: one or more R5 Tool stable internal names do not match the accepted identity';
  END IF;

  SELECT COUNT(*) INTO workflow_count
  FROM worker.workflow_definitions
  WHERE workflow_code = 'dev_change_finalize';

  IF workflow_count <> 1 THEN
    RAISE EXCEPTION '00141: expected exactly one dev_change_finalize workflow, found %', workflow_count;
  END IF;

  SELECT COUNT(*) INTO published_version_count
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d
    ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'dev_change_finalize'
    AND v.status = 'PUBLISHED';

  IF published_version_count <> 1 THEN
    RAISE EXCEPTION '00141: expected exactly one published dev_change_finalize version, found %', published_version_count;
  END IF;
END;
$r5_naming_preflight$;

UPDATE core.tools
SET label = CASE tool_code
  WHEN 'dev_finalization_preflight' THEN 'Run Dev Finalization Preflight'
  WHEN 'dev_runtime_lifecycle' THEN 'Rebuild Allowlisted Runtime'
  WHEN 'dev_finalization_validate' THEN 'Validate Dev Finalization'
  WHEN 'dev_finalization_readiness' THEN 'Check Dev Finalization Readiness'
  WHEN 'dev_finalization_receipt' THEN 'Persist Dev Finalization Receipt'
END,
updated_at = CURRENT_TIMESTAMP
WHERE tool_code IN (
  'dev_finalization_preflight',
  'dev_runtime_lifecycle',
  'dev_finalization_validate',
  'dev_finalization_readiness',
  'dev_finalization_receipt'
);

UPDATE worker.workflow_definitions
SET display_name = 'Dev Change Finalization',
    updated_at = CURRENT_TIMESTAMP
WHERE workflow_code = 'dev_change_finalize';

UPDATE worker.workflow_versions v
SET definition_snapshot = jsonb_set(
      COALESCE(v.definition_snapshot, '{}'::jsonb),
      '{displayName}',
      to_jsonb('Dev Change Finalization'::TEXT),
      TRUE
    ),
    updated_at = CURRENT_TIMESTAMP
FROM worker.workflow_definitions d
WHERE d.workflow_definition_id = v.workflow_definition_id
  AND d.workflow_code = 'dev_change_finalize'
  AND v.status = 'PUBLISHED';

DO $r5_naming_validation$
DECLARE
  tool_count INTEGER;
  workflow_count INTEGER;
  published_version_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tool_count
  FROM (VALUES
    ('dev_finalization_preflight', 'Run Dev Finalization Preflight'),
    ('dev_runtime_lifecycle', 'Rebuild Allowlisted Runtime'),
    ('dev_finalization_validate', 'Validate Dev Finalization'),
    ('dev_finalization_readiness', 'Check Dev Finalization Readiness'),
    ('dev_finalization_receipt', 'Persist Dev Finalization Receipt')
  ) AS expected(tool_code, tool_label)
  JOIN core.tools t
    ON t.tool_code = expected.tool_code
   AND t.label = expected.tool_label;

  IF tool_count <> 5 THEN
    RAISE EXCEPTION '00141: accepted R5 Tool display labels were not persisted';
  END IF;

  SELECT COUNT(*) INTO workflow_count
  FROM worker.workflow_definitions
  WHERE workflow_code = 'dev_change_finalize'
    AND display_name = 'Dev Change Finalization';

  IF workflow_count <> 1 THEN
    RAISE EXCEPTION '00141: accepted workflow display name was not persisted';
  END IF;

  SELECT COUNT(*) INTO published_version_count
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d
    ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'dev_change_finalize'
    AND v.status = 'PUBLISHED'
    AND v.definition_snapshot ->> 'displayName' = 'Dev Change Finalization';

  IF published_version_count <> 1 THEN
    RAISE EXCEPTION '00141: published workflow display-name snapshot was not synchronized';
  END IF;
END;
$r5_naming_validation$;
