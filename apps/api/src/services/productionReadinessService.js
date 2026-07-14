const os = require('os');

const { query } = require('../../../../packages/db/src/connection');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const workflowHealthService = require('./workflowHealthService');

const STATUS_WEIGHT = {
  PASS: 0,
  INFO: 1,
  WARNING: 2,
  FAIL: 3,
};

const REQUIRED_RELATIONS = [
  'auth.users',
  'auth.roles',
  'auth.permissions',
  'auth.role_permissions',
  'auth.sessions',
  'core.tools',
  'worker.schedules',
  'worker.workflow_definitions',
  'worker.workflow_versions',
  'worker.workflow_nodes',
  'worker.workflow_edges',
  'worker.workflow_run_records',
  'worker.workflow_node_run_records',
  'worker.workflow_approval_requests',
  'worker.temporal_worker_heartbeats',
  'worker.vw_temporal_worker_heartbeats',
];

const EXECUTABLE_NODE_TYPES = ['TOOL', 'API_CALL', 'WORKFLOW', 'TEMPORAL_WORKFLOW'];

function isMissingRelationError(error) {
  return error?.code === '42P01' || /does not exist/i.test(error?.message || '');
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
}

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function hasDangerousSecretValue(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  return (
    !normalized ||
    normalized === 'change_me' ||
    normalized === 'change-me' ||
    normalized === 'your_password_here' ||
    normalized === 'change_me_internal_dev_token' ||
    normalized.includes('changeme')
  );
}

function isLocalValue(value) {
  return /localhost|127\.0\.0\.1|skyserver_dev|development/i.test(String(value || ''));
}

function buildCheck(code, label, status, message, details = null) {
  return {
    code,
    label,
    status,
    message,
    details,
  };
}

function getWorstStatus(checks = []) {
  return checks.reduce((worst, check) => {
    const currentWeight = STATUS_WEIGHT[check.status] ?? STATUS_WEIGHT.INFO;
    const worstWeight = STATUS_WEIGHT[worst] ?? STATUS_WEIGHT.INFO;

    return currentWeight > worstWeight ? check.status : worst;
  }, 'PASS');
}

function buildSection(code, label, description, checks = []) {
  return {
    code,
    label,
    description,
    status: getWorstStatus(checks),
    checks,
  };
}

function summarizeSections(sections = []) {
  const counts = {
    pass: 0,
    info: 0,
    warning: 0,
    fail: 0,
  };

  for (const section of sections) {
    for (const check of section.checks || []) {
      const key = String(check.status || 'INFO').toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  const overallStatus = counts.fail > 0 ? 'FAIL' : counts.warning > 0 ? 'WARNING' : 'PASS';

  return {
    overallStatus,
    counts,
    totalChecks: counts.pass + counts.info + counts.warning + counts.fail,
  };
}

async function safeQuery(sql, params = [], fallbackRows = []) {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return fallbackRows;
    }

    throw error;
  }
}

async function relationExists(relationName) {
  const rows = await safeQuery(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [relationName],
    [{ exists: false }],
  );

  return rows[0]?.exists === true;
}

async function countRows(sql, params = []) {
  const rows = await safeQuery(sql, params, [{ count: 0 }]);
  return toInteger(rows[0]?.count);
}

