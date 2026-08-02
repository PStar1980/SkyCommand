# SkyCommand Phase 15 - Assisted Tool Catalogue Administration

## Status

**Phase 15 is complete.** Phases 15.1 through 15.7 established the architecture, authoring kit, **Tools > Manage Tools** catalogue administration, the single trusted SkyCommand repository boundary, no-execution upload analysis, editable preview, disabled-first registration, managed verification, explicit enablement, live workflow proof, regression/recovery coverage, and closure-readiness evidence.

Phase 15.5.1 preserved accessibility: administrators may choose any new destination inside the repository `packages` folder, warnings remain advisory, and preview/file hashes are limited to the temporary onboarding transaction and audit evidence. They are never runtime launch gates and never lock out an edited registered tool.

Phase 15.6 proved managed tools end to end through non-executing contract checks, controlled disabled-tool execution, explicit enable/disable handling, Run Tools execution, and published workflow use. The read-only PostgreSQL database-object comparison tool passed its contract check, completed a controlled test, was enabled, and ran in the Database Synchronization workflow beside structured Database Health and Database Build evidence. Workflow tool nodes retain enabled-state, permission, risk, parameter, path, timeout, concurrency, history, and audit controls while unattended workflow execution bypasses interactive confirmation prompts. Phase 15.7 completed the regression/recovery matrix, closure-readiness self-test, condition regression, and documentation reconciliation.

The governing rule remains:

> PostgreSQL decides what may run. Files provide implementation. Structured results provide workflow evidence.

Phase 16 now extends that rule to portable ingestion identity, domains, sources, assets, KPIs, freshness policies, and durable ingestion evidence.

## Phase 15.2 delivered foundation

Phase 15.2 adds the first functional product surface without uploading or executing any new source files:

- migration `00066__tool_catalogue_administration.sql` adds optional output-contract and managed-registration metadata to `core.tools` while preserving the existing runtime view and execution path;
- seed `00067__tool_catalogue_admin_permissions_seed.sql` adds `ADMIN_TOOL_READ` and `ADMIN_TOOL_WRITE`, with write access limited to trusted administrative roles;
- the Admin API now exposes catalogue list, detail, reference options, create, update, status, and parameter-replacement endpoints;
- catalogue writes are transactional across tool, visibility, positional parameter, and static-choice records;
- create/update/enable/disable/parameter actions are recorded in the audit ledger without source content or runtime parameter values;
- **Tools > Manage Tools** provides searchable catalogue navigation plus one editable workbench for core fields, visibility, output metadata, parameters, and choices;
- new records default to disabled, tool codes become immutable after creation, and removal remains disable-first rather than hard delete;
- existing Run Tools, scheduler, worker, CLI, workflow, and Temporal execution behavior is unchanged.

Phase 15.2 manages catalogue configuration only. Phase 15.3 adds repository designation and readiness without uploading or executing code. Browser upload, static source analysis, file promotion, contract check, and live-test behavior remain deliberately deferred to Phases 15.4-15.6.

## Phase 15.3 delivered foundation

Phase 15.3 establishes the trusted repository boundary required by managed onboarding:

- migration `00068__skycommand_repository_designation.sql` adds `core.repositories.is_skycommand_repository`, a one-TRUE unique partial index, and the designation field on `core.vw_repository_paths`;
- Configuration > Repositories displays the current active profile, designated repository, repository root, writable `packages` root, readiness state, and exact blocking error code;
- trusted administrators can set, replace, or clear the designation through audited API operations;
- only active repositories may be designated, and a designated repository cannot be disabled or soft-deleted until its role is cleared;
- `skycommandRepositoryService` resolves the active profile from the existing environment contract, verifies repository/read/write access plus the writable `packages` root, and exposes reusable readiness and package-destination containment functions;
- readiness returns `SKYCOMMAND_REPOSITORY_NOT_CONFIGURED`, `SKYCOMMAND_REPOSITORY_PATH_NOT_CONFIGURED`, or `SKYCOMMAND_REPOSITORY_PATH_INVALID` without inventing filesystem state;
- no upload staging, source execution, dependency installation, or managed-file writes are introduced in this increment.

## Phase 15.4 delivered foundation

Phase 15.4 adds the first browser-assisted onboarding workbench while preserving the trusted-administrator and no-execution boundary:

