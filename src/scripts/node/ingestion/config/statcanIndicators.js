const STATCAN_INDICATORS = {
  CAD_CPI_ALL_ITEMS: {
    productId: '18100004',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      { columns: ['Products and product groups'], equalsAny: ['All-items'] },
    ],
    transform: 'level',
  },

  CAD_CPI_YOY: {
    productId: '18100004',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      { columns: ['Products and product groups'], equalsAny: ['All-items'] },
    ],
    transform: 'yoy_pct',
  },

  CAD_UNEMPLOYMENT_RATE: {
    productId: '14100287',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      { columns: ['Sex'], equalsAny: ['Both sexes'] },
      { columns: ['Age group'], includesAny: ['15 years and over'] },
      { columns: ['Labour force characteristics'], equalsAny: ['Unemployment rate'] },
      {
        columns: ['Data type', 'Seasonal adjustment'],
        includesAny: ['Seasonally adjusted'],
        optional: true,
      },
    ],
    transform: 'level',
  },

  CAD_EMPLOYMENT: {
    productId: '14100287',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      { columns: ['Sex'], equalsAny: ['Both sexes'] },
      { columns: ['Age group'], includesAny: ['15 years and over'] },
      { columns: ['Labour force characteristics'], equalsAny: ['Employment'] },
      {
        columns: ['Data type', 'Seasonal adjustment'],
        includesAny: ['Seasonally adjusted'],
        optional: true,
      },
    ],
    transform: 'level',
  },

  CAD_PARTICIPATION_RATE: {
    productId: '14100287',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      { columns: ['Sex'], equalsAny: ['Both sexes'] },
      { columns: ['Age group'], includesAny: ['15 years and over'] },
      { columns: ['Labour force characteristics'], equalsAny: ['Participation rate'] },
      {
        columns: ['Data type', 'Seasonal adjustment'],
        includesAny: ['Seasonally adjusted'],
        optional: true,
      },
    ],
    transform: 'level',
  },

  CAD_REAL_GDP_MONTHLY: {
    productId: '36100434',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'], optional: true },
      {
        columns: ['North American Industry Classification System (NAICS)', 'Industry'],
        includesAny: ['All industries'],
      },
      { columns: ['Prices'], includesAll: ['chained'], optional: true },
      { columns: ['Seasonal adjustment'], includesAny: ['Seasonally adjusted'], optional: true },
    ],
    transform: 'level',
  },

  CAD_GDP_MOM_GROWTH: {
    productId: '36100434',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'], optional: true },
      {
        columns: ['North American Industry Classification System (NAICS)', 'Industry'],
        includesAny: ['All industries'],
      },
      { columns: ['Prices'], includesAll: ['chained'], optional: true },
      { columns: ['Seasonal adjustment'], includesAny: ['Seasonally adjusted'], optional: true },
    ],
    transform: 'mom_pct',
  },

  CAD_RETAIL_SALES: {
    productId: '20100067',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      {
        columns: ['North American Industry Classification System (NAICS)', 'Industry'],
        includesAny: ['Retail trade'],
      },
      { columns: ['Seasonal adjustment'], includesAny: ['Seasonally adjusted'], optional: true },
    ],
    transform: 'level',
  },

  CAD_BUILDING_PERMITS: {
    productId: '34100292',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      { columns: ['Type of structure'], includesAny: ['Total'], optional: true },
      { columns: ['Type of work'], includesAny: ['Total'], optional: true },
    ],
    transform: 'level',
  },

  CAD_NEW_HOUSING_PRICE_INDEX: {
    productId: '18100205',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      {
        columns: ['New housing price indexes', 'New housing estimates', 'Housing estimates'],
        includesAny: ['total'],
        optional: true,
      },
    ],
    transform: 'level',
  },

  CAD_NHPI_MOM: {
    productId: '18100205',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      {
        columns: ['New housing price indexes', 'New housing estimates', 'Housing estimates'],
        includesAny: ['total'],
        optional: true,
      },
    ],
    transform: 'mom_pct',
  },

  CAD_POPULATION: {
    productId: '17100009',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'] },
      { columns: ['Sex'], equalsAny: ['Both sexes'], optional: true },
      { columns: ['Age group'], equalsAny: ['All ages'], optional: true },
    ],
    transform: 'level',
  },

  CAD_IMPORTS: {
    productId: '12100178',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'], optional: true },
      {
        columns: ['Principal trading partners', 'Trading partner'],
        includesAny: ['World'],
        optional: true,
      },
      { columns: ['Trade'], includesAny: ['Imports'], optional: true },
    ],
    transform: 'level',
  },

  CAD_TRADE_BY_INDUSTRY: {
    productId: '12100176',
    filters: [
      { columns: ['GEO'], equalsAny: ['Canada'], optional: true },
      { columns: ['Industry'], includesAny: ['Total'], optional: true },
      { columns: ['Trade'], includesAny: ['Imports', 'Exports'], optional: true },
    ],
    transform: 'level',
  },
};

module.exports = { STATCAN_INDICATORS };
