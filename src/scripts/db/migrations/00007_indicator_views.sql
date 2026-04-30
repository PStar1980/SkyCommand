-- macro.vw_credit_conditions source
CREATE OR REPLACE VIEW macro.vw_credit_conditions
AS WITH base AS (
         SELECT nfci.edate AS date,
            nfci.value AS financial_conditions,
            lev.value AS leverage,
            nonfin.value AS nonfinancial_leverage,
            risk.value AS risk_stress
           FROM macro."NFCI" nfci
             LEFT JOIN macro."NFCILEVERAGE" lev ON nfci.edate = lev.edate
             LEFT JOIN macro."NFCINONFINLEVERAGE" nonfin ON nfci.edate = nonfin.edate
             LEFT JOIN macro."NFCIRISK" risk ON nfci.edate = risk.edate
        ), calc AS (
         SELECT base.date,
            base.financial_conditions,
            base.leverage,
            base.nonfinancial_leverage,
            base.risk_stress,
            base.financial_conditions + base.risk_stress AS total_stress,
            base.financial_conditions - lag(base.financial_conditions, 1) OVER (ORDER BY base.date) AS nfci_change,
            base.risk_stress - lag(base.risk_stress, 3) OVER (ORDER BY base.date) AS risk_3m_spike,
            (base.financial_conditions - avg(base.financial_conditions) OVER ()) / NULLIF(stddev(base.financial_conditions) OVER (), 0::numeric) AS nfci_zscore
           FROM base
        )
 SELECT date,
    financial_conditions,
    leverage,
    nonfinancial_leverage,
    risk_stress,
    total_stress,
    nfci_change,
    risk_3m_spike,
    nfci_zscore
   FROM calc
  ORDER BY date DESC;

-- macro.vw_growth source
CREATE OR REPLACE VIEW macro.vw_growth
AS WITH base AS (
         SELECT gdp.edate AS date,
            gdp.value AS gdp_nominal,
            gdpc1.value AS gdp_real,
            ind.value AS industrial_production
           FROM macro."GDP" gdp
             LEFT JOIN macro."GDPC1" gdpc1 ON gdp.edate = gdpc1.edate
             LEFT JOIN macro."INDPRO" ind ON gdp.edate = ind.edate
        ), calc AS (
         SELECT base.date,
            base.gdp_nominal,
            base.gdp_real,
            base.industrial_production,
            (base.gdp_real / lag(base.gdp_real, 4) OVER (ORDER BY base.date) - 1::numeric) * 100::numeric AS gdp_real_yoy,
            base.industrial_production - lag(base.industrial_production, 3) OVER (ORDER BY base.date) AS ind_3m_change,
            base.gdp_real - lag(base.gdp_real, 1) OVER (ORDER BY base.date) - (lag(base.gdp_real, 1) OVER (ORDER BY base.date) - lag(base.gdp_real, 2) OVER (ORDER BY base.date)) AS gdp_acceleration
           FROM base
        )
 SELECT date,
    gdp_nominal,
    gdp_real,
    industrial_production,
    gdp_real_yoy,
    ind_3m_change,
    gdp_acceleration
   FROM calc
  ORDER BY date DESC;

-- macro.vw_housing source
CREATE OR REPLACE VIEW macro.vw_housing
AS WITH base AS (
         SELECT h.edate AS date,
            h.value AS housing_starts,
            p.value AS building_permits
           FROM macro."HOUST" h
             LEFT JOIN macro."PERMIT" p ON h.edate = p.edate
        ), calc AS (
         SELECT base.date,
            base.housing_starts,
            base.building_permits,
            base.housing_starts - lag(base.housing_starts, 3) OVER (ORDER BY base.date) AS housing_3m_change,
            base.building_permits - lag(base.building_permits, 3) OVER (ORDER BY base.date) AS permit_3m_change,
            base.building_permits / NULLIF(base.housing_starts, 0::numeric) AS permit_to_start_ratio,
            base.building_permits - base.housing_starts AS housing_momentum
           FROM base
        )
 SELECT date,
    housing_starts,
    building_permits,
    housing_3m_change,
    permit_3m_change,
    permit_to_start_ratio,
    housing_momentum
   FROM calc
  ORDER BY date DESC;

-- macro.vw_inflation source
CREATE OR REPLACE VIEW macro.vw_inflation
AS WITH base AS (
         SELECT cpi.edate,
            cpi.value AS cpi_headline,
            cpilfesl.value AS cpi_core,
            pce.value AS pce_headline,
            pcepilfe.value AS pce_core
           FROM macro."CPIAUCSL" cpi
             LEFT JOIN macro."CPILFESL" cpilfesl ON cpi.edate = cpilfesl.edate
             LEFT JOIN macro."PCE" pce ON cpi.edate = pce.edate
             LEFT JOIN macro."PCEPILFE" pcepilfe ON cpi.edate = pcepilfe.edate
        ), calc AS (
         SELECT base.edate,
            base.cpi_headline,
            base.cpi_core,
            base.pce_headline,
            base.pce_core,
            (base.cpi_headline / lag(base.cpi_headline, 12) OVER (ORDER BY base.edate) - 1::numeric) * 100::numeric AS cpi_yoy,
            (base.cpi_core / lag(base.cpi_core, 12) OVER (ORDER BY base.edate) - 1::numeric) * 100::numeric AS cpi_core_yoy,
            (base.pce_headline / lag(base.pce_headline, 12) OVER (ORDER BY base.edate) - 1::numeric) * 100::numeric AS pce_yoy,
            (base.pce_core / lag(base.pce_core, 12) OVER (ORDER BY base.edate) - 1::numeric) * 100::numeric AS pce_core_yoy
           FROM base
        )
 SELECT edate AS date,
    cpi_headline,
    round(cpi_yoy, 2) AS cpi_yoy,
    cpi_core,
    round(cpi_core_yoy, 2) AS cpi_core_yoy,
    cpi_core - cpi_headline AS cpi_spread,
    pce_headline,
    round(pce_yoy, 2) AS pce_yoy,
    pce_core,
    round(pce_core_yoy, 2) AS pce_core_yoy,
    cpi_headline - pce_headline AS cpi_pce_spread
   FROM calc
  ORDER BY edate DESC;

