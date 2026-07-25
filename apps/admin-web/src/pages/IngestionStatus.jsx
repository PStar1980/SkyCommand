import { useEffect, useState } from 'react';
import IngestionStatusVisuals from '../components/charts/IngestionStatusVisuals.jsx';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
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

const DEFAULT_INDICATOR_FILTERS = {
  source: '',
  status: '',
  active: 'true',
  q: '',
  limit: 50,
};

const DEFAULT_RECENT_FILTERS = {
  source: '',
  status: '',
  limit: 50,
};

function IngestionStatus() {
  const [summary, setSummary] = useState(null);
  const [sources, setSources] = useState([]);
  const [recentExecutions, setRecentExecutions] = useState([]);
  const [indicators, setIndicators] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_INDICATOR_FILTERS);
  const [recentFilters, setRecentFilters] = useState(DEFAULT_RECENT_FILTERS);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(true);
  const [indicatorLoading, setIndicatorLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadOverview({ quiet = false } = {}) {
    if (!quiet) {
      setOverviewLoading(true);
      setError('');
    }

    try {
      const result = await ingestionService.getStatusSummary({ recentLimit: 5 });
      setSummary(result);
      setSources(result.sources || []);
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load ingestion overview.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setOverviewLoading(false);
      }
    }
  }

  async function loadRecentExecutions(nextFilters = recentFilters, { quiet = false } = {}) {
    if (!quiet) {
      setRecentLoading(true);
      setError('');
    }

    try {
      const result = await ingestionService.listRecentExecutions(nextFilters);
      const resultItems = result.items || [];
      setRecentExecutions(resultItems);

      return {
        activeCount: resultItems.filter((item) =>
          ['STARTED', 'RUNNING', 'QUEUED'].includes(String(item.status || '').toUpperCase()),
        ).length,
      };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load recent ingestion executions.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setRecentLoading(false);
      }
    }
  }

  async function loadIndicators(nextFilters = filters, { quiet = false } = {}) {
    if (!quiet) {
      setIndicatorLoading(true);
      setError('');
    }

    try {
      const result = await ingestionService.listIndicatorStatuses(nextFilters);
      const nextIndicators = result.items || [];
      setIndicators(nextIndicators);

      return {
        activeCount: nextIndicators.filter((indicator) =>
          ['STALE', 'PROBLEM', 'NO_DATA', 'MISSING_TABLE', 'ERROR'].includes(
            String(indicator.status || '').toUpperCase(),
          ),
        ).length,
      };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load indicator statuses.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setIndicatorLoading(false);
      }
    }
  }

  async function refreshAll({ quiet = false } = {}) {
    const [, recentResult, indicatorResult] = await Promise.all([
      loadOverview({ quiet }),
      loadRecentExecutions(recentFilters, { quiet }),
      loadIndicators(filters, { quiet }),
    ]);

    setRefreshingAt(new Date());

    return {
      activeCount:
        Number(recentResult?.activeCount || 0) + Number(indicatorResult?.activeCount || 0),
    };
  }

  const pollingState = useSmartPolling({
    dependencies: [
      filters.source,
      filters.status,
      filters.active,
      filters.limit,
      recentFilters.source,
      recentFilters.status,
      recentFilters.limit,
    ],
    getDelay: ({ activeCount = 0, hidden = false } = {}) =>
      getSmartPollingDelay({
        activeCount,
        activeMs: SMART_POLLING_INTERVALS.ACTIVE,
        hidden,
        idleMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
      }),
    initialIntervalMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
    onPoll: () => refreshAll({ quiet: true }),
  });

  useEffect(() => {
    refreshAll();
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

  async function applyDashboardFilters(event) {
    event.preventDefault();
    await Promise.all([loadIndicators(filters), loadRecentExecutions(recentFilters)]);
  }

  async function resetDashboardFilters() {
    setFilters(DEFAULT_INDICATOR_FILTERS);
    setRecentFilters(DEFAULT_RECENT_FILTERS);
    await Promise.all([
      loadIndicators(DEFAULT_INDICATOR_FILTERS),
      loadRecentExecutions(DEFAULT_RECENT_FILTERS),
    ]);
  }

  const loading = overviewLoading || recentLoading || indicatorLoading;

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Pipeline watch items"
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => refreshAll()}
            pollingState={pollingState}
          />
        }
        kicker="Dashboards · Data"
        subtitle="Visualize source freshness, ingestion activity, and macro-pipeline health from one analytical surface."
        title="Data"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={applyDashboardFilters}>
        <DashboardFilterCard
          actions={
            <>
              <button className="btn sky-btn-primary" disabled={loading} type="submit">
                Apply filters
              </button>
              <button
                className="btn sky-btn-ghost"
                disabled={loading}
                onClick={resetDashboardFilters}
                type="button"
              >
                Reset
              </button>
            </>
          }
          meta={`${indicators.length} visible indicators · ${recentExecutions.length} recent ingestion runs`}
          title="Pipeline analytics filters"
        >
          <div>
            <label className="form-label" htmlFor="pipelineDashboardSourceFilter">
              Source
            </label>
            <select
              className="form-select sky-form-control"
              id="pipelineDashboardSourceFilter"
              onChange={(event) => {
                updateFilter('source', event.target.value);
                updateRecentFilter('source', event.target.value);
              }}
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
            <label className="form-label" htmlFor="pipelineDashboardStatusFilter">
              Indicator status
            </label>
            <select
              className="form-select sky-form-control"
              id="pipelineDashboardStatusFilter"
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
            <label className="form-label" htmlFor="pipelineDashboardActiveFilter">
              Active state
            </label>
            <select
              className="form-select sky-form-control"
              id="pipelineDashboardActiveFilter"
              onChange={(event) => updateFilter('active', event.target.value)}
              value={filters.active}
            >
              <option value="true">Active indicators</option>
              <option value="false">Inactive indicators</option>
              <option value="">All indicators</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="pipelineDashboardRecentStatusFilter">
              Run status
            </label>
            <select
              className="form-select sky-form-control"
              id="pipelineDashboardRecentStatusFilter"
              onChange={(event) => updateRecentFilter('status', event.target.value)}
              value={recentFilters.status}
            >
              {EXECUTION_STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="pipelineDashboardLimitFilter">
              Indicator limit
            </label>
            <select
              className="form-select sky-form-control"
              id="pipelineDashboardLimitFilter"
              onChange={(event) => updateFilter('limit', event.target.value)}
              value={filters.limit}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="pipelineDashboardRunLimitFilter">
              Run limit
            </label>
            <select
              className="form-select sky-form-control"
              id="pipelineDashboardRunLimitFilter"
              onChange={(event) => updateRecentFilter('limit', event.target.value)}
              value={recentFilters.limit}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </DashboardFilterCard>
      </form>

      <IngestionStatusVisuals
        indicators={indicators}
        recentExecutions={recentExecutions}
        sources={sources}
        summary={summary}
      />
    </>
  );
}

export default IngestionStatus;
