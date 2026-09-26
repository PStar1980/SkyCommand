'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const {
  CONTRACT,
  ProbeError,
  installedArtifactSha256,
  packageArchiveIntegrityMismatchAlgorithm,
  sha256,
  validateContract,
  verifyPackageLock,
  verifyTarballBytes,
} = require('./contract');

const execFileAsync = promisify(execFile);
const ROOT = '/opt/codex-compat-probe';
const REGISTRY = 'https://registry.npmjs.org/';
const SAFE_PACKAGE_ROLES = new Set([
  'baseline-wrapper', 'baseline-platform', 'candidate-wrapper', 'candidate-platform',
]);
const SAFE_INTEGRITY_ALGORITHMS = new Set(['SHA512', 'SHA1']);

function projectSafeFailure(error) {
  const failureCode = error instanceof ProbeError && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code : 'PACKAGE_SETUP_FAILED';
  if (failureCode !== 'PACKAGE_ARCHIVE_INTEGRITY_MISMATCH') return { failureCode };

  const details = error.safeDetails;
  if (!details || !SAFE_PACKAGE_ROLES.has(details.packageRole)
    || details.packageName !== '@openai/codex'
    || typeof details.expectedPackageVersion !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(details.expectedPackageVersion)
    || !SAFE_INTEGRITY_ALGORITHMS.has(details.integrityAlgorithm)) return { failureCode };

  return {
    packageRole: details.packageRole,
    packageName: details.packageName,
    expectedPackageVersion: details.expectedPackageVersion,
    integrityAlgorithm: details.integrityAlgorithm,
    failureCode,
  };
}

function npmEnvironment(cachePath) {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp/npm-home',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    NPM_CONFIG_REGISTRY: REGISTRY,
    NPM_CONFIG_CACHE: cachePath,
    NPM_CONFIG_USERCONFIG: '/dev/null',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
  };
}

async function runNpm(args, cwd, env) {
  try {
    await execFileAsync('npm', args, { cwd, env, timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true });
  } catch (_error) {
    throw new ProbeError('PACKAGE_ACQUISITION_FAILED');
  }
}

async function packAndVerify(spec, expected, cachePath, packageIdentity) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-compat-pack-'));
  try {
    await runNpm(['pack', spec, '--json', '--pack-destination', directory, `--registry=${REGISTRY}`], directory, npmEnvironment(cachePath));
    const tarballs = (await fs.promises.readdir(directory)).filter((name) => name.endsWith('.tgz'));
    if (tarballs.length !== 1) throw new ProbeError('PACKAGE_ARCHIVE_COUNT_INVALID');
    const bytes = await fs.promises.readFile(path.join(directory, tarballs[0]));
    if (!verifyTarballBytes(bytes, expected)) {
      throw new ProbeError('PACKAGE_ARCHIVE_INTEGRITY_MISMATCH', {
        ...packageIdentity,
        integrityAlgorithm: packageArchiveIntegrityMismatchAlgorithm(bytes, expected) || 'SHA512',
      });
    }
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

async function readJson(filePath, failureCode) {
  try { return JSON.parse(await fs.promises.readFile(filePath, 'utf8')); }
  catch (_error) { throw new ProbeError(failureCode); }
}

async function packageSet(name, identity, cachePath) {
  const directory = path.join(ROOT, 'packages', name);
  await fs.promises.mkdir(directory, { recursive: true });
  const packageManifest = {
    name: `skycommand-codex-compat-${name}`,
    version: '1.0.0',
    private: true,
    dependencies: { '@openai/codex': identity.wrapperVersion },
  };
  await fs.promises.writeFile(path.join(directory, 'package.json'), `${JSON.stringify(packageManifest, null, 2)}\n`, { mode: 0o444 });

  await runNpm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${REGISTRY}`], directory, npmEnvironment(cachePath));
  const lockPath = path.join(directory, 'package-lock.json');
  const sourceLock = await readJson(lockPath, 'PACKAGE_LOCK_UNAVAILABLE');
  verifyPackageLock(sourceLock, identity);
  await runNpm(['ci', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${REGISTRY}`], directory, npmEnvironment(cachePath));

  const installedLock = await readJson(path.join(directory, 'node_modules/.package-lock.json'), 'INSTALLED_PACKAGE_LOCK_UNAVAILABLE');
  verifyPackageLock(installedLock, identity, { requireRootDependency: false, requireAliasDependency: false });
  const wrapperManifest = await readJson(path.join(directory, 'node_modules/@openai/codex/package.json'), 'INSTALLED_PACKAGE_MANIFEST_UNAVAILABLE');
  const platformManifest = await readJson(path.join(directory, `node_modules/${identity.platformAlias}/package.json`), 'INSTALLED_PACKAGE_MANIFEST_UNAVAILABLE');
  if (wrapperManifest.name !== '@openai/codex' || wrapperManifest.version !== identity.wrapperVersion
    || platformManifest.name !== '@openai/codex' || platformManifest.version !== identity.platformVersion) {
    throw new ProbeError('INSTALLED_PACKAGE_IDENTITY_MISMATCH');
  }

  return {
    wrapperVersion: identity.wrapperVersion,
    wrapperIntegrity: identity.wrapperIntegrity,
    platformVersion: identity.platformVersion,
    platformIntegrity: identity.platformIntegrity,
    packageLockSha256: sha256(await fs.promises.readFile(lockPath)),
    installedArtifactSha256: await installedArtifactSha256(directory),
  };
}

async function prepare() {
  validateContract();
  const cachePath = '/tmp/npm-cache';
  await fs.promises.mkdir('/tmp/npm-home', { recursive: true });
  await fs.promises.mkdir(cachePath, { recursive: true });

  for (const identity of [CONTRACT.baseline, CONTRACT.candidate]) {
    const artifacts = [
      {
        role: identity === CONTRACT.baseline ? 'baseline-wrapper' : 'candidate-wrapper',
        version: identity.wrapperVersion,
        integrity: identity.wrapperIntegrity,
        shasum: identity.wrapperShasum || null,
      },
      {
        role: identity === CONTRACT.baseline ? 'baseline-platform' : 'candidate-platform',
        version: identity.platformVersion,
        integrity: identity.platformIntegrity,
        shasum: identity.platformShasum || null,
      },
    ];
    for (const artifact of artifacts) {
      await packAndVerify(
        `@openai/codex@${artifact.version}`,
        { integrity: artifact.integrity, shasum: artifact.shasum },
        cachePath,
        {
          packageRole: artifact.role,
          packageName: '@openai/codex',
          expectedPackageVersion: artifact.version,
        },
      );
    }
  }

  const attestations = {
    schema: 'SKYCOMMAND_CODEX_COMPAT_PROBE_PACKAGE_ATTESTATIONS_V1',
    baseline: await packageSet('baseline', CONTRACT.baseline, cachePath),
    candidate: await packageSet('candidate', CONTRACT.candidate, cachePath),
  };
  await fs.promises.writeFile(path.join(ROOT, 'package-attestations.json'), `${JSON.stringify(attestations, null, 2)}\n`, { mode: 0o444 });
}

if (require.main === module) {
  prepare().catch((error) => {
    process.stderr.write(`${JSON.stringify(projectSafeFailure(error))}\n`);
    process.exitCode = 1;
  });
}

module.exports = { packAndVerify, prepare, projectSafeFailure };