function buildEnvironmentSection() {
  const config = getTemporalConfig();
  const authEnabled =
    String(process.env.SKYSERVER_INTERNAL_API_AUTH_ENABLED || 'true').toLowerCase() !== 'false';
  const checks = [];

  checks.push(
    buildCheck(
      'node_env',
      'Node environment declared',
      process.env.NODE_ENV === 'production' ? 'PASS' : 'WARNING',
      process.env.NODE_ENV === 'production'
        ? 'NODE_ENV is set to production.'
        : `NODE_ENV is ${process.env.NODE_ENV || 'not set'}; production deployments should set NODE_ENV=production.`,
    ),
  );

  checks.push(
    buildCheck(
      'jwt_secret',
      'JWT/session secret configured',
      hasDangerousSecretValue(process.env.JWT_SECRET) ? 'FAIL' : 'PASS',
      hasDangerousSecretValue(process.env.JWT_SECRET)
        ? 'JWT_SECRET is missing or still uses a development placeholder.'
        : 'JWT_SECRET is configured and does not match known placeholder values.',
    ),
  );

  checks.push(
    buildCheck(
      'internal_api_token',
      'Internal API token configured',
      authEnabled && hasDangerousSecretValue(process.env.SKYSERVER_INTERNAL_API_TOKEN)
        ? 'FAIL'
        : authEnabled
          ? 'PASS'
          : 'WARNING',
      authEnabled && hasDangerousSecretValue(process.env.SKYSERVER_INTERNAL_API_TOKEN)
        ? 'Internal API auth is enabled, but SKYSERVER_INTERNAL_API_TOKEN is missing or uses the default development token.'
        : authEnabled
          ? 'Internal API auth is enabled with a non-placeholder token.'
          : 'Internal API auth is not enabled. Protected API_CALL nodes should use a shared internal token outside local-only development.',
    ),
  );

  checks.push(
    buildCheck(
      'database_name',
      'Database target is explicit',
      isBlank(process.env.PGDATABASE)
        ? 'FAIL'
        : isLocalValue(process.env.PGDATABASE)
          ? 'WARNING'
          : 'PASS',
      isBlank(process.env.PGDATABASE)
        ? 'PGDATABASE is missing.'
        : isLocalValue(process.env.PGDATABASE)
          ? `PGDATABASE is ${process.env.PGDATABASE}; this looks like a local/dev database.`
          : 'PGDATABASE is set and does not look like a local development database.',
    ),
  );

  checks.push(
    buildCheck(
      'temporal_address',
      'Temporal address configured',
      isBlank(config.address) ? 'FAIL' : isLocalValue(config.address) ? 'WARNING' : 'PASS',
      isBlank(config.address)
        ? 'TEMPORAL_ADDRESS is missing.'
        : isLocalValue(config.address)
          ? `Temporal address is ${config.address}; this is appropriate for local testing, not durable production hosting.`
          : 'Temporal address is configured for a non-local endpoint.',
    ),
  );

  checks.push(
    buildCheck(
      'temporal_task_queue',
      'Temporal task queue configured',
      isBlank(config.taskQueue) ? 'FAIL' : 'PASS',
      isBlank(config.taskQueue)
        ? 'TEMPORAL_TASK_QUEUE is missing.'
        : `Workflow worker task queue is ${config.taskQueue}.`,
    ),
  );

  return buildSection(
    'environment',
    'Environment and secrets',
    'Checks runtime mode, database target, Temporal endpoint, and sensitive development placeholders.',
    checks,
  );
}

async function buildTemporalSection(workerHealthResult) {
  const health = workerHealthResult || {};
  const checks = [];

  checks.push(
    buildCheck(
      'temporal_reachable',
      'Temporal server reachable',
      health.temporal?.reachable ? 'PASS' : 'FAIL',
      health.temporal?.reachable
        ? `Temporal is reachable at ${health.temporal.address}.`
        : health.temporal?.error || 'Temporal server could not be reached.',
    ),
  );

  checks.push(
    buildCheck(
      'task_queue_polling',
      'Task queue has pollers',
      health.taskQueue?.pollerCount > 0 ? 'PASS' : 'FAIL',
      health.taskQueue?.pollerCount > 0
        ? `${health.taskQueue.pollerCount} Temporal poller(s) reported for ${health.taskQueue.name || health.taskQueue.taskQueue}.`
        : 'No Temporal pollers were reported for the configured task queue.',
    ),
  );

  checks.push(
    buildCheck(
      'worker_heartbeat',
      'SkyServer worker heartbeat is fresh',
      health.worker?.recentHeartbeatCount > 0 ? 'PASS' : 'WARNING',
      health.worker?.recentHeartbeatCount > 0
        ? `${health.worker.recentHeartbeatCount} recent SkyServer worker heartbeat(s) found.`
        : 'No recent worker heartbeat was found. Restart npm run temporal:worker:dev after heartbeat migrations are applied.',
    ),
  );

  checks.push(
    buildCheck(
      'stale_running_runs',
      'No stale running workflow runs',
      health.runs?.staleRunning > 0 ? 'WARNING' : 'PASS',
      health.runs?.staleRunning > 0
        ? `${health.runs.staleRunning} workflow run(s) look stale.`
        : 'No stale running workflow runs were detected.',
    ),
  );

  checks.push(
    buildCheck(
      'recent_failures',
      'Recent workflow failure pressure',
      health.runs?.failedLast24h > 0 ? 'WARNING' : 'PASS',
      health.runs?.failedLast24h > 0
        ? `${health.runs.failedLast24h} workflow run(s) failed in the last 24 hours.`
        : 'No workflow run failures in the last 24 hours.',
    ),
  );

  return buildSection(
    'temporal_worker',
    'Temporal and worker readiness',
    'Checks Temporal reachability, task queue pollers, worker heartbeat freshness, and recent runtime pressure.',
    checks,
  );
}

