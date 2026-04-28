CREATE OR REPLACE VIEW macro.vw_labor AS
WITH base AS (
    SELECT
        u.edate date,

        pay.value AS payrolls,
        u.value   AS unemployment_rate,
        u6.value  AS underemployment_rate,
        emp.value AS employment_ratio

    FROM macro."UNRATE" u
    LEFT JOIN macro."PAYEMS"  pay ON u.edate = pay.edate
    LEFT JOIN macro."U6RATE"  u6  ON u.edate = u6.edate
    LEFT JOIN macro."EMRATIO" emp ON u.edate = emp.edate
),
calc AS (
    SELECT
        *,

        -- Labor slack
        (underemployment_rate - unemployment_rate) AS labor_slack,

        -- Unemployment trend
        (unemployment_rate - LAG(unemployment_rate, 3) OVER (ORDER BY date)) AS unrate_3m_change,

        -- Payroll momentum
        (payrolls - LAG(payrolls, 1) OVER (ORDER BY date)) AS payroll_change,

        -- Sahm Rule signal
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