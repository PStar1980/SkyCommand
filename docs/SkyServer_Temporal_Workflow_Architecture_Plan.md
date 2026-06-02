# SkyServer Workflow Architecture Upgrade Plan

## Temporal-Based Workflow Orchestration Roadmap

**Project:** SkyServer / SkyWeb  
**Decision:** Temporal will become the long-term workflow orchestration engine for SkyServer.  
**Initial hosting model:** Self-hosted/local Temporal, not Temporal Cloud.  
**Status:** Architecture decision finalized.

---

## 1. Executive Summary

SkyServer is currently a Node.js-based administrative and automation platform with an API layer, worker infrastructure, user/session management, tool execution, ingestion monitoring, scheduling/listener capabilities, and operational dashboards.

SkyWeb is the analytics and visualization layer that reads from PostgreSQL and presents macro, reporting, dashboard, and business-process views.

The next major architectural evolution is to upgrade SkyServer from a **tool launcher / scheduler-listener system** into a true **workflow automation control plane**.

The chosen long-term workflow engine is **Temporal**.

Temporal will be introduced as the durable workflow orchestration layer for SkyServer. Existing SkyServer tools will gradually be wrapped as Temporal Activities, while higher-level business processes will be represented as Temporal Workflows.

This will allow SkyServer to orchestrate:

- Node.js tasks
- Python scripts
- ETL processes
- API calls
- Playwright test automation
- AI-agent workflows
- SQL tasks
- future Airflow DAGs

Temporal is suitable because it is open-source and self-hostable, with an optional paid managed Temporal Cloud offering. Temporal also provides a TypeScript SDK, making it a strong fit for the existing Node.js/SkyServer architecture.

---

## 2. Final Architecture Decision

### Decision

SkyServer will adopt **Temporal** as its primary workflow orchestration engine.

### Hosting model

Initial implementation will use:

```text
Self-hosted/local Temporal development server
```

Not:

```text
Temporal Cloud
```

Temporal Cloud may be considered later only if SkyServer becomes production-hosted and the operational tradeoff justifies the cost.

### Strategic reason

The project is moving toward:

- durable workflows
- AI-agent orchestration
- multi-step automation
- script/tool execution
- Python task integration
- Playwright regression automation
- ETL/data pipeline orchestration
- long-running workflow state
- retry/failure handling
- operational visibility
- professional platform architecture

Temporal is better aligned to this long-term target than building a custom workflow engine from scratch or using a simpler job queue as the central architecture.

---

## 3. Important Clarification: Temporal Does Not Replace SkyServer

Temporal does **not** make SkyServer obsolete.

Temporal becomes the **workflow execution engine**.

SkyServer remains the **control panel, command hub, administration layer, visibility layer, and automation console**.

SkyServer will still be responsible for:

- user/session management
- admin screens
- configuration
- tool registry
- workflow catalog
- workflow launch controls
- workflow run visibility
- status dashboards
- ingestion monitoring
- artifact display
- database/reporting observability
- API layer
- security and access control
- operator/admin experience

Temporal will handle:

- durable workflow state
- activity execution dispatch
- retry policies
- long-running orchestration
- workflow history
- task queues
- timers
- workflow resumption after failures

The relationship should be understood like this:

```text
SkyServer = control plane / cockpit / observability hub
Temporal = workflow engine / durable execution layer
PostgreSQL = truth layer / data + audit store
SkyWeb = visualization + analytics layer
```

SkyServer can still execute single tools directly where appropriate.

Temporal is primarily needed when a process becomes a **workflow**:

```text
Tool A → Tool B → Tool C → validation → report → notification
```

Single tool execution remains valid. Temporal adds durable orchestration when multiple operations need to be chained, monitored, retried, paused, or resumed.

---

## 4. Current System Context

### Current SkyServer components

SkyServer currently includes:

- Node.js / Express API server
- PostgreSQL database
- admin/configuration pages
- user/session management
- tool execution infrastructure
- scheduler/listener worker
- ingestion monitoring
- operational dashboard capabilities
- script execution patterns
- automation-related database structures

