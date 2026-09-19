# SkyCommand Development Operating Rules v1.3

**Status:** Active development governance  
**Revision:** 2026-09-18 — Post-R6 autonomous DEV promotion baseline  
**Supersedes:** `SkyCommand_Development_Operating_Rules_v1.2.md`  
**Applies to:** Paul, Sky/ChatGPT, Codex/Luna/Astra, future coding agents, and any agent operating on the SkyCommand repository  
**Long-range architecture authority:** `docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.1_APPROVED.md`  
**Immediate pre-Phase-1 remediation authority:** `docs/development/SkyCommand_Autonomous_DEV_Workflow_Remediation_Plan_v1.1.md`

## Transition scope and precedence

R0–R6 establish the accepted Autonomous DEV implementation and promotion baseline. R7 cleanup and R8 one-instruction acceptance remain separate scoped remediation steps. Agentic AI Phase 1 remains blocked until R8 acceptance.

These operating rules govern the operator-authorized local Codex/Luna development workflow in the approved DEV checkout. The long-range architecture governs future SkyCommand-managed Agent Runs: those agents remain isolated from the live checkout, control-plane secrets, Docker socket, and privileged Host Agent. Their writable access begins only through the certified Phase 3.5 managed-workspace path. Local operator access does not become blanket authority for managed agents.

The assigned work order limits implementation scope. R0–R8 are sequential acceptance gates, not blanket permission to implement every phase. Required routine operations within an assigned step remain autonomous. R2's bootstrap exception is closed: the registered database-upgrade capability is now the normal mutation path for canonical DEV migrations/seeds. R3 configuration reconciliation, R4 governed agent execution, R5 Dev Change Finalization, and R6 governed promotion are the normal accepted DEV boundaries where applicable.

No instruction here overrides runtime access controls. A genuine inaccessible capability is a blocker, not a request for a ceremonial second approval.

## 1. Purpose and operating principle

SkyCommand is a workflow-automation and development command-center application. Development automation must reduce human work, not create approval bureaucracy.

The default `DEV_LOCAL` operating model is:

> One scoped instruction starts one autonomous development turn. The coding agent completes all routine implementation, configuration, database, runtime, validation, evidence, and permitted Workflow actions required by that instruction. Paul reviews the completed result afterward.

Paul is not a required intermediate step in routine local development execution.

The system should prefer:

- permissioned Workflows over manual procedures;
- deterministic Tools/nodes over repeated shell instructions;
- structured evidence over human confirmation;
- auditability over approval ceremony;
- environment-scoped standing permissions over per-operation feature flags;
- idempotent migrations/seeds over ad-hoc database mutation.

## 2. Development ownership and task authority

- Paul owns product direction, final acceptance, promotion intent, release intent, and changes to these governance rules.
- Sky/ChatGPT owns continuity, architecture review, implementation review, work-order design, correction guidance, and phase acceptance with Paul.
- Architecture/reasoning agents may propose plans, but Paul/Sky determine the controlling plan.
- Implementation agents execute only the explicitly assigned task/phase.
- An agent must not silently continue into the next roadmap phase.
- Within an assigned `DEV_LOCAL` task, the work order itself authorizes the routine local operations necessary to complete that task, subject to the hard boundaries in these rules.
- An implementation agent must not stop merely because a routine step requires a database upgrade, local `.env` reconciliation, local Docker rebuild/restart, validation run, artifact generation, or an allowlisted SkyCommand Tool/Workflow.

## 3. Workflow-centered authority model

### 3.1 Workflow permission is the normal execution grant

- Agents are granted server-side permission to specific SkyCommand Workflows and Tools.
- A permitted Workflow/Tool may be called autonomously by the agent without a second human approval for each invocation.
- MCP/API connectivity never creates authority by itself; authority comes from the registered agent identity/context plus SkyCommand permission checks.
- The same Workflow must behave consistently whether initiated by UI, scheduler, API, or an authorized agent, while preserving initiating actor and execution context.
- Workflow/Tool execution must emit durable structured evidence.

