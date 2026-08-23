-- Table: auth.user_notifications
-- Purpose: Durable per-user in-app notification state for SkyCommand.
-- Source-trigger wiring is applied by migration 00106.

CREATE TABLE IF NOT EXISTS auth.user_notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('APPROVAL_REQUIRED', 'TOOL_RUN_FAILED', 'WORKFLOW_RUN_FAILED')),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('WORKFLOW_APPROVAL', 'TOOL_RUN', 'WORKFLOW_RUN')),
  source_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  severity TEXT NOT NULL DEFAULT 'INFO'
    CHECK (severity IN ('INFO', 'ACTION', 'ERROR')),
  status TEXT NOT NULL DEFAULT 'UNREAD'
    CHECK (status IN ('UNREAD', 'READ', 'DISMISSED', 'RESOLVED')),
  target_path TEXT,
  event_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_notifications_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT user_notifications_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (user_id, source_type, source_id)
);

ALTER TABLE auth.user_notifications OWNER TO postgres;

CREATE INDEX IF NOT EXISTS user_notifications_user_status_event_idx
  ON auth.user_notifications (user_id, status, event_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_source_idx
  ON auth.user_notifications (source_type, source_id);

COMMENT ON TABLE auth.user_notifications IS
  'Durable in-app SkyCommand notifications for role approvals and user-owned failed tool/workflow runs.';
