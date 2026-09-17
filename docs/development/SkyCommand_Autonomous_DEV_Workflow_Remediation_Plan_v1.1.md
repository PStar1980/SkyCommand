# SkyCommand Autonomous DEV Workflow Remediation Plan v1.1

**Status:** Immediate remediation plan before Agentic AI Phase 1  
**Created:** 2026-09-16  
**Revision:** v1.1 — Paul-approved review recommendations; implementation status remains unverified  
**Scope:** SkyCommand `DEV_LOCAL` development automation  
**Primary objective:** Restore and improve the original fast development loop by making routine local development autonomous, workflow-centered, observable, and repeatable.  
**Phase gate:** Do not begin Agentic AI Phase 1 until this plan passes end-to-end acceptance.

---

## 1. Executive decision

The current D1/D2 bootstrap proved useful database-safety primitives, but the resulting operator procedure is not the desired product.

The desired model is simple:

> Paul/Sky give an agent one scoped development instruction. The agent completes the change, updates required local configuration, applies approved-by-policy numbered migrations/seeds, rebuilds/restarts local services as needed, runs validation and required Workflows, produces evidence, and stops. Paul reviews only after the turn is complete.

SkyCommand is a workflow automation platform. Therefore the normal execution unit should be a permissioned Workflow, not a chain of human approval ceremonies.

This remediation keeps the useful technical controls already built and removes the human-in-the-middle development bureaucracy.

## 2. Current-state gap analysis

### 2.1 Keep the useful database substrate

Keep the non-destructive upgrade capabilities already built:

- global numbered migration/seed discovery;
- SHA-256 source verification;
- baseline evidence for historical state;
- immutable ledger evidence for post-baseline execution;
- database identity and PostgreSQL `system_identifier` checks;
- plan digest generation;
- advisory locking and post-lock revalidation;
- per-file transactional application;
- no replay of already-ledgered identical changes;
- rollback/failure evidence;
- structured database-upgrade results.

Migration `00129` established the upgrade ledger. Migrations `00130`–`00132` were subsequently applied during D2 bootstrap. Applied migration history must not be rewritten merely to simplify the runtime.

### 2.2 Remove the wrong operator model

The current procedure introduced repeated manual gates around routine DEV work:

- separate PLAN exposure;
- separate APPLY-request creation;
- human request approval;
- request TTL;
- separate Admin-Web execution;
- temporary execution-enable flags;
- API rebuild/restart to change those flags;
- repeated user interaction between steps.

That procedure is not the normal future `DEV_LOCAL` loop.

The current repo also contains multiple database-upgrade bootstrap environment variables:

- `SKYCOMMAND_DB_UPGRADE_ENABLED`
- `SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE`
- `SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER`
- `SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION`
- `SKYCOMMAND_DB_UPGRADE_CONNECT_TIMEOUT_MS`
- `SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED`
- `SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED`
- `SKYCOMMAND_DB_UPGRADE_APPLY_REQUEST_TTL_MINUTES`
- `SKYCOMMAND_ADMIN_DB_UPGRADE_APPLY_EXECUTION_ENABLED`
- `SKYCOMMAND_MCP_DB_UPGRADE_PLAN_ENABLED`
- `SKYCOMMAND_MCP_DB_UPGRADE_APPLY_REQUEST_ENABLED`

Several express temporary bootstrap permission/ceremony rather than durable runtime configuration. They must not become permanent configuration clutter.

### 2.3 Resume the forgotten pre-D work

The Capability Catalogue exporter already exists:

- script: `scripts/capabilityCatalogExport.js`
- proposed Tool code: `capability_catalog_export`
- output contract: `capability_catalog_summary.v1`
- intended risk: low/read-only
- confirmation: false

It was intentionally left unregistered during implementation.

The original next step was to register it and incorporate it into the repository/package-generation and development-promotion workflow path. That work is R1 below.

### 2.4 Fix the agent/workflow gap

The desired architecture is:

- agents have permissions to Workflows;
- agents are told to call Workflows;
- SkyCommand verifies the agent's permission to the requested Workflow;
- the agent can inspect its own run through completion;
- no Paul intervention is required for routine DEV workflow progress.

A generic governed Workflow start/status surface is therefore a core remediation requirement.

### 2.5 Fix local configuration handling

The agent must not depend on Paul to edit `.env` for routine non-secret development configuration.

