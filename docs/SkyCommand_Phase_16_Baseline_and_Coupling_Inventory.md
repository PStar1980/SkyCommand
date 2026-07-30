# SkyCommand Phase 16.0 — Baseline and Coupling Inventory

## Document control

- **Status:** Phase 16.0 implementation baseline
- **Date:** 2026-07-30
- **Phase:** 16.0 — Baseline Closure and Portability Charter
- **Governing roadmap:** `SkyCommand_Phase_16_Portable_Ingestion_and_Data_Contract_Foundation.md`
- **Database posture:** Read-only audit only; no Phase 16 schema changes are introduced in this increment.

## Purpose

Phase 16.0 closes the Phase 15 baseline, records the current macro ingestion implementation, and identifies the source/domain couplings that later Phase 16 increments must replace with catalogue-driven contracts.

The current macro implementation remains operational. Macro is treated as the first production data domain—not the permanent identity of SkyCommand ingestion.

## Phase 15 closure baseline

Phase 15 is complete. The catalogue administration, repository designation, trusted onboarding, managed verification, controlled execution, explicit enablement, workflow visibility, structured output, regression/recovery, and live workflow proof lanes are established.

The governing runtime rule remains:

> PostgreSQL decides what may run. Files provide implementation. Structured results provide workflow evidence.

Phase 16 extends the same rule to ingestion identity, domains, sources, assets, KPIs, freshness policies, and run evidence.

## Current ingestion inventory

### Tool catalogue

The current seeded ingestion category is:

```text
category_code: data_ingestion_tools
label: Data Ingestion Tools
```

Current seeded tools:

| Tool code | Implementation | Current contract |
|---|---|---|
| `ingestion_fred` | `packages/ingestion/src/loadFREDMacroData.js` | `macro_ingestion_summary.v1` |
| `ingestion_boc` | `packages/ingestion/src/loadBoCMacroData.js` | `macro_ingestion_summary.v1` |
| `ingestion_statcan` | `packages/ingestion/src/loadStatCanMacroData.js` | `macro_ingestion_summary.v1` |
| `ingestion_manual` | `packages/ingestion/src/loadManualData.js` | No macro summary association |

Phase 16.1 will add semantic category kind metadata so ingestion identity no longer depends on `data_ingestion_tools`, visible label text, source names, script names, or paths.

### Data-domain baseline

- Schema: `macro`
- Indicator authority: `macro.indicators`
- Registered indicators expected from current seeds: 73
- Active indicators expected from current seeds: 69
- Sources: FRED, Bank of Canada, Statistics Canada
- Additional implementation lane: manual CSV/spreadsheet ingestion
- Current analytical compatibility surfaces: 18 `macro.vw_*` views
- Current structured contract: `macro_ingestion_summary.v1`

The exact local counts, dates, table status, observation totals, tools, and views must be captured from the active PostgreSQL database using the Phase 16 baseline audit command.

## Read-only baseline audit utility

Run from the repository root:

```powershell
npm run phase16:baseline-audit
```

The command performs no source API calls and makes no database changes. It reads:

- `macro.indicators`;
- each current indicator table's row count and minimum/maximum `edate`;
- current frequency-only freshness classifications;
- the ingestion tool catalogue and visibility channels;
- current macro views;
- recent ingestion execution evidence where available.

It generates:

```text
docs/audits/phase16/SkyCommand_Phase_16_Baseline_Audit.md
docs/audits/phase16/SkyCommand_Phase_16_Indicator_Audit.csv
docs/audits/phase16/SkyCommand_Phase_16_Baseline_Audit.json
```

The generated freshness status intentionally reproduces the current heuristic. It is evidence for analysis, not the final Phase 16 freshness design.

## Current coupling inventory

### API and status couplings

| File | Current coupling | Phase 16 destination |
|---|---|---|
| `apps/api/src/services/ingestionStatusService.js` | Hard-coded FRED/BoC/StatCan registry, provider labels, script filenames, source aliases, `macro.indicators`, per-indicator `macro.<indicator>` tables, frequency-only thresholds, macro-specific execution inference | Catalogue-driven ingestion tool/profile discovery, generic source/asset catalogue, explainable freshness service, ledger-backed status |
| `apps/api/src/controllers/ingestionController.js` | Telemetry uses `scope: macro-pipeline`; payload vocabulary uses indicators | Domain-neutral ingestion telemetry with compatibility projection for current UI |
| `apps/api/src/routes/ingestion.routes.js` | Route vocabulary uses `/indicators` | Generic `/assets` contract added beside retained compatibility routes |
| `apps/api/src/services/macroReadService.js` | Reads `macro.indicators`, per-indicator tables, and curated macro views | Retained macro compatibility service; generic catalogue/observation services introduced beside it |
| `apps/api/src/services/publicMacroService.js` | Public macro-specific contract | Retained compatibility surface for SkyWeb Analytics |
| `apps/api/src/routes/macro.routes.js` | Authenticated macro routes | Retained during Phase 16 |
| `apps/api/src/routes/publicMacro.routes.js` | Public macro routes | Retained during Phase 16 |

### Ingestion runtime couplings

