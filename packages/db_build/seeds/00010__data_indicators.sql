update macro.indicators set active = false where indicator_code in ('V39052','V39053','V39054','GOLDAMGBD228NLBM');

INSERT INTO macro.indicators (
    indicator_code,
    source,
    description,
    frequency,
    created_at,
    active
)
SELECT
    v.indicator_code,
    v.source,
    v.description,
    v.frequency,
    NOW(),
    v.active
FROM (
    VALUES
        (
            'CAD_CPI_ALL_ITEMS',
            'STATCAN',
            'Consumer Price Index - All Items, monthly, not seasonally adjusted (StatCan table 18-10-0004-01)',
            'monthly',
            true
        ),
        (
            'CAD_CPI_YOY',
            'STATCAN',
            'Consumer Price Index - All Items percentage change / inflation measure (StatCan table 18-10-0004-02)',
            'monthly',
            true
        ),
        (
            'CAD_UNEMPLOYMENT_RATE',
            'STATCAN',
            'Unemployment Rate, seasonally adjusted (StatCan table 14-10-0287-01)',
            'monthly',
            true
        ),
        (
            'CAD_EMPLOYMENT',
            'STATCAN',
            'Employment, seasonally adjusted (StatCan table 14-10-0287-01)',
            'monthly',
            true
        ),
        (
            'CAD_PARTICIPATION_RATE',
            'STATCAN',
            'Labour Force Participation Rate, seasonally adjusted (StatCan table 14-10-0287-01)',
            'monthly',
            true
        ),
        (
            'CAD_REAL_GDP_MONTHLY',
            'STATCAN',
            'Gross Domestic Product at basic prices, monthly (StatCan table 36-10-0434-01)',
            'monthly',
            true
        ),
        (
            'CAD_GDP_MOM_GROWTH',
            'STATCAN',
            'Gross Domestic Product at basic prices, monthly growth rates (StatCan table 36-10-0434-02)',
            'monthly',
            true
        ),
        (
            'CAD_RETAIL_SALES',
            'STATCAN',
            'Monthly Retail Sales, price and volume, seasonally adjusted (StatCan table 20-10-0067-01)',
            'monthly',
            true
        ),
        (
            'CAD_BUILDING_PERMITS',
            'STATCAN',
            'Building Permits by type of structure and type of work (StatCan table 34-10-0292-01)',
            'monthly',
            true
        ),
        (
            'CAD_NEW_HOUSING_PRICE_INDEX',
            'STATCAN',
            'New Housing Price Index, monthly (StatCan table 18-10-0205-01)',
            'monthly',
            true
        ),
        (
            'CAD_NHPI_MOM',
            'STATCAN',
            'New Housing Price Index percentage change, monthly (StatCan table 18-10-0205-02)',
            'monthly',
            true
        ),
        (
            'CAD_POPULATION',
            'STATCAN',
            'Population Estimates, quarterly (StatCan table 17-10-0009-01)',
            'quarterly',
            true
        ),
        (
            'CAD_IMPORTS',
            'STATCAN',
            'Canadian International Merchandise Trade - Imports, customs-based, monthly (StatCan table 12-10-0178-01)',
            'monthly',
            true
        ),
        (
            'CAD_TRADE_BY_INDUSTRY',
            'STATCAN',
            'Canadian International Merchandise Trade by industry for all countries, monthly (StatCan table 12-10-0176-01)',
            'monthly',
            true
        )
) AS v (
    indicator_code,
    source,
    description,
    frequency,
    active
)
WHERE NOT EXISTS (
    SELECT 1
    FROM macro.indicators i
    WHERE i.indicator_code = v.indicator_code
      AND UPPER(i.source) = UPPER(v.source)
);
