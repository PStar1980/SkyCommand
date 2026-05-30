# 🌌 SkyServer

**Private Admin, Automation, PostgreSQL, API, Data Ingestion, Worker Scheduling, and Operational Monitoring Hub for the Sky Ecosystem**

SkyServer is the private administrative and automation core of the **Sky Ecosystem**. It combines a Node/Express API layer, PostgreSQL-backed configuration and audit tables, a private React Admin-Web interface, macroeconomic data ingestion pipelines, repository automation, file utilities, worker-driven scheduling, and a configurable CLI launcher into one operational control plane.

SkyServer is designed to be precise, repeatable, idempotent, permission-aware, observable, and easy to extend. It supports local development workflows, database rebuilds, macro data ingestion from multiple public data providers, manual spreadsheet ingestion, Git automation, script orchestration, browser-triggered administration through **SkyServer Admin-Web**, and scheduled background automation through the **worker runtime**.

---

## ✅ Phase 7 Completion Snapshot

Phase 7 is complete. SkyServer includes a full API and Admin-Web monitoring/control layer for macro views, ingestion status, and administrative actions.

Completed Phase 7 capabilities include:

- **Macro API endpoints** for curated macro views, latest rows, column metadata, indicator registry access, raw indicator series, and macro summary reporting.
- **Ingestion status API endpoints** for source health, recent ingestion executions, indicator freshness, stale-data detection, missing-table detection, and per-indicator diagnostics.
- **Admin action API endpoints** for user account management, role management, permission/privilege management, role assignment, permission assignment, session revocation, password reset, and read-only system settings.
- **SkyServer Admin Access Control pages** for Users, Roles, and Privileges.
- **SkyServer Admin Ingestion Status page** for pipeline health, source cards, recent ingestion runs, indicator freshness, and indicator detail inspection.
- **Dashboard v2** as a command-center view for API/DB health, ingestion status, macro summary, tools, sessions, script executions, audit events, and current operator permissions.

---

## ✅ Phase 8 Completion Snapshot

Phase 8 is complete for the **scheduler-driven automation foundation**. SkyServer now has a PostgreSQL-backed worker schema, a standalone worker daemon, worker API endpoints, and Admin-Web automation control surfaces.

Completed Phase 8 capabilities include:

- **Worker schema and tables** for worker nodes, schedules, schedule runs, listeners, and listener events.
- **Worker daemon runtime** under `apps/worker`, including node registration, heartbeat tracking, schedule polling, due-schedule claiming, scheduled tool execution, and worker-launched script execution logging.
- **Worker-visible tool execution** using the existing relational `core` tool manifest and `worker` visibility channel.
- **Scheduler support** for one-time and recurring interval schedules.
- **Queue / Unqueue controls** for requesting or cancelling pending immediate schedule execution.
- **Safe schedule archive/delete flow** that removes completed or archived schedules from active scheduler views without destroying run history.
- **Worker API endpoints** for health, tools, nodes, schedules, runs, listeners, and listener events.
- **SkyServer Admin Automation section** with separate Scheduler and Listener pages.
- **Active Schedules view** focused on active schedule definitions, excluding completed one-time schedules.
- **Active Listeners view** prepared for event-driven automation configuration.
- **Dashboard automation visibility** showing worker status, nodes online, active schedules, upcoming run time, and recent automation runs.

Listener runtime processors are intentionally staged for a later focused implementation. The database structure, API surface, and Admin-Web listener surface are now in place.

---

## 🚀 Core Capabilities

### 🧠 SkyServer Core CLI Tool

SkyServer includes a command-line launcher:

```bash
npm run core
```

or directly:

```bash
node packages/core/src/SkyServer_Core.js
```

The CLI provides a menu-driven interface for running configured tools without requiring users to remember script paths or command syntax.

Current tool groups include:

- **Database Tools**
  - PostgreSQL health checks
  - Full database rebuilds from ordered SQL migrations and seeds

- **Git Tools**
  - Dev branch commit workflow
  - Repository status checks
  - Main branch merge/sync workflow

- **Ingestion Tools**
  - FRED macro data ingestion
  - Bank of Canada data ingestion
  - Statistics Canada data ingestion
  - Manual spreadsheet/CSV ingestion

- **File / Structure Tools**
  - Repository map generation
  - Repository zip generation for project handoff, including `node_modules` by default so received zips can run local Vite/build checks without a fresh install

The operational tool model is backed by relational configuration in the PostgreSQL `core` schema for CLI, API, Admin-Web, and worker execution. This creates a strong bridge between tool metadata, permissions, risk levels, parameter definitions, runtime configuration, and UI visibility.

---

## 🖥️ Admin-Web Control Surface

SkyServer includes a private React/Vite Admin-Web application under:

```text
apps/admin-web
```

Run the Admin-Web development server with:

```bash
npm run web
```

The Admin-Web currently includes:

- **Login**
  - Authenticates through the API
  - Stores a bearer session token client-side
  - Protects private routes

- **Dashboard v2**
  - Acts as the SkyServer Admin command center
  - Shows API and database health
  - Shows ingestion health and macro summary information
  - Shows automation/worker status, nodes online, active schedules, next run, and recent automation activity
  - Shows visible tool counts, active sessions, script execution counts, audit event counts, and current operator permission count
  - Provides quick links into Tools, Ingestion, Automation, Executions, Audit, and Access Control
  - Displays source-level pipeline health and recent operational activity

