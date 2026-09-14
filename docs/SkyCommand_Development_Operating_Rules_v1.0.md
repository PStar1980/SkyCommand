# SkyCommand Development Operating Rules v1.0

**Status:** Active development governance  
**Applies to:** Paul, Sky/ChatGPT, Codex/Luna/Astra, future coding agents, and any agent operating on the SkyCommand repository  
**Primary architecture authority:** `docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.0_APPROVED.md`

## 1. Development ownership

- Paul owns final acceptance, approval, promotion, and release decisions.
- Sky/ChatGPT owns continuity, architecture review, implementation review, correction guidance, and phase acceptance with Paul.
- High-capability architecture agents such as Astra may propose architecture or implementation plans, but their output is reviewed before becoming authoritative.
- Implementation agents such as Luna/Codex work only inside the explicitly assigned phase/task and stop for review when finished.
- An agent must not silently continue into the next roadmap phase.

## 2. Git and Development Promotion

Until these rules are explicitly revised:

- Coding agents MUST NOT directly run `git commit`, `git merge`, `git push`, `git pull`, `git rebase`, `git reset`, `git checkout`, `git switch`, branch deletion, tag mutation, or equivalent source-control mutation commands.
- Read-only Git inspection is allowed when needed: examples include `git status`, `git diff`, `git diff --check`, `git log`, `git show`, and revision/hash inspection.
- Development commits and promotion are performed through SkyCommand's registered **Dev Promotion Local** workflow (`skyserver_dev_commit`) or another explicitly approved SkyCommand promotion workflow.
- An agent may start Dev Promotion Local only when Paul explicitly requests that specific promotion and the change set has passed the agreed review/validation gate.
- For the current supervised procedure, the initiating agent MUST stop interacting with the promotion run immediately after SkyCommand confirms that the workflow was accepted/started.
- The initiating agent MUST NOT approve the workflow's Merge Approval node, retry failed promotion nodes, merge, synchronize, or otherwise continue the promotion unless Paul gives a new explicit instruction.
- Human approval remains the boundary for the merge/promotion portion of the workflow.

## 3. Database safety

- Agents may inspect database-related source, schemas, migrations, seeds, and read-only database metadata when authorized.
- Agents may create or modify a new migration/seed as part of an explicitly assigned implementation task.
- Agents MUST NOT run `npm run db:build` against an existing development database. `db:build` is destructive.
- Agents MUST NOT directly execute DDL/DML, migrations, seeds, `psql`, database rebuilds, cutovers, restores, or equivalent database-changing commands merely because credentials or Docker/network access are available.
- Applying database changes requires an explicitly approved SkyCommand tool/workflow or Paul’s explicit approval for the exact operation after review.
- Historical migration files are immutable unless Paul and Sky explicitly approve an exceptional repair strategy.

## 4. Docker, host, network, and secrets

- Do not use Docker control, Host Agent operations, OS-level administration, package installation, external network calls, or commands outside the repository unless the task requires them and approval is explicit.
- Never copy, print, expose, summarize, or persist secrets from `.env`, credentials, tokens, provider sessions, connection strings, or secret stores.
- Availability of a credential does not grant authority to use it.
- Prefer registered SkyCommand capabilities over direct host/system operations when an appropriate capability exists.

## 5. Task and phase discipline

Before editing:

1. Read the authoritative architecture/requirements for the assigned task.
2. Inspect repository reality.
3. Report material discrepancies rather than silently redesigning around them.
4. State the intended change scope when the task is substantial.

During implementation:

- Preserve existing Tool, Workflow, Scheduler, Access Control, Playwright, MCP, Docker, Git, and observability behavior unless the task explicitly changes one of them.
- Do not weaken authorization or safety gates to make a test pass.
- Do not introduce provider-specific assumptions into provider-neutral contracts unless the provider adapter owns them.
- Keep migrations additive and backward-compatible where required by the approved architecture.
- Do not fix unrelated problems inside the same change unless separately approved.

At completion:

1. List files added/modified.
2. Map requirements to changes.
3. Report tests/validation and exact results.
4. Identify assumptions/discrepancies.
5. Identify security-relevant decisions.
6. List deliberately deferred work.
7. Show `git status` and a concise diff summary.
8. Stop for review unless explicitly instructed otherwise.

## 6. Validation and evidence

- A model saying "tests passed" is not canonical evidence; command/test receipts are.
- Existing unrelated baseline failures must remain visible and must not be relabeled as regressions from the current task.
- Do not commit/promotion-start a change with a newly introduced unexplained failure.
- Repository-generated artifacts, structured outputs, screenshots, diffs, test results, and hashes should be retained when they materially support acceptance.
- Generated runtime/catalog snapshots must identify source revision, environment, generation time, and data source.

## 7. Capability catalogue visibility

SkyCommand should maintain a generated capability catalogue so Paul and Sky can inspect installed/configured runtime resources without relying on screenshots or memory.

Target generated outputs:

- `docs/generated/SkyCommand_Capability_Catalog.xlsx`
- `docs/generated/SkyCommand_Capability_Catalog.json`

At minimum include:

- registered Tools and parameters;
- Workflow definitions, versions, runtime parameters, nodes, status/category and start permissions;
- Playwright Tests;
- Playwright Test Suites and members;
- Playwright Automations, parameters, environments, risk, side effects, confirmation requirement, Assistant opt-in and permission;
- Scheduler definitions/targets;
- registered repositories and environments;
- relevant execution/permission metadata needed to understand what an agent can request.

The spreadsheet is the human-friendly view; the JSON companion is the machine-friendly source for Sky/agents. Generated catalogue files are snapshots, not the runtime database authority.

## 8. Agent-to-SkyCommand execution

- An agent may use only SkyCommand MCP/API capabilities that are explicitly exposed and allowlisted to its identity/context.
- MCP/client connectivity alone does not imply permission to execute.
- High-impact operations should use explicit server-side authorization/approval boundaries; do not treat prompt wording as a security control.
- For bootstrap integrations created before the full Agent Runtime architecture exists, keep allowlists exact and kill switches default-off.

## 9. Change to these rules

These rules remain active until Paul explicitly approves a revision. A coding agent may recommend a change but MUST NOT modify the rules to grant itself broader authority as part of an unrelated task.
