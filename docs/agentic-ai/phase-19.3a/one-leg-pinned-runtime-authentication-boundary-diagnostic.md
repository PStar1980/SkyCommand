# Phase 19.3A0 — One-Leg Pinned-Runtime Authentication Boundary Diagnostic

- **Status:** Prepared for Paul/Sky review; not an authorization to run.
- **Purpose:** One fresh, isolated diagnostic of the pinned Codex device-code login boundary.
- **Production pin:** `0.155.0-alpha.9.2`.
**Completed A/B experiment:** Permanently terminal. Neither prior leg may be resumed, retried, or treated as an identity for this diagnostic.

## Authority and scope

This document describes one future separately authorized experiment. Its execution requires a new explicit work-order authorization. It grants no current Docker, provider, browser, database, enrollment, lifecycle, deployment, or runtime action. The source now includes the fail-closed contract, focused self-tests, and a concrete read-only preflight collector/operator command. It does not include an executable experiment runner, Docker adapter, egress-proxy startup, or provider RPC path.

The diagnostic is limited to a disposable Codex `0.155.0-alpha.9.2` app-server process and a fresh local experiment identity. It is not a managed enrollment, does not write to the managed enrollment/account tables, does not use the managed account as provider authority, and does not update the production runtime or its pin.

## Request-level surfaces for a future execution work order

| Surface | Future permission | Boundary |
|---|---|---|
| Repository/config inspection | `READ_ONLY` | Verify the pinned package and exact allowlist source. |
| DEV database inspection | `READ_ONLY` | Read only installation/account/enrollment state; no provider secrets or enrollment payload columns. Use a read-only transaction. |
| Host Supervisor/runtime inspection | `READ_ONLY` | `GET /runtime/status` and read-only health evidence only. No Supervisor action. |
| Local shell/Docker | `EXPLICIT_APPROVAL_REQUIRED` | Only the future work order may authorize the isolated diagnostic project. No production service or generic backend action. |
| Provider egress | `EXPLICIT_APPROVAL_REQUIRED` | One `account/login/start` to the pinned app-server, via the isolated proxy, exact `auth.openai.com:443` only. |
| Browser/Computer Use | `DENY` for the agent | Paul performs any device-code browser interaction himself. |
| Database writes, managed enrollment APIs, lifecycle APIs, Turn/start, Browser/MCP execution, Git mutation, finalization, promotion | `DENY` | No exceptions in this diagnostic. |

## Mandatory read-only preflight

The concrete future runner must not start a proxy or app-server until it has assembled and validated one current `SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1` snapshot. Every source must be identified as read-only and timestamped.

1. In a `READ ONLY` database transaction, inspect exactly one `phase19-3a0-managed-codex` installation and its `phase19-3a0-managed-account` binding. Read only safe state columns. For enrollment rows, read operation IDs, state, bounded attempt counts, and timestamps; do not select `verification_url`, `user_code`, `provider_login_reference`, credentials, or raw provider payloads.
2. Count active, unresolved, and unclassified enrollment states across the binding. All three counts must be zero. Any `CREATED`, `AUTHENTICATING`, `PENDING_USER`, `RECONCILIATION_REQUIRED`, or unclassified state blocks before provider interaction. In particular, an existing `PENDING_USER` operation is a hard stop; this diagnostic never continues or reconciles it.
3. Read Supervisor `/runtime/status` and confirm Supervisor is online with no active operation. Reconcile that observation with the current durable managed-Codex lifecycle: it must be a known, authoritatively terminal, reconciled lifecycle with a bound fingerprint. A contradictory same-operation Supervisor result, missing evidence, or uncertain state blocks.
4. Read current runtime evidence without invoking the managed-status GET. The current `getManagedCodex()` path calls `readHealth()` and persists a sanitized observation, so it is not an acceptable read-only preflight source. Require certified/current runtime identity and freshness, healthy worker and bridge, current containment/MCP, and execution disabled. Overall readiness may be known `BLOCKED` only for `ACCOUNT_UNENROLLED`, `PROVIDER_UNREACHABLE`, or `PROVIDER_REACHABILITY_UNKNOWN`; unknown runtime/certification state blocks.
5. Validate that the exact source-controlled provider policy contains only `auth.openai.com`, and that its policy digest matches source. The preflight is a veto/safety check only. The managed account state must never grant credentials, provider authority, or permission to run this separate experiment.

