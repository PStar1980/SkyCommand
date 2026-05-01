CREATE OR REPLACE VIEW macro.vw_inflation AS
WITH base AS (
    SELECT
        cpi.edate,

        cpi.value      AS cpi_headline,
        cpilfesl.value AS cpi_core,

        pce.value      AS pce_headline,
        pcepilfe.value AS pce_core

    FROM macro."CPIAUCSL" cpi
    LEFT JOIN macro."CPILFESL" cpilfesl ON cpi.edate = cpilfesl.edate
    LEFT JOIN macro."PCE" pce           ON cpi.edate = pce.edate
    LEFT JOIN macro."PCEPILFE" pcepilfe ON cpi.edate = pcepilfe.edate
),

calc AS (
    SELECT
        *,
        (cpi_headline / LAG(cpi_headline, 12) OVER (ORDER BY edate) - 1) * 100 AS cpi_yoy,
        (cpi_core     / LAG(cpi_core, 12)     OVER (ORDER BY edate) - 1) * 100 AS cpi_core_yoy,

        (pce_headline / LAG(pce_headline, 12) OVER (ORDER BY edate) - 1) * 100 AS pce_yoy,
        (pce_core     / LAG(pce_core, 12)     OVER (ORDER BY edate) - 1) * 100 AS pce_core_yoy
    FROM base
)

SELECT
    edate AS date,

    cpi_headline,
    ROUND(cpi_yoy, 2)      AS cpi_yoy,
    cpi_core,
    ROUND(cpi_core_yoy, 2) AS cpi_core_yoy,

    (cpi_core - cpi_headline) AS cpi_spread,

    pce_headline,
    ROUND(pce_yoy, 2)      AS pce_yoy,
    pce_core,
    ROUND(pce_core_yoy, 2) AS pce_core_yoy,

    (cpi_headline - pce_headline) AS cpi_pce_spread

FROM calc
ORDER BY edate DESC;