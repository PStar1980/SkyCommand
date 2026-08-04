const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeRepositoryMap, parseRepositoryMapArgs } = require('./generateRepoMap');
const {
  REPOSITORY_MAP_OUTPUT_TYPE,
  createRepositoryMapToolResult,
} = require('./repositoryMapResult');

function run() {
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
  try {
    const parsed = parseRepositoryMapArgs([sourceRoot, 'Sample_RepoMap.md', outputRoot]);
    assert.equal(parsed.fileName, 'Sample_RepoMap.md');
    const result = executeRepositoryMap([sourceRoot, 'Sample_RepoMap.md', outputRoot]);
    assert.equal(result.ok, true);
    assert.equal(result.filesDocumented, 2);
    assert.ok(result.directoriesDocumented >= 2);
    assert.ok(result.outputBytes > 0);
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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('[SkyCommand] Repository map result self-test passed.');
}
if (require.main === module) run();
module.exports = { run };
