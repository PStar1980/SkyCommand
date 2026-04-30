-- ============================================================
-- US / Canada Macro Comparison Views
-- ============================================================


-- ============================================================
-- View: macro.vw_us_ca_policy_fx
-- Purpose:
--   Compare US Fed policy rate, BoC overnight rate, and USD/CAD.
--   Useful for policy divergence + FX visualization.
-- ============================================================

CREATE OR REPLACE VIEW macro.vw_us_ca_policy_fx AS
WITH base AS (
    SELECT
        COALESCE(ca.date, us.date) AS date,

        us.fed_funds,
        ca.boc_overnight_rate,

        ca.usd_cad,
        ca.usd_cad_1d_pct,
        ca.usd_cad_30d_pct,
        ca.cad_usd_proxy

    FROM macro.vw_ca_rates_fx ca
    FULL OUTER JOIN macro.vw_rates_curve us
        ON ca.date = us.date
),
calc AS (
    SELECT
        *,

        -- Canada minus US policy rate spread.
        -- Positive = BoC policy rate above Fed funds.
        (boc_overnight_rate - fed_funds) AS policy_spread_ca_minus_us,

        -- US minus Canada policy rate spread.
        -- Positive = Fed funds above BoC policy rate.
        (fed_funds - boc_overnight_rate) AS policy_spread_us_minus_ca,

        -- Change in cross-border policy spread.
        (
            (boc_overnight_rate - fed_funds)
            - LAG(boc_overnight_rate - fed_funds, 30) OVER (ORDER BY date)
        ) AS policy_spread_30d_change,

        CASE
            WHEN (boc_overnight_rate - fed_funds) > 0.50 THEN 'BOC_ABOVE_FED'
            WHEN (boc_overnight_rate - fed_funds) < -0.50 THEN 'FED_ABOVE_BOC'
            ELSE 'ROUGHLY_ALIGNED'
        END AS policy_alignment_regime,

        CASE
            WHEN usd_cad_30d_pct > 2 THEN 'CAD_WEAKENING'
            WHEN usd_cad_30d_pct < -2 THEN 'CAD_STRENGTHENING'
            ELSE 'RANGE_BOUND'
        END AS fx_regime

    FROM base
)
SELECT
    date,

    fed_funds,
    boc_overnight_rate,

    policy_spread_ca_minus_us,
    policy_spread_us_minus_ca,
    policy_spread_30d_change,
    policy_alignment_regime,

    usd_cad,
    ROUND(usd_cad_1d_pct, 4) AS usd_cad_1d_pct,
    ROUND(usd_cad_30d_pct, 4) AS usd_cad_30d_pct,
    cad_usd_proxy,
    fx_regime

FROM calc
ORDER BY date DESC;

ALTER VIEW macro.vw_us_ca_policy_fx OWNER TO postgres;


-- ============================================================
-- View: macro.vw_us_ca_inflation_compare
-- Purpose:
--   Compare US and Canadian inflation trends.
-- ============================================================

CREATE OR REPLACE VIEW macro.vw_us_ca_inflation_compare AS
WITH base AS (
    SELECT
        COALESCE(ca.date, us.date) AS date,

        -- US inflation
        us.cpi_headline AS us_cpi_headline,
        us.cpi_yoy AS us_cpi_yoy,
        us.cpi_core AS us_cpi_core,
        us.cpi_core_yoy AS us_cpi_core_yoy,
        us.pce_headline AS us_pce_headline,
        us.pce_yoy AS us_pce_yoy,
        us.pce_core AS us_pce_core,
        us.pce_core_yoy AS us_pce_core_yoy,

        -- Canada inflation
        ca.cpi_all_items AS ca_cpi_all_items,
        ca.cpi_yoy AS ca_cpi_yoy,
        ca.cpi_yoy_calc AS ca_cpi_yoy_calc,
        ca.cpi_mom_calc AS ca_cpi_mom_calc,
        ca.cpi_3m_annualized AS ca_cpi_3m_annualized,
        ca.new_housing_price_index AS ca_new_housing_price_index,
        ca.nhpi_mom AS ca_nhpi_mom,
        ca.nhpi_yoy AS ca_nhpi_yoy

    FROM macro.vw_ca_inflation ca
    FULL OUTER JOIN macro.vw_inflation us
        ON ca.date = us.date
),
calc AS (
    SELECT
        *,

        -- Canada minus US inflation spread.
        (ca_cpi_yoy - us_cpi_yoy) AS cpi_yoy_spread_ca_minus_us,

        -- Canada CPI minus US Core CPI.
        (ca_cpi_yoy - us_cpi_core_yoy) AS ca_cpi_vs_us_core_spread,

        -- US Core CPI minus Canada headline CPI.
        (us_cpi_core_yoy - ca_cpi_yoy) AS us_core_vs_ca_cpi_spread,

        -- Canada CPI 3M annualized minus US CPI YoY.
        (ca_cpi_3m_annualized - us_cpi_yoy) AS ca_3m_momentum_vs_us_yoy_spread,

        CASE
            WHEN (ca_cpi_yoy - us_cpi_yoy) > 1 THEN 'CANADA_HOTTER'
            WHEN (ca_cpi_yoy - us_cpi_yoy) < -1 THEN 'US_HOTTER'
            ELSE 'SIMILAR'
        END AS inflation_divergence_regime

    FROM base
)
SELECT
    date,

    us_cpi_headline,
    us_cpi_yoy,
    us_cpi_core,
    us_cpi_core_yoy,
    us_pce_headline,
    us_pce_yoy,
    us_pce_core,
    us_pce_core_yoy,

    ca_cpi_all_items,
    ca_cpi_yoy,
    ca_cpi_yoy_calc,
    ca_cpi_mom_calc,
    ca_cpi_3m_annualized,

    ca_new_housing_price_index,
    ca_nhpi_mom,
    ca_nhpi_yoy,

    ROUND(cpi_yoy_spread_ca_minus_us, 2) AS cpi_yoy_spread_ca_minus_us,
    ROUND(ca_cpi_vs_us_core_spread, 2) AS ca_cpi_vs_us_core_spread,
    ROUND(us_core_vs_ca_cpi_spread, 2) AS us_core_vs_ca_cpi_spread,
    ROUND(ca_3m_momentum_vs_us_yoy_spread, 2) AS ca_3m_momentum_vs_us_yoy_spread,

    inflation_divergence_regime

