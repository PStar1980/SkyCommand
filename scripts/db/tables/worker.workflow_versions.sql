-- Table: worker.workflow_versions
-- Purpose: Versioned workflow graph snapshots.

CREATE TABLE IF NOT EXISTS worker.workflow_versions (
  workflow_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id UUID NOT NULL REFERENCES worker.workflow_definitions(workflow_definition_id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  version_label TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  graph_version TEXT NOT NULL DEFAULT '1.0',
  definition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  published_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_versions_snapshot_object CHECK (jsonb_typeof(definition_snapshot) = 'object'),
  UNIQUE (workflow_definition_id, version_number)
);

ALTER TABLE worker.workflow_versions OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_versions_definition_status
  ON worker.workflow_versions (workflow_definition_id, status, version_number DESC);

COMMENT ON TABLE worker.workflow_versions IS 'Versioned SkyCommand workflow graphs. Runnable workflows should point at a published version.';
