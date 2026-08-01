const fs = require('fs');
const path = require('path');

const { requestWithSourcePolicy } = require('../core/httpSourceClient');

const { STATCAN_VECTORS } = require('../config/statcanVectors');

const normalizeVectorId = (vectorId) => {
  if (vectorId === null || vectorId === undefined || vectorId === '') {
    return null;
  }

  return String(vectorId).trim().replace(/^v/i, '');
};

const formatToday = () => {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const normalizeRefPeriod = (refPeriod) => {
  const value = String(refPeriod ?? '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }

  if (/^\d{4}$/.test(value)) {
    return `${value}-01-01`;
  }

  const quarterMatch = value.match(/^(\d{4})[\s-]?Q([1-4])$/i);

  if (quarterMatch) {
    const year = quarterMatch[1];
    const quarter = Number(quarterMatch[2]);
    const month = String((quarter - 1) * 3 + 1).padStart(2, '0');

    return `${year}-${month}-01`;
  }

  return null;
};

const normalizeValue = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim().replace(/,/g, '');

  if (!cleaned || cleaned === '.') {
    return null;
  }

  const numeric = Number(cleaned);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return String(numeric);
};

const unwrapVectorResponse = (payload) => {
  const item = Array.isArray(payload) ? payload[0] : payload;

  if (!item) {
    throw new Error('StatCan response was empty');
  }

  if (item.status && item.status !== 'SUCCESS') {
    throw new Error(`StatCan request failed with status: ${item.status}`);
  }

  if (item.object) {
    return item.object;
  }

  if (Array.isArray(item.vectorDataPoint)) {
    return item;
  }

  throw new Error(`Unexpected StatCan response shape: ${JSON.stringify(item).slice(0, 500)}`);
};

const getVectorDataPoints = (vectorObject) => {
  if (!vectorObject) {
    return [];
  }

  if (Array.isArray(vectorObject.vectorDataPoint)) {
    return vectorObject.vectorDataPoint;
  }

  if (Array.isArray(vectorObject.object?.vectorDataPoint)) {
    return vectorObject.object.vectorDataPoint;
  }

  return [];
};

const applyTransform = (rows, transform = 'level') => {
  const sortedRows = [...rows].sort((a, b) => a.edate.localeCompare(b.edate));

  if (transform === 'level') {
    return sortedRows;
  }

  if (transform === 'mom_pct') {
    return sortedRows
      .map((row, index) => {
        if (index === 0) return null;

        const previous = Number(sortedRows[index - 1].value);
        const current = Number(row.value);

        if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) {
          return null;
        }

        return {
          edate: row.edate,
          value: ((current / previous - 1) * 100).toFixed(4),
        };
      })
      .filter(Boolean);
  }

  if (transform === 'yoy_pct') {
    return sortedRows
      .map((row, index) => {
        if (index < 12) return null;

        const previous = Number(sortedRows[index - 12].value);
        const current = Number(row.value);

        if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) {
          return null;
        }

        return {
          edate: row.edate,
          value: ((current / previous - 1) * 100).toFixed(4),
        };
      })
      .filter(Boolean);
  }

  throw new Error(`Unsupported StatCan transform: ${transform}`);
};

const downloadStatCanVectorCSV = async (indicatorCode, outputDir, options = {}) => {
  const config = STATCAN_VECTORS[indicatorCode];

  if (!config) {
    throw new Error(`No StatCan vector config found for ${indicatorCode}`);
  }

  const vectorId = normalizeVectorId(config.vectorId);

  if (!vectorId) {
    throw new Error(`No vectorId configured for ${indicatorCode}`);
  }

  const startRefPeriod = config.startRefPeriod || '1900-01-01';
  const endReferencePeriod = config.endReferencePeriod || formatToday();

  const url = 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorByReferencePeriodRange';

  const filePath = path.join(outputDir, `${indicatorCode}.csv`);

  console.log(`🌐 Downloading StatCan ${indicatorCode}...`);

  const requestUrl =
    `${url}?vectorIds="${vectorId}"` +
    `&startRefPeriod=${startRefPeriod}` +
    `&endReferencePeriod=${endReferencePeriod}`;

  const requestResult = await requestWithSourcePolicy({
    sourceCode: 'STATCAN',
    domainCode: 'MACRO',
    assetCode: indicatorCode,
    policy: options.requestPolicy,
    query: options.query,
    axiosInstance: options.axiosInstance,
    retryOptions: options.retryOptions,
    request: {
      url: requestUrl,
      method: 'GET',
    },
  });
  const response = requestResult.response;

  const vectorObject = unwrapVectorResponse(response.data);
  const points = getVectorDataPoints(vectorObject);

  if (points.length === 0) {
    throw new Error(`No StatCan datapoints returned for ${indicatorCode}`);
  }

  const rows = points
    .map((point) => {
      const edate = normalizeRefPeriod(point.refPer || point.refPerRaw);
      const value = normalizeValue(point.value);

      if (!edate || value === null) {
        return null;
      }

      return { edate, value };
    })
    .filter(Boolean)
    .sort((a, b) => a.edate.localeCompare(b.edate));

  if (rows.length === 0) {
    throw new Error(`No usable StatCan datapoints returned for ${indicatorCode}`);
  }

  const transformedRows = applyTransform(rows, config.transform || 'level');

  const seenDates = new Set();
  const outputRows = ['edate,value'];

  for (const row of transformedRows) {
    if (seenDates.has(row.edate)) {
      continue;
    }

    seenDates.add(row.edate);
    outputRows.push(`${row.edate},${row.value}`);
  }

  fs.writeFileSync(filePath, outputRows.join('\n'), 'utf-8');

  console.log(`💾 Saved ${filePath}`);

  return {
    filePath,
    requestAttempts: requestResult.requestAttempts,
    requestPolicy: requestResult.requestPolicy,
  };
};

module.exports = { downloadStatCanVectorCSV };
