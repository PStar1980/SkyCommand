#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');
const {
  loadRepositoryArtifactConfiguration,
} = require('../../files/src/repositoryArtifactConfiguration');

const TOOL_CODE = 'secret_leak_gate';
const OUTPUT_TYPE = 'secret_leak_gate_summary.v1';
const RULES_VERSION = '1.0.0';
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100000;
const MAX_FINDINGS = 500;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP32_MAX_VALUE = 0xffffffff;

const SENSITIVE_ENV_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
]);

const SAFE_ENV_EXAMPLE_BASENAMES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.local.example',
  '.env.development.example',
  '.env.production.example',
  '.env.test.example',
]);

const AUTH_SESSION_BASENAMES = new Set([
  'auth.json',
  'credential.json',
  'credentials.json',
  'token.json',
  'tokens.json',
  'session.json',
  'sessions.json',
  'cookies.json',
  'secrets.json',
  'service-account.json',
  'application_default_credentials.json',
  'accesstokens.json',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
]);

const KEY_CONTEXT_PATTERN =
  /\b(?:token|secret|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|connection[_-]?string|device[_-]?code|user[_-]?code|enrollment[_-]?code|authorization)\b/i;
const STRONG_KEY_CONTEXT_PATTERN =
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|connection[_-]?string|device[_-]?code|user[_-]?code|enrollment[_-]?code|authorization)\b/i;
const HASH_CONTEXT_PATTERN = /\b(?:sha(?:1|224|256|384|512)?|hash|checksum|digest|integrity|fingerprint)\b/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_HASH_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{96}|[0-9a-f]{128})$/i;

const PROVIDER_PATTERNS = Object.freeze([
  {
    ruleId: 'OPENAI_TOKEN',
    category: 'PROVIDER_TOKEN',
    severity: 'HIGH',
    pattern: /\bsk-(?:proj|svcacct|admin)?-[A-Za-z0-9_-]{16,}\b/g,
    remediation: 'Remove the provider token and rotate it outside the repository.',
  },
  {
    ruleId: 'GITHUB_TOKEN',
    category: 'PROVIDER_TOKEN',
    severity: 'HIGH',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    remediation: 'Remove the GitHub token and revoke or rotate it immediately.',
  },
  {
    ruleId: 'SLACK_TOKEN',
    category: 'PROVIDER_TOKEN',
    severity: 'HIGH',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
    remediation: 'Remove the Slack token and revoke or rotate it immediately.',
  },
  {
    ruleId: 'AWS_ACCESS_KEY',
    category: 'PROVIDER_TOKEN',
    severity: 'HIGH',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    remediation: 'Remove the cloud access key and deactivate or rotate it.',
  },
  {
    ruleId: 'GOOGLE_ACCESS_TOKEN',
    category: 'PROVIDER_TOKEN',
    severity: 'HIGH',
    pattern: /(?<![A-Za-z0-9+/=_-])(?:ya29\.[A-Za-z0-9._-]{20,}|1\/\/[A-Za-z0-9._-]{20,})(?![A-Za-z0-9+/=_-])/g,
    remediation: 'Remove the Google token and revoke or rotate it.',
  },
  {
    ruleId: 'JWT_TOKEN',
    category: 'SESSION_TOKEN',
    severity: 'HIGH',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    remediation: 'Remove the session token and invalidate the session.',
  },
  {
    ruleId: 'BEARER_TOKEN',
    category: 'SESSION_TOKEN',
    severity: 'HIGH',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
    remediation: 'Remove the bearer token and revoke or rotate it.',
  },

]);

const PRIVATE_KEY_MARKER_PATTERN = new RegExp(
  [
    '-----BEGIN(?: [A-Z0-9]+)* PRIVATE ',
    'KEY-----',
    '|-----BEGIN OPENSSH PRIVATE ',
    'KEY-----',
  ].join(''),
);
const CODE_ASSIGNMENT_EXTENSIONS = new Set([
  '.cjs', '.cs', '.go', '.java', '.js', '.jsx', '.mjs', '.php', '.py', '.rb', '.rs', '.ts', '.tsx',
]);
const BINARY_ARCHIVE_EXTENSIONS = new Set([
  '.7z', '.avi', '.bin', '.bmp', '.class', '.dll', '.doc', '.docx', '.eot', '.exe', '.gif',
  '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.pdf', '.png', '.ppt',
  '.pptx', '.so', '.tar', '.tif', '.tiff', '.ttf', '.wav', '.webp', '.woff', '.woff2', '.xls',
  '.xlsx', '.zip',
]);

class SecretLeakGateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SecretLeakGateError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isWindowsPath() {
  return process.platform === 'win32';
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return isWindowsPath() ? resolved.toLowerCase() : resolved;
}

function isWithinDirectory(candidatePath, directoryPath) {
  const relative = path.relative(comparablePath(directoryPath), comparablePath(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativePath(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//, '');
}

function redactPotentialSecret(value) {
  let redacted = String(value || '');
  for (const provider of PROVIDER_PATTERNS) {
    redacted = redacted.replace(provider.pattern, '[REDACTED]');
  }
  redacted = redacted.replace(/\b(?:token|secret|password|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/gi, (match) => {
    const separator = match.match(/\s*[:=]\s*/)?.[0] || '=';
    return `${match.slice(0, match.indexOf(separator))}${separator}[REDACTED]`;
  });
  return redacted;
}

function safePathForOutput(value) {
  const normalized = normalizeRelativePath(value).replace(/[\u0000-\u001f\u007f]/g, '?');
  return redactPotentialSecret(normalized).slice(0, 2000);
}

function safeFindingPath(scope, relativePath, archiveEntry = null) {
  const pathValue = safePathForOutput(relativePath);
  return archiveEntry ? `${pathValue}::${safePathForOutput(archiveEntry)}` : pathValue;
}

function normalizeSeverityCounts(findings = []) {
  return findings.reduce(
    (counts, finding) => {
      const severity = finding.severity === 'HIGH' ? 'HIGH' : 'MEDIUM';
      counts[severity] += 1;
      return counts;
    },
    { HIGH: 0, MEDIUM: 0 },
  );
}

function isPlaceholderValue(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
  if (!normalized) return true;
  if (/^(?:null|undefined|false|true|0|none|nil)$/i.test(normalized)) return true;
  if (/^(?:\$\{[^}]+\}|\{\{.*\}\}|<[^>]+>)$/.test(normalized)) return true;
  if (/^(?:your|my|replace|change|example|sample|dummy|fake|test|redacted|must[_-]?not[_-]?be|not[_-]?a[_-]?secret|secret[_-]?here|token[_-]?here|password[_-]?here)/i.test(normalized)) return true;
  if (/^(?:changeme|change-me|foobar|loremipsum|password|secret|token|xxxx+|\*+)$/.test(normalized.toLowerCase())) return true;
  if (UUID_PATTERN.test(normalized)) return true;
  return false;
}

function isHashLikeValue(value, key, line) {
  const normalized = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (UUID_PATTERN.test(normalized)) return true;
  if (!HEX_HASH_PATTERN.test(normalized)) return false;
  return !/(?:secret|token|password|api[_-]?key|credential)/i.test(String(key || '')) || HASH_CONTEXT_PATTERN.test(line);
}

function shannonEntropy(value) {
  const text = String(value || '');
  if (!text) return 0;
  const frequencies = new Map();
  for (const character of text) frequencies.set(character, (frequencies.get(character) || 0) + 1);
  return [...frequencies.values()].reduce((entropy, count) => {
    const probability = count / text.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function normalizeCredentialComparableValue(value) {
  const normalized = String(value || '').trim().replace(/^['"`]|['"`]$/g, '').trim();
  return normalized.replace(/^Bearer\s+/i, '').trim();
}

function containsDynamicInterpolation(value) {
  const normalized = String(value || '');
  return /\$\{[^}]+\}|(?:^|[^A-Za-z0-9_])\$[A-Za-z_][A-Za-z0-9_]*/.test(normalized);
}

function looksCredentialLike(value, key, line) {
  const normalized = String(value || '').trim().replace(/^['"`]|['"`]$/g, '');
  const comparable = normalizeCredentialComparableValue(normalized);
  if (
    isPlaceholderValue(comparable) ||
    containsDynamicInterpolation(normalized) ||
    isHashLikeValue(comparable, key, line)
  ) return false;
  const keyText = String(key || '');
  if (/device[_-]?code|user[_-]?code|enrollment[_-]?code|password|passwd/i.test(keyText)) {
    return comparable.length >= 6;
  }
  if (STRONG_KEY_CONTEXT_PATTERN.test(keyText)) {
    return comparable.length >= 12 || shannonEntropy(comparable) >= 3.0;
  }
  return comparable.length >= 16 && shannonEntropy(comparable) >= 3.3;
}

function isCodeAssignmentContext(context = {}) {
  const candidate = String(context.archiveEntry || context.relativePath || '').toLowerCase();
  return CODE_ASSIGNMENT_EXTENSIONS.has(path.extname(candidate));
}

function isDynamicCredentialExpression(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (/[()[\]{}?]/.test(normalized)) return true;
  if (/^(?:process\.env|environment\.|req\.|request\.|row\.|body\.|config\.|event\.|this\.)/i.test(normalized)) return true;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\??\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(normalized)) return true;
  return false;
}

function credentialAssignmentPattern(context = {}) {
  if (isCodeAssignmentContext(context)) {
    return /(?:^|[,{;])\s*(?:(?:const|let|var)\s+)?(?:["']?([A-Za-z][A-Za-z0-9_.-]{1,80})["']?)\s*(?::|=)\s*(?:["'`]([^"'`]*)["'`]|([^\s,;}]+))/g;
  }
  return /(?:["']?([A-Za-z][A-Za-z0-9_.-]{1,80})["']?)\s*(?::|=)\s*(?:["'`]([^"'`]*)["'`]|([^\s,;}]+))/g;
}

function isTextualArchiveEntry(name, content) {
  const extension = path.extname(String(name || '').toLowerCase());
  if (BINARY_ARCHIVE_EXTENSIONS.has(extension)) return false;
  const sample = Buffer.from(content || Buffer.alloc(0)).subarray(0, 8192);
  if (sample.includes(0)) return false;
  let controls = 0;
  for (const byte of sample) {
    if ((byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte)) || byte === 0x7f) controls += 1;
  }
  return sample.length === 0 || controls / sample.length <= 0.01;
}

function addFinding(state, {
  scope,
  relativePath,
  archiveEntry = null,
  lineNumber = null,
  ruleId,
  category,
  severity = 'HIGH',
  remediation,
}) {
  const outputPath = safeFindingPath(scope, relativePath, archiveEntry);
  const dedupeKey = [scope, outputPath, lineNumber || '', ruleId].join('|');
  if (state.findingKeys.has(dedupeKey)) return;
  if (state.findings.length >= MAX_FINDINGS) {
    throw new SecretLeakGateError(
      'SECRET_LEAK_GATE_FINDINGS_LIMIT',
      'Secret Leak Gate found more findings than it can safely report.',
    );
  }
  state.findingKeys.add(dedupeKey);
  state.findings.push({
    scope,
    path: outputPath,
    archiveEntry: archiveEntry ? safePathForOutput(archiveEntry) : null,
    lineNumber: lineNumber === null ? null : Number(lineNumber),
    ruleId: String(ruleId),
    category: String(category),
    severity: severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
    valueRedacted: true,
    remediation: String(remediation || 'Remove the credential material before promotion.'),
  });
}

function addPathFinding(state, scope, relativePath) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  const basename = normalized.split('/').pop() || normalized;
  if (SAFE_ENV_EXAMPLE_BASENAMES.has(basename)) return;
  if (SENSITIVE_ENV_BASENAMES.has(basename)) {
    addFinding(state, {
      scope,
      relativePath,
      ruleId: 'TRACKED_SECRET_ENV_FILE',
      category: 'SECRET_CONFIGURATION_FILE',
      severity: 'HIGH',
      remediation: 'Remove the tracked environment file and use local secret configuration.',
    });
    return;
  }
  if (AUTH_SESSION_BASENAMES.has(basename)) {
    addFinding(state, {
      scope,
      relativePath,
      ruleId: 'AUTH_SESSION_FILE',
      category: 'AUTH_SESSION_FILE',
      severity: 'HIGH',
      remediation: 'Remove the authentication or session file from the repository.',
    });
    return;
  }
  if (/(?:^|\/)(?:\.aws\/credentials|\.config\/gcloud\/application_default_credentials\.json|\.docker\/config\.json)(?:$|\/)/i.test(normalized)) {
    addFinding(state, {
      scope,
      relativePath,
      ruleId: 'CREDENTIAL_HOME_FILE',
      category: 'AUTH_SESSION_FILE',
      severity: 'HIGH',
      remediation: 'Remove the provider credential-home file from the repository.',
    });
    return;
  }
  if (/(?:^|\/)(?:id_rsa|id_ed25519|private(?:[-_].*)?\.key|server(?:[-_].*)?\.key|client(?:[-_].*)?\.key)$/i.test(normalized)) {
    addFinding(state, {
      scope,
      relativePath,
      ruleId: 'PRIVATE_KEY_FILE_NAME',
      category: 'PRIVATE_KEY_MATERIAL',
      severity: 'HIGH',
      remediation: 'Remove the private key file and rotate the associated credential.',
    });
    return;
  }
  if (/(?:\.p12|\.pfx)$/i.test(basename)) {
    addFinding(state, {
      scope,
      relativePath,
      ruleId: 'CERTIFICATE_BUNDLE_FILE',
      category: 'PRIVATE_KEY_MATERIAL',
      severity: 'HIGH',
      remediation: 'Remove the certificate bundle unless it is proven to contain no private material.',
    });
  }
}

function scanTextBuffer(buffer, context, state) {
  const text = Buffer.from(buffer).toString('utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const provider of PROVIDER_PATTERNS) {
      provider.pattern.lastIndex = 0;
      let providerMatch;
      let providerFinding = false;
      while ((providerMatch = provider.pattern.exec(line)) !== null) {
        if (isPlaceholderValue(normalizeCredentialComparableValue(providerMatch[0]))) continue;
        providerFinding = true;
        break;
      }
      if (providerFinding) {
        addFinding(state, {
          scope: context.scope,
          relativePath: context.relativePath,
          archiveEntry: context.archiveEntry,
          lineNumber,
          ruleId: provider.ruleId,
          category: provider.category,
          severity: provider.severity,
          remediation: provider.remediation,
        });
      }
    }

    if (PRIVATE_KEY_MARKER_PATTERN.test(line)) {
      addFinding(state, {
        scope: context.scope,
        relativePath: context.relativePath,
        archiveEntry: context.archiveEntry,
        lineNumber,
        ruleId: 'PRIVATE_KEY_MARKER',
        category: 'PRIVATE_KEY_MATERIAL',
        severity: 'HIGH',
        remediation: 'Remove the private key material and rotate the associated credential.',
      });
    }

    if (/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s@]+@/i.test(line)) {
      addFinding(state, {
        scope: context.scope,
        relativePath: context.relativePath,
        archiveEntry: context.archiveEntry,
        lineNumber,
        ruleId: 'CREDENTIAL_CONNECTION_STRING',
        category: 'DATABASE_CREDENTIAL',
        severity: 'HIGH',
        remediation: 'Remove credentials from the connection string and use secret configuration.',
      });
    }

    const assignmentPattern = credentialAssignmentPattern(context);
    let match;
    while ((match = assignmentPattern.exec(line)) !== null) {
      const key = match[1] || '';
      const quotedValue = match[2] !== undefined;
      const value = match[2] ?? match[3] ?? '';
      if (!KEY_CONTEXT_PATTERN.test(key)) continue;
      if (isCodeAssignmentContext(context) && !quotedValue) continue;
      if (!quotedValue && isDynamicCredentialExpression(value)) continue;
      if (!looksCredentialLike(value, key, line)) continue;
      addFinding(state, {
        scope: context.scope,
        relativePath: context.relativePath,
        archiveEntry: context.archiveEntry,
        lineNumber,
        ruleId: 'CREDENTIAL_LIKE_ASSIGNMENT',
        category: /password|passwd/i.test(key) ? 'PASSWORD' : 'CREDENTIAL_VALUE',
        severity: 'HIGH',
        remediation: 'Remove the credential value and use secret configuration.',
      });
    }
  });
}

function readSizedFile(filePath, maxBytes, label) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_UNREADABLE', `Required ${label} artifact is unavailable.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_UNREADABLE', `Required ${label} artifact is not a regular file.`);
  }
  if (stats.size > maxBytes) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_TOO_LARGE', `Required ${label} artifact exceeds the safe inspection limit.`);
  }
  try {
    return fs.readFileSync(filePath);
  } catch {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_UNREADABLE', `Required ${label} artifact could not be read.`);
  }
}

function assertScopedFile(repositoryRoot, suppliedPath, label) {
  const raw = normalizeText(suppliedPath);
  if (!raw) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_INPUT_MISSING', `Required ${label} artifact path is missing.`);
  }
  const candidate = path.resolve(path.isAbsolute(raw) ? raw : path.join(repositoryRoot, raw));
  if (!isWithinDirectory(candidate, repositoryRoot) || candidate === path.resolve(repositoryRoot)) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_OUTSIDE_SCOPE', `Required ${label} artifact is outside the repository scope.`);
  }
  let realRoot;
  let realCandidate;
  try {
    realRoot = fs.realpathSync(repositoryRoot);
    realCandidate = fs.realpathSync(candidate);
  } catch {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_UNREADABLE', `Required ${label} artifact path cannot be resolved.`);
  }
  if (!isWithinDirectory(realCandidate, realRoot)) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARTIFACT_OUTSIDE_SCOPE', `Required ${label} artifact resolves outside the repository scope.`);
  }
  return {
    absolutePath: candidate,
    relativePath: normalizeRelativePath(path.relative(repositoryRoot, candidate)),
  };
}

