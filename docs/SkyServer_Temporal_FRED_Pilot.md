# SkyServer Temporal FRED Ingestion Pilot

## Objective

The first Temporal workflow pilot wraps the existing FRED macro ingestion script as a Temporal Activity and runs it from a durable Temporal Workflow.

This is intentionally small and non-destructive:

```text
Temporal Workflow
  -> FRED ingestion Activity
      -> existing packages/ingestion/src/loadFREDMacroData.js script
          -> existing PostgreSQL ingestion/staging/load behavior
```

## Why FRED first?

FRED ingestion is a good pilot candidate because it is:

- already implemented and operational
- recurring and automation-friendly
- dependent on external HTTP downloads
- sensitive to timeout/retry behavior
- valuable to SkyWeb macro analytics freshness
- a natural candidate for durable retry and run visibility

## Current implementation

| File | Purpose |
| --- | --- |
| `packages/temporal/src/workflows/fredIngestionWorkflow.js` | Temporal Workflow definition |
| `packages/temporal/src/activities/fredActivities.js` | Activity wrapper around existing FRED ingestion script |
| `packages/temporal/src/worker.js` | Temporal worker process |
| `packages/temporal/src/startFredIngestionWorkflow.js` | Manual client script that starts the pilot workflow |
| `packages/temporal/src/temporalHealth.js` | Temporal connectivity check |
| `packages/temporal/src/config.js` | Shared local Temporal configuration |

## Activity behavior

The FRED Activity launches the existing script in a child Node.js process instead of refactoring the ingestion engine on day one.

This keeps the migration safe:

- existing ingestion code remains unchanged
- existing scheduler/worker system remains unchanged
- Temporal owns retry/durable workflow behavior for the wrapper
- later phases can refactor the ingestion engine into richer typed activities

## Retry policy

The pilot workflow configures the FRED activity with:

```text
startToCloseTimeout: 35 minutes
initialInterval: 30 seconds
backoffCoefficient: 2
maximumInterval: 5 minutes
maximumAttempts: 3
```

The local activity timeout can also be controlled through:

```env
TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS=1800000
```


## Manual runner output

The manual runner defaults to human-readable output so the FRED child-process log tail renders with real line breaks instead of one large escaped JSON string.

```powershell
npm run temporal:fred
```

Useful options:

```powershell
# Emit the raw structured workflow result for future API/Admin-Web callers.
npm run temporal:fred -- --json

# Increase or reduce the visible ingestion log tail.
npm run temporal:fred -- --tail-lines=200
```

The default tail length is 120 lines and can also be overridden with:

```env
TEMPORAL_FRED_OUTPUT_TAIL_LINES=200
```

## Validation checklist

1. Start Temporal dev server.
2. Start SkyServer Temporal worker.
3. Run `npm run temporal:health`.
4. Run `npm run temporal:fred`.
5. Confirm workflow completion in terminal output.
6. Inspect Temporal Web UI workflow history.
7. Confirm FRED ingestion still updates/validates the expected PostgreSQL macro data.
8. Confirm existing SkyServer worker/scheduler routes still work unchanged.

## Future hardening

Later phases should improve the pilot by adding:

- per-indicator activity granularity
- structured ingestion result summaries
- failure counts surfaced as activity results
- PostgreSQL workflow run mirrors for Admin-Web display
- Admin-Web start/cancel/status controls
- schedule-to-workflow migration for recurring ingestion
- dedicated retries per source and per indicator
- alert evaluation workflow after successful ingestion

