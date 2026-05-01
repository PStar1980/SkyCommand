CREATE OR REPLACE VIEW macro.vw_us_ca_policy_fx AS
WITH base AS (
    SELECT
        COALESCE(ca.date, us.date) AS date,

        us.fed_funds,
        ca.boc_overnight_rate,

        ca.usd_cad,
        ca.usd_cad_1d_pct,
        ca.usd_cad_30d_pct,
        ca.cad_usd_proxy

    FROM macro.vw_ca_rates_fx ca
    FULL OUTER JOIN macro.vw_rates_curve us
        ON ca.date = us.date
),
calc AS (
    SELECT
        *,

        -- Canada minus US policy rate spread.
        -- Positive = BoC policy rate above Fed funds.
        (boc_overnight_rate - fed_funds) AS policy_spread_ca_minus_us,

        -- US minus Canada policy rate spread.
        -- Positive = Fed funds above BoC policy rate.
        (fed_funds - boc_overnight_rate) AS policy_spread_us_minus_ca,

        -- Change in cross-border policy spread.
        (
            (boc_overnight_rate - fed_funds)
            - LAG(boc_overnight_rate - fed_funds, 30) OVER (ORDER BY date)
        ) AS policy_spread_30d_change,

        CASE
            WHEN (boc_overnight_rate - fed_funds) > 0.50 THEN 'BOC_ABOVE_FED'
            WHEN (boc_overnight_rate - fed_funds) < -0.50 THEN 'FED_ABOVE_BOC'
            ELSE 'ROUGHLY_ALIGNED'
        END AS policy_alignment_regime,

        CASE
            WHEN usd_cad_30d_pct > 2 THEN 'CAD_WEAKENING'
            WHEN usd_cad_30d_pct < -2 THEN 'CAD_STRENGTHENING'
            ELSE 'RANGE_BOUND'
        END AS fx_regime

    FROM base
)
SELECT
    date,

    fed_funds,
    boc_overnight_rate,

    policy_spread_ca_minus_us,
    policy_spread_us_minus_ca,
    policy_spread_30d_change,
    policy_alignment_regime,

    usd_cad,
    ROUND(usd_cad_1d_pct, 4) AS usd_cad_1d_pct,
    ROUND(usd_cad_30d_pct, 4) AS usd_cad_30d_pct,
    cad_usd_proxy,
    fx_regime

FROM calc
ORDER BY date DESC;

ALTER VIEW macro.vw_us_ca_policy_fx OWNER TO postgres;
