# Phase 0 schema and relationship specification

Status: Phase 0 design artifact refreshed after the additive Phase 19.1 registry migration. Phase 0 itself remains non-executable; Phase 19.1 adds only the bounded registry/preview tables described below.

## Relationship decisions

The future Agent domain belongs in the existing `core`, `auth`, and `worker` schemas. The current repository already owns repository/path records in `core.repositories` and `core.repository_paths`, so Projects will reference those records rather than create a second repository registry. Existing workflow approval records remain valid; standalone Agent interactions require a later generalized table because `worker.workflow_approval_requests` is tied to workflow/run-node foreign keys.

The planned additive groups and the Phase 19.1 realization boundary are:

| Group                                                                      | Later-phase responsibility                         | Phase 0 disposition                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `core.projects`, memberships, repository/workspace bindings                | Security and workspace boundary                    | `00149` adds registered projects, rights, repository bindings, and READ_ONLY workspace bindings |
| `core.agent_runtimes`, installations, accounts                             | Provider-neutral runtime/account registry          | `00149` adds safe metadata only; execution flags are constrained false and no credentials are stored |
| `core.agent_definitions`, versions, capability profiles                    | Immutable Agent revision and policy inputs         | `00149` adds definitions, immutable versions, allow rules, and capability profiles |
| `auth.execution_principals`, grants                                        | Server-derived principal and short-lived run grant | `00149` adds generic user principal identity; existing R4 workflow principals remain unchanged |
| `worker.execution_scopes`, links, sessions, cells, runs, turns             | Durable lineage and execution evidence             | Relationship specified; no runtime state               |
| Events, usage/quota observations, artifacts, results, interactions, outbox | Truthful evidence and durable commands             | Contract/fixture only                                  |
| Scheduler extensions                                                       | Unique Agent occurrence claims                     | Existing scheduler unchanged                           |

Required invariants are relational or transactional in later phases: one active Run lease per Session, one mutable workspace writer, same Project/root checks on lineage, immutable admitted snapshots, unique idempotency and source-event keys, and additive upgrade ledgers with checksums. Phase 19.1 enforces immutable definition versions, registered workspace IDs, project membership/right checks, and no execution flags. Definitions referenced by execution must not be hard-deleted.

## Upgrade procedure

The current `packages/db_build/src/db_build.js` is a clean-build utility that drops and recreates a named database. It is not an in-place upgrade mechanism. Later work must reserve globally unique numeric ordinals across both `packages/db_build/src/migrations` and `packages/db_build/src/seeds`, establish an applied-change ledger, baseline existing installations by verified inspection, and test additive/resumable application on a restored copy. Phase 0 does not alter historical SQL or invoke `db:build`.

## Contract-to-table boundary

JSON contracts in `packages/agents/contracts/` deliberately do not encode SQL table names, provider columns, or executable defaults. Phase 19.1 adds `execution_surface_policy.v1`, `agent_runtime_configuration_identity.v1`, and the amended `agent_authority_snapshot.v1`; database design may reference those contract identifiers and digests, while services validate and persist server-derived identity and authority separately from provider conversation identifiers.

Phase 19.1 explicitly does not add `worker` Agent execution-state tables, provider launch paths, Scheduler targets, Temporal Agent workflows, credential references, or managed writable workspaces.
