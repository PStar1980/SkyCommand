# SkyServer Temporal Local Setup

## Purpose

This document is the current local development guide for the completed Phase 10 Temporal workflow lane. Temporal runs beside the existing SkyServer worker/scheduler system and provides durable execution for SkyServer workflow definitions.

## Local prerequisites

Install the Temporal CLI and start a local development server:

```bash
temporal server start-dev
```

The local dev server normally exposes:

| Surface | Default |
| --- | --- |
| Temporal frontend address | `localhost:7233` |
| Namespace | `default` |
| Temporal Web UI | `http://localhost:8233` |
| Metrics | `http://localhost:2661/metrics` |

## SkyServer environment

Add these values to the SkyServer root `.env` file:

```env
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=skyserver-local
TEMPORAL_UI_BASE_URL=http://localhost:8233
TEMPORAL_FRED_WORKFLOW_ID_PREFIX=skyserver-fred-ingestion
TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS=1800000
SKYSERVER_INTERNAL_API_TOKEN=replace_with_a_local_secret
```

The internal API token is used by workflow API-call nodes and internal workflow bridge calls. Use a local secret value and keep it stable for the environment unless rotating credentials intentionally.

## Development commands

Run each long-lived process in its own terminal:

```bash
# Terminal 1: Temporal server
temporal server start-dev

# Terminal 2: SkyServer API
npm run api

# Terminal 3: SkyServer Temporal worker
npm run temporal:worker:dev

# Terminal 4: Admin-Web
npm run web

# Optional: classic SkyServer worker daemon for schedules/listeners
npm run worker:dev
```

Useful checks:

```bash
npm run temporal:health
npm run db:health
temporal task-queue describe --address localhost:7233 --namespace default --task-queue skyserver-local
```

Optional direct FRED workflow pilot runner:

```bash
npm run temporal:fred
npm run temporal:fred -- --indicators=GDP,UNRATE,DGS10 --concurrency=2
```

## Admin-Web health surfaces

| Page | Purpose |
| --- | --- |
| `Workflows -> Worker Health` | Temporal reachability, task queue pollers, worker heartbeat freshness, run pressure, approvals, and schedules |
| `Workflows -> Workflow History` | Runtime graph overlays, Temporal workflow/run IDs, event summaries, run controls, and retry lineage |
| `Configuration -> Production Readiness` | Environment, Temporal, DB, workflow graph, authorization, and operational readiness checks |

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Worker cannot connect | Temporal dev server is not running | Start `temporal server start-dev` |
| Workflow starts but does not progress | Worker is not running or task queue mismatch | Confirm `TEMPORAL_TASK_QUEUE` matches worker/client config and check Worker Health |
| Worker Health shows no heartbeat | Temporal worker was not restarted after heartbeat migration or cannot write to DB | Restart `npm run temporal:worker:dev` and check PostgreSQL env values |
| Task queue has no pollers | Temporal worker is offline or pointed at another task queue | Restart the worker and run `temporal task-queue describe` |
| Approval does not resume workflow | Pending approval was deleted or Temporal execution is gone | Use Workflow History run controls to terminate/clean up and retry fresh |
| FRED activity fails with HTTP 404/timeout | Source-side data issue or network instability | Retry run, narrow indicators, or run the ingestion script directly for source diagnostics |

## Production note

Local `temporal server start-dev` is only for development. Production should use persistent Temporal storage, supervised API/Admin-Web/worker processes, durable PostgreSQL backups, environment-specific secrets, and retained logs. The current readiness checklist reports those gaps but does not provision deployment infrastructure.

## SkyServer Core CLI workflow start

The local Core CLI now has two top-level lanes:

```text
1) Run Tools
2) Run Workflows
```

Use `npm run core`, then choose **Run Workflows** to start any active, enabled, published SkyServer workflow definition through the Temporal-backed executor. The CLI prompts for an optional Temporal workflow ID override and optional JSON input object.

The CLI resolves a local trusted operator from `SKYSERVER_CORE_OPERATOR_EMAIL` / `SKYSERVER_ADMIN_EMAIL` when configured, otherwise it uses the latest active `SUPER_ADMIN` account it can find. Workflow runs started this way appear in Workflow History just like Admin-Web starts and scheduled starts.

