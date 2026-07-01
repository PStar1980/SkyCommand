-- ============================================================
-- Seed: 00039__workflow_builder_foundation_seed.sql
-- Purpose:
-- Seeds the SkyServer workflow-builder node palette and one
-- draft/published metadata example that composes existing tools.
-- This does not execute workflows yet; it establishes the future
-- builder hierarchy: workflow -> nodes -> primitives.
-- ============================================================

BEGIN;

INSERT INTO worker.workflow_node_types (
  node_type_code,
  display_name,
  description,
  category,
  target_kind,
  icon,
  requires_target,
  enabled,
  config
)
VALUES
  (
    'TOOL',
    'Run Tool',
    'Runs an existing SkyServer core.tools entry. This keeps tools as first-class executable primitives.',
    'ACTION',
    'core.tools',
    'tool',
    TRUE,
    TRUE,
    '{"builderCard":"tool","initiallySupported":true}'::jsonb
  ),
  (
    'API_CALL',
    'Call API',
    'Calls an approved HTTP/API endpoint with configured method, headers, and payload.',
    'INTEGRATION',
    'api.endpoint',
    'api',
    TRUE,
    TRUE,
    '{"builderCard":"api","initiallySupported":false}'::jsonb
  ),
  (
    'AGENT',
    'Run Agent',
    'Runs an approved agentic AI action or assistant task.',
    'AI',
    'agent.definition',
    'spark',
    TRUE,
    TRUE,
    '{"builderCard":"agent","initiallySupported":false}'::jsonb
  ),
  (
    'WORKFLOW',
    'Run Child Workflow',
    'Starts another SkyServer workflow definition as a child/composed workflow node.',
    'WORKFLOW',
    'worker.workflow_definitions',
    'workflow',
    TRUE,
    TRUE,
    '{"builderCard":"workflow","initiallySupported":false}'::jsonb
  ),
  (
    'TEMPORAL_WORKFLOW',
    'Start Temporal Workflow',
    'Starts an approved worker.temporal_workflow_definitions template directly.',
    'WORKFLOW',
    'worker.temporal_workflow_definitions',
    'temporal',
    TRUE,
    TRUE,
    '{"builderCard":"temporal","initiallySupported":true}'::jsonb
  ),
  (
    'CONDITION',
    'Condition / Branch',
    'Evaluates an expression and routes execution through conditional edges.',
    'CONTROL',
    NULL,
    'branch',
    FALSE,
    TRUE,
    '{"builderCard":"condition","initiallySupported":false}'::jsonb
  ),
  (
    'WAIT',
    'Wait / Delay',
    'Waits for a duration, timestamp, or future event before continuing.',
    'CONTROL',
    NULL,
    'clock',
    FALSE,
    TRUE,
    '{"builderCard":"wait","initiallySupported":false}'::jsonb
  ),
  (
    'HUMAN_APPROVAL',
    'Human Approval',
    'Pauses execution until an approved user reviews and approves/rejects the node.',
    'HUMAN',
    NULL,
    'approval',
    FALSE,
    TRUE,
    '{"builderCard":"approval","initiallySupported":false}'::jsonb
  ),
  (
    'DATA_TRANSFORM',
    'Data Transform',
    'Applies an approved transform/mapping step between nodes.',
    'ACTION',
    'transform.definition',
    'transform',
    TRUE,
    TRUE,
    '{"builderCard":"transform","initiallySupported":false}'::jsonb
  )
ON CONFLICT (node_type_code)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  target_kind = EXCLUDED.target_kind,
  icon = EXCLUDED.icon,
  requires_target = EXCLUDED.requires_target,
  enabled = EXCLUDED.enabled,
  config = EXCLUDED.config,
  updated_at = CURRENT_TIMESTAMP;

