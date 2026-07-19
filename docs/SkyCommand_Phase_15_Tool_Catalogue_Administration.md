# SkyCommand Phase 15 - Assisted Tool Catalogue Administration

## Status

Phase 15 is in progress. This phase adds a guided administration layer over the existing PostgreSQL tool catalogue without changing the execution architecture completed in Phase 14.

The governing rule remains:

> PostgreSQL decides what may run. Files provide implementation. Structured results provide workflow evidence.

Phase 15 deliberately starts with catalogue management and a conservative onboarding assistant. It does not attempt to turn SkyCommand into a general-purpose untrusted-code hosting service.

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
- managed destination under `packages/tools/custom/<toolCode>/`;
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

The **Configuration > Repositories** page will allow exactly one active repository to be marked as the SkyCommand repository. The initial implementation should use a direct repository flag because Phase 15 has one concrete role and simplicity is preferred.

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
- the destination escapes an approved managed folder.

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
- strict managed-root resolution;
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
5. Atomically rename staged files into the final managed folder.
6. Re-read and verify final files and resolved catalogue data.
7. Enable only after successful verification.
8. Record registration audit evidence.
```

If file promotion fails, the tool remains disabled. If database insertion fails, staged files are removed. Recovery actions must be idempotent.

File hashes may be stored as registration evidence and change detection, but they are not runtime launch gates.

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
POST   /api/admin/tool-onboarding/analyze
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

### Phase 15.2 - Manage Tools catalogue CRUD

- add administrative read/write permissions;
- add tool administration API services;
- create Tools > Manage Tools;
- support core tool fields, positional parameters, options, visibility, and enable/disable;
- preserve all existing Run Tools behavior.

### Phase 15.3 - SkyCommand repository designation

- add the single-repository flag and unique constraint;
- expose the designation on Configuration > Repositories;
- resolve the active profile root through existing repository paths;
- add readiness/error reporting.

### Phase 15.4 - Assisted upload and static analysis

- add trusted upload staging;
- support one `.js`, optional descriptor, and optional schema;
- validate syntax, metadata, paths, dependencies, and schema;
- present suggestions with confidence and editable configuration.

### Phase 15.5 - File promotion and registration

- preview final managed paths and database records;
- stage files inside the SkyCommand repository;
- register disabled;
- atomically promote files;
- verify and enable;
- capture audit evidence and recovery state.

### Phase 15.6 - Contract-check and controlled test proof

- support a non-destructive sample ToolResult contract check;
- optionally execute a real test through normal permission/risk controls;
- preview logs and structured output;
- prove the newly registered tool in Run Tools and a workflow condition.

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
- final paths are repo-relative, previewed, and contained under approved managed roots;
- filesystem failure cannot leave an enabled catalogue record;
- database failure cannot leave promoted unmanaged files;
- existing tools, Run Tools, schedules, and workflows continue to use the same generic execution adapter;
- PostgreSQL remains the runtime authority;
- no automatic dependency installation or Git commit occurs;
- all create, update, validate, register, enable, and disable actions are audited.

## Definition of done

Phase 15 is complete when SkyCommand provides a practical, trusted-administrator framework for creating and maintaining tool catalogue configuration, assists with safe file onboarding into the designated SkyCommand repository, validates optional structured output contracts, and proves that a newly registered tool can run through the existing CLI/web/workflow execution architecture without custom integration code.
