const path = require('node:path');

const REDACTED = '[REDACTED]';
const SECRET_KEY_PATTERN =
  /(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|authorization|bearer|connection[_-]?string)/i;

function isSecretSensitiveKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || ''));
}

function nullableText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function safeJsonValue(value, key = null) {
  if (key !== null && isSecretSensitiveKey(key)) {
    return REDACTED;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value ?? null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeJsonValue(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        safeJsonValue(nestedValue, nestedKey),
      ]),
    );
  }

  return null;
}

function safeParameterDefault(parameterName, value) {
  if (value === undefined || value === null || value === '') {
    return value ?? null;
  }

  return isSecretSensitiveKey(parameterName) ? REDACTED : safeJsonValue(value);
}

function safeObjectKeys(value) {
  let objectValue = value;

  if (typeof value === 'string') {
    try {
      objectValue = JSON.parse(value);
    } catch (_error) {
      return [];
    }
  }

  if (!objectValue || typeof objectValue !== 'object' || Array.isArray(objectValue)) {
    return [];
  }

  return Object.keys(objectValue)
    .filter((key) => !isSecretSensitiveKey(key))
    .sort((left, right) => left.localeCompare(right));
}

function safeRepositoryRelativePath(value) {
  const raw = nullableText(value);

  if (!raw || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    return null;
  }

  const normalized = path.posix.normalize(raw.replace(/\\/g, '/'));

  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.includes('\0')
  ) {
    return null;
  }

  return normalized.replace(/^\.\//, '');
}

function safeUrl(value) {
  const raw = nullableText(value);

  if (!raw || isSecretSensitiveKey(raw)) {
    return null;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }

    const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch (_error) {
    return null;
  }
}

function safeParameterKeys(value) {
  return safeObjectKeys(value);
}

module.exports = {
  REDACTED,
  SECRET_KEY_PATTERN,
  isSecretSensitiveKey,
  nullableText,
  safeJsonValue,
  safeObjectKeys,
  safeParameterDefault,
  safeParameterKeys,
  safeRepositoryRelativePath,
  safeUrl,
};
