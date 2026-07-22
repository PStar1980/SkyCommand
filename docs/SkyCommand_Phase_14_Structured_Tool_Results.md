# SkyCommand Phase 14 — Structured Tool Results

## Status

Phase 14 is complete. It delivers the workflow-native output architecture while keeping runtime authority in the existing PostgreSQL tool catalogue and structured reporting fail-open after successful domain execution.

The current design preserves the core principle:

> Printing is for humans. Structured return values are for workflows.

Human stdout/stderr remains in Tool History. A tool may also emit a versioned `ToolResult` through the wrapper-owned result transport. Workflow History, Summary nodes, and Condition nodes consume that deliberate result rather than parsing console output.

## Current safety decision

Structured reporting is **best-effort and fail-open after successful domain execution**.

A missing, invalid, or unwriteable structured result must never:

- turn a successfully created repository ZIP or map into a failed tool run;
- block access to registered tools;
- trigger a second execution of side-effecting work;
- require hashes, accepted snapshots, or repository-wide contract files before launch;
- prevent unrelated tools from running.

When structured output is unavailable, the workflow receives `legacy_tool_execution.v1`. The real process outcome, execution ID, logs, and generated artifacts remain authoritative.

## Runtime flow

```text
Registered PostgreSQL tool definition
  → generic API/worker child-process launcher
      → stdout/stderr → Tool History
      → optional ToolResult file → validation → workflow node result
          ↳ unavailable/invalid → warning + legacy fallback
```

The existing PostgreSQL tool catalogue remains the runtime authority for:

- tool identity and code;
- repository and script path;
- runtime;
- parameters and defaults;
- permissions and risk controls;
- Admin-Web/API/worker visibility;
- schedules and workflows.

No repository manifest or hash snapshot is consulted before execution.

## ToolResult envelope

```json
{
  "schemaVersion": "1.0",
  "success": true,
  "message": "Repository package created successfully.",
  "outputType": "repository_package_summary.v1",
  "output": {},
  "warnings": [],
  "error": null,
  "metadata": {}
}
```

The envelope is universal. The `output` payload remains domain-specific.

## Shared CLI adapter

Node tools use the same adapter without per-workflow wrappers:

```js
runToolCli({
  toolCode: 'repo_zip_generate',
  outputType: 'repository_package_summary.v1',
  execute: executeRepositoryZip,
  createToolResult: createRepositoryPackageToolResult,
  createFailureToolResult: createRepositoryPackageFailureToolResult,
  renderConsole: printRepositoryZipResult,
});
```

The adapter:

- calls the domain implementation;
- preserves familiar console output;
- creates and validates the ToolResult envelope;
- emits it when a wrapper-owned result path exists;
- returns a non-zero process code for genuine domain failure;
- records structured-result warnings without changing a successful domain result.

## Wrapper-owned transport

The API or worker creates a temporary path under:

```text
logs/tool-results
```

The wrapper supplies:

```text
SKYCOMMAND_TOOL_RESULT_PATH
SKYCOMMAND_TOOL_RESULT_DIRECTORY
SKYCOMMAND_EXECUTION_ID
SKYCOMMAND_TOOL_CODE
SKYCOMMAND_TOOL_RESULT_MAX_BYTES
```

The tool writes atomically. The wrapper reads, validates, and deletes the file. The directory is normally empty between executions.

`SKYCOMMAND_TOOL_RESULT_REQUIRED_CODES` is retired and should be removed from local `.env` files.

## Migrated output contracts

| Tool category | Tool codes | Output contract |
| --- | --- | --- |
| Macro ingestion | `ingestion_fred`, `ingestion_boc`, `ingestion_statcan` | `macro_ingestion_summary.v1` |
| Repository intelligence | `git_repo_status` | `git_repository_status.v1` |
| Repository map | `repo_map_generate` | `repository_map_summary.v1` |
| Repository package | `repo_zip_generate` | `repository_package_summary.v1` |
| Git commit | `dev_commit` | `git_commit_summary.v1` |
| Git branch synchronization | `main_merge` | `git_branch_sync_summary.v1` |
| Legacy fallback | Any tool without usable structured output | `legacy_tool_execution.v1` |

Domain JSON Schemas remain as documentation and test assets. They are not runtime launch gates.

## Canonical workflow paths

```text
nodes.<nodeKey>.result
nodes.<nodeKey>.output
nodes.<nodeKey>.output.<customPath>
nodes.<nodeKey>.warnings
nodes.<nodeKey>.error
nodes.<nodeKey>.metadata
```

Examples:

```text
nodes.fred_ingestion.output.totals.rowsInserted
nodes.repo_intel_node.output.readyForDevelopmentPromotion
nodes.repo_intel_node.output.blockers
nodes.repo_map_node.output.filesDocumented
nodes.repo_zip_node.output.filesIncluded
nodes.dev_commit_node.output.commitSha
nodes.main_merge_node.output.branchesSynchronized
nodes.main_merge_node.output.synchronizedHeadSha
```

