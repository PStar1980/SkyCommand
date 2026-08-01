# SkyCommand Phase 16 — Portable Ingestion and Data Contract Foundation

## Document control

- **Status:** Approved roadmap for implementation
- **Revision:** 17
- **Date:** 2026-08-01
- **Product:** SkyCommand
- **Phase:** 16
- **Primary objective:** Harden ingestion while making sources, datasets, and KPIs replaceable without rewriting the SkyCommand platform.
- **Implementation progress:** Phase 16.0 complete; Phase 16.1 complete and portability-proven; Phase 16.2 complete with portable assets, metrics, managed catalogue administration, and a locally proven second-domain record-set/KPI fixture; Phase 16.3 complete with explainable freshness and snapshot-backed Data Intelligence; Phase 16.4 complete with durable generic ingestion evidence, live production ledger integration, and proven workflow/Temporal linkage; Phase 16.5 complete with a common source-adapter runner, PostgreSQL-authoritative retry policies, durable retry-attempt evidence, automatic adapter discovery, and a locally proven new-source onboarding contract; Phase 16.6 complete with revision-aware loading, portable quality-policy precedence, managed policy/evidence APIs, and live FRED/BoC/StatCan production proof; Phase 16.7.1 durable recovery intent and failed-only portability proof are complete; Phase 16.7.2 production tool, CLI, API, and workflow recovery integration is the active checkpoint.

## Governing constraint

SkyCommand must remain a reusable automation and data-control platform rather than a macroeconomic application with a reusable shell.

The current macroeconomic implementation is the first production data domain, not the permanent identity of the ingestion framework. Future deployments must be able to replace or supplement macro data with different sources, datasets, dimensions, and KPIs with minimal core-code change.

All ingestion scripts belong to the **Ingestion Tools** tool category. This category is a reserved semantic category and must be recognized by SkyCommand as a special tool category through explicit catalogue metadata—not by label text, script filename, source name, or filesystem path.

> PostgreSQL identifies ingestion capabilities. Tool files provide implementation. Generic contracts provide evidence. Data-domain packages provide replaceable business meaning.

---

# 1. Executive summary

Phase 16 will transform the current working macro ingestion implementation into a portable ingestion platform with five separable layers:

1. **Tool identity and discovery** — SkyCommand knows which tools are ingestion tools because their category is typed as `INGESTION`.
2. **Source adapters** — FRED, Bank of Canada, Statistics Canada, manual files, and future sources implement one common adapter contract.
3. **Data-domain catalogue** — macroeconomics becomes one registered domain containing sources, series, metadata, dimensions, and metrics.
4. **Durable ingestion evidence** — every run and per-series attempt has relational history, recovery state, diagnostics, and revision evidence.
5. **Generic consumer contracts** — Data Status, APIs, workflows, dashboards, and future applications consume domain-neutral contracts rather than hard-coded macro source lists.

The current `macro` tables, views, APIs, and dashboards will remain compatible while the generic foundation is introduced beside them. Phase 16 will not require a disruptive rewrite of the 18 existing analytical views or the current 69 active macro series.

The portability proof for Phase 16 will be the ability to register and run a temporary non-macro source through the same Ingestion Tools category, ledger, status, recovery, and contract surfaces without changing core ingestion-status or dashboard code.

---

# 2. Current baseline

SkyCommand currently provides:

- 73 registered macro indicators, including 69 active indicators;
- active ingestion from FRED, Bank of Canada, and Statistics Canada;
- a manual ingestion tool;
- selected-indicator execution and source-level concurrency;
- tool, CLI, worker, workflow, and Temporal execution lanes;
- structured `macro_ingestion_summary.v1` output;
- per-indicator target tables and 18 curated macro views;
- Data Status and freshness reporting;
- public and authenticated macro APIs;
- reusable tool catalogue, permissions, workflow orchestration, history, and audit infrastructure.

The current implementation works, but several parts are macro- or source-specific:

- `ingestionStatusService` contains an in-code source registry;
- ingestion tools are inferred partly from known script filenames;
- current result contracts use macro-specific naming;
- freshness rules are global frequency heuristics;
- source metadata is split between PostgreSQL and JavaScript configuration;
- KPI and analytical-view definitions are not exposed through a generic catalogue;
- FRED uses a partially separate orchestration path;
- the loader is insert-only and does not capture source revisions;
- recovery is batch-oriented rather than failed-item resumable;
- ingestion history is inferred from general tool execution rather than a dedicated ingestion ledger.

