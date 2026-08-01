const fs = require('fs');
const path = require('path');

const {
  CAPABILITY_KEYS,
  SOURCE_ADAPTER_CONTRACT_VERSION,
  validateSourceAdapter,
} = require('./sourceAdapter');

const DEFAULT_ADAPTER_DIRECTORY = path.resolve(__dirname, '../adapters');
const ADAPTER_FILE_PATTERN = /^[A-Za-z0-9._-]+Adapter\.js$/;

function normalizeCode(value, label) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) throw new Error(`${label} is required.`);
  return code;
}

function normalizeProfile(profile = {}) {
  const capabilities = profile.capabilities && typeof profile.capabilities === 'object'
    ? profile.capabilities
    : {};

  return {
    toolCode: String(profile.toolCode ?? profile.tool_code ?? '').trim() || null,
    adapterCode: normalizeCode(profile.adapterCode ?? profile.adapter_code, 'profile adapterCode'),
    domainCode: normalizeCode(profile.domainCode ?? profile.domain_code, 'profile domainCode'),
    sourceCode: normalizeCode(profile.sourceCode ?? profile.source_code, 'profile sourceCode'),
    contractVersion: String(profile.contractVersion ?? profile.contract_version ?? '').trim(),
    capabilities: {
      incremental: Boolean(
        profile.supportsIncremental ?? profile.supports_incremental ?? capabilities.incremental,
      ),
      selectedAssets: Boolean(
        profile.supportsSelectedAssets
          ?? profile.supports_selected_assets
          ?? capabilities.selectedAssets,
      ),
      backfill: Boolean(profile.supportsBackfill ?? profile.supports_backfill ?? capabilities.backfill),
      revisions: Boolean(
        profile.supportsRevisions ?? profile.supports_revisions ?? capabilities.revisions,
      ),
      resume: Boolean(profile.supportsResume ?? profile.supports_resume ?? capabilities.resume),
      dryRun: Boolean(profile.supportsDryRun ?? profile.supports_dry_run ?? capabilities.dryRun),
    },
    active: profile.active !== false && profile.profile_active !== false,
  };
}

function validateAdapterProfileAlignment(adapter, rawProfile = {}) {
  validateSourceAdapter(adapter);
  const profile = normalizeProfile(rawProfile);
  const errors = [];

  if (!profile.active) errors.push('profile is inactive');
  if (adapter.adapterCode !== profile.adapterCode) {
    errors.push(`adapter code ${adapter.adapterCode} != ${profile.adapterCode}`);
  }
  if (adapter.domainCode !== profile.domainCode) {
    errors.push(`domain ${adapter.domainCode} != ${profile.domainCode}`);
  }
  if (adapter.sourceCode !== profile.sourceCode) {
    errors.push(`source ${adapter.sourceCode} != ${profile.sourceCode}`);
  }
  if (adapter.resultContractVersion !== profile.contractVersion) {
    errors.push(
      `result contract ${adapter.resultContractVersion} != ${profile.contractVersion || '(blank)'}`,
    );
  }

  for (const key of CAPABILITY_KEYS) {
    if (adapter.capabilities[key] !== profile.capabilities[key]) {
      errors.push(
        `capability ${key}=${adapter.capabilities[key]} != profile ${profile.capabilities[key]}`,
      );
    }
  }

  if (errors.length > 0) {
    const prefix = profile.toolCode ? `Tool ${profile.toolCode}` : `Adapter ${adapter.adapterCode}`;
    throw new Error(`${prefix} violates ${SOURCE_ADAPTER_CONTRACT_VERSION}: ${errors.join('; ')}.`);
  }

  return {
    ok: true,
    adapterCode: adapter.adapterCode,
    domainCode: adapter.domainCode,
    sourceCode: adapter.sourceCode,
    contractVersion: adapter.resultContractVersion,
    capabilities: { ...adapter.capabilities },
  };
}

function resolveAdapterFiles(directories = [DEFAULT_ADAPTER_DIRECTORY]) {
  const files = [];

  for (const directory of directories) {
    const absoluteDirectory = path.resolve(directory);
    if (!fs.existsSync(absoluteDirectory)) continue;

    for (const name of fs.readdirSync(absoluteDirectory).sort()) {
      if (!ADAPTER_FILE_PATTERN.test(name)) continue;
      const filePath = path.join(absoluteDirectory, name);
      if (fs.statSync(filePath).isFile()) files.push(filePath);
    }
  }

  return files;
}

function loadAdapterModule(filePath, options = {}) {
  const resolved = require.resolve(path.resolve(filePath));
  if (options.fresh) delete require.cache[resolved];
  const adapter = require(resolved);
  validateSourceAdapter(adapter);
  return adapter;
}

function discoverSourceAdapters(options = {}) {
  const files = resolveAdapterFiles(options.directories || [DEFAULT_ADAPTER_DIRECTORY]);
  const adapters = new Map();
  const sourceKeys = new Map();

  for (const filePath of files) {
    const adapter = loadAdapterModule(filePath, options);
    if (adapters.has(adapter.adapterCode)) {
      throw new Error(`Duplicate source adapter code ${adapter.adapterCode}: ${filePath}`);
    }

    const sourceKey = `${adapter.domainCode}:${adapter.sourceCode}`;
    if (sourceKeys.has(sourceKey)) {
      throw new Error(
        `Duplicate source adapter binding ${sourceKey}: ${sourceKeys.get(sourceKey)} and ${filePath}`,
      );
    }

    adapters.set(adapter.adapterCode, { adapter, filePath });
    sourceKeys.set(sourceKey, filePath);
  }

  return Object.freeze({
    contractVersion: SOURCE_ADAPTER_CONTRACT_VERSION,
    size: adapters.size,
    list() {
      return [...adapters.values()].map(({ adapter, filePath }) => ({ adapter, filePath }));
    },
    has(adapterCode) {
      return adapters.has(normalizeCode(adapterCode, 'adapterCode'));
    },
    get(adapterCode) {
      const code = normalizeCode(adapterCode, 'adapterCode');
      const entry = adapters.get(code);
      if (!entry) throw new Error(`No runtime source adapter is registered for ${code}.`);
      return entry.adapter;
    },
    getEntry(adapterCode) {
      const code = normalizeCode(adapterCode, 'adapterCode');
      const entry = adapters.get(code);
      if (!entry) throw new Error(`No runtime source adapter is registered for ${code}.`);
      return { ...entry };
    },
  });
}

module.exports = {
  ADAPTER_FILE_PATTERN,
  DEFAULT_ADAPTER_DIRECTORY,
  discoverSourceAdapters,
  loadAdapterModule,
  normalizeProfile,
  resolveAdapterFiles,
  validateAdapterProfileAlignment,
};