### Current SkyWeb components

SkyWeb currently includes:

- Vite / React front-end
- analytics dashboards
- macroeconomic visualizations
- saved views
- custom dashboards
- card modes
- dashboard configuration
- reporting-oriented UI

### Current database role

PostgreSQL currently acts as the shared persistence layer for:

- application configuration
- user/session state
- macro/ingestion data
- automation metadata
- reporting views
- analytics data consumed by SkyWeb

---

## 5. Target Architecture

The long-term target architecture should look like this:

```text
SkyWeb Analytics
React / Vite
Dashboards, charts, analytics, saved views
        │
        ▼
PostgreSQL
raw / staging / core / mart / audit / app / automation schemas
        ▲
        │
SkyServer API
Node.js / Express
Control plane, auth, admin UI APIs, workflow launch/status
        │
        ▼
Temporal Service
Durable workflow orchestration, task queues, workflow history
        │
        ▼
Temporal Workers
Node activities, Python activities, AI-agent activities,
Playwright activities, SQL activities, HTTP/API activities
        │
        ▼
External systems / scripts / APIs / files / models / Airflow later
```

---

## 6. Component Responsibilities

### 6.1 SkyServer API / Admin

SkyServer becomes the **control plane**.

Responsibilities:

- start workflows
- cancel workflows
- query workflow state
- manage workflow definitions/metadata
- expose workflow controls to the UI
- display workflow run status
- manage tool/task registry
- manage user/admin/security concerns
- store app-level workflow summaries in PostgreSQL
- integrate with Temporal Client API

### 6.2 Temporal Service

Temporal becomes the **workflow execution brain**.

Responsibilities:

- preserve workflow state
- dispatch workflow/activity tasks
- handle retries and timeouts
- support long-running workflows
- preserve workflow event history
- coordinate workers through task queues
- enable durable workflow execution

### 6.3 Temporal Workers

Workers execute the actual project code.

Initial worker types:

- Node.js worker for existing SkyServer activities
- future Python worker for ETL/data tasks
- future Playwright worker for test automation
- future AI-agent activity worker
- future Airflow integration activity

### 6.4 PostgreSQL

PostgreSQL remains the **shared truth layer**.

Responsibilities:

- application state
- workflow run summaries
- task run summaries
- artifacts
- audit logs
- business data
- raw/staging/core/mart data
- SkyWeb reporting views
- ingestion/data quality metadata

Temporal should ideally use its own internal persistence database/schema, separate from SkyServer’s application data.

Recommended local structure:

```text
PostgreSQL instance
  ├── skyserver_db
  │     ├── app
  │     ├── automation
  │     ├── raw
  │     ├── staging
  │     ├── core
  │     ├── mart
  │     └── audit
  │
  └── temporal_db
        └── Temporal internal persistence
```

---

## 7. Temporal vs Airflow vs BullMQ Decision Notes

### 7.1 Temporal

Temporal is selected as the primary SkyServer workflow engine because it supports durable, long-running, multi-step workflows and has a TypeScript SDK.

Use Temporal for:

- general SkyServer workflows
- agentic AI workflows
- Playwright automation workflows
- multi-step tool orchestration
- Python task orchestration
- API workflows
- SQL maintenance workflows
- long-running or resumable processes
- approval/wait/retry patterns

### 7.2 Airflow

Airflow remains a future option for dedicated data-engineering pipelines.

Use Airflow later for:

- heavy Python ETL
- scheduled data pipelines
- backfills
- multi-source ingestion
- data validation DAGs
- reporting refresh DAGs
- data engineering portfolio expansion

Airflow should not be the main SkyServer workflow engine. It is best reserved for professional data-engineering DAGs.

### 7.3 BullMQ

BullMQ was considered because it is a strong Node.js/Redis job queue and is useful for background jobs.

BullMQ is not selected as the main architecture because the project’s long-term goal is not merely background job processing. The goal is durable workflow orchestration.

BullMQ may still be used in the future for specific queue-heavy local execution needs, but it is not the primary workflow engine.

---

