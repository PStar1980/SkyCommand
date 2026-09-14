# Phase 0 schema and relationship specification

Status: design artifact only; no Phase 0 SQL is applied.

## Relationship decisions

The future Agent domain belongs in the existing `core`, `auth`, and `worker` schemas. The current repository already owns repository/path records in `core.repositories` and `core.repository_paths`, so Projects will reference those records rather than create a second repository registry. Existing workflow approval records remain valid; standalone Agent interactions require a later generalized table because `worker.workflow_approval_requests` is tied to workflow/run-node foreign keys.

The planned additive groups are:

| Group                                                                      | Later-phase responsibility                         | Phase 0 disposition                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `core.projects`, memberships, repository/workspace bindings                | Security and workspace boundary                    | Relationship specified; no tables added                |
| `core.agent_runtimes`, installations, accounts                             | Provider-neutral runtime/account registry          | Relationship specified; no provider credentials stored |
| `core.agent_definitions`, versions, capability profiles                    | Immutable Agent revision and policy inputs         | Relationship specified; no executable seed             |
| `auth.execution_principals`, grants                                        | Server-derived principal and short-lived run grant | Contract documented; no authentication change          |
| `worker.execution_scopes`, links, sessions, cells, runs, turns             | Durable lineage and execution evidence             | Relationship specified; no runtime state               |
| Events, usage/quota observations, artifacts, results, interactions, outbox | Truthful evidence and durable commands             | Contract/fixture only                                  |
| Scheduler extensions                                                       | Unique Agent occurrence claims                     | Existing scheduler unchanged                           |

Required invariants are relational or transactional in later phases: one active Run lease per Session, one mutable workspace writer, same Project/root checks on lineage, immutable admitted snapshots, unique idempotency and source-event keys, and additive upgrade ledgers with checksums. Definitions referenced by execution must not be hard-deleted.

## Upgrade procedure

The current `packages/db_build/src/db_build.js` is a clean-build utility that drops and recreates a named database. It is not an in-place upgrade mechanism. Later work must reserve globally unique numeric ordinals across both `packages/db_build/src/migrations` and `packages/db_build/src/seeds`, establish an applied-change ledger, baseline existing installations by verified inspection, and test additive/resumable application on a restored copy. Phase 0 does not alter historical SQL or invoke `db:build`.

## Contract-to-table boundary

JSON contracts in `packages/agents/contracts/` deliberately do not encode SQL table names, provider columns, or executable defaults. Database design may reference the contract identifiers and digests, but later services must validate and persist server-derived identity, authority, lineage, and evidence separately from provider conversation identifiers.
