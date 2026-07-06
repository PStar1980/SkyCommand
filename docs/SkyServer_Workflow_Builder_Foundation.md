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


## Phase 10.13 — Scheduler-to-SkyServer Workflow Bridge

Phase 10.13 connects the existing worker Scheduler to SkyServer workflow definitions. The new worker-visible tool `skyserver_workflow_start` is a scheduler bridge, not a normal script. When a schedule fires, the worker starts an approved SkyServer workflow definition through the Temporal-backed executor.

```text
worker.schedule -> skyserver_workflow_start
  -> workflowExecutorService.startWorkflowWithTemporal
  -> skyserverWorkflowExecutorWorkflow
  -> TOOL / TEMPORAL_WORKFLOW node activities
  -> worker.workflow_run_records + worker.workflow_node_run_records
```

This is distinct from `temporal_workflow_start`:

| Bridge tool | Starts | Best use |
| --- | --- | --- |
| `temporal_workflow_start` | Approved Temporal workflow template | Low-level Temporal-native subprocesses |
| `skyserver_workflow_start` | Approved SkyServer workflow definition | Business-level composed workflows |

The first seeded target is `macro-refresh-pipeline`, which composes the upgraded FRED ingestion tool primitive and SkyWeb alert evaluation tool.

## Phase 10.14 — Create Workflow UI v1

Phase 10.14 introduces the first Admin-Web creation surface for SkyServer workflow definitions.

```text
Workflows -> Create Workflow
```

The v1 builder is deliberately constrained:

- sequential execution only;
- `TOOL` nodes only;
- no branching, drag-and-drop graph editor, approval gates, waits, API calls, agent nodes, child workflows, or Temporal template nodes yet;
- one created workflow definition receives one version 1 graph;
- version 1 can be published immediately so it appears in `Workflows -> Start Workflow`.

### API additions

```text
GET  /api/workflows/builder/catalog
POST /api/workflows/definitions
```

The catalog endpoint returns the workflow node type palette plus permission-filtered Admin-Web tool targets. The create endpoint writes:

```text
worker.workflow_definitions
worker.workflow_versions
worker.workflow_nodes
worker.workflow_edges
```

Builder v1 assigns:

```text
start_permission_code = WORKFLOW_START
cancel_permission_code = WORKFLOW_CANCEL
```

Creation requires:

```text
WORKFLOW_WRITE
```

### Builder v1 payload shape

```json
{
  "workflowCode": "my-macro-pipeline",
  "displayName": "My Macro Pipeline",
  "description": "Sequential tool workflow created from Admin-Web.",
  "publish": true,
  "nodes": [
    {
      "nodeKey": "fred_ingestion",
      "nodeTypeCode": "TOOL",
      "displayName": "Run FRED ingestion",
      "targetCode": "ingestion_fred",
      "inputParameters": {
        "concurrency": "10"
      }
    }
  ]
}
```

This keeps the long-term hierarchy intact:

```text
core.tools = primitives
worker.workflow_definitions = business workflow blueprints
skyserverWorkflowExecutorWorkflow = Temporal-backed runtime interpreter
```

## Phase 10.15 — Workflow lifecycle management

Phase 10.15 adds the first management surface for workflow definitions. It does not expand the runtime node palette; instead, it makes the existing workflow-builder foundation maintainable.

Supported lifecycle actions:

- edit workflow metadata and visibility;
- enable/disable definitions;
- archive old definitions while preserving run history;
- clone a workflow into a new definition;
- inspect version history;
- create and optionally publish a new sequential TOOL-node version.

A published vNext version retires previously published versions for that definition. Workflow runs keep their original `workflow_version_id`, so historical runs remain tied to the version that executed.

---

## Phase 10.16 — Parameterized TOOL nodes

Phase 10.16 removes raw runtime JSON from the Start Workflow page and moves parameter ownership into the workflow definition/version lifecycle.

### Admin-Web behavior

- `Workflows -> Create Workflow` renders TOOL-node parameter fields from `core.tool_parameters` metadata.
- `Workflows -> Manage Workflows` uses the same parameter controls when creating vNext versions.
- `Workflows -> Start Workflow` starts the selected published workflow with its stored node defaults instead of asking for raw `nodeInputs` JSON.
- Runtime node inputs are still stored as JSONB in `worker.workflow_nodes.input_parameters`, but the operator edits them through manifest-driven form controls.

This matches the Tools page pattern and keeps the hierarchy clean:

```text
core.tool_parameters
  -> Tools page parameter entry
  -> Workflow node parameter entry
  -> worker.workflow_nodes.input_parameters
  -> Temporal-backed SkyServer workflow executor
```

### Ingestion primitive upgrades

BoC and StatCan ingestion now match the FRED primitive pattern:

```powershell
node packages/ingestion/src/loadBoCMacroData.js --indicators=V39079,V39052 --concurrency=2
node packages/ingestion/src/loadStatCanMacroData.js --indicators=CAD_CPI_ALL_ITEMS,CAD_UNEMPLOYMENT_RATE --concurrency=2
```

The existing database upgrade seed is:

```powershell
psql -h localhost -U postgres -d skyserver_dev -f packages/db_build/src/seeds/00044__boc_statcan_ingestion_tool_upgrade_seed.sql
```

---

## Phase 10.17 — Simplified workflow lifecycle

