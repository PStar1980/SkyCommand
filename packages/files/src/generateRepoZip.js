#!/usr/bin/env node

/**
 * generateRepoZip.js
 *
 * Generates a zip archive of a repository/folder for project handoff and review.
 * Uses the same ignore rules and CLI parameter shape as generateRepoMap.js.
 *
 * Usage:
 *   node generateRepoZip.js <location> <fileName> [outputPath]
 *
 * Example:
 *   node generateRepoZip.js "C:\\Projects\\SkyServer" "SkyServer_Repo.zip" "C:\\Projects\\SkyServer\\docs"
 *   node generateRepoZip.js "./SkyWeb" "SkyWeb_Repo.zip" "./SkyWeb/docs"
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

function hasPathSeparators(value) {
  return /[\\/]/.test(value);
}

function normalizeOutputFileName(value) {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error('❌ Error: fileName cannot be blank.');
  }

  const normalized = value.trim();

  if (normalized.includes('\0')) {
    throw new Error('❌ Error: fileName cannot contain null bytes.');
  }

  if (hasPathSeparators(normalized)) {
    throw new Error('❌ Error: fileName must be a file name only, not a path.');
  }

  if (path.extname(normalized).toLowerCase() !== '.zip') {
    return `${normalized}.zip`;
  }

  return normalized;
}

try {
  fileName = normalizeOutputFileName(fileName);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

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

const outputFilePath = path.resolve(outputPath, fileName);

function normalizeComparablePath(value) {
  const resolved = path.resolve(value);

  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

const comparableOutputFilePath = normalizeComparablePath(outputFilePath);

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
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
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

function sortEntries(entries) {
  const files = entries
    .filter((entry) => entry.type === 'file')
    .sort((a, b) => a.name.localeCompare(b.name));

  const folders = entries
    .filter((entry) => entry.type === 'directory')
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...files, ...folders];
}

function toZipPath(value) {
  return value.split(path.sep).join('/');
}

function shouldSkipFile(fullPath) {
  if (normalizeComparablePath(fullPath) === comparableOutputFilePath) {
    return true;
  }

  const fileNameOnly = path.basename(fullPath).toLowerCase();

  if (SENSITIVE_ENV_FILES.has(fileNameOnly)) {
    return true;
  }

  return path.extname(fullPath).toLowerCase() === '.zip';
}

function scanDirectory(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const results = entries
    .filter((entry) => !shouldIgnoreEntry(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return {
          type: 'directory',
          name: entry.name,
          children: scanDirectory(fullPath, baseDir),
        };
      }

      if (!entry.isFile() || shouldSkipFile(fullPath)) {
        return null;
      }

      return {
        type: 'file',
        name: entry.name,
        fullPath,
        relativePath: path.relative(baseDir, fullPath),
      };
    })
    .filter(Boolean);

  return sortEntries(results);
}

function flattenFiles(items, files = []) {
  for (const item of items) {
    if (item.type === 'file') {
      files.push(item);
      continue;
    }

    if (item.type === 'directory') {
      flattenFiles(item.children, files);
    }
  }

  return files;
}

// ------------------------------------------------------------
// PHASE 3: ZIP helpers
// ------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let crc = i;

    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    table[i] = crc >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;

  return { dosDate, dosTime };
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function createLocalFileHeader({
  fileNameBuffer,
  crc,
  compressedSize,
  uncompressedSize,
  dosTime,
  dosDate,
}) {
  return Buffer.concat([
    uint32(0x04034b50), // local file header signature
    uint16(20), // version needed to extract
    uint16(0), // general purpose bit flag
    uint16(8), // compression method: deflate
    uint16(dosTime),
    uint16(dosDate),
    uint32(crc),
    uint32(compressedSize),
    uint32(uncompressedSize),
    uint16(fileNameBuffer.length),
    uint16(0), // extra field length
    fileNameBuffer,
  ]);
}

function createCentralDirectoryHeader({
  fileNameBuffer,
  crc,
  compressedSize,
  uncompressedSize,
  dosTime,
  dosDate,
  localHeaderOffset,
}) {
  return Buffer.concat([
    uint32(0x02014b50), // central directory signature
    uint16(20), // version made by
    uint16(20), // version needed to extract
    uint16(0), // general purpose bit flag
    uint16(8), // compression method: deflate
    uint16(dosTime),
    uint16(dosDate),
    uint32(crc),
    uint32(compressedSize),
    uint32(uncompressedSize),
    uint16(fileNameBuffer.length),
    uint16(0), // extra field length
    uint16(0), // file comment length
    uint16(0), // disk number start
    uint16(0), // internal file attributes
    uint32(0), // external file attributes
    uint32(localHeaderOffset),
    fileNameBuffer,
  ]);
}

function createEndOfCentralDirectory({ entryCount, centralDirectorySize, centralDirectoryOffset }) {
  return Buffer.concat([
    uint32(0x06054b50), // EOCD signature
    uint16(0), // number of this disk
    uint16(0), // disk where central directory starts
    uint16(entryCount),
    uint16(entryCount),
    uint32(centralDirectorySize),
    uint32(centralDirectoryOffset),
    uint16(0), // comment length
  ]);
}

function createZipArchive(files, rootName) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const stat = fs.statSync(file.fullPath);
    const rawData = fs.readFileSync(file.fullPath);
    const compressedData = zlib.deflateRawSync(rawData);
    const checksum = crc32(rawData);
    const zipEntryPath = toZipPath(path.join(rootName, file.relativePath));
    const fileNameBuffer = Buffer.from(zipEntryPath, 'utf8');
    const { dosDate, dosTime } = toDosDateTime(stat.mtime);

    const localHeader = createLocalFileHeader({
      fileNameBuffer,
      crc: checksum,
      compressedSize: compressedData.length,
      uncompressedSize: rawData.length,
      dosTime,
      dosDate,
    });

    const centralHeader = createCentralDirectoryHeader({
      fileNameBuffer,
      crc: checksum,
      compressedSize: compressedData.length,
      uncompressedSize: rawData.length,
      dosTime,
      dosDate,
      localHeaderOffset: offset,
    });

    localParts.push(localHeader, compressedData);
    centralParts.push(centralHeader);

    offset += localHeader.length + compressedData.length;
  });

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = createEndOfCentralDirectory({
    entryCount: files.length,
    centralDirectorySize: centralDirectory.length,
    centralDirectoryOffset,
  });

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

// ------------------------------------------------------------
// PHASE 4: Build archive + write output file
// ------------------------------------------------------------
const rootName = path.basename(location);
const structure = scanDirectory(location);
const files = flattenFiles(structure);

// Ensure output directory exists after scanning so a newly-created docs/output folder is not included.
if (!fs.existsSync(outputPath)) {
  fs.mkdirSync(outputPath, { recursive: true });
}

const archive = createZipArchive(files, rootName);

fs.writeFileSync(outputFilePath, archive);

const totalInputBytes = files.reduce((total, file) => total + fs.statSync(file.fullPath).size, 0);
const outputBytes = fs.statSync(outputFilePath).size;

console.log('\n✅ Repository zip generated successfully!');
console.log(`📦 Output file: ${outputFilePath}`);
console.log(`📄 Files included: ${files.length}`);
console.log(`📥 Source bytes: ${totalInputBytes}`);
console.log(`📤 Zip bytes: ${outputBytes}\n`);
