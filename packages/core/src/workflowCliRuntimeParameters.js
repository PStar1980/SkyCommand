'use strict';

const SUPPORTED_PARAMETER_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'select',
  'date',
  'json',
  'repo',
]);

function getSafeObject(value, fallback = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return fallback;
  }

  return value;
}

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeParameterKey(value, fallback = 'param') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);

  return normalized || fallback;
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (['true', 't', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', 'f', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Expected a boolean value but received '${value}'.`);
}

function parseConfig(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return getSafeObject(JSON.parse(value));
    } catch {
      return {};
    }
  }

  return getSafeObject(value);
}

function normalizeRuntimeParameterOptions(options = []) {
  return getSafeArray(options)
    .map((option) => {
      if (option && typeof option === 'object') {
        const value = option.value ?? option.optionValue ?? option.key ?? option.id ?? '';
        const label = option.label ?? option.displayName ?? option.name ?? value;

        return {
          value: String(value),
          label: String(label || value),
        };
      }

      return {
        value: String(option),
        label: String(option),
      };
    })
    .filter((option) => option.value !== '');
}

function getWorkflowRuntimeParameterDefinitions(config = {}) {
  const safeConfig = parseConfig(config);
  const parameterSchema = getSafeObject(safeConfig.parameterSchema);
  const rawParameters = getSafeArray(
    safeConfig.runtimeParameters || parameterSchema.runtimeParameters || parameterSchema.parameters,
  );

  return rawParameters
    .map((parameter, index) => {
      const raw = getSafeObject(parameter);
      const key = normalizeParameterKey(
        raw.key || raw.parameterName || raw.name || raw.paramName,
        `param_${index + 1}`,
      );
      const requestedType = String(
        raw.type || raw.paramTypeCode || raw.parameterType || 'string',
      )
        .trim()
        .toLowerCase();
      const canonicalType = requestedType === 'repository' ? 'repo' : requestedType;
      const type = SUPPORTED_PARAMETER_TYPES.has(canonicalType) ? canonicalType : 'string';

      return {
        key,
        parameterName: key,
        label: String(raw.label || raw.displayName || key).trim() || key,
        type,
        required: raw.required === true || String(raw.required || '').toLowerCase() === 'true',
        defaultValue: raw.defaultValue ?? raw.default ?? null,
        description: String(raw.description || raw.prompt || '').trim(),
        prompt: String(raw.prompt || raw.description || '').trim(),
        options: normalizeRuntimeParameterOptions(raw.options || raw.allowedValues || raw.values),
        optionSourceCode: raw.optionSourceCode || (type === 'repo' ? 'repositories' : null),
        maxLength: Number.isFinite(Number(raw.maxLength)) ? Number(raw.maxLength) : null,
        displayOrder: Number.isFinite(Number(raw.displayOrder))
          ? Number(raw.displayOrder)
          : index * 10 + 10,
      };
    })
    .filter((parameter) => Boolean(parameter.key))
    .sort(
      (left, right) =>
        (left.displayOrder || 0) - (right.displayOrder || 0) || left.key.localeCompare(right.key),
    );
}

function isBlankRuntimeParameterValue(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function coerceWorkflowRuntimeParameterValue(value, parameter = {}) {
  const definition = getSafeObject(parameter);

  if (isBlankRuntimeParameterValue(value)) {
    if (!isBlankRuntimeParameterValue(definition.defaultValue)) {
      return coerceWorkflowRuntimeParameterValue(definition.defaultValue, {
        ...definition,
        defaultValue: null,
      });
    }

    if (definition.required) {
      throw new Error(`${definition.label || definition.key || 'Runtime parameter'} is required.`);
    }

    return definition.type === 'boolean' ? false : null;
  }

  if (definition.type === 'number') {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new Error(`${definition.label || definition.key} must be a number.`);
    }

    return numericValue;
  }

  if (definition.type === 'boolean') {
    return toBoolean(value);
  }

  if (definition.type === 'json') {
    if (typeof value === 'object') {
      return JSON.parse(JSON.stringify(value));
    }

    try {
      return JSON.parse(String(value));
    } catch (error) {
      throw new Error(`${definition.label || definition.key} must be valid JSON: ${error.message}`);
    }
  }

  const stringValue = String(value);

  if (definition.maxLength && stringValue.length > definition.maxLength) {
    throw new Error(
      `${definition.label || definition.key} exceeds maximum length ${definition.maxLength}.`,
    );
  }

  if (definition.type === 'select' && getSafeArray(definition.options).length > 0) {
    const allowedValues = new Set(definition.options.map((option) => String(option.value)));

    if (!allowedValues.has(stringValue)) {
      throw new Error(
        `${definition.label || definition.key} must be one of: ${[...allowedValues].join(', ')}.`,
      );
    }
  }

  return stringValue;
}

function getExistingWorkflowRuntimeParameters(input = {}) {
  const safeInput = getSafeObject(input);

  return getSafeObject(
    safeInput.params ||
      safeInput.runtimeParameters ||
      safeInput.workflowParameters ||
      safeInput.parameters,
  );
}

function mergeWorkflowRuntimeParameters(input = {}, runtimeParameters = {}) {
  const safeInput = getSafeObject(input);
  const mergedParameters = {
    ...getExistingWorkflowRuntimeParameters(safeInput),
    ...getSafeObject(runtimeParameters),
  };

  return {
    ...safeInput,
    params: mergedParameters,
    runtimeParameters: mergedParameters,
  };
}

function getWorkflowRuntimeParameterReference(parameterKey) {
  return `{{ params.${normalizeParameterKey(parameterKey)} }}`;
}

module.exports = {
  coerceWorkflowRuntimeParameterValue,
  getExistingWorkflowRuntimeParameters,
  getWorkflowRuntimeParameterDefinitions,
  getWorkflowRuntimeParameterReference,
  isBlankRuntimeParameterValue,
  mergeWorkflowRuntimeParameters,
  normalizeRuntimeParameterOptions,
};