function parseGitStatusPorcelain(output) {
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(String(output || ''), 'utf8');
  const records = buffer.toString('utf8').split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNSAFE', 'Git returned an ambiguous source scope.');
    }
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (/^(?:AA|DD|AU|UA|DU|UD|DA|UU)$/.test(status)) {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNSAFE', 'Git returned an unresolved merge scope.');
    }
    if (/^[RC]/.test(status)) {
      const targetPath = records[index + 1];
      if (!targetPath) {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNSAFE', 'Git returned an incomplete rename scope.');
      }
      index += 1;
      changes.push({ status, path: firstPath, deleted: true });
      changes.push({ status, path: targetPath, deleted: false });
    } else {
      changes.push({ status, path: firstPath, deleted: /D/.test(status) && !/A|M|T/.test(status), });
    }
  }
  return changes;
}

function getGitStatusOutput(repositoryRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  });
  if (result.error || result.status !== 0) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNREADABLE', 'Git source scope could not be inspected.');
  }
  return result.stdout || Buffer.alloc(0);
}

function collectSourceScope(repositoryRoot, dependencies = {}) {
  const getStatus = dependencies.getGitStatusOutput || getGitStatusOutput;
  const changes = parseGitStatusPorcelain(getStatus(repositoryRoot));
  const sourceFiles = [];
  const canonicalEntries = [];
  const seenPaths = new Set();
  for (const change of changes) {
    const relativePath = normalizeRelativePath(change.path);
    if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath) || relativePath.split('/').includes('..')) {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNSAFE', 'Git returned an unsafe source path.');
    }
    if (seenPaths.has(`${change.deleted ? 'D' : 'F'}:${relativePath}`)) continue;
    seenPaths.add(`${change.deleted ? 'D' : 'F'}:${relativePath}`);
    if (change.deleted) {
      canonicalEntries.push({ status: change.status, path: relativePath, deleted: true });
      continue;
    }
    const absolutePath = path.resolve(repositoryRoot, relativePath);
    if (!isWithinDirectory(absolutePath, repositoryRoot)) {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNSAFE', 'Git returned a source path outside the repository.');
    }
    let stats;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNREADABLE', 'A source path in the commit scope could not be read.');
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNSAFE', 'A source path in the commit scope is not a regular file.');
    }
    const content = readSizedFile(absolutePath, MAX_SOURCE_FILE_BYTES, 'source');
    sourceFiles.push({ relativePath, absolutePath, content, status: change.status });
    canonicalEntries.push({ status: change.status, path: relativePath, sha256: sha256(content) });
  }
  return {
    sourceFiles,
    sourceIdentityDigest: sha256(Buffer.from(JSON.stringify(canonicalEntries.sort((left, right) => `${left.path}|${left.status}`.localeCompare(`${right.path}|${right.status}`))), 'utf8')),
  };
}