Condition paths remain strict: a configured path that does not exist fails clearly unless a deliberate fallback value is supplied.

## Workflow History rendering

Purpose-built renderers remain active:

- macro ingestion totals and indicator results;
- watcher-safe repository readiness, branch tracking, operation state, blockers, advisories, and recent history;
- repository map summary, policy, and extension breakdown;
- repository ZIP artifact and packaging policy;
- Git commit summary;
- Git main/development branch synchronization;
- human approval decision details;
- structured Summary-node rollups, including development-promotion stages;
- generic structured key/value fallback.

Raw stdout/stderr is never promoted into normal workflow output.

## Summary nodes

Summary nodes receive compact, normalized prior-node results. Macro ingestion sources are aggregated symmetrically. Repository delivery workflows receive a development-promotion rollup covering optional Repository Intelligence preflight evidence, Repository Map, Repository ZIP, Dev Commit, human merge approval, and Main → Dev synchronization. Other workflows receive a node-result index with status, summary, output contract, and duration.

Summary association is not hardcoded to a workflow primary key. A workflow version owns a `SUMMARY` node and its templates/options. At runtime the generic Summary adapter receives only that run's definition and prior outputs, resolves `nodes.<nodeKey>...` template paths, and returns `kind: workflow_run_summary`. Workflow History detects that marker. Specialized rollups are selected from known output contracts/results present in the run, so the same summary machinery can be reused by copied or newly created workflows.

Large arrays and verbose logs are not duplicated into Summary output. Database Build now contributes compact `database_build_summary.v1` evidence—target database, build state, SQL counts, failure file, and duration—to generic key outputs without duplicating its full file list.

## Schedules

Scheduled tools keep normal Tool History logs and a compact result summary in schedule metadata when structured output is available. Missing structured output does not invalidate a successful scheduled process.

## Reliability boundaries

The following remain enforced independently of structured output:

- script path must resolve inside the configured repository root;
- the script file must exist;
- runtime must be supported;
- parameters must match the PostgreSQL tool definition;
- permissions and risk confirmation remain required;
- output size limits remain active;
- result paths remain wrapper-owned and traversal-safe;
- result files remain atomic and temporary;
- secrets must not be placed in ToolResult.

## Retired repository contract gate

The repository-enforced contract experiment was removed because it coupled essential operational and recovery tools to secondary reporting metadata. Migration `00064__remove_tool_manifest_snapshot_enforcement.sql` removes the experimental database objects from existing installations. Runtime launch decisions now come exclusively from the PostgreSQL tool catalogue and normal path, permission, parameter, runtime, and risk controls.

## Critical recovery rule

Repository ZIP generation is a recovery-critical utility.

It must remain runnable through direct CLI, Run Tools, schedules, and workflows without depending on secondary structured-reporting metadata, generated maps, or validation-suite health.

The same rule applies to Repository Map and Dev Commit: reporting may degrade, but the underlying registered operation remains accessible.

## Validation

Run:

```powershell
npm run validate
npm run web:build
```


Recommended execution verification:

1. Run `npm run git-repository-status:self-test` and `npm run workflow-result-context:self-test`.
2. Run Repository Intelligence through Run Tools and confirm the active branch and working tree are unchanged.
3. Run Repository ZIP through Run Tools.
4. Run Repository Map through Run Tools.
5. Run a Repository Intelligence → Summary proof workflow and inspect `git_repository_status.v1`.
6. Run the Repository Map → Repository ZIP → Summary workflow.
7. Run the macro refresh workflow and inspect each source result.
8. Confirm Tool History retains stdout/stderr.
9. Confirm Workflow History displays structured tables when available.
10. Confirm a deliberately missing ToolResult produces a successful tool run with a legacy workflow fallback.

## SkyServer Core workflow launch parity

The `npm run core` launcher reads the runtime-parameter schema from the published workflow definition and prompts for each value before execution. The collected values are submitted under both `params` and `runtimeParameters`, matching the API/Admin-Web contract.

Use this exact node-default expression for the `commitMessage` workflow parameter:

```text
{{ params.commitMessage }}
```

Phase 14.13.1 adds a first-class `repo` runtime type whose choices come from the active repository catalogue. Compatible repository tool fields expose the workflow parameter beside literal repository choices and save the same canonical expression form:

```text
{{ params.repoName }}
```

Admin-Web and SkyServer Core both render repository selectors, while the API validates and canonicalizes the value before execution. Type-aware binding rules prevent unrelated workflow parameter types from appearing in incompatible node fields.

The same expression resolves in inline execution and in the Temporal workflow bundle. Advanced callers may still supply additional workflow input JSON; explicitly prompted values take precedence over duplicate parameter keys in that JSON.

Temporal-backed CLI launches can optionally remain attached until the run reaches a terminal state. The monitor reads the PostgreSQL run and node ledgers directly, so it is independent of Admin-Web and Vite. This is the preferred launch path for the Repository Intelligence → Repository Map → Repository ZIP → Dev Commit → Approval → Main Merge workflow.

## Future tool onboarding