- **Tools > Add Tool** is protected by `ADMIN_TOOL_WRITE` and displays the designated repository, active profile, and writable `packages` root before accepting files;
- the browser reads one required `.js` file and optional `skycommand.tool.json` and `<outputType>.schema.json` files as UTF-8 text and sends them through bounded JSON upload limits;
- the API places each package in a random, time-limited session under the non-executable `logs/tool-onboarding` staging root with restrictive file permissions where supported;
- static syntax validation uses the installed Node.js parser through `vm.Script` and never invokes, imports, or evaluates the uploaded tool;
- source inspection reports shared `runToolCli` adapter use, constant tool/output identifiers, simple positional parameters, available/missing dependencies, relative-module review needs, filesystem/child-process/environment behavior, dynamic code, environment dumping, shell use, and secret-like literals;
- descriptor inspection validates version, identity, Node.js runtime, package-relative `src/...` entrypoint, parameter names/types/positions, result contract, visibility, and source/descriptor consistency; the promoted script retains the uploaded filename;
- catalogue-backed reference checks verify active category, runtime, permission, risk, parameter type, option source, and visibility values;
- schema inspection enforces JSON object shape, `<outputType>.schema.json` agreement, local-only `$ref`, bounded depth/node count, and the exact keywords/formats understood by the current validator;
- duplicate registered tool codes and existing suggested destinations are blocking findings; the default suggestion remains `packages/tools/custom/<toolCode>`;
- findings carry explicit ERROR/WARNING/INFO severity and confidence, while suggested configuration remains advisory and editable in the upcoming Phase 15.5 workbench;
- analysis creates an audited session record containing only filenames, sizes, SHA-256 evidence, result counts, and suggestions - never source content, secrets, or runtime parameter values;
- the page cannot register, enable, execute, install dependencies, promote files, or commit Git changes.

Phase 15.4 introduces no database migration and does not change CLI, Run Tools, worker, scheduler, workflow, Temporal, ToolResult, or generic process-adapter behavior.

## Phase 15.5 delivered foundation

Phase 15.5 completes the managed registration lane while retaining disabled-first and no-execution behavior:

- analysis suggestions now prefill an editable catalogue workbench for identity, category, permission, risk, confirmation, visibility, structured output, and positional parameters/options;
- `POST /api/admin/tool-onboarding/preview` reloads the owned, unexpired session, verifies temporary staged-file evidence, validates current catalogue references, resolves the administrator-selected destination, and returns the current command, file paths, PostgreSQL records, blockers, warnings, and preview evidence;
- preview evidence is advisory and registration always rebuilds/revalidates the current request, so a missing or changed preview hash does not create a lockout;
- warnings remain visible but advisory; only actual errors, unsafe paths, missing references, duplicate tool codes, or destination collisions block registration;
- `skycommand.tool.json` is temporary onboarding input only: SkyCommand uses it to prefill and cross-check configuration, records registration evidence, and discards it after successful registration because PostgreSQL is authoritative;
- `POST /api/admin/tool-onboarding/register` writes the approved implementation to a hidden sibling folder under the selected `packages/...` parent, promotes the script beneath `src/` with its original filename, promotes or reuses the versioned schema in `packages/tools/contracts`, creates the catalogue/visibility/parameter/option records disabled, verifies final files, records registration time and audit evidence, discards the descriptor, and removes the temporary onboarding session;
- tool codes, final package destinations, session ownership/expiry, repository readiness, schema filename/output type, and catalogue references are rechecked at both preview and registration time;
- database insertion failure removes the hidden repository staging folder; later promotion/finalization failure leaves no enabled tool and returns explicit disabled-record recovery evidence when applicable;
- the page finishes with a **Tool registered disabled** result and a direct link to **Manage Tools**. Contract check and any execution remain Phase 15.6 responsibilities.

Phase 15.5 requires no new migration because the managed-registration provenance columns were added in migration `00066__tool_catalogue_administration.sql`. CLI, scheduler, worker, workflow, Temporal, ToolResult, dependency installation, and Git behavior remain unchanged.

## Phase 15.6.2 package-layout and contract-catalogue refinement

The first real PostgreSQL comparison preview exposed three repository-consistency improvements, now implemented before registration proof:

- the Add Tool form carries an editable package-relative entrypoint, requires it beneath `src/`, and preserves the uploaded script filename;
- the optional descriptor remains staging input only and is listed in preview as **not retained**;
- optional output schemas are promoted to the shared `packages/tools/contracts/<outputType>.schema.json` catalogue, where identical existing contracts are reused and different content at the same versioned path blocks registration;
- registration preview now distinguishes `PROMOTE` from `REUSE`, shows the final entrypoint and central contract, and keeps hashes registration-only;
- package staging creates nested entrypoint folders, while central contract promotion remains disabled-first and compensating-cleanup aware.

