-- Phase 17 human refinement: in-app user notification foundation.
-- Notifications are durable, per-user, and source-addressable so read state
-- survives navigation and browser refreshes without duplicating records.

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

CREATE OR REPLACE FUNCTION auth.set_user_notification_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notifications_set_updated_at ON auth.user_notifications;
CREATE TRIGGER user_notifications_set_updated_at
BEFORE UPDATE ON auth.user_notifications
FOR EACH ROW
EXECUTE FUNCTION auth.set_user_notification_updated_at();

CREATE OR REPLACE FUNCTION auth.notify_workflow_approval_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  workflow_label TEXT;
BEGIN
  IF NEW.status <> 'PENDING' OR NULLIF(btrim(NEW.required_role_code), '') IS NULL THEN
    UPDATE auth.user_notifications
    SET status = 'RESOLVED',
        resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
    WHERE source_type = 'WORKFLOW_APPROVAL'
      AND source_id = NEW.approval_request_id
      AND status IN ('UNREAD', 'READ');
    RETURN NEW;
  END IF;

  SELECT COALESCE(d.display_name, r.workflow_code, 'Workflow')
  INTO workflow_label
  FROM worker.workflow_run_records r
  LEFT JOIN worker.workflow_definitions d
    ON d.workflow_definition_id = r.workflow_definition_id
  WHERE r.workflow_run_record_id = NEW.workflow_run_record_id;

  UPDATE auth.user_notifications existing
  SET status = 'RESOLVED',
      resolved_at = COALESCE(existing.resolved_at, CURRENT_TIMESTAMP)
  WHERE existing.source_type = 'WORKFLOW_APPROVAL'
    AND existing.source_id = NEW.approval_request_id
    AND existing.status IN ('UNREAD', 'READ')
    AND NOT EXISTS (
      SELECT 1
      FROM auth.user_roles ur
      JOIN auth.users user_account
        ON user_account.user_id = ur.user_id
       AND user_account.status = 'ACTIVE'
       AND user_account.is_system_user = FALSE
      JOIN auth.roles role
        ON role.role_id = ur.role_id
       AND role.active = TRUE
      WHERE ur.user_id = existing.user_id
        AND ur.active = TRUE
        AND role.role_code IN (UPPER(btrim(NEW.required_role_code)), 'SUPER_ADMIN')
    );

  INSERT INTO auth.user_notifications AS existing (
    user_id,
    notification_type,
    source_type,
    source_id,
    title,
    message,
    severity,
    status,
    target_path,
    event_at,
    metadata
  )
  SELECT DISTINCT
    ur.user_id,
    'APPROVAL_REQUIRED',
    'WORKFLOW_APPROVAL',
    NEW.approval_request_id,
    'Approval required: ' || NEW.approval_title,
    COALESCE(workflow_label, 'Workflow') || ' is waiting for ' || UPPER(btrim(NEW.required_role_code)) || ' approval.',
    'ACTION',
    'UNREAD',
    '/workflows/approvals?approvalRequestId=' || NEW.approval_request_id::text,
    COALESCE(NEW.requested_at, CURRENT_TIMESTAMP),
    jsonb_build_object(
      'workflowRunRecordId', NEW.workflow_run_record_id,
      'requiredRoleCode', UPPER(btrim(NEW.required_role_code)),
      'approvalTitle', NEW.approval_title,
      'nodeKey', NEW.node_key
    )
  FROM auth.user_roles ur
  JOIN auth.users user_account
    ON user_account.user_id = ur.user_id
   AND user_account.status = 'ACTIVE'
   AND user_account.is_system_user = FALSE
  JOIN auth.roles role
    ON role.role_id = ur.role_id
   AND role.active = TRUE
  WHERE ur.active = TRUE
    AND role.role_code IN (UPPER(btrim(NEW.required_role_code)), 'SUPER_ADMIN')
  ON CONFLICT (user_id, source_type, source_id) DO UPDATE
  SET title = EXCLUDED.title,
      message = EXCLUDED.message,
      target_path = EXCLUDED.target_path,
      event_at = EXCLUDED.event_at,
      metadata = existing.metadata || EXCLUDED.metadata,
      status = CASE
        WHEN existing.status IN ('DISMISSED', 'RESOLVED') THEN 'UNREAD'
        ELSE existing.status
      END,
      resolved_at = NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_approval_role_notification ON worker.workflow_approval_requests;
