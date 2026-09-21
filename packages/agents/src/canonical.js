const crypto = require('node:crypto');

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex').toUpperCase();
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort();
}

module.exports = {
  canonicalize,
  canonicalJson,
  sha256Digest,
  uniqueSorted,
};
