const fs = require('fs');
const path = require('path');
const { query } = require('../../../../packages/db/src/connection');
const scriptExecutionService = require('./scriptExecutionService');
const { translateWorkspacePath } = require('../../../../packages/core/src/runtimePathResolver');
const { buildWhitelistedOrderBy } = require('./tableSortUtils');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_EXECUTION_OUTPUT_BYTES = 500000;
const HARD_MAX_EXECUTION_OUTPUT_BYTES = 5000000;
const configuredExecutionOutputBytes = Number.parseInt(
  process.env.TOOL_HISTORY_MAX_OUTPUT_BYTES,
  10,
);
const MAX_EXECUTION_OUTPUT_BYTES =
  Number.isFinite(configuredExecutionOutputBytes) && configuredExecutionOutputBytes > 0
    ? Math.min(configuredExecutionOutputBytes, HARD_MAX_EXECUTION_OUTPUT_BYTES)
    : DEFAULT_EXECUTION_OUTPUT_BYTES;
const SCRIPT_EXECUTION_REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const SCRIPT_EXECUTION_LOG_ROOT = path.resolve(
  String(
    process.env.SKYCOMMAND_EXECUTION_LOG_ROOT ||
      path.join(SCRIPT_EXECUTION_REPOSITORY_ROOT, 'logs', 'script-executions'),
  ),
);
const SCRIPT_EXECUTION_RELATIVE_LOG_PREFIX = 'logs/script-executions/';
const DEFAULT_ADMIN_APP_CODE = String(process.env.AUTH_APP_CODE || 'SKYSERVER_ADMIN')
  .trim()
  .toUpperCase();

function toPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const numberValue = Number.parseInt(value, 10);

  if (Number.isNaN(numberValue) || numberValue < 0) {
    return fallback;
  }

  return Math.min(numberValue, max);
}

function getPagination(filters = {}) {
  return {
    limit: toPositiveInteger(filters.limit, DEFAULT_LIMIT, MAX_LIMIT),
    offset: toPositiveInteger(filters.offset, 0),
  };
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeAppCodeFilter(value, fallback = DEFAULT_ADMIN_APP_CODE) {
  const normalizedValue = normalizeOptionalString(value);

  if (normalizedValue === null) {
    return fallback;
  }

  const appCode = normalizedValue.toUpperCase();
  return appCode === 'ALL' ? null : appCode;
}

function addAppCodeFilter({
  clauses,
  values,
  columnName,
  value,
  fallback = DEFAULT_ADMIN_APP_CODE,
}) {
  const appCode = normalizeAppCodeFilter(value, fallback);

  if (appCode === null) {
    return;
  }

  values.push(appCode);
  clauses.push(`${columnName} = $${values.length}`);
}

function normalizeBooleanFilter(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }

  return null;
}

function addEqualsFilter({ clauses, values, columnName, value }) {
  const normalizedValue = normalizeOptionalString(value);

  if (normalizedValue === null) {
    return;
  }

  values.push(normalizedValue);
  clauses.push(`${columnName} = $${values.length}`);
}

function addBooleanFilter({ clauses, values, columnName, value }) {
  const normalizedValue = normalizeBooleanFilter(value);

  if (normalizedValue === null) {
    return;
  }

  values.push(normalizedValue);
  clauses.push(`${columnName} = $${values.length}`);
}

function addDateRangeFilters({ clauses, values, columnName, from, to }) {
  const normalizedFrom = normalizeOptionalString(from);
  const normalizedTo = normalizeOptionalString(to);

  if (normalizedFrom !== null) {
    values.push(normalizedFrom);
    clauses.push(`${columnName} >= $${values.length}::timestamptz`);
  }

  if (normalizedTo !== null) {
    values.push(normalizedTo);
    clauses.push(`${columnName} < $${values.length}::timestamptz`);
  }
}

function buildComparisonMetric(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const delta = current - previous;
  const percentChange =
    previous === 0 ? (current === 0 ? 0 : null) : Number(((delta / previous) * 100).toFixed(1));

  return {
    current,
    previous,
    delta,
    percentChange,
    direction: delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'FLAT',
  };
}

function buildIdentityHealth({
  failedLogins = 0,
  lockedUsers = 0,
  sessionFootprintComparison,
  staleSessions = 0,
  successfulLogins = 0,
  successfulLoginComparison,
} = {}) {
  const successful = Number(successfulLogins || 0);
  const failed = Number(failedLogins || 0);
  const totalAttempts = successful + failed;
  const failedLoginRate =
    totalAttempts > 0 ? Number(((failed / totalAttempts) * 100).toFixed(1)) : 0;
  const loginPercentChange = successfulLoginComparison?.percentChange;
  const sessionPercentChange = sessionFootprintComparison?.percentChange;
  const reasons = [];
  let status = 'NORMAL';

  const promote = (nextStatus) => {
    const priority = { NORMAL: 0, ELEVATED: 1, ATTENTION: 2, CRITICAL: 3 };
    if ((priority[nextStatus] || 0) > (priority[status] || 0)) {
      status = nextStatus;
    }
  };

  if (failed >= 10 && failedLoginRate >= 25) {
    promote('CRITICAL');
    reasons.push(`${failed} failed logins (${failedLoginRate}% of attempts)`);
  } else if (failed >= 5 || failedLoginRate >= 15) {
    promote('ATTENTION');
    reasons.push(`${failed} failed logins (${failedLoginRate}% of attempts)`);
  } else if (failed > 0) {
    promote('ELEVATED');
    reasons.push(`${failed} failed login attempt(s)`);
  }

  if (Number(lockedUsers || 0) >= 3) {
    promote('CRITICAL');
    reasons.push(`${lockedUsers} locked users`);
  } else if (Number(lockedUsers || 0) > 0) {
    promote('ATTENTION');
    reasons.push(`${lockedUsers} locked user(s)`);
  }

  if (Number(staleSessions || 0) >= 3) {
    promote('ATTENTION');
    reasons.push(`${staleSessions} sessions older than 12 hours`);
  } else if (Number(staleSessions || 0) > 0) {
    promote('ELEVATED');
    reasons.push(`${staleSessions} session(s) older than 12 hours`);
  }

  if (loginPercentChange === null && successful >= 10) {
    promote('ATTENTION');
    reasons.push(`${successful} successful logins with no prior-period activity`);
  } else if (loginPercentChange !== null && loginPercentChange >= 100 && successful >= 10) {
    promote('ATTENTION');
    reasons.push(`Successful logins increased ${loginPercentChange}%`);
  } else if (loginPercentChange !== null && loginPercentChange >= 50 && successful >= 5) {
    promote('ELEVATED');
    reasons.push(`Successful logins increased ${loginPercentChange}%`);
  }

  if (sessionPercentChange === null && sessionFootprintComparison?.current >= 5) {
    promote('ATTENTION');
    reasons.push('New session pressure appeared with no prior-period footprint');
  } else if (
    sessionPercentChange !== null &&
    sessionPercentChange >= 100 &&
    sessionFootprintComparison?.current >= 5
  ) {
    promote('ATTENTION');
    reasons.push(`Daily session footprint increased ${sessionPercentChange}%`);
  } else if (
    sessionPercentChange !== null &&
    sessionPercentChange >= 50 &&
    sessionFootprintComparison?.current >= 3
  ) {
    promote('ELEVATED');
    reasons.push(`Daily session footprint increased ${sessionPercentChange}%`);
  }

  if (reasons.length === 0) {
    reasons.push('No unusual authentication or session pressure detected.');
  }

  return {
    status,
    label: status === 'NORMAL' ? 'Normal' : status.charAt(0) + status.slice(1).toLowerCase(),
    reasons,
    failedLoginRate,
    staleSessionThresholdHours: 12,
  };
}

