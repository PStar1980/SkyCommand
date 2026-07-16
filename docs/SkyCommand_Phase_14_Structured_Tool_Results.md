# SkyCommand Phase 14 — Structured Tool Results

## Status

Phase 14 is in progress. Phase 14.1 establishes the shared runtime foundation described in the Phase 14 architecture decision:

> Printing is for humans. Structured return values are for workflows.

The first increment preserves every existing execution mode while separating human operational logs from machine-consumable workflow results.

## Phase 14.1 foundation

The API launcher and worker launcher now call the same generic child-process adapter under `packages/tools/src/toolProcessExecutor.js`.

For each execution the adapter:

1. Creates a unique result path inside the wrapper-owned `logs/tool-results` directory.
2. Passes the result contract to the child process through environment variables.
3. Captures and truncates stdout/stderr using the existing execution limits.
4. Reads the optional or required structured result after the process closes.
5. Validates schema version, output type, JSON safety, and maximum size.
6. Cleans up result and temporary files.
7. Returns logs and structured data through separate fields.

### Child-process environment

```text
SKYCOMMAND_TOOL_RESULT_PATH=<absolute wrapper-owned path>
SKYCOMMAND_EXECUTION_ID=<execution identifier>
SKYCOMMAND_TOOL_CODE=<registered tool code>
SKYCOMMAND_TOOL_RESULT_REQUIRED=true|false
SKYCOMMAND_TOOL_RESULT_MAX_BYTES=<maximum JSON bytes>
```

A tool must never choose its own destination. It may use the shared writer:

```js
const { writeToolResult } = require('../../tools/src');

writeToolResult({
  schemaVersion: '1.0',
  success: true,
  message: 'Operation completed.',
  outputType: 'example_result.v1',
  output: {
    customValue: 42,
  },
  warnings: [],
  error: null,
  metadata: {},
});
```

When no wrapper result path is present, `writeToolResult()` performs no write. Direct CLI execution therefore remains unchanged.

## Canonical ToolResult envelope

```json
{
  "schemaVersion": "1.0",
  "success": true,
  "message": "Operation completed.",
  "outputType": "example_result.v1",
  "output": {},
  "warnings": [],
  "error": null,
  "metadata": {}
}
```

The envelope is universal. The `output` payload remains domain-specific and may contain bounded JSON-safe scalars, objects, and arrays.

## Workflow context paths

For a completed node with key `example_node`, Phase 14 establishes these paths:

```text
nodes.example_node.result       complete validated result envelope
nodes.example_node.output       domain-specific output payload
nodes.example_node.warnings     non-fatal warnings
nodes.example_node.error        structured error
nodes.example_node.metadata     safe metadata
last.result                     latest complete result
last.output                     latest domain output
```

Condition nodes can therefore evaluate custom paths such as:

```text
nodes.fred_ingestion.output.totals.rowsInserted
nodes.fred_ingestion.output.totals.indicatorsFailed
nodes.package_repo.output.archivePath
```

## Log separation

- Tool History remains authoritative for stdout, stderr, exit metadata, and diagnostics.
- Workflow node output never falls back to stdout parsing.
- Migrated tools return their declared structured result.
- Non-migrated tools return `legacy_tool_execution.v1`, including execution identity and a clear `structuredOutputAvailable: false` flag.

## Result requirements

Structured results are optional during migration. A tool can be made strict through validated catalogue/manifest metadata in later Phase 14 increments. The temporary configuration bridge is:

```text
SKYCOMMAND_TOOL_RESULT_REQUIRED_CODES=ingestion_fred,ingestion_boc,ingestion_statcan
```

When a required tool exits without a valid result, the execution fails with a contract error instead of silently substituting console output.

## Runtime configuration

```text
SKYCOMMAND_TOOL_RESULT_MAX_BYTES=1048576
SKYCOMMAND_TOOL_RESULT_REQUIRED_CODES=
```

Large files and datasets must be referenced as artifacts rather than embedded in `ToolResult`.

## Verification

```bash
npm run tool-result:self-test
npm run validate
```

The self-test verifies contract validation, optional and required result behavior, atomic write/read/cleanup, child-process environment injection, log preservation, and structured-result capture.

## Remaining Phase 14 increments

1. Return database load statistics from ingestion helpers while preserving current console output.
2. Aggregate FRED, BoC, and StatCan into `macro_ingestion_summary.v1`.
3. Add thin shared CLI adapters that emit results without duplicating domain scripts.
4. Add strict manifest/output-contract validation and `skycommand.tool.json` foundations.
5. Render purpose-built macro ingestion totals and indicator tables in Workflow History.
6. Verify direct CLI, Run Tools, scheduled, and workflow execution modes.
