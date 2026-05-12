#!/usr/bin/env node

/**
 * generateRepoMap.js
 *
 * Generates a readable repository map for documentation and structural review.
 *
 * Usage:
 *   node generateRepoMap.js <location> <fileName> [outputPath]
 *
 * Example:
 *   node generateRepoMap.js "C:\\Projects\\SkyServer" "SkyServer_RepoMap.md" "C:\\Projects\\SkyServer\\docs"
 *   node generateRepoMap.js "./SkyWeb" "SkyWeb_RepoMap.md" "./SkyWeb/docs"
 */

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// PHASE 1: Parse CLI arguments
// ------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('❌ Error: You must provide at least 2 arguments:');
  console.error('   location (required)');
  console.error('   fileName (required)');
  console.error('   outputPath (optional)');
  process.exit(1);
}

let [location, fileName, outputPath] = args;

// Normalize paths
location = path.resolve(location);

// If outputPath missing → default to location
if (!outputPath) {
  outputPath = location;
} else {
  outputPath = path.resolve(outputPath);
}

// Validate existence of location
if (!fs.existsSync(location)) {
  console.error(`❌ Error: The location path does not exist:\n   ${location}`);
  process.exit(1);
}

// ------------------------------------------------------------
// PHASE 2: Recursive directory walker
// ------------------------------------------------------------
const IGNORED_ENTRIES = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.idea',
  '.ds_store',
  '.cache',
  '.next',
  'dist',
  'build',
  'coverage',
  'out',
  'temp',
  'tmp',
  'logs',
  'zip',
]);

const SENSITIVE_ENV_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
]);

function shouldIgnoreEntry(entryName) {
  return IGNORED_ENTRIES.has(entryName.toLowerCase());
}

function shouldSkipFile(fileName) {
  const normalizedFileName = String(fileName || '').toLowerCase();

  if (SENSITIVE_ENV_FILES.has(normalizedFileName)) {
    return true;
  }

  return path.extname(normalizedFileName) === '.zip';
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

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const results = entries
    .filter((entry) => !shouldIgnoreEntry(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return {
          type: 'directory',
          name: entry.name,
          children: scanDirectory(fullPath),
        };
      }

      if (!entry.isFile() || shouldSkipFile(entry.name)) {
        return null;
      }

      return {
        type: 'file',
        name: entry.name,
      };
    })
    .filter(Boolean);

  return sortEntries(results);
}

// ------------------------------------------------------------
// PHASE 3: Render tree into ASCII format
// ------------------------------------------------------------
function renderTree(nodeName, children, prefix = '') {
  let output = `${nodeName}/\n`;

  const traverse = (items, currentPrefix) => {
    items.forEach((item, index) => {
      const isLast = index === items.length - 1;
      const branch = isLast ? '└── ' : '├── ';
      const nextPrefix = currentPrefix + (isLast ? '    ' : '│   ');

      if (item.type === 'file') {
        output += `${currentPrefix}${branch}${item.name}\n`;
        return;
      }

      if (item.type === 'directory') {
        output += `${currentPrefix}${branch}${item.name}/\n`;
        traverse(item.children, nextPrefix);
      }
    });
  };

  traverse(children, prefix);
  return output;
}

// ------------------------------------------------------------
// PHASE 4: Build tree + write output file
// ------------------------------------------------------------
const rootName = path.basename(location);
const structure = scanDirectory(location);
const asciiTree = renderTree(rootName, structure);

// Ensure output directory exists
if (!fs.existsSync(outputPath)) {
  fs.mkdirSync(outputPath, { recursive: true });
}

const outputFilePath = path.join(outputPath, fileName);

// Write to disk
fs.writeFileSync(outputFilePath, asciiTree, 'utf8');

console.log('\n✅ Repository map generated successfully!');
console.log(`📄 Output file: ${outputFilePath}\n`);
