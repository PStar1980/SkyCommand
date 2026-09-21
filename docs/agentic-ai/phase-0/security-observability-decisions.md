# Phase 0 security and observability decisions

## Decisions applied to the preparation artifacts

1. Agent execution remains disabled. Phase 19.1 adds registry and advisory-preview routes only; it adds no worker, credential broker, runtime process, schedule target, workflow node, Agent Run/Session route, or production permission.
2. The current Host Agent is treated as a privileged infrastructure principal, not an AI Agent runtime. Future AI runtime workers must use a distinct security principal and containment boundary.
3. Authority is an intersection of user/run-as principal, caller grant, Agent revision, Project, invocation, environment, runtime/account data-release rules, containment, and requested narrowing. Approval is an obligation inside that ceiling.
4. Identity fields are immutable evidence: initiating user, initiating actor, immediate requesting actor, executing Agent, root, parent, orchestration owner, and trigger source are not interchangeable.
5. Provider session IDs never substitute for SkyCommand Run IDs. Provider sends are uncertain until reconciled; cancellation revokes future authority before physical stoppage is reported.
6. Telemetry carries source, scope, freshness, and availability. Unknown usage/quota/context/cost/model/reasoning stays unknown; progress text is not evidence.
7. Existing Tool, Workflow, Scheduler, Access Control, MCP, and Playwright behavior is preserved. Managed-linked reads will require resource ACLs in later phases; legacy Assistant compatibility is explicit and browser-only.
8. Request-level execution-surface authority is distinct from capability authority. Availability of Computer Use, browser control, Apps/Plugins, remote-device access, MCP, local shell, or another interface does not grant permission to use it. Surface transitions preserve the same operation/retry/idempotency context and must be observable.
9. Human UI and authorized agent surfaces converge on the same governed Tool/Workflow/preflight/recovery/receipt semantics; agent governance must not create an agent-only operational path.
10. Runtime-dependent acceptance records source/configuration/capability identity and effective process generation/freshness so stale runtime state can be reconciled without being mislabeled as source drift.
11. Phase 19.1 records `CURRENT`, `STALE_RECONCILABLE`, `STALE_BLOCKED`, and `UNKNOWN` runtime freshness explicitly. `UNKNOWN` is preserved; preview cannot synthesize health or enable execution.
12. Phase 19.1 audit metadata contains safe IDs, policy revisions, authority digest, denial count, eligibility reasons, and the disabled execution outcome; repository roots, credentials, and secret values are excluded.

## Mandatory audit/evidence vocabulary

Use explicit availability values such as `REPORTED`, `NOT_REPORTED`, `UNSUPPORTED`, and `UNKNOWN`; do not coerce absent values to zero. Record correlation IDs, authority digest, policy revisions, requested/effective execution surface, surface-transition reason, human intervention, runtime source/configuration/capability identity and generation/freshness where applicable, source event identity/cursor, command/operation IDs, and stop/reconciliation evidence. Results and artifacts are immutable after terminal publication; late telemetry is an evidence revision.

## Open owner decisions

The plan leaves deployment isolation/OS topology, provider account ownership, data classification destinations, retention/readers, human responders, limits, and Codex protocol support as review decisions. They remain `REQUIRES REVIEW` and do not become implementation defaults in Phase 0.
