'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONTRACT_PROFILE = 'codex-0.156.1';
const CONTRACT_PROFILE_PATHS = Object.freeze({
  'codex-0.156.1': path.join(__dirname, 'contract.json'),
  'codex-0.154.0': path.join(__dirname, 'candidates', 'codex-0.154.0', 'contract.json'),
});
const CONTRACT_PROFILE_EXPECTATIONS = Object.freeze({
  'codex-0.156.1': Object.freeze({
    wrapperVersion: '0.156.1',
    wrapperIntegrity: 'sha512-nI1iVl/n2SO2lSvlwEsJx63zdSI4C4Me2gR7AG0OWMJiGSakz2tY2hx43E39Zq5aEoeB5bZjJXzp5Sqhog6vyA==',
    wrapperShasum: '21a6a1f6226562c56ccece8f7ebea5bda1fe3768',
    platformVersion: '0.156.1-linux-x64',
    platformIntegrity: 'sha512-2ePo0wgOcnONKsuzp8vBjOmNY+IdsKaouaDDIdiKq9HOWNuV/GI22OeXft2A/1GaoL71ictO0/pLAsCEnQ6wew==',
    platformShasum: '04927933fda85cbe2ad2cdd5b62f92875a8ab8b2',
    optionalDependencySpec: 'npm:@openai/codex@0.156.1-linux-x64',
  }),
  'codex-0.154.0': Object.freeze({
    wrapperVersion: '0.154.0',
    wrapperIntegrity: 'sha512-FV/x1OHXYv/ifjf3mXj9ThTTAWcUZN6cGIRQRhRxkKNOPuImu1WW0c8ev1vUkE9XGH90dEnYG1tBjIkxRikg0w==',
    wrapperShasum: 'eb1ec011cca427c606ef6cd4814014e59a1c3d70',
    platformVersion: '0.154.0-linux-x64',
    platformIntegrity: 'sha512-a4FI3A8sGtwGrOqltrPbrS2hajrHQG591EwmRfiRoLMb10VxdBtUGW4gu6IJVYENiYGA7k3P4jlRHEoCZU/s9Q==',
    platformShasum: '9e93bbf0906338c2d1ebbeb9de3b0a4ef7123e55',
    optionalDependencySpec: 'npm:@openai/codex@0.154.0-linux-x64',
  }),
});
const ACTIVE_CONTRACT_PROFILE = process.env.SKYCOMMAND_CODEX_COMPAT_PROFILE || DEFAULT_CONTRACT_PROFILE;
let CONTRACT;
const PACKAGE_PATHS = Object.freeze([
  'node_modules/@openai/codex',
  'node_modules/@openai/codex-linux-x64',
]);
const ALLOWED_RPC_REQUEST_METHODS = Object.freeze(['initialize', 'account/read']);

class ProbeError extends Error {
  constructor(code, safeDetails = null) {
    super(code);
    this.name = 'ProbeError';
    this.code = code;
    this.safeDetails = safeDetails;
  }
}

function fail(code) {
  throw new ProbeError(code);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function isProbeRpcMethodAllowed(method) {
  return ALLOWED_RPC_REQUEST_METHODS.includes(method);
}

function verifyTarballBytes(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || !expected || !isValidSha512Integrity(expected.integrity)) return false;
  const integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
  const shasum = crypto.createHash('sha1').update(bytes).digest('hex');
  return integrity === expected.integrity
    && (!expected.shasum || shasum === expected.shasum.toLowerCase());
}

function packageArchiveIntegrityMismatchAlgorithm(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || !expected || !isValidSha512Integrity(expected.integrity)) return null;
  const integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
  if (integrity !== expected.integrity) return 'SHA512';
  if (expected.shasum
    && crypto.createHash('sha1').update(bytes).digest('hex') !== expected.shasum.toLowerCase()) return 'SHA1';
  return null;
}

function isValidSha512Integrity(value) {
  return typeof value === 'string'
    && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value)
    && Buffer.from(value.slice('sha512-'.length), 'base64').length === 64;
}

