# SkyServer

SkyServer is the private **Node.js / Express / PostgreSQL control plane** for the Sky ecosystem. It owns operational administration, ingestion, repository tooling, worker scheduling, script execution, alert evaluation, and future workflow orchestration.

SkyWeb Analytics is the public/member-facing analytics product. SkyServer stays behind the curtain as the trusted operational engine.

## Stack at a Glance

| Layer                 | Technology                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| API                   | Node.js, Express                                                                                             |
| Admin client          | React, Vite, React Router, Bootstrap, Axios, Apache ECharts, D3                                              |
| Database              | PostgreSQL                                                                                                   |
| Data access           | `pg`, SQL migrations/seeds, relational metadata                                                             |
| Auth                  | App-scoped login, hashed bearer sessions, RBAC permissions, audit events                                     |
| Worker/control plane  | Node worker daemon, scheduler/listener schema, tool execution logs                                           |
| Durable orchestration | Temporal worker, workflow executor, task queue diagnostics, worker heartbeats                                |
| Tool result contract  | Universal child-process adapter, wrapper-owned structured result transport, versioned `ToolResult` envelopes |
| Data ingestion        | FRED, Bank of Canada, Statistics Canada, manual CSV/spreadsheet pipelines                                    |
| Repo automation       | Dev commit workflow, repo map generation, lean repo zip generation                                           |
| Product consumer      | SkyWeb Analytics via public/member macro and alert APIs                                                      |

## What This Project Demonstrates

- **Operational control-plane architecture** for private admin workflows, tools, ingestion, scheduling, audit, automation, and readiness checks.
- **PostgreSQL-first system design** with separate `auth`, `core`, `macro`, `skyweb`, and `worker` schemas.
- **Permission-aware browser-triggered script execution** with risk levels, confirmation phrases, execution logs, output limits, and audit trails.
- **Reusable data-ingestion pipelines** for public macroeconomic sources with staging, normalization, incremental loading, and status inspection.
- **Worker-backed automation foundation** for scheduled tools, worker-visible tool catalogue entries, schedule runs, node heartbeats, listener staging, and worker health checks.
- **Temporal-backed durable workflow orchestration** with tool/API/workflow/template nodes, condition branches, waits, human approvals, retries, version guardrails, run controls, and diagnostics.
- **Clean system boundary with SkyWeb**, where SkyServer owns ingestion/evaluation/control-plane work while SkyWeb owns analytics presentation and member workflows.
- **Repository automation discipline** through generated repo maps, generated lean handoff zips, and dev-commit tooling.
- **SkyCommand visual operations layer** with reusable Apache ECharts/D3 chart cards, full-screen chart overlays, and dashboard/workflow/worker/ingestion/tool/readiness analytics.
- **Workflow-native tool result architecture** that keeps stdout/stderr in Tool History while exposing validated, versioned, domain-specific results to workflows through one generic adapter.

## Current Status

**Active status:** Phase 14 is in progress. The workflow-native `ToolResult` channel is complete for FRED, Bank of Canada, Statistics Canada, Repository Map, Repository Zip, Dev Commit, and Main/Development Branch Synchronization. Human stdout/stderr remains in Tool History, while workflows receive clean domain results, stable context paths, purpose-built output tables, and normalized Summary-node aggregation. The manifest/hash/snapshot enforcement experiment has been removed after proving too tightly coupled to essential file and recovery tools. Structured result validation is now best-effort and fail-open after successful domain work: a missing or malformed result can reduce a run to the `legacy_tool_execution.v1` fallback, but it cannot prevent a successfully created map, ZIP, commit, ingestion, or other registered tool operation from being acknowledged as successful. Phase 13 remains the live telemetry, runtime context, parameterized workflow, condition, summary, and visual execution foundation that Phase 14 strengthens.

SkyServer has completed the SkyWeb public-facing macro integration track and now serves as the private operational control plane behind **SkyCommand**, the branded Admin-Web experience for ingestion, automation, repository tooling, workflow orchestration, diagnostics, approvals, scheduling, run control, readiness inspection, and operational intelligence.

Phase 10 moved Temporal from a local FRED pilot into a full SkyServer workflow execution lane. SkyServer workflows can now compose tools, API calls, child workflows, Temporal-native templates, condition gates, waits, human approvals, retry policies, versioned drafts, visual graph editing, runtime overlays, diagnostics, worker health, and production-readiness checks while preserving the existing worker/tool infrastructure.

Phase 11 modernized Admin-Web into the **SkyCommand** product shell with a black navigation frame, left-side grouped navigation, branded prism mark, unified page surfaces, navbar search/popovers, and a more polished login experience.

