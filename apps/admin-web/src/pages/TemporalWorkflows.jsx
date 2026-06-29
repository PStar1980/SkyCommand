import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import temporalService from '../services/temporalService';

const DEFAULT_START_FORM = {
  indicators: '',
  concurrency: '3',
  workflowId: '',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'Running', label: 'Running' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Failed', label: 'Failed' },
  { value: 'Canceled', label: 'Canceled' },
  { value: 'Terminated', label: 'Terminated' },
];

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return '—';
  }

  return new Intl.NumberFormat().format(numberValue);
}

function normalizeStatus(status) {
  return String(status || 'UNKNOWN').toUpperCase();
}

function statusClass(status) {
  const normalizedStatus = normalizeStatus(status);

  if (normalizedStatus === 'COMPLETED' || normalizedStatus === 'OK' || normalizedStatus === 'CURRENT') {
    return 'sky-pill-success';
  }

  if (
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'ERROR' ||
    normalizedStatus === 'TERMINATED' ||
    normalizedStatus === 'TIMED_OUT'
  ) {
    return 'sky-pill-danger';
  }

  if (normalizedStatus === 'RUNNING' || normalizedStatus === 'CANCELING') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function statusDotClass(status) {
  const normalizedStatus = normalizeStatus(status);

  if (normalizedStatus === 'COMPLETED' || normalizedStatus === 'OK' || normalizedStatus === 'CURRENT') {
    return 'sky-status-dot-success';
  }

  if (
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'ERROR' ||
    normalizedStatus === 'TERMINATED' ||
    normalizedStatus === 'TIMED_OUT'
  ) {
    return 'sky-status-dot-danger';
  }

  if (normalizedStatus === 'RUNNING' || normalizedStatus === 'CANCELING') {
    return 'sky-status-dot-warning';
  }

  return 'sky-status-dot-info';
}

function getStatusLabel(status) {
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus === 'UNKNOWN' ? '—' : normalizedStatus;
}

function parseIndicators(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function getWorkflowKey(workflow) {
  return `${workflow?.workflowId || ''}:${workflow?.runId || ''}`;
}

function workflowIsRunning(workflow) {
  return normalizeStatus(workflow?.status) === 'RUNNING';
}

function jsonPreview(value) {
  if (!value) {
    return '{}';
  }

  return JSON.stringify(value, null, 2);
}

function getDefinitionSummary(definition) {
  if (!definition) {
    return 'No approved workflow template loaded yet.';
  }

  const maxConcurrency = definition.maxConcurrency || '—';
  const defaultConcurrency = definition.defaultConcurrency || '—';

  return `${definition.displayName || definition.workflowType} · default concurrency ${defaultConcurrency} · max ${maxConcurrency}`;
}

function TemporalWorkflows() {
  const { hasPermission } = useAuth();
  const canStart = hasPermission('TEMPORAL_WORKFLOW_START') || hasPermission('INGESTION_RUN_FRED');
  const canCancel = hasPermission('TEMPORAL_WORKFLOW_CANCEL');
  const canTerminate = hasPermission('TEMPORAL_WORKFLOW_TERMINATE');

  const [health, setHealth] = useState(null);
  const [definitions, setDefinitions] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [filters, setFilters] = useState({ status: '', limit: '25' });
  const [startForm, setStartForm] = useState(DEFAULT_START_FORM);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [error, setError] = useState('');
  const [startMessage, setStartMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const fredDefinition = useMemo(
    () => definitions.find((item) => item.workflowCode === 'fred-ingestion') || definitions[0],
    [definitions],
  );

  const runningCount = workflows.filter((workflow) => workflowIsRunning(workflow)).length;
  const completedCount = workflows.filter(
    (workflow) => normalizeStatus(workflow.status) === 'COMPLETED',
  ).length;
  const failedCount = workflows.filter((workflow) =>
    ['FAILED', 'TERMINATED', 'TIMED_OUT'].includes(normalizeStatus(workflow.status)),
  ).length;

  async function loadConsole({ keepSelection = true } = {}) {
    setError('');
    setRefreshing(true);

    try {
      const query = {
        limit: filters.limit,
        workflowType: fredDefinition?.workflowType || 'fredIngestionWorkflow',
        status: filters.status,
      };

      const [healthResult, definitionsResult, workflowsResult] = await Promise.all([
        temporalService.getHealth(),
        temporalService.listWorkflowDefinitions(),
        temporalService.listWorkflows(query),
      ]);

      const loadedWorkflows = workflowsResult.items || [];

      setHealth(healthResult);
      setDefinitions(definitionsResult.items || []);
      setWorkflows(loadedWorkflows);

      if (keepSelection && selectedWorkflow?.workflowId) {
        const matchingWorkflow = loadedWorkflows.find(
          (workflow) => workflow.workflowId === selectedWorkflow.workflowId,
        );

        if (matchingWorkflow) {
          setSelectedWorkflow(matchingWorkflow);
        }
      } else if (!keepSelection) {
        setSelectedWorkflow(null);
      }
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Temporal workflow console.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadWorkflowDetail(workflow) {
    if (!workflow?.workflowId) {
      return;
    }

    setDetailLoading(true);
    setError('');

    try {
      const result = await temporalService.getWorkflow(workflow.workflowId, {
        runId: workflow.runId,
      });
      setSelectedWorkflow(result.workflow || workflow);
    } catch (detailError) {
      setError(detailError.message || 'Failed to load workflow detail.');
      setSelectedWorkflow(workflow);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRefresh() {
    await loadConsole();
  }

  async function handleStartSubmit(event) {
    event.preventDefault();

    if (!canStart) {
      setStartMessage('You do not have permission to start Temporal workflows.');
      return;
    }

    setStarting(true);
    setStartMessage('');
    setError('');

    try {
      const indicators = parseIndicators(startForm.indicators);
      const payload = {
        indicators,
        concurrency: Number(startForm.concurrency) || fredDefinition?.defaultConcurrency || 3,
        runSource: 'admin_web_manual',
      };

      if (startForm.workflowId.trim()) {
        payload.workflowId = startForm.workflowId.trim();
      }

      const result = await temporalService.startFredIngestionWorkflow(payload);
      const workflow = result.workflow;

      setStartMessage(
        `Started ${workflow.workflowType} as ${workflow.workflowId}. ${
          indicators.length > 0 ? `${indicators.length} selected indicator(s).` : 'Full indicator set.'
        }`,
      );
      setStartForm(DEFAULT_START_FORM);
      setSelectedWorkflow(workflow);
      await loadConsole({ keepSelection: true });
    } catch (startError) {
      setStartMessage(startError.message || 'Failed to start FRED ingestion workflow.');
    } finally {
      setStarting(false);
    }
  }

  async function handleCancelWorkflow(workflow) {
    if (!workflow?.workflowId || !canCancel) {
      return;
    }

    setActionBusy('cancel');
    setActionMessage('');
    setError('');

    try {
      await temporalService.cancelWorkflow(workflow.workflowId, { runId: workflow.runId });
      setActionMessage(`Cancel requested for ${workflow.workflowId}.`);
      await loadConsole({ keepSelection: true });
    } catch (cancelError) {
      setActionMessage(cancelError.message || 'Failed to request workflow cancellation.');
    } finally {
      setActionBusy('');
    }
  }

  async function handleTerminateWorkflow(workflow) {
    if (!workflow?.workflowId || !canTerminate) {
      return;
    }

    const confirmed = window.confirm(
      `Terminate workflow ${workflow.workflowId}? This is stronger than cancel and should only be used when a run must be stopped immediately.`,
    );

    if (!confirmed) {
      return;
    }

    setActionBusy('terminate');
    setActionMessage('');
    setError('');

    try {
      await temporalService.terminateWorkflow(workflow.workflowId, {
        runId: workflow.runId,
        reason: 'Terminated from SkyServer Admin-Web Temporal console.',
      });
      setActionMessage(`Terminate requested for ${workflow.workflowId}.`);
      await loadConsole({ keepSelection: true });
    } catch (terminateError) {
      setActionMessage(terminateError.message || 'Failed to terminate workflow.');
    } finally {
      setActionBusy('');
    }
  }

  useEffect(() => {
    loadConsole({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterKey = `${filters.status}:${filters.limit}`;

  useEffect(() => {
    if (!loading) {
      loadConsole({ keepSelection: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return (
    <div>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Automation · Temporal</div>
          <h1 className="sky-page-title">Workflow Console</h1>
          <p className="sky-page-subtitle">
            Start approved Temporal workflows, inspect recent runs, and manage active executions
            through SkyServer Core instead of the CLI.
          </p>
        </div>
        <button
          className="btn sky-btn-ghost"
          disabled={refreshing}
          onClick={handleRefresh}
          type="button"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-worker-hero mb-4">
        <div>
          <div className="sky-page-kicker">Temporal service</div>
          <h2 className="h4 mb-2">Durable execution lane</h2>
          <p className="sky-muted mb-3">
            SkyServer Admin now talks to SkyServer Core/API, and Core starts or inspects
            Temporal workflows on behalf of the browser. The browser never talks to Temporal
            directly.
          </p>
          <div className="sky-worker-command-strip">
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Health</div>
              <div className="d-flex align-items-center gap-2">
                <span className={`sky-status-dot ${statusDotClass(health?.ok ? 'OK' : 'UNKNOWN')}`} />
                <span className={`sky-pill ${statusClass(health?.ok ? 'OK' : 'UNKNOWN')}`}>
                  {health?.ok ? 'ONLINE' : loading ? 'LOADING' : 'UNKNOWN'}
                </span>
              </div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Namespace</div>
              <div className="sky-worker-command-value sky-mono">{health?.namespace || '—'}</div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Task queue</div>
              <div className="sky-worker-command-value sky-mono">
                {health?.taskQueue || fredDefinition?.taskQueue || '—'}
              </div>
            </div>
          </div>
        </div>

        <div className="sky-card">
          <div className="sky-card-header">
            <div className="sky-page-kicker">Approved template</div>
            <h3 className="h5 mb-0">{fredDefinition?.displayName || 'FRED Macro Ingestion'}</h3>
          </div>
          <div className="sky-card-body">
            <p className="sky-muted mb-3">{getDefinitionSummary(fredDefinition)}</p>
            <div className="row g-2">
              <div className="col-4">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Loaded</div>
                  <div className="sky-mini-metric-value">{formatNumber(workflows.length)}</div>
                </div>
              </div>
              <div className="col-4">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Running</div>
                  <div className="sky-mini-metric-value">{formatNumber(runningCount)}</div>
                </div>
              </div>
              <div className="col-4">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Failed</div>
                  <div className="sky-mini-metric-value">{formatNumber(failedCount)}</div>
                </div>
              </div>
            </div>
            <div className="small sky-muted mt-3">
              Completed in this filtered load: {formatNumber(completedCount)}
            </div>
          </div>
        </div>
      </section>

      <div className="row g-4">
        <div className="col-xl-4">
          <div className="sky-card mb-4">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Manual start</div>
              <h2 className="h5 mb-0">Run FRED ingestion</h2>
            </div>
            <form className="sky-card-body" onSubmit={handleStartSubmit}>
              {startMessage && (
                <div
                  className={`alert ${startMessage.toLowerCase().includes('failed') ? 'alert-danger' : 'alert-success'}`}
                >
                  {startMessage}
                </div>
              )}

              <div className="mb-3">
                <label className="form-label" htmlFor="temporalIndicators">
                  Indicators
                </label>
                <textarea
                  className="form-control sky-form-control"
                  id="temporalIndicators"
                  onChange={(event) =>
                    setStartForm((current) => ({ ...current, indicators: event.target.value }))
                  }
                  placeholder="GDP, UNRATE, DGS10 — leave blank for full FRED set"
                  rows={4}
                  value={startForm.indicators}
                />
                <div className="form-text">
                  Comma, space, or newline separated. Blank runs every configured FRED indicator.
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="temporalConcurrency">
                  Concurrency
                </label>
                <input
                  className="form-control sky-form-control"
                  id="temporalConcurrency"
                  max={fredDefinition?.maxConcurrency || 10}
                  min="1"
                  onChange={(event) =>
                    setStartForm((current) => ({ ...current, concurrency: event.target.value }))
                  }
                  type="number"
                  value={startForm.concurrency}
                />
                <div className="form-text">
                  Worker batches up to this many indicator activities at once.
                </div>
              </div>

              <div className="mb-4">
                <label className="form-label" htmlFor="temporalWorkflowId">
                  Workflow ID override
                </label>
                <input
                  className="form-control sky-form-control"
                  id="temporalWorkflowId"
                  onChange={(event) =>
                    setStartForm((current) => ({ ...current, workflowId: event.target.value }))
                  }
                  placeholder="Optional; normally auto-generated"
                  type="text"
                  value={startForm.workflowId}
                />
              </div>

              <button className="btn sky-btn-primary w-100" disabled={starting || !canStart} type="submit">
                {starting ? 'Starting...' : 'Start workflow'}
              </button>
              {!canStart && (
                <div className="small sky-muted mt-2">
                  TEMPORAL_WORKFLOW_START permission is required to start workflows.
                </div>
              )}
            </form>
          </div>

          <div className="sky-card sky-sticky-detail-card">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Run detail</div>
              <h2 className="h5 mb-0">Selected workflow</h2>
            </div>
            <div className="sky-card-body">
              {!selectedWorkflow ? (
                <div className="sky-empty-state py-4">Select a workflow run to inspect it.</div>
              ) : (
                <>
                  {actionMessage && (
                    <div
                      className={`alert ${actionMessage.toLowerCase().includes('failed') ? 'alert-danger' : 'alert-success'}`}
                    >
                      {actionMessage}
                    </div>
                  )}
                  <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                    <span className={`sky-pill ${statusClass(selectedWorkflow.status)}`}>
                      {getStatusLabel(selectedWorkflow.status)}
                    </span>
                    {detailLoading && <span className="small sky-muted">Loading detail...</span>}
                  </div>

                  <dl className="row small mb-3">
                    <dt className="col-4 sky-detail-label">Workflow</dt>
                    <dd className="col-8 sky-detail-value sky-mono text-break">
                      {selectedWorkflow.workflowId || '—'}
                    </dd>
                    <dt className="col-4 sky-detail-label">Run</dt>
                    <dd className="col-8 sky-detail-value sky-mono text-break">
                      {selectedWorkflow.runId || '—'}
                    </dd>
                    <dt className="col-4 sky-detail-label">Type</dt>
                    <dd className="col-8 sky-detail-value">{selectedWorkflow.workflowType || '—'}</dd>
                    <dt className="col-4 sky-detail-label">Started</dt>
                    <dd className="col-8 sky-detail-value">{formatDate(selectedWorkflow.startTime)}</dd>
                    <dt className="col-4 sky-detail-label">Closed</dt>
                    <dd className="col-8 sky-detail-value">{formatDate(selectedWorkflow.closeTime)}</dd>
                    <dt className="col-4 sky-detail-label">History</dt>
                    <dd className="col-8 sky-detail-value">
                      {formatNumber(selectedWorkflow.historyLength)}
                    </dd>
                  </dl>

                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <button
                      className="btn btn-sm sky-btn-ghost"
                      disabled={detailLoading}
                      onClick={() => loadWorkflowDetail(selectedWorkflow)}
                      type="button"
                    >
                      Reload detail
                    </button>
                    <button
                      className="btn btn-sm sky-btn-ghost"
                      disabled={!workflowIsRunning(selectedWorkflow) || !canCancel || Boolean(actionBusy)}
                      onClick={() => handleCancelWorkflow(selectedWorkflow)}
                      type="button"
                    >
                      {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel'}
                    </button>
                    <button
                      className="btn btn-sm sky-btn-danger"
                      disabled={!workflowIsRunning(selectedWorkflow) || !canTerminate || Boolean(actionBusy)}
                      onClick={() => handleTerminateWorkflow(selectedWorkflow)}
                      type="button"
                    >
                      {actionBusy === 'terminate' ? 'Terminating...' : 'Terminate'}
                    </button>
                  </div>

                  <pre className="sky-code-block sky-worker-json-preview">
                    {jsonPreview(selectedWorkflow.raw || selectedWorkflow)}
                  </pre>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="col-xl-8">
          <div className="sky-card">
            <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
              <div>
                <div className="sky-page-kicker">Recent runs</div>
                <h2 className="h5 mb-0">Temporal workflow runs</h2>
              </div>
              <div className="sky-inline-filter-form">
                <select
                  className="form-select sky-form-control"
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, status: event.target.value }))
                  }
                  value={filters.status}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="form-select sky-form-control"
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, limit: event.target.value }))
                  }
                  value={filters.limit}
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
            </div>

            <div className="table-responsive sky-table-card">
              <table className="table table-sm table-hover sky-table align-middle">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Workflow ID</th>
                    <th>Type</th>
                    <th>Started</th>
                    <th>Closed</th>
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan="6">
                        <div className="sky-empty-state">Loading Temporal workflows...</div>
                      </td>
                    </tr>
                  )}
                  {!loading && workflows.length === 0 && (
                    <tr>
                      <td colSpan="6">
                        <div className="sky-empty-state">No workflow runs found for this filter.</div>
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    workflows.map((workflow) => (
                      <tr
                        className={`sky-clickable-row ${
                          getWorkflowKey(selectedWorkflow) === getWorkflowKey(workflow)
                            ? 'sky-selected-row'
                            : ''
                        }`}
                        key={getWorkflowKey(workflow)}
                        onClick={() => loadWorkflowDetail(workflow)}
                      >
                        <td>
                          <span className={`sky-pill ${statusClass(workflow.status)}`}>
                            {getStatusLabel(workflow.status)}
                          </span>
                        </td>
                        <td className="sky-mono text-break">{workflow.workflowId || '—'}</td>
                        <td>{workflow.workflowType || '—'}</td>
                        <td>{formatDate(workflow.startTime || workflow.executionTime)}</td>
                        <td>{formatDate(workflow.closeTime)}</td>
                        <td>{formatNumber(workflow.historyLength)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TemporalWorkflows;
