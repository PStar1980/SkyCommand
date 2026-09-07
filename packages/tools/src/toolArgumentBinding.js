const ARGUMENT_MODES = Object.freeze({
  POSITIONAL: 'POSITIONAL',
  FLAG: 'FLAG',
});

function normalizeArgumentMode(value) {
  const normalized = String(value || ARGUMENT_MODES.POSITIONAL).trim().toUpperCase();
  return Object.values(ARGUMENT_MODES).includes(normalized)
    ? normalized
    : ARGUMENT_MODES.POSITIONAL;
}

function isTrueValue(value) {
  return value === true || value === 1 || value === '1' || String(value).trim().toLowerCase() === 'true';
}

function validateCliFlag(value) {
  const flag = String(value || '').trim();
  if (!/^--[A-Za-z0-9][A-Za-z0-9-]*$/.test(flag)) {
    throw new Error(`Invalid CLI flag binding: ${flag || '(blank)'}`);
  }
  return flag;
}

function bindParameterArgument(parameter, normalizedValue) {
  if (normalizedValue === null || normalizedValue === undefined) {
    return [];
  }

  const mode = normalizeArgumentMode(parameter.argument_mode || parameter.argumentMode);
  if (mode === ARGUMENT_MODES.FLAG) {
    const type = String(parameter.param_type_code || parameter.paramTypeCode || '').trim().toLowerCase();
    if (type !== 'boolean') {
      throw new Error(
        `CLI flag parameter ${parameter.parameter_name || parameter.parameterName || '(unnamed)'} must use Boolean type.`,
      );
    }

    const flag = validateCliFlag(parameter.cli_flag || parameter.cliFlag);
    return isTrueValue(normalizedValue) ? [flag] : [];
  }

  return [String(normalizedValue)];
}

module.exports = {
  ARGUMENT_MODES,
  bindParameterArgument,
  normalizeArgumentMode,
  validateCliFlag,
};