Phase 12 added the **visual operations layer**: dashboard intelligence, Workflow History analytics, Worker Health pulse charts, Ingestion Status analytics, Tools History analytics, Production Readiness visualizations, reusable chart helper components, and full-screen chart overlays.

Phase 13 adds the **live workflow intelligence layer**. Smart polling and live telemetry contracts keep Workflow History, selected run details, node status overlays, runtime summaries, Tool History, Data Pipeline, Readiness, and dashboard analytics surfaces fresh without full page reloads. Polling now preserves the last good UI state during transient refresh failures and escalates only after repeated polling errors. Structured node output persistence stores resolved inputs and returned outputs in dedicated run-output rows, the workflow context store merges run inputs and completed node outputs into durable context values, explicit workflow-level runtime parameter schemas let reusable workflows collect launch values before execution without confusing node-level tool defaults, condition gates can now branch from params/context/node-output paths while persisting their decisions back into run context, and the runtime graph now supports active-node following plus animated edge flow while live telemetry updates. Summary nodes can now generate reusable human-readable run summaries from params, workflow context, prior node outputs, warnings, errors, and timings, with the result persisted into the workflow run summary and visible in Workflow History. The workflow workbench now continues that separation by replacing command-heavy dashboard blocks with Dashboard Controls, moving Create Workflow toward a visual graph editor, and keeping Start Workflow focused on launching and watching live runtime overlays in place.

Phase 14 adds the **workflow-native tool contract**. The generic process adapter creates a unique, wrapper-owned result-file transport for every API or worker tool launch and injects the standard `SKYCOMMAND_TOOL_RESULT_*` environment contract. Tools continue printing their existing operational logs while optionally emitting versioned `ToolResult` objects through the separate structured channel. Workflow tool nodes never promote stdout/stderr into business output: migrated tools expose their deliberate domain payload under `nodes.<nodeKey>.output`, the complete envelope remains available under `nodes.<nodeKey>.result`, and tools without a usable structured result receive a clear `legacy_tool_execution.v1` fallback that points operators back to Tool History for logs.

The runtime contract is intentionally **fail-open after successful domain execution**. Tool identity, path, parameters, runtime, permissions, and visibility remain controlled by the existing PostgreSQL tool catalogue. Structured output validation and transport are supplementary reporting concerns: if they fail, SkyCommand records a warning and preserves the tool's real process outcome rather than blocking access to generated files or rerunning side-effecting work. FRED, Bank of Canada, and Statistics Canada emit `macro_ingestion_summary.v1`; Repository Map emits `repository_map_summary.v1`; Repository Zip emits `repository_package_summary.v1`; Dev Commit emits `git_commit_summary.v1`; and Main Merge emits `git_branch_sync_summary.v1`. Their output-specific Workflow History renderers, approval-decision display, canonical condition paths, and development-promotion Summary rollup remain available without becoming execution gates.

SkyServer Core now reads each published workflow's runtime-parameter schema and prompts for those values directly before launch. A node default such as `{{ params.commitMessage }}` resolves identically for Admin-Web, inline CLI execution, and Temporal-backed CLI execution. Temporal launches can be followed to completion from the CLI through the PostgreSQL workflow ledger, so Git-oriented workflows remain operable even when Vite or the browser refreshes during repository changes.

### SkyServer Core workflow runtime parameters

Published workflow runtime parameters are shared across Admin-Web and the `npm run core` launcher. SkyServer Core lists the schema count, prompts for each typed value, validates required/default/select/number/boolean/JSON rules, and submits the values under both `input.params` and `input.runtimeParameters`. Node defaults reference them with the same syntax used by Admin-Web:

```text
{{ params.commitMessage }}
```

The CLI still accepts an optional additional workflow-input JSON object for advanced overrides. Temporal-backed runs can be followed without Admin-Web by leaving the follow prompt at its default `Y`; progress is read from `worker.workflow_run_records` and `worker.workflow_node_run_records`.

Optional environment controls are documented in `.env.example`:

```text
SKYSERVER_CORE_WORKFLOW_EXECUTOR_MODE=temporal
SKYSERVER_CORE_WORKFLOW_FOLLOW=true
SKYSERVER_CORE_WORKFLOW_POLL_MS=2000
SKYSERVER_CORE_WORKFLOW_FOLLOW_TIMEOUT_MS=1800000
```

### Development promotion workflow

The recommended repository delivery workflow is:

```text
Repository Map
→ Repository ZIP
→ Dev Commit
→ Human Merge Approval
→ Main → Dev Synchronization
→ Summary
```

