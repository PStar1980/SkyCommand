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
