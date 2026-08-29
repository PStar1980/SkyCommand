#!/usr/bin/env node

/**
 * Generates a readable repository map for documentation and structural review.
 *
 * Human-readable console output remains available for direct CLI and Run Tools.
 * SkyCommand workflow launches additionally receive a deliberate
 * repository_map_summary.v1 ToolResult through the shared result transport.
 *
 * Usage:
 *   node generateRepoMap.js <repository>
 *
 * Repository root, output file name, and output path are resolved from the
 * active SkyCommand repository record/profile path.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  loadRepositoryArtifactConfiguration,
} = require('./repositoryArtifactConfiguration');
const {
  createRepositoryMapFailureToolResult,
  createRepositoryMapToolResult,
} = require('./repositoryMapResult');

const TOOL_CODE = 'repo_map_generate';
const OUTPUT_TYPE = 'repository_map_summary.v1';

const IGNORED_ENTRIES = new Set([
  'node_modules',
  '.git',
  '.github',
  '.vscode',
  '.idea',
  '.ds_store',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '__pycache__',
  '.next',
  'dist',
  'build',
  'bin',
  'obj',
  'coverage',
  'out',
  'temp',
  'tmp',
  'logs',
  'zip',
]);
const IGNORED_RELATIVE_PATHS = new Set(['tests/e2e']);
const SENSITIVE_ENV_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
]);

function normalizeRelativePath(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function normalizeOutputFileName(value) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw new Error('❌ Error: fileName cannot be blank.');
  }
  if (normalized.includes('\0')) {
    throw new Error('❌ Error: fileName cannot contain null bytes.');
  }
  if (/[\\/]/.test(normalized)) {
    throw new Error('❌ Error: fileName must be a file name only, not a path.');
  }

  return normalized;
}

async function parseRepositoryMapArgs(args = [], dependencies = {}) {
  const positionalArgs = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));

  if (positionalArgs.length !== 1) {
    throw new Error('❌ Error: You must provide exactly one repository.');
  }

  const loadRepository =
    dependencies.loadRepositoryArtifactConfiguration || loadRepositoryArtifactConfiguration;
  const repository = await loadRepository(positionalArgs[0]);
  const configuredRootPath = String(repository.rootPath || '').trim();
  const configuredOutputPath = String(repository.repoMapOutputPath || '').trim();

  if (!String(repository.repoMapFileName || '').trim()) {
    throw new Error(
      `❌ Error: Repository '${repository.repoCode || positionalArgs[0]}' does not have a Repository Map File Name configured.`,
    );
  }

  const location = path.resolve(configuredRootPath);
  const fileName = normalizeOutputFileName(repository.repoMapFileName);
  const outputPath = configuredOutputPath ? path.resolve(configuredOutputPath) : location;

  if (!configuredRootPath || !fs.existsSync(location)) {
    throw new Error(`❌ Error: The configured repository path does not exist:\n   ${location}`);
  }
  if (!fs.statSync(location).isDirectory()) {
    throw new Error(`❌ Error: The configured repository path must be a directory:\n   ${location}`);
  }

  return {
    repositoryCode: repository.repoCode,
    repositoryName: repository.repoName,
    location,
    fileName,
    outputPath,
    outputFilePath: path.resolve(outputPath, fileName),
  };
}

function shouldIgnoreEntry(entryName, relativePath = '') {
  const normalizedEntryName = String(entryName || '').toLowerCase();
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  return (
    IGNORED_ENTRIES.has(normalizedEntryName) || IGNORED_RELATIVE_PATHS.has(normalizedRelativePath)
  );
}

function shouldSkipFile(fileName) {
  const normalizedFileName = String(fileName || '').toLowerCase();

  if (SENSITIVE_ENV_FILES.has(normalizedFileName)) return true;
  if (normalizedFileName === 'change.log') return false;
  return ['.zip', '.log', '.patch'].includes(path.extname(normalizedFileName));
}

function sortEntries(entries) {
  const files = entries
    .filter((entry) => entry.type === 'file')
    .sort((a, b) => a.name.localeCompare(b.name));
  const folders = entries
    .filter((entry) => entry.type === 'directory')
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...files, ...folders];
}

function createScanStatistics() {
  return {
    directoriesDocumented: 1,
    filesDocumented: 0,
    directoriesExcluded: 0,
    filesExcluded: 0,
    extensionCounts: {},
  };
}

function scanDirectory(dir, relativeDir = '', statistics = createScanStatistics()) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = entries
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizeRelativePath(path.join(relativeDir, entry.name));

      if (shouldIgnoreEntry(entry.name, relativePath)) {
        if (entry.isDirectory()) statistics.directoriesExcluded += 1;
        else statistics.filesExcluded += 1;
        return null;
      }

      if (entry.isDirectory()) {
        statistics.directoriesDocumented += 1;
        return {
          type: 'directory',
          name: entry.name,
          children: scanDirectory(fullPath, relativePath, statistics),
        };
      }

      if (!entry.isFile() || shouldSkipFile(entry.name)) {
        if (entry.isFile()) statistics.filesExcluded += 1;
        return null;
      }

      statistics.filesDocumented += 1;
      const extension = path.extname(entry.name).toLowerCase() || '[no extension]';
      statistics.extensionCounts[extension] = (statistics.extensionCounts[extension] || 0) + 1;
      return { type: 'file', name: entry.name };
    })
    .filter(Boolean);

  return sortEntries(results);
}

function renderTree(nodeName, children, prefix = '') {
  let output = `${nodeName}/\n`;

  const traverse = (items, currentPrefix) => {
    items.forEach((item, index) => {
      const isLast = index === items.length - 1;
      const branch = isLast ? '└── ' : '├── ';
      const nextPrefix = currentPrefix + (isLast ? '    ' : '│   ');

      if (item.type === 'file') {
        output += `${currentPrefix}${branch}${item.name}\n`;
      } else {
        output += `${currentPrefix}${branch}${item.name}/\n`;
        traverse(item.children, nextPrefix);
      }
    });
  };

  traverse(children, prefix);
  return output;
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, performance.now() - startedAt);
}

function performancePhase(code, label, durationMs) {
  return {
    code,
    label,
    durationMs: Math.max(0, Number(durationMs) || 0),
  };
}

async function executeRepositoryMap(args = [], dependencies = {}) {
  const startedAt = new Date().toISOString();
  const instrumentationStartedAt = performance.now();

  let phaseStartedAt = performance.now();
  const options = await parseRepositoryMapArgs(args, dependencies);
  const configurationDurationMs = elapsedMilliseconds(phaseStartedAt);
  const repositoryName = options.repositoryName || path.basename(options.location);

  phaseStartedAt = performance.now();
  const statistics = createScanStatistics();
  const structure = scanDirectory(options.location, '', statistics);
  const repositoryScanDurationMs = elapsedMilliseconds(phaseStartedAt);

  phaseStartedAt = performance.now();
  const asciiTree = renderTree(repositoryName, structure);
  const treeRenderDurationMs = elapsedMilliseconds(phaseStartedAt);

  phaseStartedAt = performance.now();
  fs.mkdirSync(options.outputPath, { recursive: true });
  fs.writeFileSync(options.outputFilePath, asciiTree, 'utf8');
  const artifactWriteDurationMs = elapsedMilliseconds(phaseStartedAt);

  phaseStartedAt = performance.now();
  const outputBytes = fs.statSync(options.outputFilePath).size;
  const artifactStatDurationMs = elapsedMilliseconds(phaseStartedAt);

  const instrumentedTotalMs = elapsedMilliseconds(instrumentationStartedAt);
  const completedAt = new Date().toISOString();

  return {
    ok: true,
    repositoryName,
    repositoryRoot: options.location,
    fileName: options.fileName,
    artifactPath: options.outputFilePath,
    format: path.extname(options.fileName).toLowerCase() === '.md' ? 'MARKDOWN' : 'TEXT',
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    directoriesDocumented: statistics.directoriesDocumented,
    filesDocumented: statistics.filesDocumented,
    directoriesExcluded: statistics.directoriesExcluded,
    filesExcluded: statistics.filesExcluded,
    outputBytes,
    topLevelEntries: structure.map((entry) => entry.name),
    extensionCounts: statistics.extensionCounts,
    performanceTelemetry: {
      instrumentedTotalMs,
      phases: [
        performancePhase(
          'CONFIGURATION',
          'Configuration / repository resolution',
          configurationDurationMs,
        ),
        performancePhase('REPOSITORY_SCAN', 'Repository scan', repositoryScanDurationMs),
        performancePhase('TREE_RENDER', 'Tree render', treeRenderDurationMs),
        performancePhase('ARTIFACT_WRITE', 'Artifact write', artifactWriteDurationMs),
        performancePhase('ARTIFACT_STAT', 'Artifact stat', artifactStatDurationMs),
      ],
    },
    nodeModulesExcluded: true,
    sensitiveEnvironmentFilesExcluded: true,
    generatedArtifactsExcluded: true,
    e2eTestsExcluded: true,
  };
}

function printRepositoryMapResult(result) {
  console.log('\n✅ Repository map generated successfully!');
  console.log(`📄 Output file: ${result.artifactPath}`);
  console.log(`📁 Directories documented: ${result.directoriesDocumented}`);
  console.log(`📄 Files documented: ${result.filesDocumented}`);
  console.log(`📦 Output bytes: ${result.outputBytes}\n`);
}

async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: OUTPUT_TYPE,
    args,
    execute: executeRepositoryMap,
    createToolResult: createRepositoryMapToolResult,
    createFailureToolResult: (error) =>
      createRepositoryMapFailureToolResult({
        error,
        startedAt,
        completedAt: new Date().toISOString(),
      }),
    renderConsole: printRepositoryMapResult,
  });
}

if (require.main === module) main();

module.exports = {
  OUTPUT_TYPE,
  TOOL_CODE,
  createScanStatistics,
  executeRepositoryMap,
  main,
  normalizeOutputFileName,
  parseRepositoryMapArgs,
  printRepositoryMapResult,
  renderTree,
  scanDirectory,
};
