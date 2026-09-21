# Agentic AI Phase 0

This directory contains the Phase 0 baseline, design contracts, and certification-preparation evidence for the approved SkyCommand Agentic AI Architecture & Phased Implementation Plan v1.2. The active authoritative source-controlled plan is `docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.2_APPROVED.md`. The original v1.0 review digest remains historical evidence in `phase-0/baseline-manifest.json`.

Phase 0 is intentionally non-executable. Under the v1.2 post-R8 amendment it is a **delta-certification gate** over the accepted R8 baseline, not a mandate to repeat completed remediation. Reuse current receipts, migration/ledger evidence, capability catalogue, Repo Map/ZIP, workflow history, tests and governance artifacts when still valid; refresh only stale evidence and Agent-specific gaps. Phase 0 adds no Agent admission route, runtime worker, provider adapter, Temporal Agent workflow, scheduler target, or Admin-Web execution control. The contracts and fixtures are source-controlled preparation for later phases and are validated by `npm run agent-phase0:self-test`.

## Evidence set

- `baseline-manifest.json` — reviewed repository/plan identity, migration and seed inventory, and known baseline gaps.
- `schema-relationship-spec.md` — Phase 1/2 relational design and additive-upgrade constraints, without applying schema changes.
- `entry-surface-traceability.md` — manual, workflow, scheduler, MCP/Assistant, and future external entry-surface ownership.
- `api-authorization-matrix.md` — public versus server-derived fields and object/effect authorization expectations.
- `temporal-history-and-version-inventory.md` — current Temporal seams, history-replay evidence plan, and version inventory.
- `runtime-certification-matrix.md` — provider-neutral adapter capability matrix and fake-runtime scenarios; real binaries remain unverified.
- `ui-wireframe-review.md` — static review of existing surfaces and deferred Agent Operations/Sessions wireframe requirements.
- `security-observability-decisions.md` — Phase 0 security defaults, telemetry truth rules, audit requirements, and unresolved owner decisions.
- `component-boundaries.md` — finalized ownership/non-ownership seams for the future Agent components.
- `validation-and-rollback-inventory.md` — non-destructive validation inventory and Phase 0 rollback/backward-compatibility evidence.

The baseline validation findings are recorded in `baseline-manifest.json` and `validation-and-rollback-inventory.md`. They are existing, unrelated repository failures, not Phase 0 regressions.

The approved plan remains authoritative. Items marked `OPEN`, `UNVERIFIED`, or `REQUIRES REVIEW` are not silently treated as enabled behavior.

## v1.2 delta-certification additions

- Request-level execution-surface policy and permitted surface transitions are part of the future authority/ExecutionContext contract.
- Human UI, MCP/API, workflow and scheduler entry surfaces must converge on the same governed operation/preflight/receipt semantics.
- Runtime configuration identity/freshness must distinguish stale processes from source/configuration drift and support governed reconciliation.
- OpenClaw/second-provider certification may proceed in parallel after common contracts stabilize; it remains required before broad multi-provider v1 acceptance.