The approval checkpoint confirms that the Dev → Main pull request has been completed. The `main_merge` tool then synchronizes development from main and emits `git_branch_sync_summary.v1`, including branch-head movement, commits applied, synchronized state, optional tag evidence, and Git-step outcomes. Workflow History provides dedicated Main Merge and approval tables, while the Summary node automatically produces a Development Promotion stage rollup. Suggested workflow name: **SkyCommand Development Promotion**.

### Structured result consumption and summary aggregation

Phase 14.5 centralizes the deterministic result-to-workflow view in `packages/tools/src/workflowResultContext.js`. Both inline execution and the Temporal workflow bundle now use the same rules:

```text
nodes.<nodeKey>.result      complete ToolResult envelope
nodes.<nodeKey>.output      domain-specific payload
nodes.<nodeKey>.warnings    non-fatal warnings
nodes.<nodeKey>.error       structured error
nodes.<nodeKey>.metadata    safe result metadata
previousResult              previous complete result
previousOutput              previous domain payload
```

Condition nodes can branch on paths such as `nodes.fred_ingestion.output.totals.rowsInserted`. A configured path that does not exist now fails with `WORKFLOW_CONDITION_PATH_NOT_FOUND` unless a fallback literal is supplied, preventing silent branches caused by misspelled paths.

Summary nodes no longer create source-labelled JSON previews. They build a compact node-result index and, when macro ingestion results are present, a normalized rollup containing one row for every source plus combined requested/updated/unchanged/failed/row totals. Repository delivery workflows also receive a Development Promotion rollup covering generated map/package artifacts, Dev Commit evidence, human merge approval, and Main → Dev synchronization. Workflow History renders both models as purpose-built tables.

Scheduled direct-tool runs store only a compact contract summary in `worker.schedule_runs.metadata`: schema/output type, success/message/warning count, and macro source totals where applicable. Full output remains in the tool execution result and workflow ledger rather than being duplicated into scheduler metadata.

### Structured-result failure isolation

A successful tool operation is never converted into a failure solely because its optional structured result is missing, invalid, or cannot be emitted. The wrapper records the result warning, retains stdout/stderr in Tool History, and allows workflows to use the legacy fallback when necessary. Repository Map and Repository Zip therefore remain available as recovery tools even when other Phase 14 reporting code is damaged.

### Development watcher safety

Structured-result files are ephemeral runtime artifacts, not source files. They use the `.tool-result` extension and are written beneath `logs/tool-results`; the shared `nodemon.json` ignores runtime log and temporary-data paths so API, worker, and Temporal development processes do not restart when a tool emits its result. The wrapper reads and deletes each result after validation, so the result directory is normally empty between executions.



## Core Product Surfaces

| Surface              | Purpose                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SkyCommand Dashboard | Private operational intelligence dashboard for API/DB health, ingestion, automation, workflows, task queue health, readiness, tools, sessions, scripts, audits, and chart-based visual summaries |
| Tools                | Permission-filtered operational tool launcher with dynamic parameters and Tools History logging                                                                                                  |
| Workflows            | Versioned workflow builder, visual graph editor, start/history, approvals, run controls, Temporal diagnostics, and worker health                                                                 |
| Automation           | Scheduler/listener control surfaces, including bridges to Temporal templates and SkyServer workflows                                                                                             |
| Ingestion Status     | Source health, indicator freshness, stale-data detection, run history, per-indicator diagnostics, and macro pipeline analytics                                                                   |
| Access Control       | User, role, permission, session, password administration, and User History audit review                                                                                                          |
| Tools History        | Browser-triggered and worker-triggered tool execution history with stdout/stderr traceability plus usage, speed, category, and outcome analytics                                                 |
| SkyWeb APIs          | Public/member macro, profile, preference, dashboard, alert, and alert-evaluation support for SkyWeb Analytics                                                                                    |

## Architecture

```mermaid
flowchart LR
    Admin[Admin Browser] --> AdminWeb["SkyServer Admin-Web<br/>React + Vite"]
    AdminWeb --> Api["SkyServer API<br/>Node.js + Express"]
    Core[SkyServer Core CLI] --> Tools["Tool Catalogue<br/>core schema"]
    Core -->|workflow starts| Api
    Api --> Tools
    Api --> Db[("PostgreSQL<br/>auth + core + macro + skyweb + worker")]
    Worker["Worker Daemon<br/>schedules + listeners"] --> Db
    Worker --> Tools
    Ingestion["Ingestion Scripts<br/>FRED + BoC + StatCan + Manual"] --> Db
    SkyWeb["SkyWeb Analytics<br/>React + ASP.NET Core"] -->|evaluate alerts only| Api
    Api -->|workflow start/control/diagnostics| Temporal["Temporal Server<br/>durable orchestration"]
    Temporal --> TemporalWorker["SkyServer Temporal Worker<br/>task queue skyserver-local"]
    TemporalWorker -->|activities| Tools
    TemporalWorker -->|workflow ledger| Db
    TemporalWorker --> Ingestion
```