FROM calc
ORDER BY date DESC;

ALTER VIEW macro.vw_us_ca_inflation_compare OWNER TO postgres;


-- ============================================================
-- View: macro.vw_us_ca_labor_compare
-- Purpose:
--   Compare US and Canadian labor-market stress and participation.
-- ============================================================

CREATE OR REPLACE VIEW macro.vw_us_ca_labor_compare AS
WITH us AS (
    SELECT
        l.date,

        l.payrolls AS us_payrolls,
        l.payroll_change AS us_payroll_change,
        l.unemployment_rate AS us_unemployment_rate,
        l.underemployment_rate AS us_underemployment_rate,
        l.labor_slack AS us_labor_slack,
        l.unrate_3m_change AS us_unrate_3m_change,
        l.sahm_rule_signal AS us_sahm_rule_signal,
        l.employment_ratio AS us_employment_population_ratio,
        civ.value AS us_participation_rate

    FROM macro.vw_labor l
    LEFT JOIN macro."CIVPART" civ
        ON l.date = civ.edate
),
ca AS (
    SELECT
        date,

        employment AS ca_employment,
        employment_mom_change AS ca_employment_mom_change,
        employment_yoy_change AS ca_employment_yoy_change,
        unemployment_rate AS ca_unemployment_rate,
        unrate_3m_change AS ca_unrate_3m_change,
        sahm_rule_signal AS ca_sahm_rule_signal,
        participation_rate AS ca_participation_rate,
        participation_3m_change AS ca_participation_3m_change

    FROM macro.vw_ca_labor
),
base AS (
    SELECT
        COALESCE(ca.date, us.date) AS date,

        us.us_payrolls,
        us.us_payroll_change,
        us.us_unemployment_rate,
        us.us_underemployment_rate,
        us.us_labor_slack,
        us.us_unrate_3m_change,
        us.us_sahm_rule_signal,
        us.us_employment_population_ratio,
        us.us_participation_rate,

        ca.ca_employment,
        ca.ca_employment_mom_change,
        ca.ca_employment_yoy_change,
        ca.ca_unemployment_rate,
        ca.ca_unrate_3m_change,
        ca.ca_sahm_rule_signal,
        ca.ca_participation_rate,
        ca.ca_participation_3m_change

    FROM ca
    FULL OUTER JOIN us
        ON ca.date = us.date
),
calc AS (
    SELECT
        *,

        -- Positive = Canadian unemployment above US unemployment.
        (ca_unemployment_rate - us_unemployment_rate) AS unemployment_spread_ca_minus_us,

        -- Positive = Canadian participation above US participation.
        (ca_participation_rate - us_participation_rate) AS participation_spread_ca_minus_us,

        -- Positive = Canadian Sahm-style stress above US stress.
        (ca_sahm_rule_signal - us_sahm_rule_signal) AS sahm_spread_ca_minus_us,

        CASE
            WHEN ca_sahm_rule_signal >= 0.5
                 AND us_sahm_rule_signal >= 0.5
            THEN 'BOTH_STRESSED'

            WHEN ca_sahm_rule_signal >= 0.5
                 AND COALESCE(us_sahm_rule_signal, 0) < 0.5
            THEN 'CANADA_STRESS_HIGHER'

            WHEN us_sahm_rule_signal >= 0.5
                 AND COALESCE(ca_sahm_rule_signal, 0) < 0.5
            THEN 'US_STRESS_HIGHER'

            WHEN ca_unrate_3m_change > 0.3
                 OR us_unrate_3m_change > 0.3
            THEN 'WATCHING_WEAKENING'

            ELSE 'STABLE'
        END AS labor_divergence_regime

    FROM base
)
SELECT
    date,

    us_payrolls,
    us_payroll_change,
    us_unemployment_rate,
    us_underemployment_rate,
    us_labor_slack,
    us_unrate_3m_change,
    us_sahm_rule_signal,
    us_employment_population_ratio,
    us_participation_rate,

    ca_employment,
    ca_employment_mom_change,
    ca_employment_yoy_change,
    ca_unemployment_rate,
    ca_unrate_3m_change,
    ca_sahm_rule_signal,
    ca_participation_rate,
    ca_participation_3m_change,

    ROUND(unemployment_spread_ca_minus_us, 2) AS unemployment_spread_ca_minus_us,
    ROUND(participation_spread_ca_minus_us, 2) AS participation_spread_ca_minus_us,
    ROUND(sahm_spread_ca_minus_us, 2) AS sahm_spread_ca_minus_us,

    labor_divergence_regime

FROM calc
ORDER BY date DESC;

ALTER VIEW macro.vw_us_ca_labor_compare OWNER TO postgres;