import { useEffect, useMemo, useRef, useState } from 'react';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import ingestionService from '../services/ingestionService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';
import {
  getAvailableTablePageSizes,
  getPageForAbsoluteIndex,
  normalizeTablePageSize,
  SMART_TABLE_DEFAULT_PAGE_SIZE,
} from '../utils/tablePageSize.js';
const DATA_INTELLIGENCE_FETCH_LIMIT = 500;
const DATA_INTELLIGENCE_DEFAULT_SORTS = [{ field: 'indicator', direction: 'asc' }];

const DEFAULT_SOURCE_OPTIONS = [{ value: '', label: 'All sources' }];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'CURRENT', label: 'CURRENT' },
  { value: 'STALE', label: 'STALE' },
  { value: 'NO_DATA', label: 'NO DATA' },
  { value: 'MISSING_TABLE', label: 'MISSING TABLE' },
  { value: 'ERROR', label: 'ERROR' },
  { value: 'INACTIVE', label: 'INACTIVE' },
];

const DEFAULT_FILTERS = {
  source: '',
  status: '',
  active: 'true',
  q: '',
};

function formatDate(value, { dateOnly = false } = {}) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' }),
  }).format(date);
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? new Intl.NumberFormat().format(numberValue) : '—';
}

function normalizeStatus(status) {
  return String(status || 'UNKNOWN').toUpperCase();
}

