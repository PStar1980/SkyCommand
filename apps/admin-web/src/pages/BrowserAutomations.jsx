import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import browserAutomationService from '../services/browserAutomationService.js';

const TERMINAL_RUN_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const DEFAULT_RUN_FILTERS = { q: '', categoryCode: '', environmentCode: '', sideEffectLevel: '' };
const DEFAULT_OPERATIONS_FILTERS = { q: '', categoryCode: '', environmentCode: '', status: '', executionMode: '' };
const DEFAULT_MANAGE_FILTERS = { q: '', categoryCode: '', sideEffectLevel: '', enabled: '' };

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
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

function formatArtifactSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function sideEffectPill(level) {
  const normalized = String(level || 'READ_ONLY').toUpperCase();
  const className = normalized === 'HIGH_IMPACT'
    ? 'sky-pill-danger'
    : normalized === 'MUTATING'
      ? 'sky-pill-warning'
      : 'sky-pill-info';
  return <span className={`sky-pill ${className}`}>{normalized.replaceAll('_', ' ')}</span>;
}

function riskToneClass(riskCode) {
  const normalized = String(riskCode || '').toLowerCase();
  if (normalized === 'high') return 'sky-pill-danger';
  if (normalized === 'medium') return 'sky-pill-warning';
  return 'sky-pill-success';
}

function statusPill(enabled) {
  return <StatusPill status={enabled ? 'ACTIVE' : 'DISABLED'} />;
}

function getAvailablePageSizes(total) {
  const recordCount = Math.max(0, Number(total) || 0);
  return PAGE_SIZE_OPTIONS.filter((size) => size === 10 || (size === 25 && recordCount >= 11) || (size === 50 && recordCount >= 26));
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null || left === '') return 1;
  if (right === undefined || right === null || right === '') return -1;
  if (left instanceof Date || right instanceof Date) return new Date(left).getTime() - new Date(right).getTime();
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && String(left).trim() !== '' && String(right).trim() !== '') {
    return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function useAutomationTable(items, { defaultSorts, getSortValue, resetKey }) {
  const [sorts, setSorts] = useState(defaultSorts);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => setPage(1), [resetKey]);

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((left, right) => {
      for (const sort of sorts) {
        const comparison = compareValues(getSortValue(left, sort.field), getSortValue(right, sort.field));
        if (comparison !== 0) return sort.direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
    return copy;
  }, [items, sorts, getSortValue]);

  const total = sortedItems.length;
  const availablePageSizes = getAvailablePageSizes(total);
  const normalizedPageSize = availablePageSizes.includes(pageSize) ? pageSize : availablePageSizes.at(-1) || 10;
  const pageCount = Math.max(1, Math.ceil(total / normalizedPageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageItems = sortedItems.slice((safePage - 1) * normalizedPageSize, safePage * normalizedPageSize);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * normalizedPageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(total, safePage * normalizedPageSize);
  const sortingCustomized = JSON.stringify(sorts) !== JSON.stringify(defaultSorts);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
    if (pageSize !== normalizedPageSize) setPageSize(normalizedPageSize);
  }, [page, pageSize, safePage, normalizedPageSize]);

  function updateSorting(field, event) {
    const multi = Boolean(event?.shiftKey);
    setSorts((current) => {
      const index = current.findIndex((sort) => sort.field === field);
      const active = index >= 0 ? current[index] : null;
      if (!multi) {
        if (!active || current.length !== 1) return [{ field, direction: 'asc' }];
        if (active.direction === 'asc') return [{ field, direction: 'desc' }];
        return defaultSorts;
      }
      const next = [...current];
      if (!active) next.push({ field, direction: 'asc' });
      else if (active.direction === 'asc') next[index] = { field, direction: 'desc' };
      else next.splice(index, 1);
      return next.length ? next : defaultSorts;
    });
  }

  return {
    availablePageSizes,
    changePageSize: (value) => { setPageSize(Number(value)); setPage(1); },
    clearSorting: () => setSorts(defaultSorts),
    page: safePage,
    pageCount,
    pageItems,
    pageSize: normalizedPageSize,
    rangeStart,
    rangeEnd,
    setPage: (value) => setPage(Math.min(Math.max(1, Number(value) || 1), pageCount)),
    sortingCustomized,
    sorts,
    total,
    updateSorting,
  };
}

function SortableHeader({ field, label, table }) {
  const activeIndex = table.sorts.findIndex((sort) => sort.field === field);
  const active = activeIndex >= 0 ? table.sorts[activeIndex] : null;
  return (
    <th>
      <button className={`sky-table-sort-button ${active ? 'is-active' : ''}`} onClick={(event) => table.updateSorting(field, event)} title="Click to sort · Shift+click to add sort" type="button">
        <span>{label}</span>
        <span aria-hidden="true" className="sky-table-sort-indicator">{active ? (active.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
        {active && <span aria-hidden="true" className="sky-table-sort-priority">{activeIndex + 1}</span>}
      </button>
    </th>
  );
}

function TablePagination({ label, loading = false, table }) {
  return (
    <div className="sky-pagination-row sky-canonical-operations-pagination-row">
      <div className="small sky-muted sky-canonical-operations-pagination-summary">Showing {table.rangeStart}–{table.rangeEnd} of {table.total} {label}</div>
      <div className="sky-pagination-controls sky-canonical-operations-pagination-controls">
        <button className="btn btn-sm sky-pagination-nav-button" disabled={table.page <= 1 || loading} onClick={() => table.setPage(1)} type="button">«</button>
        <button className="btn btn-sm sky-pagination-nav-button" disabled={table.page <= 1 || loading} onClick={() => table.setPage(table.page - 1)} type="button">‹</button>
        <label className="sky-pagination-select-label">Page</label>
        <select className="form-select form-select-sm sky-form-control sky-pagination-select" disabled={loading} onChange={(event) => table.setPage(event.target.value)} value={table.page}>
          {Array.from({ length: table.pageCount }, (_, index) => index + 1).map((page) => <option key={page} value={page}>{page}</option>)}
        </select>
        <span className="small sky-muted">of {table.pageCount}</span>
        <button className="btn btn-sm sky-pagination-nav-button" disabled={table.page >= table.pageCount || loading} onClick={() => table.setPage(table.page + 1)} type="button">›</button>
        <button className="btn btn-sm sky-pagination-nav-button" disabled={table.page >= table.pageCount || loading} onClick={() => table.setPage(table.pageCount)} type="button">»</button>
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

function getInitialParameterValues(automation) {
  return (automation?.parameters || []).reduce((values, parameter) => {
    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) values[parameter.parameterName] = parameter.defaultValue;
    else if (parameter.type === 'boolean') values[parameter.parameterName] = false;
    else values[parameter.parameterName] = '';
    return values;
  }, {});
}

function cleanParameterValues(values = {}) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value !== undefined && value !== null));
}

function RuntimeParameterFields({ disabled = false, parameters = [], values = {}, onChange }) {
  if (!parameters.length) return <div className="small sky-muted">This automation has no runtime parameters.</div>;
  return (
    <div className="row g-3">
      {parameters.map((parameter) => {
        const id = `browserAutomationParameter-${parameter.parameterName}`;
        const value = values[parameter.parameterName] ?? '';
        const common = { disabled, id, required: parameter.required };
        let control;
        if (parameter.type === 'boolean') {
          control = <div className="form-check form-switch mt-2"><input checked={Boolean(value)} className="form-check-input" disabled={disabled} id={id} onChange={(event) => onChange(parameter.parameterName, event.target.checked)} type="checkbox" /></div>;
        } else if (parameter.type === 'select' || parameter.type === 'repo') {
          control = <select className="form-select sky-form-control" {...common} onChange={(event) => onChange(parameter.parameterName, event.target.value)} value={value}><option value="">Select...</option>{(parameter.options || []).filter((option) => option.enabled !== false).map((option) => <option key={`${parameter.parameterName}-${option.value}`} value={option.value}>{option.label}</option>)}</select>;
        } else if (parameter.type === 'json') {
          control = <textarea className="form-control sky-form-control sky-mono" {...common} onChange={(event) => onChange(parameter.parameterName, event.target.value)} rows={4} value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)} />;
        } else {
          control = <input className="form-control sky-form-control" {...common} onChange={(event) => onChange(parameter.parameterName, event.target.value)} type={parameter.type === 'number' ? 'number' : parameter.type === 'date' ? 'date' : 'text'} value={value} />;
        }
        return <div className="col-12 col-lg-6" key={parameter.parameterName}><label className="form-label" htmlFor={id}>{parameter.label}{parameter.required ? ' *' : ''}</label>{control}{parameter.prompt && <div className="form-text sky-muted">{parameter.prompt}</div>}</div>;
      })}
    </div>
  );
}

