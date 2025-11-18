#!/usr/bin/env node

/**
 * generateStructure.js
 *
 * Usage:
 *   node generateStructure.js <location> <fileName> [outputPath]
 *
 * Example:
 *   node generateStructure.js "C:\\Projects\\NeoFinTech" "structure.md"
 *   node generateStructure.js "./NeoFinTech" "tree.md" "C:\\Exports"
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
// PHASE 2: Recursive directory walker (ignoring node_modules)
// ------------------------------------------------------------
function sortEntries(entries) {
  const files = entries
    .filter((e) => e.type === 'file')
    .sort((a, b) => a.name.localeCompare(b.name));

  const folders = entries
    .filter((e) => e.type === 'directory')
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...files, ...folders];
}

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  let results = entries
    .filter((entry) => {
      const lower = entry.name.toLowerCase();
      const ignoreList = [
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
      ];

      return !ignoreList.includes(lower);
    })
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return {
          type: 'directory',
          name: entry.name,
          children: scanDirectory(fullPath),
        };
      } else {
        return {
          type: 'file',
          name: entry.name,
        };
      }
    });

  // 🔥 Sort: files first, folders second
  results = sortEntries(results);

  return results;
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
      } else if (item.type === 'directory') {
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

console.log(`\n✅ Folder structure generated successfully!`);
console.log(`📄 Output file: ${outputFilePath}\n`);