## Phase 15.6.4 Database Build structured result

The database-build comparison workflow requires structured evidence from every database operation, not only the final comparison. `packages/db_build/src/db_build.js` now uses the shared `runToolCli` adapter and emits `database_build_summary.v1` while retaining the existing direct CLI syntax, destructive confirmation policy, `psql` execution, and globally ordered migration/seed behavior.

The output exposes:

- `output.buildCompleted` and `output.status` for workflow evidence;
- target database, current/final phase, drop/create completion, and duration;
- discovered and executed SQL, migration, and seed counts;
- first, last, last-completed, and failed SQL file paths;
- bounded ordered file rows containing kind, ordinal, status, and duration without embedding raw SQL.

Seed `00070__db_build_structured_output_seed.sql` associates the registered `db_build` catalogue record with `database_build_summary.v1` and `packages/tools/contracts/database_build_summary.v1.schema.json`. PostgreSQL remains the runtime authority; the schema validates reporting but does not become an execution gate.

### Phase 15.6.5 workflow automation confirmation policy

Interactive confirmation belongs to manual execution surfaces, not to each node in a published automation graph. SkyCommand now distinguishes two launch modes:

- `INTERACTIVE`: Run Tools and controlled administrator tests continue to enforce `requires_confirmation`; high-risk tools still require the configured phrase.
- `WORKFLOW_AUTOMATION`: inline and Temporal-backed tool nodes bypass interactive confirmation UI and typed phrases.

The workflow mode does **not** bypass the actual authorization and safety model. Tool enabled state, tool-specific permission, risk-level permission, visibility, positional parameter validation, repository/path containment, execution locks, timeout/cancellation, Tool History, and audit evidence remain enforced by the same generic process adapter. The execution ledger records `launchChannel = WORKFLOW`, `confirmationMode = WORKFLOW_AUTOMATION`, and whether an interactive confirmation would otherwise have been required.

Human Approval nodes remain fully supported when a workflow genuinely needs a business decision, legal sign-off, production release gate, or other deliberate human checkpoint. They are no longer implicitly required merely because the next tool is high risk.

### How Summary nodes belong to workflows

Summary behavior is definition-driven, not primary-key hardcoded:

1. A workflow version contains a node whose `nodeTypeCode` is `SUMMARY` and whose `inputParameters` store that workflow's title/templates/options.
2. During that workflow run, the executor invokes the generic Summary adapter with the current definition, prior node runs, and `previousOutputs` from that same run.
3. Templates resolve canonical node-key paths such as `{{ nodes.build_test.output.sqlFilesExecuted }}` or `{{ nodes.compare_databases.output.databasesMatch }}`.
4. The generated node output carries `kind: workflow_run_summary`; Workflow History locates that marker rather than checking a workflow primary key.
5. Optional purpose-built rollups such as macro ingestion or Development Promotion are selected from the presence of known output contracts and node-result shapes. They are reusable across any workflow containing those results and are not bound to one workflow ID.

The practical association is therefore **workflow version → Summary node configuration → node keys/output contracts observed in that run**. Renaming a node key requires updating templates that reference it, but copying/versioning a workflow preserves its Summary configuration without code changes.

## Architecture decision

Build two related capabilities:

1. **Manage Tools** - create, review, edit, enable, disable, and audit tool catalogue configuration, including parameters, options, visibility, permissions, risk, runtime, script path, and output metadata.
2. **Add Tool** - guide a privileged administrator through uploading or selecting a Node.js script, validating its shape, reviewing inferred configuration, optionally validating an output schema, copying approved files into a managed SkyCommand repository location, and registering the final PostgreSQL records.

The first release is intentionally narrow:

- Node.js/CommonJS tools only;
- one entry script per tool;
- positional parameters in database display order;
- optional onboarding descriptor;
- optional JSON output schema;
- administrator-selected create-new destination anywhere under `packages/`, with `packages/tools/custom/<toolCode>/` as the default;
- no automatic package installation;
- no automatic Git commit;
- no claim that uploaded code is sandboxed;
- no arbitrary absolute destination paths;
- create-new registration before in-place upgrades.

This produces a useful framework without overbuilding a package marketplace.

## User experience

### Manage Tools

The **Tools > Manage Tools** page is the minimum required administration surface.

It should provide:

- searchable/filterable catalogue list;
- category, runtime, permission, risk, status, and visibility indicators;
- selected-tool detail;
- edit form for core tool fields;
- parameter list and editor;
- static parameter choices;
- enable/disable action;
- registration provenance and managed-file status;
- audit-friendly soft deletion through disablement rather than physical record removal.

### Add Tool

The **Tools > Add Tool** page uses a compact assisted flow:

```text
Upload or select script
  -> static validation and suggestions
  -> confirm tool configuration
  -> configure positional parameters
  -> optional schema validation
  -> preview destination and database records
  -> register disabled
  -> verify files and records
  -> enable tool
```

The flow may use a single page with progressive panels rather than a complex multi-route wizard.

## SkyCommand repository designation

A tool uploaded through Admin-Web needs a trusted physical repository root.

The **Configuration > Repositories** page now allows one active repository to be marked as the SkyCommand repository. A direct repository flag keeps the model intentionally simple, while a unique partial index prevents two simultaneous designations.

Recommended database field:

```text
core.repositories.is_skycommand_repository BOOLEAN NOT NULL DEFAULT FALSE
```

A unique partial index enforces one selected repository:

```sql
CREATE UNIQUE INDEX ...
ON core.repositories ((is_skycommand_repository))
WHERE is_skycommand_repository = TRUE;
```

The active profile path from `core.repository_paths` remains the physical root. Registration fails clearly when:

- no active SkyCommand repository is designated;
- the designated repository has no active path for the current profile;
- the root does not exist or is not writable;
- the destination escapes the repository `packages` folder.

Recommended errors:

```text
SKYCOMMAND_REPOSITORY_NOT_CONFIGURED
SKYCOMMAND_REPOSITORY_PATH_NOT_CONFIGURED
SKYCOMMAND_REPOSITORY_PATH_INVALID
SKYCOMMAND_TOOL_DESTINATION_UNSAFE
```

## Managed tool package

Default location:

```text
packages/tools/custom/<toolCode>/
```

The administrator may instead choose any new directory inside `packages/`, such as `packages/git/<toolCode>/` or `packages/files/<toolCode>/`. The selected package root and editable `src/...` entrypoint determine the PostgreSQL script path; Add Tool does not rewrite source imports.

Recommended package contents:

```text
src/<descriptive-tool-name>.js      required implementation
README.md                            optional tool-specific notes
skycommand.tool.json                 optional onboarding input; not retained
<outputType>.schema.json             optional onboarding input; centralized on promotion
```

The descriptor is an onboarding convenience. It may prefill the browser form, but it is discarded after successful registration. It is never consulted at runtime and cannot override PostgreSQL catalogue configuration.

## Onboarding descriptor

Example:

```json
{
  "descriptorVersion": "1.0",
  "toolCode": "example_greeting",
  "label": "Example Greeting",
  "description": "Returns a greeting through the shared SkyCommand ToolResult adapter.",
  "runtimeCode": "node",
  "entrypoint": "src/example_greeting.js",
  "packagePath": "packages/tools/custom/example_greeting",
  "categoryCode": "file_tools",
  "permissionCode": "CORE_VIEW_TOOLS",
  "riskCode": "low",
  "requiresConfirmation": false,
  "capturesOutput": true,
  "allowParams": true,
  "parameters": [
    {
      "name": "name",
      "label": "Name",
      "type": "string",
      "required": false,
      "defaultValue": "SkyCommand",
      "position": 1
    }
  ],
  "resultContract": {
    "outputType": "example_greeting_summary.v1",
    "schemaPath": "packages/tools/contracts/example_greeting_summary.v1.schema.json"
  },
  "visibility": ["cli", "admin-web", "api", "worker"]
}
```

Supported descriptor data must map to existing catalogue concepts. Unknown fields are warnings, not hidden runtime behavior.

## Static validation

Static validation never executes uploaded code.

The initial validator should check:

- accepted extension and MIME expectations;
- maximum file size;
- UTF-8 text readability;
- Node.js syntax using the installed runtime;
- forbidden path content and unsafe filenames;
- presence of a plausible executable entrypoint;
- optional descriptor JSON validity;
- descriptor version and `toolCode` format;
- duplicate tool-code conflicts;
- supported runtime, category, risk, permission, parameter type, option source, and visibility values;
- unique parameter names and positional indexes;
- optional schema JSON validity;
- output-type and schema filename agreement;
- local-only schema references;
- obvious use of the shared `runToolCli` adapter;
- suspicious secret literals or environment dumping as warnings;
- dependency imports that are not already available in the repository as warnings or blockers.

