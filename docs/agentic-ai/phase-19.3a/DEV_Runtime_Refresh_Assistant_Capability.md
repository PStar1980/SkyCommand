# Phase 19.3A0 — Assistant DEV Runtime Refresh

## Scope and authority

`skycommand_dev_runtime_refresh` exposes only two source-controlled profiles:

| Profile           | Signed Supervisor action  | Fixed target              | Runtime evidence                                                                                         |
| ----------------- | ------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CODEX_BOOTSTRAP` | `REBUILD_CODEX_BOOTSTRAP` | `codex-managed-bootstrap` | Supervisor operation plus the registered Codex bootstrap service set; the volume initializer is one-shot |
| `TEMPORAL_WORKER` | `REBUILD_TEMPORAL_WORKER` | `temporal-worker`         | Supervisor operation, Temporal heartbeat, and poller identity                                            |

The start and status routes are `/api/assistant/runtime-refresh/runs` and `/api/assistant/runtime-refresh/runs/{operationId}`. Start accepts only `profileCode` and `idempotencyKey`. Repository, DEV environment, lifecycle profile, Supervisor route/action, target, service set, and evidence rules come from the server registry. No direct Docker, Compose, command, path, or URL input is accepted.

The existing `DEV_RUNTIME_LIFECYCLE` permission is available only when both the trusted Assistant identity is pinned by `SKYCOMMAND_ASSISTANT_AGENT_ID=codex-local` and `SKYCOMMAND_ASSISTANT_PERMISSION_CODES` explicitly contains `DEV_RUNTIME_LIFECYCLE`. The identity pin alone does not grant it, it is not in the default permission set, and the caller cannot select the pinned identity through a header. The DEV environment-reconciliation allowlist accepts the permission code as an explicit opt-in. The existing `WORKFLOW_RUN`-protected `/orchestrator-refresh` contract remains intact.

## Durable operation and grant handling

Migration `00160__assistant_dev_runtime_refresh_operations.sql` adds a provider-neutral operation ledger separate from managed-Codex lifecycle and enrollment records. Rows bind principal and bounded Agent identifier, idempotency key, server-computed request digest, profile/action/environment, operation status, Supervisor operation UUID, timestamps, and bounded before/after evidence. The current API still authorizes this capability only for `codex-local`; the generic ledger schema does not encode that provider-specific policy.

For a principal and key, the same canonical profile reuses and safely reconciles the existing operation; a different profile/digest conflicts. The API issues a short-lived signed grant bound to the durable operation UUID and posts only to the registered Supervisor route. Grant bytes are transient and are never returned or stored. Ambiguous dispatch remains `UNKNOWN`; it is reconciled under the same operation identity and is never silently redispatched. Neither runtime refresh profile reads nor updates managed-Codex lifecycle or enrollment tables.

## Activation boundary

This implementation turn does not apply the migration or dispatch a refresh. Once separately approved, activation requires:

1. Apply only migration `00160` through the registered DEV database-upgrade capability.
2. Through the registered DEV environment-reconciliation capability, explicitly pin `SKYCOMMAND_ASSISTANT_AGENT_ID=codex-local` and add `DEV_RUNTIME_LIFECYCLE` to `SKYCOMMAND_ASSISTANT_PERMISSION_CODES`. Preserve all existing permission codes; this permission is not a default.
3. Use the existing signed Host Supervisor `REBUILD_CODEX_BOOTSTRAP` infrastructure action once to load the reviewed API and profile registry. This is not managed-Codex lifecycle attempt 2, but its fixed action also reconciles the registered Codex bootstrap service set; keep the Codex `0.154.0` deployment paused until separately authorized.
4. Discover the capability from `/api/assistant/capabilities`, then start/read operations through the Assistant routes only.
