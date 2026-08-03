const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_TOOL_PACKAGE_RELATIVE_PATH,
  PACKAGES_RELATIVE_PATH,
  inspectSkycommandRepositoryPath,
  normalizeToolPackageRelativePath,
  resolvePackagesRoot,
  resolveToolPackageDestination,
} = require('./skycommandRepositoryService');

async function run() {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skycommand-repo-'));
  const packagesRoot = path.join(tempRoot, 'packages');

  try {
    await fs.promises.mkdir(packagesRoot, { recursive: true });

    const resolved = resolvePackagesRoot(tempRoot);
    assert.strictEqual(resolved.packagesRelativePath, PACKAGES_RELATIVE_PATH);
    assert.strictEqual(resolved.defaultToolPackageRelativePath, DEFAULT_TOOL_PACKAGE_RELATIVE_PATH);
    assert.strictEqual(resolved.packagesRoot, packagesRoot);

    const inspection = await inspectSkycommandRepositoryPath(tempRoot);
    assert.strictEqual(inspection.ready, true);
    assert.strictEqual(inspection.rootState.directory, true);
    assert.strictEqual(inspection.packagesState.directory, true);

    assert.strictEqual(
      normalizeToolPackageRelativePath('', { toolCode: 'example_tool' }),
      'packages/tools/custom/example_tool',
    );
    assert.strictEqual(
      normalizeToolPackageRelativePath('packages/git/example_tool'),
      'packages/git/example_tool',
    );

    const customDestination = resolveToolPackageDestination(
      tempRoot,
      'packages/files/generated_tool',
    );
    assert.strictEqual(
      customDestination.packagePhysicalPath,
      path.join(tempRoot, 'packages', 'files', 'generated_tool'),
    );

    assert.throws(
      () => normalizeToolPackageRelativePath('../outside'),
      (error) => error.details?.code === 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
    );
    assert.throws(
      () => normalizeToolPackageRelativePath('docs/example_tool'),
      (error) => error.details?.code === 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
    );

    const windowsResolved = resolvePackagesRoot('C:\\SkyEco System\\SkyCommand System\\SkyCommand');
    assert.strictEqual(windowsResolved.pathStyle, 'windows');
    assert.strictEqual(windowsResolved.packagesRoot, 'C:\\SkyEco System\\SkyCommand System\\SkyCommand\\packages');

    const missingInspection = await inspectSkycommandRepositoryPath(
      path.join(tempRoot, 'missing-repository'),
    );
    assert.strictEqual(missingInspection.ready, false);
    assert.strictEqual(missingInspection.rootState.exists, false);

    console.log('SkyCommand repository readiness and packages-path self-test passed.');
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
