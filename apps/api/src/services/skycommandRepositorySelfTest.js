const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MANAGED_TOOLS_RELATIVE_PATH,
  inspectSkycommandRepositoryPath,
  resolveManagedToolsRoot,
} = require('./skycommandRepositoryService');

async function run() {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skycommand-repo-'));
  const managedRoot = path.join(tempRoot, 'packages', 'tools', 'custom');

  try {
    await fs.promises.mkdir(managedRoot, { recursive: true });

    const resolved = resolveManagedToolsRoot(tempRoot);
    assert.strictEqual(resolved.managedToolsRelativePath, MANAGED_TOOLS_RELATIVE_PATH);
    assert.strictEqual(resolved.managedToolsRoot, managedRoot);

    const inspection = await inspectSkycommandRepositoryPath(tempRoot);
    assert.strictEqual(inspection.ready, true);
    assert.strictEqual(inspection.rootState.directory, true);
    assert.strictEqual(inspection.managedRootState.directory, true);

    const windowsResolved = resolveManagedToolsRoot('C:\\SkyCommand\\SkyServer');
    assert.strictEqual(windowsResolved.pathStyle, 'windows');
    assert.strictEqual(
      windowsResolved.managedToolsRoot,
      'C:\\SkyCommand\\SkyServer\\packages\\tools\\custom',
    );

    const missingInspection = await inspectSkycommandRepositoryPath(
      path.join(tempRoot, 'missing-repository'),
    );
    assert.strictEqual(missingInspection.ready, false);
    assert.strictEqual(missingInspection.rootState.exists, false);

    console.log('SkyCommand repository readiness self-test passed.');
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