Create a safe local configuration mechanism that can update required `.env` values while preserving unrelated values, never exposing secrets, producing key-level evidence, and avoiding unnecessary variables.

## 3. Target operating model

### 3.1 Normal implementation turn

```text
Paul/Sky instruction
        |
        v
Authorized coding agent
        |
        +--> inspect repo/runtime/database
        +--> edit source
        +--> update .env/.env.example as needed
        +--> create migration/seed as needed
        +--> run tests while developing
        |
        v
DEV Finalization Workflow
        |
        +--> Preflight
        +--> Environment Reconcile
        +--> Database Upgrade Apply
        +--> Conditional build/restart
        +--> Validation and runtime/readiness verification
        +--> Capability Catalogue Export
        +--> Repository Map
        +--> Repository Zip
        +--> Durable finalization receipt and summary
        |
        v
Agent verifies final state
        |
        v
Paul/Sky review
```

There is no Paul interaction between the initial instruction and the final report unless a true hard blocker is encountered.

### 3.2 Promotion turn

```text
Paul: promote the accepted change
        |
        v
Authorized agent
        |
        v
Development Promotion Workflow
        |
        +--> commit
        +--> merge/synchronize
        +--> host/local repository sync
        +--> required generated artifacts
        +--> capability catalogue refresh
        +--> final verification
        +--> structured promotion summary
        |
        v
Agent reports final receipt
```

The explicit `promote` instruction is the human authorization boundary. The DEV promotion Workflow should not pause for another redundant human approval for the same decision.

## 4. Design principle: reasoning in the agent, deterministic effects in nodes

Database upgrade and `.env` reconciliation should not become free-form AI nodes when deterministic execution can perform them.

The agent decides what code/configuration/migration changes are required. Registered deterministic Tools/nodes perform environment reconciliation, database APPLY, validation, runtime actions, catalogue export, repository packaging, and evidence capture.

This provides traceability without moving reasoning into opaque infrastructure.

## 5. Target capability set

### 5.1 Register `capability_catalog_export`

Register the already-built exporter with the reviewed permission/risk metadata.

After registration:

- add it to **Repo Map & Zip**;
- add it to both current Development Promotion workflows/variants after identifying their exact live workflow codes/versions from runtime authority;
- include it in the new DEV Finalization Workflow.

Do not guess the second promotion workflow code. Inspect runtime authority first.

### 5.2 Autonomous database-upgrade Tool/node

Create one normal DEV capability, conceptually `database_upgrade_apply`.

Requirements:

- no human approval request;
- no approval TTL;
- no browser execution button;
- no temporary per-run enable flag;
- no direct SQL text/path parameter;
- bound to configured `DEV_LOCAL` database context;
- discovers only canonical migration/seed roots;
- validates baseline/ledger/ordinals/hashes/database identity;
- applies all pending changes in order;
- uses D1 locking/revalidation/transactions;
- returns structured output;
- retains durable execution evidence;
- idempotent on repeated execution.

An agent with permission to this Tool or a Workflow containing this node can execute it autonomously.

### 5.3 Local environment reconciliation Tool/node

Create one deterministic local configuration capability, conceptually `dev_env_reconcile`.

Requirements:

- `DEV_LOCAL` only;
- preserve unrelated `.env` entries;
- never return secret values;
- return key names/change classification only;
- do not place secrets into `.env.example`;
- idempotent;
- support missing-key detection;
- permit authorized agent-supplied non-secret values;
- treat a required unavailable secret as a blocker;
- avoid a new variable when existing application/workflow configuration can represent the need.

### 5.4 Generic agent Workflow execution

Add generic governed workflow execution, conceptually:

- `skycommand_workflow_start`
- `skycommand_workflow_run_get`

`skycommand_workflow_start` accepts a workflow code plus validated runtime parameters.

Server-side authorization must resolve agent identity/context, verify `WORKFLOW_RUN`, verify workflow/environment allowlist, validate published parameters, preserve actor/agent/root/run attribution, and reject ungranted targets.

The agent autonomously observes/polls its own run until terminal state.

Do not add one `.env` boolean for every Workflow.

### 5.5 DEV Finalization Workflow

Create a dedicated Workflow, conceptually `dev_change_finalize`, with:

1. Preflight
2. Environment Reconcile
3. Database Upgrade
4. Conditional Build/Restart
5. Validation and Readiness/Runtime Verification
6. Capability Catalogue Export
7. Repository Map
8. Repository Zip
9. Durable Finalization Receipt and Run Summary

