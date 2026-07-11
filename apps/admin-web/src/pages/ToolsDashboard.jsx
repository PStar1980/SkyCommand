import { useEffect, useMemo, useState } from 'react';
import ToolsHistoryVisuals from '../components/charts/ToolsHistoryVisuals.jsx';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import adminService from '../services/adminService';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'STARTED', label: 'Running / started' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function getCategoryName(execution) {
  return execution?.category || execution?.metadata?.categoryCode || 'Uncategorized';
}

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

function ToolsDashboard() {
  const [executions, setExecutions] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: '', category: '', limit: '200' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadExecutions(nextFilters = filters) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listScriptExecutions({
        status: nextFilters.status,
        limit: nextFilters.limit,
      });
      setExecutions(result.items || []);
      setTotal(result.total || 0);
      setRefreshingAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load tool analytics.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExecutions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryOptions = useMemo(() => {
    const names = [...new Set(executions.map(getCategoryName))].sort((a, b) => a.localeCompare(b));
    return names;
  }, [executions]);

  const filteredExecutions = useMemo(() => {
    if (!filters.category) {
      return executions;
    }

    return executions.filter((execution) => getCategoryName(execution) === filters.category);
  }, [executions, filters.category]);

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    loadExecutions(filters);
  }

  function resetFilters() {
    const nextFilters = { status: '', category: '', limit: '200' };
    setFilters(nextFilters);
    loadExecutions(nextFilters);
  }

  return (
    <>
      <PageHeader
        actions={(
          <>
            <button className="btn sky-btn-ghost" disabled={loading} onClick={() => loadExecutions()} type="button">
              {loading ? 'Refreshing...' : 'Refresh analytics'}
            </button>
            <div className="small sky-muted mt-2">Last refresh: {refreshingAt ? formatDate(refreshingAt) : '—'}</div>
          </>
        )}
        kicker="Dashboards · Tools"
        subtitle="Visualize tool execution quality, category load, usage concentration, and runtime pressure without changing the operational ledger."
        title="Tools Dashboard"
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
          meta={`Showing ${filteredExecutions.length} chart rows from ${executions.length} loaded · ${total} total matching server filter`}
          title="Tool analytics filters"
        >
          <div>
            <label className="form-label" htmlFor="toolsDashboardStatus">Status</label>
            <select
              className="form-select sky-form-control"
              id="toolsDashboardStatus"
              onChange={(event) => updateFilter('status', event.target.value)}
              value={filters.status}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="toolsDashboardCategory">Category</label>
            <select
              className="form-select sky-form-control"
              id="toolsDashboardCategory"
              onChange={(event) => updateFilter('category', event.target.value)}
              value={filters.category}
            >
              <option value="">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="toolsDashboardLimit">Recent window</label>
            <select
              className="form-select sky-form-control"
              id="toolsDashboardLimit"
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

      <ToolsHistoryVisuals executions={filteredExecutions} />
    </>
  );
}

export default ToolsDashboard;
