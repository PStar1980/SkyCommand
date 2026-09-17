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

`npm run db:upgrade:apply -- --confirm --expected-plan-digest <digest>` is implemented for later acceptance but is disabled by default. It requires `SKYCOMMAND_DB_UPGRADE_ENABLED=true`, a non-empty `SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE` equal to `PGDATABASE`, a non-empty `SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER` equal to the connected PostgreSQL cluster's system identifier, a successful baseline and ledger check, explicit confirmation, the exact freshly recomputed digest, and at least one pending change. Direct CLI/engine PLAN remains available without target configuration; the D2A Assistant exposure adds both D1 target-pin checks. APPLY is authorized by database name plus cluster system identifier, never by host name. The CLI has no ordinary target-database argument.

When the first governed post-baseline change creates the existing baseline receipt, its safe evidence JSON preserves the verified `systemIdentifier` alongside the historical probes. Existing recorded baselines from before this correction may omit that evidence field; when present, it must match the currently connected cluster or inspection/APPLY fails closed with baseline/database identity drift. `SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION` remains optional; blank means unavailable rather than guessed.

## Locking and atomicity

APPLY holds a PostgreSQL session advisory lock for the target while it rechecks the plan and applies changes. Each post-baseline SQL file runs in a runner-owned transaction; the SQL and its successful ledger receipt commit together. The new `00129` migration intentionally has no transaction-control statements for this reason, while the clean-build path can still consume it in normal order.

Failure rolls back the change and receipt. A commit/connection uncertainty is reported as failure for reconciliation; the next plan verifies the ledger before any retry. D1 does not blindly replay an uncertain effect, and the engine remains an engine-only package rather than a generic Tool or mutation-capability registry.

## D2A governed Assistant/MCP PLAN exposure

`GET /api/assistant/database-upgrade/plan` is the D2A bounded Assistant operation. It accepts no arguments, invokes D1 with `mode: 'PLAN'`, and returns the existing `database_upgrade_summary.v1` ToolResult metadata. Assistant exposure requires the bearer-token integration, `SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED=true`, `DB_UPGRADE_PLAN`, and both configured D1 target pins. The connected database name and PostgreSQL system identifier must match those pins. The existing `SKYCOMMAND_DB_UPGRADE_ENABLED` APPLY gate is not consulted by PLAN.

The local MCP gateway exposes `skycommand_database_upgrade_plan` only when `SKYCOMMAND_MCP_DB_UPGRADE_PLAN_ENABLED=true`. Its exact input schema is `{ "type": "object", "properties": {}, "additionalProperties": false }`; it delegates only to the bounded Assistant API and does not depend on `SKYCOMMAND_MCP_EXECUTION_ENABLED`. Both capability discovery and OpenAPI explicitly state `readOnly: true` and `applyExposed: false`. Database-upgrade APPLY is not exposed through the Assistant API or MCP in D2A.

The D2A authorization registration is additive migration `00130__assistant_database_upgrade_plan_permission.sql`. It registers only `DB_UPGRADE_PLAN` and grants it only to `SUPER_ADMIN`; it is not included in the default Assistant permission set. The migration is intentionally not applied as part of this implementation.

No Assistant APPLY endpoint, MCP APPLY tool, expected digest, confirmation, generic argument passthrough, workflow/scheduler exposure, or automatic database mutation is part of D2A.

## D2B.1 governed APPLY request and human decision envelope

Migration `00131__database_upgrade_apply_request_envelope.sql` adds the dedicated `core.database_upgrade_apply_requests` record. It stores a server-derived, immutable-by-service PLAN envelope: request identity/status, Assistant agent and safe actor metadata, trigger source, database name, PostgreSQL system identifier, baseline ordinal, safe source revision, exact PLAN digest, pending count and path/checksum metadata, a server-derived request/action digest, policy contract version, expiry, and human decision identity/time/note. It never stores SQL, credentials, connection strings, tokens, environment contents, or absolute paths, and it has no `APPLIED` state.

`POST /api/assistant/database-upgrade/apply-requests` accepts exactly `{ "expectedPlanDigest": "<64-char SHA-256>" }`. The Assistant request gate is `SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED=false` and the required permission is `DB_UPGRADE_APPLY_REQUEST`; neither this permission nor `DB_UPGRADE_APPLY_APPROVE` is in the default Assistant permissions. The service derives every other resource and authority field, calls D1 only in PLAN mode, requires pending changes, verifies both configured target pins, and reuses the current pending request for the same Assistant identity and PLAN instead of creating approval spam. This feature does not consult or enable `SKYCOMMAND_DB_UPGRADE_ENABLED`.

