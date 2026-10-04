# SkyCommand Development Operating Rules v1.5

**Status:** Active development governance
**Revision:** 2026-10-03 — standardizes local work-order and overlay retrieval from `C:\Users\pauls\Downloads`, requires Sky to supply a paste-ready Codex note naming both exact full paths, and removes the need for forward chat attachments; retains deterministic return cadence and fresh repository evidence; prohibits Tool-specific environment-variable dependencies in favor of shared configuration, stable code constants, or explicit Tool parameters; retains v1.5 simplicity, tool-independence, delegated-execution, Playwright-on-direction, Agentic AI v1.2 alignment, and mandatory finalization-receipt reporting
**Supersedes:** `SkyCommand_Development_Operating_Rules_v1.4.md`
**Applies to:** Paul, Sky/ChatGPT, Codex/Luna/Astra, future coding agents, and any agent operating on the SkyCommand repository
**Long-range architecture authority:** `docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.2_APPROVED.md`
**Historical remediation status:** R0–R8 accepted; the retired remediation plan is historical evidence only and is not an active authority or required working-tree document.

## Transition scope and precedence

R0–R8 are complete and establish the accepted Autonomous DEV implementation, finalization, recovery, and promotion baseline. Agentic AI Phase 1 is no longer blocked by the remediation gate; it may begin only through separately scoped work orders under the approved long-range architecture.

These operating rules govern the operator-authorized local Codex/Luna development workflow in the approved DEV checkout. The long-range architecture governs future SkyCommand-managed Agent Runs: those agents remain isolated from the live checkout, control-plane secrets, Docker socket, and privileged Host Agent. Their writable access begins only through the certified Phase 3.5 managed-workspace path. Local operator access does not become blanket authority for managed agents.

The assigned work order limits implementation scope. Completion of R0–R8 is acceptance history, not blanket permission to implement later roadmap phases. Required routine operations within an assigned task remain autonomous. The registered database-upgrade capability is the normal mutation path for canonical DEV migrations/seeds; typed configuration reconciliation, governed agent execution, Dev Change Finalization, governed recovery, and Development Promotion are the accepted DEV boundaries where applicable.

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

### 1.1 Core architecture and efficiency invariants

These invariants apply to every development change unless Paul explicitly authorizes a narrower exception:

- **Prefer the simplest safe solution.** Do not add services, lifecycle layers, persistent state, gates, contracts, or abstractions unless the requirement demonstrably needs them.
- **A Tool is independently executable.** A registered SkyCommand Tool must be able to run by itself through its authorized execution surface or be composed into one or more Workflows.
- **A Tool may depend on declared data, not execution history.** Explicit inputs, configuration, durable artifacts, and registered infrastructure dependencies are valid. Hidden predecessor state or a requirement that another named Tool ran first is not.
- **Workflows compose Tools; Tools do not absorb sibling Tools.** Ordering, branching, gating, and sequencing belong to orchestration. A Tool must not import, embed, or enforce a sibling Tool's workflow semantics merely because both appear in the same Workflow.
- **Keep the change surface minimal.** A small requirement should normally produce a small change. If a change appears to require unrelated stable Tools/subsystems to change, stop for architectural review before expanding scope.
- **Preserve working behavior by default.** New functionality must not alter unrelated Tool contracts, Workflow behavior, runtime lifecycle, promotion/finalization behavior, or APIs unless the requirement explicitly calls for it.
- **Performance is part of correctness.** Materially slower execution, extra rebuilds/restarts, longer waits, excess retries, or unnecessary resource use are regressions unless required, measured, and accepted.
- **Governance must reduce risk without creating avoidable human work.** Do not add approval ceremony, manual checkpoints, duplicate validation, or lifecycle hurdles when a simpler deterministic control provides the same safety.
- **Fail clearly and quickly.** Validate external dependencies and hard preconditions early rather than allowing routine runs to wait for long timeouts when unavailability can be determined sooner.
- **Prefer deterministic automation over agent judgment for repetitive work.** Testing, evidence gathering, routine validation, recovery, and other mechanical operations should move into deterministic Tools/Workflows where practical.

A useful design test is: **a Tool may depend on data; it may not depend on history.**