async function buildDatabaseSection() {
  const relationResults = await Promise.all(
    REQUIRED_RELATIONS.map(async (relationName) => ({
      relationName,
      exists: await relationExists(relationName),
    })),
  );
  const missingRelations = relationResults
    .filter((item) => !item.exists)
    .map((item) => item.relationName);
  const orphanRunningRuns = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_run_records
    WHERE status IN ('QUEUED', 'RUNNING')
      AND temporal_workflow_id IS NULL
      AND created_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes'
  `);
  const pendingApprovalsMissingRuns = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_approval_requests a
    LEFT JOIN worker.workflow_run_records r
      ON r.workflow_run_record_id = a.workflow_run_record_id
    WHERE a.status = 'PENDING'
      AND r.workflow_run_record_id IS NULL
  `);
  const runningNodeRunsWithoutRun = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_node_run_records n
    LEFT JOIN worker.workflow_run_records r
      ON r.workflow_run_record_id = n.workflow_run_record_id
    WHERE n.status = 'RUNNING'
      AND r.workflow_run_record_id IS NULL
  `);
  const checks = [
    buildCheck(
      'required_relations',
      'Required database objects exist',
      missingRelations.length === 0 ? 'PASS' : 'FAIL',
      missingRelations.length === 0
        ? 'All required workflow, auth, core, and worker tables/views are present.'
        : `${missingRelations.length} required relation(s) are missing.`,
      missingRelations,
    ),
    buildCheck(
      'orphan_running_runs',
      'No orphaned queued/running workflow records',
      orphanRunningRuns > 0 ? 'WARNING' : 'PASS',
      orphanRunningRuns > 0
        ? `${orphanRunningRuns} queued/running workflow run(s) are missing a Temporal workflow ID after the grace period.`
        : 'No orphaned queued/running workflow records were detected.',
    ),
    buildCheck(
      'pending_approvals_missing_runs',
      'Pending approvals are attached to runs',
      pendingApprovalsMissingRuns > 0 ? 'FAIL' : 'PASS',
      pendingApprovalsMissingRuns > 0
        ? `${pendingApprovalsMissingRuns} pending approval request(s) are missing their workflow run.`
        : 'Pending approval rows are attached to workflow runs.',
    ),
    buildCheck(
      'running_node_runs_without_run',
      'Running node rows are attached to runs',
      runningNodeRunsWithoutRun > 0 ? 'FAIL' : 'PASS',
      runningNodeRunsWithoutRun > 0
        ? `${runningNodeRunsWithoutRun} running node record(s) are missing a parent workflow run.`
        : 'Running node records have parent workflow runs.',
    ),
  ];

  return buildSection(
    'database',
    'Database readiness',
    'Checks required tables/views and looks for stale or orphaned operational records.',
    checks,
  );
}

async function buildWorkflowSafetySection() {
  const activeWithoutPublished = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_definitions d
    WHERE d.status = 'ACTIVE'
      AND d.enabled = TRUE
      AND d.visible_in_admin = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM worker.workflow_versions v
        WHERE v.workflow_definition_id = d.workflow_definition_id
          AND v.status = 'PUBLISHED'
      )
  `);
  const draftVersions = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_versions
    WHERE status = 'DRAFT'
  `);
  const missingApprovalRoles = await countRows(`
    WITH approval_nodes AS (
      SELECT
        wn.workflow_node_id,
        COALESCE(NULLIF(wn.input_parameters->>'requiredRoleCode', ''), NULLIF(wn.input_parameters->>'requiredRole', '')) AS required_role_code
      FROM worker.workflow_nodes wn
      JOIN worker.workflow_versions wv
        ON wv.workflow_version_id = wn.workflow_version_id
      WHERE wv.status = 'PUBLISHED'
        AND wn.node_type_code = 'HUMAN_APPROVAL'
    )
    SELECT COUNT(*)::int AS count
    FROM approval_nodes an
    LEFT JOIN auth.roles r
      ON r.role_code = an.required_role_code
      AND r.active = TRUE
    WHERE an.required_role_code IS NOT NULL
      AND r.role_id IS NULL
  `);
  const missingRetryPolicies = await countRows(
    `
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_nodes wn
    JOIN worker.workflow_versions wv
      ON wv.workflow_version_id = wn.workflow_version_id
    WHERE wv.status = 'PUBLISHED'
      AND wn.node_type_code = ANY($1)
      AND (wn.retry_policy IS NULL OR wn.retry_policy = '{}'::jsonb)
  `,
    [EXECUTABLE_NODE_TYPES],
  );
  const missingTimeouts = await countRows(
    `
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_nodes wn
    JOIN worker.workflow_versions wv
      ON wv.workflow_version_id = wn.workflow_version_id
    WHERE wv.status = 'PUBLISHED'
      AND wn.node_type_code = ANY($1)
      AND wn.timeout_ms IS NULL
  `,
    [EXECUTABLE_NODE_TYPES],
  );
  const backwardsConditionalEdges = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node
      ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node
      ON to_node.workflow_node_id = e.to_node_id
    JOIN worker.workflow_versions wv
      ON wv.workflow_version_id = e.workflow_version_id
    WHERE wv.status = 'PUBLISHED'
      AND e.edge_type = 'CONDITIONAL'
      AND COALESCE(to_node.display_order, 0) <= COALESCE(from_node.display_order, 0)
  `);
  const schedulesToInactiveWorkflows = await countRows(`
    WITH schedule_targets AS (
      SELECT
        s.schedule_id,
        COALESCE(
          NULLIF(s.parameters->>'workflowCode', ''),
          NULLIF(s.parameters->>'workflow_code', '')
        ) AS workflow_code
      FROM worker.schedules s
      JOIN core.tools t
        ON t.tool_id = s.tool_id
      WHERE s.enabled = TRUE
        AND t.tool_code = 'skyserver_workflow_start'
    )
    SELECT COUNT(*)::int AS count
    FROM schedule_targets st
    LEFT JOIN worker.workflow_definitions d
      ON d.workflow_code = st.workflow_code
      AND d.status = 'ACTIVE'
      AND d.enabled = TRUE
    WHERE st.workflow_code IS NOT NULL
      AND d.workflow_definition_id IS NULL
  `);
  const checks = [
    buildCheck(
      'active_definitions_have_published_versions',
      'Active workflows have published versions',
      activeWithoutPublished > 0 ? 'FAIL' : 'PASS',
      activeWithoutPublished > 0
        ? `${activeWithoutPublished} active workflow definition(s) do not have a published version.`
        : 'All active visible workflows have a published version.',
    ),
    buildCheck(
      'draft_versions_visible',
      'Draft versions are intentionally pending',
      draftVersions > 0 ? 'INFO' : 'PASS',
      draftVersions > 0
        ? `${draftVersions} draft workflow version(s) exist. Drafts are safe until published.`
        : 'No draft workflow versions are pending.',
    ),
    buildCheck(
      'approval_roles_exist',
      'Human approval roles resolve',
      missingApprovalRoles > 0 ? 'FAIL' : 'PASS',
      missingApprovalRoles > 0
        ? `${missingApprovalRoles} published approval node(s) reference missing or inactive roles.`
        : 'Published human approval nodes reference active roles or have no role gate.',
    ),
    buildCheck(
      'retry_policy_present',
      'Executable nodes have retry policies',
      missingRetryPolicies > 0 ? 'WARNING' : 'PASS',
      missingRetryPolicies > 0
        ? `${missingRetryPolicies} published executable node(s) have no explicit retry policy.`
        : 'Published executable nodes have explicit retry policies.',
    ),
    buildCheck(
      'timeout_policy_present',
      'Executable nodes have timeout policies',
      missingTimeouts > 0 ? 'WARNING' : 'PASS',
      missingTimeouts > 0
        ? `${missingTimeouts} published executable node(s) have no explicit timeout_ms.`
        : 'Published executable nodes have explicit timeout values.',
    ),
    buildCheck(
      'conditional_edges_forward_only',
      'Conditional branch edges are forward-only',
      backwardsConditionalEdges > 0 ? 'FAIL' : 'PASS',
      backwardsConditionalEdges > 0
        ? `${backwardsConditionalEdges} published conditional edge(s) point backward or to the same display order.`
        : 'Published conditional branch edges are forward-only.',
    ),
    buildCheck(
      'workflow_schedules_target_active_definitions',
      'Workflow schedules target active definitions',
      schedulesToInactiveWorkflows > 0 ? 'FAIL' : 'PASS',
      schedulesToInactiveWorkflows > 0
        ? `${schedulesToInactiveWorkflows} active workflow schedule(s) point at missing or inactive workflow definitions.`
        : 'Active workflow schedules target active definitions.',
    ),
  ];

  return buildSection(
    'workflow_safety',
    'Workflow graph safety',
    'Checks published versions, branches, approval roles, retry/timeout policy, and schedule targets.',
    checks,
  );
}

