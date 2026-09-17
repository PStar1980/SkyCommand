# Agentic AI Phase 0

This directory contains the Phase 0 baseline, design contracts, and certification-preparation evidence for the approved SkyCommand Agentic AI Architecture & Phased Implementation Plan v1.1. The active authoritative source-controlled plan is `docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.1_APPROVED.md`. The original v1.0 review digest remains historical evidence in `phase-0/baseline-manifest.json`.

Phase 0 is intentionally non-executable. It adds no database migration, Agent admission route, runtime worker, provider adapter, Temporal Agent workflow, scheduler target, or Admin-Web execution control. The contracts and fixtures are source-controlled preparation for later phases and are validated by `npm run agent-phase0:self-test`.

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