### 3.2 One development turn

A normal development work order should support this complete loop without Paul intervention:

1. inspect;
2. edit;
3. update local non-secret configuration as required;
4. create migrations/seeds when required;
5. apply pending DEV migrations/seeds through the registered database-upgrade capability;
6. rebuild/restart affected local services when required;
7. run tests/validation;
8. run the autonomous DEV finalization Workflow;
9. collect structured results/artifacts;
10. report completion and stop.

### 3.3 Completion and promotion are separate

A development implementation turn ends in a reviewable DEV state. It does not implicitly promote source.

When Paul later explicitly instructs promotion:

- that instruction is the promotion authorization event for the permitted DEV promotion Workflow;
- promotion must bind to a successful reviewed Dev Change Finalization receipt;
- the promotion preflight must verify reviewed source/SQL/config/database/branch identity before Git mutation;
- drift invalidates the reviewed promotion state and requires fresh finalization/review;
- the agent may start the permitted Workflow and observe/poll it to terminal completion;
- the Workflow must complete its registered DEV promotion path without a second redundant Paul approval checkpoint;
- the final receipt must include commit, GitHub PR/merge, remote synchronization, local synchronization, artifact, actor, and final branch/SHA evidence;
- production deployment/publication remains a separate boundary.

The intended human pattern is therefore:

**instruction → autonomous implementation → human review/testing → promotion instruction → autonomous promotion → receipt.**

## 4. Database development policy

### 4.1 Read access

Inside the authorized development environment, agents may autonomously:

- run `SELECT` queries;
- inspect schemas, catalogs, constraints, migrations, seeds, ledgers, metadata, plans, and execution history;
- use PostgreSQL/system metadata required to understand the development database.

Read-only database access does not require per-query human approval.

### 4.2 Mutation boundary

Normal development database mutation is allowed only through:

1. source-controlled, globally numbered, idempotent migrations/seeds executed by the registered SkyCommand database-upgrade capability; or
2. another explicitly registered purpose-built Tool whose mutation contract is part of the assigned task and agent permission profile.

Agents must not perform ad-hoc database mutations merely because database credentials are available.

