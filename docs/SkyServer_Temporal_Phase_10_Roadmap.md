# SkyServer Temporal Phase 10 Roadmap

## Phase 10 goal

Introduce Temporal as SkyServer's durable workflow orchestration engine while preserving the existing worker/tool infrastructure until the new lane proves itself.

## Execution slices

| Slice | Status | Objective |
| --- | --- | --- |
| 10.1 | Complete | Add Temporal SDK wiring, local setup docs, worker skeleton, and first FRED ingestion pilot workflow |
| 10.2 | Complete | Convert FRED ingestion from one script activity into per-indicator activities with controlled workflow concurrency |
| 10.3 | Complete | Add protected API endpoints to start and inspect pilot workflows through SkyServer Core/API |
| 10.4 | Complete | Add Admin-Web workflow console for Temporal health, FRED manual starts, run summaries, detail inspection, cancel, and terminate controls |
| 10.5 | Complete | Add database-backed approved workflow templates and parameter schemas for configurable Admin-Web starts |
| 10.6 | Complete | Persist workflow launch summaries into PostgreSQL for Admin-Web reporting and auditability |
| 10.7 | Complete | Add a worker scheduler bridge that can start approved Temporal workflow templates on one-time or interval schedules |
| 10.8 | Planned | Add alert-evaluation workflow chaining after successful macro ingestion |
| 10.9 | Planned | Define migration rules for scheduler/listener jobs that should become Temporal workflows |

## Migration rules

Use Temporal when work is:

- multi-step
- retry-sensitive
- long-running
- dependent on external systems
- worth tracking in history
- likely to need pause/resume/cancel/status behavior

Keep direct SkyServer tools when work is:

- short-lived
- single-step
- operator-triggered
- naturally synchronous
- mainly diagnostic or administrative

## Control-plane boundary

SkyServer remains the cockpit. Temporal becomes the durable execution engine.

```text
Admin-Web / API / Core CLI
  -> start/query/cancel workflows
  -> show workflow summaries and operational status
  -> keep RBAC, audit, tool metadata, and operator UX

Temporal
  -> workflow state
  -> retries
  -> activity dispatch
  -> timers
  -> durable history
```



## Phase 10.5 — Workflow Templates + Configuration

Phase 10.5 adds a PostgreSQL metadata layer for approved Temporal workflow templates. The API now reads template definitions and parameter schemas from `worker.vw_temporal_workflow_definitions`, and Admin-Web renders the selected template summary/defaults from that metadata.

This keeps the control plane safe: operators can configure known templates like `fred-ingestion`, but the browser still cannot start arbitrary workflow code or arbitrary task queues.


## Phase 10.6 — Workflow Run Records

Phase 10.6 adds `worker.temporal_workflow_run_records` and `worker.vw_temporal_workflow_run_records` as a SkyServer-owned run index for Temporal workflow launches and control actions.

This is not a replacement for Temporal event history. Temporal remains the durable execution/event-history engine. SkyServer now stores the operator-facing launch summary: workflow code/type, workflow ID, Temporal run ID, namespace, task queue, run source, normalized input, starter, cancel/terminate request metadata, and the latest status snapshot observed through Temporal visibility/detail calls.

Admin-Web can now show recorded workflow runs even when a local `temporal server start-dev` instance has restarted and lost its in-memory/dev visibility history.


## Phase 10.7 — Scheduler-to-Temporal Bridge

Phase 10.7 adds a worker-visible scheduler bridge tool named `temporal_workflow_start`. Existing `worker.schedules` records can now trigger approved Temporal workflow templates without requiring the browser or Postman to press the start button.

The schedule runner detects this bridge tool and calls SkyServer's Temporal service directly instead of launching a legacy script process. The first supported template is `fred-ingestion`, so a schedule can start `fredIngestionWorkflow` with optional indicators, concurrency, workflow ID override, timeout, and advanced JSON input.

Scheduled workflow starts are recorded with `runSource: scheduler` and include scheduler context in the Temporal run record metadata: schedule ID/code/name, schedule run ID, worker node ID/name, and queue/start timestamps. The `worker.schedule_runs` row is marked successful once Temporal accepts the workflow start request; Temporal remains responsible for the workflow's durable execution lifecycle.

