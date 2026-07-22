# SkyCommand Tool Authoring Guide

## Purpose

This guide is intentionally self-contained. It can be given to a developer or an AI coding assistant to create a SkyCommand-compatible Node.js tool without sharing the full repository.

SkyCommand tools are normal command-line programs that also know how to emit a deliberate workflow result through the shared adapter.

The essential rule is:

> Console output is for people. `ToolResult.output` is for workflows.

## Supported first-release package

```text
<tool-package>/
  tool.js                              required
  skycommand.tool.json                 recommended
  <outputType>.schema.json             optional
  README.md                            optional
```

Managed packages may be installed in any administrator-selected new directory inside the repository `packages` folder.

```text
packages/<chosen-area>/<toolCode>/
```

The default remains `packages/tools/custom/<toolCode>/`, but the Add Tool page may instead use locations such as `packages/git/<toolCode>/` or `packages/files/<toolCode>/`. Absolute paths, `..` traversal, the `packages` root itself, and overwriting an existing destination are rejected.

Each tool package owns its own `skycommand.tool.json`. The file under `packages/tools/custom/_template/` is a reusable example only; onboarding a new tool never replaces or edits that template and never overwrites another tool's descriptor because every tool uses a distinct package directory.

## Runtime assumptions

Phase 15 v1 supports Node.js/CommonJS tools.

The tool is launched as:

```text
node <repo-relative-script-path> <parameter-1> <parameter-2> ...
```

Parameters are positional and supplied in database display order. Avoid relying on the current working directory; resolve paths from `__dirname` or from configured repository parameters.

## Browser onboarding and static analysis

A trusted administrator can open **Tools > Add Tool** and upload:

1. one required `.js` entry script;
2. optional `skycommand.tool.json`;
3. optional `<outputType>.schema.json`.

The uploaded script may have a descriptive local filename such as `db_object_compare.js`. Managed registration installs the approved entry script as the package's canonical `tool.js` and generates a canonical descriptor that records `entrypoint: "tool.js"`.

Phase 15.4 copies these UTF-8 text files into a random, non-executable `logs/tool-onboarding/<sessionId>` staging session and analyzes them without importing or executing the script. The session expires after 24 hours.

The analyzer checks:

- Node.js/CommonJS syntax;
- standard `runToolCli` adapter use;
- `TOOL_CODE` and `OUTPUT_TYPE` constants when written conventionally;
- simple positional parameter destructuring;
- installed package dependencies and extra relative-module references;
- descriptor version, entrypoint, parameters, visibility, permission, category, runtime, and risk;
- schema filename, local-only references, supported keywords/formats, depth, and size;
- existing catalogue tool-code and managed-destination collisions;
- review signals such as filesystem access, child processes, environment use, shell execution, dynamic code, environment dumping, and secret-like literals.

Analysis returns ERROR, WARNING, and INFO findings plus confidence-labelled suggestions. Suggestions never register the tool automatically. Phase 15.5 presents them as editable configuration, including the package destination, and registers only after explicit confirmation. The resulting tool is written to the selected new directory under `packages`, recorded in PostgreSQL, and left disabled for Phase 15.6 contract checking and controlled execution.

Preview fingerprints and SHA-256 values are onboarding evidence only. They protect the temporary upload/copy operation and support audit/collision diagnosis. They are never checked when a registered tool runs, never become accepted snapshots, and never disable a tool after its source is edited.

Current upload limits:

```text
script       256 KB
descriptor    64 KB
schema       256 KB
combined     640 KB
```

The onboarding page never runs `npm install`, never executes the uploaded script, never registers a catalogue record, and never commits Git changes during static analysis.

## Shared adapter import

The shared adapter lives at `packages/tools/src`. The tool must use the correct relative import for its selected destination.

For a tool stored at `packages/tools/custom/<toolCode>/tool.js`:

```js
const { runToolCli } = require('../../src');
```

For a tool stored elsewhere under `packages`, calculate the relative path from that package directory to `packages/tools/src`. For example, a tool installed at `packages/db_compare/tool.js` uses:

```js
const { runToolCli } = require('../tools/src');
```

The Add Tool service does not rewrite imports. Static analysis accepts any relative CommonJS import that resolves to `packages/tools/src`; it no longer assumes every tool lives at the default folder depth.

The adapter preserves domain success even when optional structured reporting cannot be emitted.

## Minimal implementation