| File | Current coupling | Phase 16 destination |
|---|---|---|
| `packages/ingestion/src/core/macroIngestionResult.js` | Macro-specific output type and indicator terminology | Generic `ingestion_run_summary.v1` with compatibility emission/mapping |
| `packages/ingestion/src/core/macroIngestionCli.js` | Hard-coded source-to-tool map for FRED, BOC, STATCAN | Tool/profile lookup from PostgreSQL catalogue |
| `packages/ingestion/src/core/runPipeline.js` | Shared pipeline assumes macro indicator/table conventions | Generic source adapter + asset load contract |
| `packages/ingestion/src/fred/fredBatchRunner.js` | Parallel FRED orchestration path | Common adapter runner |
| `packages/ingestion/src/loadFREDMacroData.js` | FRED-specific entrypoint | Retained tool entrypoint backed by common adapter |
| `packages/ingestion/src/loadBoCMacroData.js` | BoC-specific entrypoint | Retained tool entrypoint backed by common adapter |
| `packages/ingestion/src/loadStatCanMacroData.js` | StatCan-specific entrypoint | Retained tool entrypoint backed by common adapter |
| `packages/ingestion/src/loadManualData.js` | Manual job configuration differs from source adapters | Generic file/manual adapter profile |
| `packages/ingestion/src/loaders/copyLoader.js` | Insert-only macro table load; revisions are ignored | Revision-aware generic loader with inserted/updated/unchanged/rejected evidence |
| `packages/ingestion/src/loaders/manualCopyLoader.js` | Separate manual upsert behavior | Common load evidence contract while preserving table-safe manual behavior |
| `packages/ingestion/src/sources/fred.js` | FRED fetch/normalize rules | FRED adapter implementation |
| `packages/ingestion/src/sources/boc.js` | BoC fetch/normalize rules | BoC adapter implementation |
| `packages/ingestion/src/sources/statcan.js` | StatCan fetch/normalize rules | StatCan adapter implementation |
| `packages/ingestion/src/sources/indicators.js` | Loads source-specific macro indicators | Generic asset/source-binding discovery |
| `packages/ingestion/src/config/statcanIndicators.js` | StatCan business metadata in JavaScript | PostgreSQL asset/source-binding metadata with compatibility config during migration |
| `packages/ingestion/src/config/statcanVectors.js` | Provider vector IDs in JavaScript | PostgreSQL source binding/configuration metadata |
| `packages/ingestion/src/config/manualIngestion.json` | Local manual job registry | Registered source/tool profile configuration |

### PostgreSQL couplings

| Surface | Current coupling | Phase 16 destination |
|---|---|---|
| `macro.indicators` | Source, description, frequency, active flag only | Compatibility authority projected into generic domain/source/asset catalogue during migration |
| `macro.<indicator_code>` tables | One table per indicator, expected `edate`/value shape | Preserved throughout Phase 16; generic observation adapters sit above the existing storage |
| `macro.vw_*` views | Macro-specific analytical definitions | Preserved as compatibility surfaces; selected KPIs registered in generic metric metadata |
| `core.tool_categories` | No semantic category kind | `GENERAL` / `INGESTION` category kinds in Phase 16.1 |
| `core.tools` | Tool execution authority but no ingestion capability profile | `data.ingestion_tool_profiles` or equivalent in Phase 16.1 |
| `auth.vw_script_execution_recent` | General execution evidence used to infer ingestion history | Dedicated ingestion run/item ledger in Phase 16.4 |

### Contract, workflow, and UI couplings

| Surface | Current coupling | Phase 16 destination |
|---|---|---|
| `packages/tools/contracts/macro_ingestion_summary.v1.schema.json` | Macro-specific structured output | Retained compatibility contract plus generic ingestion run contract |
| Structured contract seed association | Three known tool codes associated with macro output | Profile/contract-driven association |
| FRED Temporal template/activity | Dedicated FRED workflow implementation | Retained while generic ingestion workflows become source/profile-driven |
| `apps/admin-web/src/pages/DataStatus.jsx` | Indicator/source vocabulary and current status fields | Generic domain/source/asset status model with macro compatibility |
| `apps/admin-web/src/pages/IngestionStatus.jsx` | Macro source/indicator presentation | Generic ingestion status presentation in later phase; no Phase 16.0 UI change |
| `apps/admin-web/src/components/charts/IngestionStatusVisuals.jsx` | Macro pipeline chart semantics | Domain-neutral data supplied by generic contracts |
| `apps/admin-web/src/services/ingestionService.js` | Current indicator/source API routes | Compatibility calls retained while generic routes are introduced |

## Current compatibility baseline

Phase 16 must preserve these working lanes until explicit replacement is proven:

1. FRED, Bank of Canada, Statistics Canada, and manual tool execution.
2. CLI, Admin-Web, API, worker, workflow, and Temporal invocation paths.
3. `macro_ingestion_summary.v1` workflow output.
4. `macro.indicators` and current per-indicator tables.
5. Existing `macro.vw_*` analytical views.
6. Authenticated `/api/macro/*` routes.
7. Public macro routes used by SkyWeb Analytics.
8. `/api/ingestion/*` routes used by current SkyCommand surfaces.
9. Data Status and current freshness presentation.
10. Tool History and Workflow History evidence.

## Phase 16.0 completion sequence

1. Apply this package.
2. Run `npm run phase16:baseline-audit` against the active development database.
3. Review the generated Markdown/CSV/JSON evidence.
4. Classify the active non-current series before changing freshness or source architecture.
5. Run the normal validation baseline when convenient after the package-script correction.
6. Begin Phase 16.1 only after the audit evidence is captured and preserved.

## Phase 16.0 acceptance status

| Requirement | Status |
|---|---|
| Restore `brand-theme:self-test` | Delivered in Phase 16.0 package |
| Mark Phase 15 complete | Delivered in documentation |
| Add approved Phase 16 roadmap | Delivered |
| Inventory current couplings | Delivered in this document |
| Add read-only 69-series audit | Delivered; local execution required |
| Record live compatibility evidence | Pending local audit output |
| Introduce schema/UI architecture | Explicitly not included |