Current control flow:

```text
Admin-Web / Core CLI
  → SkyServer API / tool launcher / workflow launcher
      → PostgreSQL auth + core + worker catalogue
      → ingestion, repo, DB, git, and operational scripts
          ↳ stdout/stderr → Tool History and diagnostics
          ↳ validated ToolResult → workflow node result and context
      → worker schedules and listener definitions
      → Temporal-backed SkyServer workflow definitions and run ledgers
      → audit + script execution history

SkyWeb Analytics
  → SkyWeb.Api for analytics/member reads and writes
  → SkyServer API only for evaluate-now alert execution and future control-plane workflows
```

## Relationship to SkyWeb Analytics

SkyServer and SkyWeb now have a clean boundary:

| SkyServer owns                                      | SkyWeb owns                                     |
| --------------------------------------------------- | ----------------------------------------------- |
| Ingestion pipelines                                 | Public/member analytics UI                      |
| Worker scheduling                                   | Dashboards and saved views                      |
| Alert evaluation execution                          | Alert rules and Signal Center presentation      |
| Admin-Web and RBAC administration                   | Account/profile/preferences UX                  |
| Script/tool execution and admin visual intelligence | Public/member ECharts/D3 analytics presentation |
| Repo map/zip/dev-commit utilities                   | Portfolio-ready product presentation            |
| Temporal orchestration and workflow diagnostics     | Public/member API consumption                   |

SkyServer should not duplicate SkyWeb product surfaces. SkyWeb should not duplicate SkyServer administrative control surfaces.

## SkyCommand UI and Visualization Direction

Phase 11 established **SkyCommand** as the branded Admin-Web shell. The design keeps the dark operational console identity while moving navigation into a permission-aware left sidebar with grouped sections for command, tools, workflows, automation, data, configuration, and access control. The top bar carries page context, command search, notification/message shells, and the authenticated operator icon.

The UI modernization changed the app shell, sidebar, topbar, spacing, dashboard command center, workflow workbench behavior, login experience, brand mark, and shared UI primitives without changing workflow execution or database semantics. Reusable SkyCommand components now cover status pills, stat cards, panels, page headers, sidebar navigation, and the inline SVG brand mark.

Phase 12 added the reusable visualization layer. Apache ECharts and D3 now power chart sections across the Dashboard, Workflow History, Worker Health, Ingestion Status, Tools History, and Production Readiness pages. Chart cards share a consistent anatomy, status color language, empty-state handling, and full-screen overlay behavior so visual analytics can expand without page-by-page chart sprawl.

Phase 13 adds the live intelligence spine. Workflow and dashboard surfaces use smart polling against standardized telemetry contracts, while workflow node completions now persist structured node outputs into `worker.workflow_run_node_outputs`. The workflow context store now updates `worker.workflow_run_context_values` with initial workflow inputs, runtime parameters, per-node status/output summaries, `last.*` values, and selected custom context updates. Workflow definitions can now store an explicit runtime parameter schema, Start Workflow renders that schema as a launch form only when workflow-level params exist, and node input parameters can resolve template references such as `{{ params.commitMessage }}`, `{{ context.last.output }}`, and `{{ nodes.some_node.output }}` before execution. Workflow History now keeps the runtime map full-width and opens detailed run metadata in an overlay. Manage Workflows keeps workflow-level runtime params in the definition section while node-level defaults stay on selected graph nodes, backed by the versioned workflow node ledger.

Phase 14 separates operational narration from workflow business results. Tool History remains the authoritative location for stdout/stderr, while Workflow History and condition nodes consume deliberate `ToolResult` payloads through stable result and output paths. The initial foundation is runtime-agnostic and shared by API and worker execution, preserving child-process isolation while preparing FRED, BoC, StatCan, repository tools, and future registered scripts to use the same contract.

## Workflow Pages

The Workflows menu is the high-level SkyServer workflow cockpit:

```text
Workflows -> Create Workflow
Workflows -> Manage Workflows
Workflows -> Start Workflow
Workflows -> Workflow History
Workflows -> Approvals
Workflows -> Worker Health
```

The workflow surfaces can:

