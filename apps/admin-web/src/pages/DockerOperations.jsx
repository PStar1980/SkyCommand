import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import infrastructureService from '../services/infrastructureService.js';

const PAGE_SIZE = 10;
const DEFAULT_FILTERS = {
  q: '',
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

function formatResourceType(resourceType) {
  if (resourceType === 'COMPOSE_PROJECT') return 'Project';
  if (resourceType === 'CONTAINER') return 'Container';
  if (resourceType === 'IMAGE') return 'Image';
  if (resourceType === 'NETWORK') return 'Network';
  return resourceType || '—';
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
  const requestSequence = useRef(0);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, total);

  async function loadOperations(nextPage = page, nextFilters = appliedFilters) {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoading(true);
    setError('');

    try {
      const result = await infrastructureService.listDockerOperations({
        ...nextFilters,
        limit: PAGE_SIZE,
        offset: (nextPage - 1) * PAGE_SIZE,
      });
      if (requestId !== requestSequence.current) return;

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
      if (requestId === requestSequence.current) {
        setError(loadError.message || 'Failed to load Docker operations.');
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const delay = filters.q ? 250 : 0;
    const timer = window.setTimeout(() => {
      setAppliedFilters(filters);
      setPage(1);
      loadOperations(1, filters);
    }, delay);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
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

      <section className="sky-card mb-4 sky-workflow-history-browser sky-docker-operations-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Operation browser</div>
            <h2 className="h5 mb-0">Docker operation history</h2>
            <p className="sky-muted small mb-0">
              Search and filter audited SkyCommand-issued Docker actions across Compose projects,
              containers, images, and networks.
            </p>
          </div>
          <div className="sky-history-browser-filter-grid sky-docker-operations-filter-grid">
            <div className="sky-run-tools-search-filter">
              <label className="form-label" htmlFor="dockerOperationSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="dockerOperationSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Resource, project, actor, action, message..."
                type="search"
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="dockerOperationScope">
                Scope
              </label>
              <select
                className="form-select sky-form-control"
                id="dockerOperationScope"
                onChange={(event) => updateFilter('scope', event.target.value)}
                value={filters.scope}
              >
                <option value="">All scopes</option>
                <option value="COMPOSE">Compose project</option>
                <option value="CONTAINER">Container</option>
                <option value="RESOURCE">Image / network cleanup</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="dockerOperationAction">
                Action
              </label>
              <select
                className="form-select sky-form-control"
                id="dockerOperationAction"
                onChange={(event) => updateFilter('action', event.target.value)}
                value={filters.action}
              >
                <option value="">All actions</option>
                <option value="START">Start</option>
                <option value="STOP">Stop</option>
                <option value="RESTART">Restart</option>
                <option value="PAUSE">Pause</option>
                <option value="UNPAUSE">Unpause</option>
                <option value="REMOVE">Remove</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="dockerOperationResult">
                Result
              </label>
              <select
                className="form-select sky-form-control"
                id="dockerOperationResult"
                onChange={(event) => updateFilter('success', event.target.value)}
                value={filters.success}
              >
                <option value="">All results</option>
                <option value="true">Success</option>
                <option value="false">Failed</option>
              </select>
            </div>
            <div className="sky-run-tools-filter-actions">
              <button
                className="btn btn-sm sky-btn-ghost"
                disabled={loading && total === 0}
                onClick={clearFilters}
                type="button"
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card sky-docker-operations-table-card">
          <table className="table table-sm table-hover sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Requested</th>
                <th>Project</th>
                <th>Type</th>
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
                  <td colSpan={10}>
                    <div className="sky-empty-state">
                      {loading
                        ? 'Loading Docker operations…'
                        : 'No Docker operations match the current filters.'}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.auditEventId || item.operationId}>
                    <td>
                      <div className="fw-semibold">{item.resourceName || '—'}</div>
                      {item.serviceName && <div className="small sky-muted">{item.serviceName}</div>}
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{item.projectName || '—'}</td>
                    <td>{formatResourceType(item.resourceType)}</td>
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

        <div className="sky-pagination-row">
          <div className="small sky-muted">
            Showing {rangeStart}-{rangeEnd} of {total} Docker operation(s)
          </div>
          <div className="sky-pagination-controls" aria-label="Docker operations pagination">
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={safePage <= 1 || loading}
              onClick={() => goToPage(1)}
              type="button"
            >
              First
            </button>
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={safePage <= 1 || loading}
              onClick={() => goToPage(safePage - 1)}
              type="button"
            >
              Back
            </button>
            <label className="sky-pagination-select-label" htmlFor="dockerOperationsPageSelect">
              Page
            </label>
            <select
              className="form-select form-select-sm sky-form-control sky-pagination-select"
              disabled={loading}
              id="dockerOperationsPageSelect"
              onChange={(event) => goToPage(event.target.value)}
              value={safePage}
            >
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <option key={pageNumber} value={pageNumber}>
                  {pageNumber}
                </option>
              ))}
            </select>
            <span className="small sky-muted">of {pageCount}</span>
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={safePage >= pageCount || loading}
              onClick={() => goToPage(safePage + 1)}
              type="button"
            >
              Next
            </button>
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={safePage >= pageCount || loading}
              onClick={() => goToPage(pageCount)}
              type="button"
            >
              Last
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

export default DockerOperations;
