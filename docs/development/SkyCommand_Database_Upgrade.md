# SkyCommand database upgrade path

## D1 boundary

`npm run db:build` is the existing destructive clean-build utility. It drops and recreates its named database and replays the ordered migration and seed roots. It remains unchanged and is not an in-place upgrade mechanism.

`npm run db:upgrade:plan` is the D1 non-destructive path. It discovers SQL only from `packages/db_build/src/migrations` and `packages/db_build/src/seeds`, uses their shared global numeric namespace, hashes every file with SHA-256, and performs read-only database inspection. It accepts no SQL path or SQL text.

The accepted installation predates the upgrade ledger. D1 verifies the historical state through ordinal `00128` using the `core`, `auth`, and `worker` schema probes, the existing repository identity table, the Step C `worker.workflow_run_records` Assistant attribution constraints, and the browser automation foundation. Historical SQL is not replayed and is not represented as individual receipts. It is represented by one `skycommand_database_baseline.v1` evidence row when the first governed upgrade is applied.

## Ledger and reconciliation

Migration `00129__database_upgrade_ledger.sql` adds `core.database_upgrade_baselines` and `core.database_upgrade_ledger`. The ledger records only successful post-baseline changes: global ordinal, `MIGRATION`/`SEED`, repository-relative path, SHA-256, timestamps, optional source revision, plan digest, and safe evidence. Constraints make baseline identity, ordinals, paths, and checksums immutable and unique.

The runner compares every recorded ordinal, kind, path, and checksum with the current source. A missing source, changed checksum, changed kind/path, invalid baseline, or incomplete ledger schema is drift and fails closed. An identical recorded change is complete and is never replayed. Historical ordinals at or below `00128` are never pending.

## Plan digest and apply gate

The plan digest is SHA-256 over a canonical payload containing the configured/connected database identity, including PostgreSQL's cluster `system_identifier`, baseline state, source revision, and the exact ordered pending change metadata and checksums. The system identifier is obtained read-only through `pg_control_system()` and is represented as a string so JavaScript numeric precision cannot alter it. The result contains no password, token, connection string, absolute path, or SQL text.

`npm run db:upgrade:apply -- --confirm --expected-plan-digest <digest>` is implemented for later acceptance but is disabled by default. It requires `SKYCOMMAND_DB_UPGRADE_ENABLED=true`, a non-empty `SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE` equal to `PGDATABASE`, a non-empty `SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER` equal to the connected PostgreSQL cluster's system identifier, a successful baseline and ledger check, explicit confirmation, the exact freshly recomputed digest, and at least one pending change. PLAN remains available without target configuration. APPLY is authorized by database name plus cluster system identifier, never by host name. The CLI has no ordinary target-database argument.

When the first governed post-baseline change creates the existing baseline receipt, its safe evidence JSON preserves the verified `systemIdentifier` alongside the historical probes. Existing recorded baselines from before this correction may omit that evidence field; when present, it must match the currently connected cluster or inspection/APPLY fails closed with baseline/database identity drift. `SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION` remains optional; blank means unavailable rather than guessed.

## Locking and atomicity

APPLY holds a PostgreSQL session advisory lock for the target while it rechecks the plan and applies changes. Each post-baseline SQL file runs in a runner-owned transaction; the SQL and its successful ledger receipt commit together. The new `00129` migration intentionally has no transaction-control statements for this reason, while the clean-build path can still consume it in normal order.

Failure rolls back the change and receipt. A commit/connection uncertainty is reported as failure for reconciliation; the next plan verifies the ledger before any retry. D1 does not blindly replay an uncertain effect, and it does not expose this engine as a SkyCommand Tool, Assistant API, or MCP capability.

## Future governed invocation

A later Assistant/MCP capability must submit only a typed operation, the allowed configured target, and an expected plan digest under server-side identity and authorization. It must not receive generic SQL access, arbitrary paths, credentials, or provider-specific bypasses. D1 supplies the source-control, baseline, drift, digest, lock, and transaction evidence that such a capability will require.