- create, manage, clone, draft, validate, publish, and retire versioned workflow definitions backed by `worker.workflow_definitions`;
- compose `TOOL`, `API_CALL`, `WORKFLOW`, `TEMPORAL_WORKFLOW`, `CONDITION`, `WAIT`, and `HUMAN_APPROVAL` nodes;
- configure tool parameters, Temporal-template parameters, retry policy, node timeout, condition branches, wait timers, and approval role gates;
- render workflow graphs visually with node inspection, drag reorder, branch labels, and runtime status overlays;
- start active published workflows manually from Admin-Web, SkyServer Core CLI, Admin tool bridge, or schedules;
- define runtime parameter schemas for reusable workflows and capture submitted launch values as durable `params` context;
- resolve node input templates from runtime params, workflow context, previous outputs, and named node outputs;
- store workflow-level and node-level run records in PostgreSQL while Temporal owns durable execution state;
- approve/reject human approval gates through Admin-Web signals back to Temporal;
- cancel, terminate, and retry workflow runs;
- inspect Temporal workflow IDs, run IDs, event summaries, diagnostic links, task queue status, and worker heartbeat health;
- auto-refresh Workflow History and selected run telemetry through smart polling, slowing down when no active workflows exist or the browser tab is hidden.

Lower-level Temporal runtime diagnostics remain available at `/workflows/temporal/start` and `/workflows/temporal/history` for direct Temporal-template visibility. Admin-Web calls SkyServer API; it never connects to Temporal directly. Legacy `/automation/temporal` and `/temporal` links redirect to the workflow cockpit.

## Local Development

Install dependencies from the repository root:

```bash
npm install
```

Run common development surfaces:

```bash
# SkyServer API
npm run api
```

```bash
# SkyServer Admin-Web
npm run web
```

```bash
# SkyServer worker daemon
npm run worker:dev
```

```bash
# SkyServer Core CLI
# Top menu: Run Tools / Run Workflows
npm run core
```

Useful validation/build commands:

```bash
npm run lint
npm run format:check
npm run prepush
npm run db:health
npm run db:build
```

## Environment

Create a root `.env` file with PostgreSQL connection settings:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=skyserver_dev
PGUSER=postgres
PGPASSWORD=your_password
```

Common optional variables:

```env
API_PORT=7171
AUTH_SESSION_MINUTES=30
AUTH_SESSION_HOURS=12
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

# Temporal local development
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=skyserver-local
TEMPORAL_UI_BASE_URL=http://localhost:8233
TEMPORAL_FRED_WORKFLOW_ID_PREFIX=skyserver-fred-ingestion
TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS=1800000
SKYSERVER_INTERNAL_API_TOKEN=replace_with_a_local_secret
```

Database, ingestion, API, worker, and tool execution scripts load `.env` from the SkyServer root so tools can be executed from different command prompt locations.

## Primary Local URLs

| Surface                 | URL                                |
| ----------------------- | ---------------------------------- |
| SkyServer API health    | `http://localhost:7171/_health`    |
| SkyServer DB health     | `http://localhost:7171/_db/health` |
| Temporal Web UI         | `http://localhost:8233`            |
| SkyServer Admin-Web     | `http://localhost:5173`            |
| SkyWeb Analytics client | `http://localhost:5175`            |
| SkyWeb.Api Swagger      | `http://localhost:7280/swagger`    |

## NPM Scripts