## 2. Development ownership and task authority

- Paul owns product direction, final acceptance, promotion intent, release intent, and changes to these governance rules.
- Sky/ChatGPT owns continuity, architecture review, implementation review, work-order design, correction guidance, and phase acceptance with Paul.
- Architecture/reasoning agents may propose plans, but Paul/Sky determine the controlling plan.
- Implementation agents execute only the explicitly assigned task/phase.
- An agent must not silently continue into the next roadmap phase.
- Within an assigned `DEV_LOCAL` task, the work order itself authorizes the routine local operations necessary to complete that task, subject to the hard boundaries in these rules.
- An implementation agent must not stop merely because a routine step requires a database upgrade, local `.env` reconciliation, local Docker rebuild/restart, validation run, artifact generation, or an allowlisted SkyCommand Tool/Workflow.

### 2.1 Supervising architect and delegated execution roles

The default local-development responsibility split is explicit:

- **Paul sets the objective and owns final acceptance/promotion intent.**
- **Sky/ChatGPT is the supervising architect, primary source-design/coding authority, integration reviewer, and acceptance reviewer.**
- **Luna/Codex or any replacement execution model is Sky's delegated eyes and hands in the authorized environment.** Its default role is inspection, bounded command execution, applying exact directed edits/patches when delegated, test execution, evidence collection, and environment interaction.
- An execution agent does **not** independently own architecture, abstraction design, subsystem boundaries, scope expansion, cross-component contracts, or acceptance.
- If a delegated task appears to require an unrelated component change, architectural expansion, new persistent state/service, or a change to an established Tool contract, the execution agent must stop that expansion and report the dependency to Sky.
- Opportunistic refactors, cleanup, redesign, feature additions, or unrelated fixes are prohibited unless explicitly authorized.
- An execution agent's completion report and passing tests are evidence, not architectural approval. Sky must independently review the actual resulting diff/source for scope, coupling, tool independence, backward compatibility, runtime/performance impact, and unnecessary complexity before recommending acceptance.

The objective of delegation is to remove routine work from Paul without transferring architectural decision-making to the execution agent. Until SkyCommand automates the handoff, Paul may temporarily serve as the transport relay between Sky and Luna, but he should not be the workflow runner or permanent execution bottleneck.

### 2.2 Manual Sky → Paul → Luna execution relay

Until the equivalent orchestration is implemented inside SkyCommand, use the following manual relay as the preferred development operating model:

1. **Paul/Sky define the objective and acceptance boundary.**
2. **Sky owns implementation design, changed source, and the complete handoff.** Sky prepares the work-order file, the repo-relative overlay ZIP, and a mandatory paste-ready Codex note containing the exact full path and filename of both files under `C:\Users\pauls\Downloads` (`Overlay: NONE` when no overlay applies). Download links alone are incomplete. The overlay remains the source change authority unless the work order explicitly delegates a bounded corrective edit.
3. **Paul is the transport bridge, not the workflow runner.** Paul downloads the work order and overlay into `C:\Users\pauls\Downloads`, preserving their exact filenames, and pastes Sky's note into local Codex. Codex obtains both files directly from disk; Paul need not attach files or paste the work-order body into chat. Paul is not expected to unpack/place routine overlays, run tests, execute Finalization, generate repository evidence, or execute Promotion. A request in which Paul explicitly elects to place particular files manually is a scoped exception; it does not change the normal relay.
4. **Codex is the delegated file placer and execution runner, regardless of the selected model.** Read the work order from its named local path, verify the current checkout and exact overlay package/hash/manifest, apply only the authorized repo-relative files, then perform its directed tests and governed operations. The standard Downloads paths are authoritative unless Paul/Sky explicitly supply different exact paths in the current instruction. Missing files or hash/manifest mismatches block execution and must be reported with the exact path. Do not search other folders, choose similarly named/newer downloads, select a `(1)`/other suffixed copy, or infer extra edit authority. Reading from Downloads does not permit unrelated directory access or enlarge execution-surface scope, recovery budgets, or promotion authority.
5. **Testing is directed by Sky.** API/CLI/self/integration tests are the default validation surface. When a frontend/browser-visible change is present and Sky directs it, Luna may execute the registered Playwright/browser test path and collect screenshots/artifacts/results. Browser testing is not implied for backend-only changes.
6. **Finalization is an execution responsibility, not Paul's chore.** When Sky's instruction requires Finalization and prerequisite tests pass, Luna runs exactly the governed Finalization boundary specified by the work order, polls and performs recovery within the allowed contract, reports the mandatory receipt block, and returns the current Finalization-generated Repo ZIP/Repo Map evidence. When Sky explicitly requests an intermediate **file-changing** turn without Finalization, Luna runs the registered Repo Map/Repo ZIP generation path so the return packet still contains a fresh repository snapshot for Sky review, then stops.
7. **Each Luna turn produces a relay packet for Sky.** For any file-changing turn, the packet includes Luna's completion response; a fresh Repo ZIP generated from the resulting working tree (through Finalization when it ran, otherwise through the registered Repo ZIP path); Repo Map/evidence as applicable; exact test/workflow results; Playwright output/artifacts when Sky required frontend/browser validation; and final working-tree status. If the tree remains dirty, Paul attaches a current Source Control/working-tree image when relaying the packet to Sky.
8. **Sky reviews the returned implementation and evidence.** Passing tests do not by themselves establish architectural acceptance. Sky decides whether another overlay/correction is required or whether the change is ready for Paul acceptance.
9. **Promotion remains separately authorized.** After Paul explicitly approves promotion, Sky provides the promotion execution instruction and Luna runs the registered Development Promotion path to terminal receipt.