---

## Phase 10.9 — Tool Primitive Upgrade + Workflow Builder Foundation

Phase 10.9 adjusts the roadmap before deeper workflow chaining:

1. Upgrade the existing FRED ingestion **tool** so the improved indicator-level batching/concurrency is not locked inside the Temporal workflow only.
2. Add SkyServer workflow-builder metadata tables so future workflows can compose tools, APIs, agents, waits, conditions, human approvals, child workflows, and approved Temporal templates as nodes.

This means:

```text
Tools remain primitives.
Workflows compose primitives.
Temporal executes durable orchestration.
Scheduler/listeners trigger workflows.
Admin creates/configures/monitors them.
```

The next executable slice should be a simple sequential SkyServer workflow executor, starting with `TOOL` and `TEMPORAL_WORKFLOW` node types.

## Phase 10.10 — SkyServer Workflow Executor v1

Phase 10.10 changes the next layer from hardcoded Temporal workflow chaining to the higher-level SkyServer workflow model.

Implemented direction:

```text
Tool / API / Agent / Child Workflow / Temporal Template
        -> Workflow Node
        -> SkyServer Workflow Definition
        -> Published Workflow Version
        -> Workflow Run + Node Runs
```

Executor v1 supports the first two runnable node types:

- `TOOL`: executes an existing `core.tools` primitive through SkyServer's permission-aware tool execution service.
- `TEMPORAL_WORKFLOW`: starts an approved Temporal template through the existing Temporal service.

This keeps the foundational principle intact:

```text
Tools remain primitives.
Workflows compose primitives.
Temporal is one execution/runtime lane, not the user-facing source of every primitive.
```

New API surface:

```text
GET  /api/workflows/definitions
GET  /api/workflows/definitions/:workflowCode
POST /api/workflows/definitions/:workflowCode/start
GET  /api/workflows/runs
GET  /api/workflows/runs/:workflowRunRecordId
```

Admin-Web `Workflows -> Start Workflow` and `Workflows -> Workflow History` now use the SkyServer workflow executor surfaces, while lower-level Temporal diagnostics remain available through `/workflows/temporal/start` and `/workflows/temporal/history`.


## Phase 10.10a — Workflow Executor Permission Hotfix

Added first-class SkyServer workflow permissions and corrected the alert-evaluation tool permission boundary. SkyServer workflow starts now use `WORKFLOW_START`, workflow read surfaces use `WORKFLOW_READ`, and the SkyWeb alert evaluation operational tool uses `SKYWEB_ALERT_EVALUATE` inside the SkyServer Admin app scope.


## Phase 10.11 — Temporal-backed SkyServer Workflow Executor

Status: implemented.

This phase turns the SkyServer workflow executor into a Temporal-backed runtime instead of leaving it as an inline API process. SkyServer workflow definitions remain stored in PostgreSQL and continue to compose lower-level primitives, but execution now flows through `skyserverWorkflowExecutorWorkflow` on the Temporal worker.

```text
SkyServer Admin
  -> SkyServer API
  -> Temporal skyserverWorkflowExecutorWorkflow
  -> workflow node activities
  -> core.tools / Temporal template adapters
  -> SkyServer workflow and node run records
```

Key behavior:

- Tools remain primitives; they are not renamed into workflows.
- SkyServer workflows remain the user/config-level orchestration objects.
- Temporal provides durable execution, activity scheduling, retry boundaries, and visibility for the generic executor workflow.
- Workflow History remains SkyServer's operator ledger and now links runs to Temporal workflow/run IDs.
- The inline executor remains available only as an explicit development fallback via `executorMode: "inline"`.

## Phase 10.12 — SkyServer Temporal Detail Integration

Status: implemented.

Phase 10.12 brings more Temporal runtime visibility into SkyServer Admin so operators do not need to jump into the generic Temporal UI for every routine inspection.

When a SkyServer workflow run has `temporal_workflow_id` / `temporal_run_id`, the workflow run detail API now attempts to enrich the response with:

- Temporal status, workflow type, namespace, and task queue
- Temporal UI deep link
- history/event count
- activity scheduled/completed/failed/timed-out/canceled counts
- workflow task counts
- latest event preview
- non-fatal warnings when Temporal describe/history is unavailable

