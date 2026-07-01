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
