# Luna Work Order — R0 governance installation + R1 Capability Catalogue completion

**Authorized scope:** Paul-approved September 16, 2026 handoff. Complete R0, then R1, autonomously inside the registered DEV_LOCAL environment. Stop after evidence/report. This is not authorization to promote or implement R2–R8 or Agentic AI Phase 1.

## Objective

Install the accepted governance revision, then finish the existing Capability Catalogue exporter integration. Leave a reviewable DEV state with registered Tool, updated immutable workflow versions, validated generated artefacts, and execution evidence.

## 1. Install R0

Treat this bundle as a documentation overlay, not a replacement application repository. Compare its files against the current checkout; preserve unrelated newer changes. Install at the exact relative paths in the bundle:

- `AGENTS.md`
- `docs/development/SkyCommand_Development_Operating_Rules_v1.2.md`
- `docs/development/SkyCommand_Autonomous_DEV_Workflow_Remediation_Plan_v1.1.md`
- `docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.1_APPROVED.md`
- This work order at `docs/development/Luna_R0_R1_Work_Order.md`.

Read the installed rules and plan before implementation. Update active references from rules v1.0/v1.1, remediation v1.0, and architecture v1.0 to the new authoritative paths. Remove superseded active governance copies from the working tree after installing replacements; their history remains in Git. Do not edit numbered applied migrations, historical receipts, archived evidence, or quotations merely to replace old filenames. Distinguish historical references from active authority. Verify no competing active governance remains.

The architecture amendment explicitly distinguishes local operator-authorized remediation from future isolated managed agents. Do not implement Phase 3.5 or grant host access to managed agents here.

## 2. Establish current source/runtime facts

Read Git status/diff without mutating Git. Identify current migration/seed ordinals, database identity/ledger, exporter implementation, Tool registry, and published workflow definitions. Use live runtime authority to discover both Development Promotion variants and the Repo Map & Zip workflow. Record their exact codes, IDs, current versions, and node order. Do not assume names from old source seeds are current.

Use existing authorized read-only queries and the exporter if useful. Never invent a live workflow code, ledger status, or execution receipt. The provided archive was reviewed statically; it is not evidence of current live state.

## 3. Implement R1 only

1. Reuse `scripts/capabilityCatalogExport.js` and its existing package/schema. Inspect its actual CLI/ToolResult contract before registration.
2. Confirm or add a dedicated catalogue permission where needed. Register exactly one `capability_catalog_export` Tool with accurate metadata. It reads database state and writes fixed generated artifacts; it accepts no arbitrary SQL, destination path, credentials, or executable override. Do not expand permissions broadly for convenience.
3. Add the Tool to Repo Map & Zip and both discovered Development Promotion variants through supported versioned registration paths and/or new globally numbered idempotent seeds. Preserve existing published versions and historical executions. Preserve commit/merge/sync/host-sync, approval behavior, retry, packaging, and summary behavior in R1; approval simplification belongs to R6.
4. Place catalogue generation before any zip that must contain the refreshed catalogue, and wire its output into the final summary. Confirm actual artifact inclusion/exclusion rules. If outputs are intentionally external to the zip, report that explicitly and provide their paths/hashes.
5. Use registered mutation capabilities wherever available. Until R2 acceptance, use the documented D1 CLI PLAN/APPLY bootstrap path for required numbered changes against the pinned DEV database, retaining current technical checks and fresh plan digest. Do not use ad-hoc SQL or db:build. Do not edit applied files. Existing required local bootstrap configuration may be reconciled within the approved task; do not introduce additional permission flags or bypass controls.
6. Perform required scoped configuration/runtime work autonomously. Preserve secret values and never emit them. Rebuild/restart only affected services if necessary.
7. Run the registered catalogue Tool and permitted Repo Map & Zip workflow; verify normal execution records and the `capability_catalog_summary.v1` result. Repeat to establish safe rerun behavior. If an existing workflow is genuinely unavailable, use the documented authorized bootstrap mechanism, report that limitation, and do not claim its workflow acceptance passed.
8. Validate JSON structure and XLSX contents, redaction, source/environment metadata, counts against live state, artifact paths and hashes, and packaging freshness. Reuse existing exporter self-tests and focused registration/workflow tests; run the repository's required validation profile. Keep unrelated baseline failures visible.
9. Inspect both new promotion workflow versions and validate graph/parameter/summary integration without executing promotion. Promotion execution is reserved for a later explicit user instruction. Report this as configuration/static validation, not end-to-end promotion acceptance.
10. Regenerate catalogue/map/zip after final code/registration changes. Inspect final source diff and confirm no secrets or unrelated modifications entered artifacts.

## 4. Acceptance and stop boundary

R0: new files installed, links resolve, one active authority set, local-versus-managed scope clear, Phase 1 still blocked.

R1: exactly one catalogue Tool registration; successful structured Tool execution; Repo Map & Zip refreshes required outputs; both actual promotion variants contain validated catalogue integration in new immutable versions; repeated permitted runs are safe; JSON/XLSX validated; evidence retained. Do not execute promotion merely to test its wiring.

R2 findings (SQL byte verification and NO_CHANGES behavior) are scheduled work, not a reason to implement R2 in this work order. For R1 bootstrap, inspect PLAN first and invoke APPLY only if changes are pending. If a genuine D1 defect prevents safe R1 completion, report the exact blocker; do not silently alter D1 scope or weaken checks.

If DEV Finalization does not yet exist, complete the equivalent currently authorized validation/artifact actions and state that fact. Its absence at R1 is expected. Never label R5/R8 accepted prematurely.

## 5. Completion report

Return a concise report covering:

- installed governance and files added/modified/removed;
- configuration key names only and runtime actions;
- exact live workflow codes and old/new versions;
- Tool registration/permission and run IDs;
- migrations/seeds applied, database identity and ledger results;
- tests/validation with exact outcomes and baseline failures;
- JSON/XLSX/map/zip paths and hashes;
- promotion graph verification, explicitly noting promotion was not executed;
- final Git status/diff summary, discrepancies, and R0/R1 acceptance status.

Then stop for Paul/Sky review. No direct mutating Git commands. No promotion. No R2 or Phase 1 implementation.