Use conditions so irrelevant work becomes an explicit no-op. The Workflow must be idempotent and safe to run after every development turn.

## 6. Database observability model

The user wants observability, not approval bureaucracy.

The authoritative history should answer:

- migration/seed ordinal and kind;
- repository-relative path;
- SHA-256;
- source revision when available;
- database name/system identifier;
- before/after ledger state;
- timestamps;
- actor/agent/workflow/run identity;
- outcome/safe failure code.

Use the existing D1 ledger as primary migration truth and normal Tool/Workflow operations as run-level attribution/evidence.

Do not require a separate authorization-request record merely to obtain auditability.

Existing D2 request/execution records remain historical evidence but are not the normal future DEV model.

## 7. `.env` simplification strategy

### 7.1 Authority must leave `.env`

Agent/Workflow permission belongs in SkyCommand registration/permission/environment configuration, not per-capability process flags.

As replacements become proven, remove obsolete bootstrap variables from `.env.example`, code, discovery, docs, tests, and launch wiring.

### 7.2 Cleanup candidates

After autonomous replacement is accepted, review and normally retire:

- `SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED`
- `SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED`
- `SKYCOMMAND_DB_UPGRADE_APPLY_REQUEST_TTL_MINUTES`
- `SKYCOMMAND_ADMIN_DB_UPGRADE_APPLY_EXECUTION_ENABLED`
- `SKYCOMMAND_MCP_DB_UPGRADE_PLAN_ENABLED`
- `SKYCOMMAND_MCP_DB_UPGRADE_APPLY_REQUEST_ENABLED`

Also reassess after environment binding is implemented:

- `SKYCOMMAND_DB_UPGRADE_ENABLED`
- `SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE`
- `SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER`
- `SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION`

`SKYCOMMAND_DB_UPGRADE_CONNECT_TIMEOUT_MS` may remain if it is genuine runtime configuration.

Do not remove a variable until runtime/tests no longer depend on it.

### 7.3 No flag-for-every-capability pattern

New autonomous DEV capabilities should be governed primarily by Tool/Workflow registration, agent/profile permissions, environment binding, repository binding, and server-side ExecutionContext.

A small number of true deployment/emergency kill switches may exist when justified, but they are not part of the normal per-turn path.

## 8. D2 cleanup strategy

Do not rewrite applied migration history.

### Keep

- D1 upgrade engine;
- migration/seed ordinal/hash rules;
- `00129` baseline/ledger migration;
- already-applied migration files `00130`–`00132` as immutable history;
- historical audit/authorization/execution records;
- regression tests that protect D1 correctness, reconciliation, transactions, or idempotency.

### Replace/deprecate after autonomous path is proven

- Assistant-only database PLAN bootstrap surface if superseded;
- D2B.1 APPLY-request creation as a required DEV step;
- Admin-Web approval/request queue as a required DEV step;
- D2B.2 browser Execute button as a required DEV step;
- request TTL as a normal DEV dependency;
- special MCP DB PLAN/APPLY-request tools when registered DB node + generic Workflow execution supersede them;
- D2-specific environment gates/discovery fields.

### Historical database objects

Because `00131`/`00132` are already ledgered, do not edit/delete those migration files.

If their tables/permissions become unused, prefer retaining historical rows for audit and stop creating new envelope records. Use an additive cleanup migration only if schema cleanup is genuinely valuable; do not erase bootstrap evidence merely because the path is retired.

## 9. Development Promotion correction

Target model:

- Paul/Sky review the finished DEV change;
- Paul says `promote`;
- authorized agent invokes the permitted Development Promotion Workflow;
- Workflow completes its registered DEV mutation path;
- no second human merge-approval click is required for the same promotion decision;
- Workflow returns commit/merge/sync/artifact/catalogue/final-state evidence.

Direct Git mutation by the coding agent remains prohibited during this remediation. SkyCommand owns the Git side effects.

When updating promotion workflows, preserve immutable versioning, identify exact live workflow codes/current versions, integrate Capability Catalogue export, preserve packaging, replace redundant approval pause with auditable start authority, and preserve recovery/retry/final summary.

## 10. Remediation implementation sequence

Each remediation step is a complete agent work order. Within a work order, the agent finishes routine DB/config/Docker/validation/workflow actions autonomously and stops only at the end or on a true blocker.

### R0 — Governance reset

