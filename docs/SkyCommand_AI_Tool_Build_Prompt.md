# SkyCommand AI Tool Build Prompt

Copy this entire prompt into an AI coding assistant and replace the bracketed requirements.

---

Create a Node.js/CommonJS command-line tool package for SkyCommand.

## Business requirement

[Describe exactly what the tool must do.]

## Inputs

[List parameters in positional order. For each, provide name, type, required/optional, default, validation, and whether it is a repository selector.]

## Expected domain output

[List the deliberate fields that later workflow nodes and condition gates must consume.]

## Side effects and risk

[Describe files, database rows, network calls, Git operations, or other state that may change. State the correct risk level: low, medium, or high.]

## Required package files

Produce these files in separate code blocks:

```text
<descriptive-tool-name>.js
skycommand.tool.json
<outputType>.schema.json
README.md
```

The implementation package will be stored in an administrator-selected new directory inside the repository `packages` folder. The script will be promoted under that package's `src` folder, the descriptor will be used only for onboarding and then discarded, and the optional schema will be promoted to `packages/tools/contracts`.

Provide the intended destination here:

```text
[packages/<chosen-area>/<toolCode>]
```

The default remains `packages/tools/custom/<toolCode>`, but locations such as `packages/git/<toolCode>` or `packages/files/<toolCode>` are also valid.

## Mandatory implementation rules

1. Use CommonJS and Node.js.
2. Import the shared adapter from `packages/tools/src` using the correct relative path for the chosen package destination. For the default `packages/tools/custom/<toolCode>/src/<tool>.js` location, use:

```js
const { runToolCli } = require('../../../src');
```

For any other destination, calculate the import from the final script file to `packages/tools/src`. For example, `packages/db_compare/src/db_object_compare.js` uses `require('../../tools/src')`. Do not assume the default depth.

3. Accept parameters as positional command-line values in the exact order documented in the descriptor.
4. Validate all parameters inside the tool.
5. Keep normal human-readable progress and diagnostic output in `console.log` or `console.error`.
6. Never make workflows parse console output.
7. Return a versioned ToolResult envelope through `runToolCli`:

```json
{
  "schemaVersion": "1.0",
  "success": true,
  "message": "Concise result sentence.",
  "outputType": "<stable_output_type>.v1",
  "output": {},
  "warnings": [],
  "error": null,
  "metadata": {}
}
```

8. Put deliberate, JSON-safe business fields under `output`.
9. On genuine domain failure, throw an Error with a stable uppercase code and create a safe failure ToolResult.
10. Do not return functions, undefined values, BigInt, circular references, class instances, secrets, tokens, raw environment variables, or authorization headers.
11. Use ISO-8601 strings for dates.
12. Reference large files as artifacts rather than embedding them.
13. Use repository codes rather than unrestricted absolute paths when operating on configured repositories.
14. Use `path.resolve` containment checks for any repository-relative destination.
15. Do not add automatic dependency installation.
16. Prefer Node.js built-ins and dependencies already supplied by SkyCommand.
17. Include a clear console renderer.
18. Add comments only where they explain a safety boundary or non-obvious domain rule.
19. Make the script pass `node --check <descriptive-tool-name>.js` before upload and `node --check src/<descriptive-tool-name>.js` after promotion.
20. Make the descriptor, script constants, parameter order, output type, and schema filename agree exactly.
21. Wrap the CLI launch in `if (require.main === module)` and export pure parsing/domain helpers where practical so focused self-tests can import the file without executing it.
22. Ensure both success and failure `ToolResult.output` values satisfy the same optional output schema.
23. Distinguish execution failure from a completed negative business result. Expose condition-friendly fields such as `allOnline`, `databasesMatch`, or `ready` and use `shouldFailProcess` deliberately.
24. For database tools, create isolated clients/pools per target database, apply timeouts, close them in `finally`, never log credentials, and avoid returning full definitions that may contain secrets.

## Descriptor rules

Create a new temporary `skycommand.tool.json` for this tool upload only. Do not edit the reusable descriptor under `packages/tools/custom/_template/` and do not reuse a previous tool's package path. SkyCommand uses the descriptor to prefill registration, records its evidence, and discards it after successful registration. PostgreSQL becomes authoritative; no descriptor is installed beside the tool.

Use:

```json
{
  "descriptorVersion": "1.0",
  "toolCode": "lowercase_underscore_code",
  "label": "Human Label",
  "description": "Concise purpose.",
  "runtimeCode": "node",
  "entrypoint": "src/<descriptive-tool-name>.js",
  "packagePath": "packages/<chosen-area>/<toolCode>",
  "categoryCode": "appropriate_existing_category",
  "permissionCode": "appropriate_existing_permission",
  "riskCode": "low",
  "requiresConfirmation": false,
  "confirmationText": null,
  "capturesOutput": true,
  "allowParams": true,
  "parameters": [],
  "resultContract": {
    "outputType": "stable_summary.v1",
    "schemaPath": "packages/tools/contracts/stable_summary.v1.schema.json"
  },
  "visibility": ["cli", "admin-web", "api", "worker"]
}
```


Visibility guidance:

- include both `admin-web` and `api` for every tool intended to appear in workflow definitions;
- include `cli` when command-line launch should be available;
- include `worker` when worker-facing automation should discover the tool;
- using all four channels is the recommended broad-access default unless the tool is intentionally restricted.

SkyCommand validates workflow eligibility from the PostgreSQL catalogue. Descriptors and file hashes never become runtime visibility gates.

Parameter types supported in the first release are:

```text
string
number
boolean
repo
select
path
date
```

Each parameter must have a unique one-based `position`.

## Schema rules

The schema validates only `ToolResult.output`.

- Use JSON Schema draft-07 style.
- Use local references only.
- Prefer `additionalProperties: false`.
- Keep the shape bounded and readable.
- Match the schema filename to the output type.
- Use the central destination `packages/tools/contracts/<outputType>.schema.json` in the descriptor.
- Do not fetch remote schemas.

## README requirements

Document:

- purpose;
- positional CLI usage;
- every parameter;
- console behavior;
- output fields;
- failure codes;
- side effects;
- risk and confirmation expectations;
- dependency assumptions;
- direct CLI test examples;
- recommended workflow condition paths and whether a negative domain result exits non-zero;
- success and failure output-shape compatibility with the schema.

After the code blocks, provide a short review checklist identifying any assumptions that a SkyCommand administrator must confirm before registration.

---