If the existing managed operation is active/unresolved, the lifecycle or runtime state is uncertain, the database snapshot cannot be read safely, or the effective readiness cannot be established without a mutating read path, stop with no provider interaction. Do not resolve the preflight blocker by calling a managed enrollment/reconciliation route or by writing state.

### Concrete read-only preflight command

From a host PowerShell session at the SkyCommand checkout, the operator may run the preflight-only command:

```powershell
Set-Location 'C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyCommand System\SkyCommand'
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55432'
$env:PGDATABASE = 'skyserver_dev'
npm run codex-compat-auth-boundary:preflight
```

The explicit PostgreSQL variables target the current host-published Compose mapping (`127.0.0.1:55432/skyserver_dev`); if the local Compose host port is intentionally changed, update only `PGPORT` to that configured host port. The command reads the local `.env` for PostgreSQL user/password and loopback Supervisor configuration but never prints environment values. It rejects non-loopback database hosts, any database other than `skyserver_dev`, and `NODE_ENV=production`, then independently verifies `current_database()`. PostgreSQL access is wrapped in `BEGIN READ ONLY`, verifies `transaction_read_only=on`, and ends with `ROLLBACK`. The explicit SELECT list omits device/user codes, verification URLs, provider login references, credentials/tokens, and `safe_result`. Supervisor access is limited to unauthenticated loopback `GET /health` and `GET /runtime/status`; runtime certification/containment/MCP evidence comes from the already persisted sanitized observation, joined to the Supervisor's read-only service-health snapshot. The observed and expected runtime egress digests must also match the exact source allowlist file digest. It does not call `getManagedCodex()`, `readHealth()`, enrollment/lifecycle APIs, Docker, or any provider endpoint.

Output is exactly one bounded line prefixed `SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1`. A clean snapshot has `preflightStatus: READY`; a blocker has `preflightStatus: BLOCKED` and one allowlisted `blockerClass`, plus only safe enrollment/lifecycle/runtime evidence. A blocked result is a veto; the command performs no repair, reconciliation, or retry. No preflight was run as part of this source implementation turn.

## Experiment contract

- Generate two distinct fresh UUIDv4 values: `experimentId` and `providerOperationId`. These identify only this isolated diagnostic. They are not managed enrollment IDs and are never written to managed lifecycle or enrollment state.
- Use exactly Codex `0.155.0-alpha.9.2` and its source-controlled package integrity contract. Do not install or execute candidate `0.156.1` in this experiment.
- Use a fresh one-version-only runtime image/container and a new disposable `/probe-home` tmpfs. No production Codex home, named credential volume, Host/Supervisor/API credential, database credential, Git state, Docker socket, browser state, or existing provider-login reference may enter the runtime container.
- Preserve the isolated runtime contract represented by the existing A/B Compose template: non-root UID, read-only image root, all capabilities dropped, `no-new-privileges`, `tmpfs` home/temp only, no bind/named volumes, `logging: none`, no default route for the runtime, and execution disabled. The concrete one-leg Compose service must be separately reviewed; do not run the existing A/B stage runner, which has different continuation behavior.
- The provider proxy uses the current exact allowlist and phase-correlated diagnostics. Only `auth.openai.com:443` with public DNS is permitted; all other destinations remain denied and redacted, and the allowlist is never expanded automatically. A denial may be recorded as bounded egress evidence, but it cannot authorize another destination or another provider attempt.
- Allowed app-server request order is `initialize`, exactly one `account/login/start` with `type=chatgptDeviceCode`, then at most one `account/read`. No other RPC, retry, cancellation/login restart, `turn/start`, Browser/MCP task, or provider operation is permitted.
- Capture the existing bounded proxy boundaries for app-server startup, initialize, post-initialize idle, `account/login/start`, the explicitly aliased device-code request window, and post-request processing. Include only safe phase, destination class/fingerprint, port, decision, reason, timestamp, monotonic boundary/cursor/count. Unknown hostnames stay redacted; the experiment-scoped HMAC key remains memory-only.
- The device URL and user code may be shown once on the attached human checkpoint only. The runtime uses Docker's `logging: none`; checkpoint values, login ID/reference, URL, code, and expiration details are never written to a result marker, receipt, file, DB row, Docker log, or proxy diagnostic. The user code is not carried forward after the checkpoint callback.
- The runner waits only for a matching `account/login/completed` event from the same app-server generation, carrying the exact transient login ID returned by this run and `success=true`. An `account/updated` event, an operator assertion, a mismatched/missing ID, another generation, or another operation is not sufficient and cannot authorize `account/read`. The completion event records provider-login completion; authenticated account state is not claimed until the single permitted `account/read` result is safely classified.
- If matching completion is observed, issue one `account/read` and classify only the safe account state. If completion is failed, absent, mismatched, or uncertain, do not issue `account/read`; terminate as `PROVIDER_LOGIN_FAILURE` or `PROVIDER_OUTCOME_UNCERTAIN` and discard the cell.
- Every typed failure or uncertainty is terminal. There is no retry or resume path. A fresh separately authorized work order and new IDs would be required for any future experiment.