async function openBlob(blobResponse, artifact, download = false) {
  const blob = blobResponse instanceof Blob ? blobResponse : blobResponse?.blob || blobResponse;
  if (!(blob instanceof Blob)) throw new Error('Artifact response is not a file.');
  const objectUrl = URL.createObjectURL(blob);
  if (download) {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = artifact.name || 'artifact';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    return;
  }
  window.open(objectUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

function AutomationRunPanel({ run, workflowId }) {
  const [artifactError, setArtifactError] = useState('');
  if (!workflowId) return null;
  if (!run) return <Panel className="mt-3" kicker="LIVE EXECUTION" subtitle="Temporal-backed Playwright Automation execution state." title="Automation Run"><div className="sky-card-body sky-muted">Loading execution detail...</div></Panel>;

  async function openArtifact(artifact) {
    setArtifactError('');
    try {
      const response = await browserAutomationService.getArtifact(run.workflowId, artifact.artifactId);
      await openBlob(response, artifact, String(artifact.kind).toUpperCase() !== 'SCREENSHOT');
    } catch (error) {
      setArtifactError(error.message || 'Playwright Automation artifact is unavailable.');
    }
  }

  const businessResult = run.result?.result;
  const services = Array.isArray(businessResult?.services) ? businessResult.services : null;
  return (
    <Panel actions={<><StatusPill status={run.status} /><span className="sky-pill sky-pill-info">Temporal {run.temporalStatus}</span></>} className="mt-3" kicker="EXECUTION DETAIL" subtitle="Durable Playwright Automation result, input snapshot, safety context, source lineage, and artifacts." title={run.automationLabel || run.automationCode || 'Automation Run'}>
      <div className="sky-card-body">
        <div className="table-responsive mb-3"><table className="table table-sm sky-table sky-detail-table align-middle mb-0"><tbody>
          <tr><th>Automation</th><td>{run.automationLabel}<div className="small sky-muted sky-mono">{run.automationCode}</div></td></tr>
          <tr><th>Workflow ID</th><td className="sky-mono">{run.workflowId}</td></tr>
          <tr><th>Run ID</th><td className="sky-mono">{run.runId || '—'}</td></tr>
          <tr><th>Automation status</th><td><StatusPill status={run.status} /></td></tr>
          <tr><th>Temporal status</th><td><StatusPill status={run.temporalStatus} /></td></tr>
          <tr><th>Environment / Browser</th><td>{run.environmentCode || '—'} · {String(run.browserType || '').toUpperCase()}</td></tr>
          <tr><th>Execution mode</th><td>{String(run.executionMode || 'HEADLESS').toUpperCase() === 'INTERACTIVE' ? 'Interactive · Host Agent' : 'Headless · Browser Worker'}</td></tr>
          <tr><th>Side effects</th><td>{sideEffectPill(run.sideEffectLevel)}</td></tr>
          <tr><th>Idempotency</th><td>{String(run.idempotencyMode || '—').replaceAll('_', ' ')}</td></tr>
          <tr><th>Risk</th><td><span className={`sky-pill ${riskToneClass(run.riskCode)}`}>{String(run.riskCode || 'LOW').toUpperCase()}</span></td></tr>
          <tr><th>Triggered by</th><td>{run.initiatedBy || '—'} · {run.triggerSource || 'MANUAL'}</td></tr>
          <tr><th>Started</th><td>{formatDateTime(run.startTime)}</td></tr>
          <tr><th>Completed</th><td>{formatDateTime(run.closeTime)}</td></tr>
          <tr><th>Duration</th><td>{formatDuration(run.durationMs)}</td></tr>
          <tr><th>Source revision</th><td>{run.sourceRepositoryCode || '—'} · <span className="sky-mono">{run.sourceCommit || 'SHA unavailable'}</span></td></tr>
        </tbody></table></div>

        <div className="sky-page-kicker mb-2">Input snapshot</div>
        <div className="table-responsive mb-3"><table className="table table-sm sky-table sky-detail-table align-middle mb-0"><thead><tr><th>PARAMETER</th><th>EFFECTIVE VALUE</th></tr></thead><tbody>{Object.entries(run.parameters || {}).length ? Object.entries(run.parameters || {}).map(([key, value]) => <tr key={key}><td className="sky-mono">{key}</td><td>{typeof value === 'object' ? <pre className="sky-code-block mb-0">{JSON.stringify(value, null, 2)}</pre> : String(value)}</td></tr>) : <tr><td colSpan={2} className="sky-muted">No runtime parameters.</td></tr>}</tbody></table></div>

        {run.result && <>
          <div className="sky-page-kicker mb-2">Structured automation result</div>
          <div className="table-responsive mb-3"><table className="table table-sm sky-table sky-detail-table align-middle mb-0"><tbody>
            <tr><th>Contract</th><td className="sky-mono">{run.result.contract || '—'}</td></tr>
            <tr><th>Outcome</th><td><StatusPill status={run.result.status || run.status} /></td></tr>
            <tr><th>Automation duration</th><td>{formatDuration(run.result.durationMs)}</td></tr>
            <tr><th>Artifacts</th><td>{run.artifactCount || 0}</td></tr>
          </tbody></table></div>
        </>}

        {services && <>
          <div className="sky-page-kicker mb-2">Automation output</div>
          <div className="table-responsive mb-3"><table className="table table-sm sky-table sky-detail-table align-middle mb-0"><thead><tr><th>SERVICE</th><th>STATUS</th><th>DETAIL</th></tr></thead><tbody>{services.map((service, index) => <tr key={`${service.label}-${index}`}><td>{service.label || '—'}</td><td><StatusPill status={service.value || 'UNKNOWN'} /></td><td>{service.detail || '—'}</td></tr>)}</tbody></table></div>
        </>}

        {run.failure && <div className="sky-failure-panel mb-3"><div className="sky-page-kicker mb-2">Failure evidence</div><div className="mb-2">{run.failure.message || 'Playwright Automation failed.'}</div>{run.failure.stack && <pre className="sky-code-block mb-0">{run.failure.stack}</pre>}</div>}

        <div className="sky-page-kicker mb-2">Automation artifacts</div>
        {artifactError && <DismissibleAlert tone="danger" onDismiss={() => setArtifactError('')}>{artifactError}</DismissibleAlert>}
        <div className="table-responsive"><table className="table table-sm sky-table sky-detail-table align-middle mb-0"><thead><tr><th>TYPE</th><th>ARTIFACT</th><th>SIZE</th><th>ACTIONS</th></tr></thead><tbody>{(run.artifacts || []).length ? run.artifacts.map((artifact) => <tr key={artifact.artifactId}><td><span className="sky-pill sky-pill-info">{artifact.kind}</span></td><td><div>{artifact.name}</div><div className="small sky-muted sky-mono">{artifact.relativePath}</div></td><td>{formatArtifactSize(artifact.sizeBytes)}</td><td><button className="btn btn-sm sky-btn-primary" onClick={() => openArtifact(artifact)} type="button">{String(artifact.kind).toUpperCase() === 'SCREENSHOT' ? 'Open Screenshot' : 'Download Artifact'}</button></td></tr>) : <tr><td colSpan={4} className="sky-muted">No artifacts recorded for this execution.</td></tr>}</tbody></table></div>
      </div>
    </Panel>
  );
}

export function BrowserAutomationRun() {
  const navigate = useNavigate();
  const [catalogue, setCatalogue] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_RUN_FILTERS);
  const [selectedCode, setSelectedCode] = useState('');
  const [selected, setSelected] = useState(null);
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
    browserAutomationService.listAutomations({ limit: 100, offset: 0 }).then((result) => {
      if (active) setCatalogue(result.items || []);
    }).catch((loadError) => active && setError(loadError.message || 'Failed to load Playwright Automations.')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workflowId) return undefined;
    let active = true;
    let timer;
    async function refresh() {
      try {
        const result = await browserAutomationService.getRun(workflowId);
        if (!active) return;
        setRun(result.run || null);
        if (!TERMINAL_RUN_STATUSES.has(String(result.run?.status || '').toUpperCase())) timer = window.setTimeout(refresh, 1000);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to refresh Playwright Automation run.');
      }
    }
    refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [workflowId]);

  const categories = useMemo(() => Array.from(new Map(catalogue.map((item) => [item.category?.categoryCode, item.category])).values()).filter(Boolean), [catalogue]);
  const environments = useMemo(() => Array.from(new Set(catalogue.map((item) => item.defaultEnvironmentCode).filter(Boolean))).sort(), [catalogue]);
  const sideEffects = useMemo(() => Array.from(new Set(catalogue.map((item) => item.sideEffectLevel).filter(Boolean))).sort(), [catalogue]);
  const filteredItems = useMemo(() => {
    const q = normalizeText(filters.q);
    return catalogue.filter((item) => {
      if (filters.categoryCode && item.category?.categoryCode !== filters.categoryCode) return false;
      if (filters.environmentCode && item.defaultEnvironmentCode !== filters.environmentCode) return false;
      if (filters.sideEffectLevel && item.sideEffectLevel !== filters.sideEffectLevel) return false;
      if (!q) return true;
      return [item.label, item.automationCode, item.description, item.scriptPath, item.outputType].some((value) => normalizeText(value).includes(q));
    });
  }, [catalogue, filters]);

  const table = useAutomationTable(filteredItems, {
    defaultSorts: [{ field: 'automation', direction: 'asc' }],
    resetKey: JSON.stringify(filters),
    getSortValue: (item, field) => ({
      automation: item.label,
      category: item.category?.label,
      environment: item.defaultEnvironmentCode,
      sideEffects: item.sideEffectLevel,
      risk: item.riskRank,
      retries: item.retryCount,
      parameters: item.parameterCount,
    })[field],
  });

  async function initialize(item, { scroll = true } = {}) {
    if (!item || initializing || running) return;
    setInitializing(true); setError(''); setNotice(''); setWorkflowId(''); setRun(null);
    try {
      const result = await browserAutomationService.getAutomation(item.automationCode);
      const detail = result.automation;
      setSelectedCode(detail.automationCode);
      setSelected(detail);
      setParameterValues(getInitialParameterValues(detail));
      setEnvironmentCode(detail.defaultEnvironmentCode || detail.environments?.[0]?.environmentCode || '');
      setExecutionMode('HEADLESS');
      setConfirmed(false);
      if (scroll) window.requestAnimationFrame(() => initializationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (loadError) {
      setError(loadError.message || 'Failed to initialize Playwright Automation.');
    } finally { setInitializing(false); }
  }

  const visibleKey = table.pageItems.map((item) => item.automationCode).join('|');
  useEffect(() => {
    if (loading || initializing || running) return;
    if (!table.pageItems.length) { setSelectedCode(''); setSelected(null); return; }
    if (table.pageItems.some((item) => item.automationCode === selectedCode)) return;
    initialize(table.pageItems[0], { scroll: false });
  }, [loading, visibleKey]);

  async function startAutomation(event) {
    event.preventDefault();
    if (!selected || running) return;
    setRunning(true); setError(''); setNotice(''); setRun(null);
    try {
      const result = await browserAutomationService.runAutomation(selected.automationCode, {
        environmentCode,
        executionMode,
        parameters: cleanParameterValues(parameterValues),
        confirmed: selected.requiresConfirmation ? confirmed : false,
      });
      const launchedWorkflowId = result.execution?.workflowId || '';
      setWorkflowId(launchedWorkflowId);
      browserAutomationService.setLastRunWorkflowId(launchedWorkflowId);
      setNotice(executionMode === 'INTERACTIVE'
        ? `${selected.label} was accepted by Temporal and sent to the Host Agent for interactive Chromium.`
        : `${selected.label} was accepted by Temporal and sent to the Browser Worker.`);
    } catch (runError) {
      setError(runError.message || 'Playwright Automation failed to start.');
    } finally { setRunning(false); }
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader kicker="PLAYWRIGHT AUTOMATION · EXECUTION" subtitle="Launch registered operational browser tasks through the dedicated Browser Worker or interactively through the host-native Host Agent." title="Run Automations" />
      {error && <DismissibleAlert tone="danger" onDismiss={() => setError('')}>{error}</DismissibleAlert>}
      {notice && <DismissibleAlert tone="success" onDismiss={() => setNotice('')}>{notice}</DismissibleAlert>}

      <Panel className="sky-table-card sky-table-browser-anchor" kicker="AUTOMATION BROWSER" subtitle="Filter the registered Playwright Automation catalogue, then select a row to review its runtime and safety configuration." title="Available Automations">
        <div className="sky-card-body">
          <div className="sky-run-tools-filter-grid sky-browser-test-filter-grid mb-3">
            <div className="sky-run-tools-search-filter"><label className="form-label" htmlFor="browserAutomationRunSearch">Search</label><input className="form-control sky-form-control" id="browserAutomationRunSearch" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Name, code, description, source path..." type="search" value={filters.q} /></div>
            <div><label className="form-label" htmlFor="browserAutomationRunCategory">Category</label><select className="form-select sky-form-control" id="browserAutomationRunCategory" onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))} value={filters.categoryCode}><option value="">All categories</option>{categories.map((category) => <option key={category.categoryCode} value={category.categoryCode}>{category.label}</option>)}</select></div>
            <div><label className="form-label" htmlFor="browserAutomationRunEnvironment">Environment</label><select className="form-select sky-form-control" id="browserAutomationRunEnvironment" onChange={(event) => setFilters((current) => ({ ...current, environmentCode: event.target.value }))} value={filters.environmentCode}><option value="">All environments</option>{environments.map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
            <div><label className="form-label" htmlFor="browserAutomationRunSideEffects">Side effects</label><select className="form-select sky-form-control" id="browserAutomationRunSideEffects" onChange={(event) => setFilters((current) => ({ ...current, sideEffectLevel: event.target.value }))} value={filters.sideEffectLevel}><option value="">All levels</option>{sideEffects.map((level) => <option key={level} value={level}>{level.replaceAll('_', ' ')}</option>)}</select></div>
            <div className="sky-run-tools-filter-actions">{table.sortingCustomized && <button className="btn btn-sm sky-btn-ghost" onClick={table.clearSorting} type="button">Clear sorting</button>}<button className="btn btn-sm sky-btn-ghost" onClick={() => setFilters(DEFAULT_RUN_FILTERS)} type="button">Clear filters</button></div>
          </div>
          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame"><table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle"><thead><tr><SortableHeader field="automation" label="Automation" table={table} /><SortableHeader field="category" label="Category" table={table} /><SortableHeader field="environment" label="Environment" table={table} /><SortableHeader field="sideEffects" label="Side Effects" table={table} /><SortableHeader field="risk" label="Risk" table={table} /><SortableHeader field="retries" label="Retries" table={table} /><SortableHeader field="parameters" label="Parameters" table={table} /></tr></thead><tbody>{loading ? <tr><td colSpan={7}><div className="sky-empty-state">Loading Playwright Automations...</div></td></tr> : table.pageItems.length === 0 ? <tr><td colSpan={7}><div className="sky-empty-state">No Playwright Automations match the current filters.</div></td></tr> : table.pageItems.map((item) => <tr aria-selected={selectedCode === item.automationCode} className={`sky-clickable-row ${selectedCode === item.automationCode ? 'sky-selected-row' : ''}`} key={item.automationId} onClick={() => initialize(item)}><td><div className="fw-bold sky-detail-value">{item.label}</div><div className="small sky-muted sky-mono">{item.automationCode}</div></td><td>{item.category?.label || '—'}</td><td>{item.defaultEnvironmentCode}</td><td>{sideEffectPill(item.sideEffectLevel)}</td><td><span className={`sky-pill ${riskToneClass(item.riskCode)}`}>{String(item.riskName || item.riskCode).toUpperCase()}</span></td><td>{item.retryCount}</td><td>{item.parameterCount}</td></tr>)}</tbody></table></div>
          <TablePagination label="registered automation(s)" loading={loading} table={table} />
        </div>
      </Panel>

      <div ref={initializationRef}>{selected && <Panel actions={<>{sideEffectPill(selected.sideEffectLevel)}<span className={`sky-pill ${riskToneClass(selected.riskCode)}`}>{String(selected.riskName || selected.riskCode).toUpperCase()}</span></>} className="mt-3" kicker="AUTOMATION INITIALIZATION" subtitle={selected.description || 'Review execution configuration and run the selected Playwright Automation.'} title={selected.label}>
        <form className="sky-card-body" onSubmit={startAutomation}>
          <div className="row g-3 mb-3">
            <div className="col-12 col-lg-3"><label className="form-label" htmlFor="automationEnvironment">Environment</label><select className="form-select sky-form-control" disabled={running} id="automationEnvironment" onChange={(event) => { const next = event.target.value; setEnvironmentCode(next); if (next !== 'LOCAL' && executionMode === 'INTERACTIVE') setExecutionMode('HEADLESS'); }} value={environmentCode}>{(selected.environments || []).map((environment) => <option key={environment.environmentCode} value={environment.environmentCode}>{environment.environmentName} ({environment.environmentCode})</option>)}</select></div>
            <div className="col-12 col-lg-3"><label className="form-label" htmlFor="automationExecutionMode">Execution mode</label><select className="form-select sky-form-control" disabled={running} id="automationExecutionMode" onChange={(event) => setExecutionMode(event.target.value)} value={executionMode}><option value="HEADLESS">Background (Headless)</option><option disabled={environmentCode !== 'LOCAL'} value="INTERACTIVE">Interactive (Headed · Host)</option></select><div className="form-text sky-muted">Interactive mode opens Chromium on this machine through the Host Agent.</div></div>
            <div className="col-6 col-lg-2"><label className="form-label">Timeout</label><div className="form-control sky-form-control sky-readonly-field">{selected.timeoutSeconds} sec</div></div>
            <div className="col-6 col-lg-2"><label className="form-label">Retries</label><div className="form-control sky-form-control sky-readonly-field">{selected.retryCount}</div></div>
            <div className="col-6 col-lg-2"><label className="form-label">Max concurrency</label><div className="form-control sky-form-control sky-readonly-field">{selected.maxConcurrency}</div></div>
          </div>
          <div className="row g-3 mb-3"><div className="col-12 col-lg-4"><label className="form-label">Side effects</label><div>{sideEffectPill(selected.sideEffectLevel)}</div></div><div className="col-12 col-lg-4"><label className="form-label">Idempotency</label><div className="form-control sky-form-control sky-readonly-field">{String(selected.idempotencyMode).replaceAll('_', ' ')}</div></div><div className="col-12 col-lg-4"><label className="form-label">Output contract</label><div className="form-control sky-form-control sky-readonly-field sky-mono">{selected.outputType}</div></div></div>
          <RuntimeParameterFields disabled={running} onChange={(name, value) => setParameterValues((current) => ({ ...current, [name]: value }))} parameters={selected.parameters || []} values={parameterValues} />
          {selected.requiresConfirmation && <div className="sky-confirm-panel mt-3"><div className="form-check"><input checked={confirmed} className="form-check-input" id="automationConfirm" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="automationConfirm">{selected.confirmationText || 'I confirm this Playwright Automation execution.'}</label></div></div>}
          <div className="d-flex flex-wrap gap-2 mt-3"><button className="btn sky-btn-primary" disabled={running || (selected.requiresConfirmation && !confirmed)} type="submit">{running ? 'Starting...' : 'Run Automation'}</button>{workflowId && <button className="btn btn-sm sky-btn-ghost" onClick={() => navigate(`/browser-automations/operations?workflowId=${encodeURIComponent(workflowId)}`)} type="button">Open Automation Operations</button>}</div>
        </form>
      </Panel>}</div>
      <AutomationRunPanel run={run} workflowId={workflowId} />
    </div>
  );
}

