import { useEffect, useMemo, useState } from 'react';
import WorkerHealthVisuals from '../components/charts/WorkerHealthVisuals.jsx';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import workflowService from '../services/workflowService';

const RUN_STATUS_OPTIONS = [
  { value: '', label: 'All run statuses' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'CANCELED', label: 'Canceled' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'QUEUED', label: 'Queued' },
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

function AutomationDashboard() {
  const [health, setHealth] = useState(null);
  const [runs, setRuns] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [filters, setFilters] = useState({ runStatus: '', approvalStatus: 'PENDING', limit: '120' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadAutomation(nextFilters = filters) {
    setLoading(true);
    setError('');

    try {
      const [healthResult, runsResult, approvalsResult] = await Promise.allSettled([
        workflowService.getWorkerHealth(),
        workflowService.listRuns({ status: nextFilters.runStatus, limit: nextFilters.limit }),
        workflowService.listApprovals({ status: nextFilters.approvalStatus, limit: 100 }),
      ]);

      if (healthResult.status === 'rejected') {
        throw healthResult.reason;
      }

      setHealth(healthResult.value);
      setRuns(runsResult.status === 'fulfilled' ? runsResult.value?.items || [] : []);
      setApprovals(approvalsResult.status === 'fulfilled' ? approvalsResult.value?.items || [] : []);
      setRefreshingAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load automation analytics.');
      setRuns([]);
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAutomation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = useMemo(() => {
    const heartbeatCount = health?.worker?.heartbeats?.length || 0;
    const pollerCount = health?.taskQueue?.pollerCount || 0;
    return `${heartbeatCount} worker heartbeat rows · ${pollerCount} poller(s) · ${runs.length} workflow runs · ${approvals.length} approval request(s)`;
  }, [approvals.length, health, runs.length]);

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    loadAutomation(filters);
  }

  function resetFilters() {
    const nextFilters = { runStatus: '', approvalStatus: 'PENDING', limit: '120' };
    setFilters(nextFilters);
    loadAutomation(nextFilters);
  }

  return (
    <>
      <PageHeader
        actions={(
          <>
            <button className="btn sky-btn-ghost" disabled={loading} onClick={() => loadAutomation()} type="button">
              {loading ? 'Refreshing...' : 'Refresh analytics'}
            </button>
            <div className="small sky-muted mt-2">Last refresh: {refreshingAt ? formatDate(refreshingAt) : '—'}</div>
          </>
        )}
        kicker="Dashboards · Automation"
        subtitle="Monitor worker heartbeats, poller coverage, workflow throughput, and approval gate pressure away from functional controls."
        title="Automation Dashboard"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={applyFilters}>
        <DashboardFilterCard
          actions={(
            <>
              <button className="btn sky-btn-primary" disabled={loading} type="submit">
                Apply filters
              </button>
              <button className="btn sky-btn-ghost" disabled={loading} onClick={resetFilters} type="button">
                Reset
              </button>
            </>
          )}
          meta={meta}
          title="Automation pulse filters"
        >
          <div>
            <label className="form-label" htmlFor="automationDashboardRunStatus">Run status</label>
            <select
              className="form-select sky-form-control"
              id="automationDashboardRunStatus"
              onChange={(event) => updateFilter('runStatus', event.target.value)}
              value={filters.runStatus}
            >
              {RUN_STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="automationDashboardApprovalStatus">Approval status</label>
            <select
              className="form-select sky-form-control"
              id="automationDashboardApprovalStatus"
              onChange={(event) => updateFilter('approvalStatus', event.target.value)}
              value={filters.approvalStatus}
            >
              <option value="PENDING">Pending approvals</option>
              <option value="APPROVED">Approved approvals</option>
              <option value="REJECTED">Rejected approvals</option>
              <option value="">All approvals</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="automationDashboardLimit">Run window</label>
            <select
              className="form-select sky-form-control"
              id="automationDashboardLimit"
              onChange={(event) => updateFilter('limit', event.target.value)}
              value={filters.limit}
            >
              <option value="60">60 runs</option>
              <option value="120">120 runs</option>
              <option value="250">250 runs</option>
            </select>
          </div>
        </DashboardFilterCard>
      </form>

      <WorkerHealthVisuals health={health || {}} pendingApprovals={approvals} runs={runs} />
    </>
  );
}

export default AutomationDashboard;
