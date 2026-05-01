CREATE OR REPLACE VIEW macro.vw_growth AS
WITH base AS (
    SELECT
        gdp.edate date,

        gdp.value   AS gdp_nominal,
        gdpc1.value AS gdp_real,
        ind.value   AS industrial_production

    FROM macro."GDP" gdp
    LEFT JOIN macro."GDPC1" gdpc1 ON gdp.edate = gdpc1.edate
    LEFT JOIN macro."INDPRO" ind  ON gdp.edate = ind.edate
),
calc AS (
    SELECT
        *,

        -- Real GDP YoY
        (gdp_real / LAG(gdp_real, 4) OVER (ORDER BY date) - 1) * 100 AS gdp_real_yoy,

        -- Industrial momentum
        (industrial_production - LAG(industrial_production, 3) OVER (ORDER BY date)) AS ind_3m_change,

        -- Growth acceleration
        (
            (gdp_real - LAG(gdp_real, 1) OVER (ORDER BY date)) -
            (LAG(gdp_real, 1) OVER (ORDER BY date) - LAG(gdp_real, 2) OVER (ORDER BY date))
        ) AS gdp_acceleration

    FROM base
)
SELECT *
FROM calc
ORDER BY date DESC;