Phase 16 addresses these limitations without breaking the working macro product.

---

# 3. Locked architectural decisions

## 3.1 Ingestion Tools is a semantic category

The existing category code may remain `data_ingestion_tools`, and its visible label may remain configurable. SkyCommand must not depend on either value to determine behaviour.

Add a category kind or role to the catalogue, initially supporting:

```text
GENERAL
INGESTION
```

Recommended model:

```text
core.tool_category_kinds
core.tool_categories.category_kind_code
```

The seeded Data Ingestion Tools category receives:

```text
category_kind_code = INGESTION
```

All ingestion-specific discovery must use the category kind. Core code must not identify ingestion tools by:

- tool code prefix;
- source name;
- script filename;
- script path;
- output type alone;
- category label text;
- a hard-coded list of current sources.

Future special category behaviours may add new category kinds without adding category-specific booleans to every table.

## 3.2 Ingestion tools require an ingestion profile

A tool in an `INGESTION` category must have an associated ingestion profile. The profile describes how the platform should understand the tool without importing or inspecting its source code.

Provisional profile fields:

```text
tool_id
source_id
data_domain_id
adapter_code
contract_version
supports_incremental
supports_selected_assets
supports_backfill
supports_revisions
supports_resume
supports_dry_run
configuration
active
```

Recommended table:

```text
data.ingestion_tool_profiles
```

The profile is PostgreSQL-authoritative. Tool files remain implementation only.

## 3.3 Macro is a data-domain package

Introduce a generic data-domain catalogue. The macro implementation becomes the first registered domain:

```text
Domain: MACRO
Sources: FRED, BOC, STATCAN, MANUAL
Assets: current indicators/series
Metrics: current KPI and analytical definitions
```

Future examples could include:

```text
PROGRAM_EVALUATION
OPERATIONS
FINANCE
EMPLOYMENT
HEALTH
CLIENT_SERVICES
```

Adding a domain must not require renaming core ingestion classes or creating a new status engine.

## 3.4 Sources, data assets, and KPIs are separate concepts

A source is where data comes from. A data asset is what is stored or measured. A KPI is a business interpretation or calculation.

These must not be collapsed into one source-specific registry.

Example:

```text
Source: Statistics Canada
Asset: Employment level
Metric: Year-over-year employment growth
Dashboard KPI: Labour-market momentum
```

A KPI may depend on one or many assets, and assets may come from one or many sources. This separation is essential for future transferability.

## 3.5 New generic contracts must avoid macro-specific naming

Current contracts remain supported for compatibility, but new platform contracts should use domain-neutral names, for example:

```text
ingestion_run_summary.v1
data_asset_catalogue.v1
data_freshness_status.v1
metric_catalogue.v1
time_series_observations.v1
```

During migration, `macro_ingestion_summary.v1` may be mapped into or emitted alongside `ingestion_run_summary.v1`.

## 3.6 PostgreSQL remains the runtime authority

The platform must continue the Phase 15 rule:

> PostgreSQL decides what may run. Files provide implementation. Structured results provide workflow evidence.

For Phase 16, this expands to:

> PostgreSQL also identifies ingestion tools, sources, domains, data assets, metric definitions, capabilities, freshness policies, and run evidence.

## 3.7 Compatibility before replacement

The current `macro` schema, indicator tables, analytical views, APIs, and dashboards remain operational during Phase 16.

Generic catalogues and contracts are introduced beside the existing implementation. Compatibility views or adapters may project current macro metadata into the new generic model. Destructive replacement is deferred until a downstream application proves the new contracts.

---

# 4. Target portable architecture

## 4.1 Catalogue layer

Recommended entities:

```text
core.tool_category_kinds
data.domains
data.sources
data.assets
data.asset_source_bindings
data.metric_definitions
data.metric_dependencies
data.ingestion_tool_profiles
```

### Data domains

A domain groups a replaceable business/data package.

Suggested fields:

```text
domain_code
name
description
schema_name
contract_version
active
configuration
```

### Data sources

A source describes a provider or input channel independently of a particular metric.

Suggested fields:

```text
source_code
domain_id
name
provider_type
base_url_reference
release_timezone
rate_limit_policy
retry_policy
active
configuration
```

