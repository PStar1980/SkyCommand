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

function getInitialParameterValues(tool) {
  return (tool?.parameters || []).reduce((accumulator, parameter) => {
    accumulator[parameter.parameterName] = parameter.defaultValue || '';
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

    if (
      selectedTool.requiresConfirmation &&
      !window.confirm(selectedTool.confirmationText || `Run ${selectedTool.label}?`)
    ) {
      return;
    }

    setRunning(true);
    setError('');
    setRunResult(null);

    try {
      const result = await toolService.runTool(
        selectedTool.toolCode,
        cleanParameterValues(parameterValues),
      );
      setRunResult(result.execution || result);
    } catch (runError) {
      setError(runError.message || 'Tool execution failed.');
    } finally {
      setRunning(false);
    }
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
                            <input
                              className="form-control sky-form-control sky-mono"
                              id={parameter.parameterName}
                              onChange={(event) =>
                                updateParameter(parameter.parameterName, event.target.value)
                              }
                              placeholder={parameter.prompt || parameter.parameterName}
                              required={parameter.required}
                              type="text"
                              value={parameterValues[parameter.parameterName] || ''}
                            />
                            <div className="form-text sky-muted">
                              {parameter.paramTypeCode || 'string'} parameter
                            </div>
                          </div>
                        ))}
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

                  <pre className="sky-code-block">
                    {runResult.stdout || runResult.summary || 'No output.'}
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