function addSearchFilter({ clauses, values, columns, searchText }) {
  const normalizedSearchText = normalizeOptionalString(searchText);

  if (normalizedSearchText === null) {
    return;
  }

  values.push(`%${normalizedSearchText}%`);
  const placeholder = `$${values.length}`;
  const searchClause = columns
    .map((columnName) => `${columnName} ILIKE ${placeholder}`)
    .join(' OR ');

  clauses.push(`(${searchClause})`);
}

function buildWhereClause(clauses) {
  if (!clauses || clauses.length === 0) {
    return '';
  }

  return `WHERE ${clauses.join(' AND ')}`;
}

async function runPagedQuery({ selectSql, countSql, clauses, values, orderBy, limit, offset }) {
  const whereClause = buildWhereClause(clauses);

  const countResult = await query(`${countSql} ${whereClause}`, values);
  const total = Number(countResult.rows[0]?.total || 0);

  const dataResult = await query(
    `${selectSql} ${whereClause} ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );

  return {
    rows: dataResult.rows,
    total,
    limit,
    offset,
  };
}

function sanitizeAuditEvent(row) {
  return {
    auditEventId: row.audit_event_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    userLabel: row.user_label || row.display_name || row.username || row.email || 'System',
    roleCodes: Array.isArray(row.role_codes) ? row.role_codes : [],
    privilegeCodes: Array.isArray(row.privilege_codes) ? row.privilege_codes : [],
    eventType: row.event_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    success: row.success,
    message: row.message,
    metadata: row.metadata || {},
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

function sanitizeLoginEvent(row) {
  return {
    loginEventId: row.login_event_id,
    userId: row.user_id,
    matchedUserEmail: row.matched_user_email,
    username: row.username,
    displayName: row.display_name,
    sessionId: row.session_id,
    emailAttempted: row.email_attempted,
    success: row.success,
    failureReason: row.failure_reason,
    appId: row.app_id,
    appCode: row.app_code,
    appTitle: row.app_title,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

function sanitizeScriptExecutionMetadata(metadata = {}) {
  const { toolResult, ...safeMetadata } = metadata || {};
  return safeMetadata;
}

function sanitizeScriptExecution(row) {
  return {
    executionId: row.execution_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    sessionId: row.session_id,
    scriptName: row.script_name,
    category: row.category,
    parameters: row.parameters || {},
    status: row.status,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    durationSeconds: row.duration_seconds,
    summary: row.summary,
    metadata: sanitizeScriptExecutionMetadata(row.metadata || {}),
    hasStdoutLog: Boolean(row.stdout_path),
    hasStderrLog: Boolean(row.stderr_path),
  };
}

function resolveScriptExecutionOutputPath(filePath) {
  const storedPath = String(filePath || '');
  if (path.isAbsolute(storedPath)) {
    return path.resolve(storedPath);
  }

  const translatedPath = translateWorkspacePath(storedPath);
  if (translatedPath && path.isAbsolute(String(translatedPath))) {
    return path.resolve(String(translatedPath));
  }

  const portablePath = storedPath.replace(/\\/g, '/');
  if (portablePath.startsWith(SCRIPT_EXECUTION_RELATIVE_LOG_PREFIX)) {
    return path.resolve(
      SCRIPT_EXECUTION_LOG_ROOT,
      portablePath.slice(SCRIPT_EXECUTION_RELATIVE_LOG_PREFIX.length),
    );
  }

  return path.resolve(SCRIPT_EXECUTION_REPOSITORY_ROOT, storedPath);
}

function readScriptExecutionOutput(filePath) {
  if (!filePath) {
    return { available: false, content: '', truncated: false };
  }

  const resolvedPath = resolveScriptExecutionOutputPath(filePath);
  const relativePath = path.relative(SCRIPT_EXECUTION_LOG_ROOT, resolvedPath);
  const withinLogRoot =
    relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);

  if (!withinLogRoot) {
    return {
      available: false,
      content: '',
      truncated: false,
      warning: 'The stored output path is outside the script execution log directory.',
    };
  }

  let fileDescriptor = null;

  try {
    const statistics = fs.statSync(resolvedPath);

    if (!statistics.isFile()) {
      return {
        available: false,
        content: '',
        truncated: false,
        warning: 'The stored output path does not reference a file.',
      };
    }

    const bytesToRead = Math.min(statistics.size, MAX_EXECUTION_OUTPUT_BYTES);
    const visibleBuffer = Buffer.alloc(bytesToRead);
    fileDescriptor = fs.openSync(resolvedPath, 'r');
    const bytesRead = bytesToRead > 0 ? fs.readSync(fileDescriptor, visibleBuffer, 0, bytesToRead, 0) : 0;

    return {
      available: true,
      content: visibleBuffer.subarray(0, bytesRead).toString('utf8'),
      truncated: statistics.size > MAX_EXECUTION_OUTPUT_BYTES,
    };
  } catch (error) {
    return {
      available: false,
      content: '',
      truncated: false,
      warning: error.code === 'ENOENT' ? 'The output log file is not available.' : error.message,
    };
  } finally {
    if (fileDescriptor !== null) {
      fs.closeSync(fileDescriptor);
    }
  }
}

function sanitizeActiveSession(row, currentSessionId = null) {
  const sessionId = row.session_id;

  return {
    sessionId,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    userStatus: row.user_status,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    secondsUntilExpiry: row.seconds_until_expiry,
    appId: row.app_id || null,
    appCode: row.app_code || null,
    appTitle: row.app_title || null,
    isCurrentSession: currentSessionId ? String(sessionId) === String(currentSessionId) : false,
  };
}

function sanitizeUser(row) {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    isSystemUser: row.is_system_user,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeApplication(row) {
  return {
    appId: row.app_id,
    appCode: row.app_code,
    title: row.title,
    manifestVersion: row.manifest_version,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeRole(row) {
  return {
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    description: row.description,
    isSystemRole: row.is_system_role,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appId: row.app_id || null,
    appCode: row.app_code || null,
    appTitle: row.app_title || null,
  };
}

function sanitizePermission(row) {
  return {
    permissionId: row.permission_id,
    permissionCode: row.permission_code,
    resource: row.resource,
    action: row.action,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appId: row.app_id || null,
    appCode: row.app_code || null,
    appTitle: row.app_title || null,
  };
}

function sanitizeRolePermission(row) {
  return {
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    roleDescription: row.role_description,
    isSystemRole: row.is_system_role,
    roleActive: row.role_active,
    permissionId: row.permission_id,
    permissionCode: row.permission_code,
    resource: row.resource,
    action: row.action,
    permissionDescription: row.permission_description,
    permissionActive: row.permission_active,
    rolePermissionActive: row.role_permission_active,
    roleAppId: row.role_app_id || row.app_id || null,
    roleAppCode: row.role_app_code || row.app_code || null,
    roleAppTitle: row.role_app_title || row.app_title || null,
    permissionAppId: row.permission_app_id || row.app_id || null,
    permissionAppCode: row.permission_app_code || row.app_code || null,
    permissionAppTitle: row.permission_app_title || row.app_title || null,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
  };
}

function sanitizeUserRole(row) {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    userStatus: row.user_status,
    isSystemUser: row.is_system_user,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    roleDescription: row.role_description,
    isSystemRole: row.is_system_role,
    roleActive: row.role_active,
    userRoleActive: row.user_role_active,
    appId: row.app_id || null,
    appCode: row.app_code || null,
    appTitle: row.app_title || null,
    userApplicationStatus: row.user_application_status || null,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
  };
}

const AUDIT_EVENT_SOURCE_SQL = `
  FROM (
    SELECT
      audit_event.*,
      COALESCE(
        NULLIF(audit_event.display_name, ''),
        NULLIF(audit_event.username, ''),
        NULLIF(audit_event.email, ''),
        'System'
      ) AS user_label,
      CONCAT_WS(
        ' ',
        COALESCE(
          NULLIF(audit_event.display_name, ''),
          NULLIF(audit_event.username, ''),
          NULLIF(audit_event.email, ''),
          'System'
        ),
        audit_event.display_name,
        audit_event.username,
        audit_event.email,
        audit_event.user_id::text
      ) AS user_search_text,
      COALESCE(role_context.role_codes, ARRAY[]::text[]) AS role_codes,
      COALESCE(array_to_string(role_context.role_codes, ', '), '') AS role_codes_text,
      COALESCE(privilege_context.privilege_codes, ARRAY[]::text[]) AS privilege_codes,
      COALESCE(array_to_string(privilege_context.privilege_codes, ', '), '') AS privilege_codes_text
    FROM auth.vw_audit_events_recent audit_event
    LEFT JOIN LATERAL (
      SELECT
        ARRAY_AGG(DISTINCT role_code ORDER BY role_code)
          FILTER (WHERE role_code IS NOT NULL AND role_code <> '') AS role_codes
      FROM (
        SELECT role.role_code
        FROM auth.user_roles user_role
        INNER JOIN auth.roles role
          ON role.role_id = user_role.role_id
        WHERE user_role.user_id = audit_event.user_id
          AND user_role.active = TRUE
          AND role.active = TRUE
          AND (audit_event.app_id IS NULL OR role.app_id = audit_event.app_id)

        UNION ALL

        SELECT NULLIF(audit_event.metadata->>'roleCode', '')

        UNION ALL

        SELECT NULLIF(audit_event.metadata->>'requiredRoleCode', '')

        UNION ALL

        SELECT role_code
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(audit_event.metadata->'roleCodes') = 'array'
              THEN audit_event.metadata->'roleCodes'
            ELSE '[]'::jsonb
          END
        ) AS metadata_roles(role_code)
      ) role_values
    ) role_context ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        ARRAY_AGG(DISTINCT privilege_code ORDER BY privilege_code)
          FILTER (WHERE privilege_code IS NOT NULL AND privilege_code <> '') AS privilege_codes
      FROM (
        SELECT NULLIF(audit_event.metadata->>'permissionCode', '') AS privilege_code

        UNION ALL

        SELECT NULLIF(audit_event.metadata->>'privilegeCode', '')

        UNION ALL

        SELECT permission_code
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(audit_event.metadata->'permissionCodes') = 'array'
              THEN audit_event.metadata->'permissionCodes'
            ELSE '[]'::jsonb
          END
        ) AS metadata_permissions(permission_code)

        UNION ALL

        SELECT missing_permission
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(audit_event.metadata->'missingPermissions') = 'array'
              THEN audit_event.metadata->'missingPermissions'
            ELSE '[]'::jsonb
          END
        ) AS metadata_missing_permissions(missing_permission)

        UNION ALL

        SELECT tool.permission_code
        FROM core.tools tool
        WHERE audit_event.resource_type = 'core.tools'
          AND tool.tool_code = audit_event.resource_id
          AND tool.permission_code IS NOT NULL

        UNION ALL

        SELECT CASE tool.risk_code
          WHEN 'low' THEN 'CORE_RUN_LOW_RISK_SCRIPT'
          WHEN 'medium' THEN 'CORE_RUN_MEDIUM_RISK_SCRIPT'
          WHEN 'high' THEN 'CORE_RUN_HIGH_RISK_SCRIPT'
          ELSE NULL
        END
        FROM core.tools tool
        WHERE audit_event.resource_type = 'core.tools'
          AND tool.tool_code = audit_event.resource_id

        UNION ALL

        SELECT TRIM(permission_code)
        FROM regexp_split_to_table(
          CASE
            WHEN audit_event.resource_type = 'permission'
              AND audit_event.action = 'require_permission'
              THEN COALESCE(audit_event.resource_id, '')
            ELSE ''
          END,
          '[|]'
        ) AS denied_permissions(permission_code)
        WHERE TRIM(permission_code) <> ''

        UNION ALL

        SELECT CASE
          WHEN audit_event.action IN ('create_workflow', 'clone_workflow')
            THEN 'WORKFLOW_CREATE'
          WHEN audit_event.action IN (
            'update_workflow',
            'archive_workflow',
            'delete_workflow',
            'create_workflow_version',
            'create_workflow_draft',
            'save_workflow_draft_graph',
            'replace_workflow_graph',
            'publish_workflow_draft',
            'discard_workflow_draft'
          )
            THEN 'WORKFLOW_CHANGE'
          WHEN audit_event.action IN (
            'start_workflow',
            'run_workflow_inline',
            'start_child_workflow',
            'retry_workflow_run',
            'cancel_workflow_run',
            'terminate_workflow_run'
          )
            THEN 'WORKFLOW_RUN'
          WHEN audit_event.action = 'decide_workflow_approval'
            THEN 'WORKFLOW_APPROVAL_DECIDE'
          WHEN audit_event.action = 'create_schedule'
            THEN 'WORKER_SCHEDULE_CREATE'
          WHEN audit_event.action IN (
            'update_schedule',
            'enable_schedule',
            'disable_schedule',
            'delete_schedule',
            'unqueue_schedule'
          )
            THEN 'WORKER_SCHEDULE_CHANGE'
          WHEN audit_event.action IN ('queue_schedule_now', 'run_schedule_now')
            THEN 'WORKER_SCHEDULE_RUN_IMMEDIATE'
          WHEN audit_event.action = 'create_listener'
            THEN 'WORKER_LISTENER_CREATE'
          WHEN audit_event.action IN ('update_listener', 'enable_listener', 'disable_listener')
            THEN 'WORKER_LISTENER_CHANGE'
          WHEN audit_event.action = 'start_temporal_workflow'
            THEN 'TEMPORAL_WORKFLOW_START'
          WHEN audit_event.action = 'cancel_temporal_workflow'
            THEN 'TEMPORAL_WORKFLOW_CANCEL'
          WHEN audit_event.action = 'terminate_temporal_workflow'
            THEN 'TEMPORAL_WORKFLOW_TERMINATE'
          WHEN audit_event.action IN (
            'create_user',
            'update_user',
            'update_user_status',
            'reset_user_password',
            'update_user_applications',
            'revoke_user_sessions',
            'revoke_session'
          )
            THEN 'ADMIN_USER_WRITE'
          WHEN audit_event.action IN ('create_role', 'update_role', 'update_user_roles')
            THEN 'ADMIN_ROLE_WRITE'
          WHEN audit_event.action IN ('create_permission', 'update_permission', 'update_role_permissions')
            THEN 'ADMIN_PERMISSION_WRITE'
          WHEN audit_event.action IN (
            'create_repository',
            'update_repository',
            'delete_repository',
            'set_skycommand_repository',
            'clear_skycommand_repository'
          )
            THEN 'ADMIN_REPOSITORY_WRITE'
          WHEN audit_event.action IN (
            'create_tool',
            'update_tool',
            'enable_tool',
            'disable_tool',
            'update_tool_parameters'
          )
            THEN 'ADMIN_TOOL_WRITE'
          WHEN audit_event.action IN ('start_workflow_bridge', 'finish_workflow_bridge')
            THEN 'WORKFLOW_RUN'
          ELSE NULL
        END
      ) privilege_values
    ) privilege_context ON TRUE
  ) audit_events
