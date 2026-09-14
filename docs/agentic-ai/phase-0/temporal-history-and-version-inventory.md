# Phase 0 Temporal and history inventory

## Current seams

| Concern                 | Repository evidence                                                                   | Phase 0 disposition                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Workflow graph executor | `packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js`               | Preserve current dispatch; reserve a versioned Agent branch for a later phase     |
| Workflow activities     | `packages/temporal/src/activities/skyCommandWorkflowActivities.js`                    | Preserve activity aliases/history; no Agent activity is registered                |
| Temporal worker         | `packages/temporal/src/worker.js`                                                     | Inventory only; no task queue or worker behavior change                           |
| Workflow self-tests     | `tests/self/apps/api/src/services/workflowNodeRecoverySelfTest.js` and related suites | Include in regression inventory; no replay fixture claimed as production evidence |
| Browser Temporal path   | `packages/browser/src/temporal/{workflows,activities}.js`                             | Preserve existing Browser Worker/Playwright path                                  |

## Version inventory

- Root `package.json` declares `@temporalio/client`, `@temporalio/worker`, and `@temporalio/workflow` at `^1.18.1`; resolved versions must be pinned/recorded before Phase 2 integration.
- The repository does not provide a deployed worker image digest or representative production Temporal history export in this checkout.
- A stable future Agent Workflow ID is `agent-run/<run-id>`. Temporal execution Run IDs must remain separate from the domain Agent Run ID; immediate orchestration owner and closest Agent ancestor are separate fields.

## Required evidence before execution

Capture sanitized representative histories for existing workflows, verify deterministic replay on the deployed worker/SDK versions, and exercise failpoints around DB commit, outbox delivery, Temporal start, provider operation, cancellation, and finalization. Phase 0 does not start Temporal, create a database, or mutate worker registration.
