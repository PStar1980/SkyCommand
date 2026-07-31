# SkyCommand Phase 16.3 Explainable Freshness Audit

Generated: 2026-07-31T18:57:08.671Z

## Purpose

This audit replaces the legacy age-only stale/current interpretation with portable source, target, execution, and cadence evidence. `EXPECTED_PROVIDER_LAG` is healthy: it means a period-start date looks old under a simple age threshold but is still on schedule after period completion and publication lag are considered.

## Summary

- Active discoverable assets evaluated: **69**
- Assets requiring investigation: **3**

### Freshness reasons

| Reason | Assets |
|---|---:|
| CURRENT | 56 |
| EXPECTED_PROVIDER_LAG | 10 |
| SOURCE_NOT_UPDATED | 3 |

### Sources

| Source | Assets |
|---|---:|
| BOC | 2 |
| FRED | 53 |
| STATCAN | 14 |

## Assets requiring investigation

| Source | Asset | Frequency | Reason | Expected | Source latest | Target latest | Last attempt |
|---|---|---|---|---|---|---|---|
| STATCAN | CAD_GDP_MOM_GROWTH | MONTHLY | SOURCE_NOT_UPDATED | 2026-05-01 | 2026-04-01 | 2026-04-01 | SUCCESS |
| STATCAN | CAD_REAL_GDP_MONTHLY | MONTHLY | SOURCE_NOT_UPDATED | 2026-05-01 | 2026-04-01 | 2026-04-01 | SUCCESS |
| FRED | USSLIND | MONTHLY | SOURCE_NOT_UPDATED | 2026-05-01 | 2020-02-01 | 2020-02-01 | SUCCESS |

## Interpretation rule

- `CURRENT`: target meets the expected observation date.
- `EXPECTED_PROVIDER_LAG`: healthy; the stored period-start date is old but the next period is not yet due under policy.
- `SOURCE_NOT_UPDATED`: the ingestion ran successfully, target matches source evidence, but the provider itself is behind the expected observation date.
- `LOAD_BEHIND_SOURCE`: source contains newer data than target; this is a load/pipeline problem.
- `INGESTION_FAILED`: the latest attempt failed while data remains behind.
- `INGESTION_NOT_RUN`: data is behind and no attempt evidence exists.
- `CONFIGURATION_ERROR`, `NO_DATA`, `DISCONTINUED`, and `UNKNOWN` are explicit rather than being collapsed into generic staleness.

## Compatibility note

This snapshot seam does not replace the Phase 16.4 durable ingestion ledger. It is a read-optimized freshness view built from the portable catalogue, storage statistics, and existing execution evidence.
