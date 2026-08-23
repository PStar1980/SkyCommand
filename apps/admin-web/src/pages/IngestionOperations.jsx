import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import ingestionService from '../services/ingestionService.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const PAGE_SIZE = 10;

const DEFAULT_FILTERS = {
  domainCode: '',
  sourceCode: '',
  statusCode: '',
  toolCode: '',
  q: '',
};

const STATUS_OPTIONS = [
  '',
  'QUEUED',
  'RUNNING',
  'SUCCESS',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDuration(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return '—';
  if (milliseconds < 1000) return `${milliseconds.toLocaleString()} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : '0';
}

function normalizeStatus(value) {
  return String(value || 'UNKNOWN').toUpperCase();
}

function statusClass(value) {
  const status = normalizeStatus(value);
  if (['SUCCESS', 'COMPLETED', 'PASS', 'UPDATED', 'UNCHANGED'].includes(status)) {
    return 'sky-pill-success';
  }
  if (['FAILED', 'ERROR', 'CANCELLED', 'REJECTED', 'FAIL'].includes(status)) {
    return 'sky-pill-danger';
  }
  if (['PARTIAL', 'WARNING', 'WARN', 'RUNNING', 'QUEUED'].includes(status)) {
    return 'sky-pill-warning';
  }
  return 'sky-pill-info';
}

function isActiveRun(run) {
  return ['QUEUED', 'RUNNING', 'STARTED'].includes(normalizeStatus(run?.statusCode));
}

function getFinalItemAttempts(items = []) {
  const latestByAsset = new Map();
  items.forEach((item) => {
    const current = latestByAsset.get(item.assetCode);
    if (!current || Number(item.attemptNumber || 0) >= Number(current.attemptNumber || 0)) {
      latestByAsset.set(item.assetCode, item);
    }
  });
  return Array.from(latestByAsset.values()).sort((left, right) =>
    String(left.assetCode || '').localeCompare(String(right.assetCode || '')),
  );
}

function IngestionOperations() {
  const navigate = useNavigate();
  const [domains, setDomains] = useState([]);
  const [sources, setSources] = useState([]);
  const [tools, setTools] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [recoveries, setRecoveries] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [draftSearch, setDraftSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart = total === 0 ? 0 : (safeCurrentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * PAGE_SIZE, total);

  const filteredSources = useMemo(
    () =>
      sources.filter(
        (source) => !filters.domainCode || source.domainCode === filters.domainCode,
      ),
    [filters.domainCode, sources],
  );

  const filteredTools = useMemo(
    () =>
      tools.filter(
        (tool) =>
          (!filters.domainCode || tool.domainCode === filters.domainCode) &&
          (!filters.sourceCode || tool.sourceCode === filters.sourceCode),
      ),
    [filters.domainCode, filters.sourceCode, tools],
  );

  const finalAttempts = useMemo(
    () => getFinalItemAttempts(selectedDetail?.items || []),
    [selectedDetail],
  );
  const failedAssets = useMemo(
    () => finalAttempts.filter((item) => !item.successLike).map((item) => item.assetCode),
    [finalAttempts],
  );

  async function loadOptions() {
    try {
      const [domainResult, sourceResult, toolResult] = await Promise.all([
        ingestionService.listCatalogueDomains(),
        ingestionService.listCatalogueSources(),
        ingestionService.listTools(),
      ]);
      setDomains(domainResult.items || []);
      setSources(sourceResult.items || []);
      setTools(toolResult.items || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load ingestion catalogue options.');
    }
  }

  async function loadRunDetail(run) {
    if (!run?.ingestionRunId) {
      setSelectedDetail(null);
      setRecoveries([]);
      return;
    }

    setDetailLoading(true);
    try {
      const [detailResult, recoveryResult] = await Promise.all([
        ingestionService.getIngestionRun(run.ingestionRunId),
        ingestionService.listRecoveryRequests({
          originalRunId: run.ingestionRunId,
          limit: 20,
        }),
      ]);
      setSelectedDetail(detailResult);
      setRecoveries(recoveryResult.items || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load ingestion run detail.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadRuns(
    nextFilters = filters,
    nextPage = currentPage,
    { keepSelection = true, quiet = false } = {},
  ) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    const safePage = Math.max(1, Number(nextPage) || 1);

    try {
      const result = await ingestionService.listIngestionRuns({
        ...nextFilters,
        limit: PAGE_SIZE,
        offset: (safePage - 1) * PAGE_SIZE,
      });
      const nextRuns = result.items || [];
      const nextTotal = Number(result.total || 0);
      const nextPageCount = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));

      if (nextTotal > 0 && safePage > nextPageCount) {
        setCurrentPage(nextPageCount);
        return loadRuns(nextFilters, nextPageCount, { keepSelection: false, quiet });
      }

      setRuns(nextRuns);
      setTotal(nextTotal);
      setCurrentPage(safePage);
      setRefreshingAt(new Date());

      const currentId = keepSelection ? selectedRun?.ingestionRunId : null;
      const nextSelected =
        nextRuns.find((run) => run.ingestionRunId === currentId) || nextRuns[0] || null;
      setSelectedRun(nextSelected);

      if (!quiet || nextSelected?.ingestionRunId !== selectedDetail?.run?.ingestionRunId) {
        await loadRunDetail(nextSelected);
      }

      return { activeCount: nextRuns.filter(isActiveRun).length };
    } catch (loadError) {
      if (!quiet) setError(loadError.message || 'Failed to load ingestion history.');
      throw loadError;
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    loadOptions();
    loadRuns(DEFAULT_FILTERS, 1, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollingState = useSmartPolling({
    dependencies: [
      filters.domainCode,
      filters.sourceCode,
      filters.statusCode,
      filters.toolCode,
      filters.q,
      safeCurrentPage,
    ],
    getDelay: ({ activeCount = 0, hidden = false } = {}) =>
      getSmartPollingDelay({
        activeCount,
        activeMs: SMART_POLLING_INTERVALS.ACTIVE,
        hidden,
        idleMs: SMART_POLLING_INTERVALS.IDLE,
      }),
    initialIntervalMs: SMART_POLLING_INTERVALS.IDLE,
    onPoll: () => loadRuns(filters, safeCurrentPage, { keepSelection: true, quiet: true }),
  });

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
      ...(name === 'domainCode' ? { sourceCode: '', toolCode: '' } : {}),
      ...(name === 'sourceCode' ? { toolCode: '' } : {}),
    };
    setFilters(nextFilters);
    loadRuns(nextFilters, 1, { keepSelection: false });
  }

  function applySearch(event) {
    event.preventDefault();
    const nextFilters = { ...filters, q: draftSearch.trim() };
    setFilters(nextFilters);
    loadRuns(nextFilters, 1, { keepSelection: false });
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setDraftSearch('');
    loadRuns(DEFAULT_FILTERS, 1, { keepSelection: false });
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    loadRuns(filters, nextPage, { keepSelection: false });
  }

  function selectRun(run) {
    setSelectedRun(run);
    loadRunDetail(run);
  }

  function openFailedOnlyRecovery() {
    const run = selectedDetail?.run;
    if (!run || failedAssets.length === 0) return;
    const query = new URLSearchParams({
      toolCode: run.toolCode || '',
      indicators: failedAssets.join(','),
      concurrency: '1',
      resumeRunId: run.ingestionRunId,
      recoveryMode: 'INCREMENTAL',
      forceRefresh: 'false',
    });
    navigate(`/tools/run?${query.toString()}`);
  }

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Running ingestion jobs"
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadRuns(filters, safeCurrentPage)}
            pollingState={pollingState}
          />
        }
        kicker="Data · Operations"
        subtitle="Inspect portable ingestion runs, asset attempts, evidence, lineage, and recovery history across every registered data domain."
        title="Ingestion Operations"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <div className="sky-functional-history-shell sky-ingestion-operations-shell">
        <section className="sky-card mb-4 sky-functional-history-browser">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Run browser</div>
              <h2 className="h5 mb-0">Ingestion history</h2>
              <p className="sky-muted small mb-0">
                Filter the generic ingestion ledger, then inspect durable item-level evidence below.
              </p>
            </div>

            <div className="sky-history-filter-grid sky-ingestion-operations-filters">
              <div>
                <label className="form-label" htmlFor="ingestionOperationsDomain">Domain</label>
                <select
                  className="form-select sky-form-control"
                  id="ingestionOperationsDomain"
                  onChange={(event) => updateFilter('domainCode', event.target.value)}
                  value={filters.domainCode}
                >
                  <option value="">All domains</option>
                  {domains.map((domain) => (
                    <option key={domain.domainCode} value={domain.domainCode}>
                      {domain.domainName || domain.domainCode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="ingestionOperationsSource">Source</label>
                <select
                  className="form-select sky-form-control"
                  id="ingestionOperationsSource"
                  onChange={(event) => updateFilter('sourceCode', event.target.value)}
                  value={filters.sourceCode}
                >
                  <option value="">All sources</option>
                  {filteredSources.map((source) => (
                    <option key={`${source.domainCode}-${source.sourceCode}`} value={source.sourceCode}>
                      {source.sourceName || source.sourceCode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="ingestionOperationsStatus">Status</label>
                <select
                  className="form-select sky-form-control"
                  id="ingestionOperationsStatus"
                  onChange={(event) => updateFilter('statusCode', event.target.value)}
                  value={filters.statusCode}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status || 'all'} value={status}>
                      {status || 'All statuses'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="ingestionOperationsTool">Tool</label>
                <select
                  className="form-select sky-form-control"
                  id="ingestionOperationsTool"
                  onChange={(event) => updateFilter('toolCode', event.target.value)}
                  value={filters.toolCode}
                >
                  <option value="">All ingestion tools</option>
                  {filteredTools.map((tool) => (
                    <option key={tool.toolCode} value={tool.toolCode}>
                      {tool.toolLabel || tool.toolCode}
                    </option>
                  ))}
                </select>
              </div>
              <form className="sky-ingestion-operations-search" onSubmit={applySearch}>
                <label className="form-label" htmlFor="ingestionOperationsSearch">Search</label>
                <div className="d-flex gap-2">
                  <input
                    className="form-control sky-form-control"
                    id="ingestionOperationsSearch"
                    onChange={(event) => setDraftSearch(event.target.value)}
                    placeholder="Run, source, tool, summary..."
                    type="search"
                    value={draftSearch}
                  />
                  <button className="btn sky-btn-primary" disabled={loading} type="submit">Apply</button>
                  <button className="btn sky-btn-ghost" disabled={loading} onClick={resetFilters} type="button">
                    Reset
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card">
            <table className="table table-sm table-hover sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Domain / source</th>
                  <th>Tool</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Assets</th>
                  <th>Quality</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="8"><div className="sky-empty-state">Loading ingestion runs...</div></td></tr>
                )}
                {!loading && runs.length === 0 && (
                  <tr><td colSpan="8"><div className="sky-empty-state">No ingestion runs matched these filters.</div></td></tr>
                )}
                {!loading && runs.map((run) => (
                  <tr
                    className={`sky-clickable-row ${selectedRun?.ingestionRunId === run.ingestionRunId ? 'sky-selected-row' : ''}`}
                    key={run.ingestionRunId}
                    onClick={() => selectRun(run)}
                  >
                    <td>
                      <div>{formatDate(run.startedAt)}</div>
                      <div className="small sky-muted">{formatDuration(run.durationMs)}</div>
                    </td>
                    <td>
                      <div className="fw-semibold">{run.domainCode}</div>
                      <div className="small sky-mono">{run.sourceCode}</div>
                    </td>
                    <td>
                      <div>{run.toolLabel || run.toolCode || '—'}</div>
                      <div className="small sky-mono">{run.toolCode || '—'}</div>
                    </td>
                    <td>{run.triggerCode || '—'}</td>
                    <td><span className={`sky-pill ${statusClass(run.statusCode)}`}>{run.statusCode}</span></td>
                    <td>{formatNumber(run.totals?.itemsRequested)}</td>
                    <td><span className={`sky-pill ${statusClass(run.totals?.qualityStatusCode)}`}>{run.totals?.qualityStatusCode || 'PASS'}</span></td>
                    <td>{formatNumber(run.totals?.rowsInserted + run.totals?.rowsUpdated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sky-pagination-row">
            <div className="small sky-muted">Showing {rangeStart}-{rangeEnd} of {total} ingestion run(s)</div>
            <div className="sky-pagination-controls" aria-label="Ingestion operations pagination">
              <button className="btn btn-sm sky-btn-ghost" disabled={safeCurrentPage <= 1 || loading} onClick={() => goToPage(1)} type="button">First</button>
              <button className="btn btn-sm sky-btn-ghost" disabled={safeCurrentPage <= 1 || loading} onClick={() => goToPage(safeCurrentPage - 1)} type="button">Back</button>
              <label className="sky-pagination-select-label" htmlFor="ingestionOperationsPage">Page</label>
              <select className="form-select form-select-sm sky-form-control sky-pagination-select" id="ingestionOperationsPage" onChange={(event) => goToPage(event.target.value)} value={safeCurrentPage}>
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => <option key={page} value={page}>{page}</option>)}
              </select>
              <span className="small sky-muted">of {pageCount}</span>
              <button className="btn btn-sm sky-btn-ghost" disabled={safeCurrentPage >= pageCount || loading} onClick={() => goToPage(safeCurrentPage + 1)} type="button">Next</button>
              <button className="btn btn-sm sky-btn-ghost" disabled={safeCurrentPage >= pageCount || loading} onClick={() => goToPage(pageCount)} type="button">Last</button>
            </div>
          </div>
        </section>

        <section className="sky-card sky-functional-history-detail-zone">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Selected run workspace</div>
              <h2 className="h5 mb-1">{selectedDetail?.run?.sourceName || 'Ingestion run detail'}</h2>
              <div className="small sky-mono">{selectedDetail?.run?.ingestionRunId || 'Select a run above.'}</div>
            </div>
            {selectedDetail?.run && (
              <div className="d-flex flex-wrap gap-2">
                <span className={`sky-pill ${statusClass(selectedDetail.run.statusCode)}`}>{selectedDetail.run.statusCode}</span>
                <span className="sky-pill sky-pill-info">{selectedDetail.contractVersion}</span>
                {failedAssets.length > 0 && selectedDetail.run.capabilities?.resume && (
                  <button className="btn btn-sm sky-btn-primary" onClick={openFailedOnlyRecovery} type="button">
                    Recover failed assets
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="sky-card-body">
            {detailLoading ? (
              <div className="sky-empty-state">Loading durable ingestion evidence...</div>
            ) : !selectedDetail?.run ? (
              <div className="sky-empty-state">Select an ingestion run to inspect its asset attempts and lineage.</div>
            ) : (
              <>
                <div className="sky-execution-metric-grid sky-ingestion-run-metric-grid">
                  {[
                    ['Requested', selectedDetail.run.totals?.itemsRequested],
                    ['Succeeded', selectedDetail.run.totals?.itemsSucceeded],
                    ['Failed', selectedDetail.run.totals?.itemsFailed],
                    ['Attempts', selectedDetail.run.totals?.attempts],
                    ['Rows inserted', selectedDetail.run.totals?.rowsInserted],
                    ['Rows updated', selectedDetail.run.totals?.rowsUpdated],
                    ['Revisions', selectedDetail.run.totals?.revisionsDetected],
                    ['Rejected', selectedDetail.run.totals?.rowsRejected],
                  ].map(([label, value]) => (
                    <div className="sky-stat-card" key={label}>
                      <div className="sky-detail-label">{label}</div>
                      <div className="sky-stat-value">{formatNumber(value)}</div>
                    </div>
                  ))}
                </div>

                <div className="row g-3 mb-4">
                  <div className="col-xl-7">
                    <div className="sky-page-kicker mb-2">Execution lineage</div>
                    <div className="table-responsive sky-table-card">
                      <table className="table table-sm sky-table mb-0"><tbody>
                        <tr><th>Script execution</th><td className="sky-mono text-break">{selectedDetail.run.scriptExecutionId || '—'}</td></tr>
                        <tr><th>Workflow run</th><td className="sky-mono text-break">{selectedDetail.run.workflowRunRecordId || '—'}</td></tr>
                        <tr><th>Workflow node</th><td className="sky-mono text-break">{selectedDetail.run.workflowNodeRunRecordId || '—'}</td></tr>
                        <tr><th>Temporal workflow</th><td className="sky-mono text-break">{selectedDetail.run.temporalWorkflowId || '—'}</td></tr>
                        <tr><th>Temporal run</th><td className="sky-mono text-break">{selectedDetail.run.temporalRunId || '—'}</td></tr>
                        <tr><th>Resumed from</th><td className="sky-mono text-break">{selectedDetail.run.resumedFromRunId || '—'}</td></tr>
                      </tbody></table>
                    </div>
                  </div>
                  <div className="col-xl-5">
                    <div className="sky-page-kicker mb-2">Evidence coverage</div>
                    <div className="table-responsive sky-table-card">
                      <table className="table table-sm sky-table mb-0"><tbody>
                        <tr><th>Item attempts</th><td>{formatNumber(selectedDetail.items?.length)}</td></tr>
                        <tr><th>Quality findings</th><td>{formatNumber(selectedDetail.qualityEvents?.length)}</td></tr>
                        <tr><th>Revision events</th><td>{formatNumber(selectedDetail.revisionEvents?.length)}</td></tr>
                        <tr><th>Rejected rows</th><td>{formatNumber(selectedDetail.rejectionEvents?.length)}</td></tr>
                        <tr><th>Recovery requests</th><td>{formatNumber(recoveries.length)}</td></tr>
                        <tr><th>Failed final assets</th><td>{failedAssets.length ? failedAssets.join(', ') : 'None'}</td></tr>
                      </tbody></table>
                    </div>
                  </div>
                </div>

                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                  <div className="sky-page-kicker">Asset attempts</div>
                  <span className="sky-pill sky-pill-info">{selectedDetail.items?.length || 0} attempt(s)</span>
                </div>
                <div className="table-responsive sky-table-card mb-4">
                  <table className="table table-sm sky-table align-middle mb-0">
                    <thead><tr><th>Asset</th><th>Attempt</th><th>Outcome</th><th>Quality</th><th>Inserted</th><th>Updated</th><th>Unchanged</th><th>Rejected</th><th>Duration</th><th>Error</th></tr></thead>
                    <tbody>
                      {(selectedDetail.items || []).map((item) => (
                        <tr key={item.ingestionRunItemId}>
                          <td><div className="fw-semibold sky-mono">{item.assetCode}</div><div className="small sky-muted">{item.assetName || '—'}</div></td>
                          <td>{item.attemptNumber}</td>
                          <td><span className={`sky-pill ${statusClass(item.outcomeCode)}`}>{item.outcomeCode}</span></td>
                          <td><span className={`sky-pill ${statusClass(item.qualityStatusCode)}`}>{item.qualityStatusCode}</span></td>
                          <td>{formatNumber(item.rows?.inserted)}</td>
                          <td>{formatNumber(item.rows?.updated)}</td>
                          <td>{formatNumber(item.rows?.unchanged)}</td>
                          <td>{formatNumber(item.rows?.rejected)}</td>
                          <td>{formatDuration(item.durationMs)}</td>
                          <td>{item.error?.message || '—'}</td>
                        </tr>
                      ))}
                      {(selectedDetail.items || []).length === 0 && <tr><td colSpan="10"><div className="sky-empty-state">No item attempts were persisted for this run.</div></td></tr>}
                    </tbody>
                  </table>
                </div>

                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                  <div className="sky-page-kicker">Recovery history</div>
                  <span className="sky-pill sky-pill-info">{recoveries.length} request(s)</span>
                </div>
                <div className="table-responsive sky-table-card">
                  <table className="table table-sm sky-table align-middle mb-0">
                    <thead><tr><th>Requested</th><th>Status</th><th>Assets</th><th>Recovery run</th><th>Completed</th></tr></thead>
                    <tbody>
                      {recoveries.map((recovery) => (
                        <tr key={recovery.recoveryRequestId}>
                          <td>{formatDate(recovery.requestedAt)}</td>
                          <td><span className={`sky-pill ${statusClass(recovery.statusCode)}`}>{recovery.statusCode}</span></td>
                          <td className="sky-mono">{(recovery.requestedAssets || []).join(', ') || '—'}</td>
                          <td className="sky-mono text-break">{recovery.recoveryRunId || '—'}</td>
                          <td>{formatDate(recovery.completedAt)}</td>
                        </tr>
                      ))}
                      {recoveries.length === 0 && <tr><td colSpan="5"><div className="sky-empty-state">No recovery requests are linked to this run.</div></td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export default IngestionOperations;
