# SkyServer Temporal Admin-Web Console

## Purpose

Phase 10.4 exposes the Temporal pilot from SkyServer Admin-Web so workflow operations no longer require the CLI or Postman for the happy path.

The browser still does **not** talk to Temporal directly. Admin-Web calls SkyServer Core/API, and the API uses the Temporal client under RBAC protection.

```text
SkyServer Admin-Web
  -> SkyServer Core/API /api/temporal
      -> Temporal Client
          -> Temporal Service
              -> Temporal Worker
                  -> FRED indicator activities
```

## Route

Admin-Web surfaces:

```text
Workflows -> Start Workflow
/workflows/start

Workflows -> Workflow History
/workflows/history
```

Compatibility redirects:

```text
/automation/temporal -> /workflows/history
/temporal -> /workflows/history
```

## Features

The workflow pages support:

- Temporal health display
- Namespace and task queue display
- Approved workflow template summary for `fredIngestionWorkflow`
- Manual FRED workflow start from the browser on Start Workflow
- Optional indicator list entry
- Configurable concurrency entry
- Optional workflow ID override
- Active workflow listing on Start Workflow
- Recent workflow run listing on Workflow History
- Workflow detail inspection on Workflow History
- Running workflow cancellation
- High-risk workflow termination for users with terminate permission

## Permissions

The page route requires:

```text
TEMPORAL_WORKFLOW_READ
```

Start button requires either:

```text
TEMPORAL_WORKFLOW_START
INGESTION_RUN_FRED
```

Cancel button requires:

```text
TEMPORAL_WORKFLOW_CANCEL
```

Terminate button requires:

```text
TEMPORAL_WORKFLOW_TERMINATE
```

These permissions are seeded by:

```text
packages/db_build/src/seeds/00032__temporal_auth_seed.sql
```

## Manual start payload

Admin-Web sends a JSON body to:

```http
POST /api/temporal/workflows/fred-ingestion/start
```

Example body:

```json
{
  "indicators": ["GDP", "UNRATE", "DGS10"],
  "concurrency": 2,
  "runSource": "admin_web_manual"
}
```

Blank indicators intentionally means the full configured FRED indicator set.

## Postman note

The API now also tolerates basic query-string launch parameters for local diagnostics, but the recommended manual API test is still **Body -> raw -> JSON**, not Params.

Correct Postman body:

```json
{
  "indicators": ["GDP", "UNRATE", "DGS10"],
  "concurrency": 2
}
```

## Local test sequence

Start Temporal:

```powershell
temporal server start-dev
```

Start the Temporal worker:

```powershell
npm run temporal:worker:dev
```

Start SkyServer API:

```powershell
npm run api
```

Start Admin-Web:

```powershell
npm run web
```

Then open either page:

```text
http://localhost:5171/workflows/start
http://localhost:5171/workflows/history
```

## Phase boundary

Phase 10.4 is intentionally UI/API driven only. It does not yet persist workflow launch summaries into PostgreSQL. Temporal remains the source of workflow history for this slice.

The next slice should add local run metadata/audit persistence so the Admin dashboard can report workflow starts even when Temporal history retention is eventually configured or cleaned.


## Phase 10.5 template upgrade

The console now reads approved workflow templates from the SkyServer database instead of relying only on in-code API constants. Template metadata comes from `worker.vw_temporal_workflow_definitions` and includes the workflow code, workflow type, task queue configuration key, default/max concurrency, permission codes, and visible parameter schema.

The current manual-start form still targets the FRED workflow adapter, but the page is now ready to display additional approved workflow templates as they are seeded and wired to server-side start adapters.


## Phase 10.6 run-record behavior

The Recent Runs table now merges Temporal visibility with SkyServer PostgreSQL run records. Runs started through Admin-Web/API are stored in `worker.temporal_workflow_run_records` with the normalized launch input and the user who started the run.

If local Temporal dev history is lost after a machine restart, Admin-Web can still display the SkyServer run record as `SkyServer DB`. That record is only a launch/status summary; full workflow event history still belongs to Temporal.


## Phase 10.7 scheduler bridge behavior

The Temporal console can now show workflows launched from the SkyServer Scheduler because scheduled starts are persisted in the same `worker.temporal_workflow_run_records` table. These runs use:

```text
run_source: scheduler
```

The Scheduler page does not talk to Temporal directly. It creates a normal `worker.schedules` row using the worker-visible `temporal_workflow_start` bridge tool. When that schedule is claimed by the worker daemon, the worker calls the approved-template Temporal start service and records both:

- the `worker.schedule_runs` scheduler execution record; and
- the `worker.temporal_workflow_run_records` Temporal workflow launch record.

A scheduler run marked `SUCCESS` means the worker successfully requested/started the Temporal workflow. The downstream workflow can continue running in Temporal after the scheduler bridge run has finished.


## Phase 10.8 navigation split

Temporal workflows now live under a dedicated top-level **Workflows** menu instead of Automation:

```text
Tools -> Run Tools / Tools History
Workflows -> Start Workflow / Workflow History
Automation -> Scheduler / Listener
Data -> Ingestion Status
Configuration -> Repositories
Access Control -> Users / Sessions / Roles / Privileges / User History
```

The old combined console route remains as a compatibility redirect to Workflow History.
