# SkyCommand Data Domain Onboarding and Operations Guide

## Purpose

This guide describes how to add and operate a new data domain after Phase 16. It applies to macroeconomic, program-evaluation, client-services, operational, finance, employment, health, and future data packages.

The platform boundary is intentionally simple:

> PostgreSQL identifies domains, sources, assets, metrics, ingestion capabilities, quality rules, and evidence. Adapter modules provide source implementation. Generic services expose operational and consumer contracts.

A new domain must not require a new ingestion-status engine, a new ledger schema, a new recovery implementation, or a source-name branch in the Admin-Web application.

---

## 1. Onboarding sequence

### 1.1 Register the domain

Create one `data.domains` row with:

- stable uppercase `domain_code`;
- business-facing name and description;
- optional physical schema name;
- `data_domain.v1` contract version;
- non-secret configuration only.

A domain is a replaceable business/data package. It is not a source and it is not a dashboard.

### 1.2 Register sources

Create one `data.sources` row per provider or input channel.

Describe:

- provider type such as `HTTP_API`, `FILE`, or `DATABASE`;
- provider name;
- observability eligibility;
- aliases and provider metadata;
- non-secret configuration.

Credentials, API keys, and passwords remain in environment variables or approved secret storage.

### 1.3 Register assets and source bindings

Create `data.assets` rows for stored or measured entities, then bind them to providers through `data.asset_source_bindings`.

For time-series assets, configure:

- frequency, unit, geography, and transform;
- revision expectation;
- release lag and freshness tolerance where asset-specific;
- storage schema, relation, date column, and value column;
- provider asset/resource identifiers.

Source, asset, metric, and visualization remain separate concepts.

### 1.4 Register metrics

Create `data.metrics` and ordered `data.metric_dependencies` rows.

Phase 16 consumer support is deliberately bounded to:

- `IDENTITY` for a direct one-asset metric;
- `PCT_CHANGE` with explicit periods and multiplier.

A general expression language is outside the Phase 16 contract. New operators should be added deliberately with validation, tests, and a versioned consumer contract.

### 1.5 Register the ingestion tool and profile

The tool must belong to a category with:

```text
category_kind_code = INGESTION
```

Create one active `data.ingestion_tool_profiles` row defining:

- domain and source;
- adapter code;
- result contract;
- incremental, selected-asset, backfill, revision, resume, and dry-run capabilities;
- non-secret adapter configuration.

SkyCommand discovers ingestion behaviour from this metadata—not from filenames, paths, tool-code prefixes, or category labels.

### 1.6 Add the adapter module

Place one `*Adapter.js` module in the approved adapter directory. It must satisfy `source_adapter.v1` and implement:

```text
getAssets
fetch
normalize (optional)
load
```

The adapter owns provider-specific behavior. The shared runner owns batching, concurrency, temporary storage, result normalization, and item execution.

Run:

```text
npm run phase16:adapter-registry:self-test
npm run phase16:adapter-onboarding:verify
```

---

## 2. Request, retry, and rate-limit policy

HTTP sources require an active `data.source_request_policies` row.

Configure:

- request timeout;
- maximum attempts;
- base and maximum delay;
- maximum elapsed retry budget;
- jitter ratio;
- `Retry-After` behavior;
- retryable HTTP statuses;
- retryable transport error codes.

Authentication and authorization failures should remain terminal. Avoid retrying invalid credentials or permanent source-contract failures.

Provider limits belong in source policy and adapter metadata rather than scattered sleeps in source scripts.

---

## 3. Quality policy

Policy precedence is:

```text
Asset policy
  ↓
Source policy
  ↓
Check default
```

Use `data.source_quality_policies` for provider-wide behavior and `data.asset_quality_policies` for exceptions.

Supported checks include:

- empty response and no valid rows;
- invalid date or numeric value;
- duplicate key;
- source-date regression;
- unexpected gap;
- row-count anomaly;
- frequency and unit incompatibility;
- transformation failure.

Blocking findings must prevent inserts, updates, and revision writes while preserving diagnostic evidence.

Validate policy resolution through:

```text
GET /api/ingestion/catalogue/admin/quality/resolved/:domainCode/:assetCode
```

---

## 4. Execution and scheduling

Use the registered ingestion tool for every lane:

- Run Tools;
- API execution;
- CLI;
- worker schedules;
- SkyCommand workflows;
- Temporal-backed workflows.

Do not create separate workflow-only ingestion scripts.

Recommended scheduling practice:

1. align cadence with provider publication timing;
2. include a realistic release lag and tolerance;
3. select only required assets for high-frequency runs;
4. keep concurrency within provider policy;
5. use workflow summaries for multi-source refreshes;
6. retain confirmation for medium/high-risk interactive writes;
7. avoid broad outer-workflow retries after item-level retry and failed-only recovery are available.

---

## 5. Evidence and recovery

Every production execution should produce:

```text
ingestion_run_summary.v1
```

Durable evidence is stored in:

```text
data.ingestion_runs
data.ingestion_run_items
data.ingestion_revision_events
data.ingestion_quality_events
data.ingestion_rejection_events
```

A partial or failed run may create a durable recovery request. Failed-only recovery must:

- reconstruct final item outcomes from PostgreSQL;
- select only eligible failed assets;
- preserve original-run ancestry;
- execute through the same registered tool/adapter contract;
- create a child ledger run;
- remain reconstructable after process restart.

Operational review is available in **Data → Ingestion Operations**.

---

## 6. Consumer contracts

Generic consumers should prefer:

```text
GET /api/ingestion/catalogue/sources
GET /api/ingestion/catalogue/assets/:domainCode/:assetCode/observations
GET /api/ingestion/catalogue/metrics/:domainCode/:metricCode
GET /api/ingestion/catalogue/metrics/:domainCode/:metricCode/observations
GET /api/ingestion/runs
GET /api/ingestion/recoveries
GET /api/ingestion/quality/events
GET /api/ingestion/quality/revisions
GET /api/ingestion/quality/rejections
```

The principal contracts are:

```text
data_catalogue.v1
time_series_observations.v1
metric_observations.v1
ingestion_run_summary.v1
ingestion_recovery.v1
ingestion_quality_evidence.v1
asset_freshness.v1
```

Legacy macro routes remain compatibility surfaces, not templates for new domains.

---

## 7. Retention and backup

Phase 16 establishes evidence structures but does not impose one universal retention period. Production policy should classify:

- raw downloaded files;
- normalized staging files;
- observation tables;
- run/item ledger records;
- quality, rejection, and revision events;
- workflow and tool execution logs;
- audit events.

Recommended baseline:

- temporary download/staging files: delete after successful or terminal execution;
- observation data: retain according to business and provider history requirements;
- revision events: retain with the corresponding observation history;
- run/item and recovery evidence: retain long enough for operational, audit, and incident review;
- rejected-row payloads: apply privacy and sensitivity controls before long-term retention;
- proof fixtures: remove after acceptance unless explicitly retained as audit evidence.

Database backup must cover `data`, `core`, `auth`, `worker`, and domain storage schemas together so catalogue identity, execution lineage, and observations remain consistent after restore.

Test restore procedures—not merely backup creation.

---

## 8. Production topology

A complete production deployment may include:

```text
Admin-Web
API server
PostgreSQL
Node worker
Temporal server
Temporal worker
Provider endpoints / file channels
Backup and monitoring services
```

Operational requirements:

- stable clocks and time zones;
- secure secret injection;
- network egress rules for approved providers;
- PostgreSQL connection and statement limits;
- bounded worker concurrency;
- health checks for API, database, workers, and Temporal;
- alerting on repeated failures, source lag, load-behind-source, quality failure, and recovery failure;
- evidence-aware dashboards using generic contracts.

---

## 9. Acceptance checklist for a new domain

A domain is ready when:

- domain, source, assets, and metrics are discoverable;
- one `INGESTION` tool resolves to one active profile and one runtime adapter;
- selected-asset execution works;
- request policy is present when required;
- quality policies resolve with expected precedence;
- execution produces durable run/item evidence;
- freshness resolves from storage and ledger evidence;
- failed-only recovery selects only failed assets;
- asset and metric observation contracts return data;
- Ingestion Operations displays the run and recovery lineage;
- no core source list or macro-specific branch was added.

The automated final reference is:

```text
npm run phase16:portability-closure:self-test
npm run phase16:portability-closure:proof
```