Static analysis may suggest parameter names or output type, but suggestions must include confidence and remain editable. The descriptor and administrator confirmation are more authoritative than heuristic source parsing.

## Output schema validation

The optional schema validates the domain payload under `ToolResult.output`.

The authoring guide must document the exact JSON Schema subset supported by `packages/tools/src/jsonSchemaValidator.js`. Phase 15 should not claim universal JSON Schema compatibility.

Rules:

- valid JSON object;
- bounded file size and nesting;
- local `$ref` only;
- no remote schema fetching;
- filename should match `<outputType>.schema.json`;
- `additionalProperties: false` is recommended for stable contracts;
- large datasets should be artifact references rather than embedded arrays;
- schemas remain reporting/test assets and do not replace the PostgreSQL runtime catalogue.

## Contract check and live test

Phase 15 distinguishes three activities:

1. **Static validation** - no execution.
2. **Contract check** - a standardized non-destructive sample-result path derived from the registered output contract and optional central schema.
3. **Live test** - actual domain execution with administrator-supplied parameters.

The first vertical slice may ship static validation before contract-check execution. Live testing is added only after the registration and security boundaries are stable.

A live test must never be called safe merely because it is launched from an onboarding screen. Manual and controlled-test launches retain normal risk, confirmation, permission, timeout, and audit controls. Published workflow nodes retain permissions, risk authorization, timeout, concurrency, and audit controls but bypass interactive confirmation prompts; explicit Human Approval nodes are added only when the workflow author wants human intervention.

## Security boundary

Uploading and executing a script is privileged code deployment.

Initial controls:

- dedicated `ADMIN_TOOL_READ` and `ADMIN_TOOL_WRITE` permissions;
- write operations limited to privileged administrators;
- Node.js only;
- no automatic `npm install`;
- no shell-generated destination paths;
- strict containment inside the repository `packages` root;
- file-size, timeout, output-size, and upload-count limits;
- no raw environment display;
- complete audit events;
- files registered disabled before final enablement;
- explicit warning that the script runs with the operating-system identity of the SkyCommand process.

True untrusted-code isolation requires a later container or restricted-runner design and is outside this phase.

## Registration consistency

PostgreSQL transactions cannot atomically commit filesystem changes. Registration therefore uses a staged promotion sequence:

```text
1. Validate uploads in a non-executable staging directory.
2. Resolve and verify the SkyCommand repository root.
3. Write files to a hidden staging folder inside the repository.
4. Insert catalogue records as disabled in one database transaction.
5. Atomically rename the staged directory into the administrator-selected final package folder.
6. Re-read and verify final files and resolved catalogue data.
7. Enable only after successful verification.
8. Record registration audit evidence.
```

If file promotion fails, the tool remains disabled. If database insertion fails, staged files are removed. Recovery actions must be idempotent.

File hashes may be stored as registration evidence and copy-verification evidence only. Runtime execution does not read or compare `file_hash`, descriptor hashes, preview evidence, or SHA-256 values. Editing a registered script therefore does not disable or block it.

## Catalogue data managed in Phase 15

Existing tables remain the core model:

- `core.tools`;
- `core.tool_parameters`;
- `core.tool_parameter_options`;
- `core.tool_visibility`;
- `core.tool_categories` and category visibility;
- `core.repositories` and `core.repository_paths`;
- `core.runtimes`, `core.param_types`, `core.option_sources`, and `core.risk_levels`;
- `auth.permissions` and audit events.

Recommended additive metadata:

- SkyCommand repository designation;
- tool `output_type`;
- tool `output_schema_path`;
- `managed_by_skycommand` flag;
- original upload filename;
- registration timestamp and registering actor;
- optional registered file hash;
- optional descriptor provenance evidence; no permanent descriptor path is required for new registrations.

## Parameter scope

Phase 15 v1 preserves current execution semantics:

> Enabled tool parameters are supplied as positional command-line values in display order.

The UI can manage:

- name;
- label;
- type;
- prompt/help text;
- required flag;
- default value;
- option source;
- static choices;
- display order;
- enabled status.

Flag, environment, and stdin bindings are valuable future extensions but are not required for the first useful catalogue administration release.

## API service boundaries

Recommended administrative endpoints:

```text
GET    /api/admin/tools
POST   /api/admin/tools
GET    /api/admin/tools/:toolId
PATCH  /api/admin/tools/:toolId
PATCH  /api/admin/tools/:toolId/status
PUT    /api/admin/tools/:toolId/parameters
GET    /api/admin/repositories/skycommand-readiness
PATCH  /api/admin/repositories/:repoId/skycommand-designation
POST   /api/admin/tool-onboarding/analyze
POST   /api/admin/tool-onboarding/preview
POST   /api/admin/tool-onboarding/register
GET    /api/admin/tool-onboarding/options
```

The catalogue CRUD service and upload-analysis service should remain separate internally even if the UI combines them.

## Audit events

Recommended actions:

```text
create_tool
update_tool
enable_tool
disable_tool
set_skycommand_repository
clear_skycommand_repository
analyze_tool_upload
validate_tool_schema
register_tool_files
register_tool
registration_failed
```

Audit metadata must exclude uploaded source content, secrets, and parameter values classified as sensitive.

## Phase sequence

### Phase 15.1 - Architecture and authoring kit

- approve this implementation plan;
- publish the AI-ready authoring guide;
- publish the standalone AI build prompt;
- add a working custom-tool template and sample schema;
- update README, roadmap, change log, and repository map.

### Phase 15.2 - Manage Tools catalogue CRUD — complete

- added `ADMIN_TOOL_READ` and `ADMIN_TOOL_WRITE` permissions and administrative grants;
- added transactional tool administration API services and audited write operations;
- added **Tools > Manage Tools** with searchable catalogue list, detail/create workbench, and status controls;
- added core tool fields, positional parameters, static options, dynamic option sources, visibility, permissions, risk, runtime, repository-relative paths, and output metadata;
- preserved all existing Run Tools, CLI, worker, scheduler, workflow, and Temporal execution behavior.

### Phase 15.3 - SkyCommand repository designation — complete

- added the single-repository flag and unique partial index;
- exposed set, replace, and clear designation actions on Configuration > Repositories;
- resolved the current profile root through existing repository paths and the shared configuration-profile environment contract;
- added repository/managed-root filesystem readiness and exact blocking error evidence;
- prevented designated repositories from being disabled until the role is cleared;
- added audited API operations and a reusable readiness assertion for Phase 15.4/15.5 onboarding services.

### Phase 15.4 - Assisted upload and static analysis — complete

- added **Tools > Add Tool** with repository readiness, trusted file selectors, bounded payload evidence, and explicit no-execution/no-registration messaging;
- added a non-executable, random, 24-hour staging session for one `.js`, optional descriptor, and optional schema;
- added Node.js syntax, shared-adapter, dependency, parameter, security-policy, descriptor, catalogue-reference, schema, tool-code, and destination-collision findings;
- added confidence-labelled configuration suggestions and staged-file hash evidence without exposing source content;
- added `GET /api/admin/tool-onboarding/options` and `POST /api/admin/tool-onboarding/analyze`, audited through `ADMIN_TOOL_WRITE`;
- added `npm run tool-onboarding:self-test` and included the service and self-test in `npm run validate`.

### Phase 15.5 - File promotion and registration — complete

- added editable configuration prefill for catalogue fields, visibility, positional parameters, option sources, and static choices;
- added server-authoritative command, package/entrypoint, central-contract, onboarding-input, and PostgreSQL preview with registration-only evidence;
- added session ownership/expiry/file-evidence revalidation plus late tool-code and destination collision checks;
- added hidden in-repository package staging, preserved `src/<uploaded-filename>` promotion, centralized schema promotion/reuse, disabled-first transactional catalogue creation, and final file verification;
- added `POST /api/admin/tool-onboarding/preview` and `POST /api/admin/tool-onboarding/register`;
- added registration confirmation, success handoff to Manage Tools, and audit/recovery evidence; warnings remain advisory;
- preserved the no-execution boundary: the managed tool remains disabled and contract check/controlled execution follow in Phase 15.6.

### Phase 15.5.1 - Accessibility and package-path refinement — complete

- expanded the destination policy from one fixed custom folder to any create-new directory inside `packages/`;
- kept `packages/tools/custom/<toolCode>` as the convenience default rather than a requirement;
- made static warnings advisory and removed mandatory warning-acceptance friction;
- made preview evidence optional at registration because the server rebuilds and revalidates the request;
- added regression checks proving runtime execution services do not reference onboarding hashes or preview evidence.

### Phase 15.6 - Contract-check and controlled test proof — live managed-tool proof complete