function readUInt16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) throw new Error('ZIP bounds');
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) throw new Error('ZIP bounds');
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (offset >= 0 && readUInt32(buffer, offset) === ZIP_END_SIGNATURE) return offset;
  }
  throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive has no readable ZIP directory.');
}

function validateArchiveEntryName(name) {
  if (!name || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive contains an unsafe entry name.');
  }
  const segments = name.replace(/\\/g, '/').split('/');
  if (segments.includes('..') || segments.some((segment) => /[\u0000-\u001f\u007f]/.test(segment))) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive contains an ambiguous entry name.');
  }
  return name.replace(/\\/g, '/');
}

function readZipEntries(buffer) {
  try {
    const endOffset = findEndOfCentralDirectory(buffer);
    const diskNumber = readUInt16(buffer, endOffset + 4);
    const centralDisk = readUInt16(buffer, endOffset + 6);
    const entryCount = readUInt16(buffer, endOffset + 10);
    const centralSize = readUInt32(buffer, endOffset + 12);
    const centralOffset = readUInt32(buffer, endOffset + 16);
    if (diskNumber !== 0 || centralDisk !== 0 || entryCount === 0xffff || centralSize === ZIP32_MAX_VALUE || centralOffset === ZIP32_MAX_VALUE) {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive uses an unsupported ZIP safety mode.');
    }
    if (entryCount > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > buffer.length) {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive exceeds the safe ZIP inspection limits.');
    }
    const entries = [];
    const names = new Set();
    let offset = centralOffset;
    let totalUncompressed = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (readUInt32(buffer, offset) !== ZIP_CENTRAL_FILE_SIGNATURE) {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive has an invalid central directory.');
      }
      const flags = readUInt16(buffer, offset + 8);
      const compressionMethod = readUInt16(buffer, offset + 10);
      const compressedSize = readUInt32(buffer, offset + 20);
      const uncompressedSize = readUInt32(buffer, offset + 24);
      const nameLength = readUInt16(buffer, offset + 28);
      const extraLength = readUInt16(buffer, offset + 30);
      const commentLength = readUInt16(buffer, offset + 32);
      const localOffset = readUInt32(buffer, offset + 42);
      const nameStart = offset + 46;
      const name = validateArchiveEntryName(buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'));
      if (names.has(name)) throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive contains duplicate entries.');
      names.add(name);
      if ((flags & 0x0001) !== 0 || ![0, 8].includes(compressionMethod) || uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive contains an unsupported or unsafe entry.');
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive exceeds the safe decompression limit.');
      }
      if (localOffset + 30 > buffer.length || readUInt32(buffer, localOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive has an invalid local file header.');
      }
      const localNameLength = readUInt16(buffer, localOffset + 26);
      const localExtraLength = readUInt16(buffer, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.length) {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive entry exceeds the archive bounds.');
      }
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
      let content;
      try {
        content = compressionMethod === 0 ? Buffer.from(compressedData) : zlib.inflateRawSync(compressedData);
      } catch {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive entry could not be decompressed.');
      }
      if (content.length !== uncompressedSize) {
        throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive entry failed its size check.');
      }
      entries.push({ name, content });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } catch (error) {
    if (error instanceof SecretLeakGateError) throw error;
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'A required archive could not be safely inspected.');
  }
}

function inspectArtifact(artifact, state) {
  const content = readSizedFile(artifact.absolutePath, MAX_ARTIFACT_BYTES, artifact.label);
  const summary = {
    kind: artifact.kind,
    path: safePathForOutput(artifact.relativePath),
    bytes: content.length,
    sha256: sha256(content),
    entriesScanned: 0,
  };
  if (artifact.archive) {
    const entries = readZipEntries(content);
    summary.entriesScanned = entries.length;
    for (const entry of entries) {
      if (isTextualArchiveEntry(entry.name, entry.content)) {
        scanTextBuffer(entry.content, {
          scope: 'ARTIFACT',
          relativePath: artifact.relativePath,
          archiveEntry: entry.name,
        }, state);
      }
      addPathFinding(state, 'ARTIFACT', `${artifact.relativePath}/${entry.name}`);
    }
  } else {
    scanTextBuffer(content, { scope: 'ARTIFACT', relativePath: artifact.relativePath }, state);
    addPathFinding(state, 'ARTIFACT', artifact.relativePath);
  }
  return summary;
}

function buildArtifactIdentityDigest(artifacts) {
  const canonical = artifacts
    .map((artifact) => `${artifact.kind}|${artifact.relativePath}|${artifact.sha256}|${artifact.bytes}`)
    .sort()
    .join('\n');
  return sha256(Buffer.from(canonical, 'utf8'));
}

function validateExpectedDigest(value, label) {
  if (!value) return null;
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_BINDING_INVALID', `${label} identity binding is invalid.`);
  }
  return value.toLowerCase();
}

