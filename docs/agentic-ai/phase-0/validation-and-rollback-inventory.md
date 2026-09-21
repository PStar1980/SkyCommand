# Phase 0 / Phase 19.1 validation and rollback inventory

## Non-destructive validation inventory

| Validation                                | Purpose                                                                                                        | Phase 0 execution status                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `npm run agent-phase0:self-test`          | Validate Phase 0 contracts plus the refreshed v1.2 plan identity, current migration inventory, and Phase 19.1 disabled boundary | PASS |
| `npm run agent-phase19:self-test`         | Validate authority intersection, surface deny dominance, transition intersection, runtime identity, and digest shape | PASS |
| `npm run agent-registry:self-test`        | Validate additive SQL/table boundaries, SUPER_ADMIN-only permission seed, no Agent Run route, path/secret redaction hooks, and preview audit hook | PASS |
| `npm run agent-registry-isolation:self-test` | Exercise actual registry service list/read/preview authorization with two users and two isolated Projects, including the verified admin-all exception | PASS |
| `npm run agent-registry-ui:self-test`     | Validate Agent Projects/Manage Agents routes, navigation, explicit disabled messaging, and absent Run/Session controls | PASS |
| `npm run validate:syntax`                 | Repository JavaScript syntax validation                                                                         | PASS |
| `npm run web:build`                       | Admin-Web production bundle compilation                                                                         | PASS; existing chunk-size warning only |
| `npm run db:upgrade:self-test`             | Governed upgrade-engine transaction, checksum, ledger, and failure-safety checks                               | PASS |
| `npm run db:upgrade:plan`                 | Read-only DEV database plan and drift inspection                                                               | PASS; 0 pending, 22 ledgered, no drift |
| `npm run validate`                        | Existing repository validation/self-test profile                                                                | Reaches test 20/125; stops on the documented unrelated `tool-onboarding:self-test` baseline limitation |
| Existing Assistant/MCP/browser self-tests | Regression protection for the preserved path                                                                   | Run focused suites; no live provider/database mutation  |
| Existing workflow/scheduler self-tests    | Regression protection for current Temporal/scheduler behavior                                                  | Run focused suites; no schedule/database setup          |
| `npm run db:build`                        | Clean database rebuild                                                                                         | Deliberately not run; destructive by design             |
| Live MCP/browser smoke                    | Existing authorized environment evidence                                                                       | Not run without an authorized isolated live environment |

## Baseline validation findings

The current full validation run reaches the new Phase 19.1 tests and stops at test 20/125 on the first existing repository baseline limitation. The findings below are persisted baseline evidence and are explicitly unrelated to Phase 19.1: the referenced application/service files are unchanged, and the failures reproduce outside the Phase 19.1 contract/registry tests.

| Self-test                             | Failure                                                                                                                                                                                                                                              | Classification                                        | Phase 0 disposition            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `auth-expiry-refresh:self-test`       | `Admin-Web refreshes must use the shared API client so session-expiry redirect is universal. Direct fetch callers: apps\\admin-web\\src\\services\\supervisorService.js` at `tests/self/apps/admin-web/src/services/authExpiryRefreshSelfTest.js:63` | Existing, unrelated failure; not a Phase 0 regression | Preserve and report; no change |
| `scheduler-workflow-params:self-test` | `Schedule create/update must validate nested workflow runtime parameters before persistence.` at `tests/self/apps/api/src/services/schedulerWorkflowParametersSelfTest.js:42`                                                                        | Existing, unrelated failure; not a Phase 0 regression | Preserve and report; no change |
| `tool-onboarding:self-test`           | `Tool onboarding static-analysis assertion rejects an existing finalizationReceiptSha256 reference in the unchanged Workflow Executor service.` at `tests/self/apps/api/src/services/toolOnboardingSelfTest.js:281` | Existing, unrelated failure; not a Phase 19.1 regression | Preserve and report; no change |

## Rollback

Phase 19.1 changes are additive source-controlled contracts, registry SQL, permission seed, provider-neutral evaluator, API/UI metadata surfaces, tests, and evidence. Database changes must be reversed only through a separately reviewed additive rollback migration or restored DEV database; no direct SQL rollback or destructive rebuild is authorized. Because execution flags remain false and no Agent Run state exists, no Agent worker drain is required. Later phases must close entry gates first, preserve active history compatibility, and never roll back to weaker code while Agent traffic is active.

## Deferred evidence

Deployed schema/view/permission inventory, restored-copy upgrade proof, representative Temporal histories, pinned provider protocol schemas/binaries, containment experiments, production environment registrations, credential storage conventions, and authorized MCP/browser smoke evidence remain required before later enablement gates. Phase 19.1 does not satisfy those later execution gates.
