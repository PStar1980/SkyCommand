const MAX_RUNTIME_PARAMETERS = 10;

const PARAMETER_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select' },
  { value: 'date', label: 'Date' },
  { value: 'json', label: 'JSON' },
];

function slugifyParameterKey(value, fallback = '') {
  return String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function normalizeParameterOptions(options = []) {
  if (typeof options === 'string') {
    return options
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ value: item, label: item }));
  }

  return (Array.isArray(options) ? options : [])
    .map((option) => {
      if (option && typeof option === 'object') {
        const value = option.value ?? option.optionValue ?? option.key ?? option.id ?? '';
        const label = option.label ?? option.displayName ?? option.name ?? value;
        return { value: String(value), label: String(label || value) };
      }

      return { value: String(option), label: String(option) };
    })
    .filter((option) => option.value);
}

function formatOptionsText(options = []) {
  return normalizeParameterOptions(options)
    .map((option) => (option.label && option.label !== option.value ? `${option.value}|${option.label}` : option.value))
    .join('\n');
}

function parseOptionsText(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawValue, ...labelParts] = line.split('|');
      const optionValue = String(rawValue || '').trim();
      const optionLabel = labelParts.join('|').trim() || optionValue;
      return { value: optionValue, label: optionLabel };
    })
    .filter((option) => option.value);
}

function normalizeRuntimeParameterDefinitions(parameters = []) {
  return (Array.isArray(parameters) ? parameters : [])
    .slice(0, MAX_RUNTIME_PARAMETERS)
    .map((parameter, index) => {
      const raw = parameter && typeof parameter === 'object' ? parameter : {};
      const key = slugifyParameterKey(raw.key || raw.parameterName || raw.name || raw.paramName || '', '');
      const type = String(raw.type || raw.paramTypeCode || raw.parameterType || 'string').trim().toLowerCase();
      const normalizedType = PARAMETER_TYPE_OPTIONS.some((option) => option.value === type) ? type : 'string';
      const options = normalizeParameterOptions(raw.options || raw.allowedValues || raw.values);

      return {
        key,
        parameterName: key,
        label: raw.label || raw.displayName || key,
        type: normalizedType,
        required: raw.required === true || raw.required === 'true',
        defaultValue: raw.defaultValue ?? raw.default ?? '',
        description: raw.description || raw.prompt || '',
        prompt: raw.prompt || raw.description || '',
        options,
        optionsText: formatOptionsText(options),
        maxLength: raw.maxLength ?? '',
        displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : index * 10 + 10,
      };
    });
}

function cleanRuntimeParameterDefinitions(parameters = []) {
  const normalized = normalizeRuntimeParameterDefinitions(parameters);

  if (normalized.length > MAX_RUNTIME_PARAMETERS) {
    throw new Error(`Workflows can define up to ${MAX_RUNTIME_PARAMETERS} runtime parameters.`);
  }

  const seen = new Set();

  return normalized.map((parameter, index) => {
    const key = slugifyParameterKey(parameter.key, '');

    if (!key) {
      throw new Error(`Runtime parameter ${index + 1} needs a parameter name.`);
    }

    if (seen.has(key)) {
      throw new Error(`Runtime parameter names must be unique. Duplicate: ${key}.`);
    }

    seen.add(key);

    const cleaned = {
      key,
      parameterName: key,
      label: String(parameter.label || key).trim() || key,
      type: PARAMETER_TYPE_OPTIONS.some((option) => option.value === parameter.type) ? parameter.type : 'string',
      required: Boolean(parameter.required),
      description: String(parameter.description || '').trim(),
      prompt: String(parameter.prompt || parameter.description || '').trim(),
      displayOrder: (index + 1) * 10,
    };

    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null && String(parameter.defaultValue) !== '') {
      cleaned.defaultValue = parameter.defaultValue;
    }

    if (cleaned.type === 'select') {
      cleaned.options = parseOptionsText(parameter.optionsText || '').slice(0, 25);

      if (cleaned.options.length === 0) {
        throw new Error(`Select parameter ${key} needs at least one option.`);
      }
    }

    if (cleaned.type === 'string' && parameter.maxLength !== undefined && parameter.maxLength !== '') {
      const maxLength = Number(parameter.maxLength);

      if (!Number.isFinite(maxLength) || maxLength <= 0) {
        throw new Error(`Runtime parameter ${key} max length must be a positive number.`);
      }

      cleaned.maxLength = maxLength;
    }

    return cleaned;
  });
}

function createBlankParameter(index = 0) {
  return {
    key: '',
    parameterName: '',
    label: '',
    type: 'string',
    required: false,
    defaultValue: '',
    description: '',
    prompt: '',
    options: [],
    optionsText: '',
    maxLength: '',
    displayOrder: index * 10 + 10,
  };
}

