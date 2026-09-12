-- Migration: 00125__scheduler_failure_notifications.sql
-- Purpose: Adds durable in-app failure notifications for scheduler runs, including
-- scheduled Playwright Test, Test Suite, and Browser Automation targets.

BEGIN;

ALTER TABLE auth.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_notification_type_check,
  DROP CONSTRAINT IF EXISTS user_notifications_source_type_check;

ALTER TABLE auth.user_notifications
  ADD CONSTRAINT user_notifications_notification_type_check
    CHECK (notification_type IN (
      'APPROVAL_REQUIRED',
      'TOOL_RUN_FAILED',
      'WORKFLOW_RUN_FAILED',
      'SCHEDULE_RUN_FAILED'
    )),
  ADD CONSTRAINT user_notifications_source_type_check
    CHECK (source_type IN (
      'WORKFLOW_APPROVAL',
      'TOOL_RUN',
      'WORKFLOW_RUN',
      'SCHEDULE_RUN'
    ));

COMMENT ON TABLE auth.user_notifications IS
  'Durable in-app SkyCommand notifications for approvals and failed tool, workflow, and scheduler runs.';

CREATE OR REPLACE FUNCTION auth.notify_failed_schedule_run()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_user_id UUID;
  schedule_label TEXT;
  target_label TEXT;
BEGIN
  IF NEW.status <> 'FAILED' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'FAILED' THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(s.updated_by_user_id, s.created_by_user_id),
    COALESCE(NULLIF(btrim(s.schedule_name), ''), s.schedule_code),
    COALESCE(NULLIF(NEW.metadata #>> '{browserTarget,targetLabel}', ''), t.label, t.tool_code)
  INTO owner_user_id, schedule_label, target_label
  FROM worker.schedules s
  JOIN core.tools t ON t.tool_id = s.tool_id
  WHERE s.schedule_id = NEW.schedule_id;

  IF owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO auth.user_notifications (
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
  VALUES (
    owner_user_id,
    'SCHEDULE_RUN_FAILED',
    'SCHEDULE_RUN',
    NEW.schedule_run_id,
    'Scheduled run failed: ' || COALESCE(schedule_label, 'Schedule'),
    COALESCE(target_label, 'Scheduled target') || ' failed. Open Scheduler Operations for details.',
    'ERROR',
    'UNREAD',
    '/automation/schedules/history',
    COALESCE(NEW.finished_at, NEW.updated_at, CURRENT_TIMESTAMP),
    jsonb_build_object(
      'scheduleId', NEW.schedule_id,
      'scheduleRunId', NEW.schedule_run_id,
      'targetType', COALESCE(NEW.metadata #>> '{browserTarget,targetType}', 'TOOL'),
      'targetCode', NEW.metadata #>> '{browserTarget,targetCode}',
      'workflowId', NEW.metadata #>> '{browserTarget,workflowId}'
    )
  )
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schedule_run_failure_notification ON worker.schedule_runs;
CREATE TRIGGER schedule_run_failure_notification
AFTER INSERT OR UPDATE OF status
ON worker.schedule_runs
FOR EACH ROW
EXECUTE FUNCTION auth.notify_failed_schedule_run();

COMMIT;
