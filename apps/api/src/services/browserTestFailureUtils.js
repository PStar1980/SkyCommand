function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

/**
 * Collapse Temporal's WorkflowFailedError -> ActivityFailure -> ApplicationFailure
 * wrapper chain into operator-facing evidence while preserving the chain for diagnosis.
 */
function serializeTemporalFailure(error) {
  if (!error) return null;

  const seen = new Set();
  const chain = [];
  let current = error;

  while (current && typeof current === 'object' && !seen.has(current) && chain.length < 12) {
    seen.add(current);
    chain.push({
      name: normalizeText(current.name || current.constructor?.name) || null,
      message: normalizeText(current.message || current) || null,
      code: normalizeOptionalText(current.code),
      type: normalizeOptionalText(current.type),
      stack: normalizeOptionalText(current.stack),
    });

    current = current.cause || current.failure?.cause || current.originalError || null;
  }

  if (!chain.length) {
    return { message: normalizeText(error.message || error) || 'Browser Test execution failed.' };
  }

  const outer = chain[0];
  const root = [...chain].reverse().find((entry) => entry.message) || outer;
  return {
    message: root.message || outer.message || 'Browser Test execution failed.',
    stack: root.stack || outer.stack || null,
    errorName: root.name || outer.name || null,
    errorCode: root.code || outer.code || null,
    temporalMessage: outer.message || null,
    causeChain: chain.map(({ name, message, code, type }) => ({ name, message, code, type })),
  };
}

module.exports = {
  serializeTemporalFailure,
};
