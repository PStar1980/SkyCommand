import { useEffect, useMemo, useState } from 'react';
import ToolExecutionOutputPanels from '../components/tools/ToolExecutionOutputPanels.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import toolService from '../services/toolService';

const HIGH_RISK_CONFIRMATION_PHRASE = 'RUN HIGH RISK';
const RUN_TOOLS_PAGE_SIZE = 10;

const DEFAULT_TOOL_FILTERS = {
  q: '',
  categoryCode: '',
  runtimeCode: '',
  riskCode: '',
};

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

function isHighRiskTool(tool) {
  return String(tool?.riskCode || '').toLowerCase() === 'high';
}

function isHighRiskPhraseValid(value) {
  return (
    String(value || '')
      .trim()
      .toUpperCase() === HIGH_RISK_CONFIRMATION_PHRASE
  );
}

function statusClass(status) {
  if (status === 'SUCCESS') {
    return 'sky-pill-success';
  }

  if (status === 'FAILED') {
    return 'sky-pill-danger';
  }

  if (status === 'STARTED' || status === 'RUNNING') {
    return 'sky-pill-warning';
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

function formatElapsedMilliseconds(milliseconds) {
  if (!milliseconds || milliseconds < 1000) {
    return '< 1s';
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function getDisplaySummary(summary) {
  if (!summary) {
    return '—';
  }

  const lines = String(summary)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.find((line) => /✅|successfully|connected|complete|completed/i.test(line)) ||
    lines.find((line) => !line.includes('[dotenv')) ||
    lines[0] ||
    String(summary)
  );
}

function getCategoryKey(tool) {
  return String(
    tool?.category?.categoryCode ||
      tool?.category?.code ||
      tool?.categoryCode ||
      tool?.category?.label ||
      tool?.categoryLabel ||
      'uncategorized',
  );
}

function getCategoryLabel(tool) {
  return (
    tool?.category?.label ||
    tool?.category?.categoryName ||
    tool?.categoryLabel ||
    tool?.categoryName ||
    'Uncategorized'
  );
}


function Tools() {
  const [manifest, setManifest] = useState(null);
  const [selectedToolCode, setSelectedToolCode] = useState('');
  const [filters, setFilters] = useState(DEFAULT_TOOL_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [parameterValues, setParameterValues] = useState({});
  const [runResult, setRunResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runningStartedAt, setRunningStartedAt] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [error, setError] = useState('');

  const tools = useMemo(() => manifest?.tools || [], [manifest]);
  const categoryOptions = useMemo(() => {
    const categories = new Map();

    tools.forEach((tool) => {
      categories.set(getCategoryKey(tool), getCategoryLabel(tool));
    });

    return Array.from(categories.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [tools]);
  const runtimeOptions = useMemo(
    () =>
      Array.from(new Set(tools.map((tool) => String(tool.runtimeCode || '')).filter(Boolean))).sort(),
    [tools],
  );
  const riskOptions = useMemo(
    () =>
      Array.from(new Set(tools.map((tool) => String(tool.riskCode || '').toLowerCase()).filter(Boolean))).sort(),
    [tools],
  );
  const filteredTools = useMemo(() => {
    const searchText = filters.q.trim().toLowerCase();

    return tools.filter((tool) => {
      if (filters.categoryCode && getCategoryKey(tool) !== filters.categoryCode) {
        return false;
      }

      if (filters.runtimeCode && String(tool.runtimeCode || '') !== filters.runtimeCode) {
        return false;
      }

      if (filters.riskCode && String(tool.riskCode || '').toLowerCase() !== filters.riskCode) {
        return false;
      }

      if (!searchText) {
        return true;
      }

      return [
        tool.label,
        tool.toolCode,
        tool.description,
        getCategoryLabel(tool),
        tool.runtimeCode,
        tool.outputType,
      ].some((value) => String(value || '').toLowerCase().includes(searchText));
    });
  }, [filters, tools]);
  const pageCount = Math.max(1, Math.ceil(filteredTools.length / RUN_TOOLS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart =
    filteredTools.length === 0 ? 0 : (safeCurrentPage - 1) * RUN_TOOLS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * RUN_TOOLS_PAGE_SIZE, filteredTools.length);
  const visibleTools = useMemo(
    () =>
      filteredTools.slice(
        (safeCurrentPage - 1) * RUN_TOOLS_PAGE_SIZE,
        safeCurrentPage * RUN_TOOLS_PAGE_SIZE,
      ),
    [filteredTools, safeCurrentPage],
  );

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.toolCode === selectedToolCode) || null,
    [selectedToolCode, tools],
  );

  const confirmationLocked = pendingConfirmation && !running;
  const interactionLocked = running || confirmationLocked;

  useEffect(() => {
    if (!selectedToolCode || filteredTools.some((tool) => tool.toolCode === selectedToolCode)) {
      return;
    }

    setSelectedToolCode('');
    setParameterValues({});
    setRunResult(null);
    setPendingConfirmation(false);
    setConfirmationPhrase('');
    setError('');
  }, [filteredTools, selectedToolCode]);

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
        setSelectedToolCode('');
        setFilters(DEFAULT_TOOL_FILTERS);
        setCurrentPage(1);
        setParameterValues({});
        setRunResult(null);
        setPendingConfirmation(false);
        setConfirmationPhrase('');
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

  useEffect(() => {
    if (!running || !runningStartedAt) {
      setElapsedMs(0);
      return undefined;
    }

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - runningStartedAt.getTime());
    }, 500);

    return () => window.clearInterval(interval);
  }, [running, runningStartedAt]);


  function updateFilter(name, value) {
    if (interactionLocked) {
      return;
    }

    setFilters((current) => ({ ...current, [name]: value }));
    setCurrentPage(1);
  }

  function clearFilters() {
    if (interactionLocked) {
      return;
    }

    setFilters(DEFAULT_TOOL_FILTERS);
    setCurrentPage(1);
  }

  function goToPage(page) {
    if (interactionLocked) {
      return;
    }

    setCurrentPage(Math.min(Math.max(1, Number(page) || 1), pageCount));
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {rangeStart}-{rangeEnd} of {filteredTools.length} available tool(s)
        </div>
        <div className="sky-pagination-controls" aria-label="Run tools pagination">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || interactionLocked}
            onClick={() => goToPage(1)}
            type="button"
          >
            First
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || interactionLocked}
            onClick={() => goToPage(safeCurrentPage - 1)}
            type="button"
          >
            Back
          </button>
          <label className="sky-pagination-select-label" htmlFor="runToolsPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={interactionLocked}
            id="runToolsPageSelect"
            onChange={(event) => goToPage(event.target.value)}
            value={safeCurrentPage}
          >
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || interactionLocked}
            onClick={() => goToPage(safeCurrentPage + 1)}
            type="button"
          >
            Next
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || interactionLocked}
            onClick={() => goToPage(pageCount)}
            type="button"
          >
            Last
          </button>
        </div>
      </div>
    );
  }

  function handleSelectTool(tool) {
    if (interactionLocked) {
      return;
    }

    setSelectedToolCode(tool.toolCode);
    setParameterValues(getInitialParameterValues(tool));
    setRunResult(null);
    setPendingConfirmation(false);
    setConfirmationPhrase('');
    setError('');
  }

  function updateParameter(parameterName, value) {
    if (interactionLocked) {
      return;
    }

    setParameterValues((currentValues) => ({
      ...currentValues,
      [parameterName]: value,
    }));
  }

  async function runSelectedTool({ confirmed = false } = {}) {
    if (!selectedTool || running) {
      return;
    }

    setRunning(true);
    setRunningStartedAt(new Date());
    setElapsedMs(0);
    setError('');
    setRunResult(null);
    setPendingConfirmation(false);

    try {
      const result = await toolService.runTool(
        selectedTool.toolCode,
        cleanParameterValues(parameterValues),
        {
          confirmed,
          confirmationPhrase: confirmationPhrase.trim(),
        },
      );

      setRunResult(result.execution || result);
    } catch (runError) {
      const failedExecution = runError?.payload?.execution || null;

      if (failedExecution) {
        setRunResult(failedExecution);
      }

      setError(runError.message || failedExecution?.summary || 'Tool execution failed.');
    } finally {
      setRunning(false);
      setRunningStartedAt(null);
    }
  }

  function handleRunTool(event) {
    event.preventDefault();

    if (!selectedTool || running) {
      return;
    }

    if (selectedTool.requiresConfirmation) {
      if (pendingConfirmation) {
        return;
      }

      setPendingConfirmation(true);
      setConfirmationPhrase('');
      setRunResult(null);
      setError('');
      return;
    }

    runSelectedTool({ confirmed: false });
  }

  function handleConfirmRun() {
    if (!selectedTool || running) {
      return;
    }

    if (isHighRiskTool(selectedTool) && !isHighRiskPhraseValid(confirmationPhrase)) {
      setError(`Type ${HIGH_RISK_CONFIRMATION_PHRASE} to confirm this high-risk tool.`);
      return;
    }

    runSelectedTool({ confirmed: true });
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
            disabled={interactionLocked}
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
            disabled={interactionLocked}
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
        disabled={interactionLocked}
        id={parameterName}
        onChange={(event) => updateParameter(parameterName, event.target.value)}
        placeholder={parameter.prompt || parameterName}
        required={parameter.required}
        type={getInputType(parameter)}
        value={String(value)}
      />
    );
  }

  function renderConfirmationPanel() {
    if (!pendingConfirmation || !selectedTool) {
      return null;
    }

    const highRisk = isHighRiskTool(selectedTool);
    const phraseValid = !highRisk || isHighRiskPhraseValid(confirmationPhrase);

    return (
      <div className="sky-confirm-panel mt-4">
        <div className="flex-grow-1">
          <div className="sky-page-kicker mb-1">Confirmation required</div>
          <div className="fw-bold sky-detail-value">
            {selectedTool.confirmationText || `Run ${selectedTool.label}?`}
          </div>
          <div className="small sky-muted mt-1">
            This action will be executed through the API layer and recorded in the script execution
            log.
          </div>

          {highRisk && (
            <div className="mt-3">
              <label className="form-label" htmlFor="highRiskConfirmationPhrase">
                Type <span className="sky-mono">{HIGH_RISK_CONFIRMATION_PHRASE}</span> to confirm
              </label>
              <input
                autoComplete="off"
                className="form-control sky-form-control sky-mono"
                disabled={running}
                id="highRiskConfirmationPhrase"
                onChange={(event) => setConfirmationPhrase(event.target.value)}
                placeholder={HIGH_RISK_CONFIRMATION_PHRASE}
                type="text"
                value={confirmationPhrase}
              />
              <div className="form-text sky-muted">
                High-risk tools require phrase confirmation before the API will execute them.
              </div>
            </div>
          )}
        </div>

        <div className="d-flex flex-wrap gap-2">
          <button
            className="btn sky-btn-primary"
            disabled={running || !phraseValid}
            onClick={handleConfirmRun}
            type="button"
          >
            Confirm and run
          </button>
          <button
            className="btn sky-btn-ghost"
            disabled={running}
            onClick={() => {
              setPendingConfirmation(false);
              setConfirmationPhrase('');
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function renderRunningPanel() {
    if (!running || !selectedTool) {
      return null;
    }

    return (
      <section className="sky-card mt-3 sky-running-card">
        <div className="sky-card-body d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div className="d-flex align-items-center gap-3">
            <div className="spinner-border text-info" role="status" aria-label="Running" />
            <div>
              <div className="sky-page-kicker mb-1">Execution in progress</div>
              <h2 className="h5 mb-1">{selectedTool.label}</h2>
              <div className="small sky-muted">
                The browser is waiting for the API to return the final execution result.
              </div>
            </div>
          </div>

          <div className="text-md-end">
            <div className="sky-muted small">Elapsed</div>
            <div className="sky-stat-value sky-running-timer">
              {formatElapsedMilliseconds(elapsedMs)}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <PageHeader
        kicker="Tools · Execution"
        subtitle="Select a permission-filtered tool, configure its parameters, and inspect both process output and structured workflow evidence."
        title="Run Tools"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="sky-empty-state">
          <div className="spinner-border text-info" role="status" aria-label="Loading" />
          <div className="mt-3">Loading tool manifest...</div>
        </div>
      ) : (
        <div className="sky-run-tools-workspace">
          <section className="sky-card mb-3 sky-functional-history-browser sky-run-tools-browser">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Tool browser</div>
                <h2 className="h5 mb-0">Available tools</h2>
                <p className="sky-muted small mb-0">
                  Filter the permission-visible catalogue, then select a row to configure and run
                  the tool below.
                </p>
              </div>
              <div className="sky-run-tools-filter-grid">
                <div className="sky-run-tools-search-filter">
                  <label className="form-label" htmlFor="runToolsSearchFilter">
                    Search
                  </label>
                  <input
                    className="form-control sky-form-control"
                    disabled={interactionLocked}
                    id="runToolsSearchFilter"
                    onChange={(event) => updateFilter('q', event.target.value)}
                    placeholder="Name, code, description..."
                    type="search"
                    value={filters.q}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="runToolsCategoryFilter">
                    Category
                  </label>
                  <select
                    className="form-select sky-form-control"
                    disabled={interactionLocked}
                    id="runToolsCategoryFilter"
                    onChange={(event) => updateFilter('categoryCode', event.target.value)}
                    value={filters.categoryCode}
                  >
                    <option value="">All categories</option>
                    {categoryOptions.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="runToolsRuntimeFilter">
                    Runtime
                  </label>
                  <select
                    className="form-select sky-form-control"
                    disabled={interactionLocked}
                    id="runToolsRuntimeFilter"
                    onChange={(event) => updateFilter('runtimeCode', event.target.value)}
                    value={filters.runtimeCode}
                  >
                    <option value="">All runtimes</option>
                    {runtimeOptions.map((runtime) => (
                      <option key={runtime} value={runtime}>
                        {runtime}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="runToolsRiskFilter">
                    Risk
                  </label>
                  <select
                    className="form-select sky-form-control"
                    disabled={interactionLocked}
                    id="runToolsRiskFilter"
                    onChange={(event) => updateFilter('riskCode', event.target.value)}
                    value={filters.riskCode}
                  >
                    <option value="">All risks</option>
                    {riskOptions.map((risk) => (
                      <option key={risk} value={risk}>
                        {risk}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sky-run-tools-filter-actions">
                  <button
                    className="btn btn-sm sky-btn-ghost"
                    disabled={interactionLocked}
                    onClick={clearFilters}
                    type="button"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            </div>

            <div className="table-responsive sky-table-card sky-functional-history-table-card">
              <table className="table table-sm table-hover sky-table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Category</th>
                    <th>Runtime</th>
                    <th>Risk</th>
                    <th>Parameters</th>
                    <th>Output contract</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTools.length === 0 ? (
                    <tr>
                      <td colSpan="7">
                        <div className="sky-empty-state">
                          No tools match the current filters.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    visibleTools.map((tool) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedTool?.toolCode === tool.toolCode ? 'sky-selected-row' : ''
                        }`}
                        key={tool.toolId || tool.toolCode}
                        onClick={() => handleSelectTool(tool)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value">{tool.label}</div>
                          <div className="small sky-mono">{tool.toolCode}</div>
                        </td>
                        <td>{getCategoryLabel(tool)}</td>
                        <td>{tool.runtimeCode || tool.runtimeName || '—'}</td>
                        <td>
                          <span className={`sky-pill ${riskClass(tool.riskCode)}`}>
                            {tool.riskCode || 'unknown'}
                          </span>
                        </td>
                        <td>{(tool.parameters || []).length}</td>
                        <td>
                          {tool.outputType ? (
                            <span className="sky-pill sky-pill-info">{tool.outputType}</span>
                          ) : (
                            <span className="sky-muted">Standard process output</span>
                          )}
                        </td>
                        <td className="text-end">
                          <button
                            className="btn btn-sm sky-btn-ghost"
                            disabled={interactionLocked}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectTool(tool);
                            }}
                            type="button"
                          >
                            {selectedTool?.toolCode === tool.toolCode ? 'Selected' : 'Select tool'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {renderPagination()}
          </section>

          <section className="sky-card">
            <div className="sky-card-header sky-run-tool-console-header">
              <div>
                <div className="sky-page-kicker">Execution console</div>
                <h2 className="h5 mb-1">{selectedTool?.label || 'Select a tool'}</h2>
                {selectedTool && (
                  <div className="sky-muted small">
                    <span className="sky-mono">{selectedTool.toolCode}</span>
                    {' · '}
                    Permission: <span className="sky-mono">{selectedTool.permissionCode}</span>
                  </div>
                )}
              </div>
              {selectedTool && (
                <div className="d-flex flex-wrap gap-1">
                  <span className={`sky-pill ${riskClass(selectedTool.riskCode)}`}>
                    {selectedTool.riskCode} risk
                  </span>
                  <span className="sky-pill sky-pill-info">
                    {(selectedTool.parameters || []).length} parameter(s)
                  </span>
                  <span
                    className={`sky-pill ${
                      selectedTool.capturesOutput ? 'sky-pill-success' : 'sky-pill-info'
                    }`}
                  >
                    output {selectedTool.capturesOutput ? 'captured' : 'not captured'}
                  </span>
                  {selectedTool.outputType && (
                    <span className="sky-pill sky-pill-info">{selectedTool.outputType}</span>
                  )}
                </div>
              )}
            </div>

            <div className="sky-card-body">
              {selectedTool ? (
                <form onSubmit={handleRunTool}>
                  <div className="sky-run-tool-description mb-4">
                    <div className="sky-detail-label">Purpose</div>
                    <div className="sky-detail-value">{selectedTool.description || '—'}</div>
                  </div>

                  {(selectedTool.parameters || []).length > 0 ? (
                    <div className="row g-3 sky-run-tool-parameter-grid">
                      {selectedTool.parameters.map((parameter) => (
                        <div
                          className="col-xl-6 col-md-12"
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

                  {renderConfirmationPanel()}

                  <div className="d-flex align-items-center gap-2 mt-4">
                    <button
                      className="btn sky-btn-primary"
                      disabled={interactionLocked}
                      type="submit"
                    >
                      {running
                        ? 'Running...'
                        : pendingConfirmation
                          ? 'Awaiting confirmation'
                          : 'Run tool'}
                    </button>
                    {selectedTool.requiresConfirmation && (
                      <span className="sky-pill sky-pill-warning">Confirmation required</span>
                    )}
                  </div>
                </form>
              ) : (
                <div className="sky-empty-state">
                  {tools.length === 0
                    ? 'No tools are available for this user.'
                    : 'Select a tool from the table above to view execution options.'}
                </div>
              )}
            </div>
          </section>

          {renderRunningPanel()}

          {runResult && (
            <section className="sky-card mt-3 sky-run-tool-result-workspace">
              <div className="sky-card-header sky-run-tool-result-header">
                <div>
                  <div className="sky-page-kicker">Execution workspace</div>
                  <h2 className="h5 mb-0">Tool output</h2>
                  <div className="small sky-muted mt-1">
                    {getDisplaySummary(runResult.summary || runResult.toolResult?.message)}
                  </div>
                </div>
                <span className={`sky-pill ${statusClass(runResult.status)}`}>
                  {runResult.status || 'UNKNOWN'}
                </span>
              </div>
              <div className="sky-card-body">
                <div className="sky-run-tool-result-metrics mb-3">
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Exit code</div>
                    <div className="sky-mini-metric-value">{runResult.exitCode ?? '—'}</div>
                  </div>
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Duration</div>
                    <div className="sky-mini-metric-value">{runResult.durationMs ?? '—'} ms</div>
                  </div>
                  <div className="sky-mini-metric sky-run-tool-result-execution-id">
                    <div className="sky-page-kicker">Execution ID</div>
                    <div className="sky-mono small sky-detail-value">
                      {runResult.executionId || '—'}
                    </div>
                  </div>
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Structured contract</div>
                    <div className="sky-detail-value">
                      {runResult.toolResultContract?.status || 'Not emitted'}
                    </div>
                  </div>
                </div>

                <ToolExecutionOutputPanels
                  stderr={runResult.stderr || ''}
                  stdout={runResult.stdout || ''}
                  structuredOutputExpected={Boolean(runResult.toolResultContract?.required)}
                  toolResult={runResult.toolResult || null}
                  toolResultContract={runResult.toolResultContract || null}
                />
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

export default Tools;
