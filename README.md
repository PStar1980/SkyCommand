# 🌌 SkyServer

**Private Admin, Automation, PostgreSQL, API, and Data Ingestion Hub for the Sky Ecosystem**

SkyServer is the private administrative and automation core of the **Sky Ecosystem**. It combines a Node/Express API layer, PostgreSQL-backed configuration and audit tables, a private React Admin-Web interface, macroeconomic data ingestion pipelines, repository automation, file utilities, and a configurable CLI launcher into one operational control plane.

SkyServer is designed to be precise, repeatable, idempotent, permission-aware, and easy to extend. It supports local development workflows, database rebuilds, macro data ingestion from multiple public data providers, manual spreadsheet ingestion, Git automation, script orchestration, and browser-triggered administration through **SkyServer Admin-Web**.

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

The operational tool model is now backed by relational configuration in the PostgreSQL `core` schema for API/Admin-Web execution. This creates a stronger bridge between tool metadata, permissions, risk levels, parameter definitions, and UI visibility.

---

## 🖥️ Admin-Web Control Surface

SkyServer now includes a private React/Vite Admin-Web application under:

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

- **Dashboard**
  - Shows visible tool counts
  - Shows script execution count
  - Shows audit event count
  - Shows permission count for the current session
  - Displays the latest script execution

- **Tools**
  - Lists permission-filtered tools from the API
  - Renders tool parameters dynamically
  - Supports repository dropdown parameters
  - Runs low-, medium-, and high-risk tools
  - Shows confirmation panels before sensitive execution
  - Requires phrase confirmation for high-risk tools
  - Displays running state, elapsed time, status, exit code, duration, summary, stdout, and stderr

- **Script Executions**
  - Shows execution history from the database
  - Supports status/limit filtering
  - Displays execution metadata and log availability

- **Audit Events**
  - Shows authentication, authorization, and tool execution audit activity
  - Supports result/limit filtering
  - Displays event metadata for traceability

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

Create the first admin user with:

```bash
npm run auth:create-admin
```

---

## 🧩 Relational Tool Manifest

SkyServer now stores operational configuration in the `core` schema.

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
- Which tools are visible in Admin-Web
- Which tools are executable through the API
- Which permission is required per tool
- Which risk level applies per tool
- Whether confirmation is required
- Whether parameters are allowed
- How parameter inputs are rendered
- Which repository paths are available for repo-driven tools

This is the main plug-in layer for future tools: add the script, register it in the core configuration, assign permissions/risk/visibility/parameters, and Admin-Web can expose it without hardcoding a new page for every script.

---

## 🧰 Admin-Web Tool Catalog

Current Admin-Web-visible tool families include:

### Database Tools

| Tool                  | Risk | Purpose                                                                  |
| --------------------- | ---- | ------------------------------------------------------------------------ |
| Database Health Check | Low  | Tests PostgreSQL connectivity using the configured environment.          |
| Database Build        | High | Rebuilds the PostgreSQL database from ordered migrations and seed files. |

### Git Tools

| Tool              | Risk   | Purpose                                                              |
| ----------------- | ------ | -------------------------------------------------------------------- |
| Repository Status | Low    | Checks configured repository status across dev and main branches.    |
| Dev Commit        | Medium | Stages, commits, and pushes the selected repository’s dev branch.    |
| Main Merge        | High   | Synchronizes main/dev branches and may push branch updates and tags. |

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

### Admin Read Endpoints

All admin endpoints require authentication and their matching read permission.

| Method | Endpoint                       | Permission              | Description                               |
| ------ | ------------------------------ | ----------------------- | ----------------------------------------- |
| GET    | `/api/admin/audit-events`      | `AUDIT_READ`            | Lists audit events.                       |
| GET    | `/api/admin/login-events`      | `AUDIT_READ`            | Lists login events.                       |
| GET    | `/api/admin/script-executions` | `SCRIPT_EXECUTION_READ` | Lists script execution history.           |
| GET    | `/api/admin/active-sessions`   | `ADMIN_USER_READ`       | Lists active sessions.                    |
| GET    | `/api/admin/users`             | `ADMIN_USER_READ`       | Lists users without password hashes.      |
| GET    | `/api/admin/user-roles`        | `ADMIN_USER_READ`       | Lists active user-role assignments.       |
| GET    | `/api/admin/roles`             | `ADMIN_ROLE_READ`       | Lists roles.                              |
| GET    | `/api/admin/permissions`       | `ADMIN_PERMISSION_READ` | Lists permissions.                        |
| GET    | `/api/admin/role-permissions`  | `ADMIN_PERMISSION_READ` | Lists active role-permission assignments. |

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