```js
#!/usr/bin/env node

const { runToolCli } = require('../../src');

const TOOL_CODE = 'example_greeting';
const OUTPUT_TYPE = 'example_greeting_summary.v1';

async function executeGreeting(args = []) {
  const [name = 'SkyCommand'] = args.map(String);

  return {
    name,
    greeting: `Hello, ${name}!`,
    generatedAt: new Date().toISOString(),
  };
}

function createToolResult(result) {
  return {
    schemaVersion: '1.0',
    success: true,
    message: `Greeting created for ${result.name}.`,
    outputType: OUTPUT_TYPE,
    output: result,
    warnings: [],
    error: null,
    metadata: {},
  };
}

function createFailureToolResult(error) {
  return {
    schemaVersion: '1.0',
    success: false,
    message: error.message || 'Greeting failed.',
    outputType: OUTPUT_TYPE,
    output: {
      name: 'Unknown',
      greeting: 'Greeting unavailable.',
      generatedAt: new Date().toISOString(),
    },
    warnings: [],
    error: {
      code: error.code || 'EXAMPLE_GREETING_FAILED',
      message: error.message || 'Greeting failed.',
    },
    metadata: {},
  };
}

function renderConsole(result) {
  console.log(result.greeting);
}

async function main() {
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: OUTPUT_TYPE,
    execute: executeGreeting,
    createToolResult,
    createFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  executeGreeting,
  createToolResult,
  createFailureToolResult,
};
```

## ToolResult envelope

```json
{
  "schemaVersion": "1.0",
  "success": true,
  "message": "One concise result sentence.",
  "outputType": "example_summary.v1",
  "output": {},
  "warnings": [],
  "error": null,
  "metadata": {}
}
```

### Required behavior

- `schemaVersion` must be `1.0`.
- `success` must be a boolean.
- `outputType` must be a stable lowercase contract name ending in a version, such as `.v1`.
- `output` must contain deliberate domain fields only.
- `warnings` is an array of non-fatal conditions.
- `error` is `null` on success and a safe object on failure.
- `metadata` must be non-sensitive.

### JSON safety

Do not return:

- functions;
- `undefined`;
- symbols;
- `BigInt`;
- circular references;
- class instances;
- passwords, tokens, authorization headers, or raw environment values.

Dates should be ISO-8601 strings. Large files should be referenced by artifact path rather than embedded.

## Parameters

Phase 15 v1 supports these catalogue types:

```text
string
number
boolean
repo
select
path
date
```

Positional example:

```text
node tool.js <repositoryCode> <dryRun> <maximumItems>
```

Implementation:

```js
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

async function execute(args = []) {
  const [repositoryCode, rawDryRun = 'true', rawMaximumItems = '25'] = args;
  const dryRun = parseBoolean(rawDryRun, true);
  const maximumItems = Number.parseInt(rawMaximumItems, 10);

  if (!repositoryCode) {
    const error = new Error('Repository is required.');
    error.code = 'REPOSITORY_REQUIRED';
    throw error;
  }

  if (!Number.isInteger(maximumItems) || maximumItems < 1) {
    const error = new Error('Maximum items must be a positive integer.');
    error.code = 'MAXIMUM_ITEMS_INVALID';
    throw error;
  }

  return { repositoryCode, dryRun, maximumItems };
}
```

Validate parameters again inside the tool. Browser validation improves usability but is not a security boundary.

## Repository parameters

A `repo` parameter receives the registered repository code, not an arbitrary path. Resolve the physical path through the PostgreSQL repository catalogue when the domain operation requires it.

Do not accept an unrestricted absolute path when a repository code can express the requirement.

## Console output

Keep console logs useful for Tool History:

```js
console.log('Starting repository inspection...');
console.log(`Repository: ${repositoryCode}`);
console.log('Inspection completed.');
```

Do not expect workflows to parse these lines. Do not print secrets.

## Execution success versus a negative domain result

A tool can execute correctly and still discover an undesirable business condition. Keep those two meanings separate.

Examples:

- a database comparison completed, but `databasesMatch` is `false`;
- a health check completed, but `allOnline` is `false`;
- a repository inspection completed, but `readyForDevelopmentPromotion` is `false`.

For these cases, return a valid successful ToolResult and expose a deliberate boolean or status field for the next workflow condition. Do not automatically fail the process unless stopping the workflow before a condition node is truly intended.

```js
shouldFailProcess: () => false;
```

Use a genuine execution failure only when the tool could not complete its domain operation, such as invalid parameters, authentication failure, an unavailable required database, or a catalogue query error.

## Failure output must satisfy the same schema

When an output schema is configured, SkyCommand validates `ToolResult.output` for both success and failure results. Design the schema and `createFailureToolResult()` together. A safe pattern is to return the same top-level fields with a status such as `FAILED`, zero counts, empty arrays, and no secrets.