## 8. Conceptual Model

SkyServer should adopt this vocabulary:

```text
Tool
  A callable capability or executable unit.
  Example: generate repo map, run SQL script, call Python ETL, run Playwright.

Activity
  Temporal execution wrapper around a tool or operation.
  Example: runGenerateRepoMapActivity.

Workflow
  A durable, ordered process made of activities and control logic.
  Example: NightlyQualityWorkflow.

Workflow Run
  One execution instance of a workflow.
  Example: NightlyQualityWorkflow run on 2026-06-01.

Artifact
  Output generated by a task/activity/workflow.
  Example: log file, JSON report, test result, AI summary, generated zip.

Task Queue
  Temporal routing channel workers poll from.
  Example: skyserver-node, skyserver-python, skyserver-playwright.
```

Recommended mapping:

```text
Existing SkyServer Tool
        ↓
Temporal Activity
        ↓
Temporal Workflow Step
        ↓
Workflow Run
        ↓
PostgreSQL run summary + artifacts
        ↓
SkyServer Admin UI visibility
```

---

## 9. Workflow Adapter Types

SkyServer should introduce a flexible adapter model so different execution types can be orchestrated consistently.

Initial adapter types:

```text
node_script
sql_script
http_request
python_script
playwright_test
ai_agent
temporal_workflow
airflow_dag
shell_command
manual_approval
notification
```

### 9.1 Node script task

```json
{
  "adapter_type": "node_script",
  "script": "scripts/generateRepoMap.js",
  "args": ["--repo", "SkyServer"]
}
```

### 9.2 Python ETL task

```json
{
  "adapter_type": "python_script",
  "script": "skyetl/pipelines/boc/run.py",
  "args": ["--mode", "daily"]
}
```

### 9.3 HTTP/API task

```json
{
  "adapter_type": "http_request",
  "method": "POST",
  "url": "http://localhost:3000/api/admin/refresh-cache"
}
```

### 9.4 AI-agent task

```json
{
  "adapter_type": "ai_agent",
  "agent_key": "repo_review_agent",
  "input_artifact": "repo_map.json"
}
```

### 9.5 Playwright task

```json
{
  "adapter_type": "playwright_test",
  "test_suite": "skyweb-dashboard-regression"
}
```

### 9.6 Future Airflow DAG task

```json
{
  "adapter_type": "airflow_dag",
  "dag_id": "daily_macro_pipeline",
  "conf": {
    "source": "boc",
    "mode": "daily"
  }
}
```

---

## 10. Database Architecture for Workflow Metadata

SkyServer should store application-level workflow metadata in PostgreSQL.

Temporal stores its own execution history internally, but SkyServer should maintain a business-friendly summary layer for UI/reporting.

Recommended tables:

```text
automation.workflow_definitions
- workflow_id
- workflow_key
- name
- description
- version
- enabled
- created_at
- updated_at

automation.workflow_tasks
- workflow_task_id
- workflow_id
- task_key
- display_name
- adapter_type
- sequence_no
- depends_on_json
- input_schema_json
- input_mapping_json
- retry_policy_json
- timeout_seconds
- condition_json
- enabled

automation.workflow_runs
- workflow_run_id
- workflow_id
- temporal_workflow_id
- temporal_run_id
- status
- trigger_type
- triggered_by
- started_at
- finished_at
- input_json
- output_json
- error_message

automation.task_runs
- task_run_id
- workflow_run_id
- workflow_task_id
- temporal_activity_id
- status
- started_at
- finished_at
- input_json
- output_json
- error_message
- log_path

automation.artifacts
- artifact_id
- workflow_run_id
- task_run_id
- artifact_type
- artifact_uri
- artifact_json
- created_at

automation.tool_registry
- tool_id
- tool_key
- tool_name
- adapter_type
- handler_name
- description
- input_schema_json
- output_schema_json
- enabled
```

### Important design rule

Temporal owns durable workflow execution.

SkyServer owns:

- definitions
- user-facing metadata
- UI-friendly status
- artifacts
- audit/reporting history
- workflow catalog