- **Tools**
  - Lists permission-filtered tools from the API
  - Renders tool parameters dynamically
  - Supports repository dropdown parameters
  - Runs low-, medium-, and high-risk tools
  - Shows confirmation panels before sensitive execution
  - Requires phrase confirmation for high-risk tools
  - Displays running state, elapsed time, status, exit code, duration, summary, stdout, and stderr

- **Ingestion Status**
  - Shows overall ingestion health
  - Shows FRED, Bank of Canada, and Statistics Canada source-health cards
  - Shows current/stale/problem indicator counts
  - Shows recent ingestion execution history
  - Shows indicator freshness with source/status/active/search filters
  - Provides per-indicator detail with row counts, date ranges, thresholds, and status messages

- **Automation**
  - Provides Scheduler and Listener pages
  - Shows worker health, worker nodes, worker-visible tools, active schedules, and schedule run history
  - Supports schedule creation and editing for worker-visible tools
  - Supports one-time and recurring interval schedules
  - Supports queueing schedules for immediate execution and unqueueing pending requests
  - Supports safe schedule archive/delete behavior
  - Shows Active Listeners as the prepared surface for event-driven automation

- **Script Executions**
  - Shows execution history from the database
  - Supports status/limit filtering
  - Displays execution metadata and log availability
  - Includes tool executions launched manually through Admin-Web and scheduled executions launched by the worker

- **Audit Events**
  - Shows authentication, authorization, and tool execution audit activity
  - Supports result/limit filtering
  - Displays event metadata for traceability

- **Access Control**
  - Provides Users, Roles, and Privileges pages
  - Supports user creation, user profile updates, status changes, role assignment, password reset, and session revocation
  - Supports role creation, role updates, activation/deactivation, and permission assignment
  - Supports permission/privilege creation, updates, activation/deactivation, and role usage review

The Admin-Web is intentionally private and operational. It is not the public SkyWeb layer; it is the control surface for trusted administration.

---

## 🔐 Authentication, Sessions, and RBAC

SkyServer includes an authentication and permission layer built around the `auth` schema.

Core auth tables include:

```text
auth.users
auth.roles
auth.permissions
auth.user_roles
auth.role_permissions
auth.sessions
auth.login_events
auth.audit_events
auth.script_execution_log
```

Core auth views include:

```text
auth.vw_user_permissions
auth.vw_user_roles
auth.vw_role_permissions
auth.vw_active_sessions
auth.vw_login_events_recent
auth.vw_audit_events_recent
auth.vw_script_execution_recent
```

Key design points:

- Passwords are stored as hashes.
- Session tokens are stored as hashes only.
- Login attempts are recorded.
- Successful and failed operational actions are audited.
- API routes are protected by bearer-token authentication.
- Sensitive endpoints are protected by permission middleware.
- Tool visibility is filtered by the logged-in user’s permissions.
- Worker scheduling permissions are separated from normal tool execution permissions.

Create the first admin user with:

```bash
npm run auth:create-admin
```

---

## 🧩 Relational Tool Manifest

SkyServer stores operational configuration in the `core` schema.

Core configuration tables include:

```text
core.applications
core.visibility_channels
core.runtimes
core.risk_levels
core.config_profiles
core.repositories
core.repository_paths
core.tool_categories
core.tool_category_visibility
core.tools
core.tool_visibility
core.param_types
core.option_sources
core.tool_parameters
core.tool_parameter_options
```

Core manifest views include:

```text
core.vw_cli_categories
core.vw_cli_tools
core.vw_admin_web_tools
core.vw_tool_manifest
core.vw_tool_parameters
core.vw_tool_parameter_options
core.vw_repository_paths
```

This relational manifest controls:

- Which tools exist
- Which tools are visible in CLI, Admin-Web, API, and worker channels
- Which permission is required per tool
- Which risk level applies per tool
- Whether confirmation is required
- Whether parameters are allowed
- How parameter inputs are rendered
- Which repository paths are available for repo-driven tools

This is the main plug-in layer for future tools: add the script, register it in the core configuration, assign permissions/risk/visibility/parameters, and SkyServer can expose it without hardcoding a new page for every script.

---

## 🧰 Admin-Web Tool Catalog

Current Admin-Web-visible tool families include:

### Database Tools

| Tool                  | Risk | Purpose                                                                           |
| --------------------- | ---- | --------------------------------------------------------------------------------- |
| Database Health Check | Low  | Tests PostgreSQL connectivity using the configured environment.                   |
| Database Build        | High | Rebuilds the selected PostgreSQL database from ordered migrations and seed files. |

### Git Tools

| Tool              | Risk   | Purpose                                                                                         |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Repository Status | Low    | Checks configured repository status across dev and main branches.                               |
| Dev Commit        | Medium | Generates the repository map, stages, commits, and pushes the selected repository’s dev branch. |
| Main Merge        | High   | Synchronizes main/dev branches and may push branch updates and tags.                            |

### Data Ingestion Tools

