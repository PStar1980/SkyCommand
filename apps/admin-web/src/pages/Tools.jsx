import { useEffect, useMemo, useState } from 'react';
import toolService from '../services/toolService';

function riskClass(riskCode) {
  if (riskCode === 'low') {
    return 'sky-pill-success';
  }

  if (riskCode === 'medium') {
    return 'sky-pill-warning';
  }

  if (riskCode === 'high') {
    return 'sky-pill-danger';
  }

  return 'sky-pill-info';
}

function getBooleanValue(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function getInitialParameterValues(tool) {
  return (tool?.parameters || []).reduce((accumulator, parameter) => {
    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) {
      accumulator[parameter.parameterName] = parameter.defaultValue;
      return accumulator;
    }

    if (parameter.paramTypeCode === 'boolean') {
      accumulator[parameter.parameterName] = false;
      return accumulator;
    }

    accumulator[parameter.parameterName] = '';
    return accumulator;
  }, {});
}

function cleanParameterValues(values) {
  return Object.fromEntries(
    Object.entries(values || {}).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
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

function shouldRenderSelect(parameter) {
  return (
    parameter.paramTypeCode === 'repo' ||
    parameter.paramTypeCode === 'select' ||
    (parameter.options || []).length > 0
  );
}

function getParameterHelpText(parameter) {
  const type = parameter.paramTypeCode || 'string';

  if (parameter.optionSourceCode) {
    return `${type} parameter · source: ${parameter.optionSourceCode}`;
  }

  return `${type} parameter`;
}

function Tools() {
  const [manifest, setManifest] = useState(null);
  const [selectedToolCode, setSelectedToolCode] = useState('');
  const [parameterValues, setParameterValues] = useState({});
  const [runResult, setRunResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const tools = useMemo(() => manifest?.tools || [], [manifest]);
  const selectedTool = useMemo(
    () => tools.find((tool) => tool.toolCode === selectedToolCode) || tools[0] || null,
    [selectedToolCode, tools],
  );

  useEffect(() => {
    let active = true;

    async function loadTools() {
      setLoading(true);
      setError('');

      try {
        const result = await toolService.listTools();

        if (!active) {
          return;
        }

        setManifest(result);
        setSelectedToolCode(result.tools?.[0]?.toolCode || '');
        setParameterValues(getInitialParameterValues(result.tools?.[0]));
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load tools.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadTools();

    return () => {
      active = false;
    };
  }, []);

  function handleSelectTool(tool) {
    setSelectedToolCode(tool.toolCode);
    setParameterValues(getInitialParameterValues(tool));
    setRunResult(null);
    setError('');
  }

  function updateParameter(parameterName, value) {
    setParameterValues((currentValues) => ({
      ...currentValues,
      [parameterName]: value,
    }));
  }

  async function handleRunTool(event) {
    event.preventDefault();

    if (!selectedTool) {
      return;
    }

    let confirmed = false;

    if (selectedTool.requiresConfirmation) {
      confirmed = window.confirm(selectedTool.confirmationText || `Run ${selectedTool.label}?`);

      if (!confirmed) {
        return;
      }
    }

    setRunning(true);
    setError('');
    setRunResult(null);

    try {
      const result = await toolService.runTool(
        selectedTool.toolCode,
        cleanParameterValues(parameterValues),
        { confirmed },
      );

      setRunResult(result.execution || result);
    } catch (runError) {
      setError(runError.message || 'Tool execution failed.');
    } finally {
      setRunning(false);
    }
  }

  function renderParameterInput(parameter) {
    const parameterName = parameter.parameterName;
    const value = parameterValues[parameterName] ?? '';
    const options = parameter.options || [];

    if (parameter.paramTypeCode === 'boolean') {
      return (
        <div className="form-check form-switch">
          <input
            checked={getBooleanValue(value)}
            className="form-check-input"
            id={parameterName}
            onChange={(event) => updateParameter(parameterName, event.target.checked)}
            type="checkbox"
          />
          <label className="form-check-label sky-muted" htmlFor={parameterName}>
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
            id={parameterName}
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
        id={parameterName}
        onChange={(event) => updateParameter(parameterName, event.target.value)}
        placeholder={parameter.prompt || parameterName}
        required={parameter.required}
        type={getInputType(parameter)}
        value={String(value)}
      />
    );
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Manifest tools</div>
          <h1 className="sky-page-title">Tools</h1>
          <p className="sky-page-subtitle">
            Run permission-filtered, Admin-Web-visible tools through the API execution layer.
          </p>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="sky-empty-state">
          <div className="spinner-border text-info" role="status" aria-label="Loading" />
          <div className="mt-3">Loading tool manifest...</div>
        </div>
      ) : (
        <div className="row g-3">
          <div className="col-lg-5 col-xl-4">
            <section className="sky-card">
              <div className="sky-card-header">
                <h2 className="h5 mb-0">Available tools</h2>
              </div>
              <div className="list-group list-group-flush">
                {tools.map((tool) => (
                  <button
                    className={`list-group-item list-group-item-action bg-transparent text-light border-secondary-subtle ${
                      selectedTool?.toolCode === tool.toolCode ? 'active' : ''
                    }`}
                    key={tool.toolId || tool.toolCode}
                    onClick={() => handleSelectTool(tool)}
                    type="button"
                  >
                    <div className="d-flex justify-content-between gap-2">
                      <span className="fw-bold">{tool.label}</span>
                      <span className={`sky-pill ${riskClass(tool.riskCode)}`}>
                        {tool.riskCode}
                      </span>
                    </div>
                    <div className="small sky-muted mt-1">{tool.category?.label}</div>
                    <div className="small mt-2">{tool.description}</div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="col-lg-7 col-xl-8">
            <section className="sky-card">
              <div className="sky-card-header">
                <h2 className="h5 mb-1">{selectedTool?.label || 'No tool selected'}</h2>
                {selectedTool && (
                  <div className="sky-muted small">
                    <span className="sky-mono">{selectedTool.toolCode}</span>
                    {' · '}
                    Permission: <span className="sky-mono">{selectedTool.permissionCode}</span>
                  </div>
                )}
              </div>

              <div className="sky-card-body">
                {selectedTool ? (
                  <form onSubmit={handleRunTool}>
                    {(selectedTool.parameters || []).length > 0 ? (
                      <div className="row g-3">
                        {selectedTool.parameters.map((parameter) => (
                          <div
                            className="col-md-12"
                            key={parameter.parameterId || parameter.parameterName}
                          >
                            <label className="form-label" htmlFor={parameter.parameterName}>
                              {parameter.label}
                              {parameter.required && <span className="text-danger ms-1">*</span>}
                            </label>

                            {renderParameterInput(parameter)}

                            <div className="form-text sky-muted">
                              {getParameterHelpText(parameter)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : selectedTool.allowParams ? (
                      <div className="sky-empty-state text-warning">
                        This tool allows parameters, but no parameter metadata was returned.
                      </div>
                    ) : (
                      <div className="sky-empty-state">This tool does not require parameters.</div>
                    )}

                    <div className="d-flex align-items-center gap-2 mt-4">
                      <button className="btn sky-btn-primary" disabled={running} type="submit">
                        {running ? 'Running...' : 'Run tool'}
                      </button>
                      {selectedTool.requiresConfirmation && (
                        <span className="sky-pill sky-pill-warning">Confirmation required</span>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className="sky-empty-state">No tools are available for this user.</div>
                )}
              </div>
            </section>

            {runResult && (
              <section className="sky-card mt-3">
                <div className="sky-card-header">
                  <h2 className="h5 mb-0">Execution result</h2>
                </div>
                <div className="sky-card-body">
                  <div className="row g-3 mb-3">
                    <div className="col-md-3">
                      <div className="sky-muted small">Status</div>
                      <span
                        className={`sky-pill ${
                          runResult.status === 'SUCCESS' ? 'sky-pill-success' : 'sky-pill-danger'
                        }`}
                      >
                        {runResult.status || 'UNKNOWN'}
                      </span>
                    </div>
                    <div className="col-md-3">
                      <div className="sky-muted small">Exit code</div>
                      <div>{runResult.exitCode ?? '—'}</div>
                    </div>
                    <div className="col-md-3">
                      <div className="sky-muted small">Duration</div>
                      <div>{runResult.durationMs ?? '—'} ms</div>
                    </div>
                    <div className="col-md-3">
                      <div className="sky-muted small">Execution ID</div>
                      <div className="sky-mono small">{runResult.executionId || '—'}</div>
                    </div>
                  </div>

                  {runResult.summary && (
                    <div className="mb-3">
                      <div className="sky-muted small">Summary</div>
                      <div>{runResult.summary}</div>
                    </div>
                  )}

                  <pre className="sky-code-block">
                    {runResult.stdout || runResult.stderr || 'No output.'}
                  </pre>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default Tools;