---

## 11. ETL/Data Architecture

ETL should be layered professionally.

Recommended schemas:

```text
raw
  original source data, minimally transformed

staging
  cleaned, standardized, validated intermediate data

core
  trusted canonical business data

mart
  dashboard/reporting-ready tables and views

audit
  pipeline runs, row counts, validation errors, source timestamps

app
  users, sessions, settings, dashboard preferences

automation
  workflow definitions, task definitions, run summaries, artifacts
```

### Example ETL flow

```text
External API / file / source
        ↓
raw.source_payloads
        ↓
staging.cleaned_records
        ↓
core.business_entities
        ↓
mart.dashboard_views
        ↓
SkyWeb Analytics
```

### Role of Temporal in ETL

Temporal can orchestrate ETL directly at first:

```text
MacroIngestionWorkflow
  → extract source data
  → write raw records
  → validate records
  → transform staging records
  → load core tables
  → refresh mart views
  → record audit summary
```

### Role of Airflow later

Airflow can be added later if ETL becomes large enough to justify a dedicated data pipeline orchestration layer.

Potential future pattern:

```text
SkyServer starts workflow
  → Temporal activity triggers Airflow DAG
  → Airflow runs Python ETL tasks
  → ETL writes PostgreSQL raw/staging/core/mart tables
  → Temporal records completion/status
  → SkyWeb displays updated analytics
```

---

## 12. Implementation Roadmap

### Phase 0 — Finish current SkyWeb stabilization

Before pivoting to Temporal:

- complete SkyWeb bug fixes
- stabilize dashboard/card behavior
- ensure current SkyWeb analytics pages are committed
- refresh repo maps/zips
- document current baseline

Deliverable:

```text
Stable SkyWeb/SkyServer baseline before Temporal integration.
```

---

### Phase 1 — Temporal local setup

Goal:

```text
Add Temporal locally without disrupting the current SkyServer worker/tool system.
```

Tasks:

1. Install Temporal CLI/dev server.
2. Start local Temporal server.
3. Confirm Temporal Web UI is accessible.
4. Add Temporal TypeScript SDK to SkyServer.
5. Create folder structure:

```text
src/temporal/
  client/
  workers/
  workflows/
  activities/
  shared/
```

6. Add basic health check / connection test.

Deliverable:

```text
Temporal runs locally and SkyServer can connect to it.
```

---

### Phase 2 — First workflow: RunToolWorkflow

Goal:

```text
Wrap one existing SkyServer tool as a Temporal Activity.
```

Initial workflow:

```text
RunToolWorkflow
  → validate tool request
  → execute existing tool/script
  → capture output
  → write workflow summary to PostgreSQL
  → return result
```

Initial candidate tools:

- generate repo map
- generate repo zip
- run existing SQL script
- run a safe diagnostic tool

Deliverable:

```text
SkyServer can start a Temporal workflow that executes one existing tool.
```

---

### Phase 3 — SkyServer UI integration

Goal:

```text
Allow workflow execution from the existing SkyServer Admin UI.
```

Tasks:

1. Add API endpoint:

```text
POST /api/workflows/:workflowKey/run
```

2. Add workflow status endpoint:

```text
GET /api/workflows/runs/:runId
```

3. Add workflow list endpoint:

```text
GET /api/workflows
```

4. Create UI page:

```text
Automation > Workflows
```

5. Show:

- workflow name
- last run
- status
- started/finished time
- trigger source
- output summary
- error message if failed

Deliverable:

```text
Admin UI can launch and inspect basic Temporal-backed workflow runs.
```

---

### Phase 4 — Tool registry migration

Goal:

```text
Convert current tools into a formal registry of reusable workflow capabilities.
```

Tasks:

1. Create or revise `automation.tool_registry`.
2. Assign each existing tool:
   - tool key
   - adapter type
   - input schema
   - output schema
   - handler name
   - enabled flag
3. Expose tool registry in SkyServer Admin.
4. Preserve backward compatibility with existing tool execution during migration.

Deliverable:

```text
Existing SkyServer tools are cataloged as workflow-capable execution units.
```

