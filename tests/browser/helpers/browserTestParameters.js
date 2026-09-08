function getBrowserTestParameters() {
  const raw = String(process.env.SKYCOMMAND_BROWSER_TEST_PARAMETERS || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_error) {
    throw new Error('SKYCOMMAND_BROWSER_TEST_PARAMETERS must contain a JSON object.');
  }
}

function getBrowserTestParameter(name, fallback = null) {
  const parameters = getBrowserTestParameters();
  const value = parameters[name];
  return value === undefined || value === null || value === '' ? fallback : value;
}

module.exports = {
  getBrowserTestParameter,
  getBrowserTestParameters,
};
