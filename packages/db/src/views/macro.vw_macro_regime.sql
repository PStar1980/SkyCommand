CREATE OR REPLACE VIEW macro.vw_macro_regime AS
WITH base AS (
    SELECT
        i.date,

        -- Inflation
        i.cpi_yoy,
        i.cpi_core_yoy,

        -- Growth
        g.gdp_real_yoy,
        g.gdp_acceleration,

        -- Labor
        l.unemployment_rate,
        l.unrate_3m_change,
        l.sahm_rule_signal,

        -- Liquidity
        liq.m2_yoy,
        liq.m2_3m_change,
        liq.liquidity_regime,

        -- Rates
        r.yield_10y,
        r.spread_10y_2y

    FROM macro.vw_inflation i
    LEFT JOIN macro.vw_growth g     ON i.date = g.date
    LEFT JOIN macro.vw_labor l      ON i.date = l.date
    LEFT JOIN macro.vw_liquidity liq ON i.date = liq.date
    LEFT JOIN macro.vw_rates_curve r ON i.date = r.date
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
            WHEN gdp_real_yoy > 2 THEN 'STRONG'
            WHEN gdp_real_yoy < 0 THEN 'CONTRACTING'
            ELSE 'WEAK'
        END AS growth_regime,

        -- Liquidity regime (refined)
        CASE
            WHEN m2_3m_change > 0 THEN 'EXPANDING'
            ELSE 'TIGHTENING'
        END AS liquidity_signal,

        -- Labor stress
        CASE
            WHEN sahm_rule_signal >= 0.5 THEN 'RECESSION'
            WHEN unrate_3m_change > 0 THEN 'WEAKENING'
            ELSE 'STABLE'
        END AS labor_regime,

        -- Yield curve signal
        CASE
            WHEN spread_10y_2y < 0 THEN 'INVERTED'
            ELSE 'NORMAL'
        END AS curve_regime

    FROM base
),

final AS (
    SELECT
        *,

        -- 🔥 MASTER REGIME CLASSIFICATION
        CASE
            -- Inflation + tightening = late cycle
            WHEN inflation_regime = 'HIGH'
                 AND liquidity_signal = 'TIGHTENING'
            THEN 'LATE_CYCLE'

            -- Weak growth + rising unemployment
            WHEN growth_regime = 'CONTRACTING'
                 AND labor_regime IN ('RECESSION', 'WEAKENING')
            THEN 'RECESSION'

            -- Strong growth + expanding liquidity
            WHEN growth_regime = 'STRONG'
                 AND liquidity_signal = 'EXPANDING'
            THEN 'EXPANSION'

            -- Catch-all
            ELSE 'TRANSITION'
        END AS macro_regime

    FROM signals
)

SELECT *
FROM final
ORDER BY date DESC;