function registryTarballIsPinned(resolved, packageVersion) {
  try {
    const url = new URL(resolved);
    return url.protocol === 'https:'
      && url.hostname === 'registry.npmjs.org'
      && url.pathname === `/@openai/codex/-/codex-${packageVersion}.tgz`;
  } catch (_error) {
    return false;
  }
}

function validateContract(contract = CONTRACT, profile = ACTIVE_CONTRACT_PROFILE) {
  const validIntegrity = isValidSha512Integrity;
  const validShasum = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
  const expectedCandidate = CONTRACT_PROFILE_EXPECTATIONS[profile];
  const validIdentity = (identity) => identity
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(identity.wrapperVersion)
    && identity.platformVersion === `${identity.wrapperVersion}-linux-x64`
    && identity.platformAlias === '@openai/codex-linux-x64'
    && validIntegrity(identity.wrapperIntegrity)
    && validIntegrity(identity.platformIntegrity)
    && (!identity.wrapperShasum || validShasum(identity.wrapperShasum))
    && (!identity.platformShasum || validShasum(identity.platformShasum));

  if (!expectedCandidate) fail('PROBE_PROFILE_INVALID');
  if (contract?.schema !== 'SKYCOMMAND_CODEX_COMPAT_PROBE_CONTRACT_V1'
    || contract.platform?.os !== 'linux' || contract.platform?.cpu !== 'x64'
    || !validIdentity(contract.baseline) || !validIdentity(contract.candidate)
    || contract.baseline.wrapperVersion !== '0.155.0-alpha.9.2'
    || contract.baseline.platformVersion !== '0.155.0-alpha.9.2-linux-x64'
    || contract.baseline.wrapperIntegrity !== 'sha512-n3fVPDCeGLa0d/vmx/3QdOEn1+b0Phsj9/CqMHFbrW3GMxNy6dMvnhdM8/x3Wg+OBDCudkmQNt8ryapRsl9twQ=='
    || contract.baseline.platformIntegrity !== 'sha512-tnUaq2ejXz8afrEODlmlph3yoZlSXgOFj8mFww2+kyG6rep1sKaelqkyHB2L3V/vYVHzF3gfiurZWwh7+ClebA=='
    || contract.candidate.wrapperVersion !== expectedCandidate.wrapperVersion
    || contract.candidate.platformVersion !== expectedCandidate.platformVersion
    || contract.candidate.optionalDependencySpec !== expectedCandidate.optionalDependencySpec
    || contract.candidate.wrapperShasum !== expectedCandidate.wrapperShasum
    || contract.candidate.platformShasum !== expectedCandidate.platformShasum
    || contract.candidate.wrapperIntegrity !== expectedCandidate.wrapperIntegrity
    || contract.candidate.platformIntegrity !== expectedCandidate.platformIntegrity) {
    fail('PROBE_CONTRACT_INVALID');
  }
  return true;
}

function loadContractProfile(profile) {
  const filePath = CONTRACT_PROFILE_PATHS[profile];
  if (!filePath) fail('PROBE_PROFILE_INVALID');
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    fail('PROBE_CONTRACT_INVALID');
  }
  validateContract(contract, profile);
  return contract;
}

CONTRACT = Object.freeze(loadContractProfile(ACTIVE_CONTRACT_PROFILE));

