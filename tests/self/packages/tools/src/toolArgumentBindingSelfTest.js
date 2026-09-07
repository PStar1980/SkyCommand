const { repositoryRoot } = require('../../../../_support/sourceTestBootstrap.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ARGUMENT_MODES,
  bindParameterArgument,
  normalizeArgumentMode,
  validateCliFlag,
} = require('./toolArgumentBinding');

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

assert.equal(normalizeArgumentMode(), ARGUMENT_MODES.POSITIONAL);
assert.equal(normalizeArgumentMode('flag'), ARGUMENT_MODES.FLAG);
assert.equal(validateCliFlag('--include-tests'), '--include-tests');

assert.deepEqual(
  bindParameterArgument(
    { parameter_name: 'repoName', param_type_code: 'repo', argument_mode: 'POSITIONAL' },
    'SkyCommand',
  ),
  ['SkyCommand'],
);

const includeTestsParameter = {
  parameter_name: 'includeTests',
  param_type_code: 'boolean',
  argument_mode: 'FLAG',
  cli_flag: '--include-tests',
};

assert.deepEqual(bindParameterArgument(includeTestsParameter, 'true'), ['--include-tests']);
assert.deepEqual(bindParameterArgument(includeTestsParameter, true), ['--include-tests']);
assert.deepEqual(bindParameterArgument(includeTestsParameter, 'false'), []);
assert.deepEqual(bindParameterArgument(includeTestsParameter, false), []);
assert.deepEqual(bindParameterArgument(includeTestsParameter, null), []);

assert.throws(
  () =>
    bindParameterArgument(
      {
        parameter_name: 'badFlag',
        param_type_code: 'string',
        argument_mode: 'FLAG',
        cli_flag: '--bad-flag',
      },
      'true',
    ),
  /must use Boolean type/,
);
assert.throws(() => validateCliFlag('include-tests'), /Invalid CLI flag binding/);

const migration = read('packages/db_build/src/migrations/00112__tool_parameter_cli_binding.sql');
assert.match(migration, /argument_mode TEXT NOT NULL DEFAULT 'POSITIONAL'/);
assert.match(migration, /cli_flag TEXT/);
assert.match(migration, /'includeTests'/);
assert.match(migration, /'FLAG'/);
assert.match(migration, /'--include-tests'/);

for (const relativePath of [
  'apps/api/src/services/scriptExecutionService.js',
  'apps/worker/src/jobs/workerToolExecutionService.js',
  'packages/core/src/SkyCommand_Core.js',
]) {
  const source = read(relativePath);
  assert.match(source, /bindParameterArgument/);
}

const manageToolsSource = read('apps/admin-web/src/pages/ManageTools.jsx');
assert.match(manageToolsSource, /Command-line parameters/);
assert.match(manageToolsSource, /Argument mode/);
assert.match(manageToolsSource, /Boolean flag/);
assert.match(manageToolsSource, /CLI flag/);

console.log('Tool argument binding self-test passed.');
