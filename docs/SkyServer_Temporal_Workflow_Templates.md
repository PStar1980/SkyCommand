# SkyServer Temporal Workflow Templates

Phase 10.5 moves approved Temporal workflow metadata out of API-only constants and into PostgreSQL.

The goal is controlled configurability: Admin-Web can render and start approved workflow templates, but the browser still cannot execute arbitrary Temporal code.

## Database objects

New migration:

```text
packages/db_build/src/migrations/00033__temporal_workflow_templates.sql
```

New seed:

```text
packages/db_build/src/seeds/00034__temporal_workflow_template_seed.sql
```

Created objects:

| Object | Purpose |
| --- | --- |
| `worker.temporal_workflow_definitions` | Approved workflow templates that SkyServer Core/API may expose |
| `worker.temporal_workflow_parameters` | Parameter schema for each approved template |
| `worker.vw_temporal_workflow_definitions` | API-friendly definition view with parameter JSON aggregated |

## Seeded template

Phase 10.5 seeds the first approved workflow template:

```text
workflow_code: fred-ingestion
workflow_type: fredIngestionWorkflow
display_name: FRED Macro Ingestion
default_concurrency: 3
max_concurrency: 10
```

Seeded parameters:

| Parameter | Type | Admin form | Notes |
| --- | --- | --- | --- |
| `indicators` | `STRING_ARRAY` | Yes | Blank means full configured FRED indicator set |
| `concurrency` | `INTEGER` | Yes | Min 1, max 10 |
| `workflowId` | `STRING` | Yes | Optional override |
| `timeoutMs` | `INTEGER` | No | Reserved advanced setting |
| `runSource` | `STRING` | No | Used for attribution/audit context |

## API behavior

`GET /api/temporal/workflow-definitions` now reads from:

```text
worker.vw_temporal_workflow_definitions
```

If the template tables are not installed yet, the API falls back to the original in-code FRED definition so local development does not hard-crash during patch application.

New generic start endpoint:

```text
POST /api/temporal/workflow-definitions/:workflowCode/start
```

For Phase 10.5, `fred-ingestion` is the only template with a start adapter. Other templates can be stored later, but they will return `501` until a matching server-side adapter exists.

The legacy pilot endpoint remains available:

```text
POST /api/temporal/workflows/fred-ingestion/start
```

## Admin-Web behavior

The Temporal Workflow Console now uses database-backed template metadata for:

- selected approved template;
- template summary;
- task queue display;
- visible parameter schema chips;
- default concurrency;
- form placeholders and help text;
- generic template-based workflow start calls.

The current visible form still targets the FRED workflow because that is the only workflow adapter implemented so far.

## Safety model

This phase intentionally does **not** let Admin-Web create arbitrary Temporal workflows.

Safe path:

```text
Admin-Web
  -> selected approved workflow_code
  -> SkyServer Core/API validates/normalizes parameters
  -> API calls a known start adapter
  -> Temporal starts a known workflow_type on a known task queue
```

Unsafe path intentionally avoided:

```text
Browser
  -> arbitrary workflow type / arbitrary code / arbitrary task queue
```

## Local application on an existing database

After applying the patch, run:

```powershell
psql -h localhost -U postgres -d skyserver_dev -f packages/db_build/src/migrations/00033__temporal_workflow_templates.sql
psql -h localhost -U postgres -d skyserver_dev -f packages/db_build/src/seeds/00034__temporal_workflow_template_seed.sql
```

Then restart:

```powershell
npm run api
npm run web
```

The console should continue working at:

```text
http://localhost:5171/automation/temporal
```

## Future expansion

The next workflow templates can be added with metadata first, then adapters later:

- Bank of Canada ingestion;
- Statistics Canada ingestion;
- SkyWeb alert evaluation;
- macro signal refresh;
- repo map/zip tooling;
- AI/data/reporting workflows.

The future Postgres run-history/audit layer should be added separately so template configuration and execution history stay cleanly separated.
