import { useEffect, useMemo, useState } from 'react';
import WorkflowHistoryVisuals from '../components/charts/WorkflowHistoryVisuals.jsx';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import workflowService from '../services/workflowService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'CANCELED', label: 'Canceled' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'QUEUED', label: 'Queued' },
];

function isActiveRun(run) {
  const status = String(run?.status || '').toUpperCase();
  return status === 'RUNNING' || status === 'QUEUED';
}

function getWorkflowCode(run) {
  return (
    run?.workflowCode ||
    run?.workflowDefinitionCode ||
    run?.metadata?.workflowCode ||
    'unknown-workflow'
  );
}

function WorkflowsDashboard() {
  const [runs, setRuns] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: '', workflowCode: '', limit: '200' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadRuns(nextFilters = filters, { quiet = false } = {}) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      const result = await workflowService.listRuns({
        status: nextFilters.status,
        limit: nextFilters.limit,
      });
      const resultItems = result.items || [];
      setRuns(resultItems);
      setTotal(result.total || 0);
      setRefreshingAt(new Date());

      return { activeCount: resultItems.filter(isActiveRun).length };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load workflow analytics.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollingState = useSmartPolling({
    dependencies: [filters.status, filters.limit],
    getDelay: ({ activeCount = 0, hidden = false } = {}) =>
      getSmartPollingDelay({
        activeCount,
        activeMs: SMART_POLLING_INTERVALS.ACTIVE,
        hidden,
        idleMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
      }),
    initialIntervalMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
    onPoll: () => loadRuns(filters, { quiet: true }),
  });

  const workflowOptions = useMemo(() => {
    const names = [...new Set(runs.map(getWorkflowCode))].sort((a, b) => a.localeCompare(b));
    return names;
  }, [runs]);

  const filteredRuns = useMemo(() => {
    if (!filters.workflowCode) {
      return runs;
    }

    return runs.filter((run) => getWorkflowCode(run) === filters.workflowCode);
  }, [filters.workflowCode, runs]);

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    loadRuns(filters);
  }

  function resetFilters() {
    const nextFilters = { status: '', workflowCode: '', limit: '200' };
    setFilters(nextFilters);
    loadRuns(nextFilters);
  }

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Active runs"
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadRuns()}
            pollingState={pollingState}
          />
        }
        kicker="Dashboards · Workflows"
        subtitle="Inspect workflow run trends, outcomes, duration pressure, definition load, failure pressure, and runtime backend split."
        title="Workflows Dashboard"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <form onSubmit={applyFilters}>
        <DashboardFilterCard
          actions={
            <>
              <button className="btn sky-btn-primary" disabled={loading} type="submit">
                Apply filters
              </button>
              <button
                className="btn sky-btn-ghost"
                disabled={loading}
                onClick={resetFilters}
                type="button"
              >
                Reset
              </button>
            </>
          }
          meta={`Showing ${filteredRuns.length} chart rows from ${runs.length} loaded · ${total} total matching server filter`}
          title="Workflow analytics filters"
        >
          <div>
            <label className="form-label" htmlFor="workflowsDashboardStatus">
              Run status
            </label>
            <select
              className="form-select sky-form-control"
              id="workflowsDashboardStatus"
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
            <label className="form-label" htmlFor="workflowsDashboardDefinition">
              Workflow
            </label>
            <select
              className="form-select sky-form-control"
              id="workflowsDashboardDefinition"
              onChange={(event) => updateFilter('workflowCode', event.target.value)}
              value={filters.workflowCode}
            >
              <option value="">All workflows</option>
              {workflowOptions.map((workflowCode) => (
                <option key={workflowCode} value={workflowCode}>
                  {workflowCode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="workflowsDashboardLimit">
              Recent window
            </label>
            <select
              className="form-select sky-form-control"
              id="workflowsDashboardLimit"
              onChange={(event) => updateFilter('limit', event.target.value)}
              value={filters.limit}
            >
              <option value="50">50 runs</option>
              <option value="100">100 runs</option>
              <option value="200">200 runs</option>
              <option value="500">500 runs</option>
            </select>
          </div>
        </DashboardFilterCard>
      </form>

      <WorkflowHistoryVisuals runs={filteredRuns} />
    </>
  );
}

export default WorkflowsDashboard;
