require('dotenv').config({
  path: require('path').join(__dirname, '../../../../../.env'),
});

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { STATCAN_VECTORS } = require('../config/statcanVectors');

const outputDir = path.join(__dirname, '../tmp/statcan_metadata');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const normalizeProductList = () => {
  const seen = new Map();

  for (const [indicatorCode, config] of Object.entries(STATCAN_VECTORS)) {
    if (!config.productId) continue;

    if (!seen.has(config.productId)) {
      seen.set(config.productId, []);
    }

    seen.get(config.productId).push(indicatorCode);
  }

  return [...seen.entries()].map(([productId, indicators]) => ({
    productId,
    indicators,
  }));
};

const unwrapMetadataResponse = (payload, productId) => {
  if (Array.isArray(payload)) {
    const item = payload.find((entry) => {
      const objectProductId = String(entry?.object?.productId ?? '');
      return objectProductId === String(productId) || entry?.status === 'SUCCESS';
    });

    if (!item || item.status !== 'SUCCESS') {
      throw new Error(`Metadata request failed for product ${productId}`);
    }

    return item.object;
  }

  if (payload?.status === 'SUCCESS') {
    return payload.object;
  }

  throw new Error(`Unexpected metadata response for product ${productId}`);
};

const getEnglish = (value) => {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value;

  if (typeof value === 'object') {
    return (
      value.en ||
      value.En ||
      value.EN ||
      value.nameEn ||
      value.memberNameEn ||
      value.dimensionNameEn ||
      value.titleEn ||
      ''
    );
  }

  return String(value);
};

const extractDimensions = (metadata) => {
  const dimensions =
    metadata.dimensions ||
    metadata.dimension ||
    metadata.Dimension ||
    metadata.cubeDimensions ||
    metadata.object?.dimensions ||
    [];

  return dimensions.map((dimension, index) => {
    const dimensionName =
      dimension.dimensionNameEn ||
      dimension.nameEn ||
      dimension.dimensionName ||
      dimension.name ||
      dimension.titleEn ||
      `Dimension ${index + 1}`;

    const members =
      dimension.members || dimension.member || dimension.Member || dimension.dimensionMembers || [];

    return {
      position: index + 1,
      name: getEnglish(dimensionName),
      members: members.map((member) => ({
        id:
          member.memberId ?? member.memberID ?? member.id ?? member.code ?? member.memberCode ?? '',
        name: getEnglish(
          member.memberNameEn ||
            member.nameEn ||
            member.memberName ||
            member.name ||
            member.titleEn,
        ),
      })),
    };
  });
};

const getCubeMetadata = async (productId) => {
  const url = 'https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata';

  const response = await axios({
    url,
    method: 'POST',
    timeout: 30000,
    data: [{ productId: Number(productId) }],
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return unwrapMetadataResponse(response.data, productId);
};

const writeMetadataFiles = (productId, indicators, metadata, dimensions) => {
  ensureDir(outputDir);

  const rawPath = path.join(outputDir, `${productId}_raw.json`);
  const summaryPath = path.join(outputDir, `${productId}_summary.json`);
  const txtPath = path.join(outputDir, `${productId}_members.txt`);

  fs.writeFileSync(rawPath, JSON.stringify(metadata, null, 2), 'utf-8');

  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        productId,
        indicators,
        title:
          metadata.cubeTitleEn ||
          metadata.productTitleEn ||
          metadata.titleEn ||
          metadata.cubeTitle ||
          '',
        dimensions,
      },
      null,
      2,
    ),
    'utf-8',
  );

  const lines = [];

  lines.push(`Product: ${productId}`);
  lines.push(`Indicators: ${indicators.join(', ')}`);
  lines.push('');

  for (const dimension of dimensions) {
    lines.push(`DIM ${dimension.position}: ${dimension.name}`);

    for (const member of dimension.members) {
      lines.push(`  ${member.id}: ${member.name}`);
    }

    lines.push('');
  }

  fs.writeFileSync(txtPath, lines.join('\n'), 'utf-8');

  return { rawPath, summaryPath, txtPath };
};

const main = async () => {
  const products = normalizeProductList();

  console.log(`StatCan metadata products: ${products.length}`);

  for (const { productId, indicators } of products) {
    console.log(`\n=== ${productId} ===`);
    console.log(`Indicators: ${indicators.join(', ')}`);

    try {
      const metadata = await getCubeMetadata(productId);
      const dimensions = extractDimensions(metadata);

      const files = writeMetadataFiles(productId, indicators, metadata, dimensions);

      console.log(`Dimensions: ${dimensions.length}`);
      console.log(`Saved: ${files.txtPath}`);
    } catch (err) {
      console.error(`Failed ${productId}: ${err.message}`);
    }
  }

  console.log('\nDone.');
};

main();
