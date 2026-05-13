-- ============================================================
-- SkyServer Auth Seed Data
-- Roles + Permissions
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------

WITH auth_app AS (
    SELECT app_id
    FROM core.applications
    WHERE app_code = 'SKYSERVER_ADMIN'
    LIMIT 1
), role_seed (
    role_code,
    role_name,
    description,
    is_system_role,
    active
) AS (
    VALUES
(
        'SUPER_ADMIN',
        'Super Administrator',
        'Full access to all SkyServer administrative, database, ingestion, automation, Git, and script execution capabilities.',
        TRUE,
        TRUE
    ),
    (
        'ADMIN',
        'Administrator',
        'Administrative access to most SkyServer tools, excluding highest-risk system operations unless separately granted.',
        TRUE,
        TRUE
    ),
    (
        'OPERATOR',
        'Operator',
        'Operational access for running approved tools such as ingestion, status checks, repo maps, and safe database checks.',
        TRUE,
        TRUE
    ),
    (
        'VIEWER',
        'Viewer',
        'Read-only access to dashboards, macro views, safe status information, and non-destructive operational visibility.',
        TRUE,
        TRUE
    )
)
INSERT INTO auth.roles (
    app_id,
    role_code,
    role_name,
    description,
    is_system_role,
    active
)
SELECT
    auth_app.app_id,
    role_seed.role_code,
    role_seed.role_name,
    role_seed.description,
    role_seed.is_system_role,
    role_seed.active
FROM role_seed
CROSS JOIN auth_app
ON CONFLICT (role_code)
DO UPDATE SET
    app_id = EXCLUDED.app_id,
    role_name = EXCLUDED.role_name,
    description = EXCLUDED.description,
    is_system_role = EXCLUDED.is_system_role,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- Permissions
-- ------------------------------------------------------------