async function buildAuthSection({ user, permissions }) {
  const superAdmins = await countRows(`
    SELECT COUNT(DISTINCT u.user_id)::int AS count
    FROM auth.users u
    JOIN auth.user_roles ur
      ON ur.user_id = u.user_id
      AND ur.active = TRUE
    JOIN auth.roles r
      ON r.role_id = ur.role_id
    WHERE u.status = 'ACTIVE'
      AND r.active = TRUE
      AND r.role_code = 'SUPER_ADMIN'
  `);
  const workflowApprovalPermissions = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM auth.permissions
    WHERE active = TRUE
      AND permission_code IN ('WORKFLOW_APPROVAL_READ', 'WORKFLOW_APPROVAL_DECIDE')
  `);
  const workflowProcessingPermissions = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM auth.permissions
    WHERE active = TRUE
      AND permission_code IN ('WORKFLOW_CREATE', 'WORKFLOW_RUN', 'WORKFLOW_CHANGE')
  `);
  const schedulerProcessingPermissions = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM auth.permissions
    WHERE active = TRUE
      AND permission_code IN (
        'WORKER_SCHEDULE_CREATE',
        'WORKER_SCHEDULE_CHANGE',
        'WORKER_SCHEDULE_RUN_IMMEDIATE'
      )
  `);
  const listenerProcessingPermissions = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM auth.permissions
    WHERE active = TRUE
      AND permission_code IN (
        'WORKER_LISTENER_CREATE',
        'WORKER_LISTENER_CHANGE'
      )
  `);
  const administrativeProcessingGrants = await countRows(`
    SELECT COUNT(DISTINCT r.role_code || ':' || p.permission_code)::int AS count
    FROM auth.role_permissions rp
    JOIN auth.roles r
      ON r.role_id = rp.role_id
     AND r.active = TRUE
    JOIN auth.permissions p
      ON p.permission_id = rp.permission_id
     AND p.active = TRUE
    WHERE rp.active = TRUE
      AND r.role_code IN ('SUPER_ADMIN', 'ADMIN')
      AND p.permission_code IN (
        'WORKFLOW_CREATE',
        'WORKFLOW_RUN',
        'WORKFLOW_CHANGE',
        'WORKER_SCHEDULE_CREATE',
        'WORKER_SCHEDULE_CHANGE',
        'WORKER_SCHEDULE_RUN_IMMEDIATE',
        'WORKER_LISTENER_CREATE',
        'WORKER_LISTENER_CHANGE'
      )
  `);
  const unauthorizedProcessingGrants = await countRows(`
    SELECT COUNT(*)::int AS count
    FROM auth.role_permissions rp
    JOIN auth.roles r
      ON r.role_id = rp.role_id
     AND r.active = TRUE
    JOIN auth.permissions p
      ON p.permission_id = rp.permission_id
     AND p.active = TRUE
    WHERE rp.active = TRUE
      AND r.role_code NOT IN ('SUPER_ADMIN', 'ADMIN')
      AND p.permission_code IN (
        'WORKFLOW_CREATE',
        'WORKFLOW_RUN',
        'WORKFLOW_CHANGE',
        'WORKER_SCHEDULE_CREATE',
        'WORKER_SCHEDULE_CHANGE',
        'WORKER_SCHEDULE_RUN_IMMEDIATE',
        'WORKER_LISTENER_CREATE',
        'WORKER_LISTENER_CHANGE'
      )
  `);
  const currentPermissionCodes = new Set(
    (permissions || []).map((permission) => permission.permissionCode).filter(Boolean),
  );
  const checks = [
    buildCheck(
      'super_admin_exists',
      'At least one active super admin exists',
      superAdmins > 0 ? 'PASS' : 'FAIL',
      superAdmins > 0
        ? `${superAdmins} active SUPER_ADMIN user(s) found.`
        : 'No active SUPER_ADMIN user was found.',
    ),
    buildCheck(
      'current_user_authenticated',
      'Current operator session is authenticated',
      user?.userId ? 'PASS' : 'FAIL',
      user?.userId
        ? `Current operator is ${user.displayName || user.email || user.username}.`
        : 'Current request has no authenticated user context.',
    ),
    buildCheck(
      'approval_permissions_exist',
      'Workflow approval permissions exist',
      workflowApprovalPermissions >= 2 ? 'PASS' : 'FAIL',
      workflowApprovalPermissions >= 2
        ? 'Approval read/decide permissions are active.'
        : 'One or more workflow approval permissions are missing or inactive.',
    ),
    buildCheck(
      'workflow_processing_permissions_exist',
      'Workflow processing permissions exist',
      workflowProcessingPermissions >= 3 ? 'PASS' : 'FAIL',
      workflowProcessingPermissions >= 3
        ? 'Workflow create, run, and change permissions are active.'
        : 'One or more granular workflow processing permissions are missing or inactive.',
    ),
    buildCheck(
      'scheduler_processing_permissions_exist',
      'Scheduler processing permissions exist',
      schedulerProcessingPermissions >= 3 ? 'PASS' : 'FAIL',
      schedulerProcessingPermissions >= 3
        ? 'Scheduler create, change, and immediate-run permissions are active.'
        : 'One or more granular scheduler processing permissions are missing or inactive.',
    ),
    buildCheck(
      'listener_processing_permissions_exist',
      'Listener processing permissions exist',
      listenerProcessingPermissions >= 2 ? 'PASS' : 'FAIL',
      listenerProcessingPermissions >= 2
        ? 'Listener create and change permissions are active.'
        : 'One or more granular listener processing permissions are missing or inactive.',
    ),
    buildCheck(
      'processing_permissions_admin_only',
      'Processing permissions are restricted to administrators',
      administrativeProcessingGrants >= 16 && unauthorizedProcessingGrants === 0 ? 'PASS' : 'FAIL',
      administrativeProcessingGrants >= 16 && unauthorizedProcessingGrants === 0
        ? 'All eight processing permissions are granted to ADMIN and SUPER_ADMIN only.'
        : `${administrativeProcessingGrants}/16 expected administrative grants found; ${unauthorizedProcessingGrants} unauthorized active grant(s) found.`,
    ),
    buildCheck(
      'current_user_can_read_workflows',
      'Current operator can inspect workflows',
      currentPermissionCodes.has('WORKFLOW_READ') ||
        currentPermissionCodes.has('TEMPORAL_WORKFLOW_READ')
        ? 'PASS'
        : 'WARNING',
      currentPermissionCodes.has('WORKFLOW_READ') ||
        currentPermissionCodes.has('TEMPORAL_WORKFLOW_READ')
        ? 'Current operator has workflow read visibility.'
        : 'Current operator does not have workflow read visibility.',
    ),
  ];

  return buildSection(
    'auth_permissions',
    'Auth and permission readiness',
    'Checks super admin presence, workflow approval permissions, administrator-only workflow/scheduler/listener processing grants, and current operator visibility.',
    checks,
  );
}

