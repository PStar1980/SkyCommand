const path = require('path');

const { discoverToolManifests } = require('./toolManifestCli');
const {
  ToolManifestContractError,
  getSkyServerRoot,
  loadToolManifest,
} = require('./toolManifestContract');

let registryCache = null;

function normalizeRepoPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function buildToolManifestRegistry({ repositoryRoot = getSkyServerRoot() } = {}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const manifests = discoverToolManifests(resolvedRepositoryRoot).map((manifestPath) =>
    loadToolManifest(manifestPath, { repositoryRoot: resolvedRepositoryRoot }));
  const byToolCode = new Map();

  manifests.forEach((loadedManifest) => {
    const { toolCode } = loadedManifest.manifest;

    if (byToolCode.has(toolCode)) {
      throw new ToolManifestContractError(
        'TOOL_MANIFEST_REGISTRY_DUPLICATE',
        `Multiple manifests declare toolCode ${toolCode}.`,
        { toolCode },
      );
    }

    byToolCode.set(toolCode, loadedManifest);
  });

  return {
    repositoryRoot: resolvedRepositoryRoot,
    manifests,
    byToolCode,
  };
}

function getToolManifestRegistry(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || getSkyServerRoot());

  if (
    options.forceReload
    || !registryCache
    || registryCache.repositoryRoot !== repositoryRoot
  ) {
    registryCache = buildToolManifestRegistry({ repositoryRoot });
  }

  return registryCache;
}

function getToolManifestByCode(toolCode, options = {}) {
  const normalizedToolCode = String(toolCode || '').trim();

  if (!normalizedToolCode) {
    return null;
  }

  return getToolManifestRegistry(options).byToolCode.get(normalizedToolCode) || null;
}

function assertRegisteredToolMatchesManifest(tool, loadedManifest) {
  if (!tool || !loadedManifest) {
    return;
  }

  const { manifest } = loadedManifest;
  const mismatches = [];
  const registeredScriptPath = normalizeRepoPath(tool.script_path || tool.scriptPath);
  const registeredRuntime = String(tool.runtime_code || tool.runtimeCode || '').trim().toLowerCase();
  const registeredPermission = String(tool.permission_code || tool.permissionCode || '').trim();

  if (registeredScriptPath && registeredScriptPath !== normalizeRepoPath(manifest.runtime.entrypoint)) {
    mismatches.push({
      field: 'script_path',
      registered: registeredScriptPath,
      manifest: manifest.runtime.entrypoint,
    });
  }

  if (registeredRuntime && registeredRuntime !== manifest.runtime.type) {
    mismatches.push({
      field: 'runtime_code',
      registered: registeredRuntime,
      manifest: manifest.runtime.type,
    });
  }

  if (
    registeredPermission
    && manifest.permissions.length > 0
    && !manifest.permissions.includes(registeredPermission)
  ) {
    mismatches.push({
      field: 'permission_code',
      registered: registeredPermission,
      manifest: manifest.permissions,
    });
  }

  if (mismatches.length > 0) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_REGISTRY_DRIFT',
      `Registered tool ${manifest.toolCode} no longer matches its validated repository manifest.`,
      { toolCode: manifest.toolCode, mismatches },
    );
  }
}

function getRegisteredToolExecutionContract(tool, options = {}) {
  const toolCode = tool?.tool_code || tool?.toolCode;
  const loadedManifest = getToolManifestByCode(toolCode, options);

  if (!loadedManifest) {
    return null;
  }

  assertRegisteredToolMatchesManifest(tool, loadedManifest);

  return {
    loadedManifest,
    expectedOutputType: loadedManifest.manifest.resultContract.outputType,
    outputSchema: loadedManifest.outputSchema,
    resultRequired: loadedManifest.manifest.resultContract.required,
    timeoutMs: loadedManifest.manifest.execution.timeoutMs,
    manifestHash: loadedManifest.hashes.manifest,
    entrypointHash: loadedManifest.hashes.entrypoint,
  };
}

function clearToolManifestRegistryCache() {
  registryCache = null;
}

module.exports = {
  assertRegisteredToolMatchesManifest,
  buildToolManifestRegistry,
  clearToolManifestRegistryCache,
  getRegisteredToolExecutionContract,
  getToolManifestByCode,
  getToolManifestRegistry,
  normalizeRepoPath,
};
