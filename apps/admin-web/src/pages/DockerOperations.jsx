import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import infrastructureService from '../services/infrastructureService.js';
import { getNextSortState, serializeSorts } from '../utils/tableSorting.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const PAGE_SIZE = 10;
const DOCKER_OPERATIONS_DEFAULT_SORTS = [{ field: 'requestedAt', direction: 'desc' }];
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

function getResourceDrilldown(item) {
  if (!item?.resourceType) return '';

  const params = new URLSearchParams();
  const resourceName = item.resourceName || '';

  if (item.resourceType === 'COMPOSE_PROJECT') {
    if (!resourceName) return '';
    params.set('q', resourceName);
    return `/docker/projects?${params.toString()}`;
  }

  if (item.resourceType === 'CONTAINER') {
    if (!resourceName) return '';
    params.set('q', resourceName);
    if (item.projectName) params.set('project', item.projectName);
    return `/docker/containers?${params.toString()}`;
  }

  if (item.resourceType === 'IMAGE') {
    if (!resourceName) return '';
    params.set('q', resourceName);
    return `/docker/images?${params.toString()}`;
  }

  if (item.resourceType === 'NETWORK') {
    if (!resourceName) return '';
    params.set('q', resourceName);
    return `/docker/networks?${params.toString()}`;
  }

  return '';
}

function DockerOperations() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sorts, setSorts] = useState(() => DOCKER_OPERATIONS_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const requestSequence = useRef(0);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, total);

  async function loadOperations(nextPage = page, nextFilters = appliedFilters, nextSorts = sorts) {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoading(true);
    setError('');

    try {
      const result = await infrastructureService.listDockerOperations({
        ...nextFilters,
        limit: PAGE_SIZE,
        offset: (nextPage - 1) * PAGE_SIZE,
        sort: serializeSorts(nextSorts),
      });
      if (requestId !== requestSequence.current) return;

      const resultTotal = Number(result.total || 0);
      const resultPageCount = Math.max(1, Math.ceil(resultTotal / PAGE_SIZE));

      if (resultTotal > 0 && nextPage > resultPageCount) {
        setPage(resultPageCount);
        await loadOperations(resultPageCount, nextFilters, nextSorts);
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
      loadOperations(1, filters, sorts);
    }, delay);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sorts]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  function goToPage(nextPage) {
    const normalized = Math.min(Math.max(Number(nextPage) || 1, 1), pageCount);
    loadOperations(normalized, appliedFilters, sorts);
  }

  function applySorting(nextSorts, customized) {
    setSorts(nextSorts);
    setSortingCustomized(customized);
    setPage(1);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: DOCKER_OPERATIONS_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(DOCKER_OPERATIONS_DEFAULT_SORTS, false);
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

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}


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
              {sortingCustomized && (
                <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                  Clear sorting
                </button>
              )}
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

        <div className="table-responsive sky-table-card sky-functional-history-table-card sky-docker-operations-table-card sky-canonical-operations-table-frame">
          <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
            <thead>
              <tr>
                {renderSortableHeader('Resource', 'resource')}
                {renderSortableHeader('Requested', 'requestedAt')}
                {renderSortableHeader('Project', 'project')}
                {renderSortableHeader('Type', 'type')}
                {renderSortableHeader('Action', 'action')}
                {renderSortableHeader('Result', 'result')}
                {renderSortableHeader('Actor', 'actor')}
                {renderSortableHeader('State', 'state')}
                {renderSortableHeader('Duration', 'durationMs')}
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
                items.map((item) => {
                  const resourceDrilldown = getResourceDrilldown(item);
                  return (
                    <tr className="sky-canonical-hover-row" key={item.auditEventId || item.operationId}>
                      <td>
                        {resourceDrilldown ? (
                          <Link
                            aria-label={`Open ${formatResourceType(item.resourceType)} ${item.resourceName || ''}`}
                            className="fw-semibold text-decoration-underline"
                            title={`Open ${formatResourceType(item.resourceType)} in Docker inventory`}
                            to={resourceDrilldown}
                          >
                            {item.resourceName || '—'}
                          </Link>
                        ) : (
                          <div className="fw-semibold">{item.resourceName || '—'}</div>
                        )}
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="sky-pagination-row sky-canonical-operations-pagination-row">
          <div className="small sky-muted sky-canonical-operations-pagination-summary">
            Showing {rangeStart}-{rangeEnd} of {total} Docker operation(s)
          </div>
          <div
            className="sky-pagination-controls sky-canonical-operations-pagination-controls"
            aria-label="Docker operations pagination"
          >
            <button aria-label="First page" className="btn btn-sm sky-pagination-nav-button" disabled={safePage <= 1 || loading} onClick={() => goToPage(1)} title="First page" type="button">«</button>
            <button aria-label="Previous page" className="btn btn-sm sky-pagination-nav-button" disabled={safePage <= 1 || loading} onClick={() => goToPage(safePage - 1)} title="Previous page" type="button">‹</button>
            <label className="sky-pagination-select-label" htmlFor="dockerOperationsPageSelect">Page</label>
            <select className="form-select form-select-sm sky-form-control sky-pagination-select" disabled={loading} id="dockerOperationsPageSelect" onChange={(event) => goToPage(event.target.value)} value={safePage}>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <option key={pageNumber} value={pageNumber}>{pageNumber}</option>
              ))}
            </select>
            <span className="small sky-muted">of {pageCount}</span>
            <button aria-label="Next page" className="btn btn-sm sky-pagination-nav-button" disabled={safePage >= pageCount || loading} onClick={() => goToPage(safePage + 1)} title="Next page" type="button">›</button>
            <button aria-label="Last page" className="btn btn-sm sky-pagination-nav-button" disabled={safePage >= pageCount || loading} onClick={() => goToPage(pageCount)} title="Last page" type="button">»</button>
          </div>
          <div className="sky-canonical-operations-pagination-balance" aria-hidden="true" />
        </div>
      </section>
    </>
  );
}

export default DockerOperations;