Until a dedicated catalogue UI is built, a new tool is added by:

1. creating the domain script;
2. using the shared CLI adapter with a stable `toolCode` and `outputType`;
3. adding a domain result builder and self-test;
4. registering the tool, parameters, permissions, repository path, runtime, and visibility in PostgreSQL seeds/migrations;
5. optionally adding a purpose-built Workflow History renderer;
6. testing direct, Run Tools, schedule, and workflow execution.



## Phase 14.14 — Condition and schedule proof

Phase 14.14 proves that deliberate structured results are not merely displayed; they can safely control workflow routing and remain observable when the same tool is started by the scheduler.

The promotion-preflight condition reads the canonical domain path:

```text
nodes.repo_intel_node.output.readyForDevelopmentPromotion
```

Recommended condition configuration:

| Field | Value |
| --- | --- |
| Operator | `TRUTHY` |
| Left fallback | blank |
| True target | first promotion action, normally `repo_map_node` |
| False target | final promotion Summary node |
| When false | `STOP_SUCCESS` as the fallback when no explicit false target is available |

The blank fallback is intentional. If the repository-status contract or path is missing, execution fails with `WORKFLOW_CONDITION_PATH_NOT_FOUND`; a misspelled path must never silently approve or reject a promotion. The persisted condition result records the resolved value, operator, pass/fail state, branch label, target node, and false-action policy. Workflow History renders this evidence directly, and the promotion Summary includes the gate in the preflight section and stage table.

For schedule proof, a direct Repository Intelligence schedule persists only compact contract evidence beneath `worker.schedule_runs.metadata.toolResult`. The worker API exposes that evidence separately as `structuredResultEvidence`, and Scheduler run details render repository, readiness, branches, baseline synchronization, changes, blockers, duration, output type, message, and warnings. Raw metadata remains available underneath for diagnostics; the complete tool result and stdout/stderr remain in their authoritative execution records.

Focused verification:

```powershell
npm run workflow-condition:self-test
npm run workflow-result-context:self-test
npm run validate
```

Manual proof consists of one ready repository run through the true branch, one deliberately blocked repository run through the false Summary branch, and one scheduled Repository Intelligence run whose structured evidence appears in Scheduler run detail.

## Phase 14 closure

Phase 14.14 supplied the final execution proof. The eight-node Development Promotion workflow used Repository Intelligence output to drive a strict condition gate on:

```text
nodes.repo_intel_node.output.readyForDevelopmentPromotion
```

The ready path completed Repository Map, Repository ZIP, Dev Commit, Human Merge Approval, Main-to-Development synchronization, and the final structured Summary. Workflow History displayed the persisted condition decision, all completed node contracts, approval evidence, promotion artifacts, branch synchronization, and the final rollup. Scheduler integration separately retained compact Repository Intelligence evidence without promoting stdout/stderr into schedule or workflow business output.

With the transport, contracts, fail-open behavior, catalogue authority, parameter bindings, condition routing, schedule evidence, renderers, and end-to-end proof complete, Phase 14 is closed. Phase 15 can now build the guided Tool Catalogue administration experience without redesigning the execution path.

## Development promotion contract

The recommended repository promotion workflow is:

```text
Repository Intelligence
→ Promotion Ready? condition
   ├─ TRUE  → Repository Map → Repository ZIP → Dev Commit → Human Merge Approval → Main → Dev Synchronization → Summary
   └─ FALSE → Summary (terminal branch; STOP_SUCCESS remains the no-target fallback)
```

Repository Intelligence is a checkout-free, watcher-safe preflight. It performs a non-interactive `git fetch --prune`, reads local and remote branch refs, calculates ahead/behind counts, detects locks or in-progress Git operations, reports working-tree state, and emits `git_repository_status.v1`. It never runs `git switch`, `git checkout`, `git pull`, `git reset`, or any working-tree rewrite. Dirty files are advisory because they are the intended input to Dev Commit; conflicts, stale/divergent development refs, the wrong active branch, incomplete Git operations, and an unsynchronized remote baseline are blockers.

A condition can use:

```text
nodes.repo_intel_node.output.readyForDevelopmentPromotion
```

The approval checkpoint represents the operator's confirmation that the Dev → Main pull request has been completed on GitHub. `main_merge` then performs checkout-free remote synchronization, verifies the approved Main head, advances remote Dev, updates compatible local refs without rewriting watched files, optionally creates a tag, and returns explicit local-refresh guidance when a workspace refresh is still required.

`git_branch_sync_summary.v1` records:

- source and target branches;
- main and development commit SHAs before and after synchronization;
- commits applied;
- whether the development branch advanced;
- whether both branches ended at the same commit;
- optional tag creation and push evidence;
- step-level fetch, remote fast-forward, verification, local-reference update, and tag-push completion.

The Summary node's `gitPromotion` rollup combines optional preflight evidence with repository artifacts, Dev Commit evidence, the approval decision, and branch synchronization. Conditions can reference `nodes.main_merge_node.output.branchesSynchronized` without parsing Git output.