CREATE TRIGGER workflow_approval_role_notification
AFTER INSERT OR UPDATE OF status, required_role_code, approval_title
ON worker.workflow_approval_requests
FOR EACH ROW
EXECUTE FUNCTION auth.notify_workflow_approval_role();

CREATE OR REPLACE FUNCTION auth.notify_failed_tool_run()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  tool_label TEXT;
BEGIN
  IF NEW.status <> 'FAILED' OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'FAILED' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF COALESCE(NEW.metadata->>'launchChannel', 'INTERACTIVE') = 'WORKFLOW' THEN
    RETURN NEW;
  END IF;

  tool_label := COALESCE(NULLIF(NEW.metadata->>'toolLabel', ''), NEW.script_name, 'Tool');

  INSERT INTO auth.user_notifications (
    user_id, notification_type, source_type, source_id, title, message,
    severity, status, target_path, event_at, metadata
  )
  VALUES (
    NEW.user_id,
    'TOOL_RUN_FAILED',
    'TOOL_RUN',
    NEW.execution_id,
    'Tool run failed: ' || tool_label,
    'The tool run failed. Open Tool Operations for details.',
    'ERROR',
    'UNREAD',
    '/tools/executions?executionId=' || NEW.execution_id::text,
    COALESCE(NEW.finished_at, CURRENT_TIMESTAMP),
    jsonb_build_object(
      'toolCode', COALESCE(NEW.metadata->>'toolCode', NEW.script_name),
      'category', NEW.category,
      'exitCode', NEW.exit_code
    )
  )
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS script_execution_failure_notification ON auth.script_execution_log;
CREATE TRIGGER script_execution_failure_notification
AFTER INSERT OR UPDATE OF status
ON auth.script_execution_log
FOR EACH ROW
EXECUTE FUNCTION auth.notify_failed_tool_run();

CREATE OR REPLACE FUNCTION auth.notify_failed_workflow_run()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  workflow_label TEXT;
BEGIN
  IF NEW.status <> 'FAILED' OR NEW.started_by_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'FAILED' THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(d.display_name, NEW.workflow_code)
  INTO workflow_label
  FROM worker.workflow_definitions d
  WHERE d.workflow_definition_id = NEW.workflow_definition_id;

  workflow_label := COALESCE(workflow_label, NEW.workflow_code, 'Workflow');

  INSERT INTO auth.user_notifications (
    user_id, notification_type, source_type, source_id, title, message,
    severity, status, target_path, event_at, metadata
  )
  VALUES (
    NEW.started_by_user_id,
    'WORKFLOW_RUN_FAILED',
    'WORKFLOW_RUN',
    NEW.workflow_run_record_id,
    'Workflow run failed: ' || workflow_label,
    'The workflow run failed. Open Workflow Operations for details.',
    'ERROR',
    'UNREAD',
    '/workflows/history?runId=' || NEW.workflow_run_record_id::text,
    COALESCE(NEW.completed_at, NEW.updated_at, CURRENT_TIMESTAMP),
    jsonb_build_object(
      'workflowCode', NEW.workflow_code,
      'runSource', NEW.run_source,
      'triggerType', NEW.trigger_type
    )
  )
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_run_failure_notification ON worker.workflow_run_records;
CREATE TRIGGER workflow_run_failure_notification
AFTER INSERT OR UPDATE OF status
ON worker.workflow_run_records
FOR EACH ROW
EXECUTE FUNCTION auth.notify_failed_workflow_run();