Prohibited outside the registered paths include direct arbitrary `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `DROP`, database rebuild/reset, or equivalent mutation.

### 4.3 Upgrade behavior

The DEV database-upgrade capability must:

- discover only approved repository migration/seed roots;
- use the existing global ordinal namespace;
- reject duplicate/malformed ordinals;
- preserve applied historical files as immutable;
- verify SHA-256 checksums and recorded source identity;
- identify pending changes deterministically;
- bind execution to the connected DEV database and its PostgreSQL system identity;
- use locking/revalidation to prevent races;
- apply pending changes in order;
- make each file + ledger receipt atomic;
- never replay an already ledgered identical change;
- fail on drift;
- emit a structured result with before/after ledger state, ordinals, paths, hashes, outcomes, timings, and safe error codes;
- retain an observable history sufficient to answer what ran, when, against which DEV database, and with what result.

This is the normal autonomous DEV path. It must not require a human authorization request, TTL approval envelope, browser click, temporary enable flag, or Docker rebuild solely to grant each migration permission.

### 4.4 Destructive rebuild protection

- `npm run db:build` remains a clean-build/bootstrap utility and must not be run against an existing development database.
- Historical applied migration/seed files remain immutable unless Paul/Sky explicitly authorize an exceptional recovery strategy.

## 5. Local `.env` and configuration policy

### 5.1 Autonomous local configuration

An agent may update the local untracked `.env` when the assigned DEV task requires configuration changes.

The agent should not ask Paul to manually copy routine non-secret values between `.env.example` and `.env`.

### 5.2 Secret handling

- Never print, quote, summarize, export, commit, or persist secret values into tracked files, ToolResults, workflow summaries, generated catalogues, screenshots, or chat output.
- Preserve unrelated existing `.env` values.
- `.env.example` must contain only safe examples/defaults/documentation.
- Secret-required keys without an available authorized source must be reported as a true blocker; the agent must not invent a credential.

### 5.3 Avoid environment-variable sprawl

Environment variables are runtime configuration, not a substitute for SkyCommand permissions or workflow state.

Before adding a new variable, prefer in this order:

1. existing registered Workflow/Tool configuration;
2. repository/environment metadata already stored in SkyCommand;
3. a stable application setting with a clear runtime reason;
4. a new environment variable only when process-start configuration is genuinely required.

Do not add per-invocation approval flags, duplicate permission flags, or temporary ceremony flags when the registered agent/workflow permission already expresses the policy.

As the Autonomous DEV remediation replaces temporary bootstrap gates, obsolete D2 bootstrap variables must be removed from active configuration and documentation rather than accumulated indefinitely.

### 5.4 Environment reconciliation evidence

A local configuration Tool/node should:

- reconcile required non-secret keys deterministically;
- allow the authorized agent to provide task-specific non-secret values when required;
- preserve unrelated keys;
- never return secret values;
- report only safe key names plus added/updated/preserved/removed classification;
- support dry inspection and idempotent repeated execution.

## 6. Docker, host, filesystem, network, and packages

Within an assigned `DEV_LOCAL` task, an agent may autonomously use local Docker lifecycle operations and repository-local commands required to make and validate the change, including rebuilding/restarting affected SkyCommand services.

The agent may use registered Host Agent/local capabilities that are allowlisted to its identity and required by the task.

The following still require a separately scoped reason/instruction:

- destructive host or OS administration;
- access outside approved project/runtime roots;
- arbitrary external network activity unrelated to the assigned task;
- package installation or external downloads not required/authorized by the task;
- any operation against production/non-DEV infrastructure.

Secrets remain subject to Section 5 regardless of tool access.

## 7. Git and Development Promotion

### 7.1 Direct Git mutation

Until explicitly revised, coding agents must not directly execute mutating Git operations such as commit, merge, push, pull, rebase, reset, checkout/switch, branch deletion, or tag mutation.

Read-only Git inspection is allowed.

### 7.2 Workflow-owned source mutation

SkyCommand Development Promotion Workflow(s) are the source-control mutation path.

A normal implementation work order does not imply promotion. The agent prepares a complete reviewable working tree, runs Dev Change Finalization, reports the reviewable state, and stops.

When Paul explicitly instructs promotion, the instruction is sufficient authorization for the permitted DEV promotion Workflow. The Workflow must not introduce an additional redundant human merge-approval pause for the same DEV promotion decision.

The promotion start must bind to the reviewed successful finalization receipt. Promotion preflight must fail closed on source, SQL manifest, non-secret configuration, database, workflow-version, or branch drift. A drifted state requires fresh finalization and review before another promotion decision.

### 7.3 R6 promotion mutation chain

The registered promotion workflow owns the complete Git mutation sequence. The critical ordering is:

1. **Verify DEV Promotion Preflight**;
2. refresh required promotion evidence/artifacts, including Capability Catalogue, Repository Map, and Repository Zip as registered;
3. **Dev Commit**;
4. **Merge GitHub Dev PR**;
5. **Repo Merge / Sync**;
6. **Local Repository Sync**;
7. **Development Promotion Summary** as the terminal summary.

Registered variants may contain additional non-mutating governance/evidence nodes, but they must preserve this mutation ordering and may not introduce a bypass edge around preflight or the GitHub PR merge.

`Merge GitHub Dev PR` is the governed `dev -> main` GitHub PR boundary. It must verify the expected reviewed DEV/main SHAs, operate on the configured repository/branches, perform the registered PR merge behavior, and emit structured PR/merge evidence. The implementation agent must not substitute direct Git/GitHub mutation or require Paul to manually perform the same merge after promotion has already been explicitly authorized.

After the GitHub PR merge, Repo Merge / Sync reconciles the configured remote branch state and Local Repository Sync reconciles the host checkout to the approved remote state. The terminal summary records the resulting source-control evidence.

Promotion must retain:

- actor/instruction attribution;
- bound finalization receipt identity;
- commit message/evidence;
- reviewed and resulting branch/revision evidence;
- workflow/node results;
- GitHub PR/merge evidence;
- remote merge/sync evidence;
- local repository synchronization evidence;
- artifact/catalogue/map/zip evidence;
- final structured summary/receipt.

## 8. Autonomous DEV finalization

SkyCommand provides the registered **Dev Change Finalization** Workflow as the deterministic end of a development turn.

Target responsibility:

1. preflight source validity, required configuration/secret availability, repository/environment identity, and migration manifest;
2. reconcile approved local configuration;
3. verify/apply pending DEV migrations/seeds through the registered upgrade node;
4. conditionally build/restart affected services through a durable host/runtime capability;
5. run validation and runtime/readiness verification against the updated services;
6. export the Capability Catalogue;
7. generate the Repository Map and Repository Zip;
8. emit a durable finalization receipt and structured summary.

The finalization receipt is the canonical reviewed-state binding for subsequent promotion. Generated artifacts must be classified so receipt/ZIP generation does not recursively invalidate source identity. If embedding the canonical receipt inside the ZIP would make its own recorded ZIP hash self-referential, keep the receipt external and bind it to the final ZIP by recorded hash instead.

Nodes may be conditionally skipped when no relevant change exists, but the Workflow should remain idempotent and safe to run after every development turn.

The reasoning agent decides what source/configuration changes are required. The Workflow nodes perform deterministic execution and produce evidence.

## 9. Capability catalogue visibility

SkyCommand maintains generated capability-catalogue snapshots so Paul, Sky, and agents can inspect installed/configured resources without relying on screenshots or memory.

Target generated outputs:

- `docs/generated/SkyCommand_Capability_Catalog.xlsx`
- `docs/generated/SkyCommand_Capability_Catalog.json`

At minimum include registered Tools/parameters, Workflows/versions/nodes/start permissions, Playwright resources, Scheduler targets, repositories/environments, and execution/permission metadata needed to understand what an agent can run.

The JSON companion is the machine-readable view; the spreadsheet is the human-friendly view. Runtime database state remains authoritative.

The `capability_catalog_export` Tool must be registered and incorporated into the appropriate repository/finalization/promotion Workflows.

## 10. Validation, observability, and evidence

- Canonical command/Tool/Workflow receipts are evidence; a model statement alone is not.
- Existing unrelated baseline failures remain visible and must not be relabeled as current regressions.
- Newly introduced unexplained failures block completion.
- Preserve relevant structured outputs, migration ledger entries, execution receipts, workflow runs, test results, artifact hashes, diffs, and source revision evidence.
- Observability must not require a human to authorize every normal DEV action.
- Failure evidence should identify the failed boundary and safe error code without leaking secrets.
- Generated snapshots should identify source revision, environment, generation time, and data source.

## 11. Stop conditions

### 11.1 Do not stop for routine work

Do not stop merely to ask Paul to:

- apply a numbered migration/seed;
- copy routine non-secret `.env` values;
- rebuild/restart a local SkyCommand service;
- run an allowlisted Tool/Workflow;
- run normal validation;
- generate Repo Map/Zip/Capability Catalogue;
- poll a permitted Workflow;
- perform another routine DEV_LOCAL step that the agent can perform safely itself.

### 11.2 Stop and report only when

Stop before completion when:

- the requested action is outside task scope;
- a production/non-DEV effect would occur;
- a required secret has no authorized source;
- repository/database drift makes deterministic continuation unsafe;
- a destructive/non-idempotent operation outside the allowed contract is required;
- an allowlisted capability needed for completion genuinely does not exist or fails unrecoverably;
- continuing would require changing the governing architecture/phase rather than implementing the assigned task.

Otherwise, complete the task first and report afterward.

## 12. Task completion report

At completion report:

1. files added/modified/removed;
2. configuration keys changed by name only, never secret values;
3. migrations/seeds discovered/applied and ledger result;
4. Tools/Workflows invoked and run/result identifiers;
5. Docker/runtime actions performed;
6. tests/validation with exact results;
7. generated artifacts/evidence;
8. material discrepancies or remaining blockers;
9. final Git status and concise diff summary.

Then stop for Paul/Sky review.

## 13. Remediation gate before Agentic AI Phase 1

R0–R6 are the accepted implementation/promotion baseline. R7 cleanup and R8 one-instruction end-to-end acceptance remain outstanding remediation gates.

Do not begin the approved Agentic AI Phase 1 implementation until R7/R8 are completed and the Autonomous DEV remediation plan's one-instruction implementation and separate one-instruction promotion acceptance tests pass.

The acceptance standard is not "many safety gates exist." It is:

> Paul gives one development instruction; the authorized agent completes the entire local development turn without Paul intervention, leaves a reviewable final state with complete evidence, and stops.

## 14. Change to these rules

These rules remain active until Paul explicitly approves another revision.

A coding agent may recommend changes but must not silently rewrite its own authority. This v1.3 revision records the Paul-authorized post-R6 `DEV_LOCAL` operating model and the governed promotion chain.

## 15. Accepted execution and evidence requirements

- R2 returns successful `NO_CHANGES` after verifying target identity, manifest, baseline, and ledger. An empty pending list is not an error or permission to skip verification.
- Hash and execute the same captured SQL bytes. Recheck the canonical manifest under the database lock and reject changed/missing/added files before application; never ledger one hash while executing different bytes.
- Each migration and its successful ledger entry commit atomically. A later failure leaves earlier committed files visible in the result. Recover from ledger truth; do not replay completed SQL or imply batch-wide rollback.
- R3 permits typed, allowlisted application configuration changes. Non-secret database targets, authentication settings, permission controls, and root paths are not automatically eligible. Use their dedicated registration/configuration contracts. Write atomically and detect concurrent edits; never hash/export secret values into ordinary receipts.
- R4 binds credentials to server-recognized principals and resource grants. Caller labels are display metadata. Persist caller ownership, workflow version, validated parameters, environment/repository binding, and request identity. Enforce ownership on status/artifact reads.
- Starts use a caller-scoped idempotency key plus canonical request digest: same key/same request returns the original run; same key/different request is rejected. Retries reconcile uncertain effects before repeating them.
- Serialize conflicting finalization/promotion operations for a shared DEV repository/environment. Retain D1 database locking. Interrupted runtime reconciliation must remain recoverable when the API or worker restarts itself.
- R5 records baseline revision, changed tracked files and relevant untracked files with hashes, SQL manifest, secret-free configuration revision, pinned workflow version, validation/readiness evidence, and artifact references/hashes. Explicitly classify generated outputs so receipt generation does not recursively invalidate the source manifest.
- R6 accepts an explicit promotion instruction tied to a successful finalization receipt. Verify the reviewed content, SQL/config/database binding, workflow version, and branch state before source mutation; drift blocks promotion and requires fresh finalization/review. Recheck target database readiness through the existing registered upgrade/readiness capability. Unexpected SQL changes invalidate the reviewed manifest.
- Promotion authority is attributable to the user's instruction, not inferred from tool access or an agent assertion. Record the instruction/session reference available from the trusted execution boundary. This records the existing decision and must not add another human approval click.
- The critical R6 mutation order is preflight/evidence refresh → Dev Commit → Merge GitHub Dev PR → Repo Merge / Sync → Local Repository Sync → terminal Development Promotion Summary. No approval node or alternate edge may bypass this chain.
- The GitHub PR merge is workflow-owned and returns durable PR/merge evidence. Subsequent remote and local synchronization must verify the final approved SHA/state.
- Reconcile the expected source changes caused by workflow-owned commit/PR merge/remote sync/local sync in the final receipt. Do not silently absorb unrelated concurrent edits.
- Successful development and promotion acceptance requires crash/retry/concurrency/drift checks as specified in remediation R8, in addition to zero intermediate Paul actions.
