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
tool.js
skycommand.tool.json
<outputType>.schema.json
README.md
```

The package will eventually be stored at:

```text
packages/tools/custom/<toolCode>/
```

## Mandatory implementation rules

1. Use CommonJS and Node.js.
2. Import the shared adapter with:

```js
const { runToolCli } = require('../../src');
```

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
19. Make the script pass `node --check tool.js`.
20. Make the descriptor, script constants, parameter order, output type, and schema filename agree exactly.

## Descriptor rules

Use:

```json
{
  "descriptorVersion": "1.0",
  "toolCode": "lowercase_underscore_code",
  "label": "Human Label",
  "description": "Concise purpose.",
  "runtimeCode": "node",
  "entrypoint": "tool.js",
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
    "schemaPath": "stable_summary.v1.schema.json"
  },
  "visibility": ["cli", "admin-web", "api", "worker"]
}
```

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
- direct CLI test examples.

After the code blocks, provide a short review checklist identifying any assumptions that a SkyCommand administrator must confirm before registration.

---