| Tool                            | Risk   | Purpose                                                                               |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| Run FRED Ingestion              | Medium | Loads active FRED macroeconomic indicators into PostgreSQL.                           |
| Run Bank of Canada Ingestion    | Medium | Loads active Bank of Canada macroeconomic indicators into PostgreSQL.                 |
| Run Statistics Canada Ingestion | Medium | Loads active Statistics Canada vector-based macroeconomic indicators into PostgreSQL. |
| Run Manual Ingestion            | Medium | Loads configured manual spreadsheet or CSV data into PostgreSQL.                      |

### File Tools

| Tool                    | Risk | Purpose                                                                      |
| ----------------------- | ---- | ---------------------------------------------------------------------------- |
| Generate Repository Map | Low  | Generates a readable repository map for documentation and structural review. |

High-risk tools require the configured phrase confirmation before execution. The current default phrase is:

```text
RUN HIGH RISK
```

---

## 🔌 API Layer

The API server is located under:

```text
apps/api
```

Run the API server with:

```bash
npm run start
```

or in development mode:

```bash
npm run api
```

### Health Endpoints

| Method | Endpoint      | Description                              |
| ------ | ------------- | ---------------------------------------- |
| GET    | `/_health`    | Basic API health check.                  |
| GET    | `/_db/health` | API-level PostgreSQL connectivity check. |

### Auth Endpoints

| Method | Endpoint                | Permission    | Description                                         |
| ------ | ----------------------- | ------------- | --------------------------------------------------- |
| POST   | `/api/auth/login`       | Public        | Authenticates a user and returns a session token.   |
| POST   | `/api/auth/logout`      | Authenticated | Revokes the current session.                        |
| GET    | `/api/auth/me`          | Authenticated | Returns the current user, session, and permissions. |
| GET    | `/api/auth/permissions` | Authenticated | Returns permissions granted to the current session. |

### Tool Endpoints

All tool endpoints require authentication and `CORE_VIEW_TOOLS` before tool-specific execution checks are applied.

| Method | Endpoint                   | Description                                                 |
| ------ | -------------------------- | ----------------------------------------------------------- |
| GET    | `/api/tools`               | Lists permission-filtered Admin-Web-visible tools.          |
| GET    | `/api/tools/:toolCode`     | Returns metadata for one permitted tool.                    |
| POST   | `/api/tools/:toolCode/run` | Runs a permitted tool through the script execution service. |

Tool execution also checks:

- tool-specific permission code
- risk-level execution permission
- confirmation requirement
- high-risk phrase confirmation, when applicable
- parameter schema and allowed values
- repository option validity
- path traversal safety
- active execution lock for the same tool/profile

### Admin Read and Action Endpoints

All admin endpoints require authentication and their matching permission. Destructive account, role, and permission operations are implemented as controlled updates or deactivation flows rather than hard deletes.

#### Operational Read Endpoints

| Method | Endpoint                       | Permission              | Description                               |
| ------ | ------------------------------ | ----------------------- | ----------------------------------------- |
| GET    | `/api/admin/audit-events`      | `AUDIT_READ`            | Lists audit events.                       |
| GET    | `/api/admin/login-events`      | `AUDIT_READ`            | Lists login events.                       |
| GET    | `/api/admin/script-executions` | `SCRIPT_EXECUTION_READ` | Lists script execution history.           |
| GET    | `/api/admin/active-sessions`   | `ADMIN_USER_READ`       | Lists active sessions.                    |
| GET    | `/api/admin/settings/auth`     | `ADMIN_USER_READ`       | Returns read-only auth/session settings.  |
| GET    | `/api/admin/settings/core`     | `ADMIN_ROLE_READ`       | Returns read-only core manifest settings. |

#### User Endpoints

| Method | Endpoint                                   | Permission         | Description                                      |
| ------ | ------------------------------------------ | ------------------ | ------------------------------------------------ |
| GET    | `/api/admin/users`                         | `ADMIN_USER_READ`  | Lists users without password hashes.             |
| GET    | `/api/admin/users/:userId`                 | `ADMIN_USER_READ`  | Returns one user with roles and permissions.     |
| POST   | `/api/admin/users`                         | `ADMIN_USER_WRITE` | Creates a user account.                          |
| PATCH  | `/api/admin/users/:userId`                 | `ADMIN_USER_WRITE` | Updates editable user fields.                    |
| PATCH  | `/api/admin/users/:userId/status`          | `ADMIN_USER_WRITE` | Updates account status and revokes when needed.  |
| POST   | `/api/admin/users/:userId/reset-password`  | `ADMIN_USER_WRITE` | Resets password and optionally revokes sessions. |
| GET    | `/api/admin/users/:userId/roles`           | `ADMIN_USER_READ`  | Lists roles assigned to a user.                  |
| PUT    | `/api/admin/users/:userId/roles`           | `ADMIN_ROLE_WRITE` | Replaces active role assignments for a user.     |
| GET    | `/api/admin/users/:userId/sessions`        | `ADMIN_USER_READ`  | Lists active sessions for a user.                |
| POST   | `/api/admin/users/:userId/revoke-sessions` | `ADMIN_USER_WRITE` | Revokes active sessions for a user.              |
| GET    | `/api/admin/user-roles`                    | `ADMIN_USER_READ`  | Lists active user-role assignments.              |