-- macro.vw_labor source
CREATE OR REPLACE VIEW macro.vw_labor
AS WITH base AS (
         SELECT u.edate AS date,
            pay.value AS payrolls,
            u.value AS unemployment_rate,
            u6.value AS underemployment_rate,
            emp.value AS employment_ratio
           FROM macro."UNRATE" u
             LEFT JOIN macro."PAYEMS" pay ON u.edate = pay.edate
             LEFT JOIN macro."U6RATE" u6 ON u.edate = u6.edate
             LEFT JOIN macro."EMRATIO" emp ON u.edate = emp.edate
        ), calc AS (
         SELECT base.date,
            base.payrolls,
            base.unemployment_rate,
            base.underemployment_rate,
            base.employment_ratio,
            base.underemployment_rate - base.unemployment_rate AS labor_slack,
            base.unemployment_rate - lag(base.unemployment_rate, 3) OVER (ORDER BY base.date) AS unrate_3m_change,
            base.payrolls - lag(base.payrolls, 1) OVER (ORDER BY base.date) AS payroll_change,
            base.unemployment_rate - min(base.unemployment_rate) OVER (ORDER BY base.date ROWS BETWEEN 12 PRECEDING AND CURRENT ROW) AS sahm_rule_signal
           FROM base
        )
 SELECT date,
    payrolls,
    unemployment_rate,
    underemployment_rate,
    employment_ratio,
    labor_slack,
    unrate_3m_change,
    payroll_change,
    sahm_rule_signal
   FROM calc
  ORDER BY date DESC;

-- macro.vw_liquidity source
CREATE OR REPLACE VIEW macro.vw_liquidity
AS WITH base AS (
         SELECT m2.edate AS date,
            m1.value AS m1,
            m2.value AS m2
           FROM macro."M2SL" m2
             LEFT JOIN macro."M1SL" m1 ON m2.edate = m1.edate
        ), calc AS (
         SELECT base.date,
            base.m1,
            base.m2,
            base.m2 - base.m1 AS liquidity_gap,
            (base.m2 / lag(base.m2, 12) OVER (ORDER BY base.date) - 1::numeric) * 100::numeric AS m2_yoy,
            (base.m1 / lag(base.m1, 12) OVER (ORDER BY base.date) - 1::numeric) * 100::numeric AS m1_yoy,
            base.m2 - lag(base.m2, 3) OVER (ORDER BY base.date) AS m2_3m_change,
                CASE
                    WHEN (base.m2 - lag(base.m2, 3) OVER (ORDER BY base.date)) > 0::numeric THEN 'EXPANDING'::text
                    ELSE 'CONTRACTING'::text
                END AS liquidity_regime
           FROM base
        )
 SELECT date,
    m1,
    m2,
    liquidity_gap,
    m2_yoy,
    m1_yoy,
    m2_3m_change,
    liquidity_regime
   FROM calc
  ORDER BY date DESC;

-- macro.vw_rates_curve source
CREATE OR REPLACE VIEW macro.vw_rates_curve
AS SELECT dgs10.edate AS date,
    dgs3mo.value AS yield_3m,
    dgs2.value AS yield_2y,
    dgs3.value AS yield_3y,
    dgs5.value AS yield_5y,
    dgs7.value AS yield_7y,
    dgs10.value AS yield_10y,
    dgs10.value - dgs3mo.value AS spread_10y_3m,
    dgs10.value - dgs2.value AS spread_10y_2y,
    dgs10.value - dgs3.value AS spread_10y_3y,
    aaa.value AS corp_yield_aaa,
    bbb.value AS corp_yield_bbb,
    bbb.value - aaa.value AS spread_bbb_aaa,
    fed.value AS fed_funds,
    lower.value AS fed_lower,
    upper.value AS fed_upper,
    dgs10.value - fed.value AS spread_10y_ff
   FROM macro."DGS10" dgs10
     LEFT JOIN macro."DGS3MO" dgs3mo ON dgs10.edate = dgs3mo.edate
     LEFT JOIN macro."DGS2" dgs2 ON dgs10.edate = dgs2.edate
     LEFT JOIN macro."DGS3" dgs3 ON dgs10.edate = dgs3.edate
     LEFT JOIN macro."DGS5" dgs5 ON dgs10.edate = dgs5.edate
     LEFT JOIN macro."DGS7" dgs7 ON dgs10.edate = dgs7.edate
     LEFT JOIN macro."BAMLC0A1CAAA" aaa ON dgs10.edate = aaa.edate
     LEFT JOIN macro."BAMLC0A4CBBBEY" bbb ON dgs10.edate = bbb.edate
     LEFT JOIN macro."DFF" fed ON dgs10.edate = fed.edate
     LEFT JOIN macro."DFEDTARL" lower ON dgs10.edate = lower.edate
     LEFT JOIN macro."DFEDTARU" upper ON dgs10.edate = upper.edate
  ORDER BY dgs10.edate DESC;

