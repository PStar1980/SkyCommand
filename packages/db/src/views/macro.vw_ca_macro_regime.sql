CREATE OR REPLACE VIEW macro.vw_ca_macro_regime AS
WITH base AS (
    SELECT
        i.date,

        -- Inflation
        i.cpi_yoy,
        i.cpi_3m_annualized,
        i.nhpi_yoy,

        -- Growth
        g.real_gdp_mom_growth,
        g.real_gdp_yoy,
        g.real_gdp_mom_acceleration,
        g.retail_sales_yoy,

        -- Labor
        l.unemployment_rate,
        l.unrate_3m_change,
        l.sahm_rule_signal,
        l.participation_rate,

        -- Housing
        h.building_permits_yoy,
        h.building_permits_3m_change,

        -- Trade
        t.imports_yoy,
        t.exports_yoy,
        t.net_trade_proxy,

        -- Rates / FX
        r.boc_overnight_rate,
        r.overnight_30d_change,
        r.usd_cad,
        r.usd_cad_30d_pct

    FROM macro.vw_ca_inflation i
    LEFT JOIN macro.vw_ca_growth g
        ON i.date = g.date
    LEFT JOIN macro.vw_ca_labor l
        ON i.date = l.date
    LEFT JOIN macro.vw_ca_housing h
        ON i.date = h.date
    LEFT JOIN macro.vw_ca_trade t
        ON i.date = t.date
    LEFT JOIN LATERAL (
        SELECT *
        FROM macro.vw_ca_rates_fx rfx
        WHERE rfx.date <= i.date
        ORDER BY rfx.date DESC
        LIMIT 1
    ) r ON true
),
signals AS (
    SELECT
        *,

        -- Inflation regime
        CASE
            WHEN cpi_yoy > 3 THEN 'HIGH'
            WHEN cpi_yoy < 2 THEN 'LOW'
            ELSE 'MODERATE'
        END AS inflation_regime,

        -- Growth regime
        CASE
            WHEN real_gdp_yoy > 2 THEN 'STRONG'
            WHEN real_gdp_yoy < 0 THEN 'CONTRACTING'
            ELSE 'WEAK'
        END AS growth_regime,

        -- Labor regime
        CASE
            WHEN sahm_rule_signal >= 0.5 THEN 'RECESSION'
            WHEN unrate_3m_change > 0.3 THEN 'WEAKENING'
            ELSE 'STABLE'
        END AS labor_regime,

        -- Housing regime
        CASE
            WHEN building_permits_yoy < 0 AND nhpi_yoy < 0 THEN 'CONTRACTING'
            WHEN building_permits_3m_change < 0 THEN 'SOFTENING'
            ELSE 'STABLE'
        END AS housing_regime,

        -- Policy regime
        CASE
            WHEN overnight_30d_change > 0 THEN 'TIGHTENING'
            WHEN overnight_30d_change < 0 THEN 'EASING'
            ELSE 'STEADY'
        END AS policy_regime,

        -- FX regime
        CASE
            WHEN usd_cad_30d_pct > 2 THEN 'CAD_WEAKENING'
            WHEN usd_cad_30d_pct < -2 THEN 'CAD_STRENGTHENING'
            ELSE 'RANGE_BOUND'
        END AS fx_regime

    FROM base
),
final AS (
    SELECT
        *,

        CASE
            WHEN inflation_regime = 'HIGH'
                 AND policy_regime = 'TIGHTENING'
            THEN 'LATE_CYCLE'

            WHEN growth_regime = 'CONTRACTING'
                 AND labor_regime IN ('RECESSION', 'WEAKENING')
            THEN 'RECESSION'

            WHEN growth_regime = 'STRONG'
                 AND labor_regime = 'STABLE'
                 AND inflation_regime IN ('LOW', 'MODERATE')
            THEN 'EXPANSION'

            WHEN growth_regime = 'WEAK'
                 AND policy_regime = 'EASING'
            THEN 'SLOWDOWN_POLICY_SUPPORT'

            WHEN inflation_regime = 'HIGH'
                 AND growth_regime IN ('WEAK', 'CONTRACTING')
            THEN 'STAGFLATION_RISK'

            ELSE 'TRANSITION'
        END AS macro_regime

    FROM signals
)
SELECT *
FROM final
ORDER BY date DESC;