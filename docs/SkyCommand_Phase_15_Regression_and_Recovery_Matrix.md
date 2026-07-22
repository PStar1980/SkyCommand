# SkyCommand Phase 15 Regression and Recovery Matrix

## Purpose

This document is the operational closure reference for Phase 15 — Assisted Tool Catalogue Administration. It records the minimum regression coverage, expected recovery behavior, and the final live proof required before the phase is marked complete.

The governing rule remains:

> PostgreSQL decides what may run. Files provide implementation. Structured results provide workflow evidence.

Registration fingerprints and SHA-256 values are onboarding evidence only. They never become runtime launch gates.

## Closure status

Phase 15 is **closure-ready**. The managed PostgreSQL comparison tool has completed upload analysis, disabled-first registration, contract inspection, controlled execution, explicit enablement, workflow execution, structured database health/build/comparison output, and purpose-built Summary rendering.

One live closure proof remains after applying the Phase 15.7 readiness package:

1. run the full validation and Admin-Web build;
2. run the Development Promotion workflow through the normal big-rig path;
3. confirm the final structured promotion summary and generated repository artifacts;
4. record the run evidence and mark Phase 15 complete.

## Regression matrix

| Area | Scenario | Expected evidence | Automated coverage |
| --- | --- | --- | --- |
| Catalogue administration | List, inspect, create, edit, enable, and disable a tool | PostgreSQL catalogue remains authoritative; writes are audited | `toolAdminService` syntax and existing Admin API tests |
| Repository designation | No SkyCommand repository is configured | Registration is blocked with `SKYCOMMAND_REPOSITORY_NOT_CONFIGURED` | `skycommand-repository:self-test` |
| Repository readiness | Active profile path is missing or invalid | Exact readiness error; no staged package promotion | `skycommand-repository:self-test` |
| Upload analysis | Valid Node.js/CommonJS tool | Syntax, adapter, dependency, descriptor, and schema findings are returned without execution | `tool-onboarding:self-test` |
| Upload analysis | Invalid source or unsupported schema | Blocking ERROR findings; no catalogue/file writes | `tool-onboarding:self-test` |
| Package destination | New directory under `packages/` | Destination resolves inside the repository and preserves `src/...` entrypoint | `tool-onboarding:self-test` |
| Package destination | Absolute path, traversal, drive switch, or existing destination | Registration blocked before persistent writes | `tool-onboarding:self-test`, `skycommand-repository:self-test` |
| Descriptor lifecycle | Descriptor supplied during onboarding | Configuration is prefilled; descriptor is not promoted or read at runtime | `phase15:closure-readiness:self-test` |
| Contract promotion | New versioned output schema | Schema promoted to `packages/tools/contracts` | `tool-onboarding:self-test` |
| Contract reuse | Identical schema already exists | Existing contract reused without duplicate write | `tool-onboarding:self-test` |
| Contract collision | Same contract path contains different content | Registration blocked; existing contract preserved | `tool-onboarding:self-test` |
| Disabled-first registration | Registration succeeds | Tool and parameters exist disabled; implementation is readable | `tool-onboarding:self-test`, `tool-verification:self-test` |
| Contract inspection | Representative ToolResult matches schema | Advisory contract check passes without importing or executing tool code | `tool-verification:self-test` |
| Controlled execution | Disabled managed tool is deliberately test-run | Tool History record, stdout/stderr, structured result, enabled state unchanged | `tool-verification:self-test` |
| Runtime accessibility | Registered source is edited after onboarding | Normal execution remains available; no hash mismatch gate | `tool-onboarding:self-test`, `phase15:closure-readiness:self-test` |
| Workflow confirmation | High-risk tool runs in a published workflow | Interactive phrase is bypassed; enabled state, permissions, risk authorization, paths, timeout, locks, history, and audit remain enforced | `workflow-tool-confirmation:self-test` |
| Workflow visibility | Tool lacks `admin-web` or `api` | Omitted from builder and rejected during save/publish validation | `workflow-tool-visibility:self-test` |
| Database Health | One or two databases checked | `database_health_summary.v1`, `allOnline`, per-database evidence, table-first renderer | `db-health:self-test`, `workflow-database-output:self-test` |
| Database Build | Rebuild succeeds | `database_build_summary.v1`, ordered SQL counts/checkpoints, table-first renderer | `db-build:self-test`, `workflow-database-output:self-test` |
| Database comparison | Databases match | Successful execution with `databasesMatch = true` | comparison contract/self-test and workflow condition regression |
| Database comparison | Databases differ | Successful execution with `databasesMatch = false`, bounded differences, no false process failure | comparison contract/self-test, `workflow-result-context:self-test` |
| Condition routing | Compare result drives a condition | Canonical path `nodes.db_compare_node.output.databasesMatch` resolves TRUE and FALSE branches | `workflow-condition:self-test` |
| Database Summary | Health, build, compare, and condition evidence are present | Contract-driven Database Synchronization Summary; no workflow PK hardcoding | `workflow-result-context:self-test`, `workflow-database-output:self-test` |
| Development Promotion | Repository is promotion-ready | Eight-node big rig completes and renders structured promotion evidence | final live closure proof |
| Development Promotion | Repository is blocked | Condition routes directly to Summary and completes successfully without mutation nodes | `workflow-condition:self-test`; live proof as needed |