function inspectPromotionScope({
  repositoryRoot,
  repositoryName = 'SkyCommand',
  workflowRunId = null,
  artifactPaths = {},
  expectedSourceIdentityDigest = null,
  expectedArtifactIdentityDigest = null,
  dependencies = {},
} = {}) {
  const startedAt = new Date().toISOString();
  const state = { findings: [], findingKeys: new Set() };
  const rawRoot = normalizeText(repositoryRoot);
  const root = rawRoot ? path.resolve(rawRoot) : '';
  if (!root || !fs.existsSync(root)) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNREADABLE', 'The registered repository root is unavailable.');
  }
  let rootStats;
  try {
    rootStats = fs.lstatSync(root);
  } catch {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNREADABLE', 'The registered repository root is unavailable.');
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNSAFE', 'The registered repository root is not a safe directory.');
  }

  const source = collectSourceScope(root, dependencies);
  for (const file of source.sourceFiles) {
    addPathFinding(state, 'SOURCE', file.relativePath);
    scanTextBuffer(file.content, { scope: 'SOURCE', relativePath: file.relativePath }, state);
  }

  const definitions = [
    ['capabilityCatalogJsonPath', 'CAPABILITY_CATALOG_JSON', 'Capability Catalogue JSON', false],
    ['capabilityCatalogXlsxPath', 'CAPABILITY_CATALOG_XLSX', 'Capability Catalogue XLSX', true],
    ['repositoryMapPath', 'REPOSITORY_MAP', 'Repository Map', false],
    ['repositoryZipPath', 'REPOSITORY_ZIP', 'Repository ZIP', true],
  ];
  const artifacts = [];
  for (const [key, kind, label, archive] of definitions) {
    const scoped = assertScopedFile(root, artifactPaths[key], label);
    artifacts.push(inspectArtifact({ ...scoped, kind, label, archive }, state));
  }

  const sourceIdentityDigest = source.sourceIdentityDigest;
  const artifactIdentityDigest = buildArtifactIdentityDigest(artifacts);
  const expectedSource = validateExpectedDigest(expectedSourceIdentityDigest, 'Source');
  const expectedArtifact = validateExpectedDigest(expectedArtifactIdentityDigest, 'Artifact');
  let blockedReason = state.findings.length ? 'SECRET_DETECTED' : null;
  if (expectedSource && expectedSource !== sourceIdentityDigest) blockedReason = 'SOURCE_IDENTITY_DRIFT';
  if (expectedArtifact && expectedArtifact !== artifactIdentityDigest) blockedReason = 'ARTIFACT_IDENTITY_DRIFT';
  const completedAt = new Date().toISOString();
  const ok = !blockedReason;
  return {
    ok,
    artifactKind: 'SECRET_LEAK_GATE',
    outcome: ok ? 'PASS' : 'BLOCKED',
    gateStatus: ok ? 'PASSED' : 'BLOCKED',
    repositoryName: normalizeText(repositoryName) || 'unknown',
    repositoryRoot: root,
    workflowRunId: normalizeText(workflowRunId) || null,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    filesScanned: source.sourceFiles.length,
    artifactsScanned: artifacts.length,
    findingsCount: state.findings.length,
    severityCounts: normalizeSeverityCounts(state.findings),
    rulesVersion: RULES_VERSION,
    sourceIdentityDigest,
    artifactIdentityDigest,
    artifacts,
    findings: state.findings,
    blockedReason,
    policy: {
      sourceScope: 'GIT_ADD_A',
      generatedArtifactsRequired: true,
      rawSecretsRedacted: true,
      personalPathsExcluded: true,
      bypassesAllowed: false,
    },
  };
}

