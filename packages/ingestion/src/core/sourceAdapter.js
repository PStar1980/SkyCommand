const { getSourceRequestPolicy } = require('./sourceRequestPolicy');
const { runPipeline, runPipelineItem } = require('./runPipeline');

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

function defineSourceAdapter(definition = {}) {
  const adapter = {
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
    metadata: definition.metadata && typeof definition.metadata === 'object'
      ? { ...definition.metadata }
      : {},
  };

  if (!adapter.name) throw new Error('Source adapter name is required.');
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
  defineSourceAdapter,
  runSourceAdapter,
  runSourceAdapterItem,
};
