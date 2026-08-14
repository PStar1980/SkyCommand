#!/usr/bin/env node

/**
 * Generates a compact repository zip for project handoff and emits a structured
 * repository_package_summary.v1 ToolResult when launched by SkyCommand.
 *
 * Human-readable console output remains unchanged for direct CLI and Run Tools.
 * Workflow consumers receive only the structured result through the shared
 * ToolResult transport. Repository root, archive file name, and output path
 * are resolved from the selected SkyCommand repository record/profile path.
 *
 * Usage: node generateRepoZip.js <repository> [options]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  loadRepositoryArtifactConfiguration,
} = require('./repositoryArtifactConfiguration');
const {
  createRepositoryPackageFailureToolResult,
  createRepositoryPackageToolResult,
} = require('./repositoryPackageResult');

const TOOL_CODE = 'repo_zip_generate';
const OUTPUT_TYPE = 'repository_package_summary.v1';

const ZIP32_MAX_VALUE = 0xffffffff;
const ZIP32_MAX_ENTRY_COUNT = 0xffff;
const DEPENDENCY_FOLDER_NAME = 'node_modules';

const SUPPORTED_OPTIONS = new Set([
  '--include-node-modules',
  '--exclude-node-modules',
  '--include-images',
  '--slim',
]);

const ALWAYS_IGNORED_DIRECTORIES = new Set([
  '.git',
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

// PNG assets are intentionally never copied into compact handoff archives.
// They can be large, are available in the live repository, and should be shared
// separately when a reviewer specifically needs them. This invariant applies
// even when --include-images is supplied or a future preserved-image path is added.
const ALWAYS_EXCLUDED_FILE_EXTENSIONS = new Set(['.png']);

const PRESERVED_IMAGE_RELATIVE_PATHS = new Set(['apps/admin-web/public/favicon.svg']);

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

  return path.extname(normalized).toLowerCase() === '.zip' ? normalized : `${normalized}.zip`;
}

async function parseRepositoryZipArgs(args = [], dependencies = {}) {
  const rawArgs = Array.isArray(args) ? args.map(String) : [];
  const optionArgs = rawArgs.filter((arg) => arg.startsWith('--'));
  const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('--'));
  const unknownOptions = optionArgs.filter((option) => !SUPPORTED_OPTIONS.has(option));

  if (unknownOptions.length > 0) {
    throw new Error(
      `❌ Error: Unsupported option(s): ${unknownOptions.join(', ')}. Supported options: ${[
        ...SUPPORTED_OPTIONS,
      ].join(', ')}`,
    );
  }

  if (positionalArgs.length !== 1) {
    throw new Error('❌ Error: You must provide exactly one repository.');
  }

  const loadRepository =
    dependencies.loadRepositoryArtifactConfiguration || loadRepositoryArtifactConfiguration;
  const repository = await loadRepository(positionalArgs[0]);
  const configuredRootPath = String(repository.rootPath || '').trim();
  const configuredOutputPath = String(repository.repoZipOutputPath || '').trim();

  if (!String(repository.repoZipFileName || '').trim()) {
    throw new Error(
      `❌ Error: Repository '${repository.repoCode || positionalArgs[0]}' does not have a Repository Zip File Name configured.`,
    );
  }

  const location = path.resolve(configuredRootPath);
  const fileName = normalizeOutputFileName(repository.repoZipFileName);
  const outputPath = configuredOutputPath ? path.resolve(configuredOutputPath) : location;

  if (!configuredRootPath || !fs.existsSync(location)) {
    throw new Error(`❌ Error: The configured repository path does not exist:\n   ${location}`);
  }

  const locationStats = fs.statSync(location);

  if (!locationStats.isDirectory()) {
    throw new Error(`❌ Error: The configured repository path must be a directory:\n   ${location}`);
  }

  return {
    repositoryCode: repository.repoCode,
    repositoryName: repository.repoName,
    location,
    fileName,
    outputPath,
    outputFilePath: path.resolve(outputPath, fileName),
    includeNodeModules: optionArgs.includes('--include-node-modules'),
    includeImages: optionArgs.includes('--include-images'),
  };
}

function normalizeComparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeRelativeAssetPath(fullPath, location) {
  return path.relative(location, fullPath).split(path.sep).join('/').toLowerCase();
}

function isWithinNodeModules(fullPath, location) {
  const relativePath = path.relative(location, fullPath);

  if (!relativePath || relativePath.startsWith('..')) {
    return false;
  }

  return relativePath
    .split(path.sep)
    .map((part) => part.toLowerCase())
    .includes(DEPENDENCY_FOLDER_NAME);
}

function shouldIgnoreDirectory(entryName, fullPath, options) {
  const lowerName = entryName.toLowerCase();

  if (lowerName === DEPENDENCY_FOLDER_NAME) {
    return !options.includeNodeModules;
  }

  if (ALWAYS_IGNORED_DIRECTORIES.has(lowerName)) {
    return true;
  }

  return (
    !isWithinNodeModules(fullPath, options.location) &&
    WORKSPACE_IGNORED_DIRECTORIES.has(lowerName)
  );
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

function shouldSkipFile(fullPath, options) {
  if (normalizeComparablePath(fullPath) === normalizeComparablePath(options.outputFilePath)) {
    return true;
  }

  const fileNameOnly = path.basename(fullPath).toLowerCase();

  if (SENSITIVE_ENV_FILES.has(fileNameOnly)) {
    return true;
  }

  const extension = path.extname(fullPath).toLowerCase();
  const relativeAssetPath = normalizeRelativeAssetPath(fullPath, options.location);

  if (ALWAYS_EXCLUDED_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  if (
    !options.includeImages &&
    IMAGE_FILE_EXTENSIONS.has(extension) &&
    !PRESERVED_IMAGE_RELATIVE_PATHS.has(relativeAssetPath)
  ) {
    return true;
  }

  if (fileNameOnly === 'change.log') {
    return false;
  }

  return ['.zip', '.log', '.patch'].includes(extension);
}

function scanDirectory(dir, baseDir, options) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return sortEntries(
    entries
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (shouldIgnoreDirectory(entry.name, fullPath, options)) {
            return null;
          }

          return {
            type: 'directory',
            name: entry.name,
            children: scanDirectory(fullPath, baseDir, options),
          };
        }

        if (!entry.isFile() || shouldSkipFile(fullPath, options)) {
          return null;
        }

        return {
          type: 'file',
          name: entry.name,
          fullPath,
          relativePath: path.relative(baseDir, fullPath),
        };
      })
      .filter(Boolean),
  );
}

function flattenFiles(items, files = []) {
  for (const item of items) {
    if (item.type === 'file') {
      files.push(item);
    } else if (item.type === 'directory') {
      flattenFiles(item.children, files);
    }
  }

  return files;
}

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

  return {
    dosTime: (hours << 11) | (minutes << 5) | seconds,
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
  };
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
    uint32(0x04034b50),
    uint16(20),
    uint16(0x0800),
    uint16(8),
    uint16(dosTime),
    uint16(dosDate),
    uint32(crc),
    uint32(compressedSize),
    uint32(uncompressedSize),
    uint16(fileNameBuffer.length),
    uint16(0),
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
    uint32(0x02014b50),
    uint16(20),
    uint16(20),
    uint16(0x0800),
    uint16(8),
    uint16(dosTime),
    uint16(dosDate),
    uint32(crc),
    uint32(compressedSize),
    uint32(uncompressedSize),
    uint16(fileNameBuffer.length),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(localHeaderOffset),
    fileNameBuffer,
  ]);
}

function createEndOfCentralDirectory({ entryCount, centralDirectorySize, centralDirectoryOffset }) {
  return Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entryCount),
    uint16(entryCount),
    uint32(centralDirectorySize),
    uint32(centralDirectoryOffset),
    uint16(0),
  ]);
}

function writeBuffer(fd, buffer) {
  fs.writeSync(fd, buffer, 0, buffer.length);
}

function logProgress(current, total) {
  if (total >= 500 && (current === total || current % 500 === 0)) {
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

    writeBuffer(fd, centralDirectory);
    writeBuffer(
      fd,
      createEndOfCentralDirectory({
        entryCount: files.length,
        centralDirectorySize,
        centralDirectoryOffset,
      }),
    );
  } finally {
    fs.closeSync(fd);
  }
}

async function executeRepositoryZip(args = [], dependencies = {}) {
  const startedAt = new Date().toISOString();
  const options = await parseRepositoryZipArgs(args, dependencies);
  const rootName = path.basename(options.location);
  const structure = scanDirectory(options.location, options.location, options);
  const files = flattenFiles(structure);

  if (!fs.existsSync(options.outputPath)) {
    fs.mkdirSync(options.outputPath, { recursive: true });
  }

  try {
    writeZipArchive(files, rootName, options.outputFilePath);
  } catch (error) {
    if (fs.existsSync(options.outputFilePath)) {
      fs.rmSync(options.outputFilePath, { force: true });
    }
    throw error;
  }

  const completedAt = new Date().toISOString();
  const sourceBytes = files.reduce(
    (total, file) => total + fs.statSync(file.fullPath).size,
    0,
  );
  const archiveBytes = fs.statSync(options.outputFilePath).size;

  return {
    ok: true,
    repositoryName: options.repositoryName || rootName,
    repositoryRoot: options.location,
    fileName: options.fileName,
    artifactPath: options.outputFilePath,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    filesIncluded: files.length,
    sourceBytes,
    archiveBytes,
    nodeModulesIncluded: options.includeNodeModules,
    imagesIncluded: options.includeImages,
    sensitiveEnvironmentFilesExcluded: true,
    generatedArtifactsExcluded: true,
  };
}

function printRepositoryZipResult(result) {
  console.log('\n✅ Repository zip generated successfully!');
  console.log(`📦 Output file: ${result.artifactPath}`);
  console.log(`📄 Files included: ${result.filesIncluded}`);
  console.log(`📦 node_modules included: ${result.nodeModulesIncluded ? 'yes' : 'no'}`);
  console.log(`🖼️  images included: ${result.imagesIncluded ? 'yes' : 'no'}`);
  console.log(`📥 Source bytes: ${result.sourceBytes}`);
  console.log(`📤 Zip bytes: ${result.archiveBytes}\n`);
}

async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();

  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: OUTPUT_TYPE,
    args,
    execute: executeRepositoryZip,
    createToolResult: createRepositoryPackageToolResult,
    createFailureToolResult: (error) =>
      createRepositoryPackageFailureToolResult({
        error,
        startedAt,
        completedAt: new Date().toISOString(),
      }),
    renderConsole: printRepositoryZipResult,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  OUTPUT_TYPE,
  TOOL_CODE,
  executeRepositoryZip,
  flattenFiles,
  main,
  normalizeOutputFileName,
  parseRepositoryZipArgs,
  printRepositoryZipResult,
  scanDirectory,
  writeZipArchive,
};
