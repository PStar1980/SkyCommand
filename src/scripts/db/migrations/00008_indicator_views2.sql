-- macro.vw_macro_regime source
CREATE OR REPLACE VIEW macro.vw_macro_regime
AS WITH base AS (
         SELECT i.date,
            i.cpi_yoy,
            i.cpi_core_yoy,
            g.gdp_real_yoy,
            g.gdp_acceleration,
            l.unemployment_rate,
            l.unrate_3m_change,
            l.sahm_rule_signal,
            liq.m2_yoy,
            liq.m2_3m_change,
            liq.liquidity_regime,
            r.yield_10y,
            r.spread_10y_2y
           FROM macro.vw_inflation i
             LEFT JOIN macro.vw_growth g ON i.date = g.date
             LEFT JOIN macro.vw_labor l ON i.date = l.date
             LEFT JOIN macro.vw_liquidity liq ON i.date = liq.date
             LEFT JOIN macro.vw_rates_curve r ON i.date = r.date
        ), signals AS (
         SELECT base.date,
            base.cpi_yoy,
            base.cpi_core_yoy,
            base.gdp_real_yoy,
            base.gdp_acceleration,
            base.unemployment_rate,
            base.unrate_3m_change,
            base.sahm_rule_signal,
            base.m2_yoy,
            base.m2_3m_change,
            base.liquidity_regime,
            base.yield_10y,
            base.spread_10y_2y,
                CASE
                    WHEN base.cpi_yoy > 3::numeric THEN 'HIGH'::text
                    WHEN base.cpi_yoy < 2::numeric THEN 'LOW'::text
                    ELSE 'MODERATE'::text
                END AS inflation_regime,
                CASE
                    WHEN base.gdp_real_yoy > 2::numeric THEN 'STRONG'::text
                    WHEN base.gdp_real_yoy < 0::numeric THEN 'CONTRACTING'::text
                    ELSE 'WEAK'::text
                END AS growth_regime,
                CASE
                    WHEN base.m2_3m_change > 0::numeric THEN 'EXPANDING'::text
                    ELSE 'TIGHTENING'::text
                END AS liquidity_signal,
                CASE
                    WHEN base.sahm_rule_signal >= 0.5 THEN 'RECESSION'::text
                    WHEN base.unrate_3m_change > 0::numeric THEN 'WEAKENING'::text
                    ELSE 'STABLE'::text
                END AS labor_regime,
                CASE
                    WHEN base.spread_10y_2y < 0::numeric THEN 'INVERTED'::text
                    ELSE 'NORMAL'::text
                END AS curve_regime
           FROM base
        ), final AS (
         SELECT signals.date,
            signals.cpi_yoy,
            signals.cpi_core_yoy,
            signals.gdp_real_yoy,
            signals.gdp_acceleration,
            signals.unemployment_rate,
            signals.unrate_3m_change,
            signals.sahm_rule_signal,
            signals.m2_yoy,
            signals.m2_3m_change,
            signals.liquidity_regime,
            signals.yield_10y,
            signals.spread_10y_2y,
            signals.inflation_regime,
            signals.growth_regime,
            signals.liquidity_signal,
            signals.labor_regime,
            signals.curve_regime,
                CASE
                    WHEN signals.inflation_regime = 'HIGH'::text AND signals.liquidity_signal = 'TIGHTENING'::text THEN 'LATE_CYCLE'::text
                    WHEN signals.growth_regime = 'CONTRACTING'::text AND (signals.labor_regime = ANY (ARRAY['RECESSION'::text, 'WEAKENING'::text])) THEN 'RECESSION'::text
                    WHEN signals.growth_regime = 'STRONG'::text AND signals.liquidity_signal = 'EXPANDING'::text THEN 'EXPANSION'::text
                    ELSE 'TRANSITION'::text
                END AS macro_regime
           FROM signals
        )
 SELECT date,
    cpi_yoy,
    cpi_core_yoy,
    gdp_real_yoy,
    gdp_acceleration,
    unemployment_rate,
    unrate_3m_change,
    sahm_rule_signal,
    m2_yoy,
    m2_3m_change,
    liquidity_regime,
    yield_10y,
    spread_10y_2y,
    inflation_regime,
    growth_regime,
    liquidity_signal,
    labor_regime,
    curve_regime,
    macro_regime
   FROM final
  ORDER BY date DESC;