- added managed-tool verification details, non-executing output-schema contract check, disabled-tool controlled test execution, explicit enablement, and direct handoff from Add Tool to Manage Tools;
- preserved accessibility: contract-check results, prior test outcomes, registration hashes, and preview evidence never become runtime launch gates;
- prepared the first real onboarding proof package, `db_object_compare`, which compares migration-relevant PostgreSQL objects across two named databases and exposes `output.databasesMatch` for condition routing;
- upgraded `db_health` to check one or two named databases and expose `output.allOnline`, while retaining optional strict non-zero exit behavior for direct CLI use;
- replaced canonical `tool.js` normalization with a package-relative `src/...` entrypoint that preserves the uploaded filename;
- clarified the descriptor lifecycle: the reusable `_template` descriptor is never replaced, each upload may provide a temporary descriptor, registration discards it after recording evidence, and runtime execution continues to use PostgreSQL rather than descriptor files;
- centralized uploaded output schemas under `packages/tools/contracts`, reusing identical contracts and blocking conflicting content at an existing versioned path;
- refined the registration handoff so **Open verification & test** deep-links to `view=verification`, automatically focuses the verification panel after detail loading, and exposes a persistent **Verification & test** jump action in the tool header;
- registered the PostgreSQL comparison package, passed the contract check, completed a controlled disabled-tool comparison, explicitly enabled it, and proved Run Tools plus workflow routing from `nodes.<nodeKey>.output.databasesMatch`;
- added `database_build_summary.v1` so the upcoming workflow can prove each rebuild through `nodes.<nodeKey>.output.buildCompleted` and ordered SQL execution counts before database comparison;
- separated manual confirmation from workflow automation: workflow tool nodes no longer require interactive checkboxes, typed high-risk phrases, or an immediately preceding Human Approval node, while all catalogue permissions and risk permissions remain enforced;
- completed the end-to-end database synchronization workflow proof: `db_health` supplied the primary-database prerequisite, `db_build` rebuilt the test database with structured evidence, `db_object_compare` executed through the generic workflow adapter, and the Summary node completed without workflow-specific backend wiring;
- added workflow eligibility validation so the builder lists only tools visible through both `admin-web` and `api`, while save/publish validation rejects manually injected or stale targets that lack either channel;
- added purpose-built Workflow History rendering for `postgresql_database_comparison_summary.v1`, replacing repeated flattened source/field/value rows with comparison, object-type, and difference-detail tables;
- added a contract-driven Database Synchronization Summary rollup from `database_health_summary.v1`, `database_build_summary.v1`, `postgresql_database_comparison_summary.v1`, and the health condition result. The rollup is selected by output contracts and node results, never by workflow primary key.
- added purpose-built Workflow History renderers for `database_health_summary.v1` and `database_build_summary.v1`: health evidence is grouped into one overview plus one database row per target, while build evidence is grouped into build state, discovered/executed totals, compact checkpoints, and an ordered SQL-file table instead of repeated source/field/value rows; the Summary rollup receives only compact health/build evidence and never the full SQL-file array.

### Phase 15.7 - Closure and documentation — closure readiness complete

- defined the minimum regression suite, failure/recovery behavior, deferred enhancements, and exact final live closure procedure; the former standalone closure matrix was consolidated into this document after Phase 16 completion;
- added `phase15:closure-readiness:self-test`, a dependency-free architectural regression proving central contracts, disposable descriptors, managed comparison placement, absence of runtime hash/fingerprint gates, workflow visibility/confirmation coverage, purpose-built database renderers, and required Phase 15 test commands;
- extended `workflow-condition:self-test` to prove both TRUE and FALSE routing from `nodes.db_compare_node.output.databasesMatch`;
- retained and closed regression coverage for the table-first Database Health, Database Build, PostgreSQL comparison, and Database Synchronization Summary renderers;
- reconciled README, Phase 15 status, authoring/visibility guidance references, change log, and repository map;
- completed the final validation/build and Development Promotion live-proof sequence, including the Human Approval wiring correction and successful rerun required for formal closure.

### Phase 15.7.1 - Validation isolation hardening — complete

- extracted condition normalization, typed-value parsing, path resolution, evaluation, and forward-branch selection into dependency-free `workflowConditionService.js`;
- extracted the shared `WorkflowServiceError` class into `workflowServiceError.js` so the executor and pure condition service use the same error identity without importing database infrastructure;
- changed `workflow-condition:self-test` to import the pure condition service directly instead of bootstrapping `workflowExecutorService.js`, PostgreSQL connection configuration, Axios, authentication, or Temporal services;
- added closure-readiness assertions that prevent the condition regression test from drifting back to the database-backed executor and prevent runtime dependencies from leaking into the pure condition module;
- added syntax validation for both new service modules to `npm run validate`;
- no production workflow behavior, database migration, seed, dependency, or workflow definition changed.

