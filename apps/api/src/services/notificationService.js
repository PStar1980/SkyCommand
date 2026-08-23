const { query } = require('../../../../packages/db/src/connection');

const MAX_NOTIFICATION_LIMIT = 100;

function normalizeLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_NOTIFICATION_LIMIT);
}

function normalizeStatus(value) {
  const normalized = String(value || 'ALL').trim().toUpperCase();
  return normalized === 'UNREAD' ? 'UNREAD' : 'ALL';
}

function sanitizeNotification(row = {}) {
  return {
    notificationId: row.notification_id,
    notificationType: row.notification_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    message: row.message,
    severity: row.severity,
    status: row.status,
    targetPath: row.target_path,
    eventAt: row.event_at,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
    metadata: row.metadata || {},
  };
}

async function reconcilePendingApprovalNotifications(userId) {
  if (!userId) return;

  await query(
    `
      UPDATE auth.user_notifications n
      SET status = 'RESOLVED',
          resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
      WHERE n.user_id = $1
        AND n.source_type = 'WORKFLOW_APPROVAL'
        AND n.status IN ('UNREAD', 'READ')
        AND NOT EXISTS (
          SELECT 1
          FROM worker.workflow_approval_requests a
          JOIN auth.user_roles ur
            ON ur.user_id = n.user_id
           AND ur.active = TRUE
          JOIN auth.roles role
            ON role.role_id = ur.role_id
           AND role.active = TRUE
           AND role.role_code IN (UPPER(BTRIM(a.required_role_code)), 'SUPER_ADMIN')
          WHERE a.approval_request_id = n.source_id
            AND a.status = 'PENDING'
            AND NULLIF(BTRIM(a.required_role_code), '') IS NOT NULL
        )
    `,
    [userId],
  );

  await query(
    `
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
      SELECT
        $1,
        'APPROVAL_REQUIRED',
        'WORKFLOW_APPROVAL',
        a.approval_request_id,
        'Approval required: ' || a.approval_title,
        COALESCE(d.display_name, r.workflow_code, 'Workflow') ||
          ' is waiting for ' || UPPER(BTRIM(a.required_role_code)) || ' approval.',
        'ACTION',
        'UNREAD',
        '/workflows/approvals?approvalRequestId=' || a.approval_request_id::text,
        COALESCE(a.requested_at, a.created_at),
        jsonb_build_object(
          'workflowRunRecordId', a.workflow_run_record_id,
          'requiredRoleCode', UPPER(BTRIM(a.required_role_code)),
          'approvalTitle', a.approval_title,
          'nodeKey', a.node_key
        )
      FROM worker.workflow_approval_requests a
      JOIN worker.workflow_run_records r
        ON r.workflow_run_record_id = a.workflow_run_record_id
      LEFT JOIN worker.workflow_definitions d
        ON d.workflow_definition_id = r.workflow_definition_id
      WHERE a.status = 'PENDING'
        AND NULLIF(BTRIM(a.required_role_code), '') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM auth.user_roles ur
          JOIN auth.users user_account
            ON user_account.user_id = ur.user_id
           AND user_account.status = 'ACTIVE'
           AND user_account.is_system_user = FALSE
          JOIN auth.roles role
            ON role.role_id = ur.role_id
           AND role.active = TRUE
          WHERE ur.user_id = $1
            AND ur.active = TRUE
            AND role.role_code IN (UPPER(BTRIM(a.required_role_code)), 'SUPER_ADMIN')
        )
      ON CONFLICT (user_id, source_type, source_id) DO UPDATE
      SET status = CASE
            WHEN existing.status = 'RESOLVED' THEN 'UNREAD'
            ELSE existing.status
          END,
          resolved_at = CASE
            WHEN existing.status = 'RESOLVED' THEN NULL
            ELSE existing.resolved_at
          END
    `,
    [userId],
  );
}

async function listUserNotifications({ userId, status = 'ALL', limit = 50 } = {}) {
  if (!userId) {
    const error = new Error('Authenticated user is required.');
    error.statusCode = 401;
    throw error;
  }

  await reconcilePendingApprovalNotifications(userId);

  const normalizedStatus = normalizeStatus(status);
  const normalizedLimit = normalizeLimit(limit);
  const statusClause = normalizedStatus === 'UNREAD' ? "AND status = 'UNREAD'" : "AND status <> 'DISMISSED'";

  const [itemsResult, unreadResult] = await Promise.all([
    query(
      `
        SELECT *
        FROM auth.user_notifications
        WHERE user_id = $1
          ${statusClause}
        ORDER BY event_at DESC, created_at DESC
        LIMIT $2
      `,
      [userId, normalizedLimit],
    ),
    query(
      `
        SELECT COUNT(*)::integer AS unread_count
        FROM auth.user_notifications
        WHERE user_id = $1
          AND status = 'UNREAD'
      `,
      [userId],
    ),
  ]);

  return {
    status: normalizedStatus,
    unreadCount: Number(unreadResult.rows[0]?.unread_count || 0),
    items: itemsResult.rows.map(sanitizeNotification),
  };
}

async function markNotificationRead({ userId, notificationId } = {}) {
  if (!userId || !notificationId) {
    const error = new Error('Notification ID is required.');
    error.statusCode = 400;
    throw error;
  }

  const result = await query(
    `
      UPDATE auth.user_notifications
      SET status = CASE WHEN status = 'UNREAD' THEN 'READ' ELSE status END,
          read_at = CASE WHEN status = 'UNREAD' THEN CURRENT_TIMESTAMP ELSE read_at END
      WHERE notification_id = $1
        AND user_id = $2
      RETURNING *
    `,
    [notificationId, userId],
  );

  if (!result.rows[0]) {
    const error = new Error('Notification was not found.');
    error.statusCode = 404;
    throw error;
  }

  return sanitizeNotification(result.rows[0]);
}

async function markAllNotificationsRead(userId) {
  if (!userId) {
    const error = new Error('Authenticated user is required.');
    error.statusCode = 401;
    throw error;
  }

  const result = await query(
    `
      UPDATE auth.user_notifications
      SET status = 'READ',
          read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE user_id = $1
        AND status = 'UNREAD'
      RETURNING notification_id
    `,
    [userId],
  );

  return { updatedCount: result.rowCount || 0 };
}

module.exports = {
  listUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  reconcilePendingApprovalNotifications,
};
