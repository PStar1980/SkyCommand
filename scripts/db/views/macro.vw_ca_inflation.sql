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