The Admin-Web `Workflows -> Workflow History` page now renders a **Temporal runtime** panel beside the SkyServer run ledger and node timeline. SkyServer remains the domain-aware operator cockpit; Temporal UI remains the raw event-history debugger.

Configuration:

```text
TEMPORAL_UI_BASE_URL=http://localhost:8233
```

No database migration or seed is required for Phase 10.12.


## Phase 10.13 — Scheduler-to-SkyServer Workflow Bridge

Phase 10.13 connects the existing worker Scheduler to SkyServer workflow definitions. The new worker-visible tool `skyserver_workflow_start` is a scheduler bridge, not a normal script. When a schedule fires, the worker starts an approved SkyServer workflow definition through the Temporal-backed executor.

```text
worker.schedule -> skyserver_workflow_start
  -> workflowExecutorService.startWorkflowWithTemporal
  -> skyserverWorkflowExecutorWorkflow
  -> TOOL / TEMPORAL_WORKFLOW node activities
  -> worker.workflow_run_records + worker.workflow_node_run_records
```

This is distinct from `temporal_workflow_start`:

| Bridge tool | Starts | Best use |
| --- | --- | --- |
| `temporal_workflow_start` | Approved Temporal workflow template | Low-level Temporal-native subprocesses |
| `skyserver_workflow_start` | Approved SkyServer workflow definition | Business-level composed workflows |

The first seeded target is `macro-refresh-pipeline`, which composes the upgraded FRED ingestion tool primitive and SkyWeb alert evaluation tool.

## Phase 10.14 — Create Workflow UI v1

Phase 10.14 begins the workflow creation path inside SkyServer Admin. Rather than editing seed files, Admin-Web can create simple SkyServer workflow definitions from existing tool primitives.

Scope:

- Add `WORKFLOW_WRITE` permission for builder access.
- Add builder catalog API for node types and permission-filtered tool targets.
- Add create-definition API for sequential `TOOL` node workflows.
- Add `Workflows -> Create Workflow` page.
- Publish version 1 immediately when requested, making the workflow visible on `Workflows -> Start Workflow`.

Out of scope for this phase:

- visual graph canvas;
- branch/condition execution;
- API/agent/approval/wait node editors;
- child SkyServer workflow nodes;
- direct Temporal workflow template nodes from the builder.

Those remain future phases after the v1 create/start/history loop is stable.

---

## Phase 10.16 — Parameterized Workflow Nodes + BoC/StatCan Batch Upgrades

- Use manifest-driven tool parameter controls inside Create/Manage Workflow node editors.
- Remove raw Input JSON from Start Workflow; starts now use the published node defaults.
- Upgrade BoC and StatCan ingestion tool primitives with `indicators` and `concurrency` parameters.
- Keep tool parameters centralized in `core.tool_parameters` so Tools, Scheduler, and Workflow Builder share the same configuration source.

---

## Phase 10.18 — Scheduler target split

Phase 10.18 improves the Scheduler UX after the workflow bridge was proven. The Scheduler form now asks for a high-level schedule target type first:

- `Tool` for worker-visible tool primitives;
- `Workflow` for active SkyServer workflow definitions.

Selecting `Workflow` shows active SkyServer workflows instead of exposing the `skyserver_workflow_start` bridge alongside normal tools. The runtime remains unchanged: scheduled workflows still start through the Temporal-backed SkyServer workflow executor.


## Phase 10.19 — API_CALL node support v1

Status: implemented.

The SkyServer workflow builder now supports `API_CALL` nodes in addition to `TOOL` nodes. API calls are executed inside the Temporal-backed SkyServer workflow executor as activities, so the same run ledger, node timeline, Temporal diagnostics, retry shell, and failure handling apply.

This expands the workflow hierarchy from tool-only pipelines into integration workflows:

```text
SkyServer workflow
  -> TOOL node
  -> API_CALL node
  -> future AGENT / WORKFLOW / TEMPORAL_WORKFLOW / CONDITION nodes
```

V1 API nodes support method, URL, headers JSON, body JSON, expected success codes, timeout, and response preview limits. Secrets and reusable connection profiles remain a future hardening step.