function verifyPackageLock(lock, identity, options = {}) {
  if (!lock || lock.lockfileVersion !== 3 || !identity) fail('PACKAGE_LOCK_INVALID');
  const packages = lock.packages;
  const wrapper = packages?.['node_modules/@openai/codex'];
  const platform = packages?.[`node_modules/${identity.platformAlias}`];
  const root = packages?.[''];
  const expectedOptional = `npm:@openai/codex@${identity.platformVersion}`;

  if (
    (options.requireRootDependency !== false && root?.dependencies?.['@openai/codex'] !== identity.wrapperVersion)
    || (root?.dependencies?.['@openai/codex'] !== undefined
      && root.dependencies['@openai/codex'] !== identity.wrapperVersion)
    || wrapper?.version !== identity.wrapperVersion
    || wrapper?.integrity !== identity.wrapperIntegrity
    || !isValidSha512Integrity(wrapper?.integrity)
    || !registryTarballIsPinned(wrapper?.resolved, identity.wrapperVersion)
    || (options.requireAliasDependency !== false
      && wrapper?.optionalDependencies?.[identity.platformAlias] !== expectedOptional)
    || platform?.name !== '@openai/codex'
    || platform?.version !== identity.platformVersion
    || platform?.integrity !== identity.platformIntegrity
    || !isValidSha512Integrity(platform?.integrity)
    || !registryTarballIsPinned(platform?.resolved, identity.platformVersion)
    || !Array.isArray(platform?.os) || platform.os.length !== 1 || platform.os[0] !== 'linux'
    || !Array.isArray(platform?.cpu) || platform.cpu.length !== 1 || platform.cpu[0] !== 'x64'
  ) fail('PACKAGE_LOCK_IDENTITY_MISMATCH');

  return true;
}

function updateHashField(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

async function hashPackageEntry(rootPath, relativePath, hash) {
  const absolutePath = path.join(rootPath, relativePath);
  const stat = await fs.promises.lstat(absolutePath);
  if (stat.isSymbolicLink()) fail('INSTALLED_ARTIFACT_SYMLINK');

  if (stat.isDirectory()) {
    updateHashField(hash, `directory:${relativePath}:${stat.mode & 0o7777}`);
    const entries = (await fs.promises.readdir(absolutePath)).sort();
    for (const entry of entries) await hashPackageEntry(rootPath, path.join(relativePath, entry), hash);
    return;
  }

  if (!stat.isFile()) fail('INSTALLED_ARTIFACT_ENTRY_INVALID');
  updateHashField(hash, `file:${relativePath}:${stat.mode & 0o7777}:${stat.size}`);
  for await (const chunk of fs.createReadStream(absolutePath)) hash.update(chunk);
}

async function installedArtifactSha256(packageRoot) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of PACKAGE_PATHS) await hashPackageEntry(packageRoot, relativePath, hash);
  return hash.digest('hex').toUpperCase();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalJson(value));
}

function hasSchemaSurface(schemaFiles, method, discriminator = null) {
  const contains = (value, expected) => {
    if (typeof value === 'string') return value === expected;
    if (Array.isArray(value)) return value.some((item) => contains(item, expected));
    if (value && typeof value === 'object') return Object.entries(value)
      .some(([key, child]) => key === expected || contains(child, expected));
    return false;
  };
  const documents = (schemaFiles || []).map((schema) => schema.document);
  return documents.some((document) => contains(document, method))
    && (!discriminator || documents.some((document) => contains(document, discriminator)));
}

function diffValue(before, after, file, pointer, output, maxDifferences) {
  if (output.length >= maxDifferences) return;
  if (stableJson(before) === stableJson(after)) return;
  const beforeObject = before !== null && typeof before === 'object';
  const afterObject = after !== null && typeof after === 'object';
  if (beforeObject && afterObject && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      if (output.length >= maxDifferences) break;
      const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1');
      const childPath = `${pointer}/${escaped}`;
      if (!Object.hasOwn(before, key)) output.push({ file, path: childPath, change: 'ADDED' });
      else if (!Object.hasOwn(after, key)) output.push({ file, path: childPath, change: 'REMOVED' });
      else diffValue(before[key], after[key], file, childPath, output, maxDifferences);
    }
    return;
  }
  output.push({ file, path: pointer || '/', change: 'CHANGED' });
}