WITH auth_app AS (
    SELECT app_id
    FROM core.applications
    WHERE app_code = 'SKYSERVER_ADMIN'
    LIMIT 1
), permission_seed (
    permission_code,
    resource,
    action,
    description,
    active
) AS (
    VALUES
(
        'CORE_VIEW_TOOLS',
        'core',
        'view_tools',
        'View configured SkyServer Core tools and tool metadata.',
        TRUE
    ),
    (
        'CORE_RUN_LOW_RISK_SCRIPT',
        'core',
        'run_low_risk_script',
        'Run low-risk scripts exposed through SkyServer Core or Admin-Web.',
        TRUE
    ),
    (
        'CORE_RUN_MEDIUM_RISK_SCRIPT',
        'core',
        'run_medium_risk_script',
        'Run medium-risk scripts exposed through SkyServer Core or Admin-Web.',
        TRUE
    ),
    (
        'CORE_RUN_HIGH_RISK_SCRIPT',
        'core',
        'run_high_risk_script',
        'Run high-risk scripts exposed through SkyServer Core or Admin-Web.',
        TRUE
    ),

    (
        'DB_HEALTH_RUN',
        'database',
        'health_check',
        'Run PostgreSQL database health checks.',
        TRUE
    ),
    (
        'DB_BUILD_RUN',
        'database',
        'build',
        'Run full PostgreSQL database build process from migrations and seeds.',
        TRUE
    ),

    (
        'INGESTION_RUN_FRED',
        'ingestion',
        'run_fred',
        'Run FRED macroeconomic data ingestion.',
        TRUE
    ),
    (
        'INGESTION_RUN_BOC',
        'ingestion',
        'run_boc',
        'Run Bank of Canada macroeconomic data ingestion.',
        TRUE
    ),
    (
        'INGESTION_RUN_STATCAN',
        'ingestion',
        'run_statcan',
        'Run Statistics Canada macroeconomic data ingestion.',
        TRUE
    ),
    (
        'INGESTION_RUN_MANUAL',
        'ingestion',
        'run_manual',
        'Run manual spreadsheet or CSV ingestion.',
        TRUE
    ),
    (
        'INGESTION_VIEW_STATUS',
        'ingestion',
        'view_status',
        'View ingestion status and recent ingestion activity.',
        TRUE
    ),

    (
        'GIT_STATUS_RUN',
        'git',
        'status',
        'Run configured repository status checks.',
        TRUE
    ),
    (
        'GIT_COMMIT_RUN',
        'git',
        'dev_commit',
        'Run configured development branch commit workflow.',
        TRUE
    ),
    (
        'GIT_MAIN_MERGE_RUN',
        'git',
        'main_merge',
        'Run configured main branch merge and synchronization workflow.',
        TRUE
    ),

    (
        'REPO_MAP_GENERATE',
        'files',
        'generate_repo_map',
        'Generate repository map documentation.',
        TRUE
    ),
    (
        'REPO_ZIP_GENERATE',
        'files',
        'generate_repo_zip',
        'Generate repository zip archives for project handoff and review.',
        TRUE
    ),

    (
        'MACRO_VIEW_READ',
        'macro',
        'read_views',
        'Read macroeconomic reporting and dashboard views.',
        TRUE
    ),

    (
        'ADMIN_USER_READ',
        'admin_users',
        'read',
        'View Admin-Web users.',
        TRUE
    ),
    (
        'ADMIN_USER_WRITE',
        'admin_users',
        'write',
        'Create, update, disable, or manage Admin-Web users.',
        TRUE
    ),
    (
        'ADMIN_ROLE_READ',
        'admin_roles',
        'read',
        'View roles and role assignments.',
        TRUE
    ),
    (
        'ADMIN_ROLE_WRITE',
        'admin_roles',
        'write',
        'Create, update, assign, or revoke roles.',
        TRUE
    ),
    (
        'ADMIN_PERMISSION_READ',
        'admin_permissions',
        'read',
        'View permissions and role-permission assignments.',
        TRUE
    ),
    (
        'ADMIN_PERMISSION_WRITE',
        'admin_permissions',
        'write',
        'Create, update, grant, or revoke permissions.',
        TRUE
    ),

    (
        'ADMIN_REPOSITORY_READ',
        'admin_repositories',
        'read',
        'View repository configuration and profile-specific repository paths.',
        TRUE
    ),
    (
        'ADMIN_REPOSITORY_WRITE',
        'admin_repositories',
        'write',
        'Create, update, disable, or manage repository configuration and repository paths.',
        TRUE
    ),

    (
        'AUDIT_READ',
        'audit',
        'read',
        'View audit events.',
        TRUE
    ),
    (
        'SCRIPT_EXECUTION_READ',
        'script_execution',
        'read',
        'View script execution history.',
        TRUE
    ),
    (
        'SCRIPT_EXECUTION_CANCEL',
        'script_execution',
        'cancel',
        'Cancel or mark script execution as cancelled when supported.',
        TRUE
    ),

    (
        'WORKER_SCHEDULE_READ',
        'worker_schedules',
        'read',
        'View worker schedules, run history, worker health, and worker-visible tools.',
        TRUE
    ),
    (
        'WORKER_SCHEDULE_WRITE',
        'worker_schedules',
        'write',
        'Create, update, enable, or disable worker schedules.',
        TRUE
    ),
    (
        'WORKER_SCHEDULE_RUN',
        'worker_schedules',
        'run_now',
        'Queue an existing worker schedule for immediate execution.',
        TRUE
    ),
    (
        'WORKER_LISTENER_READ',
        'worker_listeners',
        'read',
        'View worker listener definitions.',
        TRUE
    ),
    (
        'WORKER_LISTENER_WRITE',
        'worker_listeners',
        'write',
        'Create, update, enable, or disable worker listeners.',
        TRUE
    ),
    (
        'WORKER_EVENT_READ',
        'worker_events',
        'read',
        'View worker listener events and related execution outcomes.',
        TRUE
    ),
    (
        'WORKER_ADMIN',
        'worker_admin',
        'admin',
        'View worker nodes and perform elevated worker administration tasks.',
        TRUE
    )
)
INSERT INTO auth.permissions (
    app_id,
    permission_code,
    resource,
    action,
    description,
    active
)
SELECT
    auth_app.app_id,
    permission_seed.permission_code,
    permission_seed.resource,
    permission_seed.action,
    permission_seed.description,
    permission_seed.active
FROM permission_seed
CROSS JOIN auth_app
ON CONFLICT (permission_code)
DO UPDATE SET
    app_id = EXCLUDED.app_id,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- SUPER_ADMIN gets everything
-- ------------------------------------------------------------

INSERT INTO auth.role_permissions (
    role_id,
    permission_id,
    active
)
SELECT
    r.role_id,
    p.permission_id,
    TRUE
FROM auth.roles r
CROSS JOIN auth.permissions p
WHERE r.role_code = 'SUPER_ADMIN'
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
    active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- ADMIN permissions
-- ------------------------------------------------------------

