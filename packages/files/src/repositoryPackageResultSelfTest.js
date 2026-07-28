const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  executeRepositoryZip,
  parseRepositoryZipArgs,
} = require('./generateRepoZip');
const {
  REPOSITORY_PACKAGE_OUTPUT_TYPE,
  createRepositoryPackageToolResult,
} = require('./repositoryPackageResult');

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-repo-package-'));
  const sourceRoot = path.join(tempRoot, 'sample-repo');
  const outputRoot = path.join(tempRoot, 'output');

  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  const preservedBackgroundPath = path.join(
    sourceRoot,
    'apps',
    'admin-web',
    'src',
    'assets',
    'sky-net-background.png',
  );
  fs.mkdirSync(path.dirname(preservedBackgroundPath), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'README.md'), '# Sample\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'src', 'index.js'), 'console.log("hello");\n', 'utf8');
  fs.writeFileSync(preservedBackgroundPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(sourceRoot, '.env'), 'SECRET=do-not-package\n', 'utf8');

  try {
    const parsed = parseRepositoryZipArgs([sourceRoot, 'sample-package', outputRoot]);
    assert.strictEqual(parsed.fileName, 'sample-package.zip');
    assert.strictEqual(parsed.includeImages, false);
    assert.strictEqual(parsed.includeNodeModules, false);

    const result = executeRepositoryZip([sourceRoot, 'sample-package', outputRoot]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.filesIncluded, 3);
    assert.ok(result.sourceBytes > 0);
    assert.ok(result.archiveBytes > 0);
    assert.ok(fs.existsSync(result.artifactPath));
    assert.strictEqual(fs.readFileSync(result.artifactPath, { encoding: null }).subarray(0, 2).toString(), 'PK');

    const toolResult = createRepositoryPackageToolResult(result);
    assert.strictEqual(toolResult.success, true);
    assert.strictEqual(toolResult.outputType, REPOSITORY_PACKAGE_OUTPUT_TYPE);
    assert.strictEqual(toolResult.output.outcome, 'CREATED');
    assert.strictEqual(toolResult.output.filesIncluded, 3);
    assert.strictEqual(toolResult.output.options.sensitiveEnvironmentFilesExcluded, true);
    assert.ok(toolResult.output.compressionRatio > 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(toolResult.output, 'stdout'));
    assert.ok(!Object.prototype.hasOwnProperty.call(toolResult.output, 'stderr'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('[SkyCommand] Repository package result self-test passed.');
}

if (require.main === module) {
  run();
}

module.exports = { run };