#### Role Endpoints

| Method | Endpoint                               | Permission               | Description                                  |
| ------ | -------------------------------------- | ------------------------ | -------------------------------------------- |
| GET    | `/api/admin/roles`                     | `ADMIN_ROLE_READ`        | Lists roles.                                 |
| GET    | `/api/admin/roles/:roleId`             | `ADMIN_ROLE_READ`        | Returns one role with users and permissions. |
| POST   | `/api/admin/roles`                     | `ADMIN_ROLE_WRITE`       | Creates a role.                              |
| PATCH  | `/api/admin/roles/:roleId`             | `ADMIN_ROLE_WRITE`       | Updates editable role fields.                |
| PATCH  | `/api/admin/roles/:roleId/status`      | `ADMIN_ROLE_WRITE`       | Activates or deactivates a role.             |
| GET    | `/api/admin/roles/:roleId/permissions` | `ADMIN_PERMISSION_READ`  | Lists permissions assigned to a role.        |
| PUT    | `/api/admin/roles/:roleId/permissions` | `ADMIN_PERMISSION_WRITE` | Replaces role permission assignments.        |
| GET    | `/api/admin/roles/:roleId/users`       | `ADMIN_ROLE_READ`        | Lists users assigned to a role.              |

#### Permission / Privilege Endpoints

| Method | Endpoint                                      | Permission               | Description                                |
| ------ | --------------------------------------------- | ------------------------ | ------------------------------------------ |
| GET    | `/api/admin/permissions`                      | `ADMIN_PERMISSION_READ`  | Lists permissions.                         |
| GET    | `/api/admin/permissions/:permissionId`        | `ADMIN_PERMISSION_READ`  | Returns one permission and assigned roles. |
| POST   | `/api/admin/permissions`                      | `ADMIN_PERMISSION_WRITE` | Creates a permission.                      |
| PATCH  | `/api/admin/permissions/:permissionId`        | `ADMIN_PERMISSION_WRITE` | Updates editable permission fields.        |
| PATCH  | `/api/admin/permissions/:permissionId/status` | `ADMIN_PERMISSION_WRITE` | Activates or deactivates a permission.     |
| GET    | `/api/admin/permissions/:permissionId/roles`  | `ADMIN_PERMISSION_READ`  | Lists roles using a permission.            |
| GET    | `/api/admin/role-permissions`                 | `ADMIN_PERMISSION_READ`  | Lists active role-permission assignments.  |

### Macro API Endpoints

All macro endpoints require authentication and `MACRO_VIEW_READ`.

| Method | Endpoint                                      | Description                                      |
| ------ | --------------------------------------------- | ------------------------------------------------ |
| GET    | `/api/macro/summary`                          | Returns macro view and indicator summary data.   |
| GET    | `/api/macro/views`                            | Lists curated macro views.                       |
| GET    | `/api/macro/views/:viewKey`                   | Lists rows for one curated macro view.           |
| GET    | `/api/macro/views/:viewKey/latest`            | Returns the latest row for one macro view.       |
| GET    | `/api/macro/views/:viewKey/columns`           | Returns column metadata for one macro view.      |
| GET    | `/api/macro/indicators`                       | Lists registered macro indicators.               |
| GET    | `/api/macro/indicators/:indicatorCode`        | Returns one registered indicator.                |
| GET    | `/api/macro/indicators/:indicatorCode/series` | Returns raw series rows for one indicator table. |

### Ingestion Status Endpoints

All ingestion status endpoints require authentication and `INGESTION_VIEW_STATUS`.

| Method | Endpoint                                          | Description                                       |
| ------ | ------------------------------------------------- | ------------------------------------------------- |
| GET    | `/api/ingestion/status`                           | Returns aggregate pipeline health.                |
| GET    | `/api/ingestion/sources`                          | Lists configured ingestion sources.               |
| GET    | `/api/ingestion/sources/:source`                  | Returns source health, indicators, and runs.      |
| GET    | `/api/ingestion/recent`                           | Lists recent ingestion-related executions.        |
| GET    | `/api/ingestion/indicators`                       | Lists indicator freshness/status diagnostics.     |
| GET    | `/api/ingestion/indicators/:indicatorCode/status` | Returns freshness/status detail for an indicator. |

### Worker / Automation API Endpoints

Worker endpoints require authentication and the matching worker permission.

#### Worker Health and Metadata

| Method | Endpoint             | Permission             | Description                                                         |
| ------ | -------------------- | ---------------------- | ------------------------------------------------------------------- |
| GET    | `/api/worker/health` | `WORKER_SCHEDULE_READ` | Returns worker nodes, schedules, runs, and listener health summary. |
| GET    | `/api/worker/tools`  | `WORKER_SCHEDULE_READ` | Lists worker-visible tools from the core manifest.                  |
| GET    | `/api/worker/nodes`  | `WORKER_SCHEDULE_READ` | Lists registered worker daemon nodes and heartbeat status.          |
| GET    | `/api/worker/runs`   | `WORKER_SCHEDULE_READ` | Lists worker schedule runs.                                         |

#### Scheduler Endpoints