The manual relay is a learning scaffold, not the target end state. After the sequence is proven repeatedly, move stable mechanics into deterministic SkyCommand workflows so Paul no longer needs to relay messages or files manually.

## 3. Workflow-centered authority model

### 3.1 Workflow permission is the normal execution grant

- Agents are granted server-side permission to specific SkyCommand Workflows and Tools.
- A Sky-authored overlay package supplied through the current work order may grant bounded file-placement authority for the exact repo-relative files it contains. File placement does not grant independent source-design authority.
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

### 3.4 Request-level execution-surface policy

Execution-surface authority is defined by the current request/work order. Global availability of a capability does not by itself authorize its use for every task.

Each work order should explicitly classify the execution surfaces relevant to that request. Typical surfaces include:

- repository/file editing;
- local shell/command execution;
- SkyCommand MCP/API;
- SkyCommand UI through Computer Use or browser control;
- general desktop Computer Use;
- browser control outside SkyCommand;
- connected Apps/Plugins such as GitHub, Dropbox, Drive, Outlook, or Gmail;
- remote-device/control surfaces.

A request may mark a surface **ALLOW**, **READ_ONLY**, **DENY**, or **EXPLICIT_APPROVAL_REQUIRED**. These permissions are scoped to that request only and do not change global Codex/ChatGPT settings, installed integrations, registered MCP capabilities, or future-task authority.

Rules:

- Possession of a capability does not constitute authorization to use it.
- A connected App, authenticated browser session, enabled Computer Use integration, or exposed MCP tool is capability evidence, not task authority.
- A permission error, stale wrapper, unavailable Tool, or failed Workflow on one surface does not authorize switching to a more privileged surface.
- Surface substitution is allowed only when the request explicitly permits that fallback, or Paul explicitly authorizes it during the task.
- Surface permissions do not override operation-level hard boundaries elsewhere in these rules.
- When an allowed UI/Computer Use action invokes a SkyCommand Workflow, Tool, or recovery control, the underlying SkyCommand operation remains the governed action and should retain its normal receipt/evidence.
- If a legacy work order contains no execution-surface section, use only the ordinary repository/local-shell and explicitly permitted SkyCommand Tool/Workflow surfaces required by that task. Do not infer Computer Use, browser-control, remote-device, or connected-App mutation authority.

### 3.5 Human and agent parity

SkyCommand's development workflows are shared operational surfaces for humans and agents. Paul may manually run **Dev Change Finalization**, **Dev Promotion Local**, and permitted recovery controls through the SkyCommand UI. Agent execution-surface restrictions do not restrict Paul's own manual UI use.

