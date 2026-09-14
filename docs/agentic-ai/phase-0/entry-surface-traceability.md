# Phase 0 entry-surface-to-service traceability

This matrix records the planned single admission/authorization boundary without enabling any new entry surface.

| Entry surface             | Current repository seam                                                                | Future common service                                            | Phase 0 status      | Preservation rule                                         |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------- | --------------------------------------------------------- |
| Manual Admin-Web          | Existing authenticated API routes and Admin-Web pages                                  | Agent Execution Service                                          | Design only         | Do not add a start control or route                       |
| Workflow                  | `packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js` and activities | Admission activity + real child Agent workflow in a later phase  | Design only         | Existing node dispatch/history remains unchanged          |
| Scheduler                 | `apps/worker/src/schedulers/schedulePoller.js` and scheduled runners                   | Occurrence claim + common admission                              | Design only         | Existing ONCE/INTERVAL behavior remains unchanged         |
| MCP/Assistant bridge      | `scripts/mcp/skycommandMcpGateway.js`, Assistant middleware/service/routes             | Bounded capability authorization using a managed run grant later | Design only         | Legacy Assistant mode remains browser-only and compatible |
| Future external Assistant | No production boundary in this checkout                                                | Separately gated external adapter                                | Deferred to Phase 9 | No public transport or connector assumption               |

## Ownership rule

Only SkyCommand will admit Agent Runs. Runtime adapters will translate protocol and telemetry only. Existing Browser Automation → Temporal → Browser Worker → Playwright behavior remains the capability path. The current Host Agent is a privileged infrastructure service and is not an AI Agent runtime.

## Server-derived context

Public request fields may contain task input, selected registered identifiers, requested narrowing, and an idempotency key. The server must derive authenticated actor, sponsoring user/run-as user, Project membership, Agent revision, root/parent lineage, permissions, runtime/account grants, provider credentials, workspace paths, and effective authority. Client-supplied identity, permission, root/parent IDs, provider thread IDs, raw filesystem paths, and credentials are never authoritative.
