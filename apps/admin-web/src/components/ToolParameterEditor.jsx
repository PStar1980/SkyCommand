function getBooleanValue(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function shouldRenderSelect(parameter) {
  return (
    parameter.paramTypeCode === 'repo' ||
    parameter.paramTypeCode === 'select' ||
    (parameter.options || []).length > 0
  );
}

function getInputType(parameter) {
  if (parameter.paramTypeCode === 'number') {
    return 'number';
  }

  if (parameter.paramTypeCode === 'date') {
    return 'date';
  }

  return 'text';
}

function getParameterHelpText(parameter) {
  const type = parameter.paramTypeCode || 'string';

  if (parameter.optionSourceCode) {
    return `${type} parameter · source: ${parameter.optionSourceCode}`;
  }

  return `${type} parameter`;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getInitialToolParameterValues(tool, existingValues = {}) {
  return (tool?.parameters || []).reduce((accumulator, parameter) => {
    const parameterName = parameter.parameterName;

    if (hasOwn(existingValues, parameterName)) {
      accumulator[parameterName] = existingValues[parameterName];
      return accumulator;
    }

    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) {
      accumulator[parameterName] = parameter.defaultValue;
      return accumulator;
    }

    if (parameter.paramTypeCode === 'boolean') {
      accumulator[parameterName] = false;
      return accumulator;
    }

    accumulator[parameterName] = '';
    return accumulator;
  }, {});
}

function cleanToolParameterValues(values = {}) {
  return Object.fromEntries(
    Object.entries(values || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function ToolParameterEditor({
  idPrefix = 'tool-parameter',
  parameterValues = {},
  parameters = [],
  onChange,
}) {
  function updateParameter(parameterName, value) {
    onChange({
      ...(parameterValues || {}),
      [parameterName]: value,
    });
  }

  function renderParameterInput(parameter) {
    const parameterName = parameter.parameterName;
    const value = parameterValues?.[parameterName] ?? '';
    const options = parameter.options || [];
    const inputId = `${idPrefix}-${parameterName}`;

    if (parameter.paramTypeCode === 'boolean') {
      return (
        <div className="form-check form-switch">
          <input
            checked={getBooleanValue(value)}
            className="form-check-input"
            id={inputId}
            onChange={(event) => updateParameter(parameterName, event.target.checked)}
            type="checkbox"
          />
          <label className="form-check-label sky-muted" htmlFor={inputId}>
            {parameter.prompt || parameter.label}
          </label>
        </div>
      );
    }

    if (shouldRenderSelect(parameter)) {
      return (
        <>
          <select
            className="form-select sky-form-control"
            id={inputId}
            onChange={(event) => updateParameter(parameterName, event.target.value)}
            required={parameter.required}
            value={String(value)}
          >
            <option value="">{parameter.prompt || `Select ${parameter.label}`}</option>
            {options.map((option) => (
              <option key={option.optionId || option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {options.length === 0 && (
            <div className="form-text text-warning">
              No options were returned for this parameter.
            </div>
          )}
        </>
      );
    }

    return (
      <input
        className="form-control sky-form-control sky-mono"
        id={inputId}
        onChange={(event) => updateParameter(parameterName, event.target.value)}
        placeholder={parameter.prompt || parameterName}
        required={parameter.required}
        type={getInputType(parameter)}
        value={String(value)}
      />
    );
  }

  if (!parameters.length) {
    return (
      <div className="sky-empty-state py-3">
        This tool has no configured parameters. The node will run with its tool defaults.
      </div>
    );
  }

  return (
    <div className="row g-3">
      {parameters.map((parameter) => (
        <div className="col-md-12" key={parameter.parameterId || parameter.parameterName}>
          <label className="form-label" htmlFor={`${idPrefix}-${parameter.parameterName}`}>
            {parameter.label}
            {parameter.required && <span className="text-danger ms-1">*</span>}
          </label>

          {renderParameterInput(parameter)}

          <div className="form-text sky-muted">
            {parameter.prompt || getParameterHelpText(parameter)}
          </div>
        </div>
      ))}
    </div>
  );
}

export {
  cleanToolParameterValues,
  getInitialToolParameterValues,
};

export default ToolParameterEditor;