function statusClass(status) {
  const normalizedStatus = normalizeStatus(status);

  if (['CURRENT', 'SUCCESS', 'OK'].includes(normalizedStatus)) {
    return 'sky-pill-success';
  }

  if (['ERROR', 'FAILED', 'MISSING_TABLE'].includes(normalizedStatus)) {
    return 'sky-pill-danger';
  }

  if (['WARNING', 'STALE', 'NO_DATA', 'STARTED', 'RUNNING'].includes(normalizedStatus)) {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function isWatchItem(indicator) {
  return ['STALE', 'PROBLEM', 'NO_DATA', 'MISSING_TABLE', 'ERROR'].includes(
    normalizeStatus(indicator?.status),
  );
}

function getLatestDataDate(indicator) {
  return indicator?.stats?.maxDate || indicator?.latestDataDate || null;
}

function getIndicatorSortValue(indicator, field) {
  if (field === 'indicator') return indicator?.indicatorCode || '';
  if (field === 'source') return indicator?.source || '';
  if (field === 'frequency') return indicator?.frequency || '';
  if (field === 'status') return normalizeStatus(indicator?.status);
  if (field === 'reason') return indicator?.freshness?.reasonCode || null;
  if (field === 'latestData') {
    const value = getLatestDataDate(indicator);
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (field === 'daysOld') {
    const value = Number(indicator?.daysSinceLatestData);
    return Number.isFinite(value) ? value : null;
  }
  if (field === 'rows') {
    const value = Number(indicator?.stats?.totalRows);
    return Number.isFinite(value) ? value : null;
  }
  return indicator?.[field] ?? '';
}

function DataStatus() {
  const [items, setItems] = useState([]);
  const [sourceOptions, setSourceOptions] = useState(DEFAULT_SOURCE_OPTIONS);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(SMART_TABLE_DEFAULT_PAGE_SIZE);
  const [sorts, setSorts] = useState(() => DATA_INTELLIGENCE_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);
  const indicatorRequestIdRef = useRef(0);
  const browserRef = useRef(null);

  const sortedItems = useMemo(
    () => sortItemsBySorts(items, sorts, getIndicatorSortValue),
    [items, sorts],
  );
  const pageSizeOptions = useMemo(
    () => getAvailableTablePageSizes(sortedItems.length),
    [sortedItems.length],
  );
  const effectivePageSize = normalizeTablePageSize(pageSize, sortedItems.length);
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / effectivePageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStart = (safeCurrentPage - 1) * effectivePageSize;
  const visibleItems = useMemo(
    () => sortedItems.slice(pageStart, pageStart + effectivePageSize),
    [effectivePageSize, pageStart, sortedItems],
  );
  const rangeStart = sortedItems.length === 0 || visibleItems.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = rangeStart === 0 ? 0 : rangeStart + visibleItems.length - 1;

  async function loadSourceOptions() {
    try {
      const result = await ingestionService.listSources();
      const nextOptions = (result.items || []).map((source) => ({
        value: source.source,
        label: source.label || source.source,
      }));
      setSourceOptions([...DEFAULT_SOURCE_OPTIONS, ...nextOptions]);
    } catch {
      setSourceOptions(DEFAULT_SOURCE_OPTIONS);
    }
  }

  async function loadIndicators(
    nextFilters = filters,
    nextPage = currentPage,
    { keepSelection = true, quiet = false, nextSorts = sorts } = {},
  ) {
    const requestId = indicatorRequestIdRef.current + 1;
    indicatorRequestIdRef.current = requestId;

    if (!quiet) {
      setLoading(true);
      setError('');
    }

    const requestedPage = Math.max(1, Number(nextPage) || 1);

    try {
      const nextItems = [];
      let nextTotal = 0;
      let offset = 0;

      do {
        const result = await ingestionService.listIndicatorStatuses({
          ...nextFilters,
          limit: DATA_INTELLIGENCE_FETCH_LIMIT,
          offset,
        });

        if (requestId !== indicatorRequestIdRef.current) {
          return { activeCount: 0 };
        }

        const batch = result.items || [];
        nextTotal = Number(result.total || 0);
        nextItems.push(...batch);
        offset += batch.length;

        if (batch.length === 0) {
          break;
        }
      } while (nextItems.length < nextTotal);

      const sortedNextItems = sortItemsBySorts(nextItems, nextSorts, getIndicatorSortValue);
      const nextPageSize = normalizeTablePageSize(pageSize, sortedNextItems.length);
      const currentId = keepSelection ? selectedItem?.indicatorCode : null;
      const nextSelected =
        sortedNextItems.find((indicator) => indicator.indicatorCode === currentId) ||
        sortedNextItems[0] ||
        null;
      const selectedIndex = nextSelected
        ? sortedNextItems.findIndex(
            (indicator) => indicator.indicatorCode === nextSelected.indicatorCode,
          )
        : -1;
      const selectedPage = selectedIndex >= 0
        ? getPageForAbsoluteIndex(selectedIndex, nextPageSize)
        : 1;
      const nextPageCount = Math.max(
        1,
        Math.ceil(sortedNextItems.length / nextPageSize),
      );
      const resolvedPage = keepSelection && selectedIndex >= 0
        ? selectedPage
        : Math.min(requestedPage, nextPageCount);

      setItems(nextItems);
      setTotal(nextItems.length);
      setPageSize(nextPageSize);
      setCurrentPage(resolvedPage);
      setRefreshingAt(new Date());
      setSelectedItem(nextSelected);

      return {
        activeCount: nextItems.filter(isWatchItem).length,
      };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load data intelligence records.');
      }
      throw loadError;
    } finally {
      if (!quiet && requestId === indicatorRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function selectIndicator(indicator) {
    setSelectedItem(indicator);
    setDetailLoading(true);

    try {
      const result = await ingestionService.getIndicatorStatus(indicator.indicatorCode);
      setSelectedItem(result.indicator || indicator);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load indicator detail.');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadSourceOptions();
    loadIndicators(DEFAULT_FILTERS, 1, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pageSize !== effectivePageSize) {
      setPageSize(effectivePageSize);
      setCurrentPage((page) => Math.min(page, Math.max(1, Math.ceil(sortedItems.length / effectivePageSize))));
    }
  }, [effectivePageSize, pageSize, sortedItems.length]);

  const pollingState = useSmartPolling({
    dependencies: [
      filters.source,
      filters.status,
      filters.active,
      filters.q,
      safeCurrentPage,
      selectedItem?.indicatorCode,
    ],
    getDelay: ({ activeCount = 0, hidden = false } = {}) =>
      getSmartPollingDelay({
        activeCount,
        activeMs: SMART_POLLING_INTERVALS.ACTIVE,
        hidden,
        idleMs: SMART_POLLING_INTERVALS.IDLE,
      }),
    initialIntervalMs: SMART_POLLING_INTERVALS.IDLE,
    onPoll: () =>
      loadIndicators(filters, safeCurrentPage, { keepSelection: true, quiet: true }),
  });

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    loadIndicators(nextFilters, 1, { keepSelection: false });
  }


  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    loadIndicators(DEFAULT_FILTERS, 1, { keepSelection: false });
  }

  function applySorting(nextSorts, customized) {
    const sorted = sortItemsBySorts(items, nextSorts, getIndicatorSortValue);
    const selectedIndex = selectedItem?.indicatorCode
      ? sorted.findIndex((indicator) => indicator.indicatorCode === selectedItem.indicatorCode)
      : -1;
    const nextPage = selectedIndex >= 0
      ? getPageForAbsoluteIndex(selectedIndex, effectivePageSize)
      : 1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(nextPage);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: DATA_INTELLIGENCE_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(DATA_INTELLIGENCE_DEFAULT_SORTS, false);
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

    const firstVisible = sortedItems[(nextPage - 1) * effectivePageSize];
    if (firstVisible && firstVisible.indicatorCode !== selectedItem?.indicatorCode) {
      selectIndicator(firstVisible);
    }
  }

  function changePageSize(value) {
    const nextPageSize = Number(value);

    if (!pageSizeOptions.includes(nextPageSize) || nextPageSize === effectivePageSize) {
      return;
    }

    const selectedIndex = selectedItem?.indicatorCode
      ? sortedItems.findIndex((indicator) => indicator.indicatorCode === selectedItem.indicatorCode)
      : -1;
    const nextPage = selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, nextPageSize) : 1;

    setPageSize(nextPageSize);
    setCurrentPage(nextPage);
    window.requestAnimationFrame(() => {
      browserRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-canonical-operations-pagination-row">
        <div className="small sky-muted sky-canonical-operations-pagination-summary">
          Showing {rangeStart}–{rangeEnd} of {total} indicator status record(s)
        </div>
        <div
          className="sky-pagination-controls sky-canonical-operations-pagination-controls"
          aria-label="Data intelligence pagination"
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
          <label className="sky-pagination-select-label" htmlFor="dataStatusPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="dataStatusPageSelect"
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
          <label className="sky-pagination-select-label" htmlFor="dataStatusRowsSelect">Rows</label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select sky-canonical-rows-select"
            disabled={loading}
            id="dataStatusRowsSelect"
            onChange={(event) => changePageSize(event.target.value)}
            value={effectivePageSize}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }


  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Data watch items"
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadIndicators(filters, safeCurrentPage)}
            pollingState={pollingState}
          />
        }
        kicker="Data · Indicators"
        subtitle="Inspect freshness, source coverage, and the evidence behind each data-health state."
        title="Indicators"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <div className="sky-functional-history-shell sky-data-status-shell">
        <section ref={browserRef} className="sky-card mb-4 sky-functional-history-browser sky-table-browser-anchor">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Indicator browser</div>
              <h2 className="h5 mb-0">Indicator freshness</h2>
              <p className="sky-muted small mb-0">
                Filter the data-health ledger, then inspect the selected indicator below.
              </p>
            </div>

            <div className="sky-data-status-filters">
              <div className="sky-data-status-search">
                <label className="form-label" htmlFor="dataStatusSearchFilter">Search</label>
                <input
                  className="form-control sky-form-control"
                  id="dataStatusSearchFilter"
                  onChange={(event) => updateFilter('q', event.target.value)}
                  placeholder="Indicator code or description..."
                  type="search"
                  value={filters.q}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="dataStatusSourceFilter">Source</label>
                <select
                  className="form-select sky-form-control"
                  id="dataStatusSourceFilter"
                  onChange={(event) => updateFilter('source', event.target.value)}
                  value={filters.source}
                >
                  {sourceOptions.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="dataStatusIndicatorFilter">Status</label>
                <select
                  className="form-select sky-form-control"
                  id="dataStatusIndicatorFilter"
                  onChange={(event) => updateFilter('status', event.target.value)}
                  value={filters.status}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="dataStatusActiveFilter">Active state</label>
                <select
                  className="form-select sky-form-control"
                  id="dataStatusActiveFilter"
                  onChange={(event) => updateFilter('active', event.target.value)}
                  value={filters.active}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                  <option value="">All</option>
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
                  {renderSortableHeader('Indicator', 'indicator')}
                  {renderSortableHeader('Source', 'source')}
                  {renderSortableHeader('Frequency', 'frequency')}
                  {renderSortableHeader('Status', 'status')}
                  {renderSortableHeader('Reason', 'reason')}
                  {renderSortableHeader('Latest data', 'latestData')}
                  {renderSortableHeader('Days old', 'daysOld')}
                  {renderSortableHeader('Rows', 'rows')}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="8">
                      <div className="sky-empty-state">Loading indicator freshness...</div>
                    </td>
                  </tr>
                )}
                {!loading && visibleItems.length === 0 && (
                  <tr>
                    <td colSpan="8">
                      <div className="sky-empty-state">
                        No indicator status records matched these filters.
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  visibleItems.map((indicator) => (
                    <tr
                      className={`sky-clickable-row ${
                        selectedItem?.indicatorCode === indicator.indicatorCode
                          ? 'sky-selected-row'
                          : ''
                      }`}
                      key={indicator.indicatorCode}
                      onClick={() => selectIndicator(indicator)}
                    >
                      <td>
                        <div className="fw-bold">
                          {indicator.indicatorCode}
                        </div>
                        <div className="small sky-muted sky-truncate">
                          {indicator.description || '—'}
                        </div>
                      </td>
                      <td>{indicator.source || '—'}</td>
                      <td>{indicator.frequency || '—'}</td>
                      <td>
                        <span className={`sky-pill ${statusClass(indicator.status)}`}>
                          {normalizeStatus(indicator.status)}
                        </span>
                      </td>
                      <td className="sky-mono">
                        {indicator.freshness?.reasonCode || '—'}
                      </td>
                      <td>{formatDate(getLatestDataDate(indicator), { dateOnly: true })}</td>
                      <td>{indicator.daysSinceLatestData ?? '—'}</td>
                      <td>{formatNumber(indicator.stats?.totalRows)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {renderPagination()}
        </section>

        <section className="sky-functional-history-detail-zone">
          <div className="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
            <div>
              <div className="sky-page-kicker">Selected indicator workspace</div>
              <h2 className="h5 mb-0">Indicator detail</h2>
            </div>
            <div className="small sky-muted">
              {detailLoading ? 'Refreshing selected indicator...' : 'Freshness evidence and coverage.'}
            </div>
          </div>

          <section className="sky-card sky-data-status-detail-card">
            <div className="sky-card-body">
              {selectedItem ? (
                <>
                  <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
                    <div>
                      <div className="sky-page-kicker mb-1">{selectedItem.source || 'Data'}</div>
                      <h3 className="h5 sky-mono mb-1">{selectedItem.indicatorCode}</h3>
                      <p className="sky-muted mb-0">
                        {selectedItem.description || 'No indicator description is configured.'}
                      </p>
                    </div>
                    <span className={`sky-pill ${statusClass(selectedItem.status)}`}>
                      {normalizeStatus(selectedItem.status)}
                    </span>
                  </div>

                  <div className="sky-data-status-detail-grid">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Latest data</div>
                      <div className="sky-detail-value">
                        {formatDate(getLatestDataDate(selectedItem), { dateOnly: true })}
                      </div>
                    </div>
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Days old</div>
                      <div className="sky-mini-metric-value">
                        {selectedItem.daysSinceLatestData ?? '—'}
                      </div>
                    </div>
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Expected latest</div>
                      <div className="sky-detail-value">
                        {formatDate(selectedItem.freshness?.expectedLatestDate, { dateOnly: true })}
                      </div>
                    </div>
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Rows</div>
                      <div className="sky-mini-metric-value">
                        {formatNumber(selectedItem.stats?.totalRows)}
                      </div>
                    </div>
                  </div>

                  <div className="sky-data-status-evidence-grid mt-3">
                    <dl className="row g-2 mb-0">
                      <dt className="col-sm-5 sky-detail-label">Frequency</dt>
                      <dd className="col-sm-7 sky-detail-value">
                        {selectedItem.frequency || '—'}
                      </dd>
                      <dt className="col-sm-5 sky-detail-label">Active</dt>
                      <dd className="col-sm-7 sky-detail-value">
                        {selectedItem.active ? 'Yes' : 'No'}
                      </dd>
                      <dt className="col-sm-5 sky-detail-label">Freshness reason</dt>
                      <dd className="col-sm-7 sky-detail-value sky-mono">
                        {selectedItem.freshness?.reasonCode || '—'}
                      </dd>
                      <dt className="col-sm-5 sky-detail-label">Source latest</dt>
                      <dd className="col-sm-7 sky-detail-value">
                        {formatDate(selectedItem.freshness?.sourceLatestDate, { dateOnly: true })}
                      </dd>
                      <dt className="col-sm-5 sky-detail-label">Policy</dt>
                      <dd className="col-sm-7 sky-detail-value">
                        {selectedItem.freshness?.policyOriginCode || '—'} · lag {selectedItem.freshness?.releaseLagDays ?? '—'}d · tolerance {selectedItem.freshness?.freshnessToleranceDays ?? '—'}d
                      </dd>
                      <dt className="col-sm-5 sky-detail-label">Minimum date</dt>
                      <dd className="col-sm-7 sky-detail-value">
                        {formatDate(selectedItem.stats?.minDate, { dateOnly: true })}
                      </dd>
                      <dt className="col-sm-5 sky-detail-label">Maximum date</dt>
                      <dd className="col-sm-7 sky-detail-value">
                        {formatDate(selectedItem.stats?.maxDate, { dateOnly: true })}
                      </dd>
                    </dl>
                    <div className="sky-output-box">
                      <div className="sky-detail-label small mb-1">Status evidence</div>
                      <div className="sky-detail-value">{selectedItem.message || '—'}</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="sky-empty-state">Select an indicator to inspect its status.</div>
              )}
            </div>
          </section>
        </section>
      </div>
    </>
  );
}

export default DataStatus;