Human UI execution and authorized agent execution must converge on the same registered Workflow definitions, preflights, permission checks, receipts, and evidence. Governance added for agent autonomy must not make the normal human development path unusable or require agent-only ceremony.

### 3.6 Runtime configuration identity and governed reconciliation

When acceptance depends on a running process, treat source/configuration validity and runtime freshness as separate facts.

Where supported, record or verify the effective source revision, non-secret configuration revision/digest, capability-manifest revision, service/worker/Host Agent/MCP generation or startup identity, and freshness evidence needed by the affected runtime profile.

A stale runtime is not automatically source/configuration drift. If the current work order permits routine DEV lifecycle operations, use the registered/governed reconcile, rebuild, restart, or refresh action required to bring the affected service to the reviewed state, then rerun readiness. Do not stop solely to ask Paul for a ceremonial restart that the authorized path can safely perform.

Runtime reconciliation does not authorize production work, broader service mutation, secret disclosure, direct Git mutation, or bypass of Host Agent/Supervisor boundaries. Record the lifecycle action and resulting runtime identity in the completion evidence.

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

### 5.3 Avoid environment-variable sprawl and Tool-local environment dependencies

Environment variables are runtime/process configuration, not a substitute for SkyCommand permissions, Workflow state, or Tool parameters.

**Tool rule:** a registered Tool/script must not introduce or require an environment variable that exists only for that Tool. Tools may read existing shared application/infrastructure variables when those variables are genuinely common across subsystems, but Tool-local behavior must not depend on private `.env` / `.env.example` keys.

For Tool behavior:

1. use a stable constant in Tool code when the value is an implementation invariant/default and does not need caller selection;
2. use an explicit registered Tool parameter, with validation and a documented/default value where appropriate, when callers need to vary the behavior;
3. reference an existing shared application/infrastructure environment variable only when the value is genuinely cross-cutting process/runtime configuration;
4. do not create a new environment variable merely to configure one Tool.

For non-Tool runtime configuration, before adding a new environment variable prefer in this order:

1. existing registered Workflow/application configuration;
2. repository/environment metadata already stored in SkyCommand;
3. a stable application setting with a clear runtime reason;
4. a new shared environment variable only when process-start configuration is genuinely required.

Do not add per-invocation approval flags, duplicate permission flags, temporary ceremony flags, or Tool-specific feature switches when registered permissions/parameters already express the policy. A value becoming configurable is not by itself a reason to move it into `.env`; expose it as a Tool parameter when the variability belongs to the invocation.

Secrets and genuinely cross-cutting deployment/runtime configuration remain subject to the normal shared secret/configuration policy; this rule does not authorize hard-coding secrets or machine-specific secret material.

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

The agent may use registered Host Agent/local capabilities that are allowlisted to its identity, required by the task, and permitted by the request-level execution-surface policy.

When Computer Use, browser control, connected Apps/Plugins, or remote-device control is permitted by the current request, those surfaces remain bounded by the same task scope and operation-level rules. They must not be used to bypass a SkyCommand permission, preflight, promotion boundary, database boundary, or secret-handling rule.

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

### 8.1 Mandatory finalization receipt reporting

Every successful **Dev Change Finalization** completion report must surface the canonical promotion-binding fields directly to Paul/Sky. At minimum report:

- finalization Workflow/run ID;
- terminal status;
- effective finalization/runtime profile;
- canonical receipt path;
- canonical receipt SHA-256;
- reviewed source identity/digest;
- database state, including pending-change/drift result;
- readiness result.

The model completion message is presentation, not authority: the durable Workflow/finalization records and receipt remain canonical evidence. However, omitting the receipt SHA from the completion report creates avoidable promotion-time rediscovery and should be treated as an observability defect.

If the structured finalization result does not already expose the full receipt SHA-256, the authorized agent should resolve it from the authoritative finalization record and, where the local canonical receipt is available, independently hash the receipt bytes and confirm the values match before reporting. Do **not** regenerate, rewrite, or rerun finalization merely to make the hash available. A mismatch is a real evidence discrepancy and must be reported rather than concealed.

