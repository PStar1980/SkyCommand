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
| 10.7 | Planned | Add alert-evaluation workflow chaining after successful macro ingestion |
| 10.8 | Planned | Define migration rules for scheduler/listener jobs that should become Temporal workflows |

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
