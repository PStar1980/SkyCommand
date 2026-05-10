import { useEffect, useMemo, useState } from 'react';
import ingestionService from '../services/ingestionService';

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'FRED', label: 'FRED' },
  { value: 'BOC', label: 'Bank of Canada' },
  { value: 'STATCAN', label: 'Statistics Canada' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'CURRENT', label: 'Current' },
  { value: 'STALE', label: 'Stale' },
  { value: 'NO_DATA', label: 'No data' },
  { value: 'MISSING_TABLE', label: 'Missing table' },
  { value: 'ERROR', label: 'Error' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const EXECUTION_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'STARTED', label: 'Running / started' },
  { value: 'CANCELLED', label: 'Cancelled' },
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

function formatDateOnly(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(date);
}

function formatDuration(milliseconds) {
  if (milliseconds === undefined || milliseconds === null || milliseconds === '') {
    return '—';
  }

  const numberValue = Number(milliseconds);

  if (!Number.isFinite(numberValue)) {
    return '—';
  }

  if (numberValue < 1000) {
    return `${numberValue} ms`;
  }

  const totalSeconds = Math.round(numberValue / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${totalSeconds} s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
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

  if (
    normalizedStatus === 'CURRENT' ||
    normalizedStatus === 'SUCCESS' ||
    normalizedStatus === 'OK'
  ) {
    return 'sky-pill-success';
  }

  if (
    normalizedStatus === 'ERROR' ||
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'MISSING_TABLE'
  ) {
    return 'sky-pill-danger';
  }

  if (
    normalizedStatus === 'WARNING' ||
    normalizedStatus === 'STALE' ||
    normalizedStatus === 'NO_DATA' ||
    normalizedStatus === 'STARTED' ||
    normalizedStatus === 'RUNNING'
  ) {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function statusDotClass(status) {
  const normalizedStatus = normalizeStatus(status);

  if (
    normalizedStatus === 'CURRENT' ||
    normalizedStatus === 'SUCCESS' ||
    normalizedStatus === 'OK'
  ) {
    return 'sky-status-dot-success';
  }

  if (
    normalizedStatus === 'ERROR' ||
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'MISSING_TABLE'
  ) {
    return 'sky-status-dot-danger';
  }

  if (
    normalizedStatus === 'WARNING' ||
    normalizedStatus === 'STALE' ||
    normalizedStatus === 'NO_DATA' ||
    normalizedStatus === 'STARTED'
  ) {
    return 'sky-status-dot-warning';
  }

  return 'sky-status-dot-info';
}

function getExecutionLabel(status) {
  if (status === 'STARTED') {
    return 'RUNNING';
  }

  return status || 'UNKNOWN';
}

function getLatestDataDate(indicator) {
  return indicator?.stats?.maxDate || indicator?.latestDataDate || null;
}

function getRowCount(indicator) {
  return indicator?.stats?.totalRows;
}

function getSourceLabel(sourceCode, sources = []) {
  const source = sources.find((item) => item.source === sourceCode);
  return source?.label || sourceCode || '—';
}

function buildStatCards(summary) {
  return [
    {
      label: 'Overall status',
      value: summary?.overallStatus || '—',
      help: summary?.generatedAt
        ? `Generated ${formatDate(summary.generatedAt)}`
        : 'Live health rollup',
      status: summary?.overallStatus,
    },
    {
      label: 'Sources',
      value: summary?.sourceCount ?? '—',
      help: 'Configured ingestion providers',
    },
    {
      label: 'Indicators',
      value: summary?.totalIndicators ?? '—',
      help: `${summary?.activeIndicators ?? '—'} active / ${summary?.inactiveIndicators ?? '—'} inactive`,
    },
    {
      label: 'Current',
      value: summary?.currentIndicators ?? '—',
      help: 'Within frequency threshold',
      status: 'CURRENT',
    },
    {
      label: 'Stale',
      value: summary?.staleIndicators ?? '—',
      help: 'Past freshness threshold',
      status: summary?.staleIndicators > 0 ? 'STALE' : 'CURRENT',
    },
    {
      label: 'Problems',
      value:
        (summary?.noDataIndicators || 0) +
        (summary?.missingTableIndicators || 0) +
        (summary?.errorIndicators || 0),
      help: `${summary?.noDataIndicators ?? 0} no data / ${summary?.missingTableIndicators ?? 0} missing / ${summary?.errorIndicators ?? 0} errors`,
      status:
        (summary?.missingTableIndicators || 0) + (summary?.errorIndicators || 0) > 0
          ? 'ERROR'
          : (summary?.noDataIndicators || 0) > 0
            ? 'WARNING'
            : 'CURRENT',
    },
  ];
}

function IngestionStatus() {
  const [summary, setSummary] = useState(null);
  const [sources, setSources] = useState([]);
  const [recentExecutions, setRecentExecutions] = useState([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [indicators, setIndicators] = useState([]);
  const [indicatorTotal, setIndicatorTotal] = useState(0);
  const [selectedIndicator, setSelectedIndicator] = useState(null);
  const [filters, setFilters] = useState({
    source: '',
    status: '',
    active: 'true',
    q: '',
    limit: 50,
  });
  const [recentFilters, setRecentFilters] = useState({
    source: '',
    status: '',
    limit: 10,
  });
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(true);
  const [indicatorLoading, setIndicatorLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const statCards = useMemo(() => buildStatCards(summary), [summary]);

  async function loadOverview() {
    setOverviewLoading(true);
    setError('');

    try {
      const result = await ingestionService.getStatusSummary({ recentLimit: 5 });
      setSummary(result);
      setSources(result.sources || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load ingestion overview.');
    } finally {
      setOverviewLoading(false);
    }
  }

  async function loadRecentExecutions(nextFilters = recentFilters) {
    setRecentLoading(true);
    setError('');

    try {
      const result = await ingestionService.listRecentExecutions(nextFilters);
      setRecentExecutions(result.items || []);
      setRecentTotal(result.total || 0);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load recent ingestion executions.');
    } finally {
      setRecentLoading(false);
    }
  }

  async function loadIndicators(
    nextFilters = filters,
    preferredIndicatorCode = selectedIndicator?.indicatorCode,
  ) {
    setIndicatorLoading(true);
    setError('');

    try {
      const result = await ingestionService.listIndicatorStatuses(nextFilters);
      const nextIndicators = result.items || [];
      setIndicators(nextIndicators);
      setIndicatorTotal(result.total || 0);

      if (nextIndicators.length === 0) {
        setSelectedIndicator(null);
        return;
      }

      const selectedStillVisible = nextIndicators.find(
        (indicator) => indicator.indicatorCode === preferredIndicatorCode,
      );
      setSelectedIndicator(selectedStillVisible || nextIndicators[0]);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load indicator statuses.');
    } finally {
      setIndicatorLoading(false);
    }
  }

  async function loadSelectedIndicator(indicatorCode) {
    if (!indicatorCode) {
      setSelectedIndicator(null);
      return;
    }

    setDetailLoading(true);
    setError('');

    try {
      const result = await ingestionService.getIndicatorStatus(indicatorCode);
      setSelectedIndicator(result.indicator || null);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load indicator detail.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadOverview(), loadRecentExecutions(), loadIndicators()]);
  }

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      try {
        await Promise.all([loadOverview(), loadRecentExecutions(), loadIndicators()]);
      } finally {
        if (!active) {
          return;
        }
      }
    }

    loadInitialData();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  function updateRecentFilter(name, value) {
    setRecentFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  async function applyIndicatorFilters(event) {
    event.preventDefault();
    await loadIndicators(filters);
  }

  async function applyRecentFilters(event) {
    event.preventDefault();
    await loadRecentExecutions(recentFilters);
  }

  async function clearIndicatorFilters() {
    const nextFilters = {
      source: '',
      status: '',
      active: 'true',
      q: '',
      limit: 50,
    };

    setFilters(nextFilters);
    await loadIndicators(nextFilters);
  }

  async function handleSourceSelect(sourceCode) {
    const nextIndicatorFilters = {
      ...filters,
      source: sourceCode,
    };
    const nextRecentFilters = {
      ...recentFilters,
      source: sourceCode,
    };

    setFilters(nextIndicatorFilters);
    setRecentFilters(nextRecentFilters);
    await Promise.all([
      loadIndicators(nextIndicatorFilters),
      loadRecentExecutions(nextRecentFilters),
    ]);
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Pipeline health</div>
          <h1 className="sky-page-title">Ingestion Status</h1>
          <p className="sky-page-subtitle">
            Monitor source freshness, recent ingestion runs, and indicator-level data health across
            the macro pipeline.
          </p>
        </div>
        <button
          className="btn sky-btn-ghost"
          disabled={overviewLoading || recentLoading || indicatorLoading}
          onClick={refreshAll}
          type="button"
        >
          {overviewLoading || recentLoading || indicatorLoading ? 'Refreshing...' : 'Refresh all'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3">
        {statCards.map((card) => (
          <div className="col-md-6 col-xl-2" key={card.label}>
            <section className="sky-card sky-stat-card sky-ingestion-stat-card">
              <div className="sky-card-body">
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <div className="sky-page-kicker mb-0">{card.label}</div>
                  {card.status && (
                    <span className={`sky-status-dot ${statusDotClass(card.status)}`} />
                  )}
                </div>
                <div className="sky-stat-value">{overviewLoading ? '—' : card.value}</div>
                <div className="sky-muted small">{card.help}</div>
              </div>
            </section>
          </div>
        ))}
      </div>

      <section className="sky-card mt-4">
        <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h2 className="h5 mb-1">Source health</h2>
            <div className="small sky-muted">
              Click a source to filter indicators and recent executions.
            </div>
          </div>
          <button
            className="btn btn-sm sky-btn-ghost"
            onClick={() => handleSourceSelect('')}
            type="button"
          >
            Clear source filter
          </button>
        </div>

        <div className="sky-card-body">
          {overviewLoading ? (
            <div className="sky-empty-state">Loading source health...</div>
          ) : (
            <div className="row g-3">
              {sources.map((source) => (
                <div className="col-lg-4" key={source.source}>
                  <button
                    className={`sky-source-card ${filters.source === source.source ? 'active' : ''}`}
                    onClick={() => handleSourceSelect(source.source)}
                    type="button"
                  >
                    <div className="d-flex align-items-start justify-content-between gap-3">
                      <div>
                        <div className="sky-page-kicker mb-1">{source.source}</div>
                        <h3 className="h5 mb-1">{source.label}</h3>
                        <div className="small sky-muted">{source.provider}</div>
                      </div>
                      <span className={`sky-pill ${statusClass(source.status)}`}>
                        {source.status || 'UNKNOWN'}
                      </span>
                    </div>

                    <p className="small sky-muted mt-3 mb-3">{source.description}</p>

                    <div className="sky-mini-stat-grid">
                      <div>
                        <div className="sky-detail-label small">Current</div>
                        <div className="sky-detail-value fw-bold">
                          {source.counts?.current ?? 0}
                        </div>
                      </div>
                      <div>
                        <div className="sky-detail-label small">Stale</div>
                        <div className="sky-detail-value fw-bold">{source.counts?.stale ?? 0}</div>
                      </div>
                      <div>
                        <div className="sky-detail-label small">Active</div>
                        <div className="sky-detail-value fw-bold">{source.counts?.active ?? 0}</div>
                      </div>
                    </div>

                    <hr />

                    <dl className="row g-2 mb-0 small">
                      <dt className="col-5 sky-detail-label">Latest data</dt>
                      <dd className="col-7 sky-detail-value text-end">
                        {formatDateOnly(source.latestDataDate)}
                      </dd>

                      <dt className="col-5 sky-detail-label">Days old</dt>
                      <dd className="col-7 sky-detail-value text-end">
                        {source.daysSinceLatestData ?? '—'}
                      </dd>

                      <dt className="col-5 sky-detail-label">Last run</dt>
                      <dd className="col-7 sky-detail-value text-end">
                        {source.latestExecution?.status ? (
                          <span
                            className={`sky-pill ${statusClass(source.latestExecution.status)}`}
                          >
                            {getExecutionLabel(source.latestExecution.status)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </dl>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="row g-3 mt-1">
        <div className="col-xl-8">
          <section className="sky-card">
            <div className="sky-card-header">
              <h2 className="h5 mb-1">Indicator freshness</h2>
              <div className="small sky-muted">
                Showing {indicators.length} of {indicatorTotal} indicator status record
                {indicatorTotal === 1 ? '' : 's'}.
              </div>
            </div>

            <div className="sky-card-body border-bottom border-secondary border-opacity-25">
              <form onSubmit={applyIndicatorFilters}>
                <div className="row g-3 align-items-end">
                  <div className="col-md-3">
                    <label className="form-label" htmlFor="indicatorSourceFilter">
                      Source
                    </label>
                    <select
                      className="form-select sky-form-control"
                      id="indicatorSourceFilter"
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

                  <div className="col-md-3">
                    <label className="form-label" htmlFor="indicatorStatusFilter">
                      Status
                    </label>
                    <select
                      className="form-select sky-form-control"
                      id="indicatorStatusFilter"
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

                  <div className="col-md-2">
                    <label className="form-label" htmlFor="indicatorActiveFilter">
                      Active
                    </label>
                    <select
                      className="form-select sky-form-control"
                      id="indicatorActiveFilter"
                      onChange={(event) => updateFilter('active', event.target.value)}
                      value={filters.active}
                    >
                      <option value="">All</option>
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>

                  <div className="col-md-2">
                    <label className="form-label" htmlFor="indicatorLimitFilter">
                      Limit
                    </label>
                    <select
                      className="form-select sky-form-control"
                      id="indicatorLimitFilter"
                      onChange={(event) => updateFilter('limit', event.target.value)}
                      value={filters.limit}
                    >
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="200">200</option>
                    </select>
                  </div>

                  <div className="col-md-2 d-flex gap-2">
                    <button
                      className="btn sky-btn-primary flex-grow-1"
                      disabled={indicatorLoading}
                      type="submit"
                    >
                      Apply
                    </button>
                    <button
                      className="btn sky-btn-ghost"
                      disabled={indicatorLoading}
                      onClick={clearIndicatorFilters}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="col-12">
                    <label className="form-label" htmlFor="indicatorSearchFilter">
                      Search
                    </label>
                    <input
                      className="form-control sky-form-control"
                      id="indicatorSearchFilter"
                      onChange={(event) => updateFilter('q', event.target.value)}
                      placeholder="Search indicator code, source, description, or frequency..."
                      type="search"
                      value={filters.q}
                    />
                  </div>
                </div>
              </form>
            </div>

            {indicatorLoading ? (
              <div className="sky-empty-state">
                <div className="spinner-border text-info" role="status" aria-label="Loading" />
                <div className="mt-3">Loading indicator statuses...</div>
              </div>
            ) : indicators.length === 0 ? (
              <div className="sky-empty-state">No indicators matched the current filters.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
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
                    {indicators.map((indicator) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedIndicator?.indicatorCode === indicator.indicatorCode
                            ? 'sky-selected-row'
                            : ''
                        }`}
                        key={indicator.indicatorCode}
                        onClick={() => loadSelectedIndicator(indicator.indicatorCode)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value sky-mono">
                            {indicator.indicatorCode}
                          </div>
                          <div className="small sky-muted sky-truncate">
                            {indicator.description || '—'}
                          </div>
                        </td>
                        <td>{indicator.source}</td>
                        <td>{indicator.frequency || '—'}</td>
                        <td>
                          <span className={`sky-pill ${statusClass(indicator.status)}`}>
                            {indicator.status || 'UNKNOWN'}
                          </span>
                        </td>
                        <td>{formatDateOnly(getLatestDataDate(indicator))}</td>
                        <td>{indicator.daysSinceLatestData ?? '—'}</td>
                        <td>{formatNumber(getRowCount(indicator))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-4">
          <section className="sky-card sky-sticky-detail-card">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <h2 className="h5 mb-0">Indicator detail</h2>
              {detailLoading && <span className="spinner-border spinner-border-sm text-info" />}
            </div>
            <div className="sky-card-body">
              {selectedIndicator ? (
                <>
                  <div className="d-flex align-items-start justify-content-between gap-3 mb-3">
                    <div>
                      <div className="sky-page-kicker mb-1">{selectedIndicator.source}</div>
                      <h3 className="h5 sky-mono mb-1">{selectedIndicator.indicatorCode}</h3>
                    </div>
                    <span className={`sky-pill ${statusClass(selectedIndicator.status)}`}>
                      {selectedIndicator.status || 'UNKNOWN'}
                    </span>
                  </div>

                  <p className="sky-muted">{selectedIndicator.description || 'No description.'}</p>

                  <dl className="row g-2">
                    <dt className="col-sm-5 sky-detail-label">Source</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {getSourceLabel(selectedIndicator.source, sources)}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Frequency</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {selectedIndicator.frequency || '—'}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Active</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {selectedIndicator.active ? 'Yes' : 'No'}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Threshold</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {selectedIndicator.freshnessThresholdDays ?? '—'} day(s)
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Days old</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {selectedIndicator.daysSinceLatestData ?? '—'}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Rows</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {formatNumber(selectedIndicator.stats?.totalRows)}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Min date</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {formatDateOnly(selectedIndicator.stats?.minDate)}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Max date</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {formatDateOnly(selectedIndicator.stats?.maxDate)}
                    </dd>
                  </dl>

                  <div className="sky-output-box mt-3">
                    <div className="sky-detail-label small mb-1">Status message</div>
                    <div className="sky-detail-value">{selectedIndicator.message || '—'}</div>
                  </div>
                </>
              ) : (
                <div className="sky-empty-state">Select an indicator to inspect its status.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="sky-card sky-table-card mt-4">
        <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div>
            <h2 className="h5 mb-1">Recent ingestion executions</h2>
            <div className="small sky-muted">
              Showing {recentExecutions.length} of {recentTotal} logged ingestion execution
              {recentTotal === 1 ? '' : 's'}.
            </div>
          </div>

          <form className="sky-inline-filter-form" onSubmit={applyRecentFilters}>
            <select
              aria-label="Recent execution source filter"
              className="form-select sky-form-control form-select-sm"
              onChange={(event) => updateRecentFilter('source', event.target.value)}
              value={recentFilters.source}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Recent execution status filter"
              className="form-select sky-form-control form-select-sm"
              onChange={(event) => updateRecentFilter('status', event.target.value)}
              value={recentFilters.status}
            >
              {EXECUTION_STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Recent execution limit filter"
              className="form-select sky-form-control form-select-sm"
              onChange={(event) => updateRecentFilter('limit', event.target.value)}
              value={recentFilters.limit}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>

            <button className="btn btn-sm sky-btn-primary" disabled={recentLoading} type="submit">
              Apply
            </button>
          </form>
        </div>

        {recentLoading ? (
          <div className="sky-empty-state">Loading recent ingestion executions...</div>
        ) : recentExecutions.length === 0 ? (
          <div className="sky-empty-state">
            No ingestion executions matched the current filters.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover sky-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Script</th>
                  <th>Status</th>
                  <th>User</th>
                  <th>Duration</th>
                  <th>Started</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {recentExecutions.map((execution) => (
                  <tr key={execution.executionId}>
                    <td>
                      <span className="sky-pill sky-pill-info">{execution.source || '—'}</span>
                    </td>
                    <td>
                      <div className="fw-bold sky-detail-value">{execution.scriptName || '—'}</div>
                      <div className="small sky-muted sky-truncate">
                        {execution.scriptFile || '—'}
                      </div>
                    </td>
                    <td>
                      <span className={`sky-pill ${statusClass(execution.status)}`}>
                        {getExecutionLabel(execution.status)}
                      </span>
                    </td>
                    <td>{execution.displayName || execution.email || '—'}</td>
                    <td>{formatDuration(execution.durationMs)}</td>
                    <td>{formatDate(execution.startedAt)}</td>
                    <td>
                      <div className="sky-truncate">{execution.summary || '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default IngestionStatus;
