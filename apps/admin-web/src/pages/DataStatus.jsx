import { useEffect, useState } from 'react';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import ingestionService from '../services/ingestionService';

const DATA_INTELLIGENCE_PAGE_SIZE = 10;

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'FRED', label: 'FRED' },
  { value: 'BOC', label: 'Bank of Canada' },
  { value: 'STATCAN', label: 'Statistics Canada' },
];

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

function DataStatus() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [draftSearch, setDraftSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  const pageCount = Math.max(1, Math.ceil(total / DATA_INTELLIGENCE_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart = total === 0 ? 0 : (safeCurrentPage - 1) * DATA_INTELLIGENCE_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * DATA_INTELLIGENCE_PAGE_SIZE, total);

  async function loadIndicators(
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
      const result = await ingestionService.listIndicatorStatuses({
        ...nextFilters,
        limit: DATA_INTELLIGENCE_PAGE_SIZE,
        offset: (safePage - 1) * DATA_INTELLIGENCE_PAGE_SIZE,
      });
      const nextItems = result.items || [];
      const nextTotal = Number(result.total || 0);
      const nextPageCount = Math.max(1, Math.ceil(nextTotal / DATA_INTELLIGENCE_PAGE_SIZE));

      if (nextTotal > 0 && safePage > nextPageCount) {
        setCurrentPage(nextPageCount);
        await loadIndicators(nextFilters, nextPageCount, { keepSelection: false, quiet });
        return { activeCount: 0 };
      }

      setItems(nextItems);
      setTotal(nextTotal);
      setCurrentPage(safePage);
      setRefreshingAt(new Date());
      setSelectedItem((currentSelected) => {
        if (!keepSelection || !currentSelected) {
          return nextItems[0] || null;
        }

        return (
          nextItems.find(
            (indicator) => indicator.indicatorCode === currentSelected.indicatorCode,
          ) ||
          nextItems[0] ||
          null
        );
      });

      return {
        activeCount: nextItems.filter(isWatchItem).length,
      };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load data intelligence records.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
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
    loadIndicators(DEFAULT_FILTERS, 1, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function applySearch(event) {
    event.preventDefault();
    const nextFilters = {
      ...filters,
      q: draftSearch.trim(),
    };

    setFilters(nextFilters);
    loadIndicators(nextFilters, 1, { keepSelection: false });
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setDraftSearch('');
    loadIndicators(DEFAULT_FILTERS, 1, { keepSelection: false });
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    loadIndicators(filters, nextPage, { keepSelection: false });
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {rangeStart}-{rangeEnd} of {total} indicator status record(s)
        </div>
        <div className="sky-pagination-controls" aria-label="Data intelligence pagination">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(1)}
            type="button"
          >
            First
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(safeCurrentPage - 1)}
            type="button"
          >
            Back
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
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(safeCurrentPage + 1)}
            type="button"
          >
            Next
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(pageCount)}
            type="button"
          >
            Last
          </button>
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
        kicker="Data · Intelligence"
        subtitle="Inspect indicator freshness, source coverage, and the evidence behind each macro data-health state."
        title="Data Intelligence"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="sky-functional-history-shell sky-data-status-shell">
        <section className="sky-card mb-4 sky-functional-history-browser">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Indicator browser</div>
              <h2 className="h5 mb-0">Indicator freshness</h2>
              <p className="sky-muted small mb-0">
                Filter the data-health ledger, then inspect the selected indicator below.
              </p>
            </div>

            <div className="sky-history-filter-grid sky-data-status-filters">
              <div>
                <label className="form-label" htmlFor="dataStatusSourceFilter">
                  Source
                </label>
                <select
                  className="form-select sky-form-control"
                  id="dataStatusSourceFilter"
                  onChange={(event) => updateFilter('source', event.target.value)}
                  value={filters.source}
                >
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="dataStatusIndicatorFilter">
                  Status
                </label>
                <select
                  className="form-select sky-form-control"
                  id="dataStatusIndicatorFilter"
                  onChange={(event) => updateFilter('status', event.target.value)}
                  value={filters.status}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="dataStatusActiveFilter">
                  Active state
                </label>
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
              <form className="sky-data-status-search" onSubmit={applySearch}>
                <label className="form-label" htmlFor="dataStatusSearchFilter">
                  Search
                </label>
                <div className="d-flex gap-2">
                  <input
                    className="form-control sky-form-control"
                    id="dataStatusSearchFilter"
                    onChange={(event) => setDraftSearch(event.target.value)}
                    placeholder="Indicator code or description..."
                    type="search"
                    value={draftSearch}
                  />
                  <button className="btn sky-btn-primary" disabled={loading} type="submit">
                    Apply
                  </button>
                  <button
                    className="btn sky-btn-ghost"
                    disabled={loading}
                    onClick={resetFilters}
                    type="button"
                  >
                    Reset
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card">
            <table className="table table-sm table-hover sky-table align-middle">
              <thead>
                <tr>
                  <th>Indicator</th>
                  <th>Source</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th>Latest data</th>
                  <th>Days old</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="7">
                      <div className="sky-empty-state">Loading indicator freshness...</div>
                    </td>
                  </tr>
                )}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan="7">
                      <div className="sky-empty-state">
                        No indicator status records matched these filters.
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  items.map((indicator) => (
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
                        <div className="fw-bold sky-detail-value sky-mono">
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
                      <div className="sky-page-kicker">Freshness threshold</div>
                      <div className="sky-detail-value">
                        {selectedItem.freshnessThresholdDays ?? '—'} day(s)
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
