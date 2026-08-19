# SkyCommand Host Agent — Local Setup

The SkyCommand Host Agent is the narrow host-execution bridge for operations that must touch resources owned by the local machine rather than by Docker. Its first supported operation is guarded local Git synchronization after a Dockerized Development Promotion has already synchronized the authoritative remote branches.

## Boundary

```text
Docker Development Promotion
  Dev Commit
    ↓
  Human Approval
    ↓
  Remote Main → Dev Synchronization
    ↓
  local_repo_sync tool process
    ↓
  Temporal bridge workflow (skyserver-local)
    ↓
  Host activity queue (skycommand-host-local)
    ↓
Windows/host SkyCommand Host Agent
    ↓
Guarded local_repo_sync implementation
    ↓
local main = local dev = origin/main = origin/dev
```

The Host Agent is not an HTTP server and does not expose a host shell. It is an activity-only Temporal worker that polls a dedicated task queue. The allow-list currently contains `local_repo_sync` plus an internal health probe.

## Prerequisites

- The Dockerized Temporal service is running and reachable from the host at `localhost:7233`.
- The Docker PostgreSQL cutover is complete or the host `.env` otherwise points CLI processes at the active SkyCommand database.
- `DEV_LOCAL` (or the configured host-agent profile) contains valid host filesystem paths for at least one active Git repository.
- Migration `00100__host_agent_local_repository_sync.sql` has been applied to the active SkyCommand database.

## Environment

Add or confirm these values in the host `.env`:

```dotenv
SKYCOMMAND_HOST_AGENT_ENABLED=true
SKYCOMMAND_HOST_AGENT_TASK_QUEUE=skycommand-host-local
SKYCOMMAND_HOST_AGENT_PROFILE=DEV_LOCAL
SKYCOMMAND_HOST_AGENT_HEARTBEAT_INTERVAL_MS=15000
```

`SKYCOMMAND_HOST_AGENT_ENABLED` is intentionally opt-in. Docker-side `local_repo_sync` fails closed when it is false or missing.

## Start and prove the agent

Start the agent from the host repository in its own terminal:

```powershell
npm run host-agent
```

Expected startup evidence includes the Temporal address, namespace, dedicated task queue, host repository profile, available repository count, and Host Agent identity.

In a second host terminal, run the end-to-end health proof:

```powershell
npm run host-agent:check
```

This check intentionally travels through the same bridge used by workflow execution:

1. the host CLI starts `skyCommandHostAgentToolWorkflow` on the normal SkyCommand Temporal workflow queue;
2. the Docker Temporal worker executes that workflow;
3. the workflow schedules an allow-listed activity on `skycommand-host-local`;
4. the host agent answers the activity.

A passing check proves both the Docker workflow worker and the host activity worker are reachable.

## Development Promotion workflow node

Migration `00101__development_promotion_host_sync_node.sql` publishes a new immutable **Development Promotion** version that inserts **Local Repository Sync** immediately after remote **Repo Merge / Sync** and before the final Summary node. Historical published versions are retained as retired snapshots so older workflow runs keep their original graph. The migration fails closed if an editable draft exists rather than publishing or discarding unreviewed workflow changes.

The canonical node parameters are:

```text
Repository
{{ params.repoName }}

Expected Local Dev SHA
{{ nodes.dev_commit_node.output.currentHeadSha }}

Expected Synchronized Head SHA
{{ nodes.merge_sync_node.output.synchronizedHeadSha }}
```

The required values are the Dev Commit `currentHeadSha` and Remote Merge `synchronizedHeadSha`; do not replace them with a freshly queried SHA because the safety contract intentionally verifies the exact workflow evidence. The migration targets the canonical Development Promotion node keys `dev_commit_node`, `merge_sync_node`, and `dev_promotion_summary`. For a different workflow, add the same tool through Manage Workflows and bind the equivalent node outputs explicitly.

The resulting flow is:

```text
Repository Map
→ Repository ZIP
→ Dev Commit
→ Merge Approval
→ Repo Merge / Sync
→ Local Repository Sync
→ Development Promotion Summary
```

When Local Repository Sync succeeds, the workflow summary reports full `PROMOTED` state and four-way synchronization evidence instead of stopping at `REMOTE_PROMOTED`. After applying the migration, run `npm run development-promotion:host-sync:check` before the first live promotion proof.

## Guardrails retained

The Host Agent does not weaken the existing Git policy. `local_repo_sync` still:

- refuses Docker-local direct mutation;
- requires a clean working tree;
- refuses an in-progress merge/rebase/cherry-pick or Git lock;
- protects branches checked out in another worktree;
- verifies local `dev` still matches the trusted Dev Commit baseline (or is already at the approved target);
- verifies `origin/main` and `origin/dev` both equal the exact approved synchronized head;
- fetches and re-verifies remote state before mutation;
- requires fast-forward ancestry for local `main` and `dev`;
- uses compare-and-swap ref updates or `git merge --ff-only` for the checked-out branch;
- performs a final four-way equality proof.

Any mismatch fails closed and no blind reset, clean, forced checkout, or arbitrary ref rewrite is performed.

## Operational notes

The Host Agent is deliberately outside `docker compose`. Restarting or rebuilding the Docker stack does not install a host process. Start the Host Agent after the Docker Temporal service is available. If Temporal is unavailable for a prolonged period or the Host Agent exits, restart it with `npm run host-agent` and re-run `npm run host-agent:check` before Development Promotion.

The Host Agent writes its liveness into `worker.temporal_worker_heartbeats` with role metadata `HOST_AGENT`, so the control plane can distinguish it from the Docker Temporal worker while retaining one worker-health model.