function buildOperationsSection(workerHealthResult) {
  const config = getTemporalConfig();
  const checks = [
    buildCheck(
      'supervised_services',
      'Run API and workers as supervised services',
      'INFO',
      'Production hosting should run API, Admin-Web, Temporal, worker, and database under a supervisor with restart policy.',
    ),
    buildCheck(
      'persistent_temporal_store',
      'Use persistent Temporal storage',
      isLocalValue(config.address) ? 'WARNING' : 'INFO',
      isLocalValue(config.address)
        ? 'Temporal is pointing at local dev. Production should use a persistent Temporal deployment, not start-dev storage.'
        : 'Temporal is configured away from the local dev default. Confirm persistent history storage and retention policy.',
    ),
    buildCheck(
      'postgres_backups',
      'Database backup plan exists',
      'INFO',
      'Confirm PostgreSQL backups and restore drills for workflow, approval, auth, and macro state.',
    ),
    buildCheck(
      'log_retention',
      'Log retention and diagnostics path exists',
      'INFO',
      'Confirm API, Temporal worker, and Temporal server logs are retained outside the terminal session.',
    ),
  ];

  return buildSection(
    'operations',
    'Operational hardening reminders',
    'Documents the production controls that cannot be fully proven from a local process.',
    checks,
  );
}

