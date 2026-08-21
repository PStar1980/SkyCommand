import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import infrastructureService from '../services/infrastructureService.js';

const PAGE_SIZE = 10;
const DEFAULT_FILTERS = {
  projectName: '',
  scope: '',
  action: '',
  success: '',
};

function formatDate(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDuration(value) {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)} s`;
}

function DockerOperations() {
  const { hasPermission } = useAuth();
  const canControl = hasPermission('INFRASTRUCTURE_DOCKER_CONTROL');
  const canCleanup = hasPermission('INFRASTRUCTURE_DOCKER_CLEANUP');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, total);

  async function loadOperations(nextPage = page, nextFilters = appliedFilters) {
    setLoading(true);
    setError('');

    try {
      const result = await infrastructureService.listDockerOperations({
        ...nextFilters,
        limit: PAGE_SIZE,
        offset: (nextPage - 1) * PAGE_SIZE,
      });
      const resultTotal = Number(result.total || 0);
      const resultPageCount = Math.max(1, Math.ceil(resultTotal / PAGE_SIZE));

      if (resultTotal > 0 && nextPage > resultPageCount) {
        setPage(resultPageCount);
        await loadOperations(resultPageCount, nextFilters);
        return;
      }

      setItems(result.items || []);
      setTotal(resultTotal);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Docker operations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOperations(1, DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(event) {
    event.preventDefault();
    setAppliedFilters(filters);
    setPage(1);
    loadOperations(1, filters);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
    loadOperations(1, DEFAULT_FILTERS);
  }

  function goToPage(nextPage) {
    const normalized = Math.min(Math.max(Number(nextPage) || 1, 1), pageCount);
    loadOperations(normalized, appliedFilters);
  }

  return (
    <>
      <PageHeader
        actions={
          <button
            className="btn btn-sm sky-btn-primary"
            disabled={loading}
            onClick={() => loadOperations()}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
        kicker="Docker · Governance"
        subtitle="Review SkyCommand-issued Compose, container, and guarded resource-cleanup actions separately from native Docker Engine telemetry."
        title="Docker Operations"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <Panel
        kicker="Control Plane Guardrail"
        subtitle="Docker writes require explicit permissions, browser confirmation, resources already discovered from Docker, and the host-native Host Agent. Cleanup uses a separate permission; persistent volumes and system networks remain protected."
        title="Lifecycle Control Policy"
      >
        <div className="sky-card-body">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <StatusPill label="Read inventory active" status="READY" />
            <StatusPill
              label={canControl ? 'Lifecycle controls enabled' : 'Lifecycle controls read only'}
              status={canControl ? 'READY' : 'INFO'}
            />
            <StatusPill label="Control-plane protected" status="BLOCKED" />
            <StatusPill
              label={canCleanup ? 'Guarded cleanup enabled' : 'Guarded cleanup read only'}
              status={canCleanup ? 'READY' : 'INFO'}
            />
            <StatusPill label="Persistent volumes protected" status="BLOCKED" />
          </div>
        </div>
      </Panel>

      <Panel title="Operation Filters">
        <form className="sky-card-body" onSubmit={applyFilters}>
          <div className="row g-3 align-items-end">
            <div className="col-12 col-lg-4">
              <label className="form-label" htmlFor="docker-operation-project">
                Project
              </label>
              <input
                className="form-control sky-form-control"
                id="docker-operation-project"
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  projectName: event.target.value,
                }))}
                placeholder="Exact Compose project name"
                value={filters.projectName}
              />
            </div>
            <div className="col-6 col-lg-2">
              <label className="form-label" htmlFor="docker-operation-scope">
                Scope
              </label>
              <select
                className="form-select sky-form-control"
                id="docker-operation-scope"
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  scope: event.target.value,
                }))}
                value={filters.scope}
              >
                <option value="">All</option>
                <option value="COMPOSE">Compose project</option>
                <option value="CONTAINER">Container</option>
                <option value="RESOURCE">Image / network cleanup</option>
              </select>
            </div>
            <div className="col-6 col-lg-2">
              <label className="form-label" htmlFor="docker-operation-action">
                Action
              </label>
              <select
                className="form-select sky-form-control"
                id="docker-operation-action"
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  action: event.target.value,
                }))}
                value={filters.action}
              >
                <option value="">All</option>
                <option value="START">Start</option>
                <option value="STOP">Stop</option>
                <option value="RESTART">Restart</option>
                <option value="PAUSE">Pause</option>
                <option value="UNPAUSE">Unpause</option>
                <option value="REMOVE">Remove</option>
              </select>
            </div>
            <div className="col-6 col-lg-2">
              <label className="form-label" htmlFor="docker-operation-status">
                Result
              </label>
              <select
                className="form-select sky-form-control"
                id="docker-operation-status"
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  success: event.target.value,
                }))}
                value={filters.success}
              >
                <option value="">All</option>
                <option value="true">Success</option>
                <option value="false">Failed</option>
              </select>
            </div>
            <div className="col-6 col-lg-2 d-flex gap-2">
              <button className="btn sky-btn-primary" disabled={loading} type="submit">
                Apply
              </button>
              <button
                className="btn sky-btn-ghost"
                disabled={loading}
                onClick={clearFilters}
                type="button"
              >
                Clear filters
              </button>
            </div>
          </div>
        </form>
      </Panel>

      <Panel title="Docker Operation History">
        <div className="table-responsive sky-table-card border-0 rounded-0">
          <table className="table table-sm table-hover sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Scope</th>
                <th>Resource</th>
                <th>Project</th>
                <th>Action</th>
                <th>Result</th>
                <th>Actor</th>
                <th>State</th>
                <th>Duration</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="sky-muted text-center py-4" colSpan={10}>
                    {loading ? 'Loading Docker operations…' : 'No Docker operations recorded.'}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.auditEventId || item.operationId}>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>
                      <StatusPill
                        label={item.resourceType === 'CONTAINER'
                          ? 'Container'
                          : item.resourceType === 'COMPOSE_PROJECT'
                            ? 'Compose'
                            : item.resourceType === 'IMAGE'
                              ? 'Image'
                              : item.resourceType === 'NETWORK'
                                ? 'Network'
                                : item.resourceType}
                        status={item.resourceType === 'COMPOSE_PROJECT' ? 'READY' : 'INFO'}
                      />
                    </td>
                    <td>
                      <div className="fw-semibold">{item.resourceName || '—'}</div>
                      {item.serviceName && <div className="small sky-muted">{item.serviceName}</div>}
                    </td>
                    <td>{item.projectName || '—'}</td>
                    <td>{item.action || '—'}</td>
                    <td>
                      <StatusPill status={item.status} />
                    </td>
                    <td>{item.actor || 'System'}</td>
                    <td>
                      {item.previousState || '—'}
                      {item.resultingState ? ` → ${item.resultingState}` : ''}
                    </td>
                    <td>{formatDuration(item.durationMs)}</td>
                    <td>
                      <div>{item.message || '—'}</div>
                      {item.errorCode && (
                        <div className="small sky-muted">{item.errorCode}</div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="sky-card-body d-flex flex-wrap justify-content-between align-items-center gap-2 border-top">
          <div className="small sky-muted">
            Showing {rangeStart}-{rangeEnd} of {total} operation(s)
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={safePage <= 1 || loading}
              onClick={() => goToPage(safePage - 1)}
              type="button"
            >
              Back
            </button>
            <span className="small sky-muted">
              Page {safePage} of {pageCount}
            </span>
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={safePage >= pageCount || loading}
              onClick={() => goToPage(safePage + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}

export default DockerOperations;