export function BrowserAutomationOperations() {
  const requestedWorkflowId = new URLSearchParams(window.location.search).get('workflowId') || browserAutomationService.getLastRunWorkflowId();
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_OPERATIONS_FILTERS);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(requestedWorkflowId || '');
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const detailRef = useRef(null);

  async function refreshList() {
    setLoading(true);
    try {
      const result = await browserAutomationService.listRuns({ limit: 100, offset: 0 });
      setItems(result.items || []);
    } catch (loadError) { setError(loadError.message || 'Failed to load Playwright Automation executions.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { refreshList(); const timer = window.setInterval(refreshList, 15000); return () => window.clearInterval(timer); }, []);

  const categories = useMemo(() => Array.from(new Map(items.map((item) => [item.categoryCode, item.categoryLabel])).entries()).filter(([code]) => code), [items]);
  const environments = useMemo(() => Array.from(new Set(items.map((item) => item.environmentCode).filter(Boolean))).sort(), [items]);
  const filteredItems = useMemo(() => {
    const q = normalizeText(filters.q);
    return items.filter((item) => {
      if (filters.categoryCode && item.categoryCode !== filters.categoryCode) return false;
      if (filters.environmentCode && item.environmentCode !== filters.environmentCode) return false;
      if (filters.status && String(item.status).toUpperCase() !== filters.status) return false;
      if (filters.executionMode && String(item.executionMode).toUpperCase() !== filters.executionMode) return false;
      if (!q) return true;
      return [item.automationLabel, item.automationCode, item.workflowId, item.categoryLabel, item.status, item.executionMode, item.sideEffectLevel].some((value) => normalizeText(value).includes(q));
    });
  }, [items, filters]);

  const table = useAutomationTable(filteredItems, {
    defaultSorts: [{ field: 'started', direction: 'desc' }],
    resetKey: JSON.stringify(filters),
    getSortValue: (item, field) => ({ automation: item.automationLabel, category: item.categoryLabel, status: item.status, started: item.startTime ? new Date(item.startTime) : null, duration: item.durationMs, environment: item.environmentCode, browser: item.browserType, mode: item.executionMode, sideEffects: item.sideEffectLevel, artifacts: item.artifactCount })[field],
  });

  async function selectRun(item, { scroll = false } = {}) {
    if (!item?.workflowId) return;
    setSelectedWorkflowId(item.workflowId); setDetailLoading(true); setRun(null); setError('');
    try {
      const result = await browserAutomationService.getRun(item.workflowId);
      setRun(result.run || null);
      browserAutomationService.setLastRunWorkflowId(item.workflowId);
      const params = new URLSearchParams(window.location.search); params.set('workflowId', item.workflowId); window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      if (scroll) window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (loadError) { setError(loadError.message || 'Failed to load Playwright Automation run.'); }
    finally { setDetailLoading(false); }
  }

  const visibleKey = table.pageItems.map((item) => item.workflowId).join('|');
  useEffect(() => {
    if (loading || detailLoading) return;
    if (!table.pageItems.length) { setSelectedWorkflowId(''); setRun(null); return; }
    const requested = requestedWorkflowId && table.pageItems.find((item) => item.workflowId === requestedWorkflowId);
    const selectedVisible = table.pageItems.find((item) => item.workflowId === selectedWorkflowId);
    const next = requested || selectedVisible || table.pageItems[0];
    if (!next || (next.workflowId === selectedWorkflowId && run)) return;
    selectRun(next, { scroll: false });
  }, [loading, visibleKey]);

  useEffect(() => {
    if (!selectedWorkflowId || !run || TERMINAL_RUN_STATUSES.has(String(run.status || '').toUpperCase())) return undefined;
    const timer = window.setTimeout(async () => { try { const result = await browserAutomationService.getRun(selectedWorkflowId); setRun(result.run || null); } catch (_error) {} }, 1000);
    return () => window.clearTimeout(timer);
  }, [selectedWorkflowId, run]);

  return (
    <div className="container-fluid px-0">
      <PageHeader kicker="PLAYWRIGHT AUTOMATION · OPERATIONS" subtitle="Browse durable operational browser executions recorded by SkyCommand and reconciled with Temporal." title="Automation Operations" />
      {error && <DismissibleAlert tone="danger" onDismiss={() => setError('')}>{error}</DismissibleAlert>}
      <Panel className="sky-table-card sky-table-browser-anchor" kicker="EXECUTION BROWSER" subtitle="Filter the Playwright Automation execution ledger, then select a run for structured results and artifacts." title="Playwright Automation Operations">
        <div className="sky-card-body">
          <div className="sky-run-tools-filter-grid sky-browser-test-filter-grid mb-3">
            <div className="sky-run-tools-search-filter"><label className="form-label" htmlFor="automationOperationsSearch">Search</label><input className="form-control sky-form-control" id="automationOperationsSearch" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Automation, workflow ID, category, status..." type="search" value={filters.q} /></div>
            <div><label className="form-label">Category</label><select className="form-select sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))} value={filters.categoryCode}><option value="">All categories</option>{categories.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
            <div><label className="form-label">Status</label><select className="form-select sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}><option value="">All statuses</option><option>RUNNING</option><option>SUCCESS</option><option>FAILED</option><option>CANCELED</option><option>TERMINATED</option><option>TIMED_OUT</option></select></div>
            <div><label className="form-label">Environment</label><select className="form-select sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, environmentCode: event.target.value }))} value={filters.environmentCode}><option value="">All environments</option>{environments.map((code) => <option key={code}>{code}</option>)}</select></div>
            <div><label className="form-label">Execution mode</label><select className="form-select sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, executionMode: event.target.value }))} value={filters.executionMode}><option value="">All modes</option><option value="HEADLESS">HEADLESS</option><option value="INTERACTIVE">INTERACTIVE</option></select></div>
            <div className="sky-run-tools-filter-actions">{table.sortingCustomized && <button className="btn btn-sm sky-btn-ghost" onClick={table.clearSorting} type="button">Clear sorting</button>}<button className="btn btn-sm sky-btn-ghost" onClick={() => setFilters(DEFAULT_OPERATIONS_FILTERS)} type="button">Clear filters</button></div>
          </div>
          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame"><table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle"><thead><tr><SortableHeader field="automation" label="Automation" table={table} /><SortableHeader field="category" label="Category" table={table} /><SortableHeader field="status" label="Status" table={table} /><SortableHeader field="started" label="Started" table={table} /><SortableHeader field="duration" label="Duration" table={table} /><SortableHeader field="environment" label="Environment" table={table} /><SortableHeader field="browser" label="Browser" table={table} /><SortableHeader field="mode" label="Execution Mode" table={table} /><SortableHeader field="sideEffects" label="Side Effects" table={table} /><SortableHeader field="artifacts" label="Artifacts" table={table} /></tr></thead><tbody>{loading ? <tr><td colSpan={10}><div className="sky-empty-state">Loading Playwright Automation executions...</div></td></tr> : table.pageItems.length === 0 ? <tr><td colSpan={10}><div className="sky-empty-state">No Playwright Automation executions match the current filters.</div></td></tr> : table.pageItems.map((item) => <tr className={`sky-clickable-row ${selectedWorkflowId === item.workflowId ? 'sky-selected-row' : ''}`} key={item.workflowId} onClick={() => selectRun(item)}><td><div className="fw-bold sky-detail-value">{item.automationLabel}</div><div className="small sky-muted sky-mono">{item.automationCode}</div></td><td>{item.categoryLabel}</td><td><StatusPill status={item.status} /></td><td>{formatDateTime(item.startTime)}</td><td>{formatDuration(item.durationMs)}</td><td>{item.environmentCode}</td><td>{String(item.browserType).toUpperCase()}</td><td><span className="sky-pill sky-pill-info">{String(item.executionMode || 'HEADLESS').toUpperCase()}</span></td><td>{sideEffectPill(item.sideEffectLevel)}</td><td>{item.artifactCount || 0}</td></tr>)}</tbody></table></div>
          <TablePagination label="automation execution(s)" loading={loading} table={table} />
        </div>
      </Panel>
      <div ref={detailRef}>{selectedWorkflowId ? <AutomationRunPanel run={run} workflowId={selectedWorkflowId} /> : <Panel className="mt-3" kicker="NO RUN SELECTED" subtitle="Select a Playwright Automation execution above." title="Automation Run"><div className="sky-card-body sky-muted">No execution is selected.</div></Panel>}</div>
    </div>
  );
}

function serializeOptions(options = []) { return (options || []).map((option) => `${option.label || option.value}=${option.value}`).join('\n'); }
function parseOptionText(text = '') { return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => { const splitAt = line.indexOf('='); const label = splitAt >= 0 ? line.slice(0, splitAt).trim() : line; const value = splitAt >= 0 ? line.slice(splitAt + 1).trim() : line; if (!label || !value) throw new Error(`Static option line ${index + 1} requires a label and value.`); return { label, value, displayOrder: index * 10 + 10, enabled: true }; }); }
function emptyParameter(index, options = {}) { return { parameterName: '', label: '', type: options.parameterTypes?.[0]?.code || 'string', prompt: '', required: false, defaultValue: '', optionSourceCode: '', displayOrder: index * 10 + 10, enabled: true, optionText: '' }; }

function emptyForm(options = {}) {
  const defaultEnvironment = options.environments?.find((environment) => environment.environmentCode === 'LOCAL') || options.environments?.[0];
  return {
    automationCode: '', categoryId: options.categories?.[0]?.categoryId || '', name: '', label: '', description: '',
    scriptRepoId: options.repositories?.find((repository) => repository.repoCode === 'SkyCommand')?.repoId || options.repositories?.[0]?.repoId || '',
    scriptPath: 'browser-automation/scripts/', browserType: options.browserTypes?.[0] || 'chromium',
    defaultEnvironmentCode: defaultEnvironment?.environmentCode || 'LOCAL', environmentCodes: defaultEnvironment ? [defaultEnvironment.environmentCode] : [],
    timeoutSeconds: 120, retryCount: 0, maxConcurrency: 1, permissionCode: 'BROWSER_AUTOMATION_RUN', riskCode: options.risks?.[0]?.riskCode || 'low',
    requiresConfirmation: false, confirmationText: '', sideEffectLevel: 'READ_ONLY', idempotencyMode: 'READ_ONLY',
    outputType: options.defaultOutputContract?.outputType || 'browser_automation_summary.v1',
    outputSchemaPath: options.defaultOutputContract?.outputSchemaPath || 'packages/browser/contracts/browser_automation_summary.v1.schema.json',
    displayOrder: 999, enabled: false, parameters: [],
  };
}

function formFromAutomation(automation, options = {}) {
  if (!automation) return emptyForm(options);
  return {
    automationCode: automation.automationCode || '', categoryId: automation.category?.categoryId || '', name: automation.name || '', label: automation.label || '', description: automation.description || '',
    scriptRepoId: automation.scriptRepository?.repoId || '', scriptPath: automation.scriptPath || '', browserType: automation.browserType || 'chromium',
    defaultEnvironmentCode: automation.defaultEnvironmentCode || 'LOCAL', environmentCodes: (automation.environments || []).map((environment) => environment.environmentCode),
    timeoutSeconds: automation.timeoutSeconds ?? 120, retryCount: automation.retryCount ?? 0, maxConcurrency: automation.maxConcurrency ?? 1,
    permissionCode: automation.permissionCode || 'BROWSER_AUTOMATION_RUN', riskCode: automation.riskCode || 'low', requiresConfirmation: Boolean(automation.requiresConfirmation), confirmationText: automation.confirmationText || '',
    sideEffectLevel: automation.sideEffectLevel || 'READ_ONLY', idempotencyMode: automation.idempotencyMode || 'READ_ONLY', outputType: automation.outputType || 'browser_automation_summary.v1', outputSchemaPath: automation.outputSchemaPath || '',
    displayOrder: automation.displayOrder ?? 999, enabled: Boolean(automation.enabled),
    parameters: (automation.parameters || []).map((parameter) => ({ parameterName: parameter.parameterName || '', label: parameter.label || '', type: parameter.type || 'string', prompt: parameter.prompt || '', required: Boolean(parameter.required), defaultValue: parameter.defaultValue === null || parameter.defaultValue === undefined ? '' : parameter.type === 'json' && typeof parameter.defaultValue !== 'string' ? JSON.stringify(parameter.defaultValue, null, 2) : parameter.defaultValue, optionSourceCode: parameter.optionSourceCode || '', displayOrder: parameter.displayOrder ?? 999, enabled: parameter.enabled !== false, optionText: serializeOptions(parameter.options || []) })),
  };
}

function buildPayload(form) {
  return {
    automationCode: form.automationCode.trim(), categoryId: form.categoryId, name: form.name.trim(), label: form.label.trim(), description: form.description.trim() || null,
    scriptRepoId: form.scriptRepoId, scriptPath: form.scriptPath.trim(), browserType: form.browserType, defaultEnvironmentCode: form.defaultEnvironmentCode,
    environmentCodes: form.environmentCodes, timeoutSeconds: Number(form.timeoutSeconds), retryCount: Number(form.retryCount), maxConcurrency: Number(form.maxConcurrency),
    permissionCode: form.permissionCode || null, riskCode: form.riskCode, requiresConfirmation: Boolean(form.requiresConfirmation), confirmationText: form.requiresConfirmation ? form.confirmationText.trim() || null : null,
    sideEffectLevel: form.sideEffectLevel, idempotencyMode: form.idempotencyMode, outputType: form.outputType.trim(), outputSchemaPath: form.outputSchemaPath.trim(),
    displayOrder: Number(form.displayOrder), enabled: Boolean(form.enabled),
    parameters: form.parameters.map((parameter) => ({ parameterName: parameter.parameterName.trim(), label: parameter.label.trim() || parameter.parameterName.trim(), type: parameter.type, prompt: parameter.prompt.trim() || null, required: Boolean(parameter.required), defaultValue: parameter.defaultValue === '' ? null : parameter.defaultValue, optionSourceCode: parameter.optionSourceCode || null, displayOrder: Number(parameter.displayOrder), enabled: Boolean(parameter.enabled), options: parameter.optionSourceCode ? [] : parseOptionText(parameter.optionText) })),
  };
}

function AutomationRegistryForm({ canEditCode = true, form, onChange, options, saving = false, onSubmit, submitLabel }) {
  const update = (field, value) => onChange((current) => ({ ...current, [field]: value }));
  const updateParameter = (index, field, value) => onChange((current) => ({ ...current, parameters: current.parameters.map((parameter, i) => i === index ? { ...parameter, [field]: value } : parameter) }));
  const toggleEnvironment = (code) => onChange((current) => { const next = new Set(current.environmentCodes || []); if (next.has(code)) next.delete(code); else next.add(code); next.add(current.defaultEnvironmentCode); return { ...current, environmentCodes: [...next] }; });
  const setDefaultEnvironment = (code) => onChange((current) => ({ ...current, defaultEnvironmentCode: code, environmentCodes: [...new Set([...(current.environmentCodes || []), code])] }));
  const setSideEffects = (level) => onChange((current) => ({ ...current, sideEffectLevel: level, idempotencyMode: level === 'READ_ONLY' ? 'READ_ONLY' : current.idempotencyMode === 'READ_ONLY' ? 'IDEMPOTENT' : current.idempotencyMode, requiresConfirmation: level === 'HIGH_IMPACT' ? true : current.requiresConfirmation }));

  return <form className="sky-card-body" onSubmit={onSubmit}>
    <div className="row g-3">
      <div className="col-12 col-lg-4"><label className="form-label">Automation code *</label><input className="form-control sky-form-control sky-mono" disabled={!canEditCode} onChange={(event) => update('automationCode', event.target.value)} required value={form.automationCode} /></div>
      <div className="col-12 col-lg-4"><label className="form-label">Name *</label><input className="form-control sky-form-control" onChange={(event) => update('name', event.target.value)} required value={form.name} /></div>
      <div className="col-12 col-lg-4"><label className="form-label">Display label *</label><input className="form-control sky-form-control" onChange={(event) => update('label', event.target.value)} required value={form.label} /></div>
      <div className="col-12"><label className="form-label">Description</label><textarea className="form-control sky-form-control" onChange={(event) => update('description', event.target.value)} rows={2} value={form.description} /></div>
      <div className="col-12 col-lg-4"><label className="form-label">Category *</label><select className="form-select sky-form-control" onChange={(event) => update('categoryId', event.target.value)} required value={form.categoryId}>{(options.categories || []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.label}</option>)}</select></div>
      <div className="col-12 col-lg-4"><label className="form-label">Script repository *</label><select className="form-select sky-form-control" onChange={(event) => update('scriptRepoId', event.target.value)} required value={form.scriptRepoId}>{(options.repositories || []).filter((repository) => repository.active !== false && repository.repoCode === 'SkyCommand').map((repository) => <option key={repository.repoId} value={repository.repoId}>{repository.repoName} ({repository.repoCode})</option>)}</select></div>
      <div className="col-12 col-lg-4"><label className="form-label">Browser *</label><select className="form-select sky-form-control" onChange={(event) => update('browserType', event.target.value)} value={form.browserType}>{(options.browserTypes || ['chromium']).map((browser) => <option key={browser}>{browser}</option>)}</select></div>
      <div className="col-12"><label className="form-label">Repository-relative automation path *</label><input className="form-control sky-form-control sky-mono" onChange={(event) => update('scriptPath', event.target.value)} required value={form.scriptPath} /><div className="form-text sky-muted">Source remains in Git and must live beneath browser-automation/scripts/.</div></div>
      <div className="col-6 col-lg-2"><label className="form-label">Timeout (sec)</label><input className="form-control sky-form-control" max="3600" min="1" onChange={(event) => update('timeoutSeconds', event.target.value)} type="number" value={form.timeoutSeconds} /></div>
      <div className="col-6 col-lg-2"><label className="form-label">Retries</label><input className="form-control sky-form-control" max="3" min="0" onChange={(event) => update('retryCount', event.target.value)} type="number" value={form.retryCount} /></div>
      <div className="col-6 col-lg-2"><label className="form-label">Max concurrency</label><input className="form-control sky-form-control" max="8" min="1" onChange={(event) => update('maxConcurrency', event.target.value)} type="number" value={form.maxConcurrency} /></div>
      <div className="col-6 col-lg-2"><label className="form-label">Display order</label><input className="form-control sky-form-control" min="0" onChange={(event) => update('displayOrder', event.target.value)} type="number" value={form.displayOrder} /></div>
      <div className="col-12 col-lg-4"><label className="form-label">Execution permission</label><select className="form-select sky-form-control" onChange={(event) => update('permissionCode', event.target.value)} value={form.permissionCode}><option value="">None</option>{(options.permissions || []).filter((permission) => permission.active !== false).map((permission) => <option key={permission.permissionCode}>{permission.permissionCode}</option>)}</select></div>
      <div className="col-12 col-lg-4"><label className="form-label">Risk</label><select className="form-select sky-form-control" onChange={(event) => update('riskCode', event.target.value)} value={form.riskCode}>{(options.risks || []).filter((risk) => risk.active !== false).map((risk) => <option key={risk.riskCode} value={risk.riskCode}>{risk.riskName}</option>)}</select></div>
      <div className="col-12 col-lg-4"><label className="form-label">Side effects</label><select className="form-select sky-form-control" onChange={(event) => setSideEffects(event.target.value)} value={form.sideEffectLevel}>{(options.sideEffectLevels || []).map((level) => <option key={level}>{level}</option>)}</select></div>
      <div className="col-12 col-lg-4"><label className="form-label">Idempotency</label><select className="form-select sky-form-control" disabled={form.sideEffectLevel === 'READ_ONLY'} onChange={(event) => update('idempotencyMode', event.target.value)} value={form.idempotencyMode}>{(options.idempotencyModes || []).filter((mode) => form.sideEffectLevel === 'READ_ONLY' ? mode === 'READ_ONLY' : mode !== 'READ_ONLY').map((mode) => <option key={mode}>{mode}</option>)}</select></div>
      <div className="col-12 col-lg-4"><label className="form-label">Default environment</label><select className="form-select sky-form-control" onChange={(event) => setDefaultEnvironment(event.target.value)} value={form.defaultEnvironmentCode}>{(options.environments || []).filter((environment) => environment.enabled !== false).map((environment) => <option key={environment.environmentCode} value={environment.environmentCode}>{environment.environmentName} ({environment.environmentCode})</option>)}</select></div>
      <div className="col-12 col-lg-4"><label className="form-label">Allowed environments</label><div className="d-flex flex-wrap gap-3 pt-2">{(options.environments || []).filter((environment) => environment.enabled !== false).map((environment) => <div className="form-check" key={environment.environmentCode}><input checked={(form.environmentCodes || []).includes(environment.environmentCode)} className="form-check-input" disabled={environment.environmentCode === form.defaultEnvironmentCode} id={`auto-env-${environment.environmentCode}`} onChange={() => toggleEnvironment(environment.environmentCode)} type="checkbox" /><label className="form-check-label" htmlFor={`auto-env-${environment.environmentCode}`}>{environment.environmentName}</label></div>)}</div></div>
      <div className="col-12 col-lg-6"><label className="form-label">Output contract *</label><input className="form-control sky-form-control sky-mono" onChange={(event) => update('outputType', event.target.value)} required value={form.outputType} /></div>
      <div className="col-12 col-lg-6"><label className="form-label">Output schema path *</label><input className="form-control sky-form-control sky-mono" onChange={(event) => update('outputSchemaPath', event.target.value)} required value={form.outputSchemaPath} /></div>
      <div className="col-12"><div className="d-flex flex-wrap gap-4"><div className="form-check form-switch"><input checked={form.requiresConfirmation} className="form-check-input" id="automationRequiresConfirmation" onChange={(event) => update('requiresConfirmation', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="automationRequiresConfirmation">Confirmation required</label></div><div className="form-check form-switch"><input checked={form.enabled} className="form-check-input" id="automationEnabled" onChange={(event) => update('enabled', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="automationEnabled">Enabled</label></div></div></div>
      {form.requiresConfirmation && <div className="col-12"><label className="form-label">Confirmation text *</label><input className="form-control sky-form-control" onChange={(event) => update('confirmationText', event.target.value)} required value={form.confirmationText} /></div>}
    </div>

    <div className="d-flex align-items-center justify-content-between mt-4 mb-2"><div><div className="sky-page-kicker">Runtime parameters</div><div className="small sky-muted">Typed values are validated before Temporal execution.</div></div><button className="btn btn-sm sky-btn-ghost" onClick={() => onChange((current) => ({ ...current, parameters: [...current.parameters, emptyParameter(current.parameters.length, options)] }))} type="button">Add parameter</button></div>
    {(form.parameters || []).map((parameter, index) => <div className="sky-parameter-card mb-3" key={`automation-param-${index}`}><div className="d-flex justify-content-between align-items-center mb-2"><strong>Parameter {index + 1}</strong><button className="btn btn-sm sky-btn-danger" onClick={() => onChange((current) => ({ ...current, parameters: current.parameters.filter((_, i) => i !== index) }))} type="button">Remove</button></div><div className="row g-3"><div className="col-12 col-lg-3"><label className="form-label">Name *</label><input className="form-control sky-form-control sky-mono" onChange={(event) => updateParameter(index, 'parameterName', event.target.value)} required value={parameter.parameterName} /></div><div className="col-12 col-lg-3"><label className="form-label">Label *</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'label', event.target.value)} required value={parameter.label} /></div><div className="col-6 col-lg-2"><label className="form-label">Type</label><select className="form-select sky-form-control" onChange={(event) => updateParameter(index, 'type', event.target.value)} value={parameter.type}>{(options.parameterTypes || []).filter((type) => type.active !== false).map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select></div><div className="col-6 col-lg-2"><label className="form-label">Display order</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'displayOrder', event.target.value)} type="number" value={parameter.displayOrder} /></div><div className="col-12 col-lg-2 d-flex align-items-end gap-3 pb-2"><div className="form-check"><input checked={parameter.required} className="form-check-input" id={`auto-param-required-${index}`} onChange={(event) => updateParameter(index, 'required', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor={`auto-param-required-${index}`}>Required</label></div><div className="form-check"><input checked={parameter.enabled} className="form-check-input" id={`auto-param-enabled-${index}`} onChange={(event) => updateParameter(index, 'enabled', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor={`auto-param-enabled-${index}`}>Enabled</label></div></div><div className="col-12 col-lg-6"><label className="form-label">Prompt / help text</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'prompt', event.target.value)} value={parameter.prompt} /></div><div className="col-12 col-lg-6"><label className="form-label">Default value</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'defaultValue', event.target.value)} value={parameter.defaultValue} /></div><div className="col-12 col-lg-4"><label className="form-label">Dynamic option source</label><select className="form-select sky-form-control" onChange={(event) => updateParameter(index, 'optionSourceCode', event.target.value)} value={parameter.optionSourceCode}><option value="">None</option>{(options.optionSources || []).filter((source) => source.active !== false).map((source) => <option key={source.code} value={source.code}>{source.name}</option>)}</select></div><div className="col-12 col-lg-8"><label className="form-label">Static choices (Label=Value per line)</label><textarea className="form-control sky-form-control sky-mono" disabled={Boolean(parameter.optionSourceCode)} onChange={(event) => updateParameter(index, 'optionText', event.target.value)} rows={3} value={parameter.optionText} /></div></div></div>)}
    <button className="btn sky-btn-primary" disabled={saving} type="submit">{saving ? 'Saving...' : submitLabel}</button>
  </form>;
}

export function BrowserAutomationManage() {
  const [items, setItems] = useState([]); const [options, setOptions] = useState(null); const [filters, setFilters] = useState(DEFAULT_MANAGE_FILTERS); const [selectedId, setSelectedId] = useState(''); const [form, setForm] = useState(null); const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const editorRef = useRef(null);
  async function refreshList() { setLoading(true); try { const [registry, opts] = await Promise.all([browserAutomationService.listAdminAutomations({ limit: 100, offset: 0 }), options ? Promise.resolve({ options }) : browserAutomationService.getAdminOptions()]); setItems(registry.items || []); if (!options) setOptions(opts.options || {}); } catch (e) { setError(e.message || 'Failed to load Playwright Automation registry.'); } finally { setLoading(false); } }
  useEffect(() => { refreshList(); }, []);
  const filtered = useMemo(() => { const q = normalizeText(filters.q); return items.filter((item) => (!filters.categoryCode || item.category?.categoryCode === filters.categoryCode) && (!filters.sideEffectLevel || item.sideEffectLevel === filters.sideEffectLevel) && (filters.enabled === '' || String(Boolean(item.enabled)) === filters.enabled) && (!q || [item.label, item.automationCode, item.scriptPath, item.outputType].some((v) => normalizeText(v).includes(q)))); }, [items, filters]);
  const table = useAutomationTable(filtered, { defaultSorts: [{ field: 'automation', direction: 'asc' }], resetKey: JSON.stringify(filters), getSortValue: (item, field) => ({ automation: item.label, category: item.category?.label, source: item.scriptPath, sideEffects: item.sideEffectLevel, risk: item.riskRank, parameters: item.parameterCount, status: item.enabled ? 'ACTIVE' : 'DISABLED' })[field] });
  async function selectAutomation(item, { scroll = true } = {}) { if (!item || detailLoading) return; setSelectedId(item.automationId); setDetailLoading(true); setError(''); setNotice(''); try { const result = await browserAutomationService.getAdminAutomation(item.automationId); setForm(formFromAutomation(result.automation, options || {})); if (scroll) window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); } catch (e) { setError(e.message || 'Failed to load Playwright Automation configuration.'); } finally { setDetailLoading(false); } }
  const visibleKey = table.pageItems.map((item) => item.automationId).join('|'); useEffect(() => { if (loading || !options || detailLoading) return; if (!table.pageItems.length) { setSelectedId(''); setForm(null); return; } if (table.pageItems.some((item) => item.automationId === selectedId) && form) return; selectAutomation(table.pageItems[0], { scroll: false }); }, [loading, options, visibleKey]);
  async function save(event) { event.preventDefault(); if (!selectedId || !form) return; setSaving(true); setError(''); setNotice(''); try { const payload = buildPayload(form); const { environmentCodes, parameters, automationCode, ...definition } = payload; await browserAutomationService.updateAdminAutomation(selectedId, definition); await browserAutomationService.replaceAdminAutomationParameters(selectedId, parameters); await browserAutomationService.replaceAdminAutomationEnvironments(selectedId, environmentCodes); const detail = await browserAutomationService.getAdminAutomation(selectedId); setForm(formFromAutomation(detail.automation, options || {})); await refreshList(); setNotice(`${detail.automation.label} configuration saved.`); } catch (e) { setError(e.message || 'Failed to save Playwright Automation configuration.'); } finally { setSaving(false); } }
  return <div className="container-fluid px-0"><PageHeader kicker="PLAYWRIGHT AUTOMATION · ADMINISTRATION" subtitle="Review and maintain registered source-controlled operational browser automations and their safety contracts." title="Manage Automations" />{error && <DismissibleAlert tone="danger" onDismiss={() => setError('')}>{error}</DismissibleAlert>}{notice && <DismissibleAlert tone="success" onDismiss={() => setNotice('')}>{notice}</DismissibleAlert>}<Panel className="sky-table-card sky-table-browser-anchor" kicker="AUTOMATION REGISTRY" subtitle="Filter the registry, then select a row to edit metadata, safety, environments, permissions, outputs, and parameters." title="Registered Automations"><div className="sky-card-body"><div className="sky-run-tools-filter-grid sky-browser-test-filter-grid mb-3"><div className="sky-run-tools-search-filter"><label className="form-label">Search</label><input className="form-control sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Name, code, source path, output contract..." type="search" value={filters.q} /></div><div><label className="form-label">Category</label><select className="form-select sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))} value={filters.categoryCode}><option value="">All categories</option>{(options?.categories || []).map((category) => <option key={category.categoryId} value={category.categoryCode}>{category.label}</option>)}</select></div><div><label className="form-label">Side effects</label><select className="form-select sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, sideEffectLevel: event.target.value }))} value={filters.sideEffectLevel}><option value="">All levels</option>{(options?.sideEffectLevels || []).map((level) => <option key={level}>{level}</option>)}</select></div><div><label className="form-label">Status</label><select className="form-select sky-form-control" onChange={(event) => setFilters((current) => ({ ...current, enabled: event.target.value }))} value={filters.enabled}><option value="">All statuses</option><option value="true">Active</option><option value="false">Disabled</option></select></div><div className="sky-run-tools-filter-actions">{table.sortingCustomized && <button className="btn btn-sm sky-btn-ghost" onClick={table.clearSorting} type="button">Clear sorting</button>}<button className="btn btn-sm sky-btn-ghost" onClick={() => setFilters(DEFAULT_MANAGE_FILTERS)} type="button">Clear filters</button></div></div><div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame"><table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle"><thead><tr><SortableHeader field="automation" label="Automation" table={table} /><SortableHeader field="category" label="Category" table={table} /><SortableHeader field="source" label="Source" table={table} /><SortableHeader field="sideEffects" label="Side Effects" table={table} /><SortableHeader field="risk" label="Risk" table={table} /><SortableHeader field="parameters" label="Parameters" table={table} /><SortableHeader field="status" label="Status" table={table} /></tr></thead><tbody>{loading ? <tr><td colSpan={7}><div className="sky-empty-state">Loading registered automations...</div></td></tr> : table.pageItems.length === 0 ? <tr><td colSpan={7}><div className="sky-empty-state">No registered automations match the current filters.</div></td></tr> : table.pageItems.map((item) => <tr className={`sky-clickable-row ${selectedId === item.automationId ? 'sky-selected-row' : ''}`} key={item.automationId} onClick={() => selectAutomation(item)}><td><div className="fw-bold sky-detail-value">{item.label}</div><div className="small sky-muted sky-mono">{item.automationCode}</div></td><td>{item.category?.label}</td><td><div>{item.scriptRepository?.repoName}</div><div className="small sky-muted sky-mono">{item.scriptPath}</div></td><td>{sideEffectPill(item.sideEffectLevel)}</td><td><span className={`sky-pill ${riskToneClass(item.riskCode)}`}>{String(item.riskName || item.riskCode).toUpperCase()}</span></td><td>{item.parameterCount}</td><td>{statusPill(item.enabled)}</td></tr>)}</tbody></table></div><TablePagination label="registered automation(s)" loading={loading} table={table} /></div></Panel><div ref={editorRef}>{form && options && <Panel actions={statusPill(form.enabled)} className="mt-3" kicker="AUTOMATION CONFIGURATION" subtitle="Automation code is immutable here to protect execution history and future workflow references. Source remains version-controlled in Git." title={form.label || form.automationCode}><AutomationRegistryForm canEditCode={false} form={form} onChange={setForm} onSubmit={save} options={options} saving={saving} submitLabel="Save configuration" /></Panel>}</div></div>;
}

