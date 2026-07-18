function getBooleanValue(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function normalizeParameterType(parameter = {}) {
  const rawType = String(
    parameter.paramTypeCode || parameter.type || parameter.parameterType || 'string',
  )
    .trim()
    .toLowerCase();

  if (rawType === 'repository' || parameter.optionSourceCode === 'repositories') {
    return 'repo';
  }

  if (rawType === 'integer') {
    return 'number';
  }

  return rawType;
}

function shouldRenderSelect(parameter) {
  const parameterType = normalizeParameterType(parameter);

  return (
    parameterType === 'repo' ||
    parameterType === 'select' ||
    (parameter.options || []).length > 0
  );
}

function getInputType(parameter) {
  const parameterType = normalizeParameterType(parameter);

  if (parameterType === 'number') {
    return 'number';
  }

  if (parameterType === 'date') {
    return 'date';
  }

  return 'text';
}

function getParameterHelpText(parameter) {
  const type = normalizeParameterType(parameter) || 'string';

  if (parameter.optionSourceCode) {
    return `${type} parameter · source: ${parameter.optionSourceCode}`;
  }

  return `${type} parameter`;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getWorkflowParameterReference(parameter = {}) {
  const key = String(parameter.key || parameter.parameterName || parameter.name || '').trim();
  return key ? `{{ params.${key} }}` : '';
}

function getWorkflowParameterReferencePath(value) {
  const match = String(value || '').match(/^\s*{{\s*params\.([A-Za-z0-9_.:-]+)\s*}}\s*$/);
  return match ? match[1] : '';
}

function isWorkflowParameterCompatible(toolParameter = {}, workflowParameter = {}) {
  const toolType = normalizeParameterType(toolParameter);
  const workflowType = normalizeParameterType(workflowParameter);

  if (!workflowType) {
    return false;
  }

  if (toolType === workflowType) {
    return true;
  }

  // String tool parameters can safely consume scalar workflow values. Exact
  // template matches preserve the runtime value until the generic tool adapter
  // applies the tool's own argument binding rules.
  if (toolType === 'string') {
    return ['string', 'number', 'boolean', 'select', 'date', 'repo'].includes(workflowType);
  }

  return false;
}

function getCompatibleWorkflowParameters(parameter, workflowParameters = []) {
  return (Array.isArray(workflowParameters) ? workflowParameters : [])
    .filter((workflowParameter) => isWorkflowParameterCompatible(parameter, workflowParameter))
    .map((workflowParameter) => ({
      ...workflowParameter,
      reference: getWorkflowParameterReference(workflowParameter),
    }))
    .filter((workflowParameter) => workflowParameter.reference);
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

    if (normalizeParameterType(parameter) === 'boolean') {
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
  workflowParameters = [],
  onChange,
}) {
  function updateParameter(parameterName, value) {
    onChange({
      ...(parameterValues || {}),
      [parameterName]: value,
    });
  }

  function renderWorkflowBindingSelect(parameter, value, compatibleWorkflowParameters) {
    const parameterName = parameter.parameterName;
    const currentReferenceKey = getWorkflowParameterReferencePath(value);
    const currentReference = currentReferenceKey ? `{{ params.${currentReferenceKey} }}` : '';
    const referenceAvailable = compatibleWorkflowParameters.some(
      (workflowParameter) => workflowParameter.reference === currentReference,
    );

    if (compatibleWorkflowParameters.length === 0 && !currentReference) {
      return null;
    }

    return (
      <div className="mb-2">
        <label className="form-label small sky-muted" htmlFor={`${idPrefix}-${parameterName}-binding`}>
          Workflow parameter binding
        </label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-${parameterName}-binding`}
          onChange={(event) => updateParameter(parameterName, event.target.value)}
          value={currentReference}
        >
          <option value="">Use a literal or saved default value</option>
          {compatibleWorkflowParameters.map((workflowParameter) => (
            <option key={workflowParameter.reference} value={workflowParameter.reference}>
              {workflowParameter.label || workflowParameter.key} — {workflowParameter.reference}
            </option>
          ))}
          {currentReference && !referenceAvailable && (
            <option value={currentReference}>
              Unavailable parameter — {currentReference}
            </option>
          )}
        </select>
      </div>
    );
  }

  function renderParameterInput(parameter) {
    const parameterName = parameter.parameterName;
    const parameterType = normalizeParameterType(parameter);
    const value = parameterValues?.[parameterName] ?? '';
    const options = parameter.options || [];
    const inputId = `${idPrefix}-${parameterName}`;
    const compatibleWorkflowParameters = getCompatibleWorkflowParameters(
      parameter,
      workflowParameters,
    );
    const currentReferenceKey = getWorkflowParameterReferencePath(value);
    const currentReference = currentReferenceKey ? `{{ params.${currentReferenceKey} }}` : '';

    if (parameterType === 'boolean') {
      return (
        <>
          {renderWorkflowBindingSelect(parameter, value, compatibleWorkflowParameters)}
          {currentReference ? (
            <input
              className="form-control sky-form-control sky-mono"
              id={inputId}
              readOnly
              value={currentReference}
            />
          ) : (
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
          )}
        </>
      );
    }

    if (shouldRenderSelect(parameter)) {
      const currentReferenceAvailable = compatibleWorkflowParameters.some(
        (workflowParameter) => workflowParameter.reference === currentReference,
      );
      const literalGroupLabel = parameterType === 'repo' ? 'Repository catalogue' : 'Configured values';

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
            {options.length > 0 && (
              <optgroup label={literalGroupLabel}>
                {options.map((option) => (
                  <option key={option.optionId || option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            )}
            {compatibleWorkflowParameters.length > 0 && (
              <optgroup label="Workflow parameters">
                {compatibleWorkflowParameters.map((workflowParameter) => (
                  <option key={workflowParameter.reference} value={workflowParameter.reference}>
                    {workflowParameter.label || workflowParameter.key} — {workflowParameter.reference}
                  </option>
                ))}
              </optgroup>
            )}
            {currentReference && !currentReferenceAvailable && (
              <optgroup label="Unavailable binding">
                <option value={currentReference}>{currentReference}</option>
              </optgroup>
            )}
          </select>

          {options.length === 0 && compatibleWorkflowParameters.length === 0 && (
            <div className="form-text text-warning">
              No options were returned for this parameter.
            </div>
          )}
        </>
      );
    }

    return (
      <>
        {renderWorkflowBindingSelect(parameter, value, compatibleWorkflowParameters)}
        <input
          className="form-control sky-form-control sky-mono"
          id={inputId}
          onChange={(event) => updateParameter(parameterName, event.target.value)}
          placeholder={parameter.prompt || parameterName}
          readOnly={Boolean(currentReference)}
          required={parameter.required}
          type={currentReference ? 'text' : getInputType(parameter)}
          value={String(value)}
        />
        {currentReference && (
          <div className="form-text sky-muted">
            Resolved from workflow runtime parameter <code>params.{currentReferenceKey}</code> when the node starts.
          </div>
        )}
      </>
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
  getCompatibleWorkflowParameters,
  getInitialToolParameterValues,
  getWorkflowParameterReference,
  isWorkflowParameterCompatible,
};

export default ToolParameterEditor;
