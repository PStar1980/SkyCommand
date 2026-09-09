const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BrowserTestExecutionError,
  buildPlaywrightArgs,
  collectBrowserArtifacts,
  getEffectiveTimeoutMs,
  launchWindowsInteractiveBrowserPresenter,
  normalizeBooleanSetting,
  resolveBrowserSpec,
  resolvePlaywrightCli,
  serializeBrowserTestParameters,
  shouldExposeBrowserArtifact,
} = require('./browserTestRunner');

const repositoryRoot = path.resolve(__dirname, '../../../../..');

const allowed = resolveBrowserSpec(
  repositoryRoot,
  'tests/browser/specs/workflows/workflowInitialization.spec.js',
);
assert.equal(
  allowed.relativePath,
  'tests/browser/specs/workflows/workflowInitialization.spec.js',
);

assert.throws(
  () => resolveBrowserSpec(repositoryRoot, '../package.json'),
  (error) =>
    error instanceof BrowserTestExecutionError &&
    error.details?.reasonCode === 'SKYCOMMAND_BROWSER_TEST_PATH_NOT_ALLOWED',
);
assert.throws(
  () => resolveBrowserSpec(repositoryRoot, 'tests/browser/helpers/skyCommandAuth.js'),
  (error) =>
    error instanceof BrowserTestExecutionError &&
    error.details?.reasonCode === 'SKYCOMMAND_BROWSER_TEST_PATH_NOT_ALLOWED',
);

assert.deepEqual(
  buildPlaywrightArgs({
    configPath: 'tests/browser/playwright.config.js',
    testPath: allowed.relativePath,
    grep: '@smoke',
  }),
  [
    'test',
    '--config',
    'tests/browser/playwright.config.js',
    '--workers=1',
    allowed.relativePath,
    '--project',
    'chromium',
    '--grep',
    '@smoke',
  ],
);


assert.deepEqual(
  buildPlaywrightArgs({
    configPath: 'tests/browser/playwright.config.js',
    testPath: allowed.relativePath,
    browserType: 'chromium',
    headed: true,
  }),
  [
    'test',
    '--config',
    'tests/browser/playwright.config.js',
    '--workers=1',
    allowed.relativePath,
    '--headed',
    '--project',
    'chromium',
  ],
);

assert.equal(shouldExposeBrowserArtifact('results/.playwright-artifacts-0/traces/resources/page.png'), false);
assert.equal(shouldExposeBrowserArtifact('report/data/screenshot.png'), false);
assert.equal(shouldExposeBrowserArtifact('results/workflow-initialization-open.png'), true);

const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-browser-artifacts-'));
try {
  fs.mkdirSync(path.join(artifactRoot, 'results', '.playwright-artifacts-0', 'traces', 'resources'), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, 'results', 'case'), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, 'report'), { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'results', '.playwright-artifacts-0', 'traces', 'resources', 'internal.png'), 'internal');
  fs.writeFileSync(path.join(artifactRoot, 'results', 'case', 'workflow-initialization-open.png'), 'screen');
  fs.writeFileSync(path.join(artifactRoot, 'report', 'index.html'), '<html></html>');
  const artifacts = collectBrowserArtifacts(artifactRoot, {
    tests: [{ artifacts: [{ kind: 'SCREENSHOT', name: 'Workflow Initialization Open', relativePath: 'results/case/workflow-initialization-open.png', contentType: 'image/png' }] }],
  });
  assert.equal(artifacts.some((artifact) => artifact.relativePath.includes('.playwright-artifacts-')), false);
  assert.equal(artifacts.find((artifact) => artifact.kind === 'SCREENSHOT')?.name, 'Workflow Initialization Open');
  assert.equal(artifacts.some((artifact) => artifact.kind === 'REPORT'), true);
} finally {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
}

assert.equal(getEffectiveTimeoutMs(30000, 600000), 30000);
assert.equal(getEffectiveTimeoutMs(900000, 600000), 600000);
assert.equal(serializeBrowserTestParameters({ workflowCode: 'repo-map-zip' }), '{"workflowCode":"repo-map-zip"}');
assert.equal(normalizeBooleanSetting(undefined, true), true);
assert.equal(normalizeBooleanSetting('', true), true);
assert.equal(normalizeBooleanSetting('true', false), true);
assert.equal(normalizeBooleanSetting('1', false), true);
assert.equal(normalizeBooleanSetting('false', true), false);
assert.equal(normalizeBooleanSetting('off', true), false);

const fakePlaywrightRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-playwright-cli-'));
try {
  const fakeCli = path.join(fakePlaywrightRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
  fs.writeFileSync(fakeCli, '// fake Playwright CLI\n');
  assert.equal(resolvePlaywrightCli(fakePlaywrightRoot), fakeCli);
  fs.rmSync(fakeCli, { force: true });
  assert.throws(
    () => resolvePlaywrightCli(fakePlaywrightRoot),
    (error) =>
      error instanceof BrowserTestExecutionError &&
      error.details?.reasonCode === 'SKYCOMMAND_BROWSER_PLAYWRIGHT_CLI_NOT_FOUND',
  );
} finally {
  fs.rmSync(fakePlaywrightRoot, { recursive: true, force: true });
}

const runnerSource = fs.readFileSync(path.join(repositoryRoot, 'packages/browser/src/browserTestRunner.js'), 'utf8');
assert.ok(runnerSource.includes('runChildProcess(process.execPath, [playwrightCli, ...args]'));
assert.ok(runnerSource.includes('launchWindowsInteractiveBrowserPresenter'));
assert.ok(runnerSource.includes('Show-SkyCommandPlaywrightWindow.ps1'));
assert.ok(runnerSource.includes("'-FocusDurationMs'"));
assert.ok(runnerSource.includes("SKYCOMMAND_BROWSER_INTERACTIVE_TOPMOST"));
assert.ok(runnerSource.includes("args.push('-Topmost')"));
const presenterSource = fs.readFileSync(path.join(repositoryRoot, 'scripts/powershell/Show-SkyCommandPlaywrightWindow.ps1'), 'utf8');
assert.ok(presenterSource.includes('SetWindowPos'));
assert.ok(presenterSource.includes('$hwndTopmost = [IntPtr](-1)'));
assert.ok(presenterSource.includes('[switch]$Topmost'));
if (process.platform !== 'win32') {
  assert.equal(launchWindowsInteractiveBrowserPresenter(repositoryRoot, process.pid), false);
}
assert.equal(runnerSource.includes("node_modules/.bin/playwright"), false);

console.log('[SkyCommand] Browser test runner self-test passed.');
