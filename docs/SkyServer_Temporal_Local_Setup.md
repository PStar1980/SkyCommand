# SkyServer Temporal Local Setup

## Purpose

This document defines the local setup path for the SkyServer Temporal pilot. Temporal is introduced beside the existing SkyServer worker/scheduler system. The current worker stack remains active while the first durable workflow pilot proves the orchestration pattern.

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
| Web UI | usually opened by the local dev server |

## SkyServer environment

Add these values to the SkyServer root `.env` file:

```env
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=skyserver-local
TEMPORAL_FRED_WORKFLOW_ID_PREFIX=skyserver-fred-ingestion
TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS=1800000
```

## Install dependencies

After applying the Phase 10.1 files, run:

```bash
npm install
```

This installs the Temporal TypeScript SDK packages referenced by `package.json` and updates `package-lock.json` on the local workstation.

## Development commands

Run Temporal itself in a separate terminal:

```bash
temporal server start-dev
```

Run the SkyServer Temporal worker:

```bash
npm run temporal:worker:dev
```

Check Temporal connectivity:

```bash
npm run temporal:health
```

Start the FRED pilot workflow:

```bash
npm run temporal:fred
```

## Recommended terminal layout

```text
Terminal 1: temporal server start-dev
Terminal 2: npm run temporal:worker:dev
Terminal 3: npm run temporal:fred
Terminal 4: npm run api             # optional SkyServer API
Terminal 5: npm run web             # optional Admin-Web
```

## Non-goals for Phase 10.1

Phase 10.1 does not remove the existing worker daemon, scheduler/listener tables, Admin-Web automation pages, or script execution service. It only adds the first side-by-side Temporal lane.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Worker cannot connect | Temporal dev server is not running | Start `temporal server start-dev` |
| Workflow starts but does not progress | Worker is not running or task queue mismatch | Confirm `TEMPORAL_TASK_QUEUE` matches worker/client config |
| FRED activity times out | Source downloads are slow or network is unstable | Increase `TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS` |
| Workflow fails quickly | Missing `.env` database values or ingestion script error | Confirm PostgreSQL env values and run FRED ingestion directly once |

