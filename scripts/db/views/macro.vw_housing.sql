CREATE OR REPLACE VIEW macro.vw_housing AS
WITH base AS (
    SELECT
        h.edate date,

        h.value AS housing_starts,
        p.value AS building_permits

    FROM macro."HOUST" h
    LEFT JOIN macro."PERMIT" p ON h.edate = p.edate
),
calc AS (
    SELECT
        *,

        -- Momentum
        (housing_starts - LAG(housing_starts, 3) OVER (ORDER BY date)) AS housing_3m_change,
        (building_permits - LAG(building_permits, 3) OVER (ORDER BY date)) AS permit_3m_change,

        -- Forward demand signal
        (building_permits / NULLIF(housing_starts, 0)) AS permit_to_start_ratio,

        -- Net signal
        (building_permits - housing_starts) AS housing_momentum

    FROM base
)
SELECT *
FROM calc
ORDER BY date DESC;