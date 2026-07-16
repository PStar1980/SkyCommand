# SkyCommand Phase 14 — Structured Tool Results

## Status

Phase 14 is in progress.

> Printing is for humans. Structured return values are for workflows.

Phase 14.1 established the generic child-process result transport. Phase 14.2 proved the architecture with FRED by returning deliberate loader statistics, emitting `macro_ingestion_summary.v1`, and rendering those results as purpose-built tables in Workflow History while preserving the existing console transcript. Phase 14.3 extends that same contract to Bank of Canada and Statistics Canada and routes all three macro-source entrypoints through one shared ingestion CLI adapter.

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


## Development watcher safety

The structured-result channel writes transient validated JSON payloads using the `.tool-result` filename extension under the wrapper-owned `logs/tool-results` directory. The non-source extension and shared `nodemon.json` ignore rules prevent development API, worker, and Temporal processes from restarting when a result is emitted. The wrapper removes both the completed result and any temporary sibling file after reading, so an empty result directory after a completed execution is expected.

## Semantic output-type persistence

Phase 14 stores one canonical ToolResult envelope per workflow tool node. The durable `worker.workflow_run_node_outputs.output_type` column accepts either a legacy structural JSON label (`object`, `array`, and similar) or a versioned semantic contract name such as `macro_ingestion_summary.v1`. The semantic value lets Workflow History and future condition/renderer services select the correct contract without parsing the payload.

Node execution retries are separated from completion-ledger retries. If a tool finishes successfully but durable output/context persistence fails, Temporal retries the idempotent completion activity; it does not rerun the side-effecting tool.

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

## Phase 14.2–14.3 — Normalized macro-ingestion results

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

FRED, Bank of Canada, and Statistics Canada aggregate those values into the same `macro_ingestion_summary.v1` result containing:

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

For focused FRED, BoC, and StatCan nodes, Workflow History renders:

1. A compact run-totals table.
2. An indicator-results table with outcome, inserted rows, new rows, staging rows, date coverage, duration, and failure message.

Verbose stdout/stderr is not displayed as workflow output. It remains available in Tool History.

## Phase 14.3 — Shared macro-ingestion CLI adapter

`packages/ingestion/src/core/macroIngestionCli.js` now owns the common source-entrypoint responsibilities:

- invoke the source-specific domain function;
- build the normalized macro-ingestion ToolResult;
- preserve each source's existing console summary;
- emit the result through the wrapper-owned transport when available;
- emit a structured fatal result when execution fails before a batch result exists;
- preserve `--allow-failures` exit behavior;
- keep workflow integration free of source-specific wrapper branches.

The source scripts remain thin adapters. FRED keeps its specialized batch runner, while BoC and StatCan keep the shared `runPipeline()` implementation. No source duplicates its ingestion logic for workflow use.

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
SKYCOMMAND_TOOL_RESULT_REQUIRED_CODES=ingestion_fred,ingestion_boc,ingestion_statcan
```

When a required tool exits without a valid result, the execution fails with a contract error instead of silently substituting console output. All three macro-source ingestion tools are now strict structured-result producers.

## Runtime configuration

```text
SKYCOMMAND_TOOL_RESULT_MAX_BYTES=1048576
SKYCOMMAND_TOOL_RESULT_REQUIRED_CODES=ingestion_fred,ingestion_boc,ingestion_statcan
```

Large files and datasets must be referenced as artifacts rather than embedded in `ToolResult`.

## Verification

```bash
npm run tool-result:self-test
npm run macro-ingestion:self-test
npm run macro-ingestion-cli:self-test
npm run validate
```

The macro-ingestion self-tests verify copy-loader metric parsing, aggregate totals, updated/unchanged/failed outcome semantics, partial-run handling, duration calculation, source-neutral CLI adaptation for FRED/BoC/StatCan, fatal-result emission, allow-failures behavior, and the absence of stdout fields in the structured result.

## Remaining Phase 14 increments

1. Add strict manifest/output-contract validation and `skycommand.tool.json` foundations.
2. Add contract-check/describe mode for future repository registration.
3. Verify scheduled execution mode for all migrated macro sources and add explicit condition/summary proof cases.
4. Expand structured results to additional tool categories using the generic adapter and renderer fallback.
