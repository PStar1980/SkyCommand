# Phase 0 security and observability decisions

## Decisions applied to the preparation artifacts

1. Agent execution remains disabled. Phase 0 adds no route, worker, credential broker, runtime process, schedule target, workflow node, or production permission.
2. The current Host Agent is treated as a privileged infrastructure principal, not an AI Agent runtime. Future AI runtime workers must use a distinct security principal and containment boundary.
3. Authority is an intersection of user/run-as principal, caller grant, Agent revision, Project, invocation, environment, runtime/account data-release rules, containment, and requested narrowing. Approval is an obligation inside that ceiling.
4. Identity fields are immutable evidence: initiating user, initiating actor, immediate requesting actor, executing Agent, root, parent, orchestration owner, and trigger source are not interchangeable.
5. Provider session IDs never substitute for SkyCommand Run IDs. Provider sends are uncertain until reconciled; cancellation revokes future authority before physical stoppage is reported.
6. Telemetry carries source, scope, freshness, and availability. Unknown usage/quota/context/cost/model/reasoning stays unknown; progress text is not evidence.
7. Existing Tool, Workflow, Scheduler, Access Control, MCP, and Playwright behavior is preserved. Managed-linked reads will require resource ACLs in later phases; legacy Assistant compatibility is explicit and browser-only.

## Mandatory audit/evidence vocabulary

Use explicit availability values such as `REPORTED`, `NOT_REPORTED`, `UNSUPPORTED`, and `UNKNOWN`; do not coerce absent values to zero. Record correlation IDs, authority digest, policy revisions, source event identity/cursor, command/operation IDs, and stop/reconciliation evidence. Results and artifacts are immutable after terminal publication; late telemetry is an evidence revision.

## Open owner decisions

The plan leaves deployment isolation/OS topology, provider account ownership, data classification destinations, retention/readers, human responders, limits, and Codex protocol support as review decisions. They remain `REQUIRES REVIEW` and do not become implementation defaults in Phase 0.