export function BrowserAutomationAdd() {
  const navigate = useNavigate(); const [options, setOptions] = useState(null); const [form, setForm] = useState(null); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { let active = true; browserAutomationService.getAdminOptions().then((result) => { if (!active) return; const opts = result.options || {}; setOptions(opts); setForm(emptyForm(opts)); }).catch((e) => active && setError(e.message || 'Failed to load Playwright Automation registration options.')).finally(() => active && setLoading(false)); return () => { active = false; }; }, []);
  async function create(event) { event.preventDefault(); if (!form) return; setSaving(true); setError(''); try { const result = await browserAutomationService.createAdminAutomation(buildPayload(form)); navigate('/browser-automations/manage', { replace: true, state: { createdAutomationId: result.automation?.automationId } }); } catch (e) { setError(e.message || 'Failed to register Playwright Automation.'); } finally { setSaving(false); } }
  return <div className="container-fluid px-0"><PageHeader kicker="PLAYWRIGHT AUTOMATION · REGISTRATION" subtitle="Register a source-controlled operational Playwright script with execution metadata, safety controls, structured output, environments, and parameters." title="Add Automation" />{error && <DismissibleAlert tone="danger" onDismiss={() => setError('')}>{error}</DismissibleAlert>}{loading && <Panel kicker="LOADING" title="Playwright Automation Registration"><div className="sky-card-body sky-muted">Loading registry options...</div></Panel>}{form && options && <Panel kicker="NEW PLAYWRIGHT AUTOMATION" subtitle="The source file must already exist beneath browser-automation/scripts/. New automations can remain disabled until reviewed." title="Automation Registration"><AutomationRegistryForm form={form} onChange={setForm} onSubmit={create} options={options} saving={saving} submitLabel="Register Playwright Automation" /></Panel>}</div>;
}

// Backward-compatible Phase 6 route/export. The registry has evolved into Manage Automations.
export function BrowserAutomationRegistry() { return <BrowserAutomationManage />; }

export default BrowserAutomationRun;
