CREATE OR REPLACE VIEW macro.vw_rates_curve AS
SELECT
    dgs10.edate AS date,

    dgs3mo.value AS yield_3m,
    dgs2.value   AS yield_2y,
    dgs3.value   AS yield_3y,
    dgs5.value   AS yield_5y,
    dgs7.value   AS yield_7y,
    dgs10.value  AS yield_10y,

    -- Yield curve spreads
    (dgs10.value - dgs3mo.value) AS spread_10y_3m,
    (dgs10.value - dgs2.value)   AS spread_10y_2y,
    (dgs10.value - dgs3.value)   AS spread_10y_3y,

    -- Corporate yields
    aaa.value AS corp_yield_aaa,
    bbb.value AS corp_yield_bbb,

    -- Credit spreads
    (bbb.value - aaa.value) AS spread_bbb_aaa,

    -- Fed policy
    fed.value   AS fed_funds,
    lower.value AS fed_lower,
    upper.value AS fed_upper,

    -- Policy vs curve
    (dgs10.value - fed.value) AS spread_10y_ff

FROM macro."DGS10" dgs10
LEFT JOIN macro."DGS3MO" dgs3mo ON dgs10.edate = dgs3mo.edate
LEFT JOIN macro."DGS2"   dgs2   ON dgs10.edate = dgs2.edate
LEFT JOIN macro."DGS3"   dgs3   ON dgs10.edate = dgs3.edate
LEFT JOIN macro."DGS5"   dgs5   ON dgs10.edate = dgs5.edate
LEFT JOIN macro."DGS7"   dgs7   ON dgs10.edate = dgs7.edate
LEFT JOIN macro."BAMLC0A1CAAA"   aaa ON dgs10.edate = aaa.edate
LEFT JOIN macro."BAMLC0A4CBBBEY" bbb ON dgs10.edate = bbb.edate
LEFT JOIN macro."DFF"       fed   ON dgs10.edate = fed.edate
LEFT JOIN macro."DFEDTARL"  lower ON dgs10.edate = lower.edate
LEFT JOIN macro."DFEDTARU"  upper ON dgs10.edate = upper.edate

ORDER BY dgs10.edate DESC;