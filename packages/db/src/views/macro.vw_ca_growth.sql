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
