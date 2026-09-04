# SkyCommand Supervisor

SkyCommand Supervisor is the host-native lifecycle authority for the local SkyCommand Docker runtime.
It is intentionally separate from the Docker Compose project and from the Temporal-backed Host Agent.

## Why it exists

SkyCommand's generic Docker controls protect the `skycommand` Compose project from synchronous self-control.
That guardrail remains correct: the API should not issue a blocking Docker command that removes the API while
its own request is still in flight.

The Supervisor creates a narrow self-management lane instead:

- the `web` static control shell remains running;
- runtime services (`postgres`, `temporal`, `temporal-worker`, `node-worker`, `api`) can be started, stopped, or restarted;
- the Supervisor survives those actions because it runs directly on the Windows host;
- the Supervisor does not depend on Temporal or PostgreSQL;
- only runtime lifecycle actions are implemented; arbitrary Docker commands and destructive cleanup are not exposed.

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

`START` accepts the configured local bootstrap origin plus `X-SkyCommand-Bootstrap: start`, allowing the static
login shell to wake the backend while authentication is unavailable.

Authenticated `STOP` and `RESTART` use a different lane. A user with `INFRASTRUCTURE_DOCKER_CONTROL` explicitly
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

Lifecycle grants are restricted to `STOP` and `RESTART`, expire quickly, are action-bound, carry a unique nonce,
and are rejected if replayed by the same Supervisor process.

## UI behavior

- When the backend runtime is stopped, `/login` remains available through the static `web` container and offers **Start SkyCommand**.
- The Docker Projects workspace exposes **Restart Runtime** and **Stop Runtime** for the protected SkyCommand project instead of bypassing generic self-control guardrails.
- Command Center surfaces the same authenticated controls beneath Platform Availability.
- After `STOP` or `RESTART` is accepted, the current browser session is cleared and the browser returns to `/login`. The login shell shows runtime progress and restores the ordinary login form when the backend reports online again.

## Runtime boundary

The default controlled services are:

```text
postgres, temporal, temporal-worker, node-worker, api
```

The `web` service is deliberately excluded and has no Compose dependency on `api`, preserving the localhost control shell while the runtime is offline.