- install the new repo-root `AGENTS.md`;
- replace old Operating Rules with v1.2; do not keep contradictory active copies;
- add this remediation plan under `docs/development/`;
- update references to the obsolete rules filename;
- block Agentic AI Phase 1 until R8 acceptance.

**Acceptance:** no active governance document requires Paul to perform routine local DB/config/Docker/tool/workflow steps; destructive DB rebuild and arbitrary mutation remain prohibited; promotion remains a separate explicit user instruction.

#### R0 clarification — install the accepted transition boundary

Install the v1.2 rules, this v1.1 plan, updated root AGENTS.md, and the v1.1 architecture. Remove superseded active governance copies and update active references; retain history through Git. Distinguish operator-authorized local remediation from future isolated managed Agent Runs. Do not wait until R8 to resolve that scope. Verify live repo governance before overwriting newer unrelated amendments.

### R1 — Close forgotten Capability Catalogue work

- introduce/confirm dedicated catalogue permission if needed;
- register `capability_catalog_export`;
- verify Tool execution and structured result;
- add it to Repo Map & Zip;
- inspect live catalogue and identify both development-promotion workflow variants;
- add catalogue export to both at the correct pre-summary location;
- validate generated JSON/XLSX.

**Acceptance:** one Tool registration exists; Repo Map & Zip refreshes map + zip + catalogue; both promotion workflows refresh catalogue; repeated runs are safe.

### R2 — Autonomous database-upgrade Tool/node

- register a Tool around D1 APPLY;
- bind it to DEV environment/repository/database context;
- remove human-approval envelope dependency from the autonomous Tool;
- accept no arbitrary SQL/path;
- plan + verify + apply pending canonical changes;
- retain ledger/hash/identity/lock/reconciliation;
- return workflow-friendly structured result;
- add permission/metadata/tests.

**Bootstrap allowance:** until R2 is registered, the revised rules authorize the implementation agent to use the existing D1 CLI APPLY path directly against the pinned `DEV_LOCAL` database when necessary to build/register the replacement. This allowance ends when R2 is accepted.

**Acceptance:** an authorized agent moves DEV from pending to fully ledgered with one Tool call and zero Paul interaction; repeated invocation is a clean no-op/idempotent result.

#### R2 additional requirements and acceptance

- Return verified success `NO_CHANGES` for zero pending files; do not blindly translate all engine errors into no-op success.
- Capture raw file bytes once for hashing/execution, or hash a fresh capture and execute that exact capture. Recheck the complete canonical file manifest under the lock, reject drift, and execute only verified bytes. Reject paths escaping canonical roots.
- Preserve database/cluster identity checks when moving their configuration out of `.env` flags.
- Report per-file committed/failed/pending outcomes. Earlier commits remain applied after a later failure; retry reconciles the ledger and does not replay completed changes.
- Add targeted tests for between-plan-and-execution file mutation, manifest additions/removals, verified no-op, partial failure, and interrupted receipt delivery after commit.

Source-review findings to verify against the current checkout: D1 currently rejects no-pending APPLY and rereads execution SQL after discovery without comparing the execution bytes to the planned hash. These are R2 fixes; do not silently expand R1 into R2.

### R3 — Autonomous `.env` reconciliation Tool/node

- implement deterministic local `.env` reconciliation;
- preserve unrelated values/comments where practical;
- support safe non-secret patch input and `.env.example` reconciliation;
- never return secret values;
- report key names/classification only;
- register Tool/node and tests.

**Acceptance:** a test task can introduce a safe config key and the agent reconciles local `.env` without Paul editing it; repeated execution produces no change.

#### R3 additional requirements and acceptance

Use a typed allowlist of eligible application keys and value constraints. Non-secret does not mean unrestricted: target database identities, authentication/authorization settings, root paths, and execution enablement need their dedicated contracts. Apply atomic file replacement with concurrent-edit detection; preserve unrelated keys/comments and redact errors. Emit changed key names and a secret-free configuration revision, not raw values or secret hashes. Test invalid keys, concurrent edits, secret redaction, and repeated no-op.

### R4 — Generic Workflow execution for agents

- add bounded Assistant/API/MCP workflow start;
- add run read/status;
- resolve agent identity/context server-side;
- enforce workflow permission/allowlist/environment;
- validate parameters;
- preserve actor/run attribution;
- let agent observe its own run;
- do not add one environment boolean per workflow.

**Acceptance:** Luna/Codex starts an allowlisted Workflow and observes it to completion; disallowed workflows are rejected server-side; no user approval for allowed DEV workflow calls.

