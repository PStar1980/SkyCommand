# SkyCommand API Docker Local Setup

The SkyCommand API can run in Docker while Admin-Web remains on the Windows host under Vite and PostgreSQL remains on the Windows host. The browser continues to use the existing Vite proxy to `http://localhost:7171`, so moving the API does not change the Admin-Web URL or its API route contract.

## Runtime boundary

```text
Windows host
  Admin-Web / Vite        localhost:15171
  PostgreSQL              localhost:5432

Docker Compose
  SkyCommand API          127.0.0.1:7171 -> container:7171
  Node worker
  Temporal worker
  Temporal service        127.0.0.1:7233 / 127.0.0.1:8600
```

Inside Docker, the API uses:

- PostgreSQL through `host.docker.internal:5432`;
- Temporal through the Compose service name `temporal:7233`;
- the `DOCKER_LOCAL` repository profile;
- `/app` for built-in SkyCommand tool scripts;
- `/workspace/SkyEco System` for live repository working trees and generated artifacts;
- the shared `logs/script-executions` directory on the mounted SkyCommand repository for Tool Operations output;
- the same runtime GitHub PAT secret and Git author identity already used by the Docker workers.

The API container is intentionally configured with `SERVE_ADMIN_WEB=false` during local development. Vite remains host-run for fast frontend iteration.

## Prerequisites

Before starting the Docker API:

1. Docker Desktop is running.
2. Migration `00098__docker_local_repository_profile.sql` has already been applied.
3. `SKYCOMMAND_DOCKER_WORKSPACE_ROOT` points at the host `SkyEco System` folder.
4. If Docker Git automation is enabled, the existing GitHub secret, username, and Git author identity are configured.
5. Stop the host API process (`npm run api`) so host port `7171` is free.

## Start and inspect

```powershell
npm run api:docker:up
npm run api:docker:status
npm run api:docker:logs
```

The container should report Docker preflight information before listening:

```text
[SkyCommand API] dockerProfile=DOCKER_LOCAL
[SkyCommand API] dockerSkyCommandRoot=/workspace/SkyEco System/SkyCommand System/SkyCommand
[SkyCommand API] dockerGitSafeDirectories=<count>
[SkyCommand API] dockerExecutionLogRoot=/workspace/SkyEco System/SkyCommand System/SkyCommand/logs/script-executions
[SkyCommand API] dockerGit=enabled|disabled
[SkyCommand API] Listening on port 7171
```

## Health proof

With the host API stopped and the Docker API running, verify:

```text
http://localhost:7171/_health
http://localhost:7171/_db/health
```

Then open Admin-Web normally and prove:

1. login/session behavior;
2. Command Center refresh and all service cards;
3. a harmless direct Node tool such as Database Health Check;
4. Tool Operations output from both API-executed and worker-executed tools;
5. one Temporal-backed workflow started from Admin-Web.

The Docker API fails closed for PowerShell/pwsh tool runtimes. Those tools require a compatible host API until they are migrated to a cross-platform runtime.

## Git credential proof

If Git-changing tools are enabled in the API container:

```powershell
npm run api:docker:git:check
```

This reuses the layered GitHub API/read/dry-run-push diagnostic already proven by the Docker Temporal and Node workers.

## Operations

```powershell
npm run api:docker:restart
npm run api:docker:stop
npm run backend:stack:up
npm run backend:stack:stop
```

`backend:stack:up` builds/starts the Docker API, Node worker, Temporal worker, and Temporal service together. PostgreSQL and Vite remain host-run in this stage of containerization.