## 🗄️ PostgreSQL Database Layer

SkyServer uses PostgreSQL as its structured data backend.

The database layer currently supports:

- `macro` schema for macroeconomic indicators and reporting views
- `auth` schema for users, sessions, RBAC, audit, and script execution logs
- `core` schema for applications, tool manifests, repositories, runtimes, parameters, and visibility

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

The database build system is managed through:

```bash
npm run db:build
```

and the direct script:

```bash
node packages/db_build/src/db_build.js
```

The build tool scans SQL files from:

```text
packages/db_build/migrations
packages/db_build/seeds
```

SQL files are sorted and executed in filename order, preserving deterministic database rebuild behavior across folders.

---

## 📊 Data Ingestion Layer

SkyServer includes a reusable ingestion framework for loading public and manual data into PostgreSQL.

### Supported Data Sources

#### FRED

Loads U.S. macroeconomic indicators from the Federal Reserve Economic Data ecosystem.

Example indicators include:

- Inflation
- Labor market
- Interest rates
- Treasury curve
- Credit conditions
- Housing
- Liquidity
- Growth
- Energy

Run directly:

```bash
node packages/ingestion/src/loadFREDMacroData.js
```

or from Admin-Web using **Run FRED Ingestion**.

---

#### Bank of Canada

Loads selected Canadian financial indicators from Bank of Canada data sources.

Current active indicators include:

- USD/CAD exchange rate
- Bank of Canada overnight policy rate

Run directly:

```bash
node packages/ingestion/src/loadBoCMacroData.js
```

or from Admin-Web using **Run Bank of Canada Ingestion**.

---

#### Statistics Canada

Loads selected Canadian macroeconomic indicators from Statistics Canada vector-based data.

Current covered areas include:

- CPI / inflation
- GDP
- Housing
- Population
- Labor market
- Imports
- Retail sales
- Building permits
- Trade by industry

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

---

#### Manual Spreadsheet / CSV Ingestion

SkyServer also supports manual ingestion for user-provided spreadsheet or CSV files.

Manual ingestion uses:

```text
packages/ingestion/src/config/manualIngestion.json
```

The config maps spreadsheet columns to database columns and allows controlled loading into a target table without requiring direct database write access.

Run directly:

```bash
node packages/ingestion/src/loadManualData.js
```

or from Admin-Web using **Run Manual Ingestion**.

This is useful for team environments where a user can prepare a file and config while the ingestion process handles database loading safely and consistently.

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

This keeps the console output compact while still showing whether new data was loaded.

---

## 🧰 Automation Tools

SkyServer includes automation scripts for repository, file, database, ingestion, and operational workflows.

Automation is not a one-time phase of the project. It is a continuous layer of the system: as repeated workflows emerge, they can be promoted into scripts and then exposed through SkyServer Core and Admin-Web.

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

These tools now resolve configured repositories through the relational `core.repositories` / `core.repository_paths` configuration model for API/Admin-Web execution.

They support:

- Dev branch commit workflow
- Pre-commit and pre-push validation
- Repository status reporting
- Main branch merge/sync workflow
- Optional tagging during merge operations

---

### File / Structure Automation

Repository map generation is handled by:

```text
packages/files/src/generateRepoMap.js
```

This produces a readable file tree for project documentation and structural review.

---

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
```

Database, ingestion, API, and tool execution scripts load `.env` from the SkyServer root so tools can be executed from different command prompt locations.

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

These views are intended to support future dashboarding, public visualizations, analytical reporting, and SkyWeb integration.

Macro view browsing endpoints are planned for Phase 7.

---

## 🌐 Application Direction

SkyServer is the private operational backend and admin control layer for the Sky Ecosystem.

Its long-term role is to support:

- Private admin workflows
- PostgreSQL-backed analytics
- Data ingestion and synchronization
- Script orchestration
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
| 🔜 Phase 7     | API endpoints for macro views, ingestion status, and admin actions                                                                                    |
| 🔜 Phase 8     | Worker/listener workflows for scheduled and event-driven jobs                                                                                         |
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