#### R4 additional requirements and acceptance

Implement a narrow credential-to-principal/resource-grant bridge compatible with the later Agent Execution Service. Do not use caller-supplied agent labels as ownership or authorization, and do not build the entire Phase 1 agent domain early. Persist principal, repository/environment, pinned published workflow version, validated input, and attribution at admission. Enforce resource ownership on run and artifact reads.

Require caller-scoped idempotency keys with canonical request digests. Duplicate identical calls return the original run even after a response timeout; changed payload with reused key is rejected. Preserve nested execution context and prevent ungranted child tools/workflows from expanding authority. Test disallowed workflow, other-principal reads, duplicate starts, changed input, and version changes between admission and dispatch.

### R5 — DEV Finalization Workflow

Build/publish `dev_change_finalize` (final code confirmed against naming conventions) with Preflight, Environment Reconcile, Database Upgrade, conditional Build/Restart, Validation and Readiness/Runtime Verification, Capability Catalogue Export, Repo Map, Repo Zip, and durable Finalization Receipt/Summary nodes.

Structured summary should include config key names changed, DB pending/applied/ledgered state/ordinals, validation results, artifact paths/checksums, readiness, child execution IDs, and overall outcome.

**Acceptance:** succeeds with zero env/DB changes, applies pending work when present, produces handoff artifacts, and is safe to rerun.

#### R5 additional requirements and acceptance

Preflight checks required config/secrets and source/migration validity before mutations. Serialize conflicting finalization/promotion operations for the DEV repository/environment. Use the existing Host Agent or another registered durable capability for conditional build/restart; API/worker self-restarts must not lose workflow ownership or cause duplicate effects. Validate the updated runtime before producing successful final artifacts.

Produce a finalization receipt binding repository baseline, changed tracked/relevant untracked content hashes, SQL manifest, secret-free config revision, pinned workflow version, validation/readiness evidence, and artifact hashes. Define generated-output exclusions explicitly; receipt/zip generation must not recursively change the reviewed source digest. Record artifacts separately from source identity. Publish receipts atomically; failed runs must remain failures with partial evidence, never successful handoffs.

Test zero changes, pending changes, runtime rebuild/restart, interrupted completion, and two competing runs. Recovery must reconcile completed nodes before retrying side effects.

### R6 — Promotion Workflow simplification

- remove/bypass redundant DEV merge-approval pause in new published version;
- use authorized Workflow start + initiating actor as promotion authorization event;
- preserve commit/merge/sync/local-sync/final summary;
- include Capability Catalogue export;
- ensure agent can observe run to completion.

**Acceptance:** after Paul says `promote`, Luna invokes the permitted Workflow and reports completion without another Paul action.

#### R6 additional requirements and acceptance

Bind the explicit user promotion instruction to a successful finalization receipt and preserve the available trusted instruction/session attribution. Starting a promotion must not fabricate human intent from agent credentials alone. No extra human click is introduced.

Before Git mutation, verify reviewed source/SQL/config identity and branch state. Drift requires fresh finalization and review. Verify the bound DEV database is ready; reuse the registered D1 capability if application is needed and authorized for that exact manifest. Never apply newly appeared, unreviewed migrations as a promotion convenience.

Publish immutable versions of both discovered promotion variants. Update the existing API/MCP contracts, discovery, docs, and tests that currently return `humanApprovalRequired: true` and `agentMustStop: true`; the agent must observe terminal completion. Keep unrelated human-approval workflows intact. Preserve retry/recovery, host/local synchronization, and final branch/SHA evidence. Account explicitly for workflow-owned commits and generated artifacts without admitting unrelated changes. Test duplicate promotion start and source drift after review.

### R7 — D2/env/UI cleanup

- remove obsolete D2 DEV runtime routes/tools/UI dependencies no longer in happy path;
- remove obsolete D2 env flags;
- remove dead discovery fields/tests/doc wording tied solely to old procedure;
- retain immutable applied migrations and useful historical audit data;
- update DB-upgrade docs to autonomous DEV path;
- regenerate Capability Catalogue/Repo Map;
- run repository validation.

**Acceptance:** normal DEV no longer references APPLY request/approval/execute ceremony; `.env.example` contains only used configuration; no stale UI presents deprecated path as normal; history remains readable.

### R8 — One-instruction end-to-end acceptance

Use one real/small development change that proves the full path.

