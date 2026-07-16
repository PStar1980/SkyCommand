# SkyCommand Phase 14 — Structured Tool Results

## Status

Phase 14 is in progress.

> Printing is for humans. Structured return values are for workflows.

Phase 14.1 established the generic child-process result transport. Phase 14.2 proves the architecture with FRED by returning deliberate loader statistics, emitting `macro_ingestion_summary.v1`, and rendering those results as purpose-built tables in Workflow History while preserving the existing console transcript.

## Phase 14.1 foundation

The API launcher and worker launcher call the same generic child-process adapter under `packages/tools/src/toolProcessExecutor.js`.

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

## Phase 14.2 — FRED macro-ingestion proof case

The shared copy/load helper now returns structured statistics while printing the same operational lines used by CLI and Tool History.

```json
{
  "stagingRows": 1337,
  "stagingMinDate": "1913-01-01",
  "stagingMaxDate": "2026-06-01",
  "previousTargetMaxDate": "2026-04-01",
  "newRowsDetected": 2,
  "rowsInserted": 2,
  "currentTargetMaxDate": "2026-06-01"
}
```

FRED aggregates those values into one `macro_ingestion_summary.v1` result containing:

- source-level outcome and duration;
- requested, succeeded, failed, updated, and unchanged indicator totals;
- staged, newly detected, and inserted row totals;
- per-indicator outcome, date coverage, row counts, duration, and safe error details;
- execution metadata such as concurrency and batch count.

Outcome semantics are stable:

| Outcome | Meaning |
| --- | --- |
| `UPDATED` | Processing succeeded and inserted one or more rows. |
| `UNCHANGED` | Processing succeeded and found no new rows. |
| `FAILED` | The indicator failed during download, normalization, or load. |
| `PARTIAL` | The grouped run contains both successful and failed indicators. |

`UNCHANGED` is a successful result and must not be treated as an error by conditions or summaries.

### Workflow History rendering

For focused FRED nodes, Workflow History now renders:

1. A compact run-totals table.
2. An indicator-results table with outcome, inserted rows, new rows, staging rows, date coverage, duration, and failure message.

Verbose stdout/stderr is not displayed as workflow output. It remains available in Tool History.

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
nodes.fred_ingestion.output.indicators
nodes.package_repo.output.archivePath
```

## Log separation

- Tool History remains authoritative for stdout, stderr, exit metadata, and diagnostics.
- Workflow node output never falls back to stdout parsing.
- Migrated tools return their declared structured result.
- Non-migrated tools return `legacy_tool_execution.v1`, including execution identity and a clear `structuredOutputAvailable: false` flag.

## Result requirements

Structured results are optional during migration. A migrated tool can be made strict through the temporary configuration bridge:

```text
SKYCOMMAND_TOOL_RESULT_REQUIRED_CODES=ingestion_fred
```

When a required tool exits without a valid result, the execution fails with a contract error instead of silently substituting console output. Add `ingestion_boc` and `ingestion_statcan` after their Phase 14 migrations are enabled.

## Runtime configuration

```text
SKYCOMMAND_TOOL_RESULT_MAX_BYTES=1048576
SKYCOMMAND_TOOL_RESULT_REQUIRED_CODES=ingestion_fred
```

Large files and datasets must be referenced as artifacts rather than embedded in `ToolResult`.

## Verification

```bash
npm run tool-result:self-test
npm run macro-ingestion:self-test
npm run validate
```

The macro-ingestion self-test verifies copy-loader metric parsing, aggregate totals, updated/unchanged/failed outcome semantics, partial-run handling, duration calculation, and the absence of stdout fields in the structured result.

## Remaining Phase 14 increments

1. Migrate Bank of Canada and Statistics Canada to `macro_ingestion_summary.v1` using the same loader and aggregation contract.
2. Consolidate the source CLI entrypoints behind the shared adapter without duplicating domain implementations.
3. Add strict manifest/output-contract validation and `skycommand.tool.json` foundations.
4. Add contract-check/describe mode for future repository registration.
5. Verify direct CLI, Run Tools, scheduled, and workflow execution modes for all migrated sources.