`;

async function listAuditEvents(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  addEqualsFilter({ clauses, values, columnName: 'event_type', value: filters.eventType });
  addEqualsFilter({ clauses, values, columnName: 'resource_type', value: filters.resourceType });
  addEqualsFilter({ clauses, values, columnName: 'action', value: filters.action });
  addBooleanFilter({ clauses, values, columnName: 'success', value: filters.success });
  addSearchFilter({
    clauses,
    values,
    columns: ['user_search_text'],
    searchText: filters.user,
  });
  addSearchFilter({
    clauses,
    values,
    columns: ['role_codes_text'],
    searchText: filters.role,
  });
  addSearchFilter({
    clauses,
    values,
    columns: ['privilege_codes_text'],
    searchText: filters.privilege,
  });
  addDateRangeFilters({
    clauses,
    values,
    columnName: 'created_at',
    from: filters.from,
    to: filters.to,
  });
  addSearchFilter({
    clauses,
    values,
    columns: [
      'email',
      'username',
      'display_name',
      'role_codes_text',
      'privilege_codes_text',
      'event_type',
      'resource_type',
      'action',
      'message',
    ],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: `SELECT * ${AUDIT_EVENT_SOURCE_SQL}`,
    countSql: `SELECT COUNT(*)::int AS total ${AUDIT_EVENT_SOURCE_SQL}`,
    clauses,
    values,
    orderBy: 'ORDER BY created_at DESC',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeAuditEvent),
    rows: undefined,
  };
}

async function listLoginEvents(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  addAppCodeFilter({
    clauses,
    values,
    columnName: 'app_code',
    value: filters.appCode,
    fallback: null,
  });
  addEqualsFilter({ clauses, values, columnName: 'failure_reason', value: filters.failureReason });
  addBooleanFilter({ clauses, values, columnName: 'success', value: filters.success });
  addDateRangeFilters({
    clauses,
    values,
    columnName: 'created_at',
    from: filters.from,
    to: filters.to,
  });
  addSearchFilter({
    clauses,
    values,
    columns: [
      'email_attempted',
      'matched_user_email',
      'username',
      'display_name',
      'failure_reason',
    ],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.vw_login_events_recent',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.vw_login_events_recent',
    clauses,
    values,
    orderBy: 'ORDER BY created_at DESC',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeLoginEvent),
    rows: undefined,
  };
}

async function listScriptExecutions(filters = {}) {
  try {
    await scriptExecutionService.markStaleStartedExecutions({
      reason: 'admin_read_script_executions',
    });
  } catch (cleanupError) {
    console.warn('[SkyCommand API] Stale execution cleanup failed:', cleanupError.message);
  }

  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  addEqualsFilter({ clauses, values, columnName: 'status', value: filters.status });
  addEqualsFilter({ clauses, values, columnName: 'script_name', value: filters.scriptName });
  addEqualsFilter({ clauses, values, columnName: 'category', value: filters.category });
  addDateRangeFilters({
    clauses,
    values,
    columnName: 'started_at',
    from: filters.from,
    to: filters.to,
  });
  addSearchFilter({
    clauses,
    values,
    columns: ['execution_id::text', 'email', 'username', 'display_name', 'script_name', 'category', 'status', 'summary'],
    searchText: filters.q,
  });

  const orderBy = buildWhitelistedOrderBy({
    sortValue: filters.sort,
    sortFields: {
      tool: "LOWER(COALESCE(NULLIF(BTRIM(metadata ->> 'toolLabel'), ''), script_name))",
      category: "LOWER(COALESCE(NULLIF(BTRIM(metadata ->> 'categoryLabel'), ''), category, ''))",
      status: 'status',
      startedAt: 'started_at',
      durationMs: 'duration_ms',
      finishedAt: 'finished_at',
    },
    defaultSorts: [{ field: 'startedAt', direction: 'desc' }],
    tieBreakers: ['execution_id DESC'],
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.vw_script_execution_recent',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.vw_script_execution_recent',
    clauses,
    values,
    orderBy,
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeScriptExecution),
    rows: undefined,
  };
}


async function getScriptExecutionDetail(executionId) {
  const normalizedExecutionId = normalizeOptionalString(executionId);

  if (!normalizedExecutionId) {
    const error = new Error('Execution ID is required.');
    error.statusCode = 400;
    throw error;
  }

  const result = await query(
    `
      SELECT *
      FROM auth.vw_script_execution_recent
      WHERE execution_id = $1
      LIMIT 1
    `,
    [normalizedExecutionId],
  );
  const row = result.rows[0];

  if (!row) {
    const error = new Error(`Tool execution ${normalizedExecutionId} was not found.`);
    error.statusCode = 404;
    throw error;
  }

  const metadata = row.metadata || {};
  const stdout = readScriptExecutionOutput(row.stdout_path);
  const stderr = readScriptExecutionOutput(row.stderr_path);

  return {
    execution: sanitizeScriptExecution(row),
    stdout: stdout.content,
    stderr: stderr.content,
    outputAvailability: {
      stdout: stdout.available,
      stderr: stderr.available,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      warnings: [stdout.warning, stderr.warning].filter(Boolean),
    },
    structuredResult: metadata.toolResult || null,
    structuredOutputExpected: Boolean(
      metadata.toolResultAvailable ||
        metadata.toolResultContract?.required ||
        metadata.toolResultContract?.expectedOutputType ||
        metadata.toolResultContract?.outputType
    ),
    structuredOutputPersisted: Boolean(metadata.toolResult),
    toolResultContract: metadata.toolResultContract || null,
  };
}

async function getScriptExecutionOptions() {
  const result = await query(`
    SELECT DISTINCT
      BTRIM(category) AS category,
      BTRIM(script_name) AS script_name
    FROM auth.vw_script_execution_recent
    WHERE NULLIF(BTRIM(category), '') IS NOT NULL
      AND NULLIF(BTRIM(script_name), '') IS NOT NULL
    ORDER BY category, script_name
  `);
  const rows = result.rows || [];

  return {
    categories: [...new Set(rows.map((row) => row.category))],
    tools: rows.map((row) => ({
      category: row.category,
      scriptName: row.script_name,
    })),
  };
}

async function listActiveSessions(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];
  const currentSessionId = normalizeOptionalString(filters.currentSessionId);
  addAppCodeFilter({
    clauses,
    values,
    columnName: 'app_code',
    value: filters.appCode,
    fallback: null,
  });

  const ageRange = normalizeOptionalString(filters.ageRange);
  const sessionAgeRanges = {
    UNDER_15_MIN: [0, 900],
    MIN_15_TO_60: [900, 3600],
    HOUR_1_TO_4: [3600, 14400],
    HOUR_4_TO_12: [14400, 43200],
    OVER_12_HOURS: [43200, null],
  };
  const selectedAgeRange = ageRange ? sessionAgeRanges[ageRange.toUpperCase()] : null;

  if (selectedAgeRange) {
    const [minimumAgeSeconds, maximumAgeSeconds] = selectedAgeRange;
    values.push(minimumAgeSeconds);
    clauses.push(`EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)) >= $${values.length}`);

    if (maximumAgeSeconds !== null) {
      values.push(maximumAgeSeconds);
      clauses.push(`EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)) < $${values.length}`);
    }
  }

  addEqualsFilter({ clauses, values, columnName: 'user_id', value: filters.userId });
  addDateRangeFilters({
    clauses,
    values,
    columnName: 'created_at',
    from: filters.from,
    to: filters.to,
  });
  addSearchFilter({
    clauses,
    values,
    columns: ['email', 'username', 'display_name', 'user_agent', 'ip_address::text'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.vw_active_sessions',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.vw_active_sessions',
    clauses,
    values,
    orderBy: 'ORDER BY last_seen_at DESC NULLS LAST, created_at DESC',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map((row) => sanitizeActiveSession(row, currentSessionId)),
    rows: undefined,
  };
}

async function getApplicationUserSummary(filters = {}) {
  const appCode = normalizeAppCodeFilter(filters.appCode, DEFAULT_ADMIN_APP_CODE);
  const days = Math.max(1, toPositiveInteger(filters.days, 7, 90));

  if (!appCode) {
    const error = new Error('Application code is required.');
    error.statusCode = 400;
    throw error;
  }

  const result = await query(
    `
      WITH target_app AS (
        SELECT app_id, app_code, title
        FROM core.applications
        WHERE app_code = $1
          AND active = TRUE
        LIMIT 1
      ),
      bounds AS (
        SELECT
          date_trunc('day', CURRENT_TIMESTAMP) - (($2::int - 1) * INTERVAL '1 day') AS current_start,
          date_trunc('day', CURRENT_TIMESTAMP) + INTERVAL '1 day' AS current_end,
          date_trunc('day', CURRENT_TIMESTAMP) - (($2::int * 2 - 1) * INTERVAL '1 day') AS previous_start,
          date_trunc('day', CURRENT_TIMESTAMP) - (($2::int - 1) * INTERVAL '1 day') AS previous_end
      ),
      date_window AS (
        SELECT generate_series(
          bounds.current_start,
          bounds.current_end - INTERVAL '1 day',
          INTERVAL '1 day'
        ) AS day_start
        FROM bounds
      ),
      previous_date_window AS (
        SELECT generate_series(
          bounds.previous_start,
          bounds.previous_end - INTERVAL '1 day',
          INTERVAL '1 day'
        ) AS day_start
        FROM bounds
      ),
      user_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE u.is_system_user = FALSE)::int AS total_users,
          COUNT(*) FILTER (
            WHERE u.is_system_user = FALSE
              AND u.status = 'ACTIVE'
              AND ua.status = 'ACTIVE'
          )::int AS active_users,
          COUNT(*) FILTER (
            WHERE u.is_system_user = FALSE
              AND (u.status = 'LOCKED' OR u.locked_until > CURRENT_TIMESTAMP)
          )::int AS locked_users,
          COUNT(*) FILTER (
            WHERE u.is_system_user = FALSE
              AND (u.status = 'DISABLED' OR ua.status = 'DISABLED')
          )::int AS disabled_users,
          COUNT(*) FILTER (
            WHERE u.is_system_user = FALSE
              AND ua.created_at >= bounds.current_start
              AND ua.created_at < bounds.current_end
          )::int AS new_users_current,
          COUNT(*) FILTER (
            WHERE u.is_system_user = FALSE
              AND ua.created_at >= bounds.previous_start
              AND ua.created_at < bounds.previous_end
          )::int AS new_users_previous
        FROM auth.user_applications ua
        JOIN auth.users u
          ON u.user_id = ua.user_id
        JOIN target_app app
          ON app.app_id = ua.app_id
        CROSS JOIN bounds
      ),
      role_distribution AS (
        SELECT
          role.role_code,
          role.role_name,
          COUNT(DISTINCT user_role.user_id) FILTER (
            WHERE user_role.active = TRUE
              AND user_account.is_system_user = FALSE
              AND user_application.user_id IS NOT NULL
          )::int AS assigned_users,
          COUNT(DISTINCT user_role.user_id) FILTER (
            WHERE user_role.active = TRUE
              AND user_account.is_system_user = FALSE
              AND user_account.status = 'ACTIVE'
              AND user_application.status = 'ACTIVE'
          )::int AS active_users
        FROM target_app app
        JOIN auth.roles role
          ON role.app_id = app.app_id
         AND role.active = TRUE
        LEFT JOIN auth.user_roles user_role
          ON user_role.role_id = role.role_id
         AND user_role.active = TRUE
        LEFT JOIN auth.users user_account
          ON user_account.user_id = user_role.user_id
        LEFT JOIN auth.user_applications user_application
          ON user_application.user_id = user_account.user_id
         AND user_application.app_id = app.app_id
        GROUP BY role.role_code, role.role_name
      ),
      active_session_scope AS (
        SELECT
          session_record.session_id,
          session_record.user_id,
          session_record.created_at,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - session_record.created_at))::bigint AS age_seconds
        FROM auth.sessions session_record
        JOIN auth.users user_account
          ON user_account.user_id = session_record.user_id
        JOIN target_app app
          ON app.app_id = session_record.app_id
        JOIN auth.user_applications user_application
          ON user_application.user_id = user_account.user_id
         AND user_application.app_id = session_record.app_id
        WHERE session_record.revoked_at IS NULL
          AND session_record.expires_at > CURRENT_TIMESTAMP
          AND user_account.status = 'ACTIVE'
          AND user_account.is_system_user = FALSE
          AND user_application.status = 'ACTIVE'
      ),
      session_stats AS (
        SELECT
          COUNT(*)::int AS active_sessions,
          COUNT(DISTINCT user_id)::int AS users_online,
          COUNT(*) FILTER (WHERE age_seconds >= 43200)::int AS stale_sessions,
          COALESCE(MAX(age_seconds), 0)::bigint AS longest_session_seconds
        FROM active_session_scope
      ),
      session_age_distribution AS (
        SELECT 1 AS sort_order, 'UNDER_15_MIN' AS bucket_key, 'Under 15 min' AS bucket_label, 0::bigint AS min_age_seconds, 899::bigint AS max_age_seconds, COUNT(*) FILTER (WHERE age_seconds < 900)::int AS session_count FROM active_session_scope
        UNION ALL
        SELECT 2, 'MIN_15_TO_60', '15–60 min', 900::bigint, 3599::bigint, COUNT(*) FILTER (WHERE age_seconds >= 900 AND age_seconds < 3600)::int FROM active_session_scope
        UNION ALL
        SELECT 3, 'HOUR_1_TO_4', '1–4 hours', 3600::bigint, 14399::bigint, COUNT(*) FILTER (WHERE age_seconds >= 3600 AND age_seconds < 14400)::int FROM active_session_scope
        UNION ALL
        SELECT 4, 'HOUR_4_TO_12', '4–12 hours', 14400::bigint, 43199::bigint, COUNT(*) FILTER (WHERE age_seconds >= 14400 AND age_seconds < 43200)::int FROM active_session_scope
        UNION ALL
        SELECT 5, 'OVER_12_HOURS', 'Over 12 hours', 43200::bigint, NULL::bigint, COUNT(*) FILTER (WHERE age_seconds >= 43200)::int FROM active_session_scope
      ),
      login_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE le.success = TRUE)::int AS successful_logins,
          COUNT(*) FILTER (WHERE le.success = FALSE)::int AS failed_logins,
          MAX(le.created_at) FILTER (WHERE le.success = TRUE) AS last_login_at
        FROM auth.login_events le
        JOIN target_app app
          ON app.app_id = le.app_id
        CROSS JOIN bounds
        WHERE le.created_at >= bounds.current_start
          AND le.created_at < bounds.current_end
      ),
      previous_login_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE le.success = TRUE)::int AS successful_logins,
          COUNT(*) FILTER (WHERE le.success = FALSE)::int AS failed_logins
        FROM auth.login_events le
        JOIN target_app app
          ON app.app_id = le.app_id
        CROSS JOIN bounds
        WHERE le.created_at >= bounds.previous_start
          AND le.created_at < bounds.previous_end
      ),
      daily_activity AS (
        SELECT
          day.day_start,
          (
            SELECT COUNT(*)::int
            FROM auth.login_events le
            JOIN target_app app
              ON app.app_id = le.app_id
            WHERE le.success = TRUE
              AND le.created_at >= day.day_start
              AND le.created_at < day.day_start + INTERVAL '1 day'
          ) AS successful_logins,
          (
            SELECT COUNT(*)::int
            FROM auth.login_events le
            JOIN target_app app
              ON app.app_id = le.app_id
            WHERE le.success = FALSE
              AND le.created_at >= day.day_start
              AND le.created_at < day.day_start + INTERVAL '1 day'
          ) AS failed_logins,
          (
            SELECT COUNT(*)::int
            FROM auth.sessions s
            JOIN auth.users u
              ON u.user_id = s.user_id
            JOIN target_app app
              ON app.app_id = s.app_id
            WHERE s.created_at < day.day_start + INTERVAL '1 day'
              AND s.expires_at > day.day_start
              AND (s.revoked_at IS NULL OR s.revoked_at > day.day_start)
              AND u.is_system_user = FALSE
          ) AS active_sessions
        FROM date_window day
      ),
      previous_daily_activity AS (
        SELECT
          day.day_start,
          (
            SELECT COUNT(*)::int
            FROM auth.sessions s
            JOIN auth.users u
              ON u.user_id = s.user_id
            JOIN target_app app
              ON app.app_id = s.app_id
            WHERE s.created_at < day.day_start + INTERVAL '1 day'
              AND s.expires_at > day.day_start
              AND (s.revoked_at IS NULL OR s.revoked_at > day.day_start)
              AND u.is_system_user = FALSE
          ) AS active_sessions
        FROM previous_date_window day
      ),
      activity_stats AS (
        SELECT
          COALESCE(AVG(active_sessions), 0)::numeric(12,2) AS average_sessions,
          COALESCE(MAX(active_sessions), 0)::int AS peak_sessions,
          COALESCE((ARRAY_AGG(active_sessions ORDER BY day_start DESC))[1], 0)::int AS end_sessions
        FROM daily_activity
      ),
      previous_activity_stats AS (
        SELECT
          COALESCE(AVG(active_sessions), 0)::numeric(12,2) AS average_sessions,
          COALESCE(MAX(active_sessions), 0)::int AS peak_sessions,
          COALESCE((ARRAY_AGG(active_sessions ORDER BY day_start DESC))[1], 0)::int AS end_sessions
        FROM previous_daily_activity
      )
      SELECT
        app.app_code,
        app.title AS app_title,
        user_stats.total_users,
        user_stats.active_users,
        user_stats.locked_users,
        user_stats.disabled_users,
        user_stats.new_users_current,
        user_stats.new_users_previous,
        session_stats.active_sessions,
        session_stats.users_online,
        session_stats.stale_sessions,
        session_stats.longest_session_seconds,
        login_stats.successful_logins,
        login_stats.failed_logins,
        login_stats.last_login_at,
        previous_login_stats.successful_logins AS previous_successful_logins,
        previous_login_stats.failed_logins AS previous_failed_logins,
        activity_stats.average_sessions,
        activity_stats.peak_sessions,
        activity_stats.end_sessions,
        previous_activity_stats.average_sessions AS previous_average_sessions,
        previous_activity_stats.peak_sessions AS previous_peak_sessions,
        previous_activity_stats.end_sessions AS previous_end_sessions,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'date', TO_CHAR(activity.day_start, 'YYYY-MM-DD'),
                'successfulLogins', activity.successful_logins,
                'failedLogins', activity.failed_logins,
                'activeSessions', activity.active_sessions
              )
              ORDER BY activity.day_start
            )
            FROM daily_activity activity
          ),
          '[]'::jsonb
        ) AS activity,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'roleCode', role_item.role_code,
                'roleName', role_item.role_name,
                'assignedUsers', role_item.assigned_users,
                'activeUsers', role_item.active_users
              )
              ORDER BY role_item.assigned_users DESC, role_item.role_code
            )
            FROM role_distribution role_item
            WHERE role_item.assigned_users > 0
          ),
          '[]'::jsonb
        ) AS role_distribution,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'key', age_bucket.bucket_key,
                'label', age_bucket.bucket_label,
                'count', age_bucket.session_count,
                'minAgeSeconds', age_bucket.min_age_seconds,
                'maxAgeSeconds', age_bucket.max_age_seconds
              )
              ORDER BY age_bucket.sort_order
            )
            FROM session_age_distribution age_bucket
          ),
          '[]'::jsonb
        ) AS session_age_distribution
      FROM target_app app
      CROSS JOIN user_stats
      CROSS JOIN session_stats
      CROSS JOIN login_stats
      CROSS JOIN previous_login_stats
      CROSS JOIN activity_stats
      CROSS JOIN previous_activity_stats
    `,
    [appCode, days],
  );

  if (result.rowCount === 0) {
    const error = new Error(`Application ${appCode} was not found or is inactive.`);
    error.statusCode = 404;
    throw error;
  }

  const row = result.rows[0];
  const activity = Array.isArray(row.activity) ? row.activity : [];
  const roleDistribution = Array.isArray(row.role_distribution) ? row.role_distribution : [];
  const sessionAgeDistribution = Array.isArray(row.session_age_distribution)
    ? row.session_age_distribution
    : [];
  const newUsersComparison = buildComparisonMetric(row.new_users_current, row.new_users_previous);
  const successfulLoginComparison = buildComparisonMetric(
    row.successful_logins,
    row.previous_successful_logins,
  );
  const failedLoginComparison = buildComparisonMetric(
    row.failed_logins,
    row.previous_failed_logins,
  );
  const sessionFootprintAverageComparison = buildComparisonMetric(
    row.average_sessions,
    row.previous_average_sessions,
  );
  const sessionFootprintEndComparison = buildComparisonMetric(
    row.end_sessions,
    row.previous_end_sessions,
  );
  const peakSessionFootprintComparison = buildComparisonMetric(
    row.peak_sessions,
    row.previous_peak_sessions,
  );
  const health = buildIdentityHealth({
    failedLogins: row.failed_logins,
    lockedUsers: row.locked_users,
    sessionFootprintComparison: sessionFootprintAverageComparison,
    staleSessions: row.stale_sessions,
    successfulLogins: row.successful_logins,
    successfulLoginComparison,
  });

  return {
    appCode: row.app_code,
    appTitle: row.app_title,
    days,
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers: Number(row.total_users || 0),
      activeUsers: Number(row.active_users || 0),
      lockedUsers: Number(row.locked_users || 0),
      disabledUsers: Number(row.disabled_users || 0),
      newUsers: newUsersComparison.current,
      activeSessions: Number(row.active_sessions || 0),
      usersOnline: Number(row.users_online || 0),
      staleSessions: Number(row.stale_sessions || 0),
      longestSessionSeconds: Number(row.longest_session_seconds || 0),
      successfulLogins: Number(row.successful_logins || 0),
      failedLogins: Number(row.failed_logins || 0),
      failedLoginRate: health.failedLoginRate,
      sessionFootprintAverage: Number(row.average_sessions || 0),
      peakSessionFootprint: Number(row.peak_sessions || 0),
      lastLoginAt: row.last_login_at || null,
    },
    comparison: {
      newUsers: newUsersComparison,
      successfulLogins: successfulLoginComparison,
      failedLogins: failedLoginComparison,
      sessionFootprintAverage: sessionFootprintAverageComparison,
      sessionFootprintEnd: sessionFootprintEndComparison,
      peakSessionFootprint: peakSessionFootprintComparison,
    },
    health,
    roleDistribution: roleDistribution.map((item) => ({
      roleCode: item.roleCode,
      roleName: item.roleName,
      assignedUsers: Number(item.assignedUsers || 0),
      activeUsers: Number(item.activeUsers || 0),
    })),
    sessionAgeDistribution: sessionAgeDistribution.map((item) => ({
      key: item.key,
      label: item.label,
      count: Number(item.count || 0),
      minAgeSeconds: Number(item.minAgeSeconds || 0),
      maxAgeSeconds:
        item.maxAgeSeconds === null || item.maxAgeSeconds === undefined
          ? null
          : Number(item.maxAgeSeconds),
    })),
    activity: activity.map((item) => ({
      date: item.date,
      successfulLogins: Number(item.successfulLogins || 0),
      failedLogins: Number(item.failedLogins || 0),
      activeSessions: Number(item.activeSessions || 0),
    })),
  };
}

async function listApplications(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  addBooleanFilter({ clauses, values, columnName: 'active', value: filters.active });
  addSearchFilter({
    clauses,
    values,
    columns: ['app_code', 'title', 'description'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: `
      SELECT app_id, app_code, title, manifest_version, description, active, created_at, updated_at
      FROM core.applications
    `,
    countSql: 'SELECT COUNT(*)::int AS total FROM core.applications',
    clauses,
    values,
    orderBy: `
      ORDER BY
        CASE app_code
          WHEN 'SKYSERVER_ADMIN' THEN 1
          WHEN 'SKYWEB' THEN 2
          WHEN 'SKYSERVER_CORE' THEN 3
          WHEN 'SKYSERVER_WORKER' THEN 4
          ELSE 99
        END,
        app_code
    `,
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeApplication),
    rows: undefined,
  };
}

async function listUsers(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];
  const appCode = normalizeOptionalString(filters.appCode);

  if (appCode !== null) {
    values.push(appCode);
    clauses.push(`EXISTS (
      SELECT 1
      FROM auth.user_applications ua
      JOIN core.applications app
        ON app.app_id = ua.app_id
      WHERE ua.user_id = u.user_id
        AND app.app_code = $${values.length}
        AND ua.status = 'ACTIVE'
        AND app.active = TRUE
    )`);
  }

  const roleCode = normalizeOptionalString(filters.roleCode);

  if (roleCode !== null) {
    values.push(roleCode);
    const rolePlaceholder = `$${values.length}`;
    let roleApplicationClause = '';

    if (appCode !== null) {
      values.push(appCode);
      roleApplicationClause = `AND role_app.app_code = $${values.length}`;
    }

    clauses.push(`EXISTS (
      SELECT 1
      FROM auth.user_roles user_role
      JOIN auth.roles role
        ON role.role_id = user_role.role_id
      JOIN core.applications role_app
        ON role_app.app_id = role.app_id
      WHERE user_role.user_id = u.user_id
        AND user_role.active = TRUE
        AND role.active = TRUE
        AND role_app.active = TRUE
        AND role.role_code = ${rolePlaceholder}
        ${roleApplicationClause}
    )`);
  }

  addEqualsFilter({ clauses, values, columnName: 'u.status', value: filters.status });
  addBooleanFilter({
    clauses,
    values,
    columnName: 'u.is_system_user',
    value: filters.isSystemUser,
  });
  addSearchFilter({
    clauses,
    values,
    columns: ['u.email', 'u.username', 'u.display_name', 'u.status'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: `
      SELECT
        u.user_id,
        u.email,
        u.username,
        u.display_name,
        u.status,
        u.is_system_user,
        u.failed_login_count,
        u.locked_until,
        u.last_login_at,
        u.created_at,
        u.updated_at
      FROM auth.users u
    `,
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.users u',
    clauses,
    values,
    orderBy: 'ORDER BY u.created_at DESC',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeUser),
    rows: undefined,
  };
}

async function listRoles(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];
  addAppCodeFilter({ clauses, values, columnName: 'app.app_code', value: filters.appCode });

  addBooleanFilter({ clauses, values, columnName: 'r.active', value: filters.active });
  addSearchFilter({
    clauses,
    values,
    columns: ['r.role_code', 'r.role_name', 'r.description'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: `
      SELECT
        r.*,
        app.app_code,
        app.title AS app_title
      FROM auth.roles r
      JOIN core.applications app
        ON app.app_id = r.app_id
    `,
    countSql: `
      SELECT COUNT(*)::int AS total
      FROM auth.roles r
      JOIN core.applications app
        ON app.app_id = r.app_id
    `,
    clauses,
    values,
    orderBy: `
      ORDER BY
        CASE r.role_code
          WHEN 'SUPER_ADMIN' THEN 1
          WHEN 'ADMIN' THEN 2
          WHEN 'OPERATOR' THEN 3
          WHEN 'VIEWER' THEN 4
          ELSE 99
        END,
        r.role_code
    `,
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeRole),
    rows: undefined,
  };
}

async function listPermissions(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];
  addAppCodeFilter({ clauses, values, columnName: 'app.app_code', value: filters.appCode });

  addEqualsFilter({ clauses, values, columnName: 'p.resource', value: filters.resource });
  addEqualsFilter({ clauses, values, columnName: 'p.action', value: filters.action });
  addBooleanFilter({ clauses, values, columnName: 'p.active', value: filters.active });
  addSearchFilter({
    clauses,
    values,
    columns: ['p.permission_code', 'p.resource', 'p.action', 'p.description'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: `
      SELECT
        p.*,
        app.app_code,
        app.title AS app_title
      FROM auth.permissions p
      JOIN core.applications app
        ON app.app_id = p.app_id
    `,
    countSql: `
      SELECT COUNT(*)::int AS total
      FROM auth.permissions p
      JOIN core.applications app
        ON app.app_id = p.app_id
    `,
    clauses,
    values,
    orderBy: 'ORDER BY p.resource, p.action, p.permission_code',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizePermission),
    rows: undefined,
  };
}

async function listRolePermissions(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];
  addAppCodeFilter({ clauses, values, columnName: 'role_app_code', value: filters.appCode });

  addEqualsFilter({ clauses, values, columnName: 'role_code', value: filters.roleCode });
  addEqualsFilter({
    clauses,
    values,
    columnName: 'permission_code',
    value: filters.permissionCode,
  });
  addEqualsFilter({ clauses, values, columnName: 'resource', value: filters.resource });
  addSearchFilter({
    clauses,
    values,
    columns: ['role_code', 'role_name', 'permission_code', 'resource', 'action'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.vw_role_permissions',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.vw_role_permissions',
    clauses,
    values,
    orderBy: 'ORDER BY role_code, resource, action, permission_code',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeRolePermission),
    rows: undefined,
  };
}

async function listUserRoles(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];
  addAppCodeFilter({
    clauses,
    values,
    columnName: 'app_code',
    value: filters.appCode,
    fallback: null,
  });

  addEqualsFilter({ clauses, values, columnName: 'role_code', value: filters.roleCode });
  addEqualsFilter({ clauses, values, columnName: 'user_status', value: filters.status });
  addSearchFilter({
    clauses,
    values,
    columns: ['email', 'username', 'display_name', 'role_code', 'role_name'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.vw_user_roles',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.vw_user_roles',
    clauses,
    values,
    orderBy: 'ORDER BY email, role_code',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeUserRole),
    rows: undefined,
  };
}

module.exports = {
  listAuditEvents,
  listLoginEvents,
  listScriptExecutions,
  getScriptExecutionDetail,
  getScriptExecutionOptions,
  listActiveSessions,
  getApplicationUserSummary,
  listApplications,
  listUsers,
  listRoles,
  listPermissions,
  listRolePermissions,
  listUserRoles,
};
