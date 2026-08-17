# SkyCommand Temporal Local Setup

## Purpose

This document is the current local development guide for SkyCommand's Temporal workflow lane. The Temporal development service runs in Docker, and SkyCommand now also provides a Dockerized Temporal worker foundation. The host worker remains available as a compatibility fallback while container Git authentication is finalized.

The Docker worker uses the `DOCKER_LOCAL` repository profile, mounts the host SkyEco workspace at `/workspace/SkyEco System`, reaches host PostgreSQL through `host.docker.internal`, and translates repository artifact paths plus localhost API calls across the container boundary. Git-changing tools are deliberately disabled in the Docker worker until credentials are configured.

## Prerequisites

- Docker Desktop running with Docker Compose available.
- SkyCommand dependencies installed for the host-run API/Admin-Web and fallback workers.
- PostgreSQL available using the normal SkyCommand `.env` configuration and reachable from Docker Desktop.
- Migration `00098__docker_local_repository_profile.sql` applied before starting the Docker worker.

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
SKYCOMMAND_DOCKER_WORKSPACE_ROOT=C:/Users/your-user/Dropbox/Programming/SkyEco System
SKYCOMMAND_DOCKER_GIT_ENABLED=false
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

Then run the remaining SkyCommand processes. Keep the API and Admin-Web on the host for this slice, and start the Temporal worker in Docker:

```bash
# SkyCommand API
npm run api

# Dockerized SkyCommand Temporal worker
npm run temporal:worker:docker:up

# Admin-Web
npm run web

# Optional: classic SkyCommand worker daemon for schedules/listeners
npm run worker:dev
```

The host worker remains available as a fallback with `npm run temporal:worker:dev`. Do not run the host and Docker SkyCommand Temporal workers against the same task queue during normal proof runs unless you intentionally want multiple pollers.

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

# Build/start the Docker worker
npm run temporal:worker:docker:up

# Worker status/logs
npm run temporal:worker:docker:status
npm run temporal:worker:docker:logs

# Start the service + worker together
npm run temporal:stack:up
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

## Docker worker repository profile

Migration `00098__docker_local_repository_profile.sql` creates `DOCKER_LOCAL` and derives container paths from active `DEV_LOCAL` repository paths. For example:

```text
DEV_LOCAL    C:\Users\...\SkyEco System\SkyCommand System\SkyCommand
DOCKER_LOCAL /workspace/SkyEco System/SkyCommand System/SkyCommand
```

The worker image executes SkyCommand-owned tool implementations from `/app`, so its Node dependencies are Linux-native and immutable. Repository parameters still resolve to the mounted host working trees through `DOCKER_LOCAL`, allowing Map/Zip and future Git operations to act on the real local repositories rather than a copied image workspace.

Repository Map/Zip output paths are stored globally today and may still contain Windows paths. The runtime path translator maps any path beneath the SkyEco workspace into `/workspace/SkyEco System` when `DOCKER_LOCAL` is active.

Tool stdout/stderr produced by the Docker worker is written into the mounted SkyCommand `logs/script-executions` directory, while the database stores portable relative paths. This keeps Tool Operations output readable from the host API even though execution occurred inside Linux.

### Current Git boundary

`Repository Intelligence`, `Dev Commit`, and `Main Merge` fail closed inside the Docker worker while `SKYCOMMAND_DOCKER_GIT_ENABLED=false`. This is intentional: Windows Git Credential Manager credentials are not automatically inherited by a Linux container. Keep Development Promotion on the host worker until the next slice configures explicit container Git authentication.

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
| Workflow starts but does not progress | Temporal worker is not running or task queue mismatch | Run `npm run temporal:worker:docker:status` / logs and confirm `TEMPORAL_TASK_QUEUE=skyserver-local` |
| Docker worker exits during startup | `DOCKER_LOCAL` is missing or the SkyEco bind mount is wrong | Apply migration `00098`, set `SKYCOMMAND_DOCKER_WORKSPACE_ROOT`, then restart the worker |
| Docker worker cannot reach PostgreSQL | Host PostgreSQL is not reachable through Docker Desktop | Verify `host.docker.internal:5432`, PostgreSQL listen settings, and local firewall/pg_hba configuration |
| Development Promotion fails at a Git node | Docker Git credentials are intentionally disabled | Use the host worker for Git workflows until container Git authentication is configured |
| Temporal log shows `unable to open database file ... (14)` | The named volume is not writable by the Temporal CLI user | Use the current Compose file; `temporal-volume-init` repairs ownership before server startup. Run `docker compose down`, then `npm run temporal:server:up`. |
| Host Temporal worker reports `ECONNREFUSED 127.0.0.1:7233` | The Docker Temporal service did not become healthy | Fix/start the Temporal service first; the host worker will connect once `localhost:7233` is listening. |
| Command Center shows Temporal service offline | Docker service is stopped/unhealthy or `.env` points elsewhere | Run `npm run temporal:server:status`, then `npm run temporal:health` |
| Worker Health shows no heartbeat | Temporal worker is offline or cannot write to PostgreSQL | Restart `npm run temporal:worker:dev` and check PostgreSQL environment values |
| Approval does not resume workflow | Pending approval was deleted or the Temporal execution is gone | Use Workflow Operations run controls to terminate/clean up and retry fresh |

## Production boundary

The Dockerized service still uses Temporal's `server start-dev` development runtime. Docker makes local startup and state repeatable; it does **not** turn this into a production Temporal deployment.

Production should use an appropriate durable Temporal deployment, supervised application/worker processes, durable PostgreSQL backups, environment-specific secrets, retained logs, and infrastructure-specific monitoring.

## Next Docker slice

The next focused slice is **container Git authentication**. Once GitHub credentials are available to the Linux worker without embedding secrets in the image or repository, `SKYCOMMAND_DOCKER_GIT_ENABLED` can be enabled and Development Promotion can move fully from the host worker into Docker.