function compareSchemaBundles(baselineFiles, candidateFiles, maxDifferences = 300) {
  const baseline = new Map((baselineFiles || []).map((item) => [item.name, item.document]));
  const candidate = new Map((candidateFiles || []).map((item) => [item.name, item.document]));
  const changes = [];
  const names = [...new Set([...baseline.keys(), ...candidate.keys()])].sort();
  for (const name of names) {
    if (changes.length >= maxDifferences) break;
    if (!baseline.has(name)) changes.push({ file: name, path: '/', change: 'FILE_ADDED' });
    else if (!candidate.has(name)) changes.push({ file: name, path: '/', change: 'FILE_REMOVED' });
    else diffValue(baseline.get(name), candidate.get(name), name, '', changes, maxDifferences);
  }
  return { changes, truncated: changes.length >= maxDifferences };
}

function validateRpcEnvelope(message, expectedId) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { valid: false, failureCode: 'RPC_ENVELOPE_INVALID' };
  }
  if (!Number.isSafeInteger(message.id) || message.id !== expectedId) {
    return { valid: false, failureCode: 'RPC_RESPONSE_ID_MISMATCH' };
  }
  const hasResult = Object.hasOwn(message, 'result');
  const hasError = Object.hasOwn(message, 'error');
  if (hasResult === hasError) return { valid: false, failureCode: 'RPC_ENVELOPE_INVALID' };
  if (hasError) {
    if (!message.error || typeof message.error !== 'object' || Array.isArray(message.error)
      || !Number.isSafeInteger(message.error.code)) {
      return { valid: false, failureCode: 'RPC_ERROR_ENVELOPE_INVALID' };
    }
    return { valid: true, kind: 'ERROR', id: message.id, code: message.error.code };
  }
  return { valid: true, kind: 'RESULT', id: message.id, result: message.result };
}

function validateProbeContainment(snapshot) {
  const expectedForbiddenMounts = [
    '/var/lib/codex', '/run/codex-runtime-control', '/workspace', '/app',
    '/var/run/docker.sock', '/run/docker.sock', '/var/lib/docker.sock',
  ];
  const valid = snapshot?.uid > 0
    && snapshot.capabilitiesEffective === '0000000000000000'
    && snapshot.rootReadOnly === true
    && snapshot.homeIsTmpfs === true
    && snapshot.tempIsTmpfs === true
    && snapshot.interfaces?.length === 1
    && snapshot.interfaces[0] === 'lo'
    && snapshot.defaultRoutes === 0
    && expectedForbiddenMounts.every((mount) => !snapshot.mountTargets?.some((target) => (
      target === mount || (typeof target === 'string' && target.startsWith(`${mount}/`))
    )))
    && snapshot.executionDisabled === true
    && snapshot.productionCredentialsPresent === false;
  return {
    passed: valid,
    failureCodes: valid ? [] : ['ISOLATION_INVARIANT_FAILED'],
  };
}

function projectAccountRead(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { parseable: false, accountState: 'UNKNOWN', requiresOpenaiAuth: null };
  }
  const accountValid = result.account === null || (result.account && typeof result.account === 'object' && !Array.isArray(result.account));
  const authValid = typeof result.requiresOpenaiAuth === 'boolean';
  return {
    parseable: accountValid && authValid,
    accountState: !accountValid ? 'UNKNOWN' : (result.account === null ? 'ACCOUNT_NULL' : 'ACCOUNT_PRESENT'),
    requiresOpenaiAuth: authValid ? result.requiresOpenaiAuth : null,
  };
}

module.exports = {
  CONTRACT,
  ACTIVE_CONTRACT_PROFILE,
  CONTRACT_PROFILE_IDS: Object.freeze(Object.keys(CONTRACT_PROFILE_PATHS)),
  PACKAGE_PATHS,
  ALLOWED_RPC_REQUEST_METHODS,
  ProbeError,
  compareSchemaBundles,
  hasSchemaSurface,
  installedArtifactSha256,
  isProbeRpcMethodAllowed,
  isValidSha512Integrity,
  loadContractProfile,
  packageArchiveIntegrityMismatchAlgorithm,
  projectAccountRead,
  sha256,
  stableJson,
  validateContract,
  validateProbeContainment,
  validateRpcEnvelope,
  verifyPackageLock,
  verifyTarballBytes,
};