Secrets must remain in environment or approved secret storage. Catalogue configuration must not store credentials.

### Data assets

`data.assets` is the generic replacement seam for macro-only indicator metadata. It does not require immediate movement of observation rows.

Suggested fields:

```text
asset_code
domain_id
name
description
asset_type
frequency
units
scale
geography
seasonal_adjustment
transformation
source_series_id
source_product_id
release_lag_days
freshness_threshold_days
criticality
revisions_expected
storage_reference
active
configuration
```

The current `macro.indicators` table can be projected into this catalogue during migration.

### Metric definitions

A metric is a managed analytical definition, not necessarily a raw stored series.

Suggested fields:

```text
metric_code
domain_id
name
description
metric_type
format_code
unit_label
calculation_reference
aggregation_code
time_grain
dimension_configuration
quality_requirements
active
version
```

Phase 16 will establish metadata and dependency contracts. It will not build a full end-user formula authoring language.

## 4.2 Adapter layer

Every source implementation must conform to one adapter contract:

```text
identifySource()
listAssets()
fetch()
normalize()
validate()
load()
classifyError()
getRetryPolicy()
getFreshnessEvidence()
```

Adapters may differ internally, but orchestration, evidence, recovery, and status behaviour must remain generic.

Source-specific code belongs behind the adapter boundary. Core services must not contain FRED-, BoC-, StatCan-, or macro-specific branches except temporary compatibility adapters.

## 4.3 Execution and evidence layer

Recommended tables:

```text
data.ingestion_runs
data.ingestion_run_items
data.ingestion_revision_events
data.ingestion_rejections
```

The ledger captures:

- domain and source;
- ingestion tool and execution references;
- trigger channel and workflow ancestry;
- requested mode and selected assets;
- run and item statuses;
- source and target date coverage;
- rows staged, inserted, updated, unchanged, rejected, and revised;
- retry and attempt counts;
- error category, code, bounded message, and HTTP status where applicable;
- recovery ancestry and resume checkpoints;
- timestamps and durations.

General Tool History remains the platform-wide execution record. The ingestion ledger becomes the detailed data-operation authority.

## 4.4 Consumer layer

The following surfaces consume generic catalogue and run contracts:

- Data Status;
- tool and workflow summaries;
- schedules and recovery actions;
- public/private data APIs;
- SkyWeb Analytics;
- future SkyData Studio;
- future domain-specific dashboards.

The UI should be able to filter or switch by:

```text
Domain
Source
Asset
Metric
Freshness state
Quality state
Run state
```

The main application must not assume that the selected domain is macroeconomic.

---

# 5. Reserved Ingestion Tools category behaviour

SkyCommand must treat `INGESTION` tool categories as a first-class capability boundary.

## 5.1 Discovery

The platform discovers ingestion tools through:

```text
core.tools
  -> core.tool_categories
  -> category_kind_code = INGESTION
  -> data.ingestion_tool_profiles
```

No static source registry is permitted in the finished architecture.

## 5.2 Validation

When a tool is created or moved into an ingestion category, SkyCommand should require:

- an active ingestion profile;
- an associated domain and source;
- a supported generic ingestion output contract;
- compatible visibility and execution permissions;
- declared capabilities;
- a source adapter or supported generic file adapter.

A tool may be registered disabled before its ingestion profile is complete, but it cannot be enabled as an ingestion tool until the contract check passes.

## 5.3 User interface behaviour

Tools in an ingestion category may receive additional UI treatment:

- ingestion badge;
- source and domain labels;
- incremental/backfill/resume capability indicators;
- direct link to source status and run history;
- ingestion-specific parameter presentation;
- failed-only recovery action;
- last success, last attempt, and current freshness summary.

These behaviours are driven by category kind and ingestion profile—not by current tool codes.

## 5.4 Scheduling and workflows

Schedules and workflows may discover ingestion tools dynamically and offer ingestion-specific templates. The generic workflow engine remains unchanged.

An ingestion workflow may use any registered ingestion tool and receive a common result shape regardless of source or domain.

---

# 6. Updated Phase 16 roadmap

## Phase 16.0 — Baseline closure and portability charter

### Purpose

Close the Phase 15 baseline and lock the portable architecture before structural changes begin.

### Deliverables

