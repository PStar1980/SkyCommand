require('dotenv').config({
  path: require('path').join(__dirname, '../../../../../.env'),
});

const axios = require('axios');

const { STATCAN_VECTORS } = require('../config/statcanVectors');

const resolveVector = async (indicatorCode, config) => {
  if (!config.productId || !config.coordinate) {
    console.log(`SKIP ${indicatorCode}: missing productId or coordinate`);
    return;
  }

  const response = await axios({
    url: 'https://www150.statcan.gc.ca/t1/wds/rest/getSeriesInfoFromCubePidCoord',
    method: 'POST',
    timeout: 30000,
    data: [
      {
        productId: Number(config.productId),
        coordinate: config.coordinate,
      },
    ],
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const item = Array.isArray(response.data) ? response.data[0] : response.data;

  if (item?.status !== 'SUCCESS') {
    console.log(`FAIL ${indicatorCode}: ${JSON.stringify(item)}`);
    return;
  }

  const object = item.object;

  console.log('');
  console.log(`=== ${indicatorCode} ===`);
  console.log(`productId: ${object.productId}`);
  console.log(`coordinate: ${object.coordinate}`);
  console.log(`vectorId: ${object.vectorId}`);
  console.log(`frequencyCode: ${object.frequencyCode}`);
  console.log(`decimals: ${object.decimals}`);
  console.log(`terminated: ${object.terminated}`);
  console.log(`title: ${object.SeriesTitleEn}`);
};

const main = async () => {
  for (const [indicatorCode, config] of Object.entries(STATCAN_VECTORS)) {
    if (config.vectorId) continue;
    if (!config.coordinate) continue;

    try {
      await resolveVector(indicatorCode, config);
    } catch (err) {
      console.error(`ERROR ${indicatorCode}: ${err.message}`);
    }
  }
};

main();
