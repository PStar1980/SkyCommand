# SkyServer Workflow Builder Foundation

Phase 10.9 establishes the long-term hierarchy for SkyServer workflows:

```text
Tool / API / Agent / Child Workflow / Temporal Template
        ↓
Workflow Node
        ↓
Workflow Definition
        ↓
Workflow Version
        ↓
Workflow Run
        ↓
Node Runs
```

This separates **executable primitives** from **orchestration containers**:

- `core.tools` remain the main script/tool primitive catalog.
- `worker.workflow_definitions` represents user/config-defined SkyServer workflows.
- `worker.workflow_nodes` composes tools, APIs, agents, child workflows, waits, conditions, approvals, or Temporal templates.
- Temporal remains the durable execution engine, but not every primitive has to become its own user-facing workflow.

## New database objects

Migration:

```text
packages/db_build/src/migrations/00038__workflow_builder_foundation.sql
```

Seed:

```text
packages/db_build/src/seeds/00039__workflow_builder_foundation_seed.sql
```

Created tables:

| Object | Purpose |
| --- | --- |
| `worker.workflow_node_types` | Builder palette/node type registry |
| `worker.workflow_definitions` | User/config-defined workflow containers |
| `worker.workflow_versions` | Versioned graph snapshots |
| `worker.workflow_nodes` | Nodes inside a workflow version |
| `worker.workflow_edges` | Directed graph edges between nodes |
| `worker.workflow_run_records` | Future SkyServer workflow run ledger |
| `worker.workflow_node_run_records` | Future node-level run/timeline ledger |

Created views:

| Object | Purpose |
| --- | --- |
| `worker.vw_workflow_definitions` | Definition + latest/published graph summary |
| `worker.vw_workflow_nodes` | Node list joined to definition/version/type metadata |
| `worker.vw_workflow_run_records` | Run records joined to user/workflow metadata |

## Seeded node types

The seed registers the first workflow-builder palette:

| Node type | Meaning |
| --- | --- |
| `TOOL` | Runs an existing `core.tools` primitive |
| `API_CALL` | Calls an approved API endpoint |
| `AGENT` | Runs an approved agentic AI action |
| `WORKFLOW` | Starts another SkyServer workflow definition |
| `TEMPORAL_WORKFLOW` | Starts an approved Temporal workflow template |
| `CONDITION` | Branches based on an expression |
| `WAIT` | Waits for time/event |
| `HUMAN_APPROVAL` | Pauses for operator approval |
| `DATA_TRANSFORM` | Applies an approved transform step |

## Seeded example workflow

The seed also creates a metadata-only example:

```text
workflow_code: macro-refresh-pipeline
display_name: Macro Refresh Pipeline
version: 1 / PUBLISHED
```

Initial nodes:

```text
Run FRED ingestion tool
  ↓
Evaluate SkyWeb alerts
```

Both nodes are `TOOL` nodes, which is the important architectural point: the existing tool catalog remains first-class.

## Existing database application

Run these after applying the patch:

```powershell
psql -h localhost -U postgres -d skyserver_dev -f packages/db_build/src/migrations/00038__workflow_builder_foundation.sql
psql -h localhost -U postgres -d skyserver_dev -f packages/db_build/src/seeds/00039__workflow_builder_foundation_seed.sql
```

## Next intended slice

Phase 10.10 should add the API/service layer for reading workflow definitions and executing a simple sequential workflow version. The first executor should support only the safest node types:

```text
TOOL
TEMPORAL_WORKFLOW
```

The visual workflow designer should come after the metadata and executor are stable.

---

## Phase 10.10 — Workflow Executor v1

Phase 10.10 makes the Phase 10.9 metadata foundation runnable through the SkyServer API and Admin-Web.

The first executor is intentionally simple and safe:

```text
SkyServer workflow definition
  -> published workflow version
  -> enabled nodes ordered by display_order
  -> execute supported node adapters sequentially
  -> write workflow run + node run records
```

Supported node types in executor v1:

| Node type | Behavior |
| --- | --- |
| `TOOL` | Runs an existing `core.tools` primitive through the same permission-aware API tool execution service used by Admin-Web Tools. |
| `TEMPORAL_WORKFLOW` | Starts an approved Temporal workflow template through the existing Temporal service. v1 records the start result but does not wait for the child Temporal workflow to complete. |

Unsupported node types are deliberately rejected by executor v1. They remain in the palette for future builder support but are not silently skipped.

### New API surface

```text
GET  /api/workflows/definitions
GET  /api/workflows/definitions/:workflowCode
POST /api/workflows/definitions/:workflowCode/start
GET  /api/workflows/runs
GET  /api/workflows/runs/:workflowRunRecordId
```

### Admin-Web behavior

`Workflows -> Start Workflow` now targets SkyServer workflow definitions instead of only raw Temporal templates.

The seeded `macro-refresh-pipeline` definition can now run as:

```text
Run FRED ingestion tool
  -> Evaluate SkyWeb alerts tool
```

Node parameters can be overridden with input JSON:

```json
{
  "nodeInputs": {
    "fred_ingestion": {
      "indicators": "GDP, UNRATE, DGS10",
      "concurrency": "10"
    },
    "evaluate_skyweb_alerts": {
      "maxRules": "500",
      "activeOnly": "true"
    }
  }
}
```

The run ledger is stored in:

```text
worker.workflow_run_records
worker.workflow_node_run_records
```

This keeps a clean hierarchy:

```text
Tools remain primitives.
SkyServer workflows compose primitives.
Temporal templates remain one possible node type.
Scheduler/listeners can later trigger SkyServer workflows instead of only tools or Temporal templates.
```

---

## Phase 10.11 — Temporal-backed executor

Phase 10.11 keeps the same workflow-builder object model but changes the default runtime:

```text
Admin-Web
  -> SkyServer API
  -> Temporal skyserverWorkflowExecutorWorkflow
  -> Temporal activities
  -> existing tool execution service
  -> workflow/node run records
```

This means a SkyServer workflow is still a configurable graph of nodes, but Temporal now provides the durable execution shell around that graph.

### Runtime distinction

| Object | Purpose |
| --- | --- |
| `worker.workflow_definitions` | SkyServer/user-facing workflow container |
| `worker.workflow_nodes` | Composable nodes such as `TOOL` or `TEMPORAL_WORKFLOW` |
| `core.tools` | Existing executable primitives |
| `skyserverWorkflowExecutorWorkflow` | Generic Temporal runtime that interprets the SkyServer workflow graph |
| `worker.workflow_run_records` | SkyServer-friendly run ledger and Admin-Web history source |
| `worker.workflow_node_run_records` | Node timeline/outcome ledger |

### API behavior

`POST /api/workflows/definitions/:workflowCode/start` defaults to Temporal-backed execution and returns once the Temporal workflow has started. The run continues asynchronously and can be followed from Workflow History.

For local debugging only, the previous inline API executor can still be selected with `executorMode: "inline"`.

## Phase 10.12 Runtime Detail Notes

SkyServer workflow runs are now enriched with Temporal runtime diagnostics when they were started by the Temporal-backed executor.

The distinction remains important:

```text
SkyServer Workflow History
  = domain-aware run ledger, node results, user/source metadata, friendly diagnostics

Temporal UI
  = raw Temporal execution history, event timeline, worker/task-queue diagnostics
```

The run detail API returns `temporalRuntime` when a workflow run has Temporal identifiers. Admin-Web uses that payload to show status, task queue, history/event counts, activity counts, latest events, and a deep link into the local Temporal UI.

This keeps the product experience inside SkyServer while preserving direct Temporal inspection for low-level debugging.
