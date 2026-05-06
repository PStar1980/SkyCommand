const { query } = require('../../../../packages/db/src/connection');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
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
    metadata: row.metadata || {},
    hasStdoutLog: Boolean(row.stdout_path),
    hasStderrLog: Boolean(row.stderr_path),
  };
}

function sanitizeActiveSession(row) {
  return {
    sessionId: row.session_id,
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
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
  };
}

async function listAuditEvents(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  addEqualsFilter({ clauses, values, columnName: 'event_type', value: filters.eventType });
  addEqualsFilter({ clauses, values, columnName: 'resource_type', value: filters.resourceType });
  addEqualsFilter({ clauses, values, columnName: 'action', value: filters.action });
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
      'email',
      'username',
      'display_name',
      'event_type',
      'resource_type',
      'action',
      'message',
    ],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.vw_audit_events_recent',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.vw_audit_events_recent',
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
    columns: ['email', 'username', 'display_name', 'script_name', 'category', 'status', 'summary'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.vw_script_execution_recent',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.vw_script_execution_recent',
    clauses,
    values,
    orderBy: 'ORDER BY started_at DESC',
    limit,
    offset,
  });

  return {
    ...result,
    items: result.rows.map(sanitizeScriptExecution),
    rows: undefined,
  };
}

async function listActiveSessions(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

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
    columns: ['email', 'username', 'display_name', 'user_agent'],
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
    items: result.rows.map(sanitizeActiveSession),
    rows: undefined,
  };
}

async function listUsers(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  addEqualsFilter({ clauses, values, columnName: 'status', value: filters.status });
  addBooleanFilter({ clauses, values, columnName: 'is_system_user', value: filters.isSystemUser });
  addSearchFilter({
    clauses,
    values,
    columns: ['email', 'username', 'display_name', 'status'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: `
      SELECT
        user_id,
        email,
        username,
        display_name,
        status,
        is_system_user,
        failed_login_count,
        locked_until,
        last_login_at,
        created_at,
        updated_at
      FROM auth.users
    `,
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.users',
    clauses,
    values,
    orderBy: 'ORDER BY created_at DESC',
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

  addBooleanFilter({ clauses, values, columnName: 'active', value: filters.active });
  addSearchFilter({
    clauses,
    values,
    columns: ['role_code', 'role_name', 'description'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.roles',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.roles',
    clauses,
    values,
    orderBy: `
      ORDER BY
        CASE role_code
          WHEN 'SUPER_ADMIN' THEN 1
          WHEN 'ADMIN' THEN 2
          WHEN 'OPERATOR' THEN 3
          WHEN 'VIEWER' THEN 4
          ELSE 99
        END,
        role_code
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

  addEqualsFilter({ clauses, values, columnName: 'resource', value: filters.resource });
  addEqualsFilter({ clauses, values, columnName: 'action', value: filters.action });
  addBooleanFilter({ clauses, values, columnName: 'active', value: filters.active });
  addSearchFilter({
    clauses,
    values,
    columns: ['permission_code', 'resource', 'action', 'description'],
    searchText: filters.q,
  });

  const result = await runPagedQuery({
    selectSql: 'SELECT * FROM auth.permissions',
    countSql: 'SELECT COUNT(*)::int AS total FROM auth.permissions',
    clauses,
    values,
    orderBy: 'ORDER BY resource, action, permission_code',
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
  listActiveSessions,
  listUsers,
  listRoles,
  listPermissions,
  listRolePermissions,
  listUserRoles,
};