function parseSecretLeakGateArgs(args = []) {
  const positional = (Array.isArray(args) ? args : []).map(String).filter((arg) => !arg.startsWith('--'));
  if (positional.length < 6 || positional.length > 8) {
    throw new SecretLeakGateError('SECRET_LEAK_GATE_ARGUMENTS_INVALID', 'Secret Leak Gate requires the repository and four generated artifact paths.');
  }
  return {
    repoName: positional[0],
    artifactPaths: {
      capabilityCatalogJsonPath: positional[1],
      capabilityCatalogXlsxPath: positional[2],
      repositoryMapPath: positional[3],
      repositoryZipPath: positional[4],
    },
    workflowRunId: positional[5],
    expectedSourceIdentityDigest: positional[6] || null,
    expectedArtifactIdentityDigest: positional[7] || null,
  };
}

async function executeSecretLeakGate(args = [], _toolContext = {}, dependencies = {}) {
  const parsed = parseSecretLeakGateArgs(args);
  let repository;
  if (dependencies.repositoryRoot) {
    repository = {
      repoCode: parsed.repoName,
      repoName: parsed.repoName,
      rootPath: dependencies.repositoryRoot,
    };
  } else {
    try {
      const loadRepository = dependencies.loadRepositoryArtifactConfiguration || loadRepositoryArtifactConfiguration;
      repository = await loadRepository(parsed.repoName);
    } catch {
      throw new SecretLeakGateError('SECRET_LEAK_GATE_SOURCE_SCOPE_UNREADABLE', 'The registered repository could not be resolved.');
    }
  }
  return inspectPromotionScope({
    repositoryRoot: repository.rootPath,
    repositoryName: repository.repoName || repository.repoCode || parsed.repoName,
    workflowRunId: parsed.workflowRunId,
    artifactPaths: parsed.artifactPaths,
    expectedSourceIdentityDigest: parsed.expectedSourceIdentityDigest,
    expectedArtifactIdentityDigest: parsed.expectedArtifactIdentityDigest,
    dependencies,
  });
}

