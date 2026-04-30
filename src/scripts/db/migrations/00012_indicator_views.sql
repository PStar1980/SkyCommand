CREATE OR REPLACE VIEW macro.vw_ca_inflation AS
WITH base AS (
    SELECT
        cpi.edate AS date,

        cpi.value     AS cpi_all_items,
        cpi_yoy.value AS cpi_yoy,

        nhpi.value     AS new_housing_price_index,
        nhpi_mom.value AS nhpi_mom

    FROM macro."CAD_CPI_ALL_ITEMS" cpi
    LEFT JOIN macro."CAD_CPI_YOY" cpi_yoy
        ON cpi.edate = cpi_yoy.edate
    LEFT JOIN macro."CAD_NEW_HOUSING_PRICE_INDEX" nhpi
        ON cpi.edate = nhpi.edate
    LEFT JOIN macro."CAD_NHPI_MOM" nhpi_mom
        ON cpi.edate = nhpi_mom.edate
),
calc AS (
    SELECT
        *,

        -- CPI momentum
        (cpi_all_items / NULLIF(LAG(cpi_all_items, 1) OVER (ORDER BY date), 0) - 1) * 100 AS cpi_mom_calc,
        (cpi_all_items / NULLIF(LAG(cpi_all_items, 12) OVER (ORDER BY date), 0) - 1) * 100 AS cpi_yoy_calc,

        -- 3-month annualized CPI momentum
        (
            POWER(
                cpi_all_items / NULLIF(LAG(cpi_all_items, 3) OVER (ORDER BY date), 0),
                4
            ) - 1
        ) * 100 AS cpi_3m_annualized,

        -- Housing price inflation
        (new_housing_price_index / NULLIF(LAG(new_housing_price_index, 12) OVER (ORDER BY date), 0) - 1) * 100 AS nhpi_yoy,

        -- Spread between CPI inflation and housing price inflation
        (
            cpi_yoy -
            ((new_housing_price_index / NULLIF(LAG(new_housing_price_index, 12) OVER (ORDER BY date), 0) - 1) * 100)
        ) AS cpi_nhpi_yoy_spread

    FROM base
)
SELECT
    date,

    cpi_all_items,
    ROUND(cpi_yoy, 2) AS cpi_yoy,
    ROUND(cpi_yoy_calc, 2) AS cpi_yoy_calc,
    ROUND(cpi_mom_calc, 2) AS cpi_mom_calc,
    ROUND(cpi_3m_annualized, 2) AS cpi_3m_annualized,

    new_housing_price_index,
    ROUND(nhpi_mom, 2) AS nhpi_mom,
    ROUND(nhpi_yoy, 2) AS nhpi_yoy,
    ROUND(cpi_nhpi_yoy_spread, 2) AS cpi_nhpi_yoy_spread

FROM calc
ORDER BY date DESC;

