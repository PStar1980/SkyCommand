# AGENTS.md — SkyCommand Autonomous Development Agent Rules

Read and follow `docs/development/SkyCommand_Development_Operating_Rules_v1.2.md` before making changes.

During the Autonomous DEV remediation, also follow:
`docs/development/SkyCommand_Autonomous_DEV_Workflow_Remediation_Plan_v1.1.md`

The authoritative long-range Agentic AI roadmap remains:
`docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.1_APPROVED.md`

Where the older development rules required repeated human approval for routine `DEV_LOCAL` work, the v1.2 operating rules supersede that procedure.

## Approved September 16 transition

These rules govern operator-authorized local remediation. Future SkyCommand-managed Agent Runs still require the isolated workspaces and authority boundaries in the architecture; local checkout/host access does not transfer to those runs.

Complete only the assigned remediation step(s). The initial handoff authorizes R0 installation and R1 implementation, then stop. Later steps require their own scoped work orders. Agentic AI Phase 1 remains blocked until R8 acceptance, and promotion always requires a separate explicit promotion instruction.

Until R2 acceptance, the plan's bootstrap allowance permits D1 CLI PLAN/APPLY for required canonical DEV migrations/seeds, retaining identity pins, digest checks, and technical gates. Do not invent an unavailable registered tool or workflow. When a capability exists, use it. This allowance does not authorize destructive rebuilds or ad-hoc SQL.

As the assigned steps implement them, enforce the v1.2 contracts: exact verified SQL bytes; verified no-op; per-file recovery; typed/allowlisted atomic configuration reconciliation; credential-bound ownership; idempotent workflow starts; durable conditional runtime restart; and promotion tied to reviewed source evidence. Non-secret settings are not blanket authority to change targets, permissions, or authentication.

## Prime directive

SkyCommand development automation exists to remove routine human intervention.

For an explicitly assigned `DEV_LOCAL` task, the task instruction authorizes the agent to complete the work end-to-end within the assigned scope. The agent must not stop to ask Paul to perform routine implementation steps that the agent can perform through an allowed local action, registered Tool, or permitted Workflow.

Normal sequence:

1. Receive one scoped implementation instruction.
2. Inspect repository/runtime reality.
3. Make the required source/configuration changes.
4. Perform all required local development operations autonomously.
5. Run the required finalization/validation Workflow.
6. Verify final state and evidence.
7. Report the completed result and stop for Paul/Sky review.

Human review belongs at the end of the development turn, not between routine implementation steps.

## Workflow-first execution

- SkyCommand Workflows are the preferred orchestration boundary.
- Agent identities are granted server-side permission to specific Workflows.
- If the current agent is permitted to run a Workflow, invoking that Workflow requires no additional per-run human approval unless the Workflow represents an explicitly separately authorized environment or release boundary.
- When a registered Workflow or Tool already performs an operation, use it rather than recreating the operation with direct shell/database/Git calls.
- When the Autonomous DEV finalization Workflow exists, run it before stopping after a source/configuration change.
- The agent may autonomously poll/inspect its own Workflow runs, retry recoverable nodes according to registered retry policy, and collect the final structured result.
- Development Promotion is separate from the implementation turn. Start it only when the user's instruction explicitly includes promotion. Once promotion is authorized by that instruction and started through an allowed Workflow, do not require a second human approval inside the same DEV promotion run.

## Allowed inside an assigned DEV_LOCAL task

The agent may, without additional human intervention:

- read and edit repository source files within task scope;
- read/query the development database, including schema/catalog/metadata inspection;
- create new additive, idempotent, globally numbered migrations and seeds;
- apply pending approved-by-policy repository migrations/seeds to the pinned development database through the registered database-upgrade Tool/Workflow;
- update the local `.env` when required by the task and keep `.env.example` aligned for non-secret configuration;
- rebuild/restart required local Docker services;
- run registered Tools, Workflows, Playwright tests/automations, validation scripts, and test suites allowed to the agent;
- generate Repo Map, Repo Zip, Capability Catalogue, logs, diffs, receipts, and other development evidence;
- inspect Git status/diff/log/history;
- perform other non-destructive local operations necessary to complete and validate the assigned task.

## Database rules

- Read-only database access is allowed for development work.
- Do not run `npm run db:build` against an existing development database.
- Do not perform ad-hoc `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `DROP`, or other mutating SQL outside a source-controlled migration/seed or a separately registered purpose-built Tool.
- Database mutations for normal development must flow through source-controlled numbered migrations/seeds and the database-upgrade execution path.
- Applied historical migrations/seeds are immutable.
- Preserve ordinal, checksum, database identity, execution ledger, structured result, and failure evidence.
- A migration/seed execution failure must stop that database mutation path and report evidence; do not hide or bypass drift.

## Environment/configuration rules

- The agent may update the live local `.env` when required to make the assigned DEV task runnable.
- Never print, summarize, copy into chat/output, commit, or persist secret values into tracked files or structured results.
- Preserve unrelated `.env` values.
- Prefer updating existing configuration over introducing a new environment variable.
- Do not create per-operation approval flags when Workflow/Tool permission already expresses authority.
- `.env.example` contains non-secret defaults/documentation only; `.env` remains local and untracked.
- Configuration tooling must report which keys changed, not secret values.

## Git and promotion

- Do not directly run mutating Git commands such as commit, merge, push, pull, rebase, reset, checkout/switch, branch deletion, or tag mutation unless a future operating-rule revision explicitly allows them.
- Use registered SkyCommand Development Promotion Workflow(s) for source-control mutation.
- A normal implementation instruction does not imply promotion.
- A user instruction to promote is sufficient authorization to start the permitted DEV promotion Workflow and allow that Workflow to complete its registered DEV steps without another Paul approval checkpoint.
- Production deployment/publication remains outside this DEV rule.

## Hard boundaries

Without a separate explicit instruction, do not:

- operate against production or another non-DEV environment;
- run destructive database rebuild/reset operations;
- mutate database state outside registered migrations/seeds or a purpose-built allowed Tool;
- expose secrets;
- perform unrelated destructive host/OS/network actions;
- expand the assigned task into another roadmap phase;
- bypass SkyCommand permissions or fabricate authority.

## Completion contract

Before stopping, the agent must:

1. run the required autonomous DEV finalization Workflow when available;
2. verify database/configuration/runtime state relevant to the task;
3. run appropriate validation/tests;
4. retain structured Tool/Workflow receipts and material evidence;
5. report files changed, database/configuration actions, Workflows run, validation results, discrepancies, final Git status, and concise diff summary;
6. stop for Paul/Sky review.

Routine execution is autonomous. Review and direction remain human.
