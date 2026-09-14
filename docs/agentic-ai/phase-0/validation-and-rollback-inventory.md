# Phase 0 validation and rollback inventory

## Non-destructive validation inventory

| Validation                                | Purpose                                                                                                        | Phase 0 execution status                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `npm run agent-phase0:self-test`          | Validate every Phase 0 schema, positive/negative contract examples, fake-runtime divergence, and disabled gate | Required and safe                                       |
| `npm run validate`                        | Existing repository validation/lint/build checks                                                               | Run after Phase 0 changes if dependencies permit        |
| Existing Assistant/MCP/browser self-tests | Regression protection for the preserved path                                                                   | Run focused suites; no live provider/database mutation  |
| Existing workflow/scheduler self-tests    | Regression protection for current Temporal/scheduler behavior                                                  | Run focused suites; no schedule/database setup          |
| `npm run db:build`                        | Clean database rebuild                                                                                         | Deliberately not run; destructive by design             |
| Live MCP/browser smoke                    | Existing authorized environment evidence                                                                       | Not run without an authorized isolated live environment |

## Baseline validation findings

The full validation run reached the existing repository self-test suite and stopped at test 57/102. These findings are persisted baseline evidence and are explicitly unrelated to Phase 0: no referenced application/service file was modified by this pass, and both failures reproduce outside the Phase 0 contract test.

| Self-test                             | Failure                                                                                                                                                                                                                                              | Classification                                        | Phase 0 disposition            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `auth-expiry-refresh:self-test`       | `Admin-Web refreshes must use the shared API client so session-expiry redirect is universal. Direct fetch callers: apps\\admin-web\\src\\services\\supervisorService.js` at `tests/self/apps/admin-web/src/services/authExpiryRefreshSelfTest.js:63` | Existing, unrelated failure; not a Phase 0 regression | Preserve and report; no change |
| `scheduler-workflow-params:self-test` | `Schedule create/update must validate nested workflow runtime parameters before persistence.` at `tests/self/apps/api/src/services/schedulerWorkflowParametersSelfTest.js:42`                                                                        | Existing, unrelated failure; not a Phase 0 regression | Preserve and report; no change |

## Rollback

Phase 0 changes are additive source-controlled contracts, fixtures, documentation, and one test script. Removing the Phase 0 files and script restores the pre-change runtime surface; no database rollback or worker drain is required. The existing application has no dependency on the new artifacts. Later phases must close entry gates first, preserve active history compatibility, and never roll back to weaker code while Agent traffic is active.

## Deferred evidence

Deployed schema/view/permission inventory, restored-copy upgrade proof, representative Temporal histories, pinned Codex/OpenClaw protocol schemas/binaries, containment experiments, production environment registrations, credential storage conventions, and authorized MCP/browser smoke evidence remain required before later enablement gates.
