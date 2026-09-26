'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ATTESTATION_SCHEMA = 'SKYCOMMAND_CODEX_ARTIFACT_ATTESTATION_V1';
const PACKAGE_PATHS = [
  'node_modules/@openai/codex',
  'node_modules/@openai/codex-linux-x64',
];

function updateField(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

async function hashPackageEntry(rootPath, relativePath, hash) {
  const absolutePath = path.join(rootPath, relativePath);
  const stat = await fs.promises.lstat(absolutePath);
  if (stat.isSymbolicLink()) throw new Error('Codex package artifact contains a symbolic link.');

  if (stat.isDirectory()) {
    updateField(hash, `directory:${relativePath}:${stat.mode & 0o7777}`);
    const entries = await fs.promises.readdir(absolutePath);
    entries.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const entry of entries) {
      await hashPackageEntry(rootPath, path.join(relativePath, entry), hash);
    }
    return;
  }

  if (!stat.isFile()) throw new Error('Codex package artifact contains an unsupported filesystem entry.');
  updateField(hash, `file:${relativePath}:${stat.mode & 0o7777}:${stat.size}`);
  for await (const chunk of fs.createReadStream(absolutePath)) hash.update(chunk);
}

async function installedPackageArtifactSha256(rootPath = process.cwd()) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of PACKAGE_PATHS) await hashPackageEntry(rootPath, relativePath, hash);
  return hash.digest('hex').toUpperCase();
}

async function buildPackageArtifactAttestation(rootPath = process.cwd()) {
  const sourceLockPath = path.join(rootPath, 'docker/codex-agent-runtime/package-lock.json');
  const runtimePackagePath = path.join(rootPath, 'docker/codex-agent-runtime/package.json');
  const installedLockPath = path.join(rootPath, 'node_modules/.package-lock.json');
  const sourceLockBytes = await fs.promises.readFile(sourceLockPath);
  const sourceLock = JSON.parse(sourceLockBytes.toString('utf8'));
  const runtimePackageStat = await fs.promises.lstat(runtimePackagePath);
  if (!runtimePackageStat.isFile() || runtimePackageStat.isSymbolicLink()) {
    throw new Error('Codex runtime package identity is not a regular file.');
  }
  const runtimePackage = JSON.parse(await fs.promises.readFile(runtimePackagePath, 'utf8'));
  const certification = runtimePackage.skycommandRuntimeCertification;
  const installedLock = JSON.parse(await fs.promises.readFile(installedLockPath, 'utf8'));
  const wrapperManifest = JSON.parse(await fs.promises.readFile(path.join(rootPath, PACKAGE_PATHS[0], 'package.json'), 'utf8'));
  const linuxManifest = JSON.parse(await fs.promises.readFile(path.join(rootPath, PACKAGE_PATHS[1], 'package.json'), 'utf8'));
  const expectedWrapper = sourceLock.packages?.['node_modules/@openai/codex'];
  const expectedLinux = sourceLock.packages?.['node_modules/@openai/codex-linux-x64'];
  const installedWrapper = installedLock.packages?.['node_modules/@openai/codex'];
  const installedLinux = installedLock.packages?.['node_modules/@openai/codex-linux-x64'];
  const validDigest = (value) => typeof value === 'string' && /^[0-9A-F]{64}$/i.test(value);

  if (
    certification?.schema !== 'SKYCOMMAND_CODEX_RUNTIME_CERTIFICATION_V1'
    || !certification.packageVersion
    || !validDigest(certification.installedArtifactSha256)
    || !validDigest(certification.primaryProtocolSchemaDigest)
    || !validDigest(certification.versionedProtocolSchemaDigests?.v2)
    || !expectedWrapper?.version
    || !expectedLinux?.version
    || runtimePackage.dependencies?.['@openai/codex'] !== expectedWrapper.version
    || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(String(expectedWrapper?.integrity || ''))
    || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(String(expectedLinux?.integrity || ''))
    || expectedWrapper.version !== certification.packageVersion
    || expectedWrapper.integrity !== certification.wrapperPackageIntegrity
    || expectedLinux.version !== `${certification.packageVersion}-linux-x64`
    || expectedLinux.integrity !== certification.linuxX64PackageIntegrity
    || installedWrapper?.version !== expectedWrapper.version
    || installedWrapper?.integrity !== expectedWrapper.integrity
    || installedLinux?.version !== expectedLinux.version
    || installedLinux?.integrity !== expectedLinux.integrity
    || wrapperManifest?.name !== '@openai/codex'
    || wrapperManifest?.version !== expectedWrapper.version
    || linuxManifest?.name !== '@openai/codex'
    || linuxManifest?.version !== expectedLinux.version
  ) throw new Error('Installed Codex package metadata does not match the source lock.');

  const installedArtifactSha256 = await installedPackageArtifactSha256(rootPath);
  if (installedArtifactSha256 !== certification.installedArtifactSha256.toUpperCase()) {
    throw new Error('Installed Codex artifact differs from its source certification.');
  }
  return {
    schema: ATTESTATION_SCHEMA,
    packageVersion: expectedWrapper.version,
    packageIntegrity: expectedLinux.integrity,
    sourcePackageLockSha256: crypto.createHash('sha256').update(sourceLockBytes).digest('hex').toUpperCase(),
    installedArtifactSha256,
  };
}

async function writeBuildAttestation(rootPath = process.cwd()) {
  const attestation = await buildPackageArtifactAttestation(rootPath);
  await fs.promises.writeFile(
    path.join(rootPath, 'codex-runtime-artifact-attestation.json'),
    `${JSON.stringify(attestation)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o444 },
  );
  return attestation;
}

if (require.main === module) {
  if (process.argv[2] !== '--write-build-attestation') {
    process.stderr.write('A valid Codex artifact-attestation build mode is required.\n');
    process.exitCode = 2;
  } else {
    writeBuildAttestation().catch(() => {
      process.stderr.write('Codex package artifact attestation failed.\n');
      process.exitCode = 1;
    });
  }
}

module.exports = {
  ATTESTATION_SCHEMA,
  buildPackageArtifactAttestation,
  installedPackageArtifactSha256,
  writeBuildAttestation,
};
