# SkyCommand Phase 16 Baseline Audit

- **Generated:** 2026-07-30T20:12:54.341Z
- **Database:** skyserver_dev
- **Database timestamp:** 2026-07-30T20:12:54.431Z
- **Mode:** Read-only repository and PostgreSQL baseline inspection
- **Freshness caution:** Status values below reproduce the existing frequency-only heuristic. They are evidence for Phase 16 analysis, not the final explainable-freshness contract.

## Summary

- Registered indicators: **73**
- Active indicators: **69**
- Inactive indicators: **4**
- Total observation rows: **207409**
- Active indicators by source: BOC: 2, FRED: 53, STATCAN: 14
- Active heuristic status counts: CURRENT: 52, STALE: 17
- Ingestion tools discovered by the current category/path rules: **5**
- Macro views: **18**

## Active indicators requiring investigation

| Source | Indicator | Frequency | Rows | Latest observation | Age (days) | Current status |
|---|---|---:|---:|---|---:|---|
| FRED | BUSINV | monthly | 413 | 2026-05-01 | 90 | STALE |
| FRED | CSUSHPISA | monthly | 473 | 2026-05-01 | 90 | STALE |
| FRED | GNP | quarterly | 317 | 2026-01-01 | 210 | STALE |
| FRED | JTSHIR | monthly | 306 | 2026-05-01 | 90 | STALE |
| FRED | JTSJOL | monthly | 306 | 2026-05-01 | 90 | STALE |
| FRED | JTSQUR | monthly | 306 | 2026-05-01 | 90 | STALE |
| FRED | PCE | monthly | 809 | 2026-05-01 | 90 | STALE |
| FRED | PCEC96 | monthly | 233 | 2026-05-01 | 90 | STALE |
| FRED | PCEPI | monthly | 809 | 2026-05-01 | 90 | STALE |
| FRED | PCEPILFE | monthly | 809 | 2026-05-01 | 90 | STALE |
| FRED | USSLIND | monthly | 458 | 2020-02-01 | 2371 | STALE |
| STATCAN | CAD_BUILDING_PERMITS | monthly | 101 | 2026-05-01 | 90 | STALE |
| STATCAN | CAD_GDP_MOM_GROWTH | monthly | 351 | 2026-04-01 | 120 | STALE |
| STATCAN | CAD_IMPORTS | monthly | 353 | 2026-05-01 | 90 | STALE |
| STATCAN | CAD_REAL_GDP_MONTHLY | monthly | 352 | 2026-04-01 | 120 | STALE |
| STATCAN | CAD_RETAIL_SALES | monthly | 113 | 2026-05-01 | 90 | STALE |
| STATCAN | CAD_TRADE_BY_INDUSTRY | monthly | 293 | 2026-05-01 | 90 | STALE |

## Ingestion tool baseline

| Category | Tool | Script | Output contract | Enabled | Channels |
|---|---|---|---|---:|---|
| data_ingestion_tools | ingestion_boc | packages/ingestion/src/loadBoCMacroData.js | macro_ingestion_summary.v1 | Yes | admin-web, api, cli, worker |
| data_ingestion_tools | ingestion_fred | packages/ingestion/src/loadFREDMacroData.js | macro_ingestion_summary.v1 | Yes | admin-web, api, cli, worker |
| data_ingestion_tools | ingestion_manual | packages/ingestion/src/loadManualData.js | — | Yes | admin-web, api, cli, worker |
| data_ingestion_tools | ingestion_statcan | packages/ingestion/src/loadStatCanMacroData.js | macro_ingestion_summary.v1 | Yes | admin-web, api, cli, worker |
| workflow_tools | temporal_workflow_start | packages/temporal/src/startFredIngestionWorkflow.js | — | Yes | admin-web, api, worker |

## Macro view compatibility baseline

| View | Columns |
|---|---:|
| vw_ca_growth | 13 |
| vw_ca_housing | 8 |
| vw_ca_inflation | 10 |
| vw_ca_labor | 9 |
| vw_ca_macro_regime | 28 |
| vw_ca_rates_fx | 8 |
| vw_ca_trade | 9 |
| vw_credit_conditions | 9 |
| vw_growth | 7 |
| vw_housing | 7 |
| vw_inflation | 11 |
| vw_labor | 9 |
| vw_liquidity | 8 |
| vw_macro_regime | 19 |
| vw_rates_curve | 17 |
| vw_us_ca_inflation_compare | 22 |
| vw_us_ca_labor_compare | 22 |
| vw_us_ca_policy_fx | 12 |

