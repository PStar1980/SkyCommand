function getStructuredWarningDisplayValue(warning) {
  return warning && typeof warning === 'object'
    ? warning.message || warning.code || warning
    : warning;
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableSerialize(item)).join(',') + ']';
  }

  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableSerialize(value[key]))
      .join(',') +
    '}'
  );
}

function getStructuredWarningIdentity(warning) {
  const displayValue = getStructuredWarningDisplayValue(warning);

  if (displayValue && typeof displayValue === 'object') {
    try {
      return stableSerialize(displayValue);
    } catch {
      return String(displayValue);
    }
  }

  return String(displayValue);
}

function mergeStructuredWarnings(...sources) {
  const seen = new Set();
  const merged = [];

  for (const source of sources) {
    if (!Array.isArray(source)) continue;

    for (const warning of source) {
      const identity = getStructuredWarningIdentity(warning);
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push(warning);
    }
  }

  return merged;
}

module.exports = {
  getStructuredWarningDisplayValue,
  mergeStructuredWarnings,
};
