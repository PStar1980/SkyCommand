# SkyCommand Admin-Web Docker Local Setup

SkyCommand supports two intentional Admin-Web modes:

```text
Development mode
  Windows host Vite       localhost:5171
  Docker API              localhost:7171

Docker/deployment mode
  Docker NGINX Web        localhost:5171
        -> Compose API    api:7171
```

The development mode keeps Vite hot module replacement and normal host filesystem behavior. The Docker/deployment mode builds the Vite production bundle into an immutable image and serves it from an unprivileged NGINX container. Browser API calls remain same-origin (`/api`, `/_health`, and `/_db`) and NGINX proxies those routes across the Compose network to the API service.

## Runtime boundary

```text
Windows host
  PostgreSQL                         localhost:5432

Docker Compose
  Admin-Web / NGINX   127.0.0.1:5171 -> container:8080
          |
          +----------> API            api:7171
                        |
                        +-----------> PostgreSQL via host.docker.internal:5432
                        +-----------> Temporal via temporal:7233

  Node worker
  Temporal worker
  Temporal service
```

The Web container does not need the SkyEco workspace mount, PostgreSQL credentials, Temporal credentials, or the GitHub PAT. Those remain server-side concerns. The static browser bundle is built with an empty `VITE_API_BASE_URL`, so API traffic stays same-origin and is routed by NGINX instead of baking a host-specific API address into the JavaScript bundle.

## Web image design

The Web image uses three bounded stages:

1. a compact Node 20 dependency stage containing only the Admin-Web build dependencies;
2. a Vite production build stage;
3. a pinned unprivileged NGINX runtime containing only the generated `dist` assets and NGINX configuration.

The runtime container:

- listens internally on port `8080`;
- runs unprivileged;
- uses a read-only root filesystem plus `/tmp` tmpfs;
- drops Linux capabilities and enables `no-new-privileges`;
- exposes `/healthz` for container health checking;
- dynamically resolves the Compose API service through Docker DNS;
- preserves long API/tool execution windows while proxying;
- sends immutable caching headers for Vite fingerprinted `/assets/*` files;
- sends `no-store` for `index.html` so new deployments are picked up immediately;
- falls back to `index.html` for React `BrowserRouter` routes.

## Prerequisites

Before starting Docker Web:

1. Docker Desktop is running.
2. The Docker API is healthy, or it can be started as a dependency by Compose.
3. Stop the host `npm run web` Vite process so host port `5171` is available.
4. If a different host port is desired, set `SKYCOMMAND_WEB_PORT` in `.env`.

No database migration, workspace mount, or additional secret is required for this Web slice.

## Start and inspect

```powershell
npm run web:docker:up
npm run web:docker:status
npm run web:docker:logs
```

Open:

```text
http://localhost:5171
```

The Web container health endpoint is available at:

```text
http://localhost:5171/healthz
```

The API remains reachable directly for diagnostics at:

```text
http://localhost:7171/_health
http://localhost:7171/_db/health
```

## Application proof

With the host Vite process stopped and Docker Web running, prove the following through `http://localhost:5171`:

1. the login page and session flow;
2. direct navigation/refresh on a nested React route such as `/workflows/history`;
3. Command Center refresh and all service cards;
4. Database Health Check through Run Tools;
5. Tool Operations output;
6. a Temporal-backed workflow;
7. a hard browser refresh on both a public/login route and a protected nested route.

The nested-route refresh checks are important because they prove NGINX SPA fallback behavior rather than only proving the root page.

## Full SkyCommand Docker runtime

Once the individual Web proof is green, the five application/runtime containers can be started together:

```powershell
npm run skycommand:docker:up
npm run skycommand:docker:status
```

This starts/builds:

```text
web
api
node-worker
temporal-worker
temporal
```

Stop them without deleting the persistent Temporal volume:

```powershell
npm run skycommand:docker:stop
```

Follow the combined logs when needed:

```powershell
npm run skycommand:docker:logs
```

PostgreSQL intentionally remains on the host in this stage. Its move to Docker is a separate stateful migration with backup, restore, persistence, cross-application connectivity, and recovery proof rather than a simple process relocation.

## Development fallback

To return to frontend development mode:

```powershell
npm run web:docker:stop
npm run web
```

Both modes use the same browser URL by default (`http://localhost:5171`) and the same relative API route contract, so switching between host Vite and Docker NGINX does not require application-code changes.