Paul/Sky give Luna exactly one implementation instruction. Without Paul intervention, Luna must:

1. edit code;
2. make required `.env.example` and live `.env` change;
3. create required numbered migration/seed;
4. run development validation;
5. invoke DEV Finalization Workflow;
6. allow workflow to reconcile config and apply DB changes;
7. have the workflow rebuild/restart affected services conditionally before final runtime validation;
8. verify app/database;
9. produce Repo Map, Repo Zip and Capability Catalogue;
10. report final evidence and stop.

**Pass:** zero Paul actions between initial instruction and final agent report.

After Paul reviews/tests, issue one separate instruction: **promote**.

Luna must invoke Development Promotion and report final result with zero intermediate Paul actions.

**Pass:** zero Paul actions between `promote` and final promotion receipt.

Only after both pass is Autonomous DEV accepted.

### R8 — Additional resilience acceptance matrix

| Scenario | Required result |
| --- | --- |
| Repeated finalization with nothing pending | Verified success/no-op; no SQL replay |
| Same start resent after lost response | Original run returned, one execution |
| Same request key with changed payload | Explicit conflict |
| Worker interrupted after SQL commit | Ledger reconciliation; no duplicate SQL |
| Later SQL file fails | Earlier commits identified; failed file rolled back; remaining work reported |
| Two runs target same repository/environment | Serialized or explicit busy result; no overlapping mutation |
| SQL bytes/file set changes after planning | Drift rejected before applying unverified contents |
| Source changes after review | Promotion blocked pending fresh finalization/review |
| API/worker restart during finalization | Durable recovery and verification of updated runtime |
| Other principal requests run/artifact | Server-side denial |

Run fault-injection cases in an isolated disposable test database/fixture, never by corrupting the real DEV ledger or applied history. Complete real end-to-end implementation and separate promotion demonstrations against the authorized DEV binding. Report exact receipts, results, and any baseline failures. Zero Paul actions plus correct recovery is the acceptance standard.

## 11. Cleanup requirements

- only one active Operating Rules version referenced by `AGENTS.md`;
- old rules may remain in Git history but not as competing active instructions;
- old D2 runtime removed only after replacements pass;
- applied migrations remain immutable;
- temporary/dead source/self-tests removed or consolidated when coverage exists elsewhere;
- `.env.example` reviewed line-by-line for obsolete D2 flags;
- docs describe final autonomous path, not bootstrap ceremony;
- Repo Map and Capability Catalogue match final reality.

## 12. What remains intentionally human

Paul/Sky remain responsible for:

- deciding what to build;
- changing governance/architecture;
- final visual/behavioral acceptance;
- deciding when a reviewed change should be promoted;
- allowing non-DEV/production effects;
- supplying an unavailable secret when no authorized source exists;
- exceptional destructive recovery.

Everything else in normal `DEV_LOCAL` implementation should be automated when technically possible.

## 13. What is explicitly not the goal

Do not optimize for approval counts, deterministic-operation confirmations, a new `.env` flag per capability, one MCP tool per Workflow, shell duplication of existing SkyCommand capabilities, or preserving bootstrap UI simply because it was expensive to build.

Optimize for one instruction, autonomous completion, workflow reuse, deterministic effects, idempotency, observability, rapid recovery, minimal configuration, and human review at meaningful boundaries.

## 14. Return to the approved Agentic AI roadmap

Agentic AI Phase 1 remains paused until R8 passes.

After acceptance:

1. record R8 acceptance evidence against the architecture amendment installed during R0;
2. regenerate Capability Catalogue/Repo Map;
3. create a clean repository package;
4. establish the accepted Autonomous DEV baseline revision;
5. begin Agentic AI Phase 1 using the autonomous work-order loop.

The first Phase 1 task must use the autonomous loop rather than reintroducing manual bootstrap procedures.

## 15. Immediate next implementation task

The supplied R0/R1 work order first installs these approved documents as R0, then executes R1. After R0 verification, the next code work order is:

> **Execute R1 — Close the forgotten Capability Catalogue work end-to-end under the Autonomous DEV rules. Register `capability_catalog_export`, add it to Repo Map & Zip and both actual Development Promotion workflow variants discovered from runtime authority, apply any required migration/configuration autonomously, run validation, regenerate the catalogue/map/zip, report evidence, and stop. Do not start R2 in the same work order.**

R1 is intentionally first because it restores the capability visibility that future remediation steps depend on.