| Command                       | Description                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run start`               | Starts the API server.                                                                             |
| `npm run api`                 | Starts the API server with Nodemon.                                                                |
| `npm run web`                 | Starts the Admin-Web Vite development server.                                                      |
| `npm run web:build`           | Builds the Admin-Web frontend.                                                                     |
| `npm run web:preview`         | Previews the built Admin-Web frontend.                                                             |
| `npm run worker`              | Starts the worker daemon.                                                                          |
| `npm run worker:dev`          | Starts the worker daemon with Nodemon.                                                             |
| `npm run temporal:worker`     | Starts the SkyServer Temporal worker.                                                              |
| `npm run temporal:worker:dev` | Starts the SkyServer Temporal worker with Nodemon.                                                 |
| `npm run temporal:health`     | Checks connectivity to the configured Temporal service.                                            |
| `npm run temporal:fred`       | Starts the FRED ingestion workflow pilot and waits for the result.                                 |
| `npm run daemon`              | Starts the API daemon entry point with Nodemon.                                                    |
| `npm run core`                | Starts the SkyServer Core CLI with top-level Run Tools / Run Workflows menus.                      |
| `npm run db:health`           | Tests PostgreSQL connectivity.                                                                     |
| `npm run db:build`            | Rebuilds the configured PostgreSQL database from SQL files.                                        |
| `npm run auth:create-admin`   | Runs the first-admin/user creation script.                                                         |
| `npm run lint`                | Runs ESLint checks.                                                                                |
| `npm run format:check`        | Verifies Prettier formatting.                                                                      |
| `npm run prepush`             | Lightweight reminder; run `npm run validate` intentionally before phase handoff/release snapshots. |

## Repository Layout

```text
SkyServer/
├── apps/
│   ├── admin-web/        # Private React/Vite SkyCommand frontend
│   ├── api/              # Node/Express API layer
│   └── worker/           # Background worker daemon, schedulers, listeners
├── packages/
│   ├── auth/             # Admin user creation and password helpers
│   ├── core/             # SkyServer Core CLI tool
│   ├── db/               # PostgreSQL connection and health utilities
│   ├── db_build/         # Ordered migrations, seeds, and build runner
│   ├── files/            # Repo map and repo zip utilities
│   ├── git/              # Dev commit, status, and merge scripts
│   ├── ingestion/        # FRED, BoC, StatCan, and manual ingestion pipelines
│   ├── skyweb/           # SkyWeb alert evaluation support scripts
│   └── temporal/         # Temporal worker, workflows, activities, and pilot clients
├── scripts/
│   ├── db/               # SQL schemas, tables, views, triggers, and functions
│   ├── node/             # Shared Node utilities
│   └── powershell/       # PowerShell automation helpers
├── docs/
│   ├── SkyServer_RepoMap.md
│   ├── SkyServer_Temporal_Local_Setup.md
│   └── SkyServer_Temporal_Workflow_Architecture_Plan.md
├── logs/                 # Runtime logs, excluded from generated handoff zips/maps
├── change.log            # Detailed phase history moved out of README
└── package.json
```

Generated handoff zips exclude dependency/build/runtime clutter such as `node_modules/`, `dist/`, `build/`, `bin/`, `obj/`, logs, temp folders, screenshots/images, `*.zip`, and `*.patch` files by default so project exchange stays lean. The Admin-Web favicon is explicitly preserved even though other image assets are excluded by default.

## API Families

| Family                            | Purpose                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/_health`, `/_db/health`         | API and database health checks                                                                             |
| `/api/auth/*`                     | Login, logout, current session, and permissions                                                            |
| `/api/tools/*`                    | Permission-filtered tool catalog and tool execution                                                        |
| `/api/admin/*`                    | Users, roles, permissions, sessions, settings, script executions, and audit events                         |
| `/api/macro/*`                    | Private macro summary, view, indicator, and series endpoints                                               |
| `/api/public/macro/*`             | Public macro endpoints consumed by SkyWeb during the transition path                                       |
| `/api/ingestion/*`                | Ingestion health, source status, recent runs, and indicator diagnostics                                    |
| `/api/worker/*`                   | Worker health, tools, nodes, schedules, runs, listeners, and listener events                               |
| `/api/workflows/*`                | Workflow definitions, drafts, starts, runs, approvals, run controls, worker health, and version guardrails |
| `/api/temporal/*`                 | Lower-level Temporal health, template starts, workflow listings, and diagnostics                           |
| `/api/admin/production-readiness` | Production readiness checks for environment, Temporal, DB, workflow, auth, and operations                  |
| `/api/skyweb/*`                   | SkyWeb member/profile/preference/dashboard/alert support and alert evaluation                              |

## Data and Automation Layers

### PostgreSQL schemas

| Schema   | Purpose                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`   | Users, roles, permissions, sessions, login events, audit events, script execution logs                                                      |
| `core`   | Applications, repositories, tool manifest, visibility channels, runtimes, parameters, risk levels                                           |
| `macro`  | Indicator registry, physical indicator tables, macro analysis views                                                                         |
| `skyweb` | SkyWeb profiles, preferences, saved views, dashboards, alert rules, events, notifications                                                   |
| `worker` | Worker nodes, schedules, schedule runs, listeners, workflow definitions/versions/runs, approvals, Temporal templates, and worker heartbeats |

### Ingestion sources

| Source                 | Loader                                           |
| ---------------------- | ------------------------------------------------ |
| FRED                   | `packages/ingestion/src/loadFREDMacroData.js`    |
| Bank of Canada         | `packages/ingestion/src/loadBoCMacroData.js`     |
| Statistics Canada      | `packages/ingestion/src/loadStatCanMacroData.js` |
| Manual CSV/spreadsheet | `packages/ingestion/src/loadManualData.js`       |

The ingestion pattern is intentionally idempotent: discover configured indicators, download source data, normalize rows, load staging, merge new data into target tables, log outcomes, and clean temporary files.

### Worker automation

The worker runtime under `apps/worker` is separate from the API process. It handles worker node registration, heartbeats, schedule polling, due-schedule claiming, recurring/one-time execution, queue/unqueue controls, schedule-run records, and worker-visible tool execution through the relational `core` manifest.

Listener support is staged: schema, API endpoints, and Admin-Web surfaces exist; runtime listener processors remain a future focused slice.

### Temporal workflow orchestration

Temporal is now the durable workflow execution lane for SkyServer business workflows. The existing worker daemon and scheduler/listener system remain active; Temporal is used when a process needs durable state, retries, timers, human approval signals, child workflow execution, history, or multi-step orchestration.

Local Temporal commands:

```bash
# Start local Temporal separately
temporal server start-dev