CREATE OR REPLACE VIEW macro.vw_ca_growth AS
WITH base AS (
    SELECT
        gdp.edate AS date,

        gdp.value     AS real_gdp_monthly,
        gdp_mom.value AS real_gdp_mom_growth,

        retail.value  AS retail_sales,
        imports.value AS imports_total,
        trade.value   AS trade_by_industry

    FROM macro."CAD_REAL_GDP_MONTHLY" gdp
    LEFT JOIN macro."CAD_GDP_MOM_GROWTH" gdp_mom
        ON gdp.edate = gdp_mom.edate
    LEFT JOIN macro."CAD_RETAIL_SALES" retail
        ON gdp.edate = retail.edate
    LEFT JOIN macro."CAD_IMPORTS" imports
        ON gdp.edate = imports.edate
    LEFT JOIN macro."CAD_TRADE_BY_INDUSTRY" trade
        ON gdp.edate = trade.edate
),
calc AS (
    SELECT
        *,

        -- GDP trend
        (real_gdp_monthly / NULLIF(LAG(real_gdp_monthly, 12) OVER (ORDER BY date), 0) - 1) * 100 AS real_gdp_yoy,
        (real_gdp_monthly - LAG(real_gdp_monthly, 3) OVER (ORDER BY date)) AS real_gdp_3m_change,

        -- GDP acceleration from existing MoM series
        (
            real_gdp_mom_growth -
            LAG(real_gdp_mom_growth, 1) OVER (ORDER BY date)
        ) AS real_gdp_mom_acceleration,

        -- Consumer demand
        (retail_sales / NULLIF(LAG(retail_sales, 12) OVER (ORDER BY date), 0) - 1) * 100 AS retail_sales_yoy,
        (retail_sales - LAG(retail_sales, 3) OVER (ORDER BY date)) AS retail_sales_3m_change,

        -- Trade-linked growth signals
        (imports_total / NULLIF(LAG(imports_total, 12) OVER (ORDER BY date), 0) - 1) * 100 AS imports_yoy,
        (trade_by_industry / NULLIF(LAG(trade_by_industry, 12) OVER (ORDER BY date), 0) - 1) * 100 AS trade_by_industry_yoy

    FROM base
)
SELECT
    date,

    real_gdp_monthly,
    ROUND(real_gdp_mom_growth, 4) AS real_gdp_mom_growth,
    ROUND(real_gdp_yoy, 2) AS real_gdp_yoy,
    real_gdp_3m_change,
    ROUND(real_gdp_mom_acceleration, 4) AS real_gdp_mom_acceleration,

    retail_sales,
    ROUND(retail_sales_yoy, 2) AS retail_sales_yoy,
    retail_sales_3m_change,

    imports_total,
    ROUND(imports_yoy, 2) AS imports_yoy,

    trade_by_industry,
    ROUND(trade_by_industry_yoy, 2) AS trade_by_industry_yoy

FROM calc
ORDER BY date DESC;

CREATE OR REPLACE VIEW macro.vw_ca_labor AS
WITH base AS (
    SELECT
        u.edate AS date,

        emp.value  AS employment,
        u.value    AS unemployment_rate,
        part.value AS participation_rate

    FROM macro."CAD_UNEMPLOYMENT_RATE" u
    LEFT JOIN macro."CAD_EMPLOYMENT" emp
        ON u.edate = emp.edate
    LEFT JOIN macro."CAD_PARTICIPATION_RATE" part
        ON u.edate = part.edate
),
calc AS (
    SELECT
        *,

        -- Employment momentum
        (employment - LAG(employment, 1) OVER (ORDER BY date)) AS employment_mom_change,
        (employment - LAG(employment, 12) OVER (ORDER BY date)) AS employment_yoy_change,

        -- Unemployment trend
        (unemployment_rate - LAG(unemployment_rate, 3) OVER (ORDER BY date)) AS unrate_3m_change,

        -- Participation trend
        (participation_rate - LAG(participation_rate, 3) OVER (ORDER BY date)) AS participation_3m_change,

        -- Sahm-style unemployment stress signal
        (
            unemployment_rate -
            MIN(unemployment_rate) OVER (
                ORDER BY date
                ROWS BETWEEN 12 PRECEDING AND CURRENT ROW
            )
        ) AS sahm_rule_signal

    FROM base
)
SELECT *
FROM calc
ORDER BY date DESC;

CREATE OR REPLACE VIEW macro.vw_ca_housing AS
WITH base AS (
    SELECT
        nhpi.edate AS date,

        nhpi.value     AS new_housing_price_index,
        nhpi_mom.value AS nhpi_mom,
        permits.value  AS building_permits

    FROM macro."CAD_NEW_HOUSING_PRICE_INDEX" nhpi
    LEFT JOIN macro."CAD_NHPI_MOM" nhpi_mom
        ON nhpi.edate = nhpi_mom.edate
    LEFT JOIN macro."CAD_BUILDING_PERMITS" permits
        ON nhpi.edate = permits.edate
),
calc AS (
    SELECT
        *,

        -- Housing price trend
        (new_housing_price_index / NULLIF(LAG(new_housing_price_index, 12) OVER (ORDER BY date), 0) - 1) * 100 AS nhpi_yoy,

        -- Permit momentum
        (building_permits - LAG(building_permits, 3) OVER (ORDER BY date)) AS building_permits_3m_change,
        (building_permits / NULLIF(LAG(building_permits, 12) OVER (ORDER BY date), 0) - 1) * 100 AS building_permits_yoy,

        -- Housing demand/price pressure proxy
        (
            (building_permits / NULLIF(LAG(building_permits, 12) OVER (ORDER BY date), 0) - 1) * 100
            -
            (new_housing_price_index / NULLIF(LAG(new_housing_price_index, 12) OVER (ORDER BY date), 0) - 1) * 100
        ) AS permit_price_momentum_spread

    FROM base
)
SELECT
    date,

    new_housing_price_index,
    ROUND(nhpi_mom, 2) AS nhpi_mom,
    ROUND(nhpi_yoy, 2) AS nhpi_yoy,

    building_permits,
    building_permits_3m_change,
    ROUND(building_permits_yoy, 2) AS building_permits_yoy,
    ROUND(permit_price_momentum_spread, 2) AS permit_price_momentum_spread

