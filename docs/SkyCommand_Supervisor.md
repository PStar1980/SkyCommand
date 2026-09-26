# SkyCommand Supervisor

SkyCommand Supervisor is the host-native lifecycle authority for the local SkyCommand Docker runtime.
It is intentionally separate from the Docker Compose project and from the Temporal-backed Host Agent.

## Why it exists

SkyCommand's generic Docker controls protect the `skycommand` Compose project from synchronous self-control.
That guardrail remains correct: the API should not issue a blocking Docker command that removes the API while
its own request is still in flight.

The Supervisor creates a narrow self-management lane instead:

- the `web` static control shell remains running;
- source-controlled runtime services can be started, stopped, or restarted, including the fake Agent Runtime Worker and isolated Codex services;
- the Supervisor survives those actions because it runs directly on the Windows host;
- the Supervisor does not depend on Temporal or PostgreSQL;
- only bounded SkyCommand lifecycle actions are implemented; arbitrary Docker commands and destructive cleanup are not exposed;
- the `web` control shell can be rebuilt in place from the current local source without stopping the backend runtime;
- the API and worker containers can be rebuilt and force-recreated without cycling PostgreSQL, the Temporal server, the web shell, or the Supervisor.

## Local commands

```powershell
npm run supervisor:auto-start:install
npm run supervisor:auto-start:status
npm run supervisor:check
npm run supervisor:auto-start:stop
npm run supervisor:auto-start:start
```

The scheduled task uses the same hidden GUI-launcher pattern as the Host Agent, so no persistent console window is required.

## HTTP surface

Default endpoint: `http://127.0.0.1:17170`

- `GET /health`
- `GET /runtime/status`
- `POST /runtime/start`
- `POST /runtime/stop`
- `POST /runtime/restart`
- `POST /runtime/rebuild-web`
- `POST /runtime/rebuild-backend`
- `POST /runtime/rebuild-codex-bootstrap`

`START` accepts the configured local bootstrap origin plus `X-SkyCommand-Bootstrap: start`, allowing the static
login shell to wake the backend while authentication is unavailable.

Authenticated `STOP`, `RESTART`, `REBUILD_WEB`, and `REBUILD_BACKEND` use a different lane. A user with `INFRASTRUCTURE_DOCKER_CONTROL` explicitly
confirms the action through the API. The API records the authorization audit event and returns a short-lived,
one-time HMAC-signed lifecycle grant. The browser hands only that grant to the localhost Supervisor using
`X-SkyCommand-Supervisor-Grant`; the signing secret never enters browser code or storage.

The optional `SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN` remains available as a local break-glass control path.

## Lifecycle grant configuration

Set a long random local secret in `.env` and restart both the Supervisor and API:

```text
SKYCOMMAND_SUPERVISOR_GRANT_SECRET=<long-random-local-secret>
SKYCOMMAND_SUPERVISOR_GRANT_TTL_SECONDS=45
```

For compatibility, grant signing falls back to `SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN` when the dedicated grant
secret is blank. A dedicated grant secret is preferred.

Lifecycle grants are restricted to `STOP`, `RESTART`, `REBUILD_WEB`, `REBUILD_BACKEND`, and `REBUILD_CODEX_BOOTSTRAP`, expire quickly, are action-bound, carry a unique nonce,
and are rejected if replayed by the same Supervisor process.

## UI behavior

- When the backend runtime is stopped, `/login` remains available through the static `web` container and offers **Start SkyCommand**.
- The Docker Projects workspace exposes **Rebuild Frontend**, **Rebuild Backend**, **Restart Runtime**, and **Stop Runtime** for the protected SkyCommand project instead of bypassing generic self-control guardrails.
- Command Center surfaces the same authenticated controls beneath Platform Availability.
- **Rebuild Frontend** runs the Supervisor-owned equivalent of `docker compose up -d --build web`, waits for the Supervisor operation to finish, and reloads the browser into the newly built static shell while leaving the backend runtime online.
- **Rebuild Backend** runs the fixed source-controlled backend rebuild inventory, including API, workflow workers, fake Agent Runtime Worker, and Codex network/runtime services; PostgreSQL, the Temporal server, the web shell, and the Supervisor stay online.
- After `STOP` or `RESTART` is accepted, the current browser session is cleared and the browser returns to `/login`. The login shell shows runtime progress and restores the ordinary login form when the backend reports online again.

## Runtime boundary

The controlled runtime inventory is source-controlled in `packages/supervisor/src/config.js`:

```text
postgres, temporal, temporal-worker, browser-worker, node-worker,
agent-runtime-worker, codex-egress-proxy, codex-mcp-gateway,
codex-agent-runtime-worker, codex-control-bridge, api
```

The `web` service is deliberately excluded from backend stop/restart and has no Compose dependency on `api`, preserving the localhost control shell while the runtime is offline. It is controlled separately by the bounded `REBUILD_WEB` action when an authenticated operator requests a frontend rebuild.

The source-controlled backend rebuild target is:

```text
api, temporal-worker, browser-worker, node-worker, agent-runtime-worker,
codex-egress-proxy, codex-mcp-gateway, codex-agent-runtime-worker,
codex-control-bridge
```

The Codex bootstrap rebuild target is separately fixed to:

```text
api, codex-managed-volume-init, codex-egress-proxy, codex-mcp-gateway,
codex-agent-runtime-worker, codex-control-bridge
```

The managed-Codex Assistant/API lifecycle invokes this fixed Supervisor action;
callers cannot supply or alter its service list.

The managed-Codex control path keeps its network roles separate: the API joins
its default network and `codex_api_control`; the bridge joins
`codex_api_control` and `codex_runtime_control`, binds only the locally assigned
IPv4 resolved from its API-control alias, and listens on internal port `4220`.
The API-control alias is scoped only to `codex_api_control`. Bridge-to-worker
traffic uses the worker's runtime-control alias on `codex_runtime_control`;
the API is not attached to that network or the MCP/provider-internal networks.

`SKYCOMMAND_SUPERVISOR_RUNTIME_SERVICES` and
`SKYCOMMAND_SUPERVISOR_BACKEND_REBUILD_SERVICES` are legacy compatibility inputs,
not configurable allowlists. A supplied value is accepted only when it exactly
matches the corresponding canonical service set; otherwise the Supervisor logs
that it is ignored and uses the source-controlled inventory. Even a matching value
cannot broaden or suppress that inventory. The `web` shell and one-shot volume-init
service remain outside the general runtime inventory.
