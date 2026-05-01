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
