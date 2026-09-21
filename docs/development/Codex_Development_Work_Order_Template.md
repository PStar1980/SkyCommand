# Codex/Luna Development Work Order Template

> **Use:** Copy this file for a new development request and replace bracketed placeholders. Delete sections that are genuinely not applicable; do not leave ambiguous placeholders in an executable work order.
>
> **Authority rule:** This work order defines authority for this request only. Global Codex/ChatGPT capabilities, connected Apps, authenticated browser sessions, Computer Use, remote-device access, MCP servers, and local applications do not create task authority by themselves.

## Work order identity

- **Work order:** `[R#/phase/change name]`
- **Repository:** `[SkyCommand]`
- **Environment:** `[DEV_LOCAL]`
- **Requested by:** `[Paul/Sky]`
- **Objective:** `[concise outcome]`
- **Authorized implementation scope:** `[exact files/features/runtime/data boundaries]`
- **Explicitly out of scope:** `[next phase / production / unrelated cleanup / etc.]`
- **Promotion authorized by this work order:** `NO`

A normal implementation work order ends with **Dev Change Finalization** and a reviewable working tree. Promotion requires a separate explicit instruction unless this work order clearly says otherwise and identifies the reviewed finalization receipt.

## 1. Request-level execution-surface policy

These permissions apply **only to this work order**. They do not change global agent permissions or future requests.

Use one of: `ALLOW`, `READ_ONLY`, `DENY`, `EXPLICIT_APPROVAL_REQUIRED`.

| Execution surface | Permission | Request-specific notes |
|---|---|---|
| Repository/file editing in authorized checkout | `ALLOW` | Limited to work-order scope. |
| Local shell / repository commands | `ALLOW` | Validation/build/runtime commands only; operation-level governance still applies. |
| SkyCommand MCP/API | `ALLOW` | Prefer registered Tools/Workflows. |
| SkyCommand UI through Computer Use/browser control | `DENY` | Change to `ALLOW` only when this request should permit UI fallback/interaction. |
| General desktop Computer Use | `DENY` | Do not control unrelated applications. |
| Browser control outside SkyCommand | `DENY` | Change per request when browsing is part of the task. |
| Connected Apps/Plugins — read | `DENY` | Examples: GitHub, Dropbox, Drive, Outlook, Gmail. |
| Connected Apps/Plugins — mutation | `DENY` | Requires explicit request-level authorization. |
| Remote-device/control surfaces | `DENY` | Change per request if remote control is intended. |
| Playwright/browser automation registered in SkyCommand | `[ALLOW/DENY]` | Specify whether testing/automation is in scope. |

**Surface-substitution rule:** A failure, denial, stale wrapper, unavailable Tool, or permission problem on one surface does **not** authorize switching to another surface. Use an alternate surface only when this work order explicitly permits that fallback or Paul explicitly authorizes it during the task.

**Capability rule:** Possession of a capability does not constitute authorization to use it.

**Hard-boundary rule:** Surface permission never overrides production restrictions, direct Git mutation rules, database mutation rules, promotion boundaries, secret handling, or other active Development Operating Rules.

## 2. Governing documents

Read and follow before implementation:

- `AGENTS.md`
- `docs/development/SkyCommand_Development_Operating_Rules_v1.5.md`
- `[phase/remediation/architecture document relevant to this task]`

Where they conflict, use the active Development Operating Rules and the narrower scope of this work order. Do not silently rewrite governance or broaden the task.

## 3. Establish current facts before changing anything

Inspect the live/current development state needed for this task. At minimum, as applicable:

- Git status/diff and current branch/revision using read-only Git inspection;
- relevant source implementation and tests;
- registered Tool/Workflow definitions and current published versions;
- database identity, migration/seed ledger, pending changes, and drift state;
- runtime/Host Agent health and affected services, including effective runtime generation/freshness when behavior depends on live process state;
- non-secret configuration key presence/classification;
- current Capability Catalogue / Repo Map / generated evidence when useful.

Do not infer live runtime state from an old repo ZIP, screenshot, seed, or historical receipt when a current authoritative source exists.

## 4. Implementation requirements

Implement only the authorized scope:

1. `[requirement]`
2. `[requirement]`
3. `[requirement]`

Preserve unrelated newer work and historical applied migrations/receipts. Prefer additive, idempotent, deterministic changes. Reuse registered SkyCommand capabilities where they already exist rather than creating a parallel manual path.

### Database/configuration requirements

- Use globally numbered source-controlled migrations/seeds for normal database mutation.
- Use the registered database-upgrade path; do not use ad-hoc mutating SQL or `db:build` on an existing DEV database.
- Use typed/allowlisted configuration reconciliation for eligible non-secret values.
- Preserve secrets and local-only values; never emit secret values.
- Keep `.env.example` semantically aligned with applicable non-secret `.env` configuration introduced by the task. Do not reorder or normalize unrelated configuration solely for cosmetic reasons unless this work order explicitly includes that work.