function createSecretLeakGateToolResult(result = {}) {
  const success = result.ok === true && result.outcome === 'PASS';
  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message: success
      ? 'Secret Leak Gate passed for the current promotion scope.'
      : 'Secret Leak Gate blocked the current promotion scope.',
    outputType: OUTPUT_TYPE,
    output: {
      artifactKind: 'SECRET_LEAK_GATE',
      outcome: success ? 'PASS' : 'BLOCKED',
      gateStatus: success ? 'PASSED' : 'BLOCKED',
      repositoryName: normalizeText(result.repositoryName) || 'unknown',
      repositoryRoot: result.repositoryRoot ? String(result.repositoryRoot) : null,
      workflowRunId: normalizeText(result.workflowRunId) || null,
      startedAt: result.startedAt || null,
      completedAt: result.completedAt || null,
      durationMs: Number.isFinite(Number(result.durationMs)) ? Math.max(0, Number(result.durationMs)) : 0,
      filesScanned: Number.isFinite(Number(result.filesScanned)) ? Math.max(0, Number(result.filesScanned)) : 0,
      artifactsScanned: Number.isFinite(Number(result.artifactsScanned)) ? Math.max(0, Number(result.artifactsScanned)) : 0,
      findingsCount: Number.isFinite(Number(result.findingsCount)) ? Math.max(0, Number(result.findingsCount)) : 0,
      severityCounts: {
        HIGH: Number(result.severityCounts?.HIGH) || 0,
        MEDIUM: Number(result.severityCounts?.MEDIUM) || 0,
      },
      rulesVersion: RULES_VERSION,
      sourceIdentityDigest: result.sourceIdentityDigest || null,
      artifactIdentityDigest: result.artifactIdentityDigest || null,
      artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
      findings: Array.isArray(result.findings) ? result.findings : [],
      blockedReason: result.blockedReason || (success ? null : 'SCANNER_FAILURE'),
      policy: {
        sourceScope: 'GIT_ADD_A',
        generatedArtifactsRequired: true,
        rawSecretsRedacted: true,
        personalPathsExcluded: true,
        bypassesAllowed: false,
      },
    },
    warnings: [],
    error: success ? null : {
      code: result.blockedReason === 'SECRET_DETECTED' ? 'SECRET_LEAK_GATE_BLOCKED' : 'SECRET_LEAK_GATE_FAILED',
      message: result.blockedReason === 'SECRET_DETECTED'
        ? 'Secret Leak Gate detected credential material.'
        : 'Secret Leak Gate did not complete in an authorizing state.',
    },
    metadata: {
      rulesVersion: RULES_VERSION,
      rawSecretsRedacted: true,
    },
  });
}