- restore the expected `brand-theme:self-test` package script;
- reconcile Phase 15 documentation to completed status;
- add this Phase 16 roadmap document to `SkyServer/docs`;
- inventory all current ingestion-related tables, services, scripts, tools, contracts, APIs, and UI dependencies;
- document every macro-specific coupling point;
- produce the initial 69-active-series audit using the current system;
- record the current outputs as a compatibility baseline.

### Acceptance proof

- current validation baseline runs after the script correction;
- existing FRED, BoC, StatCan, and manual tools remain unchanged;
- current macro views/APIs are documented and reproducible;
- no new UI or schema architecture is introduced beyond approved housekeeping.

---

## Phase 16.1 — Semantic Ingestion Tools category and dynamic discovery

### Implementation slices

- **Phase 16.1.1 — Semantic ingestion identity:** implemented and locally proven. Tool-category kinds, portable domains/sources, ingestion profiles, dynamic discovery views, and the ingestion-tools API are active without changing existing macro status contracts.
- **Phase 16.1.2 — Profile administration and onboarding guardrails:** implemented and locally proven. Admin and managed onboarding treat the portable ingestion profile as part of the transactional tool definition; deferred PostgreSQL invariants prevent profile/category drift.
- **Phase 16.1.3 — Portability closure proof:** locally proven. An ephemeral non-macro domain, source, uniquely named INGESTION category, tool, and profile were discovered without core-code registration and removed by transaction rollback with baseline counts restored.

### Purpose

Make ingestion identity catalogue-driven and eliminate source/file-name inference.

### Deliverables

- add tool category kind metadata with `GENERAL` and `INGESTION`;
- classify the existing Data Ingestion Tools category as `INGESTION`;
- add `data.ingestion_tool_profiles` or equivalent;
- register profiles for FRED, BoC, StatCan, and manual ingestion;
- create `data.vw_ingestion_tools` for reusable discovery;
- update ingestion-status and related services to query the catalogue rather than hard-coded script names/source arrays;
- expose domain, source, capabilities, and contract version through tool APIs;
- add onboarding/management validation for ingestion-category tools.

### Acceptance proof

- adding a new disabled ingestion tool/profile causes it to appear in ingestion discovery without editing core source lists;
- changing a script filename does not break ingestion identification;
- changing the visible category label does not break ingestion behaviour;
- non-ingestion tools remain unaffected.

---

## Phase 16.2 — Generic domain, source, asset, and metric catalogue

### Implementation slices

- **Phase 16.2.1 — Portable asset and metric catalogue:** complete and locally verified. Adds generic asset kinds, assets, source bindings, metric kinds, metrics, dependencies, PostgreSQL domain guardrails, macro compatibility projection, initial headline metric examples, and authenticated `data_catalogue.v1` read APIs.
- **Phase 16.2.2 — Catalogue administration and second-domain proof:** implemented pending local proof. Adds transactional managed writes for domains, sources, assets, source bindings, metrics and dependencies; a dedicated write permission; deferred domain-alignment guardrails; generic admin API endpoints; and a rollback-safe non-macro service-level discovery proof.

#### Phase 16.2.2 managed administration contract

Catalogue writes are idempotent resource replacements addressed by portable codes rather than internal UUIDs. They require `DATA_CATALOGUE_WRITE` in addition to the existing ingestion-status read permission.

```text
GET /api/ingestion/catalogue/admin/options
PUT /api/ingestion/catalogue/admin/domains/:domainCode
PUT /api/ingestion/catalogue/admin/sources/:domainCode/:sourceCode
PUT /api/ingestion/catalogue/admin/assets/:domainCode/:assetCode
PUT /api/ingestion/catalogue/admin/metrics/:domainCode/:metricCode
```

Asset writes may atomically create/update the active primary source binding. Metric writes replace the supplied dependency set transactionally. The write service resolves source and dependency codes only within the selected domain, while deferred PostgreSQL guardrails protect the same invariant from direct SQL or future write paths.

The closure proof creates a temporary `CLIENT_SERVICES_PROOF_*` domain with a database source, `SERVICE_EPISODES` record-set asset, and `SAME_DAY_ACCESS_RATE` aggregate metric. It reads the fixture through the same `data_catalogue.v1` service used by the generic API and rolls the transaction back completely.

### Purpose

Separate the reusable platform from the macroeconomic domain and create clean seams for future sources and KPIs.

