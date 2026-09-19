# SkyCommand database upgrade path

**Status:** Current DEV operating guidance after R7

## Scope and authority

This document describes the in-place DEV_LOCAL database-upgrade path. It does not authorize promotion, production work, clean rebuilds, or changes outside the assigned development workflow.

`npm run db:build` is the destructive clean-build utility. It drops and recreates its named database and replays the ordered migration and seed roots. Do not run it against an existing development database.

## Current normative path

Normal DEV database changes are source-controlled, globally numbered migrations or seeds under `packages/db_build/src/migrations` and `packages/db_build/src/seeds`. They are applied through the registered `dev_change_finalize` Workflow. Its database node invokes the registered `database_upgrade_apply` Tool after environment and repository preflight, then validates runtime readiness and generates the required receipts and evidence.

The finalization Workflow is the autonomous execution boundary for an assigned DEV change. It owns the database-upgrade Tool admission, the pinned DEV repository/profile checks, the in-place transaction path, and the final structured receipt. It is also the source for the generated Capability Catalogue, Repo Map, Repo Zip, and finalization summary used in review.

The read-only diagnostic command remains available:

```text
npm run db:upgrade:plan
```

It accepts no SQL path or SQL text and reports the connected database identity, baseline, ledger reconciliation, ordered source changes, plan digest, and terminal outcome. A clean plan returns `NO_CHANGES`; it does not authorize or execute APPLY. The Assistant API, Admin-Web, and local MCP gateway do not provide a separate database-upgrade approval ceremony.

## D1 engine contract

The D1 engine discovers only the governed migration and seed roots, parses the shared global numeric namespace, hashes every source file with SHA-256, and compares source metadata with the immutable ledger. The accepted installation is represented by the verified historical baseline through ordinal `00128`; historical SQL at or below that boundary is not replayed or represented as individual receipts.

The plan digest covers the connected database name, PostgreSQL cluster `system_identifier`, baseline state, source revision, and exact ordered pending file metadata and checksums. The engine fails closed for missing or changed files, changed kind/path, invalid baseline or ledger state, database identity drift, and manifest drift.

The registered Tool acquires the PostgreSQL session advisory lock, revalidates the manifest after the lock, and runs each pending SQL file in a runner-owned transaction. The SQL and its successful ledger receipt commit together. Failure rolls back the change and receipt; uncertain commit state is reported for reconciliation rather than blindly replayed. Applied files are byte-identity checked and never rewritten.

## Retained D1 configuration

The following D1 settings remain meaningful and are documented here by key name only:

- `SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE` and `SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER` are fail-closed identity pins used by the registered DEV Tool.
- `SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION` is optional source/evidence metadata; blank means unavailable rather than guessed.
- `SKYCOMMAND_DB_UPGRADE_CONNECT_TIMEOUT_MS` bounds the database connection.
- `SKYCOMMAND_DB_UPGRADE_ENABLED` is the explicit safety gate for the legacy manual CLI APPLY path. It is not a second approval step for the registered `database_upgrade_apply` Tool invoked by finalization.

The manual CLI form remains available only for separately authorized operator diagnostics and requires the explicit confirmation flag plus the exact freshly recomputed plan digest. The normal R7 implementation path is the governed finalization Workflow.

## R7 retirement and historical compatibility

R7 retires the obsolete Assistant PLAN/request endpoints, Admin decision/execute routes and page, special MCP database-upgrade tools, D2-only environment flags, and their dedicated controller/service plumbing. Active Assistant and MCP discovery now advertises only the bounded browser-automation, governed Workflow, and separately authorized promotion surfaces.

Migrations `00130__assistant_database_upgrade_plan_permission.sql`, `00131__database_upgrade_apply_request_envelope.sql`, and `00132__database_upgrade_apply_execution_receipt.sql` remain present and immutable. Their tables, historical rows, and audit evidence remain readable for historical inspection. Migration `00147__retire_d2_database_upgrade_surfaces.sql` is additive and idempotently deactivates only the superseded permission definitions and role grants; it does not delete records, rewrite applied migration files, or remove historical evidence.

## Review evidence

An accepted R7 finalization review should include:

1. the finalization Workflow run and its structured receipt;
2. the database identity, baseline, ledger status, applied ordinal, source revision, and final `NO_CHANGES`/success result;
3. the migration path, byte hash, and receipt for the R7 additive migration;
4. regenerated Capability Catalogue, Repo Map, Repo Zip, and finalization summary;
5. focused R7 absence/non-regression tests plus the retained D1 upgrade and finalization tests; and
6. final Git status and diff evidence, with promotion explicitly separate.