| Method | Endpoint                                    | Permission              | Description                                                                 |
| ------ | ------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| GET    | `/api/worker/schedules`                     | `WORKER_SCHEDULE_READ`  | Lists active schedule definitions by default.                               |
| GET    | `/api/worker/schedules/:scheduleId`         | `WORKER_SCHEDULE_READ`  | Returns one schedule definition.                                            |
| POST   | `/api/worker/schedules`                     | `WORKER_SCHEDULE_WRITE` | Creates a schedule.                                                         |
| PATCH  | `/api/worker/schedules/:scheduleId`         | `WORKER_SCHEDULE_WRITE` | Updates a schedule.                                                         |
| PATCH  | `/api/worker/schedules/:scheduleId/status`  | `WORKER_SCHEDULE_WRITE` | Enables or disables a schedule.                                             |
| POST   | `/api/worker/schedules/:scheduleId/queue`   | `WORKER_SCHEDULE_RUN`   | Queues a schedule for immediate worker execution.                           |
| POST   | `/api/worker/schedules/:scheduleId/unqueue` | `WORKER_SCHEDULE_RUN`   | Cancels a pending queued schedule before it is claimed.                     |
| POST   | `/api/worker/schedules/:scheduleId/run-now` | `WORKER_SCHEDULE_RUN`   | Legacy alias for queueing a schedule immediately.                           |
| DELETE | `/api/worker/schedules/:scheduleId`         | `WORKER_SCHEDULE_WRITE` | Archives/removes a schedule from active views while preserving run history. |
| GET    | `/api/worker/schedules/:scheduleId/runs`    | `WORKER_SCHEDULE_READ`  | Lists runs for one schedule.                                                |

#### Listener Endpoints

| Method | Endpoint                                   | Permission              | Description                        |
| ------ | ------------------------------------------ | ----------------------- | ---------------------------------- |
| GET    | `/api/worker/listeners`                    | `WORKER_LISTENER_READ`  | Lists active listener definitions. |
| GET    | `/api/worker/listeners/:listenerId`        | `WORKER_LISTENER_READ`  | Returns one listener definition.   |
| POST   | `/api/worker/listeners`                    | `WORKER_LISTENER_WRITE` | Creates a listener definition.     |
| PATCH  | `/api/worker/listeners/:listenerId`        | `WORKER_LISTENER_WRITE` | Updates a listener definition.     |
| PATCH  | `/api/worker/listeners/:listenerId/status` | `WORKER_LISTENER_WRITE` | Enables or disables a listener.    |
| GET    | `/api/worker/listeners/:listenerId/events` | `WORKER_EVENT_READ`     | Lists events for one listener.     |
| GET    | `/api/worker/listener-events`              | `WORKER_EVENT_READ`     | Lists recent listener events.      |

---

## 🛡️ Browser-Triggered Script Execution Safety

Admin-Web tool execution is designed with guardrails because it allows scripts to be launched from a browser.

Current safety controls include:

- Bearer-token authentication
- RBAC permission checks
- Tool-specific permissions
- Risk-level execution permissions
- Medium/high-risk confirmation flows
- High-risk phrase confirmation
- Parameter count and payload-size limits
- Parameter name/value validation
- Null-byte rejection
- File-name safety checks
- Script path resolution inside a configured repository root
- Output byte limits and truncation notice
- Execution timeout handling
- STARTED/SUCCESS/FAILED execution lifecycle logging
- Startup and read-time stale STARTED cleanup
- Audit events for execution attempts and results
- Per-tool active execution lock to prevent duplicate concurrent runs

Execution records are stored in:

```text
auth.script_execution_log
```

Captured stdout/stderr logs are written under:

```text
logs/script-executions
```

---

## ⚙️ Worker Automation Layer

SkyServer includes a standalone worker runtime under:

```text
apps/worker
```

Run the worker daemon with:

```bash
npm run worker
```

or in development mode:

```bash
npm run worker:dev
```

The worker runtime is intentionally separate from the API process:

```text
API       = request/response control plane
Admin-Web = human control surface
Worker    = background execution plane
```

Current worker capabilities include:

- Worker node registration
- Heartbeat tracking
- Schedule polling
- Due-schedule claiming with database locking
- One-time schedule execution
- Recurring interval schedule execution
- Worker-visible tool execution through the existing `core` manifest
- Schedule run records in `worker.schedule_runs`
- Linked execution records in `auth.script_execution_log`
- Automatic disabling of completed one-time schedules
- Queue / Unqueue controls for immediate scheduled execution requests
- Active schedule views that exclude completed one-time schedules and archived schedules

Worker-visible tools are controlled through:

```text
core.tool_visibility
```

Only tools explicitly exposed to the `worker` channel are executable by the worker daemon. High-risk tools are not worker-visible by default.

Listener support is partially staged:

- Listener schema exists.
- Listener API endpoints exist.
- Admin-Web Active Listeners page exists.
- Runtime listener processors remain a future focused slice.

---

## 🗄️ PostgreSQL Database Layer

SkyServer uses PostgreSQL as its structured data backend.

The database layer currently supports:

- `macro` schema for macroeconomic indicators and reporting views
- `auth` schema for users, sessions, RBAC, audit, and script execution logs
- `core` schema for applications, tool manifests, repositories, runtimes, parameters, and visibility
- `worker` schema for worker nodes, schedules, schedule runs, listeners, and listener events

The `macro` schema includes:

- `macro.indicators`
  - Central registry of available indicators
  - Tracks indicator code, source, description, frequency, creation timestamp, and active status

- One physical table per indicator
  - Each indicator table matches its `indicator_code`
  - Standard structure:

```sql
edate DATE NOT NULL PRIMARY KEY,
value NUMERIC
```

- Macro analysis views
  - U.S. macro views
  - Canadian macro views
  - U.S./Canada comparison views

The `worker` schema includes:

```text
worker.worker_nodes
worker.schedules
worker.schedule_runs
worker.listeners
worker.listener_events
```

Worker views include:

```text
worker.vw_worker_nodes
worker.vw_schedules
worker.vw_schedule_runs_recent
worker.vw_listeners
worker.vw_listener_events_recent
```

The database build system is managed through:

```bash
npm run db:build
```

and the direct script:

```bash
node packages/db_build/src/db_build.js <databaseName>
```

The build tool scans SQL files from:

```text
packages/db_build/src/migrations
packages/db_build/src/seeds
```

SQL files are sorted and executed in filename order, preserving deterministic database rebuild behavior across folders.

---

## 📊 Data Ingestion Layer

SkyServer includes a reusable ingestion framework for loading public and manual data into PostgreSQL.

### Supported Data Sources

#### FRED

Loads U.S. macroeconomic indicators from the Federal Reserve Economic Data ecosystem.

Run directly:

```bash
node packages/ingestion/src/loadFREDMacroData.js
```

or from Admin-Web using **Run FRED Ingestion**.

#### Bank of Canada

Loads selected Canadian financial indicators from Bank of Canada data sources.

Run directly:

```bash
node packages/ingestion/src/loadBoCMacroData.js
```

or from Admin-Web using **Run Bank of Canada Ingestion**.

#### Statistics Canada

Loads selected Canadian macroeconomic indicators from Statistics Canada vector-based data.

Run directly:

```bash
node packages/ingestion/src/loadStatCanMacroData.js
```

or from Admin-Web using **Run Statistics Canada Ingestion**.

Supporting StatCan configuration files live under:

```text
packages/ingestion/src/config
```

including:

```text
statcanIndicators.js
statcanVectors.js
```

Discovery utilities are also available:

```text
packages/ingestion/src/discovery/discoverStatCanMetadata.js
packages/ingestion/src/discovery/resolveStatCanVectors.js
```

#### Manual Spreadsheet / CSV Ingestion

SkyServer also supports manual ingestion for user-provided spreadsheet or CSV files.

Manual ingestion uses:

```text
packages/ingestion/src/config/manualIngestion.json
```

Run directly:

```bash
node packages/ingestion/src/loadManualData.js
```

or from Admin-Web using **Run Manual Ingestion**.

---

## ⚙️ Ingestion Design

The ingestion framework is built around reusable components:

```text
packages/ingestion/src/core/runPipeline.js
packages/ingestion/src/loaders/copyLoader.js
packages/ingestion/src/loaders/manualCopyLoader.js
packages/ingestion/src/transform/csvNormalizer.js
packages/ingestion/src/sources
```

The pipeline pattern is:

```text
Get active indicators
Download source data
Normalize or transform data
Load into staging
Insert new or updated data into target table
Log results
Clean temporary files
```

The loaders are designed to be:

- Idempotent
- Runnable from any command prompt location
- Source-aware
- Efficient for incremental updates
- Safe for repeated execution

Typical ingestion output includes:

```text
staging_rows
staging_max
new_rows
inserted_rows
target_max
```

### Ingestion Observability

SkyServer includes a read-only ingestion status layer exposed through the API and Admin-Web.

The ingestion status layer combines:

- **Execution truth** from recent script execution history
- **Data truth** from `macro.indicators` and each physical indicator table
- Source-level rollups for FRED, Bank of Canada, and Statistics Canada
- Per-indicator freshness checks based on configured frequency
- Detection for stale data, missing tables, no-data states, and table read errors

This separates pipeline monitoring from tool execution: **Tools** runs ingestion scripts, while **Ingestion Status** monitors whether the resulting data is healthy.

---

## 🧰 Automation Tools

SkyServer includes automation scripts for repository, file, database, ingestion, worker, and operational workflows.

Automation is not a one-time phase of the project. It is a continuous layer of the system: as repeated workflows emerge, they can be promoted into scripts, registered in the relational manifest, exposed through SkyServer Core/Admin-Web, and eventually scheduled through the worker automation layer.

### Git Automation

Located under:

```text
packages/git/src
```

Available scripts:

```text
dev_commit.js
git_repo_status.js
main_merge.js
```

These tools resolve configured repositories through the relational `core.repositories` / `core.repository_paths` configuration model for API/Admin-Web execution.

They support:

- Dev branch commit workflow
- Repository map generation before dev commits
- Pre-commit and pre-push validation
- Repository status reporting
- Main branch merge/sync workflow
- Optional tagging during merge operations

### File / Structure Automation

Repository map generation is handled by:

