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


function getSnapshotValue(tool, snakeCaseName, camelCaseName = null) {
  if (!tool) {
    return null;
  }

  if (tool[snakeCaseName] !== undefined) {
    return tool[snakeCaseName];
  }

  if (camelCaseName && tool[camelCaseName] !== undefined) {
    return tool[camelCaseName];
  }

  return null;
}

function assertAcceptedSnapshotMatchesManifest(tool, loadedManifest, options = {}) {
  if (!tool || !loadedManifest) {
    return;
  }

  const requireSnapshot = options.requireSnapshot !== false;
  const snapshotId = getSnapshotValue(
    tool,
    'tool_manifest_snapshot_id',
    'toolManifestSnapshotId',
  );

  if (!snapshotId) {
    if (!requireSnapshot) {
      return;
    }

    throw new ToolManifestContractError(
      'TOOL_MANIFEST_SNAPSHOT_REQUIRED',
      `Registered tool ${loadedManifest.manifest.toolCode} has a repository manifest but no accepted database snapshot.`,
      {
        toolCode: loadedManifest.manifest.toolCode,
        command: 'npm run tool-manifest:snapshot:sync',
      },
    );
  }

  const snapshotStatus = String(
    getSnapshotValue(tool, 'manifest_snapshot_status', 'manifestSnapshotStatus') || '',
  ).trim();
  const mismatches = [];

  if (snapshotStatus !== 'VALID') {
    mismatches.push({
      field: 'validation_status',
      snapshot: snapshotStatus || null,
      repository: 'VALID',
    });
  }

  const comparisons = [
    ['manifest_hash', 'manifestHash', loadedManifest.hashes.manifest],
    ['entrypoint_hash', 'entrypointHash', loadedManifest.hashes.entrypoint],
    ['output_schema_hash', 'outputSchemaHash', loadedManifest.hashes.outputSchema],
    ['contract_sample_hash', 'contractSampleHash', loadedManifest.hashes.sample],
    ['manifest_version', 'manifestVersion', loadedManifest.manifest.manifestVersion],
    ['manifest_path', 'manifestPath', normalizeRepoPath(
      path.relative(loadedManifest.repositoryRoot, loadedManifest.manifestPath),
    )],
    ['manifest_runtime_type', 'manifestRuntimeType', loadedManifest.manifest.runtime.type],
    ['manifest_entrypoint_path', 'manifestEntrypointPath', loadedManifest.manifest.runtime.entrypoint],
    ['manifest_output_type', 'manifestOutputType', loadedManifest.manifest.resultContract.outputType],
  ];

  comparisons.forEach(([snakeCaseName, camelCaseName, repositoryValue]) => {
    const snapshotValue = getSnapshotValue(tool, snakeCaseName, camelCaseName);

    if ((snapshotValue ?? null) !== (repositoryValue ?? null)) {
      mismatches.push({
        field: snakeCaseName,
        snapshot: snapshotValue ?? null,
        repository: repositoryValue ?? null,
      });
    }
  });

  const snapshotRequired = getSnapshotValue(
    tool,
    'manifest_result_required',
    'manifestResultRequired',
  );

  if (
    snapshotRequired !== null
    && snapshotRequired !== undefined
    && Boolean(snapshotRequired) !== Boolean(loadedManifest.manifest.resultContract.required)
  ) {
    mismatches.push({
      field: 'result_required',
      snapshot: Boolean(snapshotRequired),
      repository: Boolean(loadedManifest.manifest.resultContract.required),
    });
  }

  if (mismatches.length > 0) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_SNAPSHOT_DRIFT',
      `Registered tool ${loadedManifest.manifest.toolCode} no longer matches its accepted manifest snapshot.`,
      {
        toolCode: loadedManifest.manifest.toolCode,
        snapshotId,
        mismatches,
        command: 'npm run tool-manifest:snapshot:check',
      },
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
  assertAcceptedSnapshotMatchesManifest(tool, loadedManifest, {
    requireSnapshot: options.requireSnapshot !== false,
  });

  return {
    loadedManifest,
    expectedOutputType: loadedManifest.manifest.resultContract.outputType,
    outputSchema: loadedManifest.outputSchema,
    resultRequired: loadedManifest.manifest.resultContract.required,
    timeoutMs: loadedManifest.manifest.execution.timeoutMs,
    manifestHash: loadedManifest.hashes.manifest,
    entrypointHash: loadedManifest.hashes.entrypoint,
    snapshotId:
      getSnapshotValue(tool, 'tool_manifest_snapshot_id', 'toolManifestSnapshotId') || null,
    snapshotStatus:
      getSnapshotValue(tool, 'manifest_snapshot_status', 'manifestSnapshotStatus') || null,
  };
}

function clearToolManifestRegistryCache() {
  registryCache = null;
}

module.exports = {
  assertAcceptedSnapshotMatchesManifest,
  assertRegisteredToolMatchesManifest,
  buildToolManifestRegistry,
  clearToolManifestRegistryCache,
  getRegisteredToolExecutionContract,
  getToolManifestByCode,
  getToolManifestRegistry,
  normalizeRepoPath,
};
