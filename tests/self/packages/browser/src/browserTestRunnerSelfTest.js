const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  BrowserTestExecutionError,
  buildPlaywrightArgs,
  getEffectiveTimeoutMs,
  resolveBrowserSpec,
  serializeBrowserTestParameters,
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


assert.equal(getEffectiveTimeoutMs(30000, 600000), 30000);
assert.equal(getEffectiveTimeoutMs(900000, 600000), 600000);
assert.equal(serializeBrowserTestParameters({ workflowCode: 'repo-map-zip' }), '{"workflowCode":"repo-map-zip"}');

console.log('[SkyCommand] Browser test runner self-test passed.');