```text
packages/files/src/generateRepoMap.js
```

This produces a readable file tree for project documentation and structural review. Runtime logs and their subfolders are omitted from generated repo maps to keep documentation clean.

### PowerShell Utilities

Additional PowerShell utilities live under:

```text
scripts/powershell
```

Current utilities include:

```text
Build-SkyOne-Bootloader.ps1
Clean-BackendCache.ps1
Clean-FrontendCache.ps1
```

---

## 🏗️ Repository Structure

```text
SkyServer/
├── apps/
│   ├── admin-web/        # Private React/Vite Admin-Web frontend
│   ├── api/              # Node/Express API layer
│   └── worker/           # Background jobs, listeners, schedulers
│
├── packages/
│   ├── auth/             # Admin user creation and password helpers
│   ├── core/             # SkyServer Core CLI Tool
│   ├── db/               # PostgreSQL connection and health tools
│   ├── db_build/         # Database migrations, seeds, and build runner
│   ├── files/            # File and repository structure utilities
│   ├── git/              # Git automation scripts
│   ├── ingestion/        # FRED, BoC, StatCan, and manual ingestion pipelines
│   └── shared/           # Shared constants, contracts, and validators
│
├── scripts/
│   ├── db/               # SQL schemas, tables, views, triggers, and functions
│   ├── node/             # Shared Node utilities
│   ├── powershell/       # PowerShell automation helpers
│   └── python/           # Reserved for Python utilities
│
├── docs/
│   └── SkyServer_RepoMap.md
│
├── logs/
│   └── script-executions/
│
├── .husky/               # Git hooks
├── eslint.config.mjs     # ESLint flat configuration
├── .prettierrc.json      # Prettier configuration
├── package.json
└── README.md
```

---

## 🧩 NPM Scripts

| Command                     | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `npm run start`             | Starts the API server.                           |
| `npm run api`               | Starts the API server with Nodemon.              |
| `npm run web`               | Starts the Admin-Web Vite development server.    |
| `npm run web:build`         | Builds the Admin-Web frontend.                   |
| `npm run web:preview`       | Previews the built Admin-Web frontend.           |
| `npm run worker`            | Starts the worker daemon.                        |
| `npm run worker:dev`        | Starts the worker daemon with Nodemon.           |
| `npm run daemon`            | Starts the API daemon entry point with Nodemon.  |
| `npm run lint`              | Runs ESLint checks.                              |
| `npm run lint:fix`          | Runs ESLint with auto-fix.                       |
| `npm run format`            | Applies Prettier formatting.                     |
| `npm run format:check`      | Verifies Prettier formatting.                    |
| `npm run clean`             | Runs lint fix and formatting.                    |
| `npm run prepush`           | Runs lint and formatting checks before push.     |
| `npm run db:health`         | Tests PostgreSQL connectivity.                   |
| `npm run db:build`          | Rebuilds the PostgreSQL database from SQL files. |
| `npm run auth:create-admin` | Runs the first-admin/user creation script.       |
| `npm run core`              | Starts the SkyServer Core CLI Tool.              |

---

## 🛡️ Code Quality Automation

SkyServer uses:

- ESLint
- Prettier
- Husky
- lint-staged

### Pre-Commit

The pre-commit hook formats and fixes staged files before commit.

### Pre-Push

The pre-push hook runs validation checks before allowing changes to be pushed.

This keeps the repository clean, formatted, and consistent across refactors.

---

## 🔐 Environment Configuration

SkyServer expects a root `.env` file containing PostgreSQL connection settings.

