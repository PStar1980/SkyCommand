const fs = require('fs');
const path = require('path');

const { validateToolResult } = require('./toolResultContract');
const {
  TOOL_MANIFEST_FILE_NAME,
  getSkyServerRoot,
  loadToolManifest,
  summarizeToolManifest,
} = require('./toolManifestContract');

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'logs',
  'dist',
  'build',
  'coverage',
]);

function discoverToolManifests(rootDirectory = getSkyServerRoot()) {
  const discovered = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    entries.forEach((entry) => {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        return;
      }

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(fullPath);
        return;
      }

      if (entry.isFile() && entry.name === TOOL_MANIFEST_FILE_NAME) {
        discovered.push(fullPath);
      }
    });
  }

  visit(path.resolve(rootDirectory));

  return discovered.sort();
}

function validateLoadedManifestContract(loadedManifest) {
  const { manifest, outputSchema, sampleToolResult } = loadedManifest;

  if (manifest.resultContract.required && !outputSchema) {
    throw new Error(
      `Tool ${manifest.toolCode} requires structured output but does not declare resultContract.schemaPath.`,
    );
  }

  if (!sampleToolResult) {
    throw new Error(
      `Tool ${manifest.toolCode} must declare resultContract.samplePath for non-destructive contract checks.`,
    );
  }

  const sampleResult = validateToolResult(sampleToolResult, {
    expectedOutputType: manifest.resultContract.outputType,
    outputSchema,
  });

  return {
    toolCode: manifest.toolCode,
    displayName: manifest.displayName,
    runtime: manifest.runtime.type,
    entrypoint: manifest.runtime.entrypoint,
    parameterCount: manifest.parameters.length,
    outputType: manifest.resultContract.outputType,
    schemaValidated: Boolean(outputSchema),
    sampleSuccess: sampleResult.success,
    hashes: loadedManifest.hashes,
  };
}

function validateToolManifests({ repositoryRoot = getSkyServerRoot(), manifestPaths = null } = {}) {
  const paths = manifestPaths?.length ? manifestPaths : discoverToolManifests(repositoryRoot);
  const loaded = paths.map((manifestPath) => loadToolManifest(manifestPath, { repositoryRoot }));
  const toolCodes = loaded.map(({ manifest }) => manifest.toolCode);
  const duplicateToolCodes = toolCodes.filter((toolCode, index) => toolCodes.indexOf(toolCode) !== index);

  if (duplicateToolCodes.length > 0) {
    throw new Error(`Duplicate toolCode values were discovered: ${[...new Set(duplicateToolCodes)].join(', ')}`);
  }

  return loaded.map(validateLoadedManifestContract);
}

function resolveManifestArgument(value, repositoryRoot) {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}

function runCli(args = process.argv.slice(2), options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || getSkyServerRoot());
  const command = args[0] || 'validate';
  const manifestArgument = resolveManifestArgument(args[1], repositoryRoot);

  if (command === 'discover') {
    const manifests = discoverToolManifests(repositoryRoot).map((manifestPath) =>
      path.relative(repositoryRoot, manifestPath).replace(/\\/g, '/'));
    console.log(JSON.stringify({ count: manifests.length, manifests }, null, 2));
    return { command, manifests };
  }

  if (command === 'describe') {
    if (!manifestArgument) {
      throw new Error('describe requires a repository-relative or absolute manifest path.');
    }

    const loadedManifest = loadToolManifest(manifestArgument, { repositoryRoot });
    const description = summarizeToolManifest(loadedManifest);
    console.log(JSON.stringify(description, null, 2));
    return { command, description };
  }

  if (!['validate', 'contract-check'].includes(command)) {
    throw new Error(`Unknown tool manifest command: ${command}`);
  }

  const reports = validateToolManifests({
    repositoryRoot,
    manifestPaths: manifestArgument ? [manifestArgument] : null,
  });
  const output = {
    command,
    status: 'VALID',
    manifestCount: reports.length,
    tools: reports,
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(`[SkyCommand] Tool manifest validation failed: ${error.message}`);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    if (Array.isArray(error.errors)) {
      console.error(JSON.stringify(error.errors, null, 2));
    }
    process.exitCode = 1;
  }
}

module.exports = {
  discoverToolManifests,
  runCli,
  validateLoadedManifestContract,
  validateToolManifests,
};
