# SkyServer Temporal FRED Ingestion Pilot

## Objective

The first Temporal workflow pilot started as a safe wrapper around the existing FRED macro ingestion script. Phase 10.2 promotes that pilot into indicator-level Temporal orchestration.

The current workflow is now:

```text
Temporal Workflow
  -> list active FRED indicators
  -> run FRED indicator activities in controlled batches
      -> download one FRED series
      -> normalize the CSV
      -> load one macro table
      -> return one structured per-indicator result
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
| `packages/temporal/src/activities/fredActivities.js` | FRED indicator list/load activities, plus the legacy script wrapper retained for compatibility |
| `packages/temporal/src/worker.js` | Temporal worker process |
| `packages/temporal/src/startFredIngestionWorkflow.js` | Manual client script that starts the pilot workflow |
| `packages/temporal/src/temporalHealth.js` | Temporal connectivity check |
| `packages/temporal/src/config.js` | Shared local Temporal configuration |

## Activity behavior

The FRED workflow now uses two primary activities:

- `listFredIndicatorsActivity` reads the active FRED indicator list from PostgreSQL, unless the workflow input supplies an explicit indicator subset.
- `loadFredIndicatorActivity` downloads, normalizes, and loads one FRED indicator at a time.

This keeps the migration safe while making the workflow much more useful:

- existing ingestion modules are reused
- existing scheduler/worker system remains unchanged
- each indicator gets independent Temporal retry behavior
- failed indicators are returned as structured results instead of hiding inside one large script log
- workflow output is already shaped for future API/Admin-Web display

The previous `loadFredMacroDataActivity` script wrapper is still exported for compatibility, but the workflow no longer depends on it.

## Retry policy

The workflow configures indicator loading with:

```text
startToCloseTimeout: 5 minutes per indicator
initialInterval: 30 seconds
backoffCoefficient: 2
maximumInterval: 5 minutes
maximumAttempts: 3
```

Indicator concurrency defaults to `3` and is capped at `10`.


## Manual runner output

The manual runner defaults to human-readable output with a workflow summary and per-indicator success/failure rows. Raw JSON remains available for future API/Admin-Web callers.

```powershell
npm run temporal:fred
```

Useful options:

```powershell
# Run only selected indicators.
npm run temporal:fred -- --indicators=GDP,UNRATE,DGS10

# Run selected indicators with explicit concurrency.
npm run temporal:fred -- --indicators=GDP,UNRATE,DGS10 --concurrency=2

# Emit raw structured workflow output for future API/Admin-Web callers.
npm run temporal:fred -- --json
```

The default concurrency can also be overridden with:

```env
TEMPORAL_FRED_CONCURRENCY=3
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

- protected SkyServer Core/API endpoints for starting/querying/canceling workflows
- PostgreSQL persistence of workflow run summaries for Admin-Web display and auditability
- Admin-Web workflow dashboard and manual start controls
- schedule-to-workflow migration for recurring ingestion
- dedicated retries per source and per indicator family
- alert evaluation workflow chaining after successful ingestion

