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