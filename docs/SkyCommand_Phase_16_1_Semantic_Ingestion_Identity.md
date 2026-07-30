# SkyCommand Phase 16.1 — Semantic Ingestion Identity

## Status

- **Implementation increment:** Phase 16.1.1
- **Purpose:** Establish PostgreSQL-authoritative discovery of ingestion tools without hard-coded category labels, tool codes, source names, filenames, or script paths.
- **Compatibility:** Existing macro tables, analytical views, APIs, dashboards, tools, and output contracts remain in place.

## Baseline evidence carried forward

The Phase 16.0 audit recorded:

- 73 registered indicators;
- 69 active indicators;
- 207,409 observation rows;
- 52 active indicators classified CURRENT by the existing heuristic;
- 17 active indicators classified STALE and requiring later explainable-freshness analysis;
- 5 tools found by the previous category/path heuristic;
- 18 macro analytical views.

The 17 stale results remain evidence only. Phase 16.3 will replace the frequency-only heuristic with source- and asset-aware reason codes.

## What this increment adds

### Semantic tool-category kinds

New catalogue authority:

```text
core.tool_category_kinds
core.tool_categories.category_kind_code
```

Initial kinds:

```text
GENERAL
INGESTION
```

The existing `data_ingestion_tools` category is assigned `INGESTION`. All other current categories are assigned `GENERAL`.

SkyCommand can now determine whether a tool is an ingestion tool from semantic catalogue metadata rather than from visible labels or paths.

### Minimum portable catalogue

New schema and entities:

```text
data.domains
data.sources
data.ingestion_tool_profiles
```

Phase 16.1 registers `MACRO` as the first replaceable domain and registers the current sources:

```text
FRED
BOC
STATCAN
MANUAL
```

The existing ingestion tools receive profiles describing their adapter, current result contract, and current capabilities. Manual ingestion is explicitly marked `legacy_unstructured.v1` until it emits the generic ingestion result contract.

Capability flags deliberately report the implementation that exists today. Revision, resume, dry-run, and explicit backfill support remain false until later Phase 16 increments implement and prove them.

### Data-driven discovery views

New views:

```text
data.vw_ingestion_tools
data.vw_ingestion_sources
```

A tool appears in `data.vw_ingestion_tools` only when:

1. its category kind is `INGESTION`;
2. it has an ingestion profile;
3. its application, category kind, category, tool, profile, domain, and source are active.

This creates the portable discovery seam for APIs, status services, onboarding, run ledgers, and future domains.

### API discovery

New authenticated endpoint:

```text
GET /api/ingestion/tools
```

Optional query filters:

```text
domainCode
source
channelCode
```

The endpoint returns semantic category identity, domain, source, adapter, contract, visibility, and capability metadata.

The existing ingestion status service now discovers tools and sources from PostgreSQL. It no longer maintains an in-code FRED/BoC/StatCan source registry or an ingestion filename list.

The current macro Data Status surface remains compatible by using data-driven source configuration to map registered sources to the legacy `macro.indicators.source` values. Manual ingestion is discoverable as an ingestion tool but remains excluded from the legacy source-status summary until generic assets are introduced.

### Tool catalogue administration metadata

Tool administration responses now include:

```text
categoryKindCode
```

This allows future onboarding and UI behaviour to recognize special semantic categories without testing category labels or codes.

## Apply to the current development database

The normal database build remains authoritative for new environments. To upgrade the existing populated development database without dropping macro data, run:

```powershell
npm run phase16:identity:setup
```

The setup command applies these idempotent SQL files:

```text
packages/db_build/src/migrations/00074__portable_ingestion_identity.sql
packages/db_build/src/seeds/00075__portable_ingestion_identity_seed.sql
```

It then runs the identity verification automatically.

A later standalone verification can be run with:

```powershell
npm run phase16:identity:verify
```

## Verification invariants

The verification fails when:

- no category is typed as `INGESTION`;
- an enabled tool in an `INGESTION` category lacks an active profile;
- an active ingestion profile belongs to a non-ingestion category;
- fewer than the four current ingestion tools are discoverable.

Expected initial tools:

```text
ingestion_fred
ingestion_boc
ingestion_statcan
ingestion_manual
```

## Deliberately deferred

This increment does not yet add:

- generic data assets;
- metric/KPI definitions;
- ingestion run ledgers;
- source adapters;
- revision-aware loading;
- resumable recovery;
- explainable freshness;
- ingestion-profile editing in Admin-Web.

Those remain sequenced later in the approved Phase 16 roadmap.

## Next increment

After the setup and API checks pass, proceed to **Phase 16.1.2 — Ingestion Profile Administration and Onboarding Guardrails**:

- expose profile detail through Tool Details;
- require an ingestion profile when a tool is assigned to an `INGESTION` category;
- add profile create/update support without source-specific core code;
- prove that a newly registered placeholder ingestion tool is discovered automatically from catalogue metadata.