function RuntimeParameterSchemaEditor({
  disabled = false,
  idPrefix = 'runtime-param-schema',
  onChange,
  parameters = [],
}) {
  const normalizedParameters = normalizeRuntimeParameterDefinitions(parameters);
  const canAdd = !disabled && normalizedParameters.length < MAX_RUNTIME_PARAMETERS;

  function emit(nextParameters) {
    onChange(normalizeRuntimeParameterDefinitions(nextParameters));
  }

  function updateParameter(index, changes) {
    emit(normalizedParameters.map((parameter, parameterIndex) => (
      parameterIndex === index ? { ...parameter, ...changes } : parameter
    )));
  }

  function removeParameter(index) {
    emit(normalizedParameters.filter((_, parameterIndex) => parameterIndex !== index));
  }

  function addParameter() {
    emit([...normalizedParameters, createBlankParameter(normalizedParameters.length)]);
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div className="small sky-muted">
          Define up to {MAX_RUNTIME_PARAMETERS} workflow-level params. Values are supplied on Start Workflow and referenced inside nodes as <code>{'{{ params.name }}'}</code>.
        </div>
        <button className="btn btn-sm sky-btn-ghost" disabled={!canAdd} onClick={addParameter} type="button">
          Add runtime param
        </button>
      </div>

      {normalizedParameters.length === 0 && (
        <div className="sky-empty-state text-start">
          No workflow-level runtime params yet. Add params here when this workflow needs launch-time values such as repoName, branchName, or commitMessage.
        </div>
      )}

      {normalizedParameters.map((parameter, index) => {
        const inputBase = `${idPrefix}-${index}`;
        const referenceText = parameter.key ? `{{ params.${parameter.key} }}` : '{{ params.name }}';

        return (
          <div className="sky-worker-command-card" key={`${index}-${parameter.key || 'param'}`}>
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
              <div>
                <div className="sky-page-kicker">Runtime param {index + 1}</div>
                <div className="fw-bold sky-mono">{referenceText}</div>
              </div>
              <button className="btn btn-sm btn-outline-danger" disabled={disabled} onClick={() => removeParameter(index)} type="button">
                Remove
              </button>
            </div>

            <div className="row g-3">
              <div className="col-lg-4">
                <label className="form-label" htmlFor={`${inputBase}-key`}>Parameter name</label>
                <input
                  className="form-control sky-form-control sky-mono"
                  disabled={disabled}
                  id={`${inputBase}-key`}
                  onBlur={() => updateParameter(index, { key: slugifyParameterKey(parameter.key) })}
                  onChange={(event) => updateParameter(index, { key: event.target.value, parameterName: event.target.value })}
                  placeholder="commitMessage"
                  value={parameter.key}
                />
              </div>
              <div className="col-lg-4">
                <label className="form-label" htmlFor={`${inputBase}-label`}>Label</label>
                <input
                  className="form-control sky-form-control"
                  disabled={disabled}
                  id={`${inputBase}-label`}
                  onChange={(event) => updateParameter(index, { label: event.target.value })}
                  placeholder="Commit message"
                  value={parameter.label}
                />
              </div>
              <div className="col-lg-4">
                <label className="form-label" htmlFor={`${inputBase}-type`}>Data type</label>
                <select
                  className="form-select sky-form-control"
                  disabled={disabled}
                  id={`${inputBase}-type`}
                  onChange={(event) => updateParameter(index, { type: event.target.value })}
                  value={parameter.type}
                >
                  {PARAMETER_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-6">
                <label className="form-label" htmlFor={`${inputBase}-description`}>Description / prompt</label>
                <input
                  className="form-control sky-form-control"
                  disabled={disabled}
                  id={`${inputBase}-description`}
                  onChange={(event) => updateParameter(index, { description: event.target.value, prompt: event.target.value })}
                  placeholder="Shown on the Start Workflow form."
                  value={parameter.description}
                />
              </div>
              <div className="col-lg-3">
                <label className="form-label" htmlFor={`${inputBase}-default`}>Default value</label>
                <input
                  className="form-control sky-form-control sky-mono"
                  disabled={disabled || parameter.type === 'json'}
                  id={`${inputBase}-default`}
                  onChange={(event) => updateParameter(index, { defaultValue: event.target.value })}
                  placeholder={parameter.type === 'json' ? 'Set at runtime' : 'Optional'}
                  value={parameter.type === 'json' ? '' : String(parameter.defaultValue ?? '')}
                />
              </div>
              <div className="col-lg-3">
                <label className="form-label" htmlFor={`${inputBase}-max`}>Max length</label>
                <input
                  className="form-control sky-form-control"
                  disabled={disabled || parameter.type !== 'string'}
                  id={`${inputBase}-max`}
                  onChange={(event) => updateParameter(index, { maxLength: event.target.value })}
                  placeholder="Optional"
                  type="number"
                  value={parameter.type === 'string' ? String(parameter.maxLength ?? '') : ''}
                />
              </div>
              {parameter.type === 'select' && (
                <div className="col-12">
                  <label className="form-label" htmlFor={`${inputBase}-options`}>Select options</label>
                  <textarea
                    className="form-control sky-form-control sky-mono"
                    disabled={disabled}
                    id={`${inputBase}-options`}
                    onChange={(event) => updateParameter(index, { optionsText: event.target.value })}
                    placeholder="dev|Development\nmain|Main"
                    rows={3}
                    value={parameter.optionsText || ''}
                  />
                  <div className="form-text sky-muted">One option per line. Use value|Label when the display label differs.</div>
                </div>
              )}
              <div className="col-12">
                <div className="form-check form-switch">
                  <input
                    checked={Boolean(parameter.required)}
                    className="form-check-input"
                    disabled={disabled}
                    id={`${inputBase}-required`}
                    onChange={(event) => updateParameter(index, { required: event.target.checked })}
                    type="checkbox"
                  />
                  <label className="form-check-label" htmlFor={`${inputBase}-required`}>Required at runtime</label>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export {
  MAX_RUNTIME_PARAMETERS,
  cleanRuntimeParameterDefinitions,
  normalizeRuntimeParameterDefinitions,
};

export default RuntimeParameterSchemaEditor;