function buildCommands(workerHealthResult) {
  const config = getTemporalConfig();
  const commands = workerHealthResult?.cliCommands || {};

  return {
    startApi: 'npm run api',
    startWeb: 'npm run web',
    startTemporal: commands.startTemporal || 'temporal server start-dev',
    startTemporalWorker: commands.startWorker || 'npm run temporal:worker:dev',
    describeTaskQueue:
      commands.describeTaskQueue ||
      `temporal task-queue describe --address ${config.address} --namespace ${config.namespace} --task-queue ${config.taskQueue}`,
    dbHealth: 'npm run db:health',
  };
}

async function getProductionReadiness({ user = null, permissions = [] } = {}) {
  const workerHealthResult = await workflowHealthService
    .getWorkflowWorkerHealth()
    .catch((error) => ({
      overallStatus: 'OFFLINE',
      temporal: {
        reachable: false,
        error: error.message || String(error),
      },
      taskQueue: {
        pollerCount: 0,
        healthy: false,
      },
      worker: {
        recentHeartbeatCount: 0,
        status: 'UNKNOWN',
      },
      runs: {},
      approvals: {},
      hints: [error.message || String(error)],
    }));

  const sections = [
    buildEnvironmentSection(),
    await buildTemporalSection(workerHealthResult),
    await buildDatabaseSection(),
    await buildWorkflowSafetySection(),
    await buildAuthSection({ user, permissions }),
    buildOperationsSection(workerHealthResult),
  ];
  const summary = summarizeSections(sections);

  return {
    generatedAt: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      processId: process.pid,
      nodeVersion: process.version,
    },
    overallStatus: summary.overallStatus,
    counts: summary.counts,
    totalChecks: summary.totalChecks,
    sections,
    workerHealth: {
      overallStatus: workerHealthResult.overallStatus || 'UNKNOWN',
      temporalReachable: workerHealthResult.temporal?.reachable === true,
      taskQueueHealthy: workerHealthResult.taskQueue?.healthy === true,
      workerStatus: workerHealthResult.worker?.status || 'UNKNOWN',
      activeRuns: workerHealthResult.runs?.active || 0,
      pendingApprovals: workerHealthResult.approvals?.pending || 0,
    },
    commands: buildCommands(workerHealthResult),
  };
}

module.exports = {
  getProductionReadiness,
};