---

### Phase 5 — Workflow definition model

Goal:

```text
Add workflow definitions composed of ordered tasks.
```

Tasks:

1. Create workflow definition tables.
2. Add UI for viewing workflow definitions.
3. Start with sequential workflows only.
4. Define first multi-step workflow.

Example:

```text
RepoQualityWorkflow
  → generate repo map
  → generate repo zip
  → run static checks
  → write summary artifact
```

Deliverable:

```text
SkyServer supports multi-task workflow definitions backed by Temporal.
```

---

### Phase 6 — Playwright automation integration

Goal:

```text
Integrate test automation as a first-class workflow activity.
```

Tasks:

1. Add Playwright test runner activity.
2. Capture:
   - pass/fail status
   - test report path
   - screenshots/videos if applicable
   - error summary
3. Store artifacts in `automation.artifacts`.
4. Add workflow:

```text
SkyWebRegressionWorkflow
  → run Playwright suite
  → collect report
  → write result summary
```

Deliverable:

```text
SkyServer can execute Playwright test automation through Temporal workflows.
```

---

### Phase 7 — AI-agent workflow integration

Goal:

```text
Add AI-agent activities to analyze outputs, summarize errors, suggest fixes, or generate reports.
```

Initial use cases:

```text
AI summarize Playwright failures
AI review repo map
AI generate implementation checklist
AI classify workflow errors
AI produce daily development summary
```

Example workflow:

```text
NightlyQualityWorkflow
  → run backend diagnostics
  → run Playwright tests
  → summarize failures with AI agent
  → write markdown report
  → store artifact
```

Deliverable:

```text
SkyServer supports AI-agent tasks inside durable Temporal workflows.
```

---

### Phase 8 — Python task lane

Goal:

```text
Add Python execution capability for ETL/data processing.
```

Tasks:

1. Create Python project structure:

```text
skyetl/
  pipelines/
  common/
  tests/
  pyproject.toml
```

2. Add Python script activity adapter.
3. Support:
   - script path
   - arguments
   - environment variables
   - stdout/stderr capture
   - JSON output parsing
4. Add first Python ETL workflow.

Example:

```text
MacroETLWorkflow
  → extract data
  → load raw table
  → validate records
  → transform staging/core
  → refresh mart views
  → record audit summary
```

Deliverable:

```text
Temporal can orchestrate Python ETL/data-processing tasks from SkyServer.
```

---

### Phase 9 — Advanced workflow control

Goal:

```text
Add production-style workflow behavior.
```

Features:

- retries
- timeouts
- conditional branching
- failure handling
- compensation steps
- manual approval tasks
- pause/resume patterns
- workflow cancellation
- workflow versioning
- input/output mapping
- artifact dependency mapping

Example:

```text
if Playwright fails:
  → run AI failure summary
  → create issue report
else:
  → mark release candidate as verified
```

Deliverable:

```text
SkyServer workflows support real orchestration logic instead of simple task chains.
```

---

### Phase 10 — Optional Airflow integration

Goal:

```text
Add Airflow only when Python ETL grows large enough to justify a dedicated data pipeline layer.
```

Tasks:

1. Install Airflow locally.
2. Create first DAG.
3. Add Temporal activity:

```text
triggerAirflowDagActivity
```

4. Add SkyServer workflow:

```text
RunAirflowPipelineWorkflow
  → trigger Airflow DAG
  → poll DAG status
  → record result
```

Deliverable:

```text
SkyServer can orchestrate Airflow DAGs through Temporal when needed.
```

---

## 13. First Target Workflow Candidates

### Candidate 1 — Run Existing Tool Workflow

```text
RunToolWorkflow
  → validate request
  → execute existing tool
  → capture output
  → save run summary
```

Best first workflow because it reuses existing infrastructure.

### Candidate 2 — Repo Maintenance Workflow

```text
RepoMaintenanceWorkflow
  → generate repo map
  → generate repo zip
  → write artifact summary
```

Good portfolio workflow.

### Candidate 3 — SkyWeb Regression Workflow

