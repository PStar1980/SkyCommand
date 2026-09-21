# AGENTS.md — SkyCommand Autonomous Development Agent Rules

Read and follow `docs/development/SkyCommand_Development_Operating_Rules_v1.5.md` before making changes.

R0–R8 Autonomous DEV remediation is accepted historical evidence. The retired remediation plan is not an active working-tree authority and does not need to remain in the current repository.

The authoritative long-range Agentic AI roadmap remains:
`docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.2_APPROVED.md`

Use the current development request/work-order template when preparing new implementation instructions:
`docs/development/Codex_Development_Work_Order_Template.md`

The v1.5 Operating Rules supersede earlier active development-governance procedures where they conflict.

## Current development baseline

R0–R8 are complete and establish the accepted Autonomous DEV implementation, finalization, recovery, and promotion baseline. Agentic AI Phase 1 may now proceed only through separately scoped work orders under the approved architecture.

These rules govern operator-authorized local development in the approved `DEV_LOCAL` checkout. Future SkyCommand-managed Agent Runs remain subject to the isolation and authority boundaries in the long-range architecture; local checkout/host access does not automatically transfer to managed agents.

Complete only the assigned work order/phase. A normal implementation instruction does not authorize promotion. Promotion requires a separate explicit user instruction. Production or non-DEV effects require separate authorization.

## Prime directive

SkyCommand development automation exists to remove routine human intervention.

For an explicitly assigned `DEV_LOCAL` task, the task instruction authorizes the agent to complete the work end-to-end within the assigned scope and request-level execution-surface policy. The agent must not stop to ask Paul to perform routine implementation steps that the agent can perform through an authorized local action, registered Tool, or permitted Workflow.

Normal implementation sequence:

1. Receive one scoped implementation instruction.
2. Read its request-level execution-surface policy.
3. Inspect repository/runtime reality.
4. Make the required source/configuration changes.
5. Perform all required authorized local development operations autonomously.
6. Run the registered **Dev Change Finalization** Workflow.
7. Verify final state, receipts, structured results, and generated evidence.
8. Report the completed reviewable DEV result and stop for Paul/Sky review.

Human review belongs at the end of the development turn, not between routine implementation steps.

## Request-level execution surfaces

Execution-surface authority is defined per request/work order, not by the mere existence of a global Codex/ChatGPT capability.

- A connected or available capability is not authorization to use it.
- Global Computer Use, browser control, remote-device access, connected Apps/Plugins, MCP servers, authenticated browser sessions, and local applications remain available only when the current request permits their use.
- The work order may allow, deny, restrict to read-only, or require additional explicit approval for each execution surface.
- Do not switch to Computer Use, browser control, a connected App/Plugin, or another more privileged surface merely because the preferred SkyCommand/MCP/Tool path is denied, unavailable, stale, or failing.
- A permission failure on one surface does not create authority on another surface.
- If the current request explicitly permits fallback or surface substitution, the agent may use that fallback within the same task authority and retry/recovery budget, and must report the transition.
- Surface permissions never override operation-level hard boundaries such as production restrictions, direct Git mutation rules, database mutation rules, promotion boundaries, or secret handling.
- When an authorized browser/Computer Use action invokes SkyCommand UI controls, the underlying SkyCommand Workflow/Tool/recovery action remains the governed operation and should be tied to its durable receipt when possible.

If a legacy request omits an execution-surface section, use only the ordinary repository/local-shell and explicitly permitted SkyCommand Tool/Workflow surfaces needed for the task. Do not infer authorization for Computer Use, browser control, remote-device control, or connected-App mutation.

## Workflow-first execution

- SkyCommand Workflows are the preferred orchestration boundary.
- Agent identities are granted server-side permission to specific Workflows and Tools.
- If the current agent is permitted to run a Workflow and the current request permits that execution surface, invoking that Workflow requires no additional per-run human approval unless the Workflow represents a separately authorized environment/release boundary.
- MCP/API connectivity does not create authority by itself. Use the registered identity/context and SkyCommand permission checks.
- When a registered Workflow or Tool already performs an operation, use it rather than recreating the operation with direct shell/database/Git calls.
- Run **Dev Change Finalization** before stopping after a source/configuration development change unless the assigned work order explicitly establishes another accepted boundary.
- The agent may autonomously poll/inspect its own Workflow runs, use registered recovery/retry behavior, and collect final structured results when the work order authorizes those surfaces/actions.

## Development Promotion

Development Promotion is separate from the implementation turn.

When the user explicitly says to promote a reviewed DEV change:

- that instruction is the promotion authorization event;
- promotion must bind to a successful reviewed Dev Change Finalization receipt;
- the permitted DEV promotion Workflow may start without another redundant Paul approval checkpoint;
- promotion preflight must verify reviewed source/SQL/config/database/branch identity before Git mutation;
- drift invalidates the reviewed promotion state and requires fresh finalization/review;
- source-control mutation remains workflow-owned.

The critical workflow-owned promotion order is:

**Verify DEV Promotion Preflight → promotion artifact refresh → Dev Commit → Merge GitHub Dev PR → Repo Merge / Sync → Local Repository Sync → Development Promotion Summary**

Registered variants may include additional non-mutating governance/evidence nodes, but they must preserve this mutation ordering.

`Merge GitHub Dev PR` owns the governed `dev -> main` GitHub PR merge boundary. Agents must not replace it with direct Git/GitHub mutation or ask Paul to perform the same merge manually once promotion has already been explicitly authorized.

## Human and agent parity

