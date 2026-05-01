CREATE OR REPLACE VIEW macro.vw_liquidity AS
WITH base AS (
    SELECT
        m2.edate date,

        m1.value AS m1,
        m2.value AS m2

    FROM macro."M2SL" m2
    LEFT JOIN macro."M1SL" m1 ON m2.edate = m1.edate
),
calc AS (
    SELECT
        *,

        -- Gap
        (m2 - m1) AS liquidity_gap,

        -- YoY growth
        (m2 / LAG(m2, 12) OVER (ORDER BY date) - 1) * 100 AS m2_yoy,
        (m1 / LAG(m1, 12) OVER (ORDER BY date) - 1) * 100 AS m1_yoy,

        -- Short-term expansion
        (m2 - LAG(m2, 3) OVER (ORDER BY date)) AS m2_3m_change,

        -- Regime classification
        CASE
            WHEN (m2 - LAG(m2, 3) OVER (ORDER BY date)) > 0 THEN 'EXPANDING'
            ELSE 'CONTRACTING'
        END AS liquidity_regime

    FROM base
)
SELECT *
FROM calc
ORDER BY date DESC;