## Acceptance criteria

- administrators can view and manage existing PostgreSQL tool catalogue records;
- a tool and its positional parameters can be created without manual SQL;
- exactly one active repository can be designated as the SkyCommand repository;
- missing repository designation blocks managed-file registration with a clear error;
- a privileged administrator can upload a Node.js tool, optional descriptor, and optional output schema;
- uploaded files remain outside executable managed paths until approved;
- static validation produces findings and editable suggestions without executing code;
- schema validation uses the supported local JSON Schema subset;
- final paths are repo-relative and previewed: scripts remain under the selected package `src` folder, while schemas remain under `packages/tools/contracts`;
- onboarding descriptors are discarded after registration and cannot become runtime configuration;
- identical central schemas are reused, while conflicting content at an existing versioned contract path blocks registration;
- filesystem failure cannot leave an enabled catalogue record;
- database failure cannot leave promoted unmanaged files;
- existing tools, Run Tools, schedules, and workflows continue to use the same generic execution adapter; workflow automation bypasses only interactive confirmation prompts, not permissions or runtime safety controls;
- workflow tool targets must be enabled and visible in both `admin-web` and `api`; ineligible targets are omitted from the builder and rejected during save/publish validation;
- Workflow History selects table-first Database Health, Database Build, PostgreSQL comparison, and Database Synchronization Summary renderers by output contract rather than workflow identity;
- the canonical comparison path `nodes.<nodeKey>.output.databasesMatch` is covered for both TRUE and FALSE condition branches;
- PostgreSQL remains the runtime authority;
- no automatic dependency installation or Git commit occurs;
- all create, update, validate, register, enable, and disable actions are audited.

## Definition of done

Phase 15 is complete because SkyCommand provides a practical, trusted-administrator framework for creating and maintaining tool catalogue configuration, assists with controlled file onboarding into the designated SkyCommand repository, validates optional structured output contracts, and proves that a newly registered tool can run through the existing CLI/web/workflow execution architecture without custom integration code. The implementation, database synchronization workflow, validation isolation, Human Approval wiring correction, regression evidence, and final Development Promotion rerun satisfy this definition.

## Increment status

### Phase 15.7.2 - Human Approval parameter regression hotfix — complete

The final Development Promotion proof exposed a runtime-only refactor regression: `workflowExecutorService.js` still used `isBlankValue` for WAIT and Human Approval duration parsing after the helper moved into the pure condition service. Validation compiled the executor but did not execute the approval-creation path, so the undefined symbol survived until Temporal created the Human Approval request.

The correction:

- moves blank-value normalization into dependency-free `workflowParameterUtils.js`;
- imports the shared helper from both condition logic and the workflow executor;
- adds `workflow-node-parameters:self-test` for blank semantics plus WAIT/HUMAN_APPROVAL wiring;
- extends closure readiness so this cross-node parameter dependency cannot regress silently.

No workflow definition, migration, seed, approval record, or dependency change is required. The Development Promotion workflow was rerun from the beginning after restarting the API and Temporal worker, completing the final live closure proof.

| Increment | Status      | Outcome                                                                                                                 |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| 15.1      | Complete    | Architecture plan, authoring guide, AI build prompt, and custom-tool template                                           |
| 15.2      | Complete    | PostgreSQL catalogue CRUD services and **Tools > Manage Tools**                                                         |
| 15.3      | Complete    | Single SkyCommand repository designation and active-profile filesystem readiness                                        |
| 15.4      | Complete    | Trusted upload staging, static analysis, advisory suggestions, and audit evidence                                       |
| 15.5      | Complete    | Editable prefill, preview evidence, disabled-first registration, and managed file promotion                             |
| 15.5.1    | Complete    | Any create-new destination under `packages`; hashes/warnings remain advisory and non-runtime                            |
| 15.6      | Complete    | Managed verification, explicit enablement, unattended workflow execution, database build/comparison proof, workflow visibility validation, and purpose-built database comparison/summary rendering |
| 15.6.3    | Complete    | Add Tool verification deep-link, automatic panel focus, persistent jump action, and navigation self-test                |
| 15.7      | Complete      | Regression/recovery coverage, closure-readiness test, comparison condition regression, validation isolation, Human Approval parameter wiring regression coverage, documentation reconciliation, and final Development Promotion proof complete |