The same server-side development Workflows must remain usable by Paul through the SkyCommand UI as well as by authorized agents through MCP/API. Agent execution-surface restrictions do not prohibit Paul from manually running **Dev Change Finalization**, **Dev Promotion Local**, or permitted recovery controls.

Human UI execution and agent execution must converge on the same authoritative Workflow definitions, preflights, permission checks, receipts, and evidence. Do not introduce agent-only ceremony that makes the normal human development path unusable.

## Allowed inside an assigned DEV_LOCAL task

Subject to the request-level execution-surface policy, the agent may, without additional human intervention:

- read and edit repository source files within task scope;
- read/query the development database, including schema/catalog/metadata inspection;
- create new additive, idempotent, globally numbered migrations and seeds;
- apply pending reviewed-by-policy repository migrations/seeds to the pinned development database through the registered database-upgrade Tool/Workflow;
- update the local `.env` when required by the task and keep `.env.example` aligned for safe non-secret configuration;
- use the registered configuration-reconciliation capability for typed/allowlisted non-secret changes;
- rebuild/restart required local Docker services through allowed runtime/Host Agent capabilities;
- run registered Tools, Workflows, Playwright tests/automations, validation scripts, and test suites allowed to the agent;
- generate Repo Map, Repo Zip, Capability Catalogue, receipts, logs, diffs, and other development evidence;
- inspect Git status/diff/log/history;
- perform other non-destructive local operations necessary to complete and validate the assigned task.

## Database rules

- Read-only database access is allowed for development work.
- Do not run `npm run db:build` against an existing development database.
- Do not perform ad-hoc `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `DROP`, or other mutating SQL outside a source-controlled migration/seed or separately registered purpose-built Tool.
- Database mutations for normal development must flow through source-controlled numbered migrations/seeds and the registered database-upgrade execution path.
- Applied historical migrations/seeds are immutable.
- Preserve ordinal, checksum, exact-byte execution, database identity, execution ledger, structured result, and failure evidence.
- A migration/seed execution failure must stop that database mutation path and report evidence; do not hide or bypass drift.

## Environment/configuration rules

- The agent may update the live local `.env` when required to make the assigned DEV task runnable.
- Keep `.env.example` and `.env` aligned for applicable non-secret keys when the task introduces or changes such configuration; preserve local-only/secrets and unrelated values.
- Never print, summarize, copy into chat/output, commit, package, or persist secret values into tracked files or structured results.
- Preserve unrelated `.env` values and comments where practical.
- Prefer updating existing configuration over introducing a new environment variable.
- Do not create per-operation approval flags when Workflow/Tool permission already expresses authority.
- `.env.example` contains non-secret defaults/documentation only; `.env` remains local and untracked.
- Configuration tooling must report key names/classification, never secret values.

## Runtime freshness and reconciliation

- Treat source/configuration correctness and effective running-process state as separate facts.
- When relevant, verify the running API/worker/Host Agent/MCP/runtime generation against the reviewed source/configuration/capability state.
- A stale runtime is not automatically source drift.
- When the work order authorizes routine DEV lifecycle work, use the governed reconcile/rebuild/restart/refresh path rather than stopping to ask Paul to perform it manually.
- Preserve the same operation/retry/authorization context across any permitted interface or lifecycle recovery, and report the resulting runtime evidence.

## Git and promotion

- Do not directly run mutating Git commands such as commit, merge, push, pull, rebase, reset, checkout/switch, branch deletion, tag mutation, or direct GitHub PR mutation unless a future Operating Rules revision explicitly allows them.
- Use registered SkyCommand Development Promotion Workflow(s) for source-control mutation.
- A normal implementation instruction does not imply promotion.
- A user instruction to promote is sufficient authorization to start the permitted DEV promotion Workflow and allow that Workflow to complete its registered DEV steps without another Paul approval checkpoint.
- Production deployment/publication remains outside this DEV rule.

## Recovery and retry semantics

- Recovery authority belongs to the underlying operation/run, not to the interface used to invoke it.
- Switching from MCP/API to UI/Computer Use, or between any other permitted surfaces, does not create a fresh retry budget.
- Prefer recovery of the existing durable Workflow/run when the work order permits recovery.
- Do not create a replacement run merely because another surface is available unless the work order explicitly authorizes a replacement.
- Preserve completed checkpoints and report the exact surface used for each recovery action when surface substitution occurs.

## Hard boundaries

Without a separate explicit instruction, do not:

- operate against production or another non-DEV environment;
- run destructive database rebuild/reset operations;
- mutate database state outside registered migrations/seeds or a purpose-built allowed Tool;
- expose secrets;
- perform unrelated destructive host/OS/network actions;
- expand the assigned task into another remediation/roadmap phase;
- bypass SkyCommand permissions, preflight/review binding, or fabricate authority;
- use an unapproved execution surface as a workaround for a denied or unavailable authorized path.

## Completion contract

Before stopping an implementation turn, the agent must:

1. run the required Dev Change Finalization Workflow when available;
2. verify database/configuration/runtime state relevant to the task;
3. run appropriate validation/tests;
4. retain structured Tool/Workflow receipts and material evidence;
5. report files changed, database/configuration actions, Workflows run, validation results, discrepancies, final Git status, concise diff summary, and execution surfaces used;
6. explicitly disclose any Computer Use, browser control, connected App/Plugin, remote-device control, or other surface substitution used during the task;
7. stop for Paul/Sky review.

After a separately authorized promotion, the agent must observe the promotion to terminal state, report the final promotion receipt and branch/SHA/PR/synchronization evidence, then stop.

Routine execution is autonomous. Review, promotion intent, request-level surface authority, governance changes, and release direction remain human.
