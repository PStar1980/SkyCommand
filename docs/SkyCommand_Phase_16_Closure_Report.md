# SkyCommand Phase 16 Closure Report

## Document control

- **Status:** Closure candidate — final live regression and promotion pending
- **Revision:** 1
- **Date:** 2026-08-01
- **Product:** SkyCommand
- **Phase:** 16 — Portable Ingestion and Data Contract Foundation

## 1. Closure statement

Phase 16 has delivered and locally proven a portable ingestion, evidence, recovery, and consumer-contract foundation. The production macroeconomic domain remains compatible, while a temporary **PROGRAM_EVALUATION** domain completed the same generic path without a macro-specific branch or core source-list edit.

The remaining Phase 16.9 work is stabilization and release closure only:

1. remove the node-postgres overlapping-query deprecation warning;
2. run one concise live production regression;
3. run repository validation and the Admin-Web production build;
4. promote the completed phase through the normal Development Promotion workflow.

No new Phase 16 architecture, database migration, source adapter, or product surface is planned after this checkpoint.

## 2. Delivered architecture

### Semantic ingestion identity

- Ingestion tools are discovered through the catalogue `INGESTION` category kind.
- Every discoverable ingestion tool has a PostgreSQL-authoritative ingestion profile.
- Runtime identity does not depend on source names, script filenames, or display labels.

### Portable catalogue

- Domains, sources, assets, source bindings, metrics, and dependencies are separate concepts.
- Macro is the first production domain rather than the permanent platform identity.
- Source aliases, provider metadata, storage bindings, capabilities, and contracts are discoverable.

### Common adapter and request framework

- FRED, Bank of Canada, Statistics Canada, and manual file ingestion share one adapter boundary.
- Additional adapters are discovered without editing a central source registry.
- HTTP sources use PostgreSQL-authoritative timeout, retry, backoff, jitter, and terminal-error policies.

### Explainable freshness

- Freshness combines cadence, provider/source evidence, target evidence, and execution evidence.
- Healthy provider lag is distinguished from actual source stagnation or load failure.
- Data Intelligence consumes persisted generic freshness snapshots.

### Durable ingestion ledger

- Run-level and per-asset attempt evidence is relational and queryable.
- Workflow, workflow-node, script-execution, Temporal workflow, and Temporal run lineage are preserved.
- Retry attempts remain separate rows rather than overwriting prior evidence.

### Revision and quality evidence

- Observation outcomes distinguish `NEW`, `REVISED`, `UNCHANGED`, and `REJECTED`.
- Historical revisions preserve old and new values.
- Invalid rows and quality findings remain visible through dedicated evidence contracts.
- Source and asset quality policies use `ASSET → SOURCE → CHECK_DEFAULT` precedence.
- Blocking findings prevent mutation while retaining diagnostics.

### Failed-only recovery

- A partial or failed run can create a durable recovery request.
- Recovery intent survives process loss because the selected assets are persisted first.
- Production recovery works through CLI, Run Tools, API, published workflow, and Temporal lanes.
- Successful assets remain untouched while only failed assets are re-fetched and reloaded.

### Generic operations and consumer contracts

- Ingestion Operations exposes run history, attempts, evidence coverage, lineage, and recovery history.
- Failed runs deep-link into the existing registered Run Tools lane with recovery parameters populated.
- Asset and metric consumers expose bounded, versioned contracts without a general formula language.

## 3. Accepted contracts

| Contract | Purpose |
|---|---|
| `data_catalogue.v1` | Domains, sources, assets, metrics, dependencies, and discovery metadata |
| `data_asset.v1` | Portable asset identity and source/storage binding |
| `data_metric.v1` | Portable direct or derived metric definition |
| `time_series_observations.v1` | Catalogue-backed asset observations |
| `metric_observations.v1` | Direct `IDENTITY` and bounded `PCT_CHANGE` metric observations |
| `data_freshness_status.v1` | Explainable asset freshness evidence |
| `ingestion_run_summary.v1` | Durable generic run and item evidence |
| `ingestion_quality_evidence.v1` | Quality, revision, and rejected-row evidence |
| `ingestion_recovery.v1` | Durable failed-only recovery intent and lineage |
| `macro_ingestion_summary.v1` | Preserved legacy workflow/tool presentation contract |

## 4. Production and portability evidence

The following production paths were accepted:

- selected FRED, Bank of Canada, and Statistics Canada ingestion;
- full Macro Refresh Pipeline execution;
- workflow-node and Temporal lineage reconciliation;
- revision-aware and policy-aware production loads;
- interactive and workflow failed-only recovery;
- generic Ingestion Operations inspection;
- direct asset, direct metric, and derived metric APIs;
- asset-aware ingestion-run search.

The final non-macro proof registered and removed a temporary **PROGRAM_EVALUATION** package containing:

- source `LOCAL_CASE_FILE`;
- assets `CLIENT_INTAKE` and `SERVICE_ACCESS`;
- metric `CLIENT_INTAKE_GROWTH` using bounded `PCT_CHANGE`;
- a dynamically discovered adapter;
- an intentional partial run;
- portable quality and freshness evidence;
- failed-only recovery of `SERVICE_ACCESS`;
- generic observation and metric consumption.

The proof completed with a latest derived metric value of `50` and removed its temporary adapter, tool, metadata, evidence, storage, and runtime files.

## 5. Compatibility position

Phase 16 does not remove or replace the current macro schema, 18 curated macro views, legacy APIs, or the `macro_ingestion_summary.v1` presentation contract. Generic contracts exist beside the current product and provide the seam for future consumers.

Physical per-indicator storage remains intentionally compatible. Consolidating storage should be considered only after SkyData Studio consumes the generic contracts and provides evidence that a migration is worthwhile.

## 6. Known accepted conditions

### `USSLIND`

`USSLIND` remains the legitimate macro watch item because provider/source evidence ends in February 2020. This is classified as `SOURCE_NOT_UPDATED`; it is not an ingestion backlog or failed SkyCommand load.

### node-postgres single-client discipline

Phase 16.9 removes overlapping reads issued through one checked-out `pg` Client. The ledger detail and freshness services now execute client-bound reads sequentially. Pool-backed callers remain supported.

### Deferred work

The following remain outside Phase 16:

- a general user-authored metric formula language;
- advanced chart-storyboard development;
- a drag-and-drop dashboard designer;
- full physical observation-storage consolidation;
- automatic dependency installation for third-party adapters;
- the SkyData Studio client application.

## 7. Final acceptance sequence

Run the focused closure checks:

```powershell
npm run phase16:closure:self-test
npm run phase16:closure:verify
```

Then perform one concise live regression:

1. selected FRED `DFF`, BoC `FXUSDCAD`, and StatCan `CAD_CPI_ALL_ITEMS` runs;
2. Macro Refresh Pipeline with small selections;
3. Data Intelligence and Ingestion Operations inspection;
4. asset, direct metric, derived metric, and DFF run-search API checks.

Complete repository closure:

```powershell
npm run validate
npm run web:build
```

Then use the normal promotion route:

```text
Dev Commit
→ Development Promotion workflow
→ approved merge to main
→ regenerate repository map
→ regenerate repository ZIP
```

## 8. Next product chapter

The next planned repository is **SkyData Studio**, a full-stack Python consumer of the portable catalogue, observation, metric, freshness, quality, ledger, and recovery contracts.

SkyCommand remains the ingestion engine, workflow control plane, operational cockpit, and evidence authority. SkyData Studio becomes the client-facing analytical experience built on top of the Phase 16 contracts.