### Runtime requirements

- Rebuild/restart only affected services unless a broader governed lifecycle action is explicitly authorized.
- Preserve Host Agent/Supervisor safety boundaries.
- Treat reviewed source/configuration state and effective running-process state as separate evidence.
- If runtime configuration or deployed source changes require service refresh, perform the required governed reconcile/rebuild/restart before acceptance testing when the request authorizes that lifecycle surface.
- Record the resulting runtime generation/freshness evidence when available; do not misclassify stale runtime state as source/configuration drift.

## 5. Recovery and retry policy

- **Existing-run recovery permitted:** `[YES/NO]`
- **Maximum recovery attempts for the same failed operation:** `[N]`
- **Replacement/new run after failure permitted:** `[YES/NO]`
- **Alternate execution-surface fallback permitted:** `[NONE / list exact permitted surfaces and conditions]`

Recovery applies to the underlying operation, not separately to each interface. Switching from MCP/API to UI/Computer Use does not reset the retry budget.

Prefer recovery of the existing durable Workflow/run when authorized. Preserve completed checkpoints. Do not create a replacement run merely because another interface is available.

If an additional execution surface would be required but is not authorized, stop and report:

1. intended operation;
2. failed/unavailable authorized surface;
3. exact blocker/error;
4. alternate surface that could complete it;
5. additional authorization required.

## 6. Validation and finalization

Run the focused tests and repository validation appropriate to the change, including `[list specific tests/checks]`.

Then run exactly one fresh governed **Dev Change Finalization** Workflow unless this work order explicitly defines another accepted boundary.

Acceptance requires, as applicable:

- required tests/validation pass, with known baseline limitations kept distinct;
- database pending count/drift/ledger state are correct;
- required runtime and Host Agent checks are healthy;
- generated Capability Catalogue / Repo Map / Repo ZIP / receipt are current;
- receipt/source/configuration/database identity is internally consistent;
- runtime generation/freshness is consistent with the reviewed state where applicable;
- `git diff --check` passes;
- working tree contains only expected reviewable changes.

Do not start Development Promotion during an implementation work order when `Promotion authorized by this work order` is `NO`.

## 7. Promotion boundary

**Default:** promotion is not authorized here.

When Paul later explicitly authorizes promotion, bind it to the reviewed successful finalization receipt and use the registered **Dev Promotion Local / `skyserver_dev_commit`** path. Do not replace the governed promotion chain with direct Git/GitHub mutation.

The expected mutation order remains:

**Verify DEV Promotion Preflight → evidence refresh → Dev Commit → Merge GitHub Dev PR → Repo Merge / Sync → Local Repository Sync → Development Promotion Summary**

For a promotion-specific request, record:

- **Reviewed finalization run/receipt ID:** `[ID]`
- **Authorized commit message:** `[message]`
- **Promotion recovery policy:** `[policy]`
- **Promotion execution-surface policy:** `[surface permissions, if different from implementation]`

## 8. Observability requirement

Report the actual execution path, not only the final result.

At minimum disclose:

- SkyCommand Workflows/Tools invoked and run/execution IDs;
- local/runtime commands materially affecting the task;
- recovery/retry actions;
- any human intervention;
- any execution-surface substitution;
- any use of Computer Use, browser control, connected Apps/Plugins, or remote-device control, including the application/site and the governed operation invoked;
- terminal result and durable receipts/evidence.

If Computer Use/browser activity invokes SkyCommand, identify the underlying Workflow/Tool/recovery receipt when available.

## 9. Stop conditions

Stop before completion only when:

- the required action is outside this work order;
- a production/non-DEV effect would occur;
- a required secret has no authorized source;
- repository/database/configuration drift makes deterministic continuation unsafe;
- a destructive/non-idempotent operation outside the active contract is required;
- an authorized required capability genuinely fails unrecoverably;
- completion requires an execution surface not authorized by this work order;
- continuing would enter the next roadmap phase or alter governance.

Do not stop merely to ask Paul to perform routine work that is already authorized and executable through the permitted surfaces.

## 10. Completion report

Return a concise report containing:

- files added/modified/removed;
- configuration keys changed by **name only**;
- migrations/seeds and ledger result;
- runtime/service actions;
- Tool/Workflow run IDs and structured outcomes;
- tests/validation with exact results and known baseline limitations;
- generated artifacts and hashes/paths as applicable;
- execution surfaces actually used, surface substitutions, retries/recovery, and human intervention;
- material discrepancies or remaining blockers;
- final Git status and concise diff summary;
- acceptance result for this work order.

Then stop for Paul/Sky review. Do not continue into promotion or the next phase unless separately authorized.
