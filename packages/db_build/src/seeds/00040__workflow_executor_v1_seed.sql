-- ============================================================
-- Seed: 00040__workflow_executor_v1_seed.sql
-- Purpose:
-- Marks the Phase 10.9 workflow-builder foundation example as
-- runnable by the Phase 10.10 SkyServer workflow executor v1.
-- No schema changes are required; this seed updates metadata only.
-- ============================================================

BEGIN;

UPDATE worker.workflow_definitions
SET config = config || '{"executionStatus":"executor_v1","executor":"skyserver_workflow_executor_v1","phase":"10.10"}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE workflow_code = 'macro-refresh-pipeline';

UPDATE worker.workflow_versions v
SET definition_snapshot = definition_snapshot || '{"executionStatus":"executor_v1","executor":"skyserver_workflow_executor_v1","summary":"Runnable sequential graph: FRED ingestion tool followed by SkyWeb alert evaluation tool."}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
FROM worker.workflow_definitions d
WHERE d.workflow_definition_id = v.workflow_definition_id
  AND d.workflow_code = 'macro-refresh-pipeline'
  AND v.version_number = 1;

UPDATE worker.workflow_nodes n
SET input_parameters = input_parameters || '{"concurrency":"10"}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
FROM worker.workflow_versions v
JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = v.workflow_definition_id
WHERE n.workflow_version_id = v.workflow_version_id
  AND d.workflow_code = 'macro-refresh-pipeline'
  AND n.node_key = 'fred_ingestion';

COMMIT;