Phase 10.17 keeps the existing internal graph tables but simplifies the Admin experience:

```text
Workflow definition
  -> status: ACTIVE / INACTIVE
  -> one current graph from the user perspective
  -> Start Workflow uses configured node defaults
```

User-facing changes:

- Start Workflow uses an active workflow dropdown.
- Runtime input JSON is removed from the Start Workflow page.
- Manage Workflows exposes ACTIVE / INACTIVE status only.
- Inactive workflows are hidden from Start Workflow and are blocked from execution.
- Manage Workflows can delete workflow definitions when they have no queued/running executions.
- Graph editing saves the current sequential TOOL-node graph instead of exposing version-publishing controls.

The internal `worker.workflow_versions` table remains an implementation detail for current graph storage and historical compatibility.

---

## Phase 10.18 — Scheduler target split

Phase 10.18 keeps the existing `skyserver_workflow_start` scheduler bridge but makes the Admin-Web Scheduler easier to operate. The schedule form now separates the conceptual target type from the selected object:

```text
Schedule Type: Tool
  -> Target: worker-visible core.tools entry

Schedule Type: Workflow
  -> Target: active SkyServer workflow definition
```

Workflow schedules still execute through the same durable path:

```text
Scheduler -> skyserver_workflow_start -> Temporal-backed SkyServer workflow executor
```

The bridge tool remains an implementation detail. Operators choose active workflows directly, while tool schedules continue to use manifest-driven parameter controls from `core.tool_parameters`.


---

## Phase 10.19 — API_CALL node support v1

Phase 10.19 adds the second supported business-node type to the SkyServer workflow model.

Supported node types now include:

| Node type | Behavior |
| --- | --- |
| `TOOL` | Runs an existing `core.tools` primitive through SkyServer's permission-aware tool execution service. |
| `API_CALL` | Calls a configured HTTP/HTTPS endpoint through the Temporal-backed workflow executor activity path. |

API nodes store their configuration in `worker.workflow_nodes.input_parameters`:

```json
{
  "method": "GET",
  "url": "http://localhost:7171/api/temporal/health",
  "headersJson": "{}",
  "bodyJson": "",
  "successCodes": "200,201,202,204",
  "timeoutMs": "30000",
  "maxResponseBytes": "32768"
}
```

At runtime, the generic `skyserverWorkflowExecutorWorkflow` executes API nodes as Temporal activities. The node output records HTTP method, URL, status code, duration, response preview, response size, and success/failure state. This keeps API calls inside the same SkyServer workflow run ledger and Temporal diagnostics path as tool nodes.

The v1 API node is intentionally basic. Future phases should add connection profiles, environment-backed secrets, allow/deny lists, and reusable approved API targets before broad external use.

## Phase 10.20 — Child workflow composition

Phase 10.20 adds `WORKFLOW` nodes to the supported builder palette. This turns SkyServer workflow definitions into reusable business blocks instead of forcing every automation to remain one flat graph.

```text
Workflow A
  Node 1: TOOL
  Node 2: WORKFLOW -> Workflow B
  Node 3: API_CALL
```

At runtime, the parent workflow is executed by `skyserverWorkflowExecutorWorkflow`. When the executor reaches a `WORKFLOW` node, it creates a child SkyServer workflow run record and starts a Temporal child execution of the same generic executor for the child definition. The parent waits for the child to finish, then records the child run and Temporal workflow identifiers on the parent node output.

Safety rules:

- child targets must be active, enabled, visible SkyServer workflows;
- direct self-recursion is blocked in the UI/API;
- recursive child workflow cycles are blocked during graph save;
- runtime cycle checks protect against stale or externally modified graphs.

## Phase 10.21 — Nested run history navigation

Phase 10.21 makes nested workflow execution understandable from SkyServer Admin. Parent and child workflow runs remain separate ledger records, but Workflow History now connects them into a navigable family tree.

The run detail API derives relationships from the existing run input and metadata fields:

```text
parentWorkflowRunRecordId
parentWorkflowCode
parentNodeKey
triggerType = CHILD_WORKFLOW
runSource = child_workflow
```

Admin-Web now shows parent links, child badges, child workflow run links from WORKFLOW node output, and a Run Tree panel. This avoids hiding orchestration structure inside raw JSON and gives operators a clear view of how nested SkyServer workflows unfolded.


## Phase 10.22 — Temporal workflow template nodes

Phase 10.22 adds `TEMPORAL_WORKFLOW` nodes as the advanced bridge from SkyServer-native business workflows into approved Temporal-native subprocesses. This differs from `WORKFLOW` nodes:

| Node type | Purpose | Runtime behavior |
| --- | --- | --- |
| `WORKFLOW` | Compose another SkyServer business workflow | Starts another `skyserverWorkflowExecutorWorkflow` child execution. |
| `TEMPORAL_WORKFLOW` | Call an approved Temporal-native template | Starts the selected Temporal workflow type directly as a Temporal child execution. |

The builder/manager surfaces obtain template targets from `worker.temporal_workflow_definitions`. Parameter forms are rendered from the template parameter metadata, and the executor records child Temporal workflow ID, run ID, task queue, result summary, and result preview on the node output.

This keeps SkyServer workflows as the user-facing business graph while still allowing specialized Temporal-native orchestration to be injected where it makes architectural sense.
