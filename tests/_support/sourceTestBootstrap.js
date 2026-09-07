const Module = require('node:module');
const path = require('node:path');

const testsRoot = path.resolve(__dirname, '..');
const selfTestsRoot = path.join(testsRoot, 'self');
const repositoryRoot = path.resolve(testsRoot, '..');
const originalResolveFilename = Module._resolveFilename;
let resolverInstalled = false;

function isWithinDirectory(parentDirectory, candidatePath) {
  const relativePath = path.relative(parentDirectory, candidatePath);
  return (
    relativePath !== '' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== '..' &&
    !path.isAbsolute(relativePath)
  );
}

function sourceFileForTest(testFilePath) {
  const absoluteTestPath = path.resolve(testFilePath);
  if (!isWithinDirectory(selfTestsRoot, absoluteTestPath)) {
    throw new Error(`Self-test must live under ${selfTestsRoot}: ${absoluteTestPath}`);
  }

  return path.join(repositoryRoot, path.relative(selfTestsRoot, absoluteTestPath));
}

function sourceDirectoryForTest(testFilePath) {
  return path.dirname(sourceFileForTest(testFilePath));
}

function installRelativeSourceResolver() {
  if (resolverInstalled) {
    return;
  }

  resolverInstalled = true;
  Module._resolveFilename = function resolveSkyCommandSelfTestDependency(
    request,
    parent,
    isMain,
    options,
  ) {
    const isRelativeRequest =
      typeof request === 'string' && (request.startsWith('./') || request.startsWith('../'));
    const parentFilename = parent?.filename ? path.resolve(parent.filename) : null;

    if (isRelativeRequest && parentFilename && isWithinDirectory(selfTestsRoot, parentFilename)) {
      const sourceParentFilename = sourceFileForTest(parentFilename);
      const sourceParentDirectory = path.dirname(sourceParentFilename);
      const sourceParent = {
        ...parent,
        filename: sourceParentFilename,
        paths: Module._nodeModulePaths(sourceParentDirectory),
      };

      return originalResolveFilename.call(this, request, sourceParent, isMain, options);
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

installRelativeSourceResolver();

module.exports = {
  repositoryRoot,
  selfTestsRoot,
  sourceDirectoryForTest,
  sourceFileForTest,
};