Example required variables:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=skyserver_dev
PGUSER=postgres
PGPASSWORD=your_password
```

Useful optional variables include:

```env
API_PORT=7171
AUTH_SESSION_MINUTES=30
AUTH_SESSION_HOURS=12
AUTH_MAX_FAILED_LOGIN_ATTEMPTS=5
AUTH_LOCK_MINUTES=15
AUTH_LOGIN_RATE_LIMIT_WINDOW_MS=60000
AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS=8
AUTH_LOGIN_RATE_LIMIT_BLOCK_MS=300000
SKYSERVER_CORE_APP_CODE=SKYSERVER_CORE
SKYSERVER_CONFIG_PROFILE=DEV_LOCAL
TOOL_EXECUTION_TIMEOUT_MS=180000
TOOL_EXECUTION_MAX_OUTPUT_BYTES=250000
TOOL_EXECUTION_STALE_AFTER_MINUTES=15
TOOL_HIGH_RISK_CONFIRMATION_PHRASE=RUN HIGH RISK
SERVE_ADMIN_WEB=false
WORKER_SCHEDULER_ENABLED=true
WORKER_LISTENER_ENABLED=false
WORKER_NODE_NAME=
WORKER_HEARTBEAT_SECONDS=30
WORKER_POLL_INTERVAL_SECONDS=15
WORKER_TOOL_TIMEOUT_MS=180000
WORKER_TOOL_MAX_OUTPUT_BYTES=250000
WORKER_ALLOW_HIGH_RISK_TOOLS=false
```

Database, ingestion, API, worker, and tool execution scripts load `.env` from the SkyServer root so tools can be executed from different command prompt locations.

---

## 📈 Macro Views

SkyServer includes SQL views for reporting and dashboard development.

### U.S. Macro Views

Examples:

```text
macro.vw_inflation
macro.vw_rates_curve
macro.vw_growth
macro.vw_labor
macro.vw_credit_conditions
macro.vw_housing
macro.vw_liquidity
macro.vw_macro_regime
```

### Canadian Macro Views

Examples:

```text
macro.vw_ca_inflation
macro.vw_ca_growth
macro.vw_ca_labor
macro.vw_ca_housing
macro.vw_ca_trade
macro.vw_ca_rates_fx
macro.vw_ca_macro_regime
```

### U.S. / Canada Comparison Views

Examples:

```text
macro.vw_us_ca_policy_fx
macro.vw_us_ca_inflation_compare
macro.vw_us_ca_labor_compare
```

These views support future dashboarding, public visualizations, analytical reporting, and SkyWeb integration.

Macro view browsing endpoints are implemented under `/api/macro` and support Admin-Web monitoring, future SkyWeb dashboards, analytical reporting, and BI/reporting preparation.

---

## 🌐 Application Direction

SkyServer is the private operational backend and admin control layer for the Sky Ecosystem.

Its long-term role is to support:

- Private admin workflows
- PostgreSQL-backed analytics
- Data ingestion and synchronization
- Script orchestration
- Scheduled background automation
- Event-driven listener automation
- Backend APIs
- Worker jobs
- File and repository automation
- Future SkyWeb public-facing data views

SkyServer is not just a backend service. It is the private control layer that keeps the system structured, testable, observable, and extensible.

---

## 🧬 Design Philosophy

> “Automation should feel like intelligence — quiet, precise, and always one step ahead.”

SkyServer is built around a few practical rules:

- Keep tools runnable from anywhere.
- Keep scripts config-driven where possible.
- Keep database builds deterministic.
- Keep ingestion idempotent.
- Keep console output useful but compact.
- Keep browser-triggered script execution permission-aware and audited.
- Keep scheduled automation explicit, observable, and reversible.
- Keep architecture modular before it becomes painful to change.

---

## 🗺️ Roadmap

| Phase          | Objective                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Phase 1     | Install Node.js, initialize the application, and establish npm tooling                                                                                |
| ✅ Phase 2     | ESLint, Prettier, Husky, and lint-staged automation                                                                                                   |
| ✅ Phase 3     | PostgreSQL schema, indicator registry, migrations, seeds, views                                                                                       |
| ✅ Phase 4     | FRED, BoC, StatCan, and manual ingestion pipelines                                                                                                    |
| ✅ Phase 5     | SkyServer Core CLI Tool with configurable script launcher model                                                                                       |
| 🔄 Continuous  | Expand automation scripts for Git, files, database, ingestion, workers, and operational workflows                                                     |
| ✅ Phase 6     | Private Admin-Web interface with auth, RBAC, relational tool manifest, execution logging, audit trail, dynamic parameters, and safety confirmation UX |
| ✅ Phase 7     | API endpoints for macro views, ingestion status, and admin actions, plus Admin-Web Access Control, Ingestion Status, and Dashboard v2                 |
| ✅ Phase 8     | Worker automation foundation with scheduler-driven tool execution, worker daemon, worker API, Automation Admin-Web pages, and listener foundation     |
| 🔜 Phase 9     | SkyWeb integration for public-facing macro dashboards                                                                                                 |
| 🔜 Phase 10    | Data mart design and analytics-ready PostgreSQL view/model refinement for public, admin, and BI consumers                                             |
| 🔜 Phase 11    | ETL/ELT pipelines from PostgreSQL into Snowflake for durable cloud data warehousing                                                                   |
| 🔜 Phase 12    | Snowflake warehouse models, dimensional tables, historical snapshots, and curated reporting layers                                                    |
| 🔜 Phase 13    | BI/report automation layer for scheduled exports, dashboard-ready datasets, and optional Power BI/Tableau/Superset integration                        |
| 🎯 Final Phase | Operationalize the full data path: source ingestion → PostgreSQL → SkyWeb/API → Snowflake → BI/reporting outputs                                      |

---

## 🧭 Repository

- **GitHub:** https://github.com/PStar1980/SkyServer
- **Primary development branch:** `dev`
- **Main branch:** `main`
- **License:** ISC

## Phase 9.3 — SkyWeb Auth Preparation

SkyServer now exposes the authenticated `/api/skyweb/profile` surface for SKYWEB app sessions and seeds initial SkyWeb roles, permissions, app memberships, profiles, and preference tables.

## Phase 9.4 — SkyWeb Preferences API

SkyServer now exposes authenticated SkyWeb dashboard-preference endpoints for `SKYWEB` app sessions:

- `GET /api/skyweb/preferences`
- `PATCH /api/skyweb/preferences`

The preference API stores dashboard defaults in `skyweb.user_preferences` under the `dashboard_defaults` key and currently supports default macro region, default macro category, chart window, dashboard density, and preferred landing page. Dedicated `SKYWEB_PREFERENCES_READ` and `SKYWEB_PREFERENCES_WRITE` permissions are seeded for future builds, while the route also accepts the existing profile permissions for backward-compatible local testing.
