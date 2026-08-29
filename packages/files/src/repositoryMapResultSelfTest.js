const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeRepositoryMap, parseRepositoryMapArgs } = require('./generateRepoMap');
const {
  REPOSITORY_MAP_OUTPUT_TYPE,
  createRepositoryMapToolResult,
} = require('./repositoryMapResult');

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-repo-map-'));
  const sourceRoot = path.join(tempRoot, 'sample-repo');
  const outputRoot = path.join(tempRoot, 'docs');
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'node_modules', 'ignored'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.venv', 'Lib', 'site-packages'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.mypy_cache', '3.12'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'README.md'), '# Sample\n');
  fs.writeFileSync(path.join(sourceRoot, 'src', 'index.js'), 'console.log("hello");\n');
  fs.writeFileSync(path.join(sourceRoot, '.env'), 'SECRET=x\n');
  fs.writeFileSync(path.join(sourceRoot, '.venv', 'Lib', 'site-packages', 'heavy.py'), 'ignored\n');
  fs.writeFileSync(path.join(sourceRoot, '.mypy_cache', '3.12', 'cache.db'), 'ignored\n');
  fs.writeFileSync(path.join(sourceRoot, '__pycache__', 'module.pyc'), Buffer.from([0x00]));

  const loadRepositoryArtifactConfiguration = async (repositorySelection) => {
    assert.equal(repositorySelection, 'SampleRepo');
    return {
      repoCode: 'SampleRepo',
      repoName: 'Sample Repository',
      rootPath: sourceRoot,
      repoMapFileName: 'Sample_RepoMap.md',
      repoMapOutputPath: outputRoot,
    };
  };

  try {
    const parsed = await parseRepositoryMapArgs(['SampleRepo'], {
      loadRepositoryArtifactConfiguration,
    });
    assert.equal(parsed.fileName, 'Sample_RepoMap.md');
    assert.equal(parsed.location, path.resolve(sourceRoot));
    assert.equal(parsed.outputPath, path.resolve(outputRoot));

    const result = await executeRepositoryMap(['SampleRepo'], {
      loadRepositoryArtifactConfiguration,
    });
    assert.equal(result.ok, true);
    assert.equal(result.repositoryName, 'Sample Repository');
    assert.equal(result.filesDocumented, 2);
    assert.ok(result.directoriesDocumented >= 2);
    assert.ok(result.outputBytes > 0);
    assert.ok(result.performanceTelemetry.instrumentedTotalMs >= 0);
    assert.ok(
      result.performanceTelemetry.phases.some((phase) => phase.code === 'REPOSITORY_SCAN'),
    );
    assert.equal(result.extensionCounts['.js'], 1);
    assert.equal(result.extensionCounts['.md'], 1);
    const content = fs.readFileSync(result.artifactPath, 'utf8');
    assert.match(content, /README\.md/);
    assert.doesNotMatch(content, /node_modules/);
    assert.doesNotMatch(content, /\.venv/);
    assert.doesNotMatch(content, /\.mypy_cache/);
    assert.doesNotMatch(content, /__pycache__/);
    assert.doesNotMatch(content, /\.env/);
    const toolResult = createRepositoryMapToolResult(result);
    assert.equal(toolResult.outputType, REPOSITORY_MAP_OUTPUT_TYPE);
    assert.equal(toolResult.output.filesDocumented, 2);
    assert.equal(toolResult.output.policy.sensitiveEnvironmentFilesExcluded, true);
    assert.ok(toolResult.output.performanceTelemetry.instrumentedTotalMs >= 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('[SkyCommand] Repository map result self-test passed.');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { run };
