# SkyCommand Supervisor

SkyCommand Supervisor is the host-native lifecycle authority for the local SkyCommand Docker runtime.
It is intentionally separate from the Docker Compose project and from the Temporal-backed Host Agent.

## Why it exists

SkyCommand's generic Docker controls protect the `skycommand` Compose project from synchronous self-control.
That guardrail remains correct: the API should not issue a blocking command that removes the API while the
request is still in flight.

The Supervisor creates a narrow self-management lane instead:

- the `web` static control shell remains running;
- runtime services (`postgres`, `temporal`, `temporal-worker`, `node-worker`, `api`) can be started/stopped/restarted;
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

`START` accepts the configured local bootstrap origin plus the `X-SkyCommand-Bootstrap: start` header. `STOP` and
`RESTART` require `X-SkyCommand-Supervisor-Token` matching `SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN`.

## Runtime boundary

The default controlled services are:

```text
postgres, temporal, temporal-worker, node-worker, api
```

The `web` service is deliberately excluded and has no Compose dependency on `api`, preserving the localhost control shell while the runtime is offline.