function createSecretLeakGateFailureToolResult({ error, startedAt, completedAt } = {}) {
  const safeError = error instanceof SecretLeakGateError
    ? error
    : new SecretLeakGateError('SECRET_LEAK_GATE_INTERNAL_ERROR', 'Secret Leak Gate could not complete safely.');
  return createSecretLeakGateToolResult({
    ok: false,
    startedAt: startedAt || completedAt || new Date().toISOString(),
    completedAt: completedAt || new Date().toISOString(),
    durationMs: 0,
    blockedReason: safeError.code || 'SECRET_LEAK_GATE_INTERNAL_ERROR',
    findings: [],
    artifacts: [],
  });
}

function printSecretLeakGateResult(result) {
  console.log(`[SkyCommand Secret Leak Gate] ${result.outcome || 'BLOCKED'}; files=${result.filesScanned || 0}; artifacts=${result.artifactsScanned || 0}; findings=${result.findingsCount || 0}.`);
}

async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: OUTPUT_TYPE,
    args,
    execute: executeSecretLeakGate,
    createToolResult: createSecretLeakGateToolResult,
    createFailureToolResult: (error) => createSecretLeakGateFailureToolResult({
      error,
      startedAt,
      completedAt: new Date().toISOString(),
    }),
    renderConsole: printSecretLeakGateResult,
  });
}

if (require.main === module) main();

module.exports = {
  AUTH_SESSION_BASENAMES,
  OUTPUT_TYPE,
  PROVIDER_PATTERNS,
  RULES_VERSION,
  SecretLeakGateError,
  TOOL_CODE,
  createSecretLeakGateFailureToolResult,
  createSecretLeakGateToolResult,
  executeSecretLeakGate,
  inspectPromotionScope,
  main,
  parseGitStatusPorcelain,
  parseSecretLeakGateArgs,
  printSecretLeakGateResult,
  readZipEntries,
};