### Deliverables

- create the generic `data` catalogue schema;
- register `MACRO` as the first domain;
- register FRED, BoC, StatCan, and manual as sources;
- project or migrate current macro indicator metadata into `data.assets`;
- add source-binding metadata and provider identifiers;
- add units, scale, geography, seasonal adjustment, transformations, release lag, revision behaviour, criticality, and configuration metadata;
- create metric-definition and metric-dependency metadata;
- register current headline macro KPIs as the first metric catalogue examples;
- expose generic catalogue views and versioned catalogue API contracts;
- retain `macro.indicators` and existing macro APIs through compatibility views/adapters.

### Acceptance proof

- current macro assets are discoverable through the generic catalogue;
- a non-macro domain, source, asset, and metric can be registered without schema redesign;
- API consumers can request catalogue data by domain rather than macro-specific route logic;
- no existing macro view or dashboard breaks.

---

## Phase 16.3 — Source and asset audit with explainable freshness

### Purpose

Replace coarse stale/current labels with source- and asset-aware freshness evidence.

### Deliverables

- audit all 69 active macro assets;
- capture row count, target min/max date, provider/source latest date where available, last attempt, last success, and current gap;
- classify stale assets by reason;
- establish per-asset or source-default release lag and freshness tolerance;
- introduce generic freshness states and reason codes, such as:

```text
CURRENT
EXPECTED_PROVIDER_LAG
SOURCE_NOT_UPDATED
INGESTION_NOT_RUN
INGESTION_FAILED
LOAD_BEHIND_SOURCE
CONFIGURATION_ERROR
DISCONTINUED
NO_DATA
UNKNOWN
```

- replace N+1 live table scans with a materialized/ledger-backed status seam where practical;
- preserve a read-only detail path to validate status against underlying storage.

### Acceptance proof

- every active asset has an explainable freshness result;
- known publication lag is not incorrectly reported as pipeline failure;
- status logic works for a newly registered non-macro asset;
- dashboard/status services no longer contain a hard-coded macro source registry.

---

## Phase 16.4 — Durable generic ingestion ledger

### Purpose

Provide authoritative run, item, retry, and recovery evidence independent of source and domain.

### Deliverables

- add `data.ingestion_runs`;
- add `data.ingestion_run_items`;
- associate ledger runs with tool/workflow/Temporal executions;
- record mode, capabilities, selected assets, source/target coverage, row counts, timings, attempts, and failures;
- add bounded diagnostic fields and normalized error categories;
- emit generic `ingestion_run_summary.v1` results;
- adapt current `macro_ingestion_summary.v1` consumers during transition;
- expose run and item APIs suitable for Data Status and future applications.

### Acceptance proof

- one run can contain mixed success/failure item outcomes;
- full evidence remains queryable after process restart;
- generic summaries can represent all current sources and a fixture source;
- Tool History and Workflow History remain compatible.

---

## Phase 16.5 — Common adapter, timeout, and retry framework

### Purpose

Converge source implementations behind one reusable execution framework.

### Deliverables

- define the source adapter interface;
- migrate FRED, BoC, and StatCan to the common pipeline contract;
- support generic manual CSV/spreadsheet ingestion through the same evidence model;
- standardize connection/response timeouts;
- classify retryable network and HTTP failures;
- support `Retry-After`;
- apply exponential backoff with jitter and bounded elapsed time;
- capture attempts in the ledger;
- retire duplicated source orchestration where compatibility permits;
- keep source-specific normalization inside adapters.

### Acceptance proof

- all production sources use the same orchestration/evidence path;
- source-specific differences do not leak into core services;
- a new adapter can be added without editing the common runner;
- controlled retry and terminal-failure proofs pass.

---

## Phase 16.6 — Revision-aware loading and quality contracts

### Purpose

Make ingestion correct for revised source data and enforce portable quality checks.

### Deliverables

- change insert-only loading to controlled insert/update/unchanged semantics;
- detect revised historical values;
- add `data.ingestion_revision_events`;
- preserve old/new values, asset, observation key, run ID, and detection timestamp;
- add reusable quality checks for:
  - empty responses;
  - invalid dates;
  - invalid numeric values;
  - duplicate observation keys;
  - source date regression;
  - unexpected gaps;
  - row-count anomalies;
  - transformation failures;
  - unit/frequency incompatibility;
