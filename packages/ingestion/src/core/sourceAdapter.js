const { getSourceRequestPolicy } = require('./sourceRequestPolicy');
const { runPipeline, runPipelineItem } = require('./runPipeline');

const SOURCE_ADAPTER_CONTRACT_VERSION = 'source_adapter.v1';
const CAPABILITY_KEYS = [
  'incremental',
  'selectedAssets',
  'backfill',
  'revisions',
  'resume',
  'dryRun',
];

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`Source adapter requires ${name}().`);
  return value;
}

function normalizeCode(value, label) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) throw new Error(`${label} is required.`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw new Error(`Invalid ${label}: ${value}`);
  return code;
}

function normalizeContractVersion(value, label = 'resultContractVersion') {
  const contractVersion = String(value || '').trim();
  if (!contractVersion) throw new Error(`${label} is required.`);
  if (!/^[a-z][a-z0-9_.-]*\.v[1-9][0-9]*$/i.test(contractVersion)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return contractVersion;
}

function normalizeCapabilities(value = {}) {
  return Object.freeze(CAPABILITY_KEYS.reduce((result, key) => {
    result[key] = Boolean(value[key]);
    return result;
  }, {}));
}

function validateSourceAdapter(adapter = {}) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Source adapter must be an object.');
  }

  normalizeCode(adapter.sourceCode, 'sourceCode');
  normalizeCode(adapter.adapterCode, 'adapterCode');
  normalizeCode(adapter.domainCode, 'domainCode');
  normalizeContractVersion(adapter.resultContractVersion);

  if (adapter.contractVersion !== SOURCE_ADAPTER_CONTRACT_VERSION) {
    throw new Error(
      `Source adapter ${adapter.adapterCode || '(unknown)'} must declare ${SOURCE_ADAPTER_CONTRACT_VERSION}.`,
    );
  }
  if (!String(adapter.name || '').trim()) throw new Error('Source adapter name is required.');

  requiredFunction(adapter.getAssets, 'getAssets');
  requiredFunction(adapter.fetch, 'fetch');
  requiredFunction(adapter.load, 'load');
  if (adapter.normalize !== null && typeof adapter.normalize !== 'function') {
    throw new TypeError('Source adapter normalize must be a function or null.');
  }
  if (adapter.getCode !== null && typeof adapter.getCode !== 'function') {
    throw new TypeError('Source adapter getCode must be a function or null.');
  }

  if (!Number.isFinite(adapter.defaultConcurrency) || adapter.defaultConcurrency < 1) {
    throw new Error('Source adapter defaultConcurrency must be a positive number.');
  }
  if (!Number.isFinite(adapter.maxConcurrency) || adapter.maxConcurrency < adapter.defaultConcurrency) {
    throw new Error('Source adapter maxConcurrency must be greater than or equal to defaultConcurrency.');
  }

  for (const key of CAPABILITY_KEYS) {
    if (typeof adapter.capabilities?.[key] !== 'boolean') {
      throw new Error(`Source adapter capability ${key} must be boolean.`);
    }
  }

  return adapter;
}

function defineSourceAdapter(definition = {}) {
  const adapter = {
    contractVersion: SOURCE_ADAPTER_CONTRACT_VERSION,
    resultContractVersion: normalizeContractVersion(
      definition.resultContractVersion || definition.contractVersion,
    ),
    sourceCode: normalizeCode(definition.sourceCode, 'sourceCode'),
    adapterCode: normalizeCode(definition.adapterCode || definition.sourceCode, 'adapterCode'),
    domainCode: normalizeCode(definition.domainCode || 'MACRO', 'domainCode'),
    name: String(definition.name || definition.sourceCode || '').trim(),
    getAssets: requiredFunction(definition.getAssets, 'getAssets'),
    fetch: requiredFunction(definition.fetch, 'fetch'),
    normalize: definition.normalize || null,
    load: requiredFunction(definition.load, 'load'),
    getCode: definition.getCode || null,
    tempDir: definition.tempDir || null,
    defaultConcurrency: Number(definition.defaultConcurrency || 1),
    maxConcurrency: Number(definition.maxConcurrency || 10),
    requestPolicyRequired: definition.requestPolicyRequired !== false,
    capabilities: normalizeCapabilities(definition.capabilities),
    metadata: Object.freeze(definition.metadata && typeof definition.metadata === 'object'
      ? { ...definition.metadata }
      : {}),
  };

  validateSourceAdapter(adapter);
  return Object.freeze(adapter);
}

async function resolveAdapterPolicy(adapter, options = {}) {
  if (!adapter.requestPolicyRequired) return null;
  return getSourceRequestPolicy(adapter.sourceCode, {
    domainCode: adapter.domainCode,
    policy: options.requestPolicy,
    query: options.query,
  });
}

function createAdapterCallbacks(adapter, requestPolicy) {
  return {
    download: (code, tempDir, item) => adapter.fetch(code, tempDir, item, { requestPolicy }),
    normalize: adapter.normalize
      ? (filePath, code, item) => adapter.normalize(filePath, code, item)
      : null,
    load: (code, filePath, item) => adapter.load(code, filePath, item),
  };
}

async function runSourceAdapter(adapter, options = {}) {
  validateSourceAdapter(adapter);
  const requestPolicy = await resolveAdapterPolicy(adapter, options);
  const callbacks = createAdapterCallbacks(adapter, requestPolicy);

  return runPipeline({
    name: adapter.name,
    getIndicators: adapter.getAssets,
    download: callbacks.download,
    normalize: callbacks.normalize,
    load: callbacks.load,
    tempDir: options.tempDir || adapter.tempDir,
    getCode: adapter.getCode,
    indicators: options.indicators || [],
    concurrency: options.concurrency || adapter.defaultConcurrency,
    maxConcurrency: options.maxConcurrency || adapter.maxConcurrency,
    runId: options.runId,
    cleanupQuiet: options.cleanupQuiet,
    onBatchComplete: options.onBatchComplete,
  });
}

async function runSourceAdapterItem(adapter, item, options = {}) {
  validateSourceAdapter(adapter);
  const requestPolicy = await resolveAdapterPolicy(adapter, options);
  const callbacks = createAdapterCallbacks(adapter, requestPolicy);

  return runPipelineItem({
    item,
    name: adapter.name,
    download: callbacks.download,
    normalize: callbacks.normalize,
    load: callbacks.load,
    tempRoot: options.tempRoot || adapter.tempDir,
    runId: options.runId || 'single-item',
    getCode: adapter.getCode,
    cleanupQuiet: options.cleanupQuiet,
  });
}

module.exports = {
  CAPABILITY_KEYS,
  SOURCE_ADAPTER_CONTRACT_VERSION,
  defineSourceAdapter,
  normalizeCapabilities,
  runSourceAdapter,
  runSourceAdapterItem,
  validateSourceAdapter,
};