```text
SkyWebRegressionWorkflow
  → run Playwright tests
  → collect report
  → summarize results
```

Strong job-market signal.

### Candidate 4 — AI Failure Review Workflow

```text
AIFailureReviewWorkflow
  → load test report
  → summarize failures
  → suggest probable root causes
  → write markdown report
```

Strong AI-agent workflow signal.

### Candidate 5 — Macro ETL Workflow

```text
MacroETLWorkflow
  → extract data
  → validate
  → transform
  → load
  → refresh mart views
  → update SkyWeb dashboard freshness
```

Strong data-engineering signal.

---

## 14. Engineering Principles

### Do not rip out existing functionality immediately

Temporal should be introduced beside the current system.

Initial strategy:

```text
wrap existing tools → execute through Temporal → compare behavior → migrate gradually
```

### Keep workflows durable, activities practical

Temporal workflows should contain orchestration logic.

Activities should contain side effects:

- database writes
- file I/O
- API calls
- script execution
- model calls
- Playwright runs
- Python execution

### Keep database state separate from Temporal internals

Temporal stores workflow history internally.

SkyServer stores app-level summaries, artifacts, and user-facing metadata.

### Preserve PostgreSQL as the source of operational truth

SkyServer and SkyWeb should continue relying on PostgreSQL for:

- app state
- data
- reporting
- workflow summaries
- artifacts
- audit records

### Design for portfolio visibility

Every workflow should produce visible evidence:

- run record
- status
- artifact
- log
- summary
- dashboard/reporting impact

This makes the system valuable for interviews and GitHub presentation.

---

## 15. Career Positioning Value

This architecture allows the project to be described professionally as:

```text
A Node.js/PostgreSQL automation control plane integrated with Temporal for durable workflow orchestration, supporting reusable task adapters, script execution, Python ETL, AI-agent workflows, Playwright automation, workflow run history, artifacts, and analytics/reporting through a separate SkyWeb front end.
```

That statement aligns strongly with modern roles involving:

- workflow automation
- platform engineering
- AI-agent orchestration
- backend APIs
- ETL/data pipelines
- investment platform engineering
- test automation
- production operations
- data workflow visibility

---

## 16. Immediate Next Step After SkyWeb Bug Fixes

When SkyWeb stabilization is complete, begin:

### SkyServer Temporal Phase 1

```text
1. Add Temporal local dev server.
2. Add Temporal SDK to SkyServer.
3. Create Temporal folder structure.
4. Create first worker.
5. Create first activity wrapping an existing tool.
6. Create RunToolWorkflow.
7. Add API endpoint to start workflow.
8. Record run summary in PostgreSQL.
9. Display basic workflow run status in SkyServer Admin.
```

Success criteria:

```text
From SkyServer Admin UI:
  click “Run Workflow”
    → SkyServer API starts Temporal workflow
    → Temporal worker executes existing tool
    → output is captured
    → PostgreSQL stores run summary
    → UI displays success/failure
```

---

## 17. Final Direction

The workflow engine becomes the focal point of SkyServer.

SkyServer is no longer only:

```text
Admin console + script runner + ingestion monitor
```

It becomes:

```text
Workflow automation platform + durable orchestration control plane
```

Temporal is the backbone.  
PostgreSQL is the truth layer.  
SkyWeb is the visualization layer.  
Python becomes the data/ETL processing lane.  
AI agents and Playwright become workflow-capable activities.  
Airflow remains optional for dedicated future data-engineering DAGs.

This is the next major architectural upgrade path for SkyServer.

---

## 18. Reference Links

These links are included for later technical verification and implementation planning.

- Temporal main site: https://temporal.io/
- Temporal self-hosted guide: https://docs.temporal.io/self-hosted-guide
- Temporal TypeScript SDK guide: https://docs.temporal.io/develop/typescript
- Temporal workers concept: https://docs.temporal.io/workers
- Temporal workflows concept: https://docs.temporal.io/workflows
- Airflow overview: https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/overview.html
- BullMQ docs: https://docs.bullmq.io/
