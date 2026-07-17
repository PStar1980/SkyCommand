#!/usr/bin/env node

/**
 * Generates a readable repository map for documentation and structural review.
 *
 * Human-readable console output remains available for direct CLI and Run Tools.
 * SkyCommand workflow launches additionally receive a deliberate
 * repository_map_summary.v1 ToolResult through the shared result transport.
 *
 * Usage:
 *   node generateRepoMap.js <location> <fileName> [outputPath]
 */

const fs = require('fs');
const path = require('path');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
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

function parseRepositoryMapArgs(args = []) {
  const positionalArgs = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));

  if (positionalArgs.length < 2) {
    throw new Error('❌ Error: You must provide location and fileName. outputPath is optional.');
  }

  const [rawLocation, rawFileName, rawOutputPath] = positionalArgs;
  const location = path.resolve(rawLocation);
  const fileName = normalizeOutputFileName(rawFileName);
  const outputPath = rawOutputPath ? path.resolve(rawOutputPath) : location;

  if (!fs.existsSync(location)) {
    throw new Error(`❌ Error: The location path does not exist:\n   ${location}`);
  }
  if (!fs.statSync(location).isDirectory()) {
    throw new Error(`❌ Error: The location must be a directory:\n   ${location}`);
  }

  return {
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

function executeRepositoryMap(args = []) {
  const startedAt = new Date().toISOString();
  const options = parseRepositoryMapArgs(args);
  const repositoryName = path.basename(options.location);
  const statistics = createScanStatistics();
  const structure = scanDirectory(options.location, '', statistics);
  const asciiTree = renderTree(repositoryName, structure);

  fs.mkdirSync(options.outputPath, { recursive: true });
  fs.writeFileSync(options.outputFilePath, asciiTree, 'utf8');

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
    outputBytes: fs.statSync(options.outputFilePath).size,
    topLevelEntries: structure.map((entry) => entry.name),
    extensionCounts: statistics.extensionCounts,
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