## Recovery matrix

| Failure point | Required behavior | Administrator action |
| --- | --- | --- |
| No designated SkyCommand repository | No upload promotion or registration | Designate one active repository in **Configuration > Repositories** |
| Missing active-profile repository path | No promotion; exact readiness error | Add or activate the current profile path |
| Repository/packages root not writable | No promotion or catalogue record | Correct filesystem permissions/path and retry analysis |
| Invalid JavaScript syntax | Analysis ERROR; no execution | Correct source and upload again |
| Missing dependency | Finding identifies unavailable import | Add dependency through normal repository development, not onboarding auto-install |
| Unsafe package/entrypoint path | Preview/registration blocked | Choose a new path under `packages/.../src/...` |
| Duplicate tool code | Registration blocked | Use a unique code or manage the existing tool |
| Existing package destination | Registration blocked; no overwrite | Choose a new destination; in-place upgrades remain future work |
| Invalid output schema | Analysis/contract error; source remains staged only | Correct schema or omit it and register without contract metadata |
| Central schema content conflict | Existing contract preserved; promotion blocked | Version the output contract or reconcile intentionally in source control |
| Database transaction failure during registration | Hidden repository staging removed | Correct database issue and register again |
| Final package rename/promotion failure | Tool remains disabled or transaction is compensated | Inspect audit/recovery evidence, correct filesystem issue, retry safely |
| Final file verification failure | Tool remains disabled and inspectable | Compare resolved paths/files, repair or remove disabled record, retry |
| Contract check failure | Advisory evidence only; no runtime lockout | Correct schema/sample when useful; enablement remains an explicit admin decision |
| Controlled test failure | Tool remains disabled; logs retained | Review Tool History and source, then rerun controlled test |
| Tool lacks workflow visibility | Builder/save validation names required channels | Enable both `admin-web` and `api`; add `cli`/`worker` when those lanes are desired |
| Workflow condition path missing | Node fails with `WORKFLOW_CONDITION_PATH_NOT_FOUND` unless fallback configured | Correct node key/output path or intentionally configure a fallback |
| Structured-result transport fails after domain success | Real operation remains successful with warning/fallback | Inspect Tool History and reporting configuration; do not rerun side effects automatically |
| Tool process fails | Execution fails from real process result; diagnostics stay in Tool History | Correct the domain/runtime problem and rerun deliberately |
| Timeout or cancellation | Terminal state preserved; no fabricated success | Review timeout/cancellation evidence and adjust policy only when justified |

## Final live closure procedure

Run from the updated repository root:

```text
npm run phase15:closure-readiness:self-test
npm run validate
npm run web:build
```

Then run the published **Development Promotion** workflow using the normal repository and commit-message inputs.

Confirm:

- Repository Intelligence produces `git_repository_status.v1`;
- the promotion condition resolves its canonical path;
- Repository Map and Repository ZIP artifacts are created;
- Dev Commit completes;
- the deliberate Human Approval node behaves normally;
- Main/Development synchronization completes;
- the final Development Promotion Summary renders all eight stages;
- Tool History retains complete operational logs;
- Workflow History contains concise structured evidence;
- no onboarding fingerprint or file hash is consulted during execution.

## Closure evidence to record

Record the following in `change.log` or the final Phase 15 closure note:

- validation result;
- Admin-Web build result;
- Development Promotion workflow run ID/date;
- branch taken by the readiness condition;
- completed/failed/skipped node counts;
- generated map/ZIP evidence;
- commit and branch synchronization evidence;
- final Summary outcome.

## Deferred enhancements

These items do not block Phase 15 closure:

- update/replace an existing managed package through Add Tool;
- multi-file or ZIP package upload;
- Python or PowerShell onboarding;
- dependency installation;
- flags, environment, stdin, or secret parameter bindings;
- visual schema design;
- automated Git commit/promotion after registration;
- untrusted-code sandboxing;
- tool duplication/version-management workflows.
