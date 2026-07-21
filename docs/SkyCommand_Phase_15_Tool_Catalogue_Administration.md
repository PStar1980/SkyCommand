# SkyCommand Phase 15 - Assisted Tool Catalogue Administration

## Status

Phase 15 is in progress. Phases 15.1 through 15.5 established the architecture, authoring kit, **Tools > Manage Tools** catalogue administration, the single trusted SkyCommand repository boundary, no-execution upload analysis, editable preview, and disabled-first registration. **Phase 15.5.1 now refines accessibility:** administrators may choose any new destination inside the repository `packages` folder, warnings remain advisory, and preview/file hashes are limited to the temporary onboarding transaction and audit evidence. They are never runtime launch gates and never lock out an edited registered tool. Uploaded code is still not executed.

Phase 15.6 verification infrastructure is now implemented: managed tools can receive a non-executing contract check, a controlled disabled-tool test run, and explicit enable/disable handling through **Tools > Manage Tools**. The first real proof package is now prepared for frontend onboarding: a read-only PostgreSQL database-object comparison tool with two database-name parameters and `postgresql_database_comparison_summary.v1`. The browser registration, controlled run, Run Tools proof, and workflow-condition proof remain the next hands-on verification steps.

The governing rule remains:

> PostgreSQL decides what may run. Files provide implementation. Structured results provide workflow evidence.

Phase 15 deliberately starts with catalogue management and a conservative onboarding assistant. It does not attempt to turn SkyCommand into a general-purpose untrusted-code hosting service.

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
- descriptor inspection validates version, identity, Node.js runtime, entrypoint agreement, parameter names/types/positions, result contract, visibility, and source/descriptor consistency;
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
- SkyCommand always generates a canonical `skycommand.tool.json` from the administrator-approved configuration, ensuring the managed descriptor documents the actual PostgreSQL registration rather than preserving stale suggestions;
- `POST /api/admin/tool-onboarding/register` writes the approved package to a hidden sibling folder under the selected `packages/...` parent, creates the catalogue/visibility/parameter/option records disabled, atomically renames the package into place, re-reads the just-promoted files, records registration time and audit evidence, and removes the temporary onboarding session;
- tool codes, final package destinations, session ownership/expiry, repository readiness, schema filename/output type, and catalogue references are rechecked at both preview and registration time;
- database insertion failure removes the hidden repository staging folder; later promotion/finalization failure leaves no enabled tool and returns explicit disabled-record recovery evidence when applicable;
- the page finishes with a **Tool registered disabled** result and a direct link to **Manage Tools**. Contract check and any execution remain Phase 15.6 responsibilities.

Phase 15.5 requires no new migration because the managed-registration provenance columns were added in migration `00066__tool_catalogue_administration.sql`. CLI, scheduler, worker, workflow, Temporal, ToolResult, dependency installation, and Git behavior remain unchanged.

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

The administrator may instead choose any new directory inside `packages/`, such as `packages/git/<toolCode>/` or `packages/files/<toolCode>/`. The selected destination is stored in the descriptor and PostgreSQL script path; Add Tool does not rewrite source imports.

Recommended package contents:

```text
tool.js                              required
skycommand.tool.json                 optional onboarding descriptor
<outputType>.schema.json             optional output schema
README.md                            optional tool-specific notes
```

The descriptor is an onboarding convenience. It may prefill the browser form and be retained beside the tool, but it is not consulted at runtime and cannot override PostgreSQL catalogue configuration.

## Onboarding descriptor

Example:

```json
{
  "descriptorVersion": "1.0",
  "toolCode": "example_greeting",
  "label": "Example Greeting",
  "description": "Returns a greeting through the shared SkyCommand ToolResult adapter.",
  "runtimeCode": "node",
  "entrypoint": "tool.js",
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
    "schemaPath": "example_greeting_summary.v1.schema.json"
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
2. **Contract check** - a standardized non-destructive sample-result path supplied by the tool or descriptor.
3. **Live test** - actual domain execution with administrator-supplied parameters.

The first vertical slice may ship static validation before contract-check execution. Live testing is added only after the registration and security boundaries are stable.

A live test must never be called safe merely because it is launched from an onboarding screen. Mutating tools retain normal risk, confirmation, permission, timeout, and audit controls.

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
- optional descriptor path.

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
- added server-authoritative command, path, file, descriptor, and PostgreSQL preview with registration-only evidence;
- added session ownership/expiry/file-evidence revalidation plus late tool-code and destination collision checks;
- added canonical descriptor generation, hidden in-repository package staging, disabled-first transactional catalogue creation, atomic directory promotion, and final file verification;
- added `POST /api/admin/tool-onboarding/preview` and `POST /api/admin/tool-onboarding/register`;
- added registration confirmation, success handoff to Manage Tools, and audit/recovery evidence; warnings remain advisory;
- preserved the no-execution boundary: the managed tool remains disabled and contract check/controlled execution follow in Phase 15.6.

### Phase 15.5.1 - Accessibility and package-path refinement — complete

- expanded the destination policy from one fixed custom folder to any create-new directory inside `packages/`;
- kept `packages/tools/custom/<toolCode>` as the convenience default rather than a requirement;
- made static warnings advisory and removed mandatory warning-acceptance friction;
- made preview evidence optional at registration because the server rebuilds and revalidates the request;
- added regression checks proving runtime execution services do not reference onboarding hashes or preview evidence.

### Phase 15.6 - Contract-check and controlled test proof — framework complete; live proof pending

- added managed-tool verification details, non-executing output-schema contract check, disabled-tool controlled test execution, explicit enablement, and direct handoff from Add Tool to Manage Tools;
- preserved accessibility: contract-check results, prior test outcomes, registration hashes, and preview evidence never become runtime launch gates;
- prepared the first real onboarding proof package, `db_object_compare`, which compares migration-relevant PostgreSQL objects across two named databases and exposes `output.databasesMatch` for condition routing;
- upgraded `db_health` to check one or two named databases and expose `output.allOnline`, while retaining optional strict non-zero exit behavior for direct CLI use;
- pending local proof: onboard/register the comparison package, run contract check and controlled execution, enable it, verify Run Tools, and route a workflow condition from `nodes.<nodeKey>.output.databasesMatch`.

### Phase 15.7 - Closure and documentation

- complete regression tests;
- document failure and recovery cases;
- run the Development Promotion workflow;
- mark Phase 15 complete.

## Acceptance criteria

- administrators can view and manage existing PostgreSQL tool catalogue records;
- a tool and its positional parameters can be created without manual SQL;
- exactly one active repository can be designated as the SkyCommand repository;
- missing repository designation blocks managed-file registration with a clear error;
- a privileged administrator can upload a Node.js tool, optional descriptor, and optional output schema;
- uploaded files remain outside executable managed paths until approved;
- static validation produces findings and editable suggestions without executing code;
- schema validation uses the supported local JSON Schema subset;
- final paths are repo-relative, previewed, and contained anywhere under the designated repository `packages` root;
- filesystem failure cannot leave an enabled catalogue record;
- database failure cannot leave promoted unmanaged files;
- existing tools, Run Tools, schedules, and workflows continue to use the same generic execution adapter;
- PostgreSQL remains the runtime authority;
- no automatic dependency installation or Git commit occurs;
- all create, update, validate, register, enable, and disable actions are audited.

## Definition of done

Phase 15 is complete when SkyCommand provides a practical, trusted-administrator framework for creating and maintaining tool catalogue configuration, assists with safe file onboarding into the designated SkyCommand repository, validates optional structured output contracts, and proves that a newly registered tool can run through the existing CLI/web/workflow execution architecture without custom integration code.

## Increment status

| Increment | Status      | Outcome                                                                                                                 |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| 15.1      | Complete    | Architecture plan, authoring guide, AI build prompt, and custom-tool template                                           |
| 15.2      | Complete    | PostgreSQL catalogue CRUD services and **Tools > Manage Tools**                                                         |
| 15.3      | Complete    | Single SkyCommand repository designation and active-profile filesystem readiness                                        |
| 15.4      | Complete    | Trusted upload staging, static analysis, advisory suggestions, and audit evidence                                       |
| 15.5      | Complete    | Editable prefill, preview evidence, disabled-first registration, and managed file promotion                             |
| 15.5.1    | Complete    | Any create-new destination under `packages`; hashes/warnings remain advisory and non-runtime                            |
| 15.6      | In progress | Verification framework and PostgreSQL comparison proof package ready; local onboarding/Run Tools/workflow proof pending |
| 15.7      | Planned     | Regression matrix, Development Promotion, and closure                                                                   |
