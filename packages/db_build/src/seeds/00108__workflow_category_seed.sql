-- ============================================================
-- Seed: 00108__workflow_category_seed.sql
-- Purpose:
-- Seeds the initial workflow taxonomy and classifies known
-- SkyCommand workflows. Unrecognized workflows remain GENERAL.
-- ============================================================

INSERT INTO worker.workflow_categories (
  category_code,
  display_name,
  description,
  display_order,
  enabled,
  config
)
VALUES
  (
    'REPOSITORY_AUTOMATION',
    'Repository & DevOps',
    'Repository intelligence, packaging, promotion, synchronization, and release-oriented workflows.',
    10,
    TRUE,
    '{"seeded":true}'::jsonb
  ),
  (
    'DATA_PIPELINES',
    'Data Pipelines',
    'Data ingestion, refresh, transformation, and pipeline orchestration workflows.',
    20,
    TRUE,
    '{"seeded":true}'::jsonb
  ),
  (
    'DATABASE_OPERATIONS',
    'Database Operations',
    'Database validation, synchronization, comparison, build, and maintenance workflows.',
    30,
    TRUE,
    '{"seeded":true}'::jsonb
  ),
  (
    'GENERAL',
    'General',
    'Default category for workflows that have not been assigned to a more specific catalogue group.',
    999,
    TRUE,
    '{"systemDefault":true,"seeded":true}'::jsonb
  )
ON CONFLICT (category_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    enabled = TRUE,
    config = worker.workflow_categories.config || EXCLUDED.config;

UPDATE worker.workflow_definitions definition
SET workflow_category_id = category.workflow_category_id
FROM worker.workflow_categories category
WHERE category.category_code = 'REPOSITORY_AUTOMATION'
  AND definition.workflow_code IN (
    'skyserver_dev_commit',
    'git-repo-intelligence',
    'repo-map-zip'
  );

UPDATE worker.workflow_definitions definition
SET workflow_category_id = category.workflow_category_id
FROM worker.workflow_categories category
WHERE category.category_code = 'DATA_PIPELINES'
  AND definition.workflow_code IN ('macro-refresh-pipeline');

UPDATE worker.workflow_definitions definition
SET workflow_category_id = category.workflow_category_id
FROM worker.workflow_categories category
WHERE category.category_code = 'DATABASE_OPERATIONS'
  AND definition.workflow_code IN ('db-sync-test');

UPDATE worker.workflow_definitions definition
SET workflow_category_id = category.workflow_category_id
FROM worker.workflow_categories category
WHERE category.category_code = 'GENERAL'
  AND definition.workflow_category_id IS NULL;