WITH admin_permissions(permission_code) AS (
    VALUES
        ('CORE_VIEW_TOOLS'),
        ('CORE_RUN_LOW_RISK_SCRIPT'),
        ('CORE_RUN_MEDIUM_RISK_SCRIPT'),

        ('DB_HEALTH_RUN'),

        ('INGESTION_RUN_FRED'),
        ('INGESTION_RUN_BOC'),
        ('INGESTION_RUN_STATCAN'),
        ('INGESTION_RUN_MANUAL'),
        ('INGESTION_VIEW_STATUS'),

        ('GIT_STATUS_RUN'),
        ('GIT_COMMIT_RUN'),

        ('REPO_MAP_GENERATE'),
        ('REPO_ZIP_GENERATE'),

        ('MACRO_VIEW_READ'),

        ('ADMIN_USER_READ'),
        ('ADMIN_USER_WRITE'),
        ('ADMIN_ROLE_READ'),
        ('ADMIN_ROLE_WRITE'),
        ('ADMIN_PERMISSION_READ'),
        ('ADMIN_REPOSITORY_READ'),
        ('ADMIN_REPOSITORY_WRITE'),

        ('WORKER_SCHEDULE_READ'),
        ('WORKER_SCHEDULE_WRITE'),
        ('WORKER_SCHEDULE_RUN'),
        ('WORKER_LISTENER_READ'),
        ('WORKER_LISTENER_WRITE'),
        ('WORKER_EVENT_READ'),
        ('WORKER_ADMIN'),

        ('AUDIT_READ'),
        ('SCRIPT_EXECUTION_READ')
)
INSERT INTO auth.role_permissions (
    role_id,
    permission_id,
    active
)
SELECT
    r.role_id,
    p.permission_id,
    TRUE
FROM auth.roles r
JOIN admin_permissions ap
    ON TRUE
JOIN auth.permissions p
    ON p.permission_code = ap.permission_code
WHERE r.role_code = 'ADMIN'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
    active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- OPERATOR permissions
-- ------------------------------------------------------------

WITH operator_permissions(permission_code) AS (
    VALUES
        ('CORE_VIEW_TOOLS'),
        ('CORE_RUN_LOW_RISK_SCRIPT'),
        ('CORE_RUN_MEDIUM_RISK_SCRIPT'),

        ('DB_HEALTH_RUN'),

        ('INGESTION_RUN_FRED'),
        ('INGESTION_RUN_BOC'),
        ('INGESTION_RUN_STATCAN'),
        ('INGESTION_RUN_MANUAL'),
        ('INGESTION_VIEW_STATUS'),

        ('GIT_STATUS_RUN'),

        ('REPO_MAP_GENERATE'),
        ('REPO_ZIP_GENERATE'),

        ('MACRO_VIEW_READ'),
        ('ADMIN_REPOSITORY_READ'),

        ('WORKER_SCHEDULE_READ'),
        ('WORKER_SCHEDULE_RUN'),
        ('WORKER_LISTENER_READ'),
        ('WORKER_EVENT_READ'),

        ('SCRIPT_EXECUTION_READ')
)
INSERT INTO auth.role_permissions (
    role_id,
    permission_id,
    active
)
SELECT
    r.role_id,
    p.permission_id,
    TRUE
FROM auth.roles r
JOIN operator_permissions op
    ON TRUE
JOIN auth.permissions p
    ON p.permission_code = op.permission_code
WHERE r.role_code = 'OPERATOR'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
    active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- VIEWER permissions
-- ------------------------------------------------------------

WITH viewer_permissions(permission_code) AS (
    VALUES
        ('CORE_VIEW_TOOLS'),
        ('DB_HEALTH_RUN'),
        ('GIT_STATUS_RUN'),
        ('MACRO_VIEW_READ'),
        ('ADMIN_REPOSITORY_READ'),
        ('WORKER_SCHEDULE_READ'),
        ('WORKER_LISTENER_READ'),
        ('WORKER_EVENT_READ'),
        ('SCRIPT_EXECUTION_READ')
)
INSERT INTO auth.role_permissions (
    role_id,
    permission_id,
    active
)
SELECT
    r.role_id,
    p.permission_id,
    TRUE
FROM auth.roles r
JOIN viewer_permissions vp
    ON TRUE
JOIN auth.permissions p
    ON p.permission_code = vp.permission_code
WHERE r.role_code = 'VIEWER'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
    active = TRUE,
    granted_at = CURRENT_TIMESTAMP;


-- ------------------------------------------------------------
-- Existing/admin users get SkyServer Admin application access
-- ------------------------------------------------------------

WITH auth_app AS (
    SELECT app_id
    FROM core.applications
    WHERE app_code = 'SKYSERVER_ADMIN'
    LIMIT 1
)
INSERT INTO auth.user_applications (
    user_id,
    app_id,
    status,
    created_by,
    updated_by
)
SELECT
    u.user_id,
    auth_app.app_id,
    'ACTIVE',
    u.created_by,
    u.updated_by
FROM auth.users u
CROSS JOIN auth_app
ON CONFLICT (user_id, app_id)
DO UPDATE SET
    status = EXCLUDED.status,
    updated_by = EXCLUDED.updated_by,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
