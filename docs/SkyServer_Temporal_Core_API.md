# SkyServer Temporal Core API

## Objective

Phase 10.3 exposes the Temporal pilot through protected SkyServer Core/API endpoints. This keeps Temporal behind SkyServer authentication, RBAC, and future audit controls instead of letting browser clients or operators talk directly to Temporal.

```text
Admin-Web / API caller
  -> SkyServer Core API
  -> Temporal Client
  -> Temporal Server
  -> Temporal Worker
  -> FRED indicator activities
```

## Current endpoints

All routes require a valid SkyServer bearer token.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/temporal/health` | Checks Temporal connectivity and reports configured namespace/task queue. |
| `GET` | `/api/temporal/workflow-definitions` | Returns approved workflow templates currently exposed by SkyServer. |
| `GET` | `/api/temporal/workflows` | Lists Temporal workflow executions. Defaults to `fredIngestionWorkflow`. |
| `GET` | `/api/temporal/workflows/:workflowId` | Describes one Temporal workflow execution. Optional `runId` query parameter. |
| `POST` | `/api/temporal/workflows/fred-ingestion/start` | Starts the approved FRED ingestion workflow asynchronously. |
| `POST` | `/api/temporal/workflows/:workflowId/cancel` | Requests cooperative cancellation of a workflow. |
| `POST` | `/api/temporal/workflows/:workflowId/terminate` | Terminates a workflow. Intended as a higher-risk admin control. |

## FRED start body

```json
{
  "indicators": ["GDP", "UNRATE", "DGS10"],
  "concurrency": 2,
  "timeoutMs": 1800000,
  "runSource": "api_manual"
}
```

All fields are optional.

- Leave `indicators` blank to run the full configured FRED indicator set.
- `concurrency` defaults to `3` and is capped at `10`.
- `timeoutMs` defaults to 30 minutes and is capped at 24 hours.
- The API starts the workflow and returns immediately with `202 Accepted`; it does not wait for workflow completion.

## Example API flow

```powershell
# Check Temporal from SkyServer API
Invoke-RestMethod `
  -Method GET `
  -Uri "http://localhost:7171/api/temporal/health" `
  -Headers @{ Authorization = "Bearer <token>" }
```

```powershell
# Start a selected FRED indicator workflow
Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:7171/api/temporal/workflows/fred-ingestion/start" `
  -Headers @{ Authorization = "Bearer <token>" } `
  -ContentType "application/json" `
  -Body '{"indicators":["GDP","UNRATE","DGS10"],"concurrency":2}'
```

```powershell
# List recent FRED workflow executions
Invoke-RestMethod `
  -Method GET `
  -Uri "http://localhost:7171/api/temporal/workflows?limit=10" `
  -Headers @{ Authorization = "Bearer <token>" }
```


## Postman body note

Use **Body -> raw -> JSON** when testing the start endpoint in Postman. The Params tab is for query-string values and can accidentally launch a full FRED run if the JSON payload does not reach `req.body`.

Correct request body:

```json
{
  "indicators": ["GDP", "UNRATE", "DGS10"],
  "concurrency": 2
}
```

The API also accepts simple diagnostic query parameters such as `?indicators=GDP,UNRATE&concurrency=2`, but JSON body remains the preferred shape.

## Permissions

Phase 10.3 adds dedicated Temporal permissions:

| Permission | Purpose |
| --- | --- |
| `TEMPORAL_WORKFLOW_READ` | View health, workflow definitions, workflow runs, and run details. |
| `TEMPORAL_WORKFLOW_START` | Start approved workflows. |
| `TEMPORAL_WORKFLOW_CANCEL` | Request workflow cancellation. |
| `TEMPORAL_WORKFLOW_TERMINATE` | Terminate workflows. |

For local continuity, the routes also accept existing worker/ingestion permissions as compatibility fallbacks:

- read routes: `WORKER_SCHEDULE_READ`
- start route: `WORKER_SCHEDULE_RUN` or `INGESTION_RUN_FRED`
- cancel route: `WORKER_SCHEDULE_RUN`
- terminate route: `WORKER_ADMIN`

Run the database seed/build step after applying this patch so the new dedicated Temporal permissions are available in existing databases.

## Boundary rules

- The API exposes only approved workflow templates.
- Browser clients should never receive raw arbitrary Temporal execution capability.
- Workflow input is normalized and constrained before it reaches Temporal.
- Admin-Web should call these routes, not Temporal directly.
- Future persistence/audit can be layered at this API boundary without changing workflow code.

## Next slice

Phase 10.4 added the Admin-Web Workflow Console. The next slice should persist workflow launch metadata into PostgreSQL for local reporting, auditability, and dashboard rollups.