# Run the SkyServer Temporal worker
npm run temporal:worker:dev

# Check Temporal connectivity
npm run temporal:health

# Optional direct FRED workflow pilot runner
npm run temporal:fred
npm run temporal:fred -- --indicators=GDP,UNRATE,DGS10 --concurrency=2
```

Primary protected workflow API families include:

```text
/api/workflows/*              SkyServer workflow definitions, drafts, starts, runs, approvals, run controls, and worker health
/api/temporal/*               Lower-level Temporal diagnostics and template starts
/api/admin/production-readiness  Production-readiness checklist for environment, worker, DB, workflow, and auth safety
```

The browser/Admin-Web should call SkyServer API rather than Temporal directly, preserving the SkyServer auth/RBAC boundary and keeping audit, versioning, workflow-run persistence, and diagnostics in one control-plane layer.

## SkyCommand Chart System

The Admin-Web visualization layer is built around reusable chart primitives under `apps/admin-web/src/components/charts`:

| Component/helper                          | Purpose                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `EChartCard`                              | Shared chart card shell with title, subtitle, expand action, empty state, and chart canvas |
| `ChartFullscreenOverlay`                  | Reusable full-screen chart inspection overlay with close/Escape/backdrop behavior          |
| `TrendAreaChart`                          | Standard line/area trend chart for activity, run pressure, and status movement             |
| `DurationTrendChart`                      | Duration-specific trend chart for runtime pressure and execution timing                    |
| `StatusDonut`                             | Donut chart helper for health/outcome/status mix visualizations                            |
| `OutcomeBarChart`                         | Horizontal/vertical bar chart helper for outcome counts and ranked categories              |
| `chartTheme`, `chartOptions`, `chartData` | Centralized status colors, tooltip/legend/axis styling, and grouping helpers               |

Current visual pages include:

- Dashboard automation intelligence
- Workflow History run analytics
- Worker Health execution pulse
- Ingestion Status macro pipeline analytics
- Tools History execution analytics
- Production Readiness hardening analytics

Chart rules: keep status colors semantic, use cards for scanability, preserve full-screen overlay behavior, and keep low/empty-data states explicit.

## Browser-Triggered Script Safety

SkyServer allows browser-triggered tool execution through Admin-Web, so guardrails are central:

- Bearer-token authentication and RBAC permission checks
- Tool-specific permissions and risk-level execution permissions
- Medium/high-risk confirmation flows and phrase confirmation
- Parameter validation, repository option validation, and path traversal safety
- Output byte limits, execution timeout handling, and active execution locks
- `STARTED` / `SUCCESS` / `FAILED` execution lifecycle logging
- Stale `STARTED` cleanup and audit events for attempts/results

Execution records are stored in `auth.script_execution_log`; captured stdout/stderr logs are written under `logs/script-executions/`.

## Documentation

`README.md` is now a current-state overview. Detailed implementation history lives in `change.log`; generated structure lives in the repo map. Older phase-specific Temporal notes were removed after Phase 10 completion to avoid repeating the same implementation story in several places. The current visualization expansion plan is represented in the roadmap below and implemented through the reusable chart system.

| Asset                                                                                                            | Purpose                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`change.log`](change.log)                                                                                       | Canonical phase history, implementation notes, and documentation cleanup record         |
| [`docs/SkyServer_RepoMap.md`](docs/SkyServer_RepoMap.md)                                                         | Generated repository structure map                                                      |
| [`docs/SkyServer_Temporal_Local_Setup.md`](docs/SkyServer_Temporal_Local_Setup.md)                               | Current local Temporal setup, commands, and troubleshooting                             |
| [`docs/SkyServer_Temporal_Workflow_Architecture_Plan.md`](docs/SkyServer_Temporal_Workflow_Architecture_Plan.md) | Historical architecture decision record for the Temporal migration                      |
| [`docs/SkyCommand_Phase_14_Structured_Tool_Results.md`](docs/SkyCommand_Phase_14_Structured_Tool_Results.md)     | Current Phase 14 contract, transport, context-path, migration, and validation reference |

Removed after Temporal implementation because their contents are now represented by `README.md`, `change.log`, the current UI, and the surviving architecture/setup references:

```text
docs/SkyServer_Temporal_Admin_Web_Console.md
docs/SkyServer_Temporal_Core_API.md
docs/SkyServer_Temporal_FRED_Pilot.md
docs/SkyServer_Temporal_Phase_10_Roadmap.md
docs/SkyServer_Temporal_Workflow_Templates.md
docs/SkyServer_Workflow_Builder_Foundation.md
```

## Roadmap

| Phase      | Status         | Objective                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1    | ✅ Complete    | Install Node.js, initialize the application, and establish npm tooling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Phase 2    | ✅ Complete    | ESLint, Prettier, Husky, and lint-staged automation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Phase 3    | ✅ Complete    | PostgreSQL schema, indicator registry, migrations, seeds, and views                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Phase 4    | ✅ Complete    | FRED, BoC, StatCan, and manual ingestion pipelines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 5    | ✅ Complete    | SkyServer Core CLI tool with configurable script launcher model and direct active-workflow start menu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Phase 6    | ✅ Complete    | Private Admin-Web with auth, RBAC, relational tool manifest, execution logging, audit trail, dynamic parameters, and safety UX                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Phase 7    | ✅ Complete    | Macro, ingestion status, admin-action APIs, Access Control, Ingestion Status, and Dashboard v2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Phase 8    | ✅ Complete    | Worker automation foundation with scheduler-driven tool execution, worker daemon, worker APIs, Automation Admin-Web pages, and listener foundation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 9    | ✅ Complete    | SkyWeb integration for public-facing macro dashboards, member preferences, saved views, dashboards, alert rules, Signal Center, and alert evaluation support                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Phase 10   | ✅ Complete    | Temporal-backed SkyServer workflow orchestration with visual editing, version guardrails, approvals, branching, waits, retries, run controls, diagnostics, worker health, and production-readiness inspection                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Phase 11   | ✅ Complete    | SkyCommand Admin-Web modernization: branded shell, black navigation frame, sidebar/page typography, dashboard wording, navbar search/popovers, login atmosphere, brand mark, and shared UI primitives                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Phase 12   | ✅ Complete    | SkyCommand visual operations layer: ECharts/D3 dashboard intelligence, Workflow History charts, Worker Health pulse, Ingestion analytics, Tools History analytics, Production Readiness visuals, full-screen chart overlays, and reusable chart helpers                                                                                                                                                                                                                                                                                                                                                                           |
| Phase 13   | ✅ Complete    | Live workflow telemetry, runtime context, parameterized execution, durable node outputs/context, context-aware conditions, active-node animation, summary nodes, and runtime/workbench surface separation                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Phase 14   | 🔄 In Progress | Structured Tool Results and workflow output contracts: one generic process adapter, separate log/result channels, versioned extensible `ToolResult` envelopes, canonical inline/Temporal workflow paths, normalized FRED/BoC/StatCan summaries, repository map/package/commit/branch-sync results, approval evidence, development-promotion rollups, fail-open structured-result isolation, condition-path enforcement, scheduled-result evidence, and purpose-built tool/summary rendering |
| Phase 15   | 🔜 Planned     | Tool catalogue administration using the existing PostgreSQL registry: guided script selection, parameter configuration, safe test execution, permissions, and audit history without repository hash gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Phase 16   | 🔜 Planned     | Ingestion resilience and workflow hardening: retry/backoff review, resumable runs, richer source diagnostics, source failure recovery, and production deployment planning                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Phase 17   | 🔜 Planned     | Data mart, cloud warehouse, and analytics-ready PostgreSQL/BI model refinement for public, admin, and reporting consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Phase 18   | 🔜 Planned     | Testing and demo hardening: Playwright coverage, workflow/chart regression checks, portfolio demo scripts, and release-quality documentation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Continuous | 🔄 Ongoing     | Expand reusable operational tools, workflow templates, diagnostics, tests, documentation, and chart/page polish                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Design Philosophy

> “Automation should feel like intelligence — quiet, precise, and always one step ahead.”

Practical rules:

- Keep tools runnable from anywhere.
- Keep scripts config-driven where possible.
- Keep database builds deterministic.
- Keep ingestion idempotent.
- Keep browser-triggered script execution permission-aware and audited.
- Keep human logs and machine workflow results on separate channels.
- Keep workflow tool integration generic; domain flexibility belongs inside the validated output payload.
- Keep scheduled automation explicit, observable, and reversible.
- Keep the control-plane/product boundary clear between SkyServer and SkyWeb.
- Keep architecture modular before it becomes painful to change.

## Repository

- **GitHub:** https://github.com/PStar1980/SkyServer
- **Primary development branch:** `dev`
- **Main branch:** `main`
- **License:** ISC