FROM calc
ORDER BY date DESC;

CREATE OR REPLACE VIEW macro.vw_ca_trade AS
WITH base AS (
    SELECT
        imports.edate AS date,

        imports.value AS imports_total,
        trade.value   AS exports_total

    FROM macro."CAD_IMPORTS" imports
    LEFT JOIN macro."CAD_TRADE_BY_INDUSTRY" trade
        ON imports.edate = trade.edate
),
calc AS (
    SELECT
        *,

        -- YoY trade growth
        (imports_total / NULLIF(LAG(imports_total, 12) OVER (ORDER BY date), 0) - 1) * 100 AS imports_yoy,
        (exports_total / NULLIF(LAG(exports_total, 12) OVER (ORDER BY date), 0) - 1) * 100 AS exports_yoy,

        -- Short-term momentum
        (imports_total - LAG(imports_total, 3) OVER (ORDER BY date)) AS imports_3m_change,
        (exports_total - LAG(exports_total, 3) OVER (ORDER BY date)) AS exports_3m_change,

        -- Simple net trade proxy
        (exports_total - imports_total) AS net_trade_proxy,

        -- Total trade activity
        (exports_total + imports_total) AS total_trade_activity

    FROM base
)
SELECT
    date,

    imports_total,
    ROUND(imports_yoy, 2) AS imports_yoy,
    imports_3m_change,

    exports_total,
    ROUND(exports_yoy, 2) AS exports_yoy,
    exports_3m_change,

    net_trade_proxy,
    total_trade_activity

FROM calc
ORDER BY date DESC;

CREATE OR REPLACE VIEW macro.vw_ca_rates_fx AS
WITH base AS (
    SELECT
        rate.edate AS date,

        rate.value AS boc_overnight_rate,
        fx.value   AS usd_cad

    FROM macro."V39079" rate
    LEFT JOIN macro."FXUSDCAD" fx
        ON rate.edate = fx.edate
),
calc AS (
    SELECT
        *,

        -- Rate movement
        (boc_overnight_rate - LAG(boc_overnight_rate, 1) OVER (ORDER BY date)) AS overnight_1d_change,
        (boc_overnight_rate - LAG(boc_overnight_rate, 30) OVER (ORDER BY date)) AS overnight_30d_change,

        -- FX movement
        (usd_cad / NULLIF(LAG(usd_cad, 1) OVER (ORDER BY date), 0) - 1) * 100 AS usd_cad_1d_pct,
        (usd_cad / NULLIF(LAG(usd_cad, 30) OVER (ORDER BY date), 0) - 1) * 100 AS usd_cad_30d_pct,

        -- CAD strength proxy: higher means stronger CAD versus USD
        (1 / NULLIF(usd_cad, 0)) AS cad_usd_proxy

    FROM base
)
SELECT
    date,

    boc_overnight_rate,
    overnight_1d_change,
    overnight_30d_change,

    usd_cad,
    ROUND(usd_cad_1d_pct, 4) AS usd_cad_1d_pct,
    ROUND(usd_cad_30d_pct, 4) AS usd_cad_30d_pct,
    cad_usd_proxy

FROM calc
ORDER BY date DESC;

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

