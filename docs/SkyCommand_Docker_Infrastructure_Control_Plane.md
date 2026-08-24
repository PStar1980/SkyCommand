# SkyCommand Docker Infrastructure Control Plane

## Purpose

Phase 17 turns Docker from an external prerequisite into a guarded SkyCommand infrastructure provider. The integration is intentionally split into two lanes:

- **Durable control plane** — operator actions use authenticated API routes, permission checks, live resource revalidation, Temporal dispatch, the host-native SkyCommand Host Agent, and durable Docker Operations audit evidence.
- **Live observability plane** — native Docker events and bounded resource samples flow from the Host Agent to localhost-only API ingress and authenticated Server-Sent Events (SSE) streams without creating Temporal workflow history or persistent telemetry rows.

This separation keeps lifecycle actions durable and auditable while allowing high-frequency operational signals to remain lightweight.

## Runtime boundary

```text
Admin-Web
   |
   | authenticated API + SSE
   v
SkyCommand API
   |                         ^
   | durable control         | event/telemetry relay
   v                         |
Temporal                 Host Agent
   |                         ^
   | allow-listed activity   |
   +------------------------>|
                             |
                             v
                        Docker Engine
```

The Docker daemon is never mounted into the SkyCommand API or Admin-Web containers. Admin-Web never submits raw Docker CLI arguments, Compose file paths, shell commands, or Docker socket requests.

The Host Agent remains host-native because it owns operations that require Windows-host context. It exposes no inbound HTTP listener and no arbitrary shell endpoint. Docker access is implemented as explicit, allow-listed operations.

## Infrastructure model

Phase 17 establishes provider-neutral concepts that can later be reused by a Kubernetes sibling provider:

```text
Infrastructure Target
    -> Provider
        -> Workload / Project
            -> Runtime resource
```

For Docker today:

- **Target** — the local host reached through the Host Agent transport.
- **Provider** — Docker Engine.
- **Workload** — Docker Compose project.
- **Runtime resources** — containers, images, volumes, and networks.

Admin-Web consumes normalized provider contracts rather than raw Docker payloads.

## Docker surfaces

### Docker dashboard

Canonical Admin-Web route: `/dashboard/docker` (`/docker/overview` remains a compatibility redirect).

Provides:

- Host Agent target status and Docker Engine/provider status.
- Compose project, container, image, volume, and network counts.
- Native Docker lifecycle/health event stream.
- Live CPU, memory, network I/O, block I/O, and PID telemetry.
- Current resource leaders.
- Last-known telemetry preservation when the live source becomes stale or unavailable.

### Compose Projects

Provides:

- Project inventory, state, service/container counts, and health.
- Guarded `START`, `STOP`, and `RESTART` for eligible external projects.
- Project Details workspace combining inventory, live project telemetry, runtime members, and recent native Docker activity.
- Explicit self-management protection for the `skycommand` control-plane project.

### Containers

Provides:

- Normalized container identity and runtime metadata.
- Bounded recent logs.
- State-aware `START`, `STOP`, `RESTART`, `PAUSE`, and `UNPAUSE` for eligible external containers.
- SkyCommand container self-protection.
- Environment-variable redaction and no raw inspect payload exposure.

### Images

Provides:

- Image identity, tags/digests, size/platform metadata, labels, and container usage.
- Guarded removal of an unused image reference only after both API-side and Host Agent live-usage checks.
- No force removal and no global prune operation.

### Storage

Provides:

- A dedicated searchable/filterable volume inventory with 10-row pagination and selected-row detail workspace.
- Volume identity, Compose ownership, mount metadata, and container attachment intelligence.
- Persistent volumes are permanently **data protected** in the SkyCommand UI; volume deletion is intentionally not exposed.

### Networks

Provides:

- A dedicated searchable/filterable network inventory with 10-row pagination and selected-row detail workspace.
- Network driver/scope/IPAM metadata, project ownership, and endpoint relationships.
- Docker built-in `bridge`, `host`, and `none` networks are system protected.
- Only unused non-system networks are eligible for guarded removal.

### Docker Operations

Provides durable audit evidence for SkyCommand-issued infrastructure writes. It is distinct from the native Docker Event Stream.

- **Docker Operations** answers: *What did SkyCommand ask Docker to do, who asked, and what happened?*
- **Docker Event Stream** answers: *What did Docker itself report happening?*

Native changes made through Docker Desktop or another client can therefore appear in the event stream without being misrepresented as SkyCommand-issued audit operations.

## Permission boundaries

| Permission | Default role coverage | Capability |
| --- | --- | --- |
| `INFRASTRUCTURE_DOCKER_READ` | Docker-reading roles configured by migration | Inventory, details, logs, live events, telemetry, and Docker Operations read access |
| `INFRASTRUCTURE_DOCKER_CONTROL` | `ADMIN`, `SUPER_ADMIN` | Compose and container lifecycle actions |
| `INFRASTRUCTURE_DOCKER_CLEANUP` | `SUPER_ADMIN` only by default | Guarded unused image/network removal |

Cleanup is deliberately separate from ordinary lifecycle control. Volume deletion is not available under any Phase 17 permission.

## Protection model

Phase 17 deliberately avoids generic Docker administration primitives.

SkyCommand does **not** expose:

- `docker exec` or attach.
- A browser-accessible shell.
- Arbitrary Docker arguments.
- Docker socket access from Admin-Web/API.
- Force image/network removal.
- Global prune commands.
- Persistent-volume deletion.
- Synchronous stop/restart/pause controls for SkyCommand's own Compose project or containers.

Write operations are resolved against live provider inventory before dispatch and are validated again at the Host Agent boundary immediately before Docker execution where appropriate.

## Sensitive-data normalization

Normalized Docker contracts deliberately omit or redact data that can contain secrets:

- Container environment variables are never returned to Admin-Web.
- Raw `docker inspect` payloads are never returned to Admin-Web.
- Arbitrary non-standard label values are redacted unless explicitly needed for safe Compose/OCI identity.
- Volume-driver option values are redacted.
- Live events are reduced to an allow-listed lifecycle/health contract rather than relaying raw Docker attributes.

## Failure-state model

Phase 17.9 distinguishes transport availability from provider availability instead of collapsing both into one generic offline state.

| Condition | Target / Host Agent | Docker provider | Live lanes | UI behavior |
| --- | --- | --- | --- | --- |
| Healthy | `ONLINE` | `ONLINE` | `LIVE` | Current inventory and telemetry shown |
| Host Agent unavailable/stale | `STALE`, `OFFLINE`, or `UNKNOWN` | unavailable/unknown | eventually `STALE` | Controls fail closed; last live evidence remains visible where available |
| Host Agent online, Docker command/provider unavailable | `ONLINE` | `OFFLINE` | `ERROR`/`DEGRADED` | Failure domain identifies Docker provider; retry messaging is explicit |
| Host Agent dispatch/transport failure | `DEGRADED` | `OFFLINE` | may degrade independently | Failure domain identifies Host Agent transport |
| Browser SSE disconnected | inventory lane unaffected | unchanged | browser `DISCONNECTED` | SSE reconnects independently; polling/control paths remain separate |
| Event/telemetry source stale | target may still be reachable | may be degraded | `STALE`/`DEGRADED` | Last-known samples/events remain visible and are explicitly marked historical/stale |

A fully stopped local Docker Desktop also stops the Dockerized SkyCommand API/Web runtime itself, so the provider-vs-transport distinction is most useful during host-run development, provider command failures, remote-target evolution, and future multi-target/Kubernetes operation. The contract is intentionally correct even where a local single-host Docker outage takes the current UI down with the provider.

## Live observability behavior

### Native events

The Host Agent observes useful Docker lifecycle/health actions and filters noisy `exec_*` health-check process chatter. Events are normalized and relayed to an in-memory API buffer, then delivered through authenticated SSE.

The buffer is bounded and ephemeral. It is operational evidence, not a replacement for the Docker Operations audit ledger.

### Resource telemetry

The Host Agent samples `docker stats --no-stream` on a bounded cadence and caches container metadata so every sample does not require a full inspect pass. The API derives per-second network/block-I/O rates from successive cumulative counters.

Admin-Web keeps ECharts instances mounted and applies live data through `setOption`, avoiding full chart remounts during normal data updates.

If the source becomes stale or unavailable, historical samples remain visible with an explicit warning so an old value cannot be mistaken for a live zero.

## Recovery and diagnostics

Useful local commands:

```powershell
npm run skycommand:docker:status
npm run host-agent:auto-start:status
npm run host-agent:check
npm run docker-integration:self-test
npm run validate
```

If the Host Agent is the suspected failure domain, inspect the scheduled-task log configured by the Host Agent automatic-start helper. Restart only the host-native agent when the Dockerized control plane remains healthy:

```powershell
npm run host-agent:auto-start:stop
npm run host-agent:auto-start:start
npm run host-agent:auto-start:status
npm run host-agent:check
```

If source/image changes require the Dockerized control plane to be rebuilt:

```powershell
npm run skycommand:docker:restart
```

The canonical Docker Admin-Web host port is `15171`. The Docker Web helper performs a Windows excluded-port preflight so a reserved host port fails with an actionable message before Compose startup.

## Consolidated Phase 17 validation

Run:

```powershell
npm run docker-integration:self-test
```

The consolidated suite covers the Host Agent boundary, Docker inventory, Compose lifecycle, container inspection/control, image/volume/network resource contracts, event and telemetry bridges, API SSE hubs, infrastructure/audit contracts, Admin-Web permissions/surfaces, API telemetry exclusions, in-place ECharts updates, and Docker/NGINX deployment behavior.

`npm run validate` invokes this consolidated Docker proof as part of routine repository validation rather than duplicating the individual Docker tests throughout the validation list.

## Kubernetes extension seam

Phase 17 implements Docker only. It intentionally leaves Kubernetes as a future sibling provider rather than modelling Kubernetes as a Docker submenu.

The reusable seams are:

- infrastructure target/provider identity;
- provider-normalized workload/resource contracts;
- permission-separated read/control/cleanup behavior;
- durable command/audit path separated from live observability;
- source-health and stale-data semantics;
- control-plane self-protection.

A future Kubernetes provider can map clusters/workloads/pods/nodes/services into these concepts while using Kubernetes-native APIs and watch/metrics streams underneath. No Kubernetes runtime dependency is introduced by Phase 17.