Prefer `if (require.main === module)` around the CLI launch and export pure parsing/comparison helpers. That makes focused self-tests possible without executing the command-line entrypoint.

## Database-tool guidance

For PostgreSQL tools:

- accept database names as validated identifiers rather than arbitrary connection strings;
- use configured `PGHOST`, `PGPORT`, `PGUSER`, and `PGPASSWORD` values without logging the password;
- create a separate `pg.Pool` or client per target database;
- apply connection and statement timeouts;
- close every pool in `finally` blocks;
- return object names, counts, statuses, and safe fingerprints rather than full definitions when definitions could contain sensitive function bodies;
- distinguish connection/query failure from a completed comparison that found differences;
- cap very large detail arrays and expose an explicit truncation flag while preserving the true total count.

## Domain failure

Throw an `Error` with a stable code:

```js
const error = new Error('The repository path does not exist.');
error.code = 'REPOSITORY_PATH_INVALID';
throw error;
```

The failure ToolResult should contain safe details only. The process exits non-zero for genuine domain failure.

## Optional output schema

Recommended filename:

```text
<outputType>.schema.json
```

Example:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "example_greeting_summary.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "greeting", "generatedAt"],
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "greeting": { "type": "string", "minLength": 1 },
    "generatedAt": { "type": "string", "format": "date-time" }
  }
}
```

The schema validates `ToolResult.output`, not the whole envelope.

Use local references only. Do not use remote `$ref` URLs. Keep schemas bounded and straightforward.

## Onboarding descriptor

The optional `skycommand.tool.json` helps SkyCommand prefill the registration form. It is not runtime authority and it is not a repository-wide registry file.

### Descriptor lifecycle

1. The developer or AI creates one descriptor for the new tool package.
2. Add Tool reads it as advisory onboarding input and cross-checks it against the source and schema.
3. The administrator reviews and may change every suggested catalogue value.
4. Registration generates a fresh canonical `skycommand.tool.json` from the approved configuration and writes it beside that tool.
5. Later execution reads PostgreSQL catalogue configuration, not the descriptor or its file hash.

A future tool addition therefore creates another descriptor in another package directory. It does not modify the template descriptor or any previously registered tool descriptor. The authoring guide and `_template` package are sufficient prompt inputs; a previous tool's descriptor is optional as a domain-specific example, not required to prevent overwrites.

Required conventions:

- `descriptorVersion`: `1.0`;
- `toolCode`: lowercase letters, numbers, and underscores;
- `runtimeCode`: `node` for the first release;
- `entrypoint`: preferably the canonical package filename `tool.js`; Add Tool also accepts the actual uploaded `.js` filename and normalizes it to `tool.js` during managed registration;
- parameter positions begin at `1` and are unique;
- `resultContract.outputType` matches the tool code constant;
- `resultContract.schemaPath` is package-relative when supplied.

## Dependencies

Prefer Node.js built-ins and packages already present in the SkyCommand repository.

Phase 15 does not automatically run `npm install`. Declare additional dependency needs in the tool README and expect onboarding validation to report them as unavailable until an administrator installs and reviews them separately.

## Side effects and risk

Choose the lowest truthful risk:

- `low`: read/check/report operations;
- `medium`: controlled writes, ingestion, commits, or state changes;
- `high`: destructive rebuilds, branch synchronization, privileged provisioning, or broad mutation.

Mutating tools should use confirmation text and offer a dry-run mode where practical.

## File safety

- Never construct arbitrary destinations directly from browser input.
- Use repository-relative paths and `path.resolve` containment checks.
- Reject `..` traversal and null bytes.
- Avoid following symlinks outside approved roots.
- Write artifacts atomically when partial output would be dangerous.

## Testing checklist

Before onboarding:

```text
[ ] node --check tool.js passes
[ ] direct CLI success case passes
[ ] direct CLI failure case exits non-zero for genuine execution failure
[ ] negative domain outcomes expose condition-friendly fields instead of accidental process failure
[ ] console output is useful and contains no secrets
[ ] success ToolResult is JSON-safe
[ ] failure ToolResult is JSON-safe and satisfies the same output schema
[ ] output type is stable and versioned
[ ] optional schema validates a sample output
[ ] parameters are documented in positional order
[ ] descriptor agrees with implementation
[ ] no automatic dependency installation is required
[ ] side effects and risk level are accurately described
```

## AI generation rule

An AI-generated tool is a draft until a human reviews its domain behavior, permissions, risk, paths, dependencies, and side effects. Passing syntax and schema validation does not prove that arbitrary code is safe.
