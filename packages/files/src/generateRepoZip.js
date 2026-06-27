#!/usr/bin/env node

/**
 * generateRepoZip.js
 *
 * Generates a zip archive of a repository/folder for project handoff and review.
 * Uses the same ignore rules and CLI parameter shape as generateRepoMap.js.
 * Dependency folders are excluded by default to keep project handoff zips small,
 * upload-friendly, and platform-neutral.
 *
 * Usage:
 *   node generateRepoZip.js <location> <fileName> [outputPath] [options]
 *
 * Options:
 *   --include-node-modules   Optional diagnostic mode. Includes dependency folders.
 *                            Not recommended for normal project handoff zips.
 *   --include-images         Optional diagnostic mode. Includes image assets/screenshots.
 *                            Normal project handoff zips exclude images to stay compact.
 *
 * Examples:
 *   node generateRepoZip.js "C:\\Projects\\SkyServer" "SkyServer_Repo.zip" "C:\\Projects\\SkyServer\\zip"
 *   node generateRepoZip.js "./SkyWeb" "SkyWeb_Repo.zip" "./SkyWeb/zip"
 *   node generateRepoZip.js "./SkyWeb" "SkyWeb_Repo.zip" "./SkyWeb/zip" --include-node-modules
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ------------------------------------------------------------
// PHASE 1: Parse CLI arguments
// ------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const optionArgs = rawArgs.filter((arg) => arg.startsWith('--'));
const args = rawArgs.filter((arg) => !arg.startsWith('--'));

const SUPPORTED_OPTIONS = new Set([
  '--include-node-modules',
  '--exclude-node-modules',
  '--include-images',
  '--slim',
]);
const unknownOptions = optionArgs.filter((option) => !SUPPORTED_OPTIONS.has(option));

if (unknownOptions.length > 0) {
  console.error(`❌ Error: Unsupported option(s): ${unknownOptions.join(', ')}`);
  console.error(
    '   Supported options: --include-node-modules, --exclude-node-modules, --include-images, --slim',
  );
  process.exit(1);
}

if (args.length < 2) {
  console.error('❌ Error: You must provide at least 2 arguments:');
  console.error('   location (required)');
  console.error('   fileName (required)');
  console.error('   outputPath (optional)');
  console.error('   options (optional): --include-node-modules, --include-images');
  process.exit(1);
}

let [location, fileName, outputPath] = args;
const includeNodeModules = optionArgs.includes('--include-node-modules');
const includeImages = optionArgs.includes('--include-images');

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
const ZIP32_MAX_VALUE = 0xffffffff;
const ZIP32_MAX_ENTRY_COUNT = 0xffff;

const DEPENDENCY_FOLDER_NAME = 'node_modules';

const ALWAYS_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.vscode',
  '.idea',
  '.ds_store',
  '.cache',
  '.next',
  'coverage',
  'logs',
  'zip',
]);

const WORKSPACE_IGNORED_DIRECTORIES = new Set([
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  'temp',
  'tmp',
]);

const SENSITIVE_ENV_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
]);

const IMAGE_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
]);

function isWithinNodeModules(fullPath) {
  const relativePath = path.relative(location, fullPath);

  if (!relativePath || relativePath.startsWith('..')) {
    return false;
  }

  return relativePath
    .split(path.sep)
    .map((part) => part.toLowerCase())
    .includes(DEPENDENCY_FOLDER_NAME);
}

function shouldIgnoreDirectory(entryName, fullPath) {
  const lowerName = entryName.toLowerCase();

  if (lowerName === DEPENDENCY_FOLDER_NAME) {
    return !includeNodeModules;
  }

  if (ALWAYS_IGNORED_DIRECTORIES.has(lowerName)) {
    return true;
  }

  // When --include-node-modules is used, keep package-owned dist/build/out/bin/obj folders
  // inside node_modules. Many npm packages ship their runnable code there.
  if (!isWithinNodeModules(fullPath) && WORKSPACE_IGNORED_DIRECTORIES.has(lowerName)) {
    return true;
  }

  return false;
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

  const extension = path.extname(fullPath).toLowerCase();

  if (!includeImages && IMAGE_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  // Keep the project documentation change log while still excluding runtime *.log files.
  if (fileNameOnly === 'change.log') {
    return false;
  }

  return ['.zip', '.log'].includes(extension);
}

function scanDirectory(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const results = entries
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name, fullPath)) {
          return null;
        }

        return {
          type: 'directory',
          name: entry.name,
          children: scanDirectory(fullPath, baseDir),
        };
      }

      // Symlinks and special files are intentionally skipped. This keeps the archive
      // portable on Windows and avoids accidentally following dependency symlink loops.
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

function assertZip32Value(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > ZIP32_MAX_VALUE) {
    throw new Error(
      `❌ Error: ${label} exceeds standard ZIP32 limits. This repo archive needs ZIP64 support.`,
    );
  }
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
    uint16(0x0800), // general purpose bit flag: UTF-8 file names
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
    uint16(0x0800), // general purpose bit flag: UTF-8 file names
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

function writeBuffer(fd, buffer) {
  fs.writeSync(fd, buffer, 0, buffer.length);
}

function logProgress(current, total) {
  if (total < 500) {
    return;
  }

  if (current === total || current % 500 === 0) {
    console.log(`   Zipped ${current}/${total} files...`);
  }
}

function writeZipArchive(files, rootName, targetFilePath) {
  if (files.length > ZIP32_MAX_ENTRY_COUNT) {
    throw new Error(
      `❌ Error: ${files.length} files exceed standard ZIP32 entry limits. This repo archive needs ZIP64 support.`,
    );
  }

  const centralParts = [];
  let offset = 0;
  const fd = fs.openSync(targetFilePath, 'w');

  try {
    files.forEach((file, index) => {
      const stat = fs.statSync(file.fullPath);
      const rawData = fs.readFileSync(file.fullPath);
      const compressedData = zlib.deflateRawSync(rawData);
      const checksum = crc32(rawData);
      const zipEntryPath = toZipPath(path.join(rootName, file.relativePath));
      const fileNameBuffer = Buffer.from(zipEntryPath, 'utf8');
      const { dosDate, dosTime } = toDosDateTime(stat.mtime);

      assertZip32Value(rawData.length, `Uncompressed size for ${file.relativePath}`);
      assertZip32Value(compressedData.length, `Compressed size for ${file.relativePath}`);
      assertZip32Value(offset, `Archive offset before ${file.relativePath}`);

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

      writeBuffer(fd, localHeader);
      writeBuffer(fd, compressedData);
      centralParts.push(centralHeader);

      offset += localHeader.length + compressedData.length;
      assertZip32Value(offset, `Archive offset after ${file.relativePath}`);
      logProgress(index + 1, files.length);
    });

    const centralDirectoryOffset = offset;
    const centralDirectory = Buffer.concat(centralParts);
    const centralDirectorySize = centralDirectory.length;

    assertZip32Value(centralDirectoryOffset, 'Central directory offset');
    assertZip32Value(centralDirectorySize, 'Central directory size');

    const endOfCentralDirectory = createEndOfCentralDirectory({
      entryCount: files.length,
      centralDirectorySize,
      centralDirectoryOffset,
    });

    writeBuffer(fd, centralDirectory);
    writeBuffer(fd, endOfCentralDirectory);
  } finally {
    fs.closeSync(fd);
  }
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

try {
  writeZipArchive(files, rootName, outputFilePath);
} catch (error) {
  if (fs.existsSync(outputFilePath)) {
    fs.rmSync(outputFilePath, { force: true });
  }

  console.error(error.message);
  process.exit(1);
}

const totalInputBytes = files.reduce((total, file) => total + fs.statSync(file.fullPath).size, 0);
const outputBytes = fs.statSync(outputFilePath).size;

console.log('\n✅ Repository zip generated successfully!');
console.log(`📦 Output file: ${outputFilePath}`);
console.log(`📄 Files included: ${files.length}`);
console.log(`📦 node_modules included: ${includeNodeModules ? 'yes' : 'no'}`);
console.log(`🖼️  images included: ${includeImages ? 'yes' : 'no'}`);
console.log(`📥 Source bytes: ${totalInputBytes}`);
console.log(`📤 Zip bytes: ${outputBytes}\n`);
