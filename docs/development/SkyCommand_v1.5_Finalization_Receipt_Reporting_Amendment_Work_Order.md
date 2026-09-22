# SkyCommand v1.5 Finalization Receipt Reporting Amendment — Development Work Order

> **Authority rule:** This work order defines authority for this request only. Capability availability does not create authority beyond this scope.

## Work order identity

- **Work order:** `v1.5 Finalization Receipt Reporting Amendment`
- **Repository:** `SkyCommand`
- **Environment:** `DEV_LOCAL`
- **Requested by:** `Paul/Sky`
- **Objective:** Apply the approved reporting-only amendment so every successful Dev Change Finalization completion report surfaces the canonical receipt SHA-256 and related promotion-binding evidence, and update the Codex/Luna Development Work Order Template accordingly.
- **Authorized implementation scope:** Documentation/governance files only:
  - `docs/development/SkyCommand_Development_Operating_Rules_v1.5.md`
  - `docs/development/Codex_Development_Work_Order_Template.md`
  - any generated Repo Map evidence refreshed by finalization
- **Explicitly out of scope:** Application/runtime behavior changes; Workflow/node changes; database schema/migrations/seeds; Agent Phase 19.2C/19.3 work; production activity; direct Git/GitHub mutation.
- **Promotion authorized by this work order:** `NO`

## 1. Source documents

Use the attached approved drafts as the target content:

1. `SkyCommand_Development_Operating_Rules_v1.5_REPORTING_AMENDED.md`
2. `Codex_Development_Work_Order_Template_REPORTING_UPDATED.md`

Preserve existing v1.5 governance semantics. This is a reporting/observability clarification, not a new approval gate.

## 2. Required changes

Apply only the reporting amendment represented by the approved drafts:

- retain version `v1.5`;
- update the revision description/date to include mandatory finalization-receipt reporting;
- add §8.1 **Mandatory finalization receipt reporting**;
- require successful finalization completion reports to include:
  - finalization Workflow/run ID;
  - terminal status;
  - effective finalization/runtime profile;
  - canonical receipt path;
  - canonical receipt SHA-256;
  - reviewed source identity/digest;
  - database pending/drift state;
  - readiness result;
- explicitly state that the completion message is presentation, while durable Workflow/finalization records and the receipt remain canonical evidence;
- if structured output omits the SHA, resolve it from the authoritative finalization record and independently hash the canonical local receipt bytes when available; mismatch must fail/report, not be rewritten away;
- require later promotion work orders to record both reviewed finalization run/receipt ID **and reviewed receipt SHA-256**;
- update the work-order completion/observability sections to carry the mandatory finalization receipt block.

Do not add another human approval step. Do not change promotion preflight semantics; it must continue independently verifying the reviewed receipt binding and fail closed on drift.

## 3. Validation

Before finalization:

- confirm only the intended governance/template text changed;
- verify Markdown structure/headings are valid and links/paths remain correct;
- verify no current v1.5 authority or execution-surface rules were weakened;
- verify no Phase 19.2C/19.3 implementation was introduced;
- run repository documentation/validation checks applicable to these files;
- run `git diff --check`.

Then run exactly one fresh governed **Dev Change Finalization**.

## 4. Acceptance

Acceptance requires:

- both target repo documents match the approved drafts semantically;
- no application/runtime/database behavior changed;
- existing known baseline limitations remain distinct;
- Dev Change Finalization completes successfully;
- Luna's completion report itself demonstrates the new reporting standard by including:
  - finalization Run ID;
  - Status;
  - Profile;
  - Receipt path;
  - Receipt SHA-256;
  - Source identity;
  - Database state;
  - Readiness;
- working tree remains reviewable and uncommitted;
- no promotion occurs.

## 5. Completion report

Return:

- files modified;
- concise description of the reporting amendment;
- validation results;
- exact mandatory Finalization block;
- final Git status/diff summary;
- confirmation that no runtime/database/Phase 19.2C/19.3 work occurred.

Then stop for Paul/Sky review.

**Do not promote.**
