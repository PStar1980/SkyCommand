const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  executeRepositoryZip,
  flattenFiles,
  parseRepositoryZipArgs,
  resolveZipIoConcurrency,
  scanDirectory,
} = require('./generateRepoZip');
const {
  REPOSITORY_PACKAGE_OUTPUT_TYPE,
  createRepositoryPackageToolResult,
} = require('./repositoryPackageResult');

async function run() {
  assert.strictEqual(resolveZipIoConcurrency({}), 16);
  assert.strictEqual(resolveZipIoConcurrency({ SKYCOMMAND_REPOSITORY_ZIP_IO_CONCURRENCY: '8' }), 8);
  assert.strictEqual(resolveZipIoConcurrency({ SKYCOMMAND_REPOSITORY_ZIP_IO_CONCURRENCY: '1000' }), 64);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-repo-package-'));
  const sourceRoot = path.join(tempRoot, 'sample-repo');
  const outputRoot = path.join(tempRoot, 'output');

  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  const assetRoot = path.join(sourceRoot, 'apps', 'admin-web', 'src', 'assets');
  const publicRoot = path.join(sourceRoot, 'apps', 'admin-web', 'public');
  fs.mkdirSync(assetRoot, { recursive: true });
  fs.mkdirSync(publicRoot, { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.venv', 'Lib', 'site-packages'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.pytest_cache', 'v', 'cache'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'README.md'), '# Sample\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'src', 'index.js'), 'console.log("hello");\n', 'utf8');
  fs.writeFileSync(path.join(assetRoot, 'sky-net-background.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(assetRoot, 'optional-preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(publicRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, '.env'), 'SECRET=do-not-package\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, '.venv', 'Lib', 'site-packages', 'heavy.py'), 'ignored\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, '.pytest_cache', 'v', 'cache', 'nodeids'), '[]\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, '__pycache__', 'module.pyc'), Buffer.from([0x00]));

  const loadRepositoryArtifactConfiguration = async (repositorySelection) => {
    assert.strictEqual(repositorySelection, 'SampleRepo');
    return {
      repoCode: 'SampleRepo',
      repoName: 'Sample Repository',
      rootPath: sourceRoot,
      repoZipFileName: 'sample-package',
      repoZipOutputPath: outputRoot,
    };
  };

  try {
    const parsed = await parseRepositoryZipArgs(['SampleRepo'], {
      loadRepositoryArtifactConfiguration,
    });
    assert.strictEqual(parsed.fileName, 'sample-package.zip');
    assert.strictEqual(parsed.includeImages, false);
    assert.strictEqual(parsed.includeNodeModules, false);

    const defaultFiles = flattenFiles(scanDirectory(sourceRoot, sourceRoot, parsed));
    assert.ok(defaultFiles.some((file) => file.relativePath.endsWith(path.join('public', 'favicon.svg'))));
    assert.ok(!defaultFiles.some((file) => path.extname(file.fullPath).toLowerCase() === '.png'));
    assert.ok(!defaultFiles.some((file) => path.extname(file.fullPath).toLowerCase() === '.jpg'));
    assert.ok(!defaultFiles.some((file) => file.relativePath.includes('.venv')));
    assert.ok(!defaultFiles.some((file) => file.relativePath.includes('.pytest_cache')));
    assert.ok(!defaultFiles.some((file) => file.relativePath.includes('__pycache__')));

    const includeImagesParsed = await parseRepositoryZipArgs(
      ['SampleRepo', '--include-images'],
      { loadRepositoryArtifactConfiguration },
    );
    const includeImageFiles = flattenFiles(
      scanDirectory(sourceRoot, sourceRoot, includeImagesParsed),
    );
    assert.ok(includeImageFiles.some((file) => path.extname(file.fullPath).toLowerCase() === '.jpg'));
    assert.ok(!includeImageFiles.some((file) => path.extname(file.fullPath).toLowerCase() === '.png'));

    const result = await executeRepositoryZip(['SampleRepo'], {
      loadRepositoryArtifactConfiguration,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.repositoryName, 'Sample Repository');
    assert.strictEqual(result.filesIncluded, 3);
    assert.ok(result.sourceBytes > 0);
    assert.ok(result.archiveBytes > 0);
    assert.ok(result.performanceTelemetry.instrumentedTotalMs >= 0);
    assert.ok(result.performanceTelemetry.phases.some((phase) => phase.code === 'ARCHIVE_BUILD'));
    assert.strictEqual(result.performanceTelemetry.archiveBuildBreakdown.ioConcurrency, 16);
    assert.ok(
      result.performanceTelemetry.archiveBuildBreakdown.phases.some(
        (phase) => phase.code === 'SOURCE_FILE_READS',
      ),
    );
    assert.ok(fs.existsSync(result.artifactPath));
    assert.strictEqual(fs.readFileSync(result.artifactPath, { encoding: null }).subarray(0, 2).toString(), 'PK');

    const toolResult = createRepositoryPackageToolResult(result);
    assert.strictEqual(toolResult.success, true);
    assert.strictEqual(toolResult.outputType, REPOSITORY_PACKAGE_OUTPUT_TYPE);
    assert.strictEqual(toolResult.output.outcome, 'CREATED');
    assert.strictEqual(toolResult.output.filesIncluded, 3);
    assert.strictEqual(toolResult.output.options.sensitiveEnvironmentFilesExcluded, true);
    assert.ok(toolResult.output.compressionRatio > 0);
    assert.ok(toolResult.output.performanceTelemetry.instrumentedTotalMs >= 0);
    assert.strictEqual(
      toolResult.output.performanceTelemetry.archiveBuildBreakdown.ioConcurrency,
      16,
    );
    assert.ok(!Object.prototype.hasOwnProperty.call(toolResult.output, 'stdout'));
    assert.ok(!Object.prototype.hasOwnProperty.call(toolResult.output, 'stderr'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('[SkyCommand] Repository package result self-test passed.');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { run };
