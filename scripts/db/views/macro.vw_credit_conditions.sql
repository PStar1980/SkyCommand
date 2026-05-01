CREATE OR REPLACE VIEW macro.vw_credit_conditions AS
WITH base AS (
    SELECT
        nfci.edate date,

        nfci.value    AS financial_conditions,
        lev.value     AS leverage,
        nonfin.value  AS nonfinancial_leverage,
        risk.value    AS risk_stress

    FROM macro."NFCI" nfci
    LEFT JOIN macro."NFCILEVERAGE" lev ON nfci.edate = lev.edate
    LEFT JOIN macro."NFCINONFINLEVERAGE" nonfin ON nfci.edate = nonfin.edate
    LEFT JOIN macro."NFCIRISK" risk ON nfci.edate = risk.edate
),
calc AS (
    SELECT
        *,

        -- Combined stress
        (financial_conditions + risk_stress) AS total_stress,

        -- Trend
        (financial_conditions - LAG(financial_conditions, 1) OVER (ORDER BY date)) AS nfci_change,

        -- Risk spike
        (risk_stress - LAG(risk_stress, 3) OVER (ORDER BY date)) AS risk_3m_spike,

        -- Normalized stress (z-score)
        (
            (financial_conditions - AVG(financial_conditions) OVER ())
            / NULLIF(STDDEV(financial_conditions) OVER (), 0)
        ) AS nfci_zscore

    FROM base
)
SELECT *
FROM calc
ORDER BY date DESC;