import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import ingestionService from '../services/ingestionService.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';
import {
  getAvailableTablePageSizes,
  getPageForAbsoluteIndex,
  normalizeTablePageSize,
  SMART_TABLE_DEFAULT_PAGE_SIZE,
} from '../utils/tablePageSize.js';
const INGESTION_RUN_FETCH_LIMIT = 250;
const INGESTION_RUN_DEFAULT_SORTS = [{ field: 'started', direction: 'desc' }];

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

function getRunSortValue(run, field) {
  if (field === 'started') {
    const timestamp = run?.startedAt ? new Date(run.startedAt).getTime() : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (field === 'domainSource') {
    return `${run?.domainCode || ''} ${run?.sourceCode || ''}`.trim();
  }
  if (field === 'tool') {
    return `${run?.toolLabel || ''} ${run?.toolCode || ''}`.trim();
  }
  if (field === 'trigger') return run?.triggerCode || null;
  if (field === 'status') return normalizeStatus(run?.statusCode);
  if (field === 'assets') {
    const value = Number(run?.totals?.itemsRequested);
    return Number.isFinite(value) ? value : null;
  }
  if (field === 'quality') return normalizeStatus(run?.totals?.qualityStatusCode || 'PASS');
  if (field === 'rows') {
    const inserted = Number(run?.totals?.rowsInserted || 0);
    const updated = Number(run?.totals?.rowsUpdated || 0);
    return inserted + updated;
  }
  return run?.[field] ?? '';
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(SMART_TABLE_DEFAULT_PAGE_SIZE);
  const [sorts, setSorts] = useState(() => INGESTION_RUN_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);
  const runRequestIdRef = useRef(0);
  const browserRef = useRef(null);

  const sortedRuns = useMemo(
    () => sortItemsBySorts(runs, sorts, getRunSortValue),
    [runs, sorts],
  );
  const pageSizeOptions = useMemo(
    () => getAvailableTablePageSizes(sortedRuns.length),
    [sortedRuns.length],
  );
  const effectivePageSize = normalizeTablePageSize(pageSize, sortedRuns.length);
  const pageCount = Math.max(1, Math.ceil(sortedRuns.length / effectivePageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStart = (safeCurrentPage - 1) * effectivePageSize;
  const visibleRuns = useMemo(
    () => sortedRuns.slice(pageStart, pageStart + effectivePageSize),
    [effectivePageSize, pageStart, sortedRuns],
  );
  const rangeStart = sortedRuns.length === 0 || visibleRuns.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = rangeStart === 0 ? 0 : rangeStart + visibleRuns.length - 1;

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
    { keepSelection = true, quiet = false, nextSorts = sorts } = {},
  ) {
    const requestId = runRequestIdRef.current + 1;
    runRequestIdRef.current = requestId;

    if (!quiet) {
      setLoading(true);
      setError('');
    }

    const requestedPage = Math.max(1, Number(nextPage) || 1);

    try {
      const nextRuns = [];
      let nextTotal = 0;
      let offset = 0;

      do {
        const result = await ingestionService.listIngestionRuns({
          ...nextFilters,
          limit: INGESTION_RUN_FETCH_LIMIT,
          offset,
        });

        if (requestId !== runRequestIdRef.current) {
          return { activeCount: 0 };
        }

        const batch = result.items || [];
        nextTotal = Number(result.total || 0);
        nextRuns.push(...batch);
        offset += batch.length;

        if (batch.length === 0) {
          break;
        }
      } while (nextRuns.length < nextTotal);

      const sortedNextRuns = sortItemsBySorts(nextRuns, nextSorts, getRunSortValue);
      const nextPageSize = normalizeTablePageSize(pageSize, sortedNextRuns.length);
      const currentId = keepSelection ? selectedRun?.ingestionRunId : null;
      const nextSelected =
        sortedNextRuns.find((run) => run.ingestionRunId === currentId) ||
        sortedNextRuns[0] ||
        null;
      const selectedIndex = nextSelected
        ? sortedNextRuns.findIndex((run) => run.ingestionRunId === nextSelected.ingestionRunId)
        : -1;
      const selectedPage = selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, nextPageSize) : 1;
      const nextPageCount = Math.max(1, Math.ceil(sortedNextRuns.length / nextPageSize));
      const resolvedPage = keepSelection && selectedIndex >= 0
        ? selectedPage
        : Math.min(requestedPage, nextPageCount);

      setRuns(nextRuns);
      setTotal(nextRuns.length);
      setPageSize(nextPageSize);
      setCurrentPage(resolvedPage);
      setRefreshingAt(new Date());
      setSelectedRun(nextSelected);

      if (!quiet || nextSelected?.ingestionRunId !== selectedDetail?.run?.ingestionRunId) {
        await loadRunDetail(nextSelected);
      }

      return { activeCount: nextRuns.filter(isActiveRun).length };
    } catch (loadError) {
      if (!quiet) setError(loadError.message || 'Failed to load ingestion history.');
      throw loadError;
    } finally {
      if (!quiet && requestId === runRequestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadOptions();
    loadRuns(DEFAULT_FILTERS, 1, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pageSize !== effectivePageSize) {
      setPageSize(effectivePageSize);
      setCurrentPage((page) => Math.min(page, Math.max(1, Math.ceil(sortedRuns.length / effectivePageSize))));
    }
  }, [effectivePageSize, pageSize, sortedRuns.length]);

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


  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    loadRuns(DEFAULT_FILTERS, 1, { keepSelection: false });
  }

  function applySorting(nextSorts, customized) {
    const sorted = sortItemsBySorts(runs, nextSorts, getRunSortValue);
    const selectedIndex = selectedRun?.ingestionRunId
      ? sorted.findIndex((run) => run.ingestionRunId === selectedRun.ingestionRunId)
      : -1;
    const nextPage = selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, effectivePageSize) : 1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(nextPage);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: INGESTION_RUN_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(INGESTION_RUN_DEFAULT_SORTS, false);
  }

  function renderSortableHeader(label, field) {
    const activeIndex = sorts.findIndex((sort) => sort.field === field);
    const activeSort = activeIndex >= 0 ? sorts[activeIndex] : null;
    const directionIcon = activeSort?.direction === 'asc' ? '↑' : '↓';
    const sortDescription = activeSort
      ? `${activeSort.direction === 'asc' ? 'ascending' : 'descending'}, priority ${activeIndex + 1}`
      : 'not currently sorted';

    return (
      <th>
        <button
          aria-label={`${label}: ${sortDescription}. Click to sort; Shift+click to add to multi-column sorting.`}
          className={`sky-table-sort-button ${activeSort ? 'is-active' : ''}`}
          onClick={(event) => updateSorting(field, event)}
          title="Click to sort · Shift+click to add sort"
          type="button"
        >
          <span>{label}</span>
          <span className="sky-table-sort-indicator" aria-hidden="true">
            {activeSort ? directionIcon : '↕'}
          </span>
          {activeSort && (
            <span className="sky-table-sort-priority" aria-hidden="true">
              {activeIndex + 1}
            </span>
          )}
        </button>
      </th>
    );
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    setCurrentPage(nextPage);

    const firstVisible = sortedRuns[(nextPage - 1) * effectivePageSize];
    if (firstVisible && firstVisible.ingestionRunId !== selectedRun?.ingestionRunId) {
      selectRun(firstVisible);
    }
  }

  function changePageSize(value) {
    const nextPageSize = Number(value);

    if (!pageSizeOptions.includes(nextPageSize) || nextPageSize === effectivePageSize) {
      return;
    }

    const selectedIndex = selectedRun?.ingestionRunId
      ? sortedRuns.findIndex((run) => run.ingestionRunId === selectedRun.ingestionRunId)
      : -1;
    const nextPage = selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, nextPageSize) : 1;

    setPageSize(nextPageSize);
    setCurrentPage(nextPage);
    window.requestAnimationFrame(() => {
      browserRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
        <section ref={browserRef} className="sky-card mb-4 sky-functional-history-browser sky-table-browser-anchor">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Run browser</div>
              <h2 className="h5 mb-0">Ingestion history</h2>
              <p className="sky-muted small mb-0">
                Filter the generic ingestion ledger, then inspect durable item-level evidence below.
              </p>
            </div>

            <div className="sky-ingestion-operations-filters">
              <div className="sky-ingestion-operations-search">
                <label className="form-label" htmlFor="ingestionOperationsSearch">Search</label>
                <input
                  className="form-control sky-form-control"
                  id="ingestionOperationsSearch"
                  onChange={(event) => updateFilter('q', event.target.value)}
                  placeholder="Run, source, tool, summary..."
                  type="search"
                  value={filters.q}
                />
              </div>
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
                    <option key={domain.domainCode} value={domain.domainCode}>{domain.domainName || domain.domainCode}</option>
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
                    <option key={`${source.domainCode}-${source.sourceCode}`} value={source.sourceCode}>{source.sourceName || source.sourceCode}</option>
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
                    <option key={status || 'all'} value={status}>{status || 'All statuses'}</option>
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
                    <option key={tool.toolCode} value={tool.toolCode}>{tool.toolLabel || tool.toolCode}</option>
                  ))}
                </select>
              </div>
              <div className="sky-run-tools-filter-actions">
                {sortingCustomized && (
                  <button className="btn btn-sm sky-btn-ghost" disabled={loading} onClick={clearSorting} type="button">
                    Clear sorting
                  </button>
                )}
                <button className="btn btn-sm sky-btn-ghost" disabled={loading} onClick={resetFilters} type="button">
                  Clear filters
                </button>
              </div>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
            <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
              <thead>
                <tr>
                  {renderSortableHeader('Started', 'started')}
                  {renderSortableHeader('Domain / source', 'domainSource')}
                  {renderSortableHeader('Tool', 'tool')}
                  {renderSortableHeader('Trigger', 'trigger')}
                  {renderSortableHeader('Status', 'status')}
                  {renderSortableHeader('Assets', 'assets')}
                  {renderSortableHeader('Quality', 'quality')}
                  {renderSortableHeader('Rows', 'rows')}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="8"><div className="sky-empty-state">Loading ingestion runs...</div></td></tr>
                )}
                {!loading && visibleRuns.length === 0 && (
                  <tr><td colSpan="8"><div className="sky-empty-state">No ingestion runs matched these filters.</div></td></tr>
                )}
                {!loading && visibleRuns.map((run) => (
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
                      <div className="fw-bold">{run.domainCode}</div>
                      <div className="small sky-muted sky-mono">{run.sourceCode}</div>
                    </td>
                    <td>
                      <div className="fw-bold">{run.toolLabel || run.toolCode || '—'}</div>
                      <div className="small sky-muted sky-mono">{run.toolCode || '—'}</div>
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

          <div className="sky-pagination-row sky-canonical-operations-pagination-row">
            <div className="small sky-muted sky-canonical-operations-pagination-summary">
              Showing {rangeStart}–{rangeEnd} of {total} ingestion run(s)
            </div>
            <div
              className="sky-pagination-controls sky-canonical-operations-pagination-controls"
              aria-label="Ingestion operations pagination"
            >
              <button
                aria-label="First page"
                className="btn btn-sm sky-pagination-nav-button"
                disabled={safeCurrentPage <= 1 || loading}
                onClick={() => goToPage(1)}
                title="First page"
                type="button"
              >
                «
              </button>
              <button
                aria-label="Previous page"
                className="btn btn-sm sky-pagination-nav-button"
                disabled={safeCurrentPage <= 1 || loading}
                onClick={() => goToPage(safeCurrentPage - 1)}
                title="Previous page"
                type="button"
              >
                ‹
              </button>
              <label className="sky-pagination-select-label" htmlFor="ingestionOperationsPage">Page</label>
              <select
                className="form-select form-select-sm sky-form-control sky-pagination-select"
                disabled={loading}
                id="ingestionOperationsPage"
                onChange={(event) => goToPage(event.target.value)}
                value={safeCurrentPage}
              >
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                  <option key={page} value={page}>{page}</option>
                ))}
              </select>
              <span className="small sky-muted">of {pageCount}</span>
              <button
                aria-label="Next page"
                className="btn btn-sm sky-pagination-nav-button"
                disabled={safeCurrentPage >= pageCount || loading}
                onClick={() => goToPage(safeCurrentPage + 1)}
                title="Next page"
                type="button"
              >
                ›
              </button>
              <button
                aria-label="Last page"
                className="btn btn-sm sky-pagination-nav-button"
                disabled={safeCurrentPage >= pageCount || loading}
                onClick={() => goToPage(pageCount)}
                title="Last page"
                type="button"
              >
                »
              </button>
            </div>
            <div className="sky-canonical-rows-control">
              <label className="sky-pagination-select-label" htmlFor="ingestionOperationsRows">Rows</label>
              <select
                className="form-select form-select-sm sky-form-control sky-pagination-select sky-canonical-rows-select"
                disabled={loading}
                id="ingestionOperationsRows"
                onChange={(event) => changePageSize(event.target.value)}
                value={effectivePageSize}
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
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