The local MCP gateway exposes `skycommand_database_upgrade_apply_request` only behind `SKYCOMMAND_MCP_DB_UPGRADE_APPLY_REQUEST_ENABLED=false` (default off). Its exact input contains only `expectedPlanDigest`, it delegates only to the bounded Assistant API, and its annotations are `readOnlyHint:false`, `destructiveHint:false`, `idempotentHint:true`, and `openWorldHint:false`. No Assistant or MCP APPLY execution capability is exposed.

Human decisions use `/api/admin/database-upgrade/apply-requests` with the authenticated web/admin session, `DB_UPGRADE_APPLY_APPROVE`, and `SUPER_ADMIN`. Assistant and internal-service identities are rejected. Both decisions require a still-PENDING, non-expired request. APPROVED additionally recomputes D1 PLAN read-only and requires the same database, system identifier, digest, baseline/source revision, pending count/fingerprints, request digest, and policy contract; a changed plan is durably marked `STALE`. REJECTED records the human rejection of the exact stored authorization request without requiring the current PLAN to remain unchanged. Expired requests become `EXPIRED`; decided requests cannot be changed or approved later. D2B.1 ends after durable decision evidence and contains no continuation to APPLY.

## D2B.2 approved-request execution continuation

Migration `00132__database_upgrade_apply_execution_receipt.sql` adds the separate, one-per-request `core.database_upgrade_apply_execution_receipts` contract. It stores only safe execution identity, request/PLAN digests, database and PostgreSQL system identity, human executor, timestamps, outcome, counts, safe D1 ledger identifiers/state, and a failure code. It does not rewrite D2B.1 approval meaning and does not store SQL, credentials, tokens, connection strings, environment contents, or absolute paths.

`POST /api/admin/database-upgrade/apply-requests/:requestId/execute` is the bounded D2B.2 continuation. It accepts exactly `{ "confirm": true }`, requires an authenticated human `SUPER_ADMIN` with `DB_UPGRADE_APPLY_APPROVE`, rejects Assistant and internal-service identities, and is default-off behind `SKYCOMMAND_ADMIN_DB_UPGRADE_APPLY_EXECUTION_ENABLED=false`. It loads and locks the persisted request, requires `APPROVED` plus human decision evidence, and independently revalidates expiry, policy version, request digest, target database, PostgreSQL system identifier, baseline/source revision, pending count/fingerprints, and the fresh D1 PLAN digest before calling D1's dedicated approved-request continuation. D1 retains its own target checks, advisory lock, and post-lock PLAN revalidation; the ordinary CLI/manual APPLY path still requires `SKYCOMMAND_DB_UPGRADE_ENABLED=true`.

The receipt's unique request key, D1 advisory lock, in-process request guard, and ledger-based reconciliation prevent duplicate application. A repeated call returns the existing receipt. If D1 has applied changes but receipt persistence is interrupted, recovery compares authoritative D1 ledger receipts for the approved PLAN and records/reuses the receipt without replaying APPLY. Assistant/MCP capability discovery continues to report PLAN and APPLY-request availability, `humanApprovalRequired: true`, and `applyExecutionExposed: false`; the Admin-Web continuation is separately described as human-only and not an agent capability.

The only first-use exception is a one-time bootstrap condition for applying `00132` itself: before that migration exists, PostgreSQL undefined-table `42P01` for the exact execution-receipt relation is rolled back and the already-approved request may continue through D1's dedicated approved-request APPLY path. This is not general permission to continue when receipt-persistence infrastructure is unavailable; any other error or missing persistence relation remains a failure.

## R2 registered DEV_LOCAL APPLY Tool

R2 registers exactly one normal medium-risk Tool, `database_upgrade_apply`, through additive migration `00135__autonomous_database_upgrade_tool.sql`. Its application-scope correction is the additive `00136__database_upgrade_tool_admin_scope.sql`; applied migrations remain immutable. It uses the existing D1 engine and is bound by the catalogue to the active `DEV_LOCAL` `SkyCommand` repository path, the configured `skyserver_dev` target, and the PostgreSQL cluster system identifier. Its dedicated `DB_UPGRADE_APPLY` permission is granted only to `SUPER_ADMIN` in the authenticated `SKYSERVER_ADMIN` scope; visibility is registered for `cli`, `admin-web`, `api`, and `worker`.

The Tool accepts zero caller-controlled parameters. The entry script is `packages/db_upgrade/src/databaseUpgradeApply.js`; it does not accept SQL, paths, credentials, target overrides, confirmation flags, or plan-digest overrides. The Tool verifies its registered repository/profile/metadata binding, then calls D1's registered execution path. D1 captures and hashes the exact SQL bytes it will execute, acquires the advisory lock, revalidates the complete manifest and target identity under that lock, applies each pending file with its receipt in one transaction, and returns `NO_CHANGES` after a verified ledger check when the target is current. D1's CLI and approved-request continuation remain separate historical paths; R2 does not remove the D2 Assistant, MCP, or Admin-Web surfaces.