## Full indicator inventory

| Source | Indicator | Active | Frequency | Rows | Earliest | Latest | Age | Threshold | Status |
|---|---|---:|---|---:|---|---|---:|---:|---|
| BOC | FXUSDCAD | Yes | daily | 2389 | 2017-01-03 | 2026-07-29 | 1 | 7 | CURRENT |
| BOC | V39052 | No | daily | 0 | — | — | — | 7 | INACTIVE |
| BOC | V39053 | No | daily | 0 | — | — | — | 7 | INACTIVE |
| BOC | V39054 | No | daily | 0 | — | — | — | 7 | INACTIVE |
| BOC | V39079 | Yes | daily | 4493 | 2009-04-21 | 2026-07-29 | 1 | 7 | CURRENT |
| FRED | AHETPI | Yes | monthly | 750 | 1964-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | ANFCI | Yes | weekly | 2899 | 1971-01-08 | 2026-07-24 | 6 | 21 | CURRENT |
| FRED | BAMLC0A1CAAA | Yes | daily | 857 | 2023-04-25 | 2026-07-29 | 1 | 7 | CURRENT |
| FRED | BAMLC0A4CBBBEY | Yes | daily | 857 | 2023-04-25 | 2026-07-29 | 1 | 7 | CURRENT |
| FRED | BUSINV | Yes | monthly | 413 | 1992-01-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | CCSA | Yes | weekly | 3107 | 1967-01-07 | 2026-07-18 | 12 | 21 | CURRENT |
| FRED | CES0500000003 | Yes | monthly | 244 | 2006-03-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | CIVPART | Yes | monthly | 941 | 1948-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | CPIAUCSL | Yes | monthly | 953 | 1947-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | CPILFESL | Yes | monthly | 833 | 1957-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | CSUSHPISA | Yes | monthly | 473 | 1987-01-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | DCOILWTICO | Yes | daily | 10210 | 1986-01-02 | 2026-07-27 | 3 | 7 | CURRENT |
| FRED | DFEDTARL | Yes | daily | 6436 | 2008-12-16 | 2026-07-30 | 0 | 7 | CURRENT |
| FRED | DFEDTARU | Yes | daily | 6436 | 2008-12-16 | 2026-07-30 | 0 | 7 | CURRENT |
| FRED | DFF | Yes | daily | 26326 | 1954-07-01 | 2026-07-28 | 2 | 7 | CURRENT |
| FRED | DGS10 | Yes | daily | 16127 | 1962-01-02 | 2026-07-28 | 2 | 7 | CURRENT |
| FRED | DGS2 | Yes | daily | 12535 | 1976-06-01 | 2026-07-28 | 2 | 7 | CURRENT |
| FRED | DGS3 | Yes | daily | 16127 | 1962-01-02 | 2026-07-28 | 2 | 7 | CURRENT |
| FRED | DGS3MO | Yes | daily | 11713 | 1981-09-01 | 2026-07-28 | 2 | 7 | CURRENT |
| FRED | DGS5 | Yes | daily | 16127 | 1962-01-02 | 2026-07-28 | 2 | 7 | CURRENT |
| FRED | DGS7 | Yes | daily | 14257 | 1969-07-01 | 2026-07-28 | 2 | 7 | CURRENT |
| FRED | EFFR | Yes | daily | 6546 | 2000-07-03 | 2026-07-29 | 1 | 7 | CURRENT |
| FRED | EMRATIO | Yes | monthly | 941 | 1948-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | GDP | Yes | quarterly | 318 | 1947-01-01 | 2026-04-01 | 120 | 190 | CURRENT |
| FRED | GDPC1 | Yes | quarterly | 318 | 1947-01-01 | 2026-04-01 | 120 | 190 | CURRENT |
| FRED | GNP | Yes | quarterly | 317 | 1947-01-01 | 2026-01-01 | 210 | 190 | STALE |
| FRED | GOLDAMGBD228NLBM | No | daily | 0 | — | — | — | 7 | INACTIVE |
| FRED | GPDI | Yes | quarterly | 318 | 1947-01-01 | 2026-04-01 | 120 | 190 | CURRENT |
| FRED | HOUST | Yes | monthly | 810 | 1959-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | ICSA | Yes | weekly | 3108 | 1967-01-07 | 2026-07-25 | 5 | 21 | CURRENT |
| FRED | INDPRO | Yes | monthly | 1290 | 1919-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | IORB | Yes | daily | 1828 | 2021-07-29 | 2026-07-30 | 0 | 7 | CURRENT |
| FRED | JTSHIR | Yes | monthly | 306 | 2000-12-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | JTSJOL | Yes | monthly | 306 | 2000-12-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | JTSQUR | Yes | monthly | 306 | 2000-12-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | M1SL | Yes | monthly | 810 | 1959-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | M2SL | Yes | monthly | 810 | 1959-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | MORTGAGE30US | Yes | weekly | 2887 | 1971-04-02 | 2026-07-23 | 7 | 21 | CURRENT |
| FRED | NFCI | Yes | weekly | 2899 | 1971-01-08 | 2026-07-24 | 6 | 21 | CURRENT |
| FRED | NFCICREDIT | Yes | weekly | 2899 | 1971-01-08 | 2026-07-24 | 6 | 21 | CURRENT |
| FRED | NFCILEVERAGE | Yes | weekly | 2899 | 1971-01-08 | 2026-07-24 | 6 | 21 | CURRENT |
| FRED | NFCINONFINLEVERAGE | Yes | weekly | 2899 | 1971-01-08 | 2026-07-24 | 6 | 21 | CURRENT |
| FRED | NFCIRISK | Yes | weekly | 2899 | 1971-01-08 | 2026-07-24 | 6 | 21 | CURRENT |
| FRED | PAYEMS | Yes | monthly | 1050 | 1939-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | PCE | Yes | monthly | 809 | 1959-01-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | PCEC96 | Yes | monthly | 233 | 2007-01-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | PCEPI | Yes | monthly | 809 | 1959-01-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | PCEPILFE | Yes | monthly | 809 | 1959-01-01 | 2026-05-01 | 90 | 75 | STALE |
| FRED | PERMIT | Yes | monthly | 798 | 1960-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | STLFSI4 | Yes | weekly | 1700 | 1993-12-31 | 2026-07-24 | 6 | 21 | CURRENT |
| FRED | TCU | Yes | monthly | 714 | 1967-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | U6RATE | Yes | monthly | 389 | 1994-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | UNRATE | Yes | monthly | 941 | 1948-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| FRED | USSLIND | Yes | monthly | 458 | 1982-01-01 | 2020-02-01 | 2371 | 75 | STALE |
| STATCAN | CAD_BUILDING_PERMITS | Yes | monthly | 101 | 2018-01-01 | 2026-05-01 | 90 | 75 | STALE |
| STATCAN | CAD_CPI_ALL_ITEMS | Yes | monthly | 1350 | 1914-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| STATCAN | CAD_CPI_YOY | Yes | monthly | 1338 | 1915-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| STATCAN | CAD_EMPLOYMENT | Yes | monthly | 606 | 1976-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| STATCAN | CAD_GDP_MOM_GROWTH | Yes | monthly | 351 | 1997-02-01 | 2026-04-01 | 120 | 75 | STALE |
| STATCAN | CAD_IMPORTS | Yes | monthly | 353 | 1997-01-01 | 2026-05-01 | 90 | 75 | STALE |
| STATCAN | CAD_NEW_HOUSING_PRICE_INDEX | Yes | monthly | 546 | 1981-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| STATCAN | CAD_NHPI_MOM | Yes | monthly | 545 | 1981-02-01 | 2026-06-01 | 59 | 75 | CURRENT |
| STATCAN | CAD_PARTICIPATION_RATE | Yes | monthly | 606 | 1976-01-01 | 2026-06-01 | 59 | 75 | CURRENT |
| STATCAN | CAD_POPULATION | Yes | quarterly | 322 | 1946-01-01 | 2026-04-01 | 120 | 190 | CURRENT |
| STATCAN | CAD_REAL_GDP_MONTHLY | Yes | monthly | 352 | 1997-01-01 | 2026-04-01 | 120 | 75 | STALE |
| STATCAN | CAD_RETAIL_SALES | Yes | monthly | 113 | 2017-01-01 | 2026-05-01 | 90 | 75 | STALE |
| STATCAN | CAD_TRADE_BY_INDUSTRY | Yes | monthly | 293 | 2002-01-01 | 2026-05-01 | 90 | 75 | STALE |
| STATCAN | CAD_UNEMPLOYMENT_RATE | Yes | monthly | 606 | 1976-01-01 | 2026-06-01 | 59 | 75 | CURRENT |

## Next analysis step

Classify each non-current active indicator as a likely provider delay, discontinued/replaced asset, ingestion failure, target-load gap, configuration issue, missing table, or no-data condition. Phase 16.3 will replace the frequency-only result with source- and asset-aware reason codes.

