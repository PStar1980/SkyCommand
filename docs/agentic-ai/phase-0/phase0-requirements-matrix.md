# Phase 0 requirement-to-artifact matrix

The approved plan’s fifteen architecture requirements are mapped below. The implementation authority is the source-controlled `docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.2_APPROVED.md`. This matrix is a Phase 0 readiness artifact, not an assertion that later execution behavior exists.

| Requirement                                                 | Phase 0 artifact/evidence                                                         | Later enablement gate                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| 1. SkyCommand control plane                                 | Entry-surface traceability; API authorization matrix                              | Phases 1–2 admission/policy            |
| 2. Provider neutrality                                      | Runtime certification matrix; provider-neutral schemas; divergent fake fixtures   | Phases 2–4 conformance                 |
| 3. Explicit domain concepts                                 | Schema/relationship specification; immutable identity/lineage fields in contracts | Phase 1 domain schema                  |
| 4. Truthful observability                                   | Event/result schemas; security/observability decisions; surface-transition and runtime-freshness evidence rules | Phases 1–2 telemetry |
| 5. One execution/authorization service                      | Entry-surface traceability and server-derived context rules                       | Phases 2, 3, 5–7                       |
| 6. Safe bounded delegation                                  | Authority snapshot and lineage contract; no delegation fixture/gate               | Phase 5                                |
| 7. Formal effective authority                               | Authority snapshot, request-level execution-surface policy, and API authorization matrix | Phases 1–2 policy tests |
| 8. Appropriate Temporal use                                 | Temporal/history/version inventory                                                | Phase 2 workflow/replay work           |
| 9. Practical runtime adapters                               | Runtime locator/capability manifest contracts and certification matrix            | Phases 2–4                             |
| 10. Schema/API/UI/Operations/results/security/compatibility | All Phase 0 evidence documents, contracts, and static UI review                   | Phases 1–8                             |
| 11. Independently testable phases/rollback                  | Validation and rollback inventory; disabled gate fixture                          | Every phase gate                       |
| 12. v1 exclusions                                           | Disabled gate fixture; security decisions; no runtime source/migration assertions | Phase 8 negative tests                 |
| 13. Preserve MCP → Assistant API → Temporal → Playwright    | Entry-surface traceability; existing focused regression tests                     | Phase 2 wrapper/Phase 3 reference path |
| 14. Multi-user and Agent identity history                   | API authorization matrix; immutable authority/lineage contracts                   | Phases 1–8 multi-user tests            |
| 15. Provider Session versus durable Run                     | Runtime locator and run summary contracts; Temporal inventory                     | Phases 2–4 lifecycle/recovery tests    |

The approved managed-development amendment is deliberately not enabled here; its workspace/diff/validation evidence belongs to Phase 3.5.

The v1.2 post-R8 amendment changes Phase 0 execution strategy: validate deltas against the accepted R8 baseline rather than re-running completed remediation. Existing evidence remains usable when its source/configuration/runtime identity is still current.
