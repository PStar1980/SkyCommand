const fs = require('fs');
const path = require('path');

const { executeWithRetry } = require('./retryExecutor');
const { getSourceRequestPolicy } = require('./sourceRequestPolicy');

function getAxios() {
  return require('axios');
}

function requestLabel(sourceCode, assetCode) {
  const source = String(sourceCode || 'SOURCE').toUpperCase();
  const asset = assetCode ? ` ${assetCode}` : '';
  return `[${source}]${asset}`;
}

async function requestWithSourcePolicy({
  sourceCode,
  domainCode = 'MACRO',
  assetCode,
  request,
  policy,
  query,
  axiosInstance,
  logger = console,
  retryOptions = {},
} = {}) {
  const resolvedPolicy = await getSourceRequestPolicy(sourceCode, {
    domainCode,
    policy,
    query,
  });
  const client = axiosInstance || getAxios();

  const result = await executeWithRetry({
    policy: resolvedPolicy,
    ...retryOptions,
    operation: async ({ attemptNumber }) => client({
      ...(request || {}),
      timeout: resolvedPolicy.requestTimeoutMs,
    }),
    onAttempt: async (attempt) => {
      if (attempt.outcome === 'FAILED' && attempt.willRetry) {
        const reason = attempt.httpStatus
          ? `HTTP ${attempt.httpStatus}`
          : (attempt.errorCode || attempt.errorCategoryCode);
        logger.warn(
          `⚠️ ${requestLabel(sourceCode, assetCode)} ${reason}; retry ${attempt.attemptNumber + 1}/${resolvedPolicy.maxAttempts} in ${attempt.waitBeforeNextMs}ms`,
        );
      }
      if (typeof retryOptions.onAttempt === 'function') {
        await retryOptions.onAttempt(attempt);
      }
    },
  });

  return {
    response: result.value,
    requestAttempts: result.attempts,
    requestPolicy: resolvedPolicy,
  };
}

async function downloadToFileWithSourcePolicy({
  sourceCode,
  domainCode = 'MACRO',
  assetCode,
  url,
  outputDir,
  fileName,
  request = {},
  policy,
  query,
  axiosInstance,
  logger = console,
  retryOptions = {},
} = {}) {
  const finalFileName = fileName || `${assetCode || 'download'}.csv`;
  const filePath = path.join(outputDir, finalFileName);

  const result = await requestWithSourcePolicy({
    sourceCode,
    domainCode,
    assetCode,
    policy,
    query,
    axiosInstance,
    logger,
    retryOptions,
    request: {
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      ...request,
    },
  });

  fs.writeFileSync(filePath, result.response.data);
  logger.log(`💾 Saved ${filePath}`);

  return {
    filePath,
    requestAttempts: result.requestAttempts,
    requestPolicy: result.requestPolicy,
  };
}

module.exports = {
  downloadToFileWithSourcePolicy,
  requestWithSourcePolicy,
};
