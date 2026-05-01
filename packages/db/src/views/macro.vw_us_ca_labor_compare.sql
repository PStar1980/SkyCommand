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