- add rejection evidence without silently discarding bad rows;
- allow domain/source-specific quality extensions through configuration or adapters.

### Acceptance proof

- an existing observation changed by a source is detected, updated, and audited;
- identical observations are not rewritten;
- rejected rows are countable and explainable;
- quality checks work for macro and non-macro assets.

---

## Phase 16.7 — Resumable runs and targeted recovery

### Purpose

Recover failed items without repeating successful work.

### Deliverables

- add generic execution options:

```text
--resume-run-id
--failed-only
--asset
--mode incremental|backfill|full
--force-refresh
--dry-run
```

- persist recovery ancestry and checkpoints;
- support failed-only reruns from API, tool execution, workflow, and CLI lanes;
- review outer workflow retry policies once item-level retry exists;
- add safe idempotency rules for resumed runs;
- expose recovery actions in ingestion run/status surfaces.

### Acceptance proof

- a partial run can resume only failed assets;
- successful assets are not unnecessarily re-fetched or reloaded;
- recovery remains valid after API/worker restart;
- the same recovery contract works across multiple domains/sources.

---

## Phase 16.8 — Generic operational surfaces, portability proof, and closure

### Purpose

Complete the reusable consumer layer and prove that macro can be supplemented or swapped without core rewrites.

### Deliverables

- update Data Status to filter by domain/source/asset and display reasoned freshness;
- display ingestion-tool identity and capabilities from catalogue metadata;
- add run/item history and failed-only recovery links;
- publish generic versioned APIs for catalogue, freshness, observations, metrics, and ingestion history;
- preserve existing macro APIs through compatibility routes;
- update workflow summary rendering for `ingestion_run_summary.v1`;
- create a temporary non-macro portability proof package using a small fixture source and metric;
- register the proof tool in the `INGESTION` category;
- demonstrate automatic discovery, execution, ledger evidence, status, quality, recovery, and metric catalogue exposure;
- remove the temporary proof data after acceptance while retaining automated contract tests;
- document source onboarding, domain onboarding, metric onboarding, operational scheduling, rate limits, retention, backups, and production topology.

### Acceptance proof

A new source/domain/metric can be introduced by adding catalogue records, an adapter/tool, and configuration—without modifying:

- the core ingestion tool discovery service;
- the generic status engine;
- the ledger model;
- the recovery engine;
- the generic API controller structure;
- the generic dashboard component structure.

---

# 7. Updated Phase 16 acceptance criteria

Phase 16 is complete only when all of the following are true:

## Tool and category portability

- ingestion tools are discovered by `category_kind_code = INGESTION`;
- no finished core service relies on current source names, script paths, or filenames to identify ingestion tools;
- every enabled ingestion tool has a valid ingestion profile;
- the visible category label may change without breaking behaviour;
- a new ingestion tool is automatically discoverable after catalogue registration.

## Domain and KPI portability

- macro is registered as a data domain rather than embedded as the platform identity;
- sources, assets, and metrics are represented separately;
- new generic contracts do not use macro-specific names;
- a non-macro metric can be registered and discovered;
- KPI metadata and dependencies are available without requiring a full formula-builder UI;
- existing macro dashboards and APIs remain functional during migration.

## Ingestion reliability

- all active assets have explicit metadata and freshness policies;
- freshness states include explainable reason codes;
- all sources use bounded timeout and retry behaviour;
- run and item evidence is durable and relational;
- partial runs can resume failed items only;
- historical revisions are detected and audited;
- rejected or invalid data is visible rather than silently discarded;
- current macro views remain compatible.

## Portability proof

- a temporary non-macro source, asset, and metric pass end-to-end through the same category, adapter, ledger, status, quality, recovery, and API layers;
- no core source-list or macro-specific status code is changed to make the proof work;
- the proof can be removed without altering the generic platform.

---

# 8. Explicit non-goals for Phase 16

Phase 16 does not include:

- a full user-authored KPI formula language;
- a drag-and-drop dashboard designer;
- replacement of every existing per-indicator observation table;
- removal of the `macro` schema or existing analytical views;
- migration of all SkyWeb consumers to new APIs in one step;
- a general untrusted plugin marketplace;
- automatic dependency installation for source adapters;
- advanced chart-storyboard development;
- the full SkyData Studio application;
- a wholesale rewrite of the Temporal workflow engine.

These boundaries protect the phase from becoming an uncontrolled platform rewrite.

---

# 9. Compatibility and migration strategy

## Stage A — Mirror

Create generic catalogue and evidence structures while existing macro tables and APIs remain authoritative for current consumers.

## Stage B — Adapt

Expose current macro assets through generic views/contracts and emit generic ingestion summaries alongside legacy summaries.

## Stage C — Consume

Move Data Status and new consumers to generic contracts while retaining compatibility routes for SkyWeb and existing dashboards.

## Stage D — Prove

Add the temporary non-macro domain/source/metric and verify zero core-code branching.

## Stage E — Decide

Only after SkyData Studio consumes the generic contracts should the project decide whether to consolidate physical observation storage or retire legacy macro-specific surfaces.

---

# 10. Implementation principles

1. **Discover; do not enumerate.** Query catalogues rather than maintaining source arrays in code.
2. **Describe capabilities explicitly.** Do not infer behaviour from scripts.
3. **Separate source, asset, metric, and visualization.** They evolve independently.
4. **Preserve evidence.** Every status must be traceable to source, target, run, and rule.
5. **Prefer compatibility adapters to destructive rewrites.** Working views remain working.
6. **Keep source logic behind adapters.** Core orchestration stays domain-neutral.
7. **Treat missing metadata as a contract defect.** Do not quietly fall back forever.
8. **Make recovery item-specific.** Do not rerun healthy data unnecessarily.
9. **Prove portability with a second domain.** Architecture claims require evidence.
10. **Keep PostgreSQL authoritative.** Configuration in files may assist development but must not secretly define runtime identity.

---

# 11. Immediate next increment

The active implementation checkpoint is **Phase 16.7.2 — Production Failed-Only Recovery Integration**.

Phase 16.7.1 is accepted as complete. Its database and rollback-safe proof confirmed that a partial run can produce durable recovery intent, reconstruct the failed-asset selection after process-state loss, execute only the failed asset, preserve original-run ancestry, and leave successful assets untouched.

Phase 16.7.2 connects that contract to the real production lanes:

1. enable `supports_resume` for the FRED, Bank of Canada, and Statistics Canada ingestion profiles and runtime adapters;
2. add `resumeRunId`, `recoveryMode`, and `forceRefresh` parameters to the existing registered ingestion tools;
3. accept direct CLI flags such as `--resume-run-id`, `--asset`, `--mode`, and `--force-refresh`;
4. route Run Tools and workflow node parameters through the same loader scripts rather than adding a special source registry;
5. add generic recovery list/detail APIs and a failed-only execution endpoint that launches the original registered ingestion tool;
6. preserve script-execution, workflow-node, workflow-run, and Temporal linkage on the recovery child run;
7. prevent the macro compatibility layer from duplicating a recovery run that was already persisted by the recovery service;
8. prove the integration against a production FRED profile with a rollback-safe partial-run fixture.

Database file:

```text
00092__production_ingestion_recovery_integration.sql
```

Focused commands:

```text
npm run phase16:recovery-integration:self-test
npm run phase16:recovery-integration:verify
npm run phase16:recovery-integration:proof
```

The proof uses the real `ingestion_fred` profile and adapter identity but injects deterministic execution so it performs no provider request. The original run contains failed `DFF` and successful `CPIAUCSL`; recovery must execute only `DFF`, persist a child run with `resumed_from_run_id`, return the durable ledger reference to the tool boundary, and roll all proof evidence back.

---

# 12. Decision record

## Decision 16-D1

**Ingestion Tools is a reserved category type, not merely a menu label.**

Status: Approved.

## Decision 16-D2

**The application will identify ingestion tools from catalogue category kind and ingestion profile metadata.**

Status: Approved.

## Decision 16-D3

**Macro is the first registered data domain, not the permanent platform identity.**

Status: Approved.

## Decision 16-D4

**Sources, assets, metrics/KPIs, and visualizations remain separate layers.**

Status: Approved.

## Decision 16-D5

**Phase 16 will define portable KPI metadata and dependencies but will not build a full formula-authoring system.**

Status: Approved.

## Decision 16-D6

**Existing macro tables, views, and APIs remain compatible throughout Phase 16.**

Status: Approved.

## Decision 16-D7

**Phase 16 closure requires a non-macro portability proof with no core source-list changes.**

Status: Approved.
