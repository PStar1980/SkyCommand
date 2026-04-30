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
