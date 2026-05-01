const STATCAN_VECTORS = {
  CAD_CPI_YOY: {
    vectorId: 41690973,
    productId: '18100004',
    coordinate: '2.2.0.0.0.0.0.0.0.0',
    transform: 'yoy_pct',
    startRefPeriod: '1900-01-01',
  },

  CAD_GDP_MOM_GROWTH: {
    vectorId: 65201210,
    productId: '36100434',
    coordinate: '1.1.1.1.0.0.0.0.0.0',
    transform: 'mom_pct',
    startRefPeriod: '1900-01-01',
  },

  CAD_REAL_GDP_MONTHLY: {
    vectorId: 65201210,
    productId: '36100434',
    coordinate: '1.1.1.1.0.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_CPI_ALL_ITEMS: {
    vectorId: 41690973,
    productId: '18100004',
    coordinate: '2.2.0.0.0.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_BUILDING_PERMITS: {
    vectorId: 1675119645,
    productId: '34100292',
    coordinate: '1.1.1.1.2.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_RETAIL_SALES: {
    vectorId: 1446870151,
    productId: '20100067',
    coordinate: '1.1.1.0.0.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_NHPI_MOM: {
    vectorId: 111955442,
    productId: '18100205',
    coordinate: '1.1.0.0.0.0.0.0.0.0',
    transform: 'mom_pct',
    startRefPeriod: '1900-01-01',
  },

  CAD_NEW_HOUSING_PRICE_INDEX: {
    vectorId: 111955442,
    productId: '18100205',
    coordinate: '1.1.0.0.0.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_POPULATION: {
    vectorId: 1,
    productId: '17100009',
    coordinate: '1.0.0.0.0.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_EMPLOYMENT: {
    vectorId: 2062811,
    productId: '14100287',
    coordinate: '1.3.1.1.1.1.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_PARTICIPATION_RATE: {
    vectorId: 2062816,
    productId: '14100287',
    coordinate: '1.8.1.1.1.1.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_UNEMPLOYMENT_RATE: {
    vectorId: 2062815,
    productId: '14100287',
    coordinate: '1.7.1.1.1.1.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_IMPORTS: {
    vectorId: 1645187724,
    productId: '12100178',
    coordinate: '1.1.1.1.1.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },

  CAD_TRADE_BY_INDUSTRY: {
    vectorId: 1592742953,
    productId: '12100176',
    coordinate: '1.2.1.1.0.0.0.0.0.0',
    transform: 'level',
    startRefPeriod: '1900-01-01',
  },
};

module.exports = { STATCAN_VECTORS };
