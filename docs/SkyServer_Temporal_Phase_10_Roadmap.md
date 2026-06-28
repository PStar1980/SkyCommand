# SkyServer Temporal Phase 10 Roadmap

## Phase 10 goal

Introduce Temporal as SkyServer's durable workflow orchestration engine while preserving the existing worker/tool infrastructure until the new lane proves itself.

## Execution slices

| Slice | Status | Objective |
| --- | --- | --- |
| 10.1 | Complete | Add Temporal SDK wiring, local setup docs, worker skeleton, and first FRED ingestion pilot workflow |
| 10.2 | Complete | Convert FRED ingestion from one script activity into per-indicator activities with controlled workflow concurrency |
| 10.3 | Planned | Add protected API endpoints to start and inspect pilot workflows through SkyServer Core/API |
| 10.4 | Planned | Add Admin-Web workflow console for Temporal health, FRED manual starts, and run summaries |
| 10.5 | Planned | Persist workflow launch summaries into PostgreSQL for Admin-Web reporting and auditability |
| 10.6 | Planned | Add alert-evaluation workflow chaining after successful macro ingestion |
| 10.7 | Planned | Define migration rules for scheduler/listener jobs that should become Temporal workflows |

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

