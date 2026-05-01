CREATE OR REPLACE VIEW macro.vw_ca_trade AS
WITH base AS (
    SELECT
        imports.edate AS date,

        imports.value AS imports_total,
        trade.value   AS exports_total

    FROM macro."CAD_IMPORTS" imports
    LEFT JOIN macro."CAD_TRADE_BY_INDUSTRY" trade
        ON imports.edate = trade.edate
),
calc AS (
    SELECT
        *,

        -- YoY trade growth
        (imports_total / NULLIF(LAG(imports_total, 12) OVER (ORDER BY date), 0) - 1) * 100 AS imports_yoy,
        (exports_total / NULLIF(LAG(exports_total, 12) OVER (ORDER BY date), 0) - 1) * 100 AS exports_yoy,

        -- Short-term momentum
        (imports_total - LAG(imports_total, 3) OVER (ORDER BY date)) AS imports_3m_change,
        (exports_total - LAG(exports_total, 3) OVER (ORDER BY date)) AS exports_3m_change,

        -- Simple net trade proxy
        (exports_total - imports_total) AS net_trade_proxy,

        -- Total trade activity
        (exports_total + imports_total) AS total_trade_activity

    FROM base
)
SELECT
    date,

    imports_total,
    ROUND(imports_yoy, 2) AS imports_yoy,
    imports_3m_change,

    exports_total,
    ROUND(exports_yoy, 2) AS exports_yoy,
    exports_3m_change,

    net_trade_proxy,
    total_trade_activity

FROM calc
ORDER BY date DESC;