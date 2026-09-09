import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import browserTestService from '../services/browserTestService.js';

const TERMINAL_RUN_STATUSES = new Set(['PASSED', 'COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const DEFAULT_RUN_FILTERS = { q: '', categoryCode: '', environmentCode: '', browserType: '' };
const DEFAULT_OPERATIONS_FILTERS = { q: '', categoryCode: '', environmentCode: '', status: '' };
const DEFAULT_MANAGE_FILTERS = { q: '', categoryCode: '', riskCode: '', enabled: '' };
const BROWSER_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50];


function getAvailableBrowserPageSizes(total) {
  const recordCount = Math.max(0, Number(total) || 0);
  return BROWSER_TABLE_PAGE_SIZE_OPTIONS.filter((size) => {
    if (size === 10) return true;
    if (size === 25) return recordCount >= 11;
    if (size === 50) return recordCount >= 26;
    return false;
  });
}

function compareBrowserTableValues(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null || left === '') return 1;
  if (right === undefined || right === null || right === '') return -1;
  if (left instanceof Date || right instanceof Date) {
    return new Date(left).getTime() - new Date(right).getTime();
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && String(left).trim() !== '' && String(right).trim() !== '') {
    return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function sortStacksMatch(left = [], right = []) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useBrowserTable(items, { defaultSorts, getSortValue, resetKey }) {
  const [sorts, setSorts] = useState(defaultSorts);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((left, right) => {
      for (const sort of sorts) {
        const comparison = compareBrowserTableValues(
          getSortValue(left, sort.field),
          getSortValue(right, sort.field),
        );
        if (comparison !== 0) return sort.direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
    return copy;
  }, [items, sorts, getSortValue]);

  const total = sortedItems.length;
  const availablePageSizes = getAvailableBrowserPageSizes(total);
  const normalizedPageSize = availablePageSizes.includes(pageSize)
    ? pageSize
    : availablePageSizes[availablePageSizes.length - 1] || 10;
  const pageCount = Math.max(1, Math.ceil(total / normalizedPageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageItems = sortedItems.slice((safePage - 1) * normalizedPageSize, safePage * normalizedPageSize);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * normalizedPageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(total, safePage * normalizedPageSize);
  const sortingCustomized = !sortStacksMatch(sorts, defaultSorts);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
    if (pageSize !== normalizedPageSize) setPageSize(normalizedPageSize);
  }, [page, pageSize, safePage, normalizedPageSize]);

  function updateSorting(field, event) {
    const multi = Boolean(event?.shiftKey);
    setSorts((current) => {
      const activeIndex = current.findIndex((sort) => sort.field === field);
      const active = activeIndex >= 0 ? current[activeIndex] : null;
      if (!multi) {
        if (!active || current.length !== 1) return [{ field, direction: 'asc' }];
        if (active.direction === 'asc') return [{ field, direction: 'desc' }];
        return defaultSorts;
      }
      const next = [...current];
      if (!active) next.push({ field, direction: 'asc' });
      else if (active.direction === 'asc') next[activeIndex] = { field, direction: 'desc' };
      else next.splice(activeIndex, 1);
      return next.length ? next : defaultSorts;
    });
  }

  function changePageSize(value) {
    const next = Number(value);
    if (!BROWSER_TABLE_PAGE_SIZE_OPTIONS.includes(next)) return;
    setPageSize(next);
    setPage(1);
  }

  return {
    availablePageSizes,
    changePageSize,
    clearSorting: () => setSorts(defaultSorts),
    page: safePage,
    pageCount,
    pageItems,
    pageSize: normalizedPageSize,
    rangeEnd,
    rangeStart,
    setPage: (value) => setPage(Math.min(Math.max(1, Number(value) || 1), pageCount)),
    sortingCustomized,
    sorts,
    total,
    updateSorting,
  };
}

function BrowserSortableHeader({ field, label, table }) {
  const activeIndex = table.sorts.findIndex((sort) => sort.field === field);
  const activeSort = activeIndex >= 0 ? table.sorts[activeIndex] : null;
  const directionIcon = activeSort?.direction === 'asc' ? '↑' : '↓';
  const sortDescription = activeSort
    ? `${activeSort.direction === 'asc' ? 'ascending' : 'descending'}, priority ${activeIndex + 1}`
    : 'not currently sorted';

  return (
    <th>
      <button
        aria-label={`${label}: ${sortDescription}. Click to sort; Shift+click to add to multi-column sorting.`}
        className={`sky-table-sort-button ${activeSort ? 'is-active' : ''}`}
        onClick={(event) => table.updateSorting(field, event)}
        title="Click to sort · Shift+click to add sort"
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="sky-table-sort-indicator">{activeSort ? directionIcon : '↕'}</span>
        {activeSort && <span aria-hidden="true" className="sky-table-sort-priority">{activeIndex + 1}</span>}
      </button>
    </th>
  );
}

function BrowserTablePagination({ label, loading = false, table }) {
  return (
    <div className="sky-pagination-row sky-canonical-operations-pagination-row">
      <div className="small sky-muted sky-canonical-operations-pagination-summary">
        Showing {table.rangeStart}–{table.rangeEnd} of {table.total} {label}
      </div>
      <div aria-label={`${label} pagination`} className="sky-pagination-controls sky-canonical-operations-pagination-controls">
        <button aria-label="First page" className="btn btn-sm sky-pagination-nav-button" disabled={table.page <= 1 || loading} onClick={() => table.setPage(1)} type="button">«</button>
        <button aria-label="Previous page" className="btn btn-sm sky-pagination-nav-button" disabled={table.page <= 1 || loading} onClick={() => table.setPage(table.page - 1)} type="button">‹</button>
        <label className="sky-pagination-select-label">Page</label>
        <select className="form-select form-select-sm sky-form-control sky-pagination-select" disabled={loading} onChange={(event) => table.setPage(event.target.value)} value={table.page}>
          {Array.from({ length: table.pageCount }, (_, index) => index + 1).map((page) => <option key={page} value={page}>{page}</option>)}
        </select>
        <span className="small sky-muted">of {table.pageCount}</span>
        <button aria-label="Next page" className="btn btn-sm sky-pagination-nav-button" disabled={table.page >= table.pageCount || loading} onClick={() => table.setPage(table.page + 1)} type="button">›</button>
        <button aria-label="Last page" className="btn btn-sm sky-pagination-nav-button" disabled={table.page >= table.pageCount || loading} onClick={() => table.setPage(table.pageCount)} type="button">»</button>
      </div>
      <div className="sky-canonical-rows-control">
        <label className="sky-pagination-select-label">Rows</label>
        <select className="form-select form-select-sm sky-form-control sky-pagination-select sky-canonical-rows-select" disabled={loading} onChange={(event) => table.changePageSize(event.target.value)} value={table.pageSize}>
          {table.availablePageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </div>
    </div>
  );
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function formatDuration(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function getRunDuration(run) {
  if (run?.result?.durationMs !== undefined) return Number(run.result.durationMs);
  if (!run?.startTime) return null;
  const start = new Date(run.startTime).getTime();
  const end = run.closeTime ? new Date(run.closeTime).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function riskToneClass(riskCode) {
  const normalized = String(riskCode || '').toLowerCase();
  if (normalized === 'high') return 'sky-pill-danger';
  if (normalized === 'medium') return 'sky-pill-warning';
  return 'sky-pill-success';
}

function getInitialParameterValues(test) {
  return (test?.parameters || []).reduce((values, parameter) => {
    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) {
      values[parameter.parameterName] = parameter.defaultValue;
    } else if (parameter.type === 'boolean') {
      values[parameter.parameterName] = false;
    } else {
      values[parameter.parameterName] = '';
    }
    return values;
  }, {});
}

function cleanParameterValues(values = {}) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function BrowserRuntimeParameterFields({ disabled = false, parameters = [], values = {}, onChange }) {
  const orderedParameters = [...parameters]
    .filter((parameter) => parameter.enabled !== false)
    .sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0));

  if (orderedParameters.length === 0) {
    return <div className="small sky-muted">This Browser Test has no runtime parameters.</div>;
  }

  return (
    <div className="row g-3">
      {orderedParameters.map((parameter) => {
        const id = `browser-test-param-${parameter.parameterName}`;
        const value = values[parameter.parameterName] ?? '';
        const options = (parameter.options || []).filter((option) => option.enabled !== false);
        const shouldUseSelect = parameter.type === 'repo' || parameter.type === 'select' || options.length > 0;

        return (
          <div className="col-12 col-lg-6" key={parameter.parameterId || parameter.parameterName}>
            <label className="form-label" htmlFor={id}>
              {parameter.label}
              {parameter.required && <span className="text-danger"> *</span>}
            </label>

            {parameter.type === 'boolean' ? (
              <div className="form-check form-switch pt-1">
                <input
                  checked={normalizeBoolean(value)}
                  className="form-check-input"
                  disabled={disabled}
                  id={id}
                  onChange={(event) => onChange(parameter.parameterName, event.target.checked)}
                  type="checkbox"
                />
                <label className="form-check-label sky-muted" htmlFor={id}>
                  {parameter.prompt || parameter.label}
                </label>
              </div>
            ) : shouldUseSelect ? (
              <select
                className="form-select sky-form-control"
                disabled={disabled}
                id={id}
                onChange={(event) => onChange(parameter.parameterName, event.target.value)}
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
            ) : parameter.type === 'json' ? (
              <textarea
                className="form-control sky-form-control sky-mono"
                disabled={disabled}
                id={id}
                onChange={(event) => onChange(parameter.parameterName, event.target.value)}
                placeholder={parameter.prompt || parameter.parameterName}
                rows={4}
                value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              />
            ) : (
              <input
                className="form-control sky-form-control"
                disabled={disabled}
                id={id}
                onChange={(event) => onChange(parameter.parameterName, event.target.value)}
                placeholder={parameter.prompt || parameter.parameterName}
                required={parameter.required}
                type={parameter.type === 'number' ? 'number' : parameter.type === 'date' ? 'date' : 'text'}
                value={String(value)}
              />
            )}

            {parameter.type !== 'boolean' && parameter.prompt && (
              <div className="form-text sky-muted">{parameter.prompt}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatArtifactSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function artifactActionLabel(artifact) {
  const kind = String(artifact?.kind || '').toUpperCase();
  if (kind === 'TRACE') return 'Download Trace';
  if (kind === 'SCREENSHOT') return 'Open Screenshot';
  if (kind === 'VIDEO') return 'Open Video';
  if (kind === 'REPORT') return 'Download Report';
  return 'Open Artifact';
}

function BrowserRunStatusPanel({ run, workflowId }) {
  const [artifactBusyId, setArtifactBusyId] = useState('');
  const [artifactError, setArtifactError] = useState('');
  if (!workflowId) return null;
  const status = run?.status || 'STARTED';
  const result = run?.result || null;
  const testCases = result?.testCases || null;
  const assertions = result?.assertions || null;
  const parameters = run?.parameters && typeof run.parameters === 'object' ? Object.entries(run.parameters) : [];
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const linkedWorkflowIds = Array.isArray(run?.linkedWorkflowIds) ? run.linkedWorkflowIds : [];
  const failure = run?.failure || result?.failure || null;
  const sourceCommit = run?.sourceCommit || result?.sourceCommit || null;

  async function openArtifact(artifact) {
    if (!artifact?.artifactId || artifactBusyId) return;
    const kind = String(artifact.kind || '').toUpperCase();
    const inline = ['SCREENSHOT', 'VIDEO'].includes(kind);
    const previewWindow = inline ? window.open('about:blank', '_blank') : null;
    if (previewWindow) previewWindow.opener = null;
    setArtifactBusyId(artifact.artifactId);
    setArtifactError('');
    try {
      const payload = await browserTestService.getArtifact(workflowId, artifact.artifactId);
      const objectUrl = window.URL.createObjectURL(payload.blob);
      if (inline && previewWindow) {
        previewWindow.location.replace(objectUrl);
      } else {
        if (previewWindow) previewWindow.close();
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = payload.filename || artifact.name || 'browser-artifact';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (loadError) {
      if (previewWindow) previewWindow.close();
      setArtifactError(loadError.message || 'Failed to open Browser Test evidence.');
    } finally {
      setArtifactBusyId('');
    }
  }

  return (
    <Panel
      actions={<><StatusPill status={status} />{run?.temporalStatus && <span className="sky-pill sky-pill-info">Temporal {String(run.temporalStatus).toUpperCase()}</span>}</>}
      className="mt-3"
      kicker="EXECUTION DETAIL"
      subtitle="Durable Playwright Test result, input snapshot, source lineage, and browser evidence."
      title={run?.testLabel || 'Browser Test Run'}
    >
      <div className="sky-card-body">
        <div className="table-responsive sky-canonical-operations-table-frame">
          <table className="table table-sm align-middle sky-table sky-canonical-operations-table mb-0">
            <tbody>
              <tr><th>Test</th><td>{run?.testLabel || run?.testCode || '—'}{run?.testCode && <div className="small sky-muted sky-mono">{run.testCode}</div>}</td></tr>
              <tr><th>Workflow ID</th><td className="sky-mono">{workflowId}</td></tr>
              <tr><th>Run ID</th><td className="sky-mono">{run?.runId || '—'}</td></tr>
              <tr><th>Test status</th><td><StatusPill status={status} /></td></tr>
              <tr><th>Temporal status</th><td><StatusPill status={run?.temporalStatus || 'UNKNOWN'} /></td></tr>
              <tr><th>Environment / Browser</th><td>{run?.environmentCode || '—'} · <span className="text-uppercase">{run?.browserType || 'chromium'}</span></td></tr>
              <tr><th>Execution mode</th><td>{String(run?.executionMode || result?.executionMode || 'HEADLESS').toUpperCase() === 'INTERACTIVE' ? 'Interactive · Host Agent' : 'Headless · Browser Worker'}</td></tr>
              <tr><th>Triggered by</th><td>{run?.initiatedBy || '—'}{run?.triggerSource && <span className="small sky-muted"> · {run.triggerSource}</span>}</td></tr>
              <tr><th>Started</th><td>{formatDateTime(run?.startTime)}</td></tr>
              <tr><th>Completed</th><td>{formatDateTime(run?.closeTime)}</td></tr>
              <tr><th>Duration</th><td>{formatDuration(getRunDuration(run))}</td></tr>
              <tr><th>Source revision</th><td>{run?.sourceRepositoryCode || '—'}{sourceCommit ? <span className="sky-mono" title={sourceCommit}> · {sourceCommit.slice(0, 12)}</span> : <span className="sky-muted"> · SHA unavailable</span>}</td></tr>
            </tbody>
          </table>
        </div>

        {parameters.length > 0 && (
          <div className="mt-3">
            <div className="sky-page-kicker mb-2">Input Snapshot</div>
            <div className="table-responsive sky-canonical-operations-table-frame">
              <table className="table table-sm align-middle sky-table sky-canonical-operations-table mb-0">
                <thead><tr><th>Parameter</th><th>Effective Value</th></tr></thead>
                <tbody>{parameters.map(([name, value]) => <tr key={name}><td className="sky-mono">{name}</td><td>{typeof value === 'object' ? <code>{JSON.stringify(value)}</code> : String(value)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-3">
            <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
              <div className="sky-page-kicker">Structured Test Result</div>
              <div className="d-flex flex-wrap gap-2">
                {testCases && <span className="sky-pill sky-pill-info">{testCases.total ?? 0} test case(s)</span>}
                {testCases && <span className="sky-pill sky-pill-success">{testCases.passed ?? 0} case(s) passed</span>}
                {testCases?.failed > 0 && <span className="sky-pill sky-pill-danger">{testCases.failed} case(s) failed</span>}
                {assertions && <span className="sky-pill sky-pill-info">{assertions.total ?? 0} assertion(s)</span>}
                {assertions?.failed > 0 && <span className="sky-pill sky-pill-danger">{assertions.failed} assertion(s) failed</span>}
              </div>
            </div>
            <div className="table-responsive sky-canonical-operations-table-frame">
              <table className="table table-sm align-middle sky-table sky-canonical-operations-table mb-0">
                <tbody>
                  <tr><th>Contract</th><td className="sky-mono">{result.contract || 'browser_test_summary.v1'}</td></tr>
                  <tr><th>Outcome</th><td><StatusPill status={result.status || status} /></td></tr>
                  <tr><th>Playwright exit code</th><td>{result.exitCode ?? '—'}</td></tr>
                  <tr><th>Timeout</th><td>{result.timedOut ? 'Yes' : 'No'}{result.timeoutMs ? ` · ${formatDuration(result.timeoutMs)}` : ''}</td></tr>
                  <tr><th>Artifacts</th><td>{run?.artifactCount ?? artifacts.length}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {failure && (
          <div className="mt-3">
            <div className="sky-page-kicker mb-2">Failure Evidence</div>
            <div className="row g-3">
              <div className="col-xl-6"><div className="sky-workflow-node-recovery-panel h-100">
                <div className="sky-detail-label">Error</div>
                <div className="sky-detail-value">{failure.message || 'Playwright Test failed.'}</div>
                {failure.title && <><div className="sky-detail-label mt-2">Test</div><div className="sky-detail-value">{failure.title}</div></>}
                {failure.location?.file && <><div className="sky-detail-label mt-2">Location</div><div className="sky-detail-value sky-mono">{failure.location.file}:{failure.location.line || '?'}</div></>}
              </div></div>
              {(failure.snippet || failure.stack) && <div className="col-xl-6"><div className="sky-workflow-node-recovery-panel h-100"><div className="sky-detail-label">Diagnostic</div><pre className="sky-code-block mb-0">{failure.snippet || failure.stack}</pre></div></div>}
            </div>
          </div>
        )}

        {artifacts.length > 0 && (
          <div className="mt-3">
            <div className="sky-page-kicker mb-2">Browser Evidence</div>
            {artifactError && <DismissibleAlert tone="danger">{artifactError}</DismissibleAlert>}
            <div className="table-responsive sky-canonical-operations-table-frame">
              <table className="table table-sm align-middle sky-table sky-canonical-operations-table mb-0">
                <thead><tr><th>Type</th><th>Artifact</th><th>Size</th><th className="text-end">Actions</th></tr></thead>
                <tbody>{artifacts.map((artifact) => <tr key={artifact.artifactId || artifact.relativePath}><td><span className="sky-pill sky-pill-info">{artifact.kind}</span></td><td><div className="fw-semibold">{artifact.name}</div><div className="small sky-muted sky-mono">{artifact.relativePath}</div></td><td>{formatArtifactSize(artifact.sizeBytes)}</td><td className="text-end">{artifact.url ? <button className="btn btn-sm sky-btn-ghost" disabled={Boolean(artifactBusyId)} onClick={() => openArtifact(artifact)} type="button">{artifactBusyId === artifact.artifactId ? 'Opening...' : artifactActionLabel(artifact)}</button> : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {linkedWorkflowIds.length > 0 && (
          <div className="mt-3">
            <div className="sky-page-kicker mb-2">Linked Executions</div>
            <div className="d-flex flex-wrap gap-2">{linkedWorkflowIds.map((runId) => <a className="btn btn-sm sky-btn-ghost" href={`/workflows/history?runId=${encodeURIComponent(runId)}`} key={runId}>Open Workflow Run · {runId.slice(0, 12)}</a>)}</div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function BrowserTestRun() {
  const navigate = useNavigate();
  const [catalogue, setCatalogue] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_RUN_FILTERS);
  const [selectedTestCode, setSelectedTestCode] = useState('');
  const [selectedTest, setSelectedTest] = useState(null);
  const [parameterValues, setParameterValues] = useState({});
  const [environmentCode, setEnvironmentCode] = useState('');
  const [executionMode, setExecutionMode] = useState('HEADLESS');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [run, setRun] = useState(null);
  const initializationRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function loadCatalogue() {
      setLoading(true);
      setError('');
      try {
        const result = await browserTestService.listTests({ limit: 100, offset: 0 });
        if (active) setCatalogue(result.items || []);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load Playwright Tests.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadCatalogue();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workflowId) return undefined;
    let active = true;
    let timer = null;

    async function refreshRun() {
      try {
        const result = await browserTestService.getRun(workflowId);
        if (!active) return;
        setRun(result.run || null);
        if (!TERMINAL_RUN_STATUSES.has(String(result.run?.status || '').toUpperCase())) {
          timer = window.setTimeout(refreshRun, 1000);
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to refresh Playwright Test run.');
      }
    }

    refreshRun();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [workflowId]);

  const categories = useMemo(
    () => Array.from(new Map(catalogue.map((test) => [test.category?.categoryCode, test.category])).values()).filter(Boolean),
    [catalogue],
  );
  const environments = useMemo(
    () => Array.from(new Set(catalogue.map((test) => test.defaultEnvironmentCode).filter(Boolean))).sort(),
    [catalogue],
  );
  const browsers = useMemo(
    () => Array.from(new Set(catalogue.map((test) => test.browserType).filter(Boolean))).sort(),
    [catalogue],
  );
  const filteredTests = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return catalogue.filter((test) => {
      if (filters.categoryCode && test.category?.categoryCode !== filters.categoryCode) return false;
      if (filters.environmentCode && test.defaultEnvironmentCode !== filters.environmentCode) return false;
      if (filters.browserType && test.browserType !== filters.browserType) return false;
      if (!q) return true;
      return [test.label, test.testCode, test.description, test.category?.label, test.scriptPath]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [catalogue, filters]);

  const table = useBrowserTable(filteredTests, {
    defaultSorts: [{ field: 'test', direction: 'asc' }],
    resetKey: JSON.stringify(filters),
    getSortValue: (test, field) => ({
      test: test.label,
      category: test.category?.label,
      browser: test.browserType,
      environment: test.defaultEnvironmentCode,
      risk: test.riskRank,
      parameters: test.parameterCount,
      status: test.enabled ? 'ACTIVE' : 'DISABLED',
    })[field],
  });

  async function initializeTest(test, { scroll = true } = {}) {
    if (!test || initializing || running) return;
    setInitializing(true);
    setError('');
    setNotice('');
    setWorkflowId('');
    setRun(null);
    try {
      const result = await browserTestService.getTest(test.testCode);
      const detail = result.test;
      setSelectedTestCode(detail.testCode);
      setSelectedTest(detail);
      setParameterValues(getInitialParameterValues(detail));
      setEnvironmentCode(detail.defaultEnvironmentCode || detail.environments?.[0]?.environmentCode || '');
      setExecutionMode('HEADLESS');
      setConfirmed(false);
      if (scroll) {
        window.requestAnimationFrame(() => initializationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    } catch (loadError) {
      setError(loadError.message || 'Failed to initialize Playwright Test.');
    } finally {
      setInitializing(false);
    }
  }

  const visibleTestKey = table.pageItems.map((test) => test.testCode).join('|');
  useEffect(() => {
    if (loading || initializing || running) return;
    if (table.pageItems.length === 0) {
      setSelectedTestCode('');
      setSelectedTest(null);
      return;
    }
    if (table.pageItems.some((test) => test.testCode === selectedTestCode)) return;
    initializeTest(table.pageItems[0], { scroll: false });
  }, [loading, visibleTestKey]);

  async function startTest(event) {
    event.preventDefault();
    if (!selectedTest || running) return;
    setRunning(true);
    setError('');
    setNotice('');
    setRun(null);
    try {
      const result = await browserTestService.runTest(selectedTest.testCode, {
        environmentCode,
        executionMode,
        parameters: cleanParameterValues(parameterValues),
        confirmed: selectedTest.requiresConfirmation ? confirmed : false,
      });
      const launchedWorkflowId = result.execution?.workflowId || '';
      setWorkflowId(launchedWorkflowId);
      browserTestService.setLastRunWorkflowId(launchedWorkflowId);
      setNotice(executionMode === 'INTERACTIVE'
        ? `${selectedTest.label} was accepted by Temporal and sent to the Host Agent for interactive Chromium.`
        : `${selectedTest.label} was accepted by Temporal and sent to the Browser Worker.`);
    } catch (runError) {
      setError(runError.message || 'Playwright Test failed to start.');
    } finally {
      setRunning(false);
    }
  }

  function clearFilters() {
    setFilters(DEFAULT_RUN_FILTERS);
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader
        kicker="PLAYWRIGHT TESTS · EXECUTION"
        subtitle="Launch registered Playwright tests headlessly through the Browser Worker or interactively through the host-native Host Agent."
        title="Run Tests"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {notice && <DismissibleAlert tone="success">{notice}</DismissibleAlert>}

      <Panel
        className="sky-table-card sky-table-browser-anchor"
        kicker="TEST BROWSER"
        subtitle="Filter the registered Playwright Test catalogue, then select a row to review its runtime parameters."
        title="Available Tests"
      >
        <div className="sky-card-body">
          <div className="sky-run-tools-filter-grid sky-browser-test-filter-grid mb-3">
            <div className="sky-run-tools-search-filter">
              <label className="form-label" htmlFor="browserTestSearch">Search</label>
              <input className="form-control sky-form-control" id="browserTestSearch" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Name, code, description, source path..." type="search" value={filters.q} />
            </div>
            <div>
              <label className="form-label" htmlFor="browserTestCategory">Category</label>
              <select className="form-select sky-form-control" id="browserTestCategory" onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))} value={filters.categoryCode}>
                <option value="">All categories</option>
                {categories.map((category) => <option key={category.categoryCode} value={category.categoryCode}>{category.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="browserTestEnvironment">Environment</label>
              <select className="form-select sky-form-control" id="browserTestEnvironment" onChange={(event) => setFilters((current) => ({ ...current, environmentCode: event.target.value }))} value={filters.environmentCode}>
                <option value="">All environments</option>
                {environments.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="browserTestBrowser">Browser</label>
              <select className="form-select sky-form-control" id="browserTestBrowser" onChange={(event) => setFilters((current) => ({ ...current, browserType: event.target.value }))} value={filters.browserType}>
                <option value="">All browsers</option>
                {browsers.map((browser) => <option key={browser} value={browser}>{browser.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="sky-run-tools-filter-actions">
              {table.sortingCustomized && <button className="btn btn-sm sky-btn-ghost" onClick={table.clearSorting} type="button">Clear sorting</button>}
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">Clear filters</button>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
            <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle">
              <thead>
                <tr>
                  <BrowserSortableHeader field="test" label="Test" table={table} />
                  <BrowserSortableHeader field="category" label="Category" table={table} />
                  <BrowserSortableHeader field="browser" label="Browser" table={table} />
                  <BrowserSortableHeader field="environment" label="Environment" table={table} />
                  <BrowserSortableHeader field="risk" label="Risk" table={table} />
                  <BrowserSortableHeader field="parameters" label="Parameters" table={table} />
                  <BrowserSortableHeader field="status" label="Status" table={table} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7}><div className="sky-empty-state">Loading Playwright Tests...</div></td></tr>
                ) : table.pageItems.length === 0 ? (
                  <tr><td colSpan={7}><div className="sky-empty-state">No Playwright Tests match the current filters.</div></td></tr>
                ) : table.pageItems.map((test) => (
                  <tr
                    aria-selected={selectedTestCode === test.testCode}
                    className={`sky-clickable-row ${selectedTestCode === test.testCode ? 'sky-selected-row' : ''}`}
                    key={test.testId}
                    onClick={() => initializeTest(test)}
                  >
                    <td><div className="fw-bold sky-detail-value">{test.label}</div><div className="small sky-muted sky-mono">{test.testCode}</div></td>
                    <td>{test.category?.label || '—'}</td>
                    <td className="text-uppercase">{test.browserType}</td>
                    <td>{test.defaultEnvironmentCode}</td>
                    <td><span className={`sky-pill ${riskToneClass(test.riskCode)}`}>{String(test.riskName || test.riskCode || 'LOW').toUpperCase()}</span></td>
                    <td>{test.parameterCount}</td>
                    <td><StatusPill status={test.enabled ? 'ACTIVE' : 'DISABLED'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BrowserTablePagination label="registered test(s)" loading={loading} table={table} />
        </div>
      </Panel>

      <div ref={initializationRef}>
        {selectedTest && (
          <Panel
            actions={<><span className="sky-pill sky-pill-info">{selectedTest.browserType?.toUpperCase()}</span><span className="sky-pill sky-pill-info">{selectedTest.defaultEnvironmentCode}</span></>}
            className="mt-3"
            kicker="TEST INITIALIZATION"
            subtitle={selectedTest.description || 'Review execution configuration and launch the selected Playwright Test.'}
            title={selectedTest.label}
          >
            <form className="sky-card-body" onSubmit={startTest}>
              <div className="row g-3 mb-3">
                <div className="col-12 col-lg-3"><label className="form-label" htmlFor="browserTestRunEnvironment">Environment</label><select className="form-select sky-form-control" disabled={running} id="browserTestRunEnvironment" onChange={(event) => { const next = event.target.value; setEnvironmentCode(next); if (next !== 'LOCAL' && executionMode === 'INTERACTIVE') setExecutionMode('HEADLESS'); }} value={environmentCode}>{(selectedTest.environments || []).map((environment) => <option key={environment.environmentCode} value={environment.environmentCode}>{environment.environmentName} ({environment.environmentCode})</option>)}</select></div>
                <div className="col-12 col-lg-3"><label className="form-label" htmlFor="browserTestExecutionMode">Execution mode</label><select className="form-select sky-form-control" disabled={running} id="browserTestExecutionMode" onChange={(event) => setExecutionMode(event.target.value)} value={executionMode}><option value="HEADLESS">Background (Headless)</option><option disabled={environmentCode !== 'LOCAL'} value="INTERACTIVE">Interactive (Headed · Host)</option></select><div className="form-text sky-muted">Interactive mode opens Chromium on this machine through the Host Agent.</div></div>
                <div className="col-12 col-lg-3"><label className="form-label">Timeout</label><div className="form-control sky-form-control sky-readonly-field">{selectedTest.timeoutSeconds} seconds</div></div>
                <div className="col-12 col-lg-3"><label className="form-label">Retries</label><div className="form-control sky-form-control sky-readonly-field">{selectedTest.retryCount}</div></div>
              </div>

              <BrowserRuntimeParameterFields disabled={running} onChange={(name, value) => setParameterValues((current) => ({ ...current, [name]: value }))} parameters={selectedTest.parameters || []} values={parameterValues} />

              {selectedTest.requiresConfirmation && (
                <div className="sky-confirm-panel mt-3"><div className="form-check"><input checked={confirmed} className="form-check-input" id="browserTestRunConfirm" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="browserTestRunConfirm">{selectedTest.confirmationText || 'I confirm this Playwright Test execution.'}</label></div></div>
              )}

              <div className="d-flex flex-wrap gap-2 mt-3">
                <button className="btn sky-btn-primary" disabled={running || (selectedTest.requiresConfirmation && !confirmed)} type="submit">{running ? 'Starting...' : 'Run Test'}</button>
                {workflowId && <button className="btn btn-sm sky-btn-ghost" onClick={() => navigate(`/browser-tests/operations?workflowId=${encodeURIComponent(workflowId)}`)} type="button">Open Test Operations</button>}
              </div>
            </form>
          </Panel>
        )}
      </div>

      <BrowserRunStatusPanel run={run} workflowId={workflowId} />
    </div>
  );
}

export function BrowserTestOperations() {
  const requestedWorkflowId = new URLSearchParams(window.location.search).get('workflowId') || browserTestService.getLastRunWorkflowId();
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_OPERATIONS_FILTERS);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(requestedWorkflowId || '');
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const detailRef = useRef(null);

  async function refreshRuns({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const result = await browserTestService.listRuns({ limit: 500, offset: 0, scanLimit: 500 });
      setItems(result.items || []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Playwright Test operations.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    refreshRuns();
    const timer = window.setInterval(() => refreshRuns({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const categories = useMemo(
    () => Array.from(new Map(items.map((item) => [item.categoryCode, item.categoryLabel])).entries()).filter(([code]) => code),
    [items],
  );
  const environments = useMemo(() => Array.from(new Set(items.map((item) => item.environmentCode).filter(Boolean))).sort(), [items]);
  const filteredItems = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((item) => {
      if (filters.categoryCode && item.categoryCode !== filters.categoryCode) return false;
      if (filters.environmentCode && item.environmentCode !== filters.environmentCode) return false;
      if (filters.status && String(item.status || '').toUpperCase() !== filters.status) return false;
      if (!q) return true;
      return [item.testLabel, item.testCode, item.workflowId, item.categoryLabel, item.environmentCode, item.status]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [items, filters]);

  const table = useBrowserTable(filteredItems, {
    defaultSorts: [{ field: 'started', direction: 'desc' }],
    resetKey: JSON.stringify(filters),
    getSortValue: (item, field) => ({
      test: item.testLabel,
      category: item.categoryLabel,
      status: item.status,
      started: item.startTime ? new Date(item.startTime) : null,
      duration: item.durationMs,
      environment: item.environmentCode,
      browser: item.browserType,
      evidence: item.artifactCount,
    })[field],
  });

  async function selectRun(item, { scroll = false } = {}) {
    if (!item?.workflowId) return;
    setSelectedWorkflowId(item.workflowId);
    setDetailLoading(true);
    setRun(null);
    setError('');
    try {
      const result = await browserTestService.getRun(item.workflowId);
      setRun(result.run || null);
      browserTestService.setLastRunWorkflowId(item.workflowId);
      const params = new URLSearchParams(window.location.search);
      params.set('workflowId', item.workflowId);
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      if (scroll) window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Playwright Test run.');
    } finally {
      setDetailLoading(false);
    }
  }

  const visibleRunKey = table.pageItems.map((item) => item.workflowId).join('|');
  useEffect(() => {
    if (loading || detailLoading) return;
    if (table.pageItems.length === 0) {
      setSelectedWorkflowId('');
      setRun(null);
      return;
    }
    const requested = requestedWorkflowId && table.pageItems.find((item) => item.workflowId === requestedWorkflowId);
    const selectedVisible = table.pageItems.find((item) => item.workflowId === selectedWorkflowId);
    const next = requested || selectedVisible || table.pageItems[0];
    if (!next || (next.workflowId === selectedWorkflowId && run)) return;
    selectRun(next, { scroll: false });
  }, [loading, visibleRunKey]);

  useEffect(() => {
    if (!selectedWorkflowId || !run || TERMINAL_RUN_STATUSES.has(String(run.status || '').toUpperCase())) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const result = await browserTestService.getRun(selectedWorkflowId);
        setRun(result.run || null);
      } catch (_error) {
        // The operations browser refresh will surface durable errors; keep live polling unobtrusive.
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [selectedWorkflowId, run]);

  function clearFilters() {
    setFilters(DEFAULT_OPERATIONS_FILTERS);
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader
        kicker="PLAYWRIGHT TESTS · OPERATIONS"
        subtitle="Browse durable Playwright Test executions recorded by SkyCommand and reconciled with Temporal."
        title="Test Operations"
      />
      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <Panel className="sky-table-card sky-table-browser-anchor" kicker="EXECUTION BROWSER" subtitle="Filter the durable Playwright Test execution ledger, then select a run for structured results and browser evidence." title="Playwright Test Operations">
        <div className="sky-card-body">
          <div className="sky-run-tools-filter-grid sky-browser-test-filter-grid mb-3">
            <div className="sky-run-tools-search-filter"><label className="form-label" htmlFor="browserTestOperationsSearch">Search</label><input className="form-control sky-form-control" id="browserTestOperationsSearch" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Test, workflow ID, category, status..." type="search" value={filters.q} /></div>
            <div><label className="form-label" htmlFor="browserTestOperationsCategory">Category</label><select className="form-select sky-form-control" id="browserTestOperationsCategory" onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))} value={filters.categoryCode}><option value="">All categories</option>{categories.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
            <div><label className="form-label" htmlFor="browserTestOperationsStatus">Status</label><select className="form-select sky-form-control" id="browserTestOperationsStatus" onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}><option value="">All statuses</option><option value="RUNNING">RUNNING</option><option value="PASSED">PASSED</option><option value="FAILED">FAILED</option><option value="CANCELED">CANCELED</option><option value="TERMINATED">TERMINATED</option><option value="TIMED_OUT">TIMED OUT</option></select></div>
            <div><label className="form-label" htmlFor="browserTestOperationsEnvironment">Environment</label><select className="form-select sky-form-control" id="browserTestOperationsEnvironment" onChange={(event) => setFilters((current) => ({ ...current, environmentCode: event.target.value }))} value={filters.environmentCode}><option value="">All environments</option>{environments.map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
            <div className="sky-run-tools-filter-actions">
              {table.sortingCustomized && <button className="btn btn-sm sky-btn-ghost" onClick={table.clearSorting} type="button">Clear sorting</button>}
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">Clear filters</button>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
            <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle">
              <thead><tr><BrowserSortableHeader field="test" label="Test" table={table} /><BrowserSortableHeader field="category" label="Category" table={table} /><BrowserSortableHeader field="status" label="Status" table={table} /><BrowserSortableHeader field="started" label="Started" table={table} /><BrowserSortableHeader field="duration" label="Duration" table={table} /><BrowserSortableHeader field="environment" label="Environment" table={table} /><BrowserSortableHeader field="browser" label="Browser" table={table} /><BrowserSortableHeader field="evidence" label="Evidence" table={table} /><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={9}><div className="sky-empty-state">Loading Playwright Test executions...</div></td></tr> : table.pageItems.length === 0 ? <tr><td colSpan={9}><div className="sky-empty-state">No Playwright Test executions match the current filters.</div></td></tr> : table.pageItems.map((item) => (
                  <tr className={`sky-clickable-row ${selectedWorkflowId === item.workflowId ? 'sky-selected-row' : ''}`} key={item.workflowId} onClick={() => selectRun(item)}>
                    <td><div className="fw-bold sky-detail-value">{item.testLabel}</div><div className="small sky-muted sky-mono">{item.testCode}</div></td>
                    <td>{item.categoryLabel || 'Uncategorized'}</td>
                    <td><StatusPill status={item.status} /></td>
                    <td>{formatDateTime(item.startTime)}</td>
                    <td>{formatDuration(item.durationMs)}</td>
                    <td>{item.environmentCode || '—'}</td>
                    <td className="text-uppercase">{item.browserType || 'chromium'}</td>
                    <td>{item.artifactCount || 0}</td>
                    <td className="text-end"><button className="btn btn-sm sky-btn-ghost" disabled={detailLoading} onClick={(event) => { event.stopPropagation(); selectRun(item, { scroll: true }); }} type="button">Run Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BrowserTablePagination label="test execution(s)" loading={loading} table={table} />
        </div>
      </Panel>

      <div ref={detailRef}>
        {selectedWorkflowId ? <BrowserRunStatusPanel run={run} workflowId={selectedWorkflowId} /> : <Panel className="mt-3" kicker="NO RUN SELECTED" subtitle="Select a Playwright Test execution from the browser above." title="Browser Test Run"><div className="sky-card-body small sky-muted">No Playwright Test execution is selected.</div></Panel>}
      </div>
    </div>
  );
}

function serializeOptions(options = []) {
  return (options || []).map((option) => `${option.label || option.value}=${option.value}`).join('\n');
}

function parseOptionText(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const splitAt = line.indexOf('=');
      const label = splitAt >= 0 ? line.slice(0, splitAt).trim() : line;
      const value = splitAt >= 0 ? line.slice(splitAt + 1).trim() : line;
      if (!label || !value) throw new Error(`Static option line ${index + 1} requires a label and value.`);
      return { label, value, displayOrder: index * 10 + 10, enabled: true };
    });
}

function createEmptyRegistryParameter(index, options = {}) {
  return {
    parameterName: '',
    label: '',
    type: options.parameterTypes?.[0]?.code || 'string',
    prompt: '',
    required: false,
    defaultValue: '',
    optionSourceCode: '',
    displayOrder: index * 10 + 10,
    enabled: true,
    optionText: '',
  };
}

function createEmptyRegistryForm(options = {}) {
  const defaultEnvironment = options.environments?.find((environment) => environment.environmentCode === 'LOCAL') || options.environments?.[0];
  return {
    testCode: '',
    categoryId: options.categories?.[0]?.categoryId || '',
    name: '',
    label: '',
    description: '',
    scriptRepoId: options.repositories?.find((repository) => repository.repoCode === 'SkyCommand')?.repoId || options.repositories?.[0]?.repoId || '',
    scriptPath: 'tests/browser/specs/',
    browserType: options.browserTypes?.[0] || 'chromium',
    defaultEnvironmentCode: defaultEnvironment?.environmentCode || 'LOCAL',
    environmentCodes: defaultEnvironment ? [defaultEnvironment.environmentCode] : [],
    timeoutSeconds: 60,
    retryCount: 0,
    grepPattern: '',
    permissionCode: 'BROWSER_TEST_RUN',
    riskCode: options.risks?.[0]?.riskCode || 'low',
    requiresConfirmation: false,
    confirmationText: '',
    displayOrder: 999,
    enabled: false,
    parameters: [],
  };
}

function populateRegistryForm(test, options = {}) {
  if (!test) return createEmptyRegistryForm(options);
  return {
    testCode: test.testCode || '',
    categoryId: test.category?.categoryId || '',
    name: test.name || '',
    label: test.label || '',
    description: test.description || '',
    scriptRepoId: test.scriptRepository?.repoId || '',
    scriptPath: test.scriptPath || '',
    browserType: test.browserType || 'chromium',
    defaultEnvironmentCode: test.defaultEnvironmentCode || 'LOCAL',
    environmentCodes: (test.environments || []).map((environment) => environment.environmentCode),
    timeoutSeconds: test.timeoutSeconds ?? 60,
    retryCount: test.retryCount ?? 0,
    grepPattern: test.grepPattern || '',
    permissionCode: test.permissionCode || 'BROWSER_TEST_RUN',
    riskCode: test.riskCode || 'low',
    requiresConfirmation: Boolean(test.requiresConfirmation),
    confirmationText: test.confirmationText || '',
    displayOrder: test.displayOrder ?? 999,
    enabled: Boolean(test.enabled),
    parameters: (test.parameters || []).map((parameter) => ({
      parameterName: parameter.parameterName || '',
      label: parameter.label || '',
      type: parameter.type || 'string',
      prompt: parameter.prompt || '',
      required: Boolean(parameter.required),
      defaultValue: parameter.defaultValue === null || parameter.defaultValue === undefined
        ? ''
        : parameter.type === 'json' && typeof parameter.defaultValue !== 'string'
          ? JSON.stringify(parameter.defaultValue, null, 2)
          : parameter.defaultValue,
      optionSourceCode: parameter.optionSourceCode || '',
      displayOrder: parameter.displayOrder ?? 999,
      enabled: parameter.enabled !== false,
      optionText: serializeOptions(parameter.options || []),
    })),
  };
}

function buildRegistryPayload(form) {
  const parameters = form.parameters.map((parameter) => ({
    parameterName: parameter.parameterName.trim(),
    label: parameter.label.trim() || parameter.parameterName.trim(),
    type: parameter.type,
    prompt: parameter.prompt.trim() || null,
    required: Boolean(parameter.required),
    defaultValue: parameter.defaultValue === '' ? null : parameter.defaultValue,
    optionSourceCode: parameter.optionSourceCode || null,
    displayOrder: Number(parameter.displayOrder),
    enabled: Boolean(parameter.enabled),
    options: parameter.optionSourceCode ? [] : parseOptionText(parameter.optionText),
  }));
  return {
    testCode: form.testCode.trim(),
    categoryId: form.categoryId,
    name: form.name.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    scriptRepoId: form.scriptRepoId,
    scriptPath: form.scriptPath.trim(),
    browserType: form.browserType,
    defaultEnvironmentCode: form.defaultEnvironmentCode,
    environmentCodes: form.environmentCodes,
    timeoutSeconds: Number(form.timeoutSeconds),
    retryCount: Number(form.retryCount),
    grepPattern: form.grepPattern.trim() || null,
    permissionCode: form.permissionCode || null,
    riskCode: form.riskCode,
    requiresConfirmation: Boolean(form.requiresConfirmation),
    confirmationText: form.requiresConfirmation ? form.confirmationText.trim() || null : null,
    displayOrder: Number(form.displayOrder),
    enabled: Boolean(form.enabled),
    parameters,
  };
}

function BrowserTestRegistryForm({ canEditCode = true, form, onChange, options, saving = false, submitLabel = 'Save Browser Test', onSubmit }) {
  function update(field, value) {
    onChange((current) => ({ ...current, [field]: value }));
  }

  function updateParameter(index, field, value) {
    onChange((current) => ({
      ...current,
      parameters: current.parameters.map((parameter, parameterIndex) => parameterIndex === index ? { ...parameter, [field]: value } : parameter),
    }));
  }

  function toggleEnvironment(code) {
    onChange((current) => {
      const currentCodes = new Set(current.environmentCodes || []);
      if (currentCodes.has(code)) currentCodes.delete(code); else currentCodes.add(code);
      currentCodes.add(current.defaultEnvironmentCode);
      return { ...current, environmentCodes: [...currentCodes] };
    });
  }

  function setDefaultEnvironment(code) {
    onChange((current) => ({
      ...current,
      defaultEnvironmentCode: code,
      environmentCodes: [...new Set([...(current.environmentCodes || []), code])],
    }));
  }

  return (
    <form className="sky-card-body" onSubmit={onSubmit}>
      <div className="row g-3">
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryCode">Test code *</label><input className="form-control sky-form-control sky-mono" disabled={!canEditCode} id="browserRegistryCode" onChange={(event) => update('testCode', event.target.value)} required value={form.testCode} /></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryName">Name *</label><input className="form-control sky-form-control" id="browserRegistryName" onChange={(event) => update('name', event.target.value)} required value={form.name} /></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryLabel">Display label *</label><input className="form-control sky-form-control" id="browserRegistryLabel" onChange={(event) => update('label', event.target.value)} required value={form.label} /></div>
        <div className="col-12"><label className="form-label" htmlFor="browserRegistryDescription">Description</label><textarea className="form-control sky-form-control" id="browserRegistryDescription" onChange={(event) => update('description', event.target.value)} rows={2} value={form.description} /></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryCategory">Category *</label><select className="form-select sky-form-control" id="browserRegistryCategory" onChange={(event) => update('categoryId', event.target.value)} required value={form.categoryId}>{(options.categories || []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.label}</option>)}</select></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryRepository">Script repository *</label><select className="form-select sky-form-control" id="browserRegistryRepository" onChange={(event) => update('scriptRepoId', event.target.value)} required value={form.scriptRepoId}>{(options.repositories || []).filter((repository) => repository.active !== false && repository.repoCode === 'SkyCommand').map((repository) => <option key={repository.repoId} value={repository.repoId}>{repository.repoName} ({repository.repoCode})</option>)}</select></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryBrowser">Browser *</label><select className="form-select sky-form-control" id="browserRegistryBrowser" onChange={(event) => update('browserType', event.target.value)} value={form.browserType}>{(options.browserTypes || ['chromium']).map((browser) => <option key={browser} value={browser}>{browser}</option>)}</select></div>
        <div className="col-12"><label className="form-label" htmlFor="browserRegistryScriptPath">Repository-relative spec path *</label><input className="form-control sky-form-control sky-mono" id="browserRegistryScriptPath" onChange={(event) => update('scriptPath', event.target.value)} required value={form.scriptPath} /><div className="form-text sky-muted">Playwright source remains in Git and must live beneath tests/browser/specs/.</div></div>
        <div className="col-12 col-md-4 col-xl-2"><label className="form-label" htmlFor="browserRegistryTimeout">Timeout (sec)</label><input className="form-control sky-form-control" id="browserRegistryTimeout" min="1" max="3600" onChange={(event) => update('timeoutSeconds', event.target.value)} type="number" value={form.timeoutSeconds} /></div>
        <div className="col-12 col-md-4 col-xl-2"><label className="form-label" htmlFor="browserRegistryRetries">Retries</label><input className="form-control sky-form-control" id="browserRegistryRetries" min="0" max="3" onChange={(event) => update('retryCount', event.target.value)} type="number" value={form.retryCount} /></div>
        <div className="col-12 col-md-4 col-xl-2"><label className="form-label" htmlFor="browserRegistryOrder">Display order</label><input className="form-control sky-form-control" id="browserRegistryOrder" min="0" onChange={(event) => update('displayOrder', event.target.value)} type="number" value={form.displayOrder} /></div>
        <div className="col-12 col-xl-3"><label className="form-label" htmlFor="browserRegistryRisk">Risk</label><select className="form-select sky-form-control" id="browserRegistryRisk" onChange={(event) => update('riskCode', event.target.value)} value={form.riskCode}>{(options.risks || []).filter((risk) => risk.active !== false).map((risk) => <option key={risk.riskCode} value={risk.riskCode}>{risk.riskName}</option>)}</select></div>
        <div className="col-12 col-xl-3"><label className="form-label" htmlFor="browserRegistryPermission">Execution permission</label><select className="form-select sky-form-control" id="browserRegistryPermission" onChange={(event) => update('permissionCode', event.target.value)} value={form.permissionCode}><option value="">BROWSER_TEST_RUN only</option>{(options.permissions || []).map((permission) => <option key={permission.permissionCode} value={permission.permissionCode}>{permission.permissionCode}</option>)}</select></div>
        <div className="col-12 col-lg-6"><label className="form-label" htmlFor="browserRegistryGrep">Playwright grep / tag</label><input className="form-control sky-form-control sky-mono" id="browserRegistryGrep" onChange={(event) => update('grepPattern', event.target.value)} placeholder="@smoke" value={form.grepPattern} /></div>
        <div className="col-12 col-lg-6"><label className="form-label" htmlFor="browserRegistryDefaultEnvironment">Default environment</label><select className="form-select sky-form-control" id="browserRegistryDefaultEnvironment" onChange={(event) => setDefaultEnvironment(event.target.value)} value={form.defaultEnvironmentCode}>{(options.environments || []).filter((environment) => environment.enabled !== false).map((environment) => <option key={environment.environmentCode} value={environment.environmentCode}>{environment.environmentName} ({environment.environmentCode})</option>)}</select></div>
      </div>

      <div className="mt-3">
        <div className="form-label">Allowed environments</div>
        <div className="d-flex flex-wrap gap-3">
          {(options.environments || []).filter((environment) => environment.enabled !== false).map((environment) => (
            <div className="form-check" key={environment.environmentCode}>
              <input checked={(form.environmentCodes || []).includes(environment.environmentCode)} className="form-check-input" disabled={environment.environmentCode === form.defaultEnvironmentCode} id={`browser-env-${environment.environmentCode}`} onChange={() => toggleEnvironment(environment.environmentCode)} type="checkbox" />
              <label className="form-check-label" htmlFor={`browser-env-${environment.environmentCode}`}>{environment.environmentName}</label>
            </div>
          ))}
        </div>
      </div>

      <div className="d-flex flex-wrap gap-4 mt-3">
        <div className="form-check form-switch"><input checked={form.requiresConfirmation} className="form-check-input" id="browserRegistryConfirmation" onChange={(event) => update('requiresConfirmation', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="browserRegistryConfirmation">Confirmation required</label></div>
        <div className="form-check form-switch"><input checked={form.enabled} className="form-check-input" id="browserRegistryEnabled" onChange={(event) => update('enabled', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="browserRegistryEnabled">Enabled</label></div>
      </div>
      {form.requiresConfirmation && <div className="mt-3"><label className="form-label" htmlFor="browserRegistryConfirmationText">Confirmation text *</label><input className="form-control sky-form-control" id="browserRegistryConfirmationText" onChange={(event) => update('confirmationText', event.target.value)} required value={form.confirmationText} /></div>}

      <div className="d-flex justify-content-between align-items-center gap-2 mt-4 mb-2">
        <div><div className="sky-page-kicker">RUNTIME PARAMETERS</div><div className="small sky-muted">Parameterized values are validated by the registry before Temporal execution.</div></div>
        <button className="btn btn-sm sky-btn-primary" onClick={() => onChange((current) => ({ ...current, parameters: [...current.parameters, createEmptyRegistryParameter(current.parameters.length, options)] }))} type="button">Add parameter</button>
      </div>

      {(form.parameters || []).length === 0 ? <div className="small sky-muted">No Playwright Test parameters configured.</div> : (
        <div className="d-grid gap-3">
          {form.parameters.map((parameter, index) => (
            <section className="sky-tool-parameter-editor" key={`${parameter.parameterName || 'new'}-${index}`}>
              <div className="d-flex justify-content-between align-items-center gap-2 mb-3"><strong>Parameter {index + 1}</strong><button className="btn btn-sm sky-btn-danger" onClick={() => onChange((current) => ({ ...current, parameters: current.parameters.filter((_, parameterIndex) => parameterIndex !== index) }))} type="button">Remove</button></div>
              <div className="row g-3">
                <div className="col-12 col-lg-3"><label className="form-label">Name *</label><input className="form-control sky-form-control sky-mono" onChange={(event) => updateParameter(index, 'parameterName', event.target.value)} required value={parameter.parameterName} /></div>
                <div className="col-12 col-lg-3"><label className="form-label">Label *</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'label', event.target.value)} required value={parameter.label} /></div>
                <div className="col-12 col-lg-3"><label className="form-label">Type</label><select className="form-select sky-form-control" onChange={(event) => updateParameter(index, 'type', event.target.value)} value={parameter.type}>{(options.parameterTypes || []).filter((type) => type.active !== false).map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select></div>
                <div className="col-12 col-lg-3"><label className="form-label">Display order</label><input className="form-control sky-form-control" min="0" onChange={(event) => updateParameter(index, 'displayOrder', event.target.value)} type="number" value={parameter.displayOrder} /></div>
                <div className="col-12 col-lg-6"><label className="form-label">Prompt / help text</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'prompt', event.target.value)} value={parameter.prompt} /></div>
                <div className="col-12 col-lg-6"><label className="form-label">Default value</label>{parameter.type === 'json' ? <textarea className="form-control sky-form-control sky-mono" onChange={(event) => updateParameter(index, 'defaultValue', event.target.value)} rows={3} value={parameter.defaultValue} /> : <input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'defaultValue', event.target.value)} value={parameter.defaultValue} />}</div>
                <div className="col-12 col-lg-4"><label className="form-label">Dynamic option source</label><select className="form-select sky-form-control" onChange={(event) => updateParameter(index, 'optionSourceCode', event.target.value)} value={parameter.optionSourceCode}><option value="">None</option>{(options.optionSources || []).filter((source) => source.active !== false).map((source) => <option key={source.code} value={source.code}>{source.name}</option>)}</select></div>
                <div className="col-12 col-lg-8"><label className="form-label">Static choices (one Label=Value per line)</label><textarea className="form-control sky-form-control sky-mono" disabled={Boolean(parameter.optionSourceCode)} onChange={(event) => updateParameter(index, 'optionText', event.target.value)} rows={3} value={parameter.optionText} /></div>
              </div>
              <div className="d-flex flex-wrap gap-4 mt-3"><div className="form-check form-switch"><input checked={parameter.required} className="form-check-input" id={`browser-param-required-${index}`} onChange={(event) => updateParameter(index, 'required', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor={`browser-param-required-${index}`}>Required</label></div><div className="form-check form-switch"><input checked={parameter.enabled} className="form-check-input" id={`browser-param-enabled-${index}`} onChange={(event) => updateParameter(index, 'enabled', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor={`browser-param-enabled-${index}`}>Enabled</label></div></div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-4"><button className="btn sky-btn-primary" disabled={saving} type="submit">{saving ? 'Saving...' : submitLabel}</button></div>
    </form>
  );
}

export function BrowserTestManage() {
  const [options, setOptions] = useState(null);
  const [tests, setTests] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_MANAGE_FILTERS);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editorRef = useRef(null);

  async function refreshList() {
    const result = await browserTestService.listAdminTests({ limit: 100, offset: 0 });
    setTests(result.items || []);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [optionsResult, testsResult] = await Promise.all([
          browserTestService.getAdminOptions(),
          browserTestService.listAdminTests({ limit: 100, offset: 0 }),
        ]);
        if (!active) return;
        setOptions(optionsResult.options || {});
        setTests(testsResult.items || []);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load Playwright Test administration.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const filteredTests = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return tests.filter((test) => {
      if (filters.categoryCode && test.category?.categoryCode !== filters.categoryCode) return false;
      if (filters.riskCode && test.riskCode !== filters.riskCode) return false;
      if (filters.enabled !== '' && String(Boolean(test.enabled)) !== filters.enabled) return false;
      if (!q) return true;
      return [test.label, test.testCode, test.description, test.scriptPath, test.scriptRepository?.repoName]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [tests, filters]);

  const table = useBrowserTable(filteredTests, {
    defaultSorts: [{ field: 'test', direction: 'asc' }],
    resetKey: JSON.stringify(filters),
    getSortValue: (test, field) => ({
      test: test.label,
      category: test.category?.label,
      source: test.scriptRepository?.repoName,
      environment: test.defaultEnvironmentCode,
      risk: test.riskRank,
      parameters: test.parameterCount,
      status: test.enabled ? 'ACTIVE' : 'DISABLED',
    })[field],
  });

  async function selectTest(test, { scroll = true } = {}) {
    if (!test || detailLoading) return;
    setSelectedTestId(test.testId);
    setDetailLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await browserTestService.getAdminTest(test.testId);
      setForm(populateRegistryForm(result.test, options || {}));
      if (scroll) window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Playwright Test configuration.');
    } finally {
      setDetailLoading(false);
    }
  }

  const visibleTestKey = table.pageItems.map((test) => test.testId).join('|');
  useEffect(() => {
    if (loading || !options || detailLoading) return;
    if (table.pageItems.length === 0) {
      setSelectedTestId('');
      setForm(null);
      return;
    }
    if (table.pageItems.some((test) => test.testId === selectedTestId) && form) return;
    selectTest(table.pageItems[0], { scroll: false });
  }, [loading, options, visibleTestKey]);

  async function saveTest(event) {
    event.preventDefault();
    if (!selectedTestId || !form) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = buildRegistryPayload(form);
      const { environmentCodes, parameters, testCode, ...definition } = payload;
      await browserTestService.updateAdminTest(selectedTestId, definition);
      await browserTestService.replaceAdminTestParameters(selectedTestId, parameters);
      await browserTestService.replaceAdminTestEnvironments(selectedTestId, environmentCodes);
      const detail = await browserTestService.getAdminTest(selectedTestId);
      setForm(populateRegistryForm(detail.test, options || {}));
      await refreshList();
      setNotice(`${detail.test.label} configuration saved.`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save Playwright Test configuration.');
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setFilters(DEFAULT_MANAGE_FILTERS);
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader kicker="PLAYWRIGHT TESTS · ADMINISTRATION" subtitle="Review and maintain registered source-controlled Playwright tests." title="Manage Tests" />
      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {notice && <DismissibleAlert tone="success">{notice}</DismissibleAlert>}

      <Panel className="sky-table-card sky-table-browser-anchor" kicker="TEST REGISTRY" subtitle="Filter the Playwright Test registry, then select a row to edit its metadata, environments, permissions, and runtime parameters." title="Registered Tests">
        <div className="sky-card-body">
          <div className="sky-run-tools-filter-grid sky-browser-test-filter-grid mb-3">
            <div className="sky-run-tools-search-filter"><label className="form-label" htmlFor="manageBrowserTestSearch">Search</label><input className="form-control sky-form-control" id="manageBrowserTestSearch" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Name, code, repository, source path..." type="search" value={filters.q} /></div>
            <div><label className="form-label" htmlFor="manageBrowserTestCategory">Category</label><select className="form-select sky-form-control" id="manageBrowserTestCategory" onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))} value={filters.categoryCode}><option value="">All categories</option>{(options?.categories || []).map((category) => <option key={category.categoryId} value={category.categoryCode}>{category.label}</option>)}</select></div>
            <div><label className="form-label" htmlFor="manageBrowserTestRisk">Risk</label><select className="form-select sky-form-control" id="manageBrowserTestRisk" onChange={(event) => setFilters((current) => ({ ...current, riskCode: event.target.value }))} value={filters.riskCode}><option value="">All risks</option>{(options?.risks || []).filter((risk) => risk.active !== false).map((risk) => <option key={risk.riskCode} value={risk.riskCode}>{risk.riskName}</option>)}</select></div>
            <div><label className="form-label" htmlFor="manageBrowserTestStatus">Status</label><select className="form-select sky-form-control" id="manageBrowserTestStatus" onChange={(event) => setFilters((current) => ({ ...current, enabled: event.target.value }))} value={filters.enabled}><option value="">All statuses</option><option value="true">Active</option><option value="false">Disabled</option></select></div>
            <div className="sky-run-tools-filter-actions">
              {table.sortingCustomized && <button className="btn btn-sm sky-btn-ghost" onClick={table.clearSorting} type="button">Clear sorting</button>}
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">Clear filters</button>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
            <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle">
              <thead><tr><BrowserSortableHeader field="test" label="Test" table={table} /><BrowserSortableHeader field="category" label="Category" table={table} /><BrowserSortableHeader field="source" label="Source" table={table} /><BrowserSortableHeader field="environment" label="Environment" table={table} /><BrowserSortableHeader field="risk" label="Risk" table={table} /><BrowserSortableHeader field="parameters" label="Parameters" table={table} /><BrowserSortableHeader field="status" label="Status" table={table} /></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={7}><div className="sky-empty-state">Loading registered tests...</div></td></tr> : table.pageItems.length === 0 ? <tr><td colSpan={7}><div className="sky-empty-state">No registered tests match the current filters.</div></td></tr> : table.pageItems.map((test) => (
                  <tr className={`sky-clickable-row ${selectedTestId === test.testId ? 'sky-selected-row' : ''}`} key={test.testId} onClick={() => selectTest(test)}>
                    <td><div className="fw-bold sky-detail-value">{test.label}</div><div className="small sky-muted sky-mono">{test.testCode}</div></td>
                    <td>{test.category?.label}</td>
                    <td><div>{test.scriptRepository?.repoName}</div><div className="small sky-muted sky-mono">{test.scriptPath}</div></td>
                    <td>{test.defaultEnvironmentCode}</td>
                    <td><span className={`sky-pill ${riskToneClass(test.riskCode)}`}>{String(test.riskName || test.riskCode).toUpperCase()}</span></td>
                    <td>{test.parameterCount}</td>
                    <td><StatusPill status={test.enabled ? 'ACTIVE' : 'DISABLED'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BrowserTablePagination label="registered test(s)" loading={loading} table={table} />
        </div>
      </Panel>

      <div ref={editorRef}>
        {form && options && (
          <Panel actions={<StatusPill status={form.enabled ? 'ACTIVE' : 'DISABLED'} />} className="mt-3" kicker="TEST CONFIGURATION" subtitle="Test code is immutable here to protect registered references. Source remains version-controlled in Git." title={form.label || form.testCode}>
            <BrowserTestRegistryForm canEditCode={false} form={form} onChange={setForm} onSubmit={saveTest} options={options} saving={saving} submitLabel="Save configuration" />
          </Panel>
        )}
      </div>
    </div>
  );
}

export function BrowserTestAdd() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const result = await browserTestService.getAdminOptions();
        if (!active) return;
        const loadedOptions = result.options || {};
        setOptions(loadedOptions);
        setForm(createEmptyRegistryForm(loadedOptions));
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load Playwright Test registration options.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  async function createTest(event) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const payload = buildRegistryPayload(form);
      const result = await browserTestService.createAdminTest(payload);
      navigate('/browser-tests/manage', { replace: true, state: { createdTestId: result.test?.testId } });
    } catch (createError) {
      setError(createError.message || 'Failed to register Playwright Test.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader kicker="PLAYWRIGHT TESTS · REGISTRATION" subtitle="Register a source-controlled Playwright spec with SkyCommand execution metadata, permissions, environments, and parameters." title="Add Test" />
      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {loading && <Panel kicker="LOADING" title="Playwright Test Registration"><div className="sky-card-body sky-muted">Loading registry options...</div></Panel>}
      {form && options && <Panel kicker="NEW PLAYWRIGHT TEST" subtitle="The Playwright source file must already exist in the selected repository." title="Test Registration"><BrowserTestRegistryForm form={form} onChange={setForm} onSubmit={createTest} options={options} saving={saving} submitLabel="Register Playwright Test" /></Panel>}
    </div>
  );
}

export default BrowserTestRun;