WITH definition_upsert AS (
  INSERT INTO worker.workflow_definitions (
    workflow_code,
    display_name,
    description,
    status,
    visible_in_admin,
    enabled,
    start_permission_code,
    cancel_permission_code,
    config
  )
  VALUES (
    'macro-refresh-pipeline',
    'Macro Refresh Pipeline',
    'Example SkyServer workflow definition that composes existing tool primitives. v1 models FRED ingestion followed by SkyWeb alert evaluation.',
    'ACTIVE',
    TRUE,
    TRUE,
    'WORKFLOW_START',
    'WORKFLOW_CANCEL',
    '{"phase":"10.9","builderFoundation":true,"executionStatus":"metadata_only","startPermissionAlternates":["TEMPORAL_WORKFLOW_START","WORKER_SCHEDULE_RUN"]}'::jsonb
  )
  ON CONFLICT (workflow_code)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    visible_in_admin = EXCLUDED.visible_in_admin,
    enabled = EXCLUDED.enabled,
    start_permission_code = EXCLUDED.start_permission_code,
    cancel_permission_code = EXCLUDED.cancel_permission_code,
    config = EXCLUDED.config,
    updated_at = CURRENT_TIMESTAMP
  RETURNING workflow_definition_id
), definition_ref AS (
  SELECT workflow_definition_id FROM definition_upsert
  UNION ALL
  SELECT workflow_definition_id
  FROM worker.workflow_definitions
  WHERE workflow_code = 'macro-refresh-pipeline'
  LIMIT 1
), version_upsert AS (
  INSERT INTO worker.workflow_versions (
    workflow_definition_id,
    version_number,
    version_label,
    status,
    graph_version,
    definition_snapshot,
    published_at
  )
  SELECT
    definition_ref.workflow_definition_id,
    1,
    'Foundation Example',
    'PUBLISHED',
    '1.0',
    '{"summary":"FRED ingestion tool followed by SkyWeb alert evaluation tool.","executionStatus":"metadata_only"}'::jsonb,
    CURRENT_TIMESTAMP
  FROM definition_ref
  ON CONFLICT (workflow_definition_id, version_number)
  DO UPDATE SET
    version_label = EXCLUDED.version_label,
    status = EXCLUDED.status,
    graph_version = EXCLUDED.graph_version,
    definition_snapshot = EXCLUDED.definition_snapshot,
    published_at = COALESCE(worker.workflow_versions.published_at, EXCLUDED.published_at),
    updated_at = CURRENT_TIMESTAMP
  RETURNING workflow_version_id
), version_ref AS (
  SELECT workflow_version_id FROM version_upsert
  UNION ALL
  SELECT v.workflow_version_id
  FROM worker.workflow_versions v
  JOIN definition_ref d
    ON d.workflow_definition_id = v.workflow_definition_id
  WHERE v.version_number = 1
  LIMIT 1
), fred_tool AS (
  SELECT tool_id
  FROM core.tools
  WHERE tool_code = 'ingestion_fred'
  LIMIT 1
), alerts_tool AS (
  SELECT tool_id
  FROM core.tools
  WHERE tool_code = 'skyweb_alerts_evaluate'
  LIMIT 1
), fred_node AS (
  INSERT INTO worker.workflow_nodes (
    workflow_version_id,
    node_key,
    node_type_code,
    display_name,
    description,
    target_code,
    target_ref_id,
    input_parameters,
    retry_policy,
    timeout_ms,
    position_x,
    position_y,
    display_order,
    config
  )
  SELECT
    version_ref.workflow_version_id,
    'fred_ingestion',
    'TOOL',
    'Run FRED ingestion tool',
    'Runs the upgraded FRED tool primitive with optional selected indicators and concurrency.',
    'ingestion_fred',
    fred_tool.tool_id,
    '{"indicators":"","concurrency":"3"}'::jsonb,
    '{"maximumAttempts":3,"initialIntervalSeconds":30}'::jsonb,
    1800000,
    80,
    120,
    10,
    '{"cardTone":"macro","primitive":"core.tools"}'::jsonb
  FROM version_ref
  CROSS JOIN fred_tool
  ON CONFLICT (workflow_version_id, node_key)
  DO UPDATE SET
    node_type_code = EXCLUDED.node_type_code,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    target_code = EXCLUDED.target_code,
    target_ref_id = EXCLUDED.target_ref_id,
    input_parameters = EXCLUDED.input_parameters,
    retry_policy = EXCLUDED.retry_policy,
    timeout_ms = EXCLUDED.timeout_ms,
    position_x = EXCLUDED.position_x,
    position_y = EXCLUDED.position_y,
    display_order = EXCLUDED.display_order,
    config = EXCLUDED.config,
    enabled = TRUE,
    updated_at = CURRENT_TIMESTAMP
  RETURNING workflow_node_id, workflow_version_id
), alerts_node AS (
  INSERT INTO worker.workflow_nodes (
    workflow_version_id,
    node_key,
    node_type_code,
    display_name,
    description,
    target_code,
    target_ref_id,
    input_parameters,
    retry_policy,
    timeout_ms,
    position_x,
    position_y,
    display_order,
    config
  )
  SELECT
    version_ref.workflow_version_id,
    'evaluate_skyweb_alerts',
    'TOOL',
    'Evaluate SkyWeb alerts',
    'Runs the existing SkyWeb alert evaluation tool after macro data refresh.',
    'skyweb_alerts_evaluate',
    alerts_tool.tool_id,
    '{"maxRules":"500","activeOnly":"true"}'::jsonb,
    '{"maximumAttempts":2,"initialIntervalSeconds":20}'::jsonb,
    600000,
    420,
    120,
    20,
    '{"cardTone":"signals","primitive":"core.tools"}'::jsonb
  FROM version_ref
  CROSS JOIN alerts_tool
  ON CONFLICT (workflow_version_id, node_key)
  DO UPDATE SET
    node_type_code = EXCLUDED.node_type_code,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    target_code = EXCLUDED.target_code,
    target_ref_id = EXCLUDED.target_ref_id,
    input_parameters = EXCLUDED.input_parameters,
    retry_policy = EXCLUDED.retry_policy,
    timeout_ms = EXCLUDED.timeout_ms,
    position_x = EXCLUDED.position_x,
    position_y = EXCLUDED.position_y,
    display_order = EXCLUDED.display_order,
    config = EXCLUDED.config,
    enabled = TRUE,
    updated_at = CURRENT_TIMESTAMP
  RETURNING workflow_node_id, workflow_version_id
), existing_edge AS (
  DELETE FROM worker.workflow_edges e
  USING version_ref v
  WHERE e.workflow_version_id = v.workflow_version_id
    AND e.edge_key = 'fred_to_alerts'
  RETURNING e.workflow_edge_id
)
INSERT INTO worker.workflow_edges (
  workflow_version_id,
  edge_key,
  from_node_id,
  to_node_id,
  edge_type,
  display_order,
  config
)
SELECT
  fred_node.workflow_version_id,
  'fred_to_alerts',
  fred_node.workflow_node_id,
  alerts_node.workflow_node_id,
  'SEQUENTIAL',
  10,
  '{"label":"then"}'::jsonb
FROM fred_node
CROSS JOIN alerts_node;

COMMIT;