A later promotion instruction should bind to both the reviewed finalization run/receipt ID and the reviewed receipt SHA-256. Promotion preflight must still independently verify that binding and fail closed on drift; displaying the SHA during finalization does not weaken preflight.

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
- Successful Dev Change Finalization reporting must include the finalization run ID, canonical receipt path, canonical receipt SHA-256, source identity, effective profile, database state, and readiness result required by §8.1.
- Observability must not require a human to authorize every normal DEV action.
- Failure evidence should identify the failed boundary and safe error code without leaking secrets.
- Generated snapshots should identify source revision, environment, generation time, and data source.
- Until SkyCommand has a native Agent Execution Trace, an agent completion report must identify the execution surfaces it actually used and any surface substitutions made during the task.
- Computer Use/browser/App activity that invokes SkyCommand should be correlated to the underlying Workflow/Tool/recovery receipt when possible; a UI click is not a substitute for durable operational evidence.
- Target Agent Execution Trace fields include requested surface, effective surface, authority source, actor/session, relevant Workflow/Tool/run identifiers, recovery/retry count, human intervention, surface transitions, and terminal result.
- A change of interface does not reset retry, recovery, idempotency, or authorization budgets for the underlying operation.

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
- completion would require an execution surface that the current request does not authorize;
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
8. when Dev Change Finalization ran, the mandatory finalization receipt block from §8.1, including run ID, receipt path, receipt SHA-256, source identity, profile, database state, and readiness;
9. fresh Repo ZIP / Repo Map / other requested repository-evidence artifacts generated from the resulting tree, with path/hash where available;
10. Playwright/browser test results and artifact references when Sky directed frontend/browser validation;
11. material discrepancies or remaining blockers;
12. execution surfaces used, including any Computer Use/browser/App/remote-device use, surface substitution, and human intervention;
13. final Git status and concise diff summary, plus a clear indication whether the working tree is clean or remains reviewably dirty.

Then stop for Paul/Sky review.

## 13. R8 acceptance and Agentic AI Phase 1 entry

R0–R8 are accepted as the completed Autonomous DEV remediation baseline. The one-instruction implementation path and separately authorized one-instruction DEV promotion path have been exercised through the governed finalization, recovery, PR merge, remote synchronization, local synchronization, and receipt boundaries.

The remediation plan remains authoritative historical/acceptance context, but its numbered steps are not standing authority to re-run old remediation work or broaden a new task.

Agentic AI Phase 1 may now begin when Paul/Sky issue an explicit scoped work order. Phase 1 does not inherit unrestricted `DEV_LOCAL` host authority merely because the local Codex/Luna development agent has it. Managed-agent isolation, workspace certification, resource grants, and later Phase 3.5 boundaries remain governed by the approved architecture.

Future agentic work orders should use `docs/development/Codex_Development_Work_Order_Template.md` or an equivalent request that explicitly states task scope, promotion boundary, recovery policy, and request-level execution-surface permissions.

The continuing acceptance standard is:

> Paul gives one scoped instruction; the authorized agent completes the permitted local development turn without routine Paul intervention, leaves a reviewable final state with complete evidence, and stops. Any use of elevated or alternate execution surfaces is explicit in the request and observable in the result.

## 14. Change to these rules

These rules remain active until Paul explicitly approves another revision.

A coding agent may recommend changes but must not silently rewrite its own authority. This v1.5 revision records the Paul-authorized post-R8 `DEV_LOCAL` operating model, request-level execution-surface governance, human/agent workflow parity, runtime-configuration freshness/reconciliation, and alignment with the Agentic AI v1.2 implementation amendments.

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
- R7 retires obsolete D2 database-upgrade request/apply Assistant/Admin-Web/MCP surfaces and the related temporary permission/configuration scope while preserving historical execution records.
- R8 treats Host Agent heartbeat freshness as timestamp-based runtime evidence. The accepted DEV configuration uses an allowlisted configurable freshness threshold bounded to the implemented safe range; stale or unrecognized runtime configuration fails closed until reconciled and the affected runtime is refreshed.
- R8 acceptance does not authorize hidden surface escalation. Computer Use, browser control, connected Apps/Plugins, and remote-device capabilities are governed per request and must be observable when used.
- Recovery budget follows the underlying durable operation across interfaces. A retry through the SkyCommand UI after an MCP/API attempt is the same recovery budget unless the work order explicitly says otherwise.