The safe result is limited to version and package/artifact digests, experiment/provider-operation IDs, protocol method and numeric request/RPC identity, one of the bounded result categories, safe account-state classification, app-server generation, safe timestamps, projected phase egress, attempt counts, cleanup verification, and `executionEnabled:false`. Never include raw RPC text/data, account payload, credentials, access/refresh tokens, cookies, authorization headers, device code, verification URL, login reference, or raw/unknown hostname.

## Stop conditions and cleanup

Stop before provider interaction on any preflight failure, active/unresolved/unknown operation, stale or uncertified runtime, containment mismatch, policy digest mismatch, unexpected mount/network/credential, image/version/integrity mismatch, missing phase boundary, or Docker uncertainty.

After the sole provider operation reaches a terminal result, collect the final safe proxy delta, stop the disposable process, remove the unique experiment Compose project, and verify read-only that its container/network/volume resources are absent and the tmpfs home is discarded. If cleanup cannot be proven, report `AUTH_BOUNDARY_CLEANUP_UNVERIFIED`; do not launch a replacement project as recovery.

Do not mutate the database, production managed enrollment/account, provider allowlist, runtime pin, certification/lifecycle state, or execution policy. Do not rebuild/restart production. Do not finalize, promote, or enter Phase 19.3A1.

## Future operator procedure

The read-only preflight-only command above is implemented. A concrete pinned-only Docker adapter and provider-phase wiring remain unimplemented and must be separately reviewed before any future execution work order can authorize an experiment.

1. Obtain a separate explicit work order authorizing this one experiment and its exact local execution surfaces. This preparation is not that authorization.
2. Run the read-only preflight above. If an active enrollment exists—including a still-pending prior managed device-code operation—stop and return the safe blocker; do not resume it.
3. Review/build only the separately scoped pinned-only disposable runtime and one-leg adapter. Verify the existing strict containment and exact provider policy before `account/login/start`; image acquisition/build must not include credentials and must not start provider traffic.
4. Generate fresh UUIDv4 experiment and provider-operation IDs. Start the isolated project once. The only authentication call is its single `account/login/start`.
5. If the device-code checkpoint appears, pause at the attached human checkpoint and let Paul complete the browser interaction. The runner must not continue on a typed human “done” assertion. It may proceed only on the matching app-server completion event described above.
6. After positive completion, permit one `account/read`; otherwise record the bounded terminal failure/uncertainty without a read. Do not retry either call.
7. Review the safe result and teardown proof with Paul/Sky. No managed enrollment reconciliation, deployment, finalization, promotion, execution enablement, or A1 work follows from this result.

## Current preparation validation

`npm run codex-compat-auth-boundary:self-test` exercises the fail-closed contract, and `npm run codex-compat-auth-boundary-preflight:self-test` exercises the collector with read-only transaction/Supervisor fakes. These tests use no live database, Supervisor, Docker, network, provider, API, or enrollment operation. Passing them does not authorize or constitute a preflight run or experiment.
