# SkyCommand Temporal Local Setup

## Purpose

This document is the current local development guide for SkyCommand's Temporal workflow lane. The Temporal development service now runs in Docker, while the SkyCommand Temporal worker remains a host process for the first containerization proof boundary.

Keeping the worker on the host for this slice preserves the existing Windows repository paths and Git credentials used by repository automation. A later Docker slice will add container-specific repository paths and worker authentication before the worker itself moves into Compose.

## Prerequisites

- Docker Desktop running with Docker Compose available.
- SkyCommand dependencies installed for the host-run API, Admin-Web, and workers.
- PostgreSQL available using the normal SkyCommand `.env` configuration.

The host Temporal CLI is optional once the Docker service is in use. SkyCommand's npm helpers call Docker Compose directly.

## Dockerized Temporal service

The root `compose.yaml` defines the `temporal` service using the pinned `temporalio/temporal:1.7.2` image.

| Surface | Local address |
| --- | --- |
| Temporal frontend/gRPC | `localhost:7233` |
| Namespace | `default` |
| Temporal Web UI | `http://localhost:8600` |
| Container Web UI port | `8233` |
| Persistent development state | Docker volume `skycommand_temporal_data` |

The service runs `temporal server start-dev --ip 0.0.0.0 --db-filename /var/lib/temporal/temporal.db`. The named volume keeps the SQLite development database when the container is restarted or recreated.

The official `temporalio/temporal` CLI image runs as the non-root `temporal` user (UID 1000). Compose therefore runs a small one-shot `temporal-volume-init` service first to make the named volume writable by UID 1000 before the Temporal service starts.

Host ports bind to `127.0.0.1`, so the local development service is not intentionally exposed to the LAN.

## SkyCommand environment

Add or confirm these values in the SkyCommand root `.env` file:

```env
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=skyserver-local
TEMPORAL_UI_BASE_URL=http://localhost:8600
TEMPORAL_FRED_WORKFLOW_ID_PREFIX=skycommand-fred-ingestion
TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS=1800000
SKYCOMMAND_INTERNAL_API_TOKEN=replace_with_a_local_secret
```

The internal API token is used by workflow API-call nodes and internal workflow bridge calls. Use a local secret value and keep it stable for the environment unless rotating credentials intentionally.

## Start the local stack

Before the first Docker start, stop any manually launched `temporal server start-dev` / `--headless` process so host port `7233` is free.

Start Temporal in Docker:

```bash
npm run temporal:server:up
```

Then run the remaining SkyCommand processes in their own terminals:

```bash
# SkyCommand API
npm run api

# SkyCommand Temporal worker (host-run in this first Docker slice)
npm run temporal:worker:dev

# Admin-Web
npm run web

# Optional: classic SkyCommand worker daemon for schedules/listeners
npm run worker:dev
```

The Temporal container uses `restart: unless-stopped`, so Docker Desktop can restore it after a machine/Docker restart unless you explicitly stopped the container.

## Temporal container operations

```bash
# Start/recreate in the background
npm run temporal:server:up

# Show status and Docker health
npm run temporal:server:status

# Restart only Temporal
npm run temporal:server:restart

# Follow Temporal logs (Ctrl+C stops log following, not the container)
npm run temporal:server:logs

# Stop Temporal while preserving its container data volume
npm run temporal:server:stop
```

Useful SkyCommand checks:

```bash
npm run temporal:health
npm run db:health
temporal task-queue describe --address localhost:7233 --namespace default --task-queue skyserver-local
```

The last command requires the optional host Temporal CLI. The SkyCommand health command does not.

Optional direct FRED workflow runner:

```bash
npm run temporal:fred
npm run temporal:fred -- --indicators=GDP,UNRATE,DGS10 --concurrency=2
```

## Persistence behavior

`docker compose stop temporal`, `docker compose restart temporal`, and normal container recreation keep the `skycommand_temporal_data` volume intact.

Do not delete that volume casually: removing it intentionally resets the local Temporal development database and therefore removes local workflow histories stored by this development service.

## Admin-Web health surfaces

| Page | Purpose |
| --- | --- |
| `Command Center` | Web, PostgreSQL, API, Node worker, Temporal service, and Temporal worker availability |
| `Workflow Operations` | Runtime graph overlays, Temporal workflow/run IDs, event summaries, run controls, and retry lineage |
| `Readiness` | Environment, Temporal, DB, workflow graph, authorization, and operational readiness checks |

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `docker compose` cannot connect | Docker Desktop is not running | Start Docker Desktop and retry `npm run temporal:server:up` |
| Port `7233` is already allocated | A manually started/headless Temporal service is still running | Stop the host Temporal process, then start the Docker service |
| Temporal UI does not open | Host port `8600` is unavailable or container is unhealthy | Run `npm run temporal:server:status` and `npm run temporal:server:logs` |
| Workflow starts but does not progress | Host-run Temporal worker is not running or task queue mismatch | Confirm `TEMPORAL_TASK_QUEUE=skyserver-local` and run `npm run temporal:worker:dev` |
| Temporal log shows `unable to open database file ... (14)` | The named volume is not writable by the Temporal CLI user | Use the current Compose file; `temporal-volume-init` repairs ownership before server startup. Run `docker compose down`, then `npm run temporal:server:up`. |
| Host Temporal worker reports `ECONNREFUSED 127.0.0.1:7233` | The Docker Temporal service did not become healthy | Fix/start the Temporal service first; the host worker will connect once `localhost:7233` is listening. |
| Command Center shows Temporal service offline | Docker service is stopped/unhealthy or `.env` points elsewhere | Run `npm run temporal:server:status`, then `npm run temporal:health` |
| Worker Health shows no heartbeat | Temporal worker is offline or cannot write to PostgreSQL | Restart `npm run temporal:worker:dev` and check PostgreSQL environment values |
| Approval does not resume workflow | Pending approval was deleted or the Temporal execution is gone | Use Workflow Operations run controls to terminate/clean up and retry fresh |

## Production boundary

The Dockerized service still uses Temporal's `server start-dev` development runtime. Docker makes local startup and state repeatable; it does **not** turn this into a production Temporal deployment.

Production should use an appropriate durable Temporal deployment, supervised application/worker processes, durable PostgreSQL backups, environment-specific secrets, retained logs, and infrastructure-specific monitoring.

## Next Docker slice

The next planned containerization step is the SkyCommand Temporal worker. Before moving it into Compose, SkyCommand will add Docker-specific repository paths/volume mounts and a deliberate Git authentication strategy so repository Map/Zip/Commit/Merge workflows continue to work from inside a Linux container.
