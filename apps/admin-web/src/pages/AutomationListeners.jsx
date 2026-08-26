import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import workerService from '../services/workerService';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';
import {
  getAvailableTablePageSizes,
  getPageForAbsoluteIndex,
  normalizeTablePageSize,
  SMART_TABLE_DEFAULT_PAGE_SIZE,
} from '../utils/tablePageSize.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const LISTENER_FETCH_LIMIT = 500;
const LISTENER_DEFAULT_SORTS = [{ field: 'listener', direction: 'asc' }];

const LISTENER_TYPE_OPTIONS = [
  { value: '', label: 'All listener types' },
  { value: 'FILE_DROP', label: 'File drop' },
  { value: 'DB_POLL', label: 'Database poll' },
  { value: 'WEBHOOK', label: 'Webhook' },
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

function normalizeStatus(value) {
  return String(value || 'UNKNOWN').toUpperCase();
}

function statusClass(status) {
  const normalized = normalizeStatus(status);

  if (normalized === 'SUCCESS' || normalized === 'CURRENT' || normalized === 'ENABLED') {
    return 'sky-pill-success';
  }

  if (normalized === 'FAILED' || normalized === 'ERROR') {
    return 'sky-pill-danger';
  }

  if (normalized === 'QUEUED' || normalized === 'STARTED' || normalized === 'WARNING') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function dotClass(status) {
  const normalized = normalizeStatus(status);

  if (normalized === 'CURRENT' || normalized === 'SUCCESS' || normalized === 'ENABLED') {
    return 'sky-status-dot-success';
  }

  if (normalized === 'ERROR' || normalized === 'FAILED') {
    return 'sky-status-dot-danger';
  }

  if (normalized === 'WARNING' || normalized === 'QUEUED' || normalized === 'STARTED') {
    return 'sky-status-dot-warning';
  }

  return 'sky-status-dot-info';
}

function getJsonPreview(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return '{}';
  }
}

function getListenerSortValue(listener, field) {
  if (field === 'listener') {
    return `${listener?.listenerName || ''} ${listener?.listenerCode || ''}`.trim();
  }

  if (field === 'type') {
    return listener?.listenerType || '';
  }

  if (field === 'tool') {
    return `${listener?.toolLabel || ''} ${listener?.toolCode || ''}`.trim();
  }

  if (field === 'status') {
    return listener?.enabled ? 1 : 0;
  }

  return listener?.[field] ?? '';
}

function buildStatCards(health, listeners = []) {
  const enabledCount = listeners.filter((listener) => listener.enabled).length;
  const disabledCount = listeners.length - enabledCount;

  return [
    {
      label: 'Automation status',
      value: health?.overallStatus || '—',
      help: health?.generatedAt
        ? `Generated ${formatDate(health.generatedAt)}`
        : 'Live worker rollup',
      status: health?.overallStatus,
    },
    {
      label: 'Active listeners',
      value: listeners.length,
      help: `${enabledCount} enabled / ${disabledCount} disabled`,
      status: listeners.length > 0 ? 'CURRENT' : 'INFO',
    },
    {
      label: 'Worker nodes',
      value: health?.nodes?.online ?? '—',
      help: `${health?.nodes?.total ?? 0} registered / ${health?.nodes?.error ?? 0} error`,
      status: Number(health?.nodes?.online || 0) > 0 ? 'CURRENT' : 'WARNING',
    },
    {
      label: 'Runtime',
      value: 'Reserved',
      help: 'Listener runtime remains staged for the next slice',
      status: 'INFO',
    },
  ];
}

function AutomationListeners() {
  const { hasPermission } = useAuth();
  const canChangeListeners = hasPermission('WORKER_LISTENER_CHANGE');

  const [health, setHealth] = useState(null);
  const [listeners, setListeners] = useState([]);
  const [listenerTotal, setListenerTotal] = useState(0);
  const [selectedListener, setSelectedListener] = useState(null);
  const [filters, setFilters] = useState({
    enabled: '',
    listenerType: '',
    q: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(SMART_TABLE_DEFAULT_PAGE_SIZE);
  const [sorts, setSorts] = useState(() => LISTENER_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const filterTimerRef = useRef(null);
  const browserCardRef = useRef(null);
  const requestIdRef = useRef(0);

  const statCards = useMemo(() => buildStatCards(health, listeners), [health, listeners]);
  const sortedListeners = useMemo(
    () => sortItemsBySorts(listeners, sorts, getListenerSortValue),
    [listeners, sorts],
  );
  const pageCount = Math.max(1, Math.ceil(sortedListeners.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const visibleListeners = useMemo(
    () => sortedListeners.slice(
      (safeCurrentPage - 1) * pageSize,
      safeCurrentPage * pageSize,
    ),
    [pageSize, safeCurrentPage, sortedListeners],
  );
  const pageSizeOptions = useMemo(
    () => getAvailableTablePageSizes(sortedListeners.length),
    [sortedListeners.length],
  );
  const rangeStart = visibleListeners.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const rangeEnd = rangeStart === 0 ? 0 : rangeStart + visibleListeners.length - 1;

  async function loadHealth() {
    const result = await workerService.getHealth();
    setHealth(result);
  }

  async function loadListeners(nextFilters = filters) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const nextItems = [];
    let total = 0;
    let offset = 0;

    do {
      const result = await workerService.listListeners({
        ...nextFilters,
        limit: LISTENER_FETCH_LIMIT,
        offset,
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      const batch = result.items || [];
      total = Number(result.total || 0);
      nextItems.push(...batch);
      offset += batch.length;

      if (batch.length === 0) {
        break;
      }
    } while (nextItems.length < total);

    const sortedNextItems = sortItemsBySorts(nextItems, sorts, getListenerSortValue);
    setListeners(nextItems);
    setListenerTotal(total);
    setSelectedListener((currentSelected) => {
      if (!currentSelected) {
        return sortedNextItems[0] || null;
      }

      return (
        nextItems.find((listener) => listener.listenerId === currentSelected.listenerId) ||
        sortedNextItems[0] ||
        null
      );
    });
  }

  async function refreshAll() {
    setLoading(true);
    setError('');

    try {
      await Promise.all([loadHealth(), loadListeners()]);
      setLastRefreshAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load active listeners.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      await refreshAll();

      if (!active) {
        return;
      }
    }

    loadInitialData();

    return () => {
      active = false;
      if (filterTimerRef.current) {
        window.clearTimeout(filterTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function queueFilterLoad(nextFilters, delayMs = 0) {
    if (filterTimerRef.current) {
      window.clearTimeout(filterTimerRef.current);
    }

    filterTimerRef.current = window.setTimeout(async () => {
      setError('');
      try {
        await loadListeners(nextFilters);
      } catch (loadError) {
        setError(loadError.message || 'Failed to load active listeners.');
      }
    }, delayMs);
  }

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };
    setFilters(nextFilters);
    setCurrentPage(1);
    queueFilterLoad(nextFilters, name === 'q' ? 250 : 0);
  }

  async function clearFilters() {
    if (filterTimerRef.current) {
      window.clearTimeout(filterTimerRef.current);
    }
    const nextFilters = { enabled: '', listenerType: '', q: '' };
    setFilters(nextFilters);
    setCurrentPage(1);
    setError('');
    try {
      await loadListeners(nextFilters);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load active listeners.');
    }
  }

  function applySorting(nextSorts, customized) {
    const sortedItems = sortItemsBySorts(listeners, nextSorts, getListenerSortValue);
    const selectedIndex = selectedListener?.listenerId
      ? sortedItems.findIndex((listener) => listener.listenerId === selectedListener.listenerId)
      : -1;
    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, pageSize) : 1);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: LISTENER_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
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
          <span className="sky-table-sort-indicator" aria-hidden="true">{activeSort ? directionIcon : '↕'}</span>
          {activeSort && <span className="sky-table-sort-priority" aria-hidden="true">{activeIndex + 1}</span>}
        </button>
      </th>
    );
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    setCurrentPage(nextPage);
    const firstItem = sortedListeners[(nextPage - 1) * pageSize];
    if (firstItem) {
      setSelectedListener(firstItem);
    }
  }

  function scrollBrowserToTop() {
    window.requestAnimationFrame(() => {
      browserCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function changePageSize(value) {
    const nextPageSize = Number(value);
    if (!pageSizeOptions.includes(nextPageSize) || nextPageSize === pageSize) {
      return;
    }

    const selectedIndex = selectedListener?.listenerId
      ? sortedListeners.findIndex((listener) => listener.listenerId === selectedListener.listenerId)
      : -1;
    setPageSize(nextPageSize);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, nextPageSize) : 1);
    scrollBrowserToTop();
  }

  useEffect(() => {
    const normalizedPageSize = normalizeTablePageSize(pageSize, sortedListeners.length);
    if (normalizedPageSize === pageSize) {
      return;
    }

    const selectedIndex = selectedListener?.listenerId
      ? sortedListeners.findIndex((listener) => listener.listenerId === selectedListener.listenerId)
      : -1;
    setPageSize(normalizedPageSize);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, normalizedPageSize) : 1);
  }, [pageSize, selectedListener?.listenerId, sortedListeners]);

  async function handleListenerStatus(listener, enabled) {
    if (!canChangeListeners) {
      setError('WORKER_LISTENER_CHANGE is required to change listener status.');
      return;
    }

    setActionLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await workerService.updateListenerStatus(listener.listenerId, enabled);
      setSelectedListener(result.listener || null);
      setNotice(`${enabled ? 'Enabled' : 'Disabled'} listener ${listener.listenerCode}.`);
      await Promise.all([loadHealth(), loadListeners()]);
    } catch (statusError) {
      setError(statusError.message || 'Failed to update listener status.');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Automation listeners</div>
          <h1 className="sky-page-title">Listeners</h1>
          <p className="sky-page-subtitle">
            Review active listener definitions for event-driven automation. Runtime execution is
            reserved for the next listener slice.
          </p>
        </div>
        <div className="text-md-end">
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={refreshAll}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh listeners'}
          </button>
          <div className="small sky-muted mt-2">
            Last refresh: {lastRefreshAt ? formatDate(lastRefreshAt) : '—'}
          </div>
        </div>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {notice && <DismissibleAlert tone="success">{notice}</DismissibleAlert>}

      <section className="sky-worker-hero mb-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className={`sky-status-dot ${dotClass(health?.overallStatus)}`} />
            <span className={`sky-pill ${statusClass(health?.overallStatus)}`}>
              {normalizeStatus(health?.overallStatus)}
            </span>
          </div>
          <h2 className="h4 mb-2">Active listener surface</h2>
          <p className="sky-muted mb-0">
            Active listeners {listenerTotal} · Nodes {health?.nodes?.online ?? 0} online · Runtime
            listener flag remains staged
          </p>
        </div>
      </section>

      <div className="row g-3 sky-automation-surface-row">
        {statCards.map((card) => (
          <div className="col-md-6 col-xl-3" key={card.label}>
            <section className="sky-card sky-stat-card sky-worker-stat-card">
              <div className="sky-card-body">
                <div className="d-flex align-items-start justify-content-between gap-2">
                  <div className="sky-page-kicker mb-0">{card.label}</div>
                  {card.status && <span className={`sky-status-dot ${dotClass(card.status)}`} />}
                </div>
                <div className="sky-stat-value sky-worker-stat-value">
                  {loading ? '—' : card.value}
                </div>
                <div className="sky-muted small">{card.help}</div>
              </div>
            </section>
          </div>
        ))}
      </div>

      <div className="row g-3 sky-automation-surface-row">
        <div className="col-xl-8">
          <section ref={browserCardRef} className="sky-card sky-table-card h-100 sky-table-browser-anchor">
            <div className="sky-card-header">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                  <h2 className="h5 mb-1">Active Listeners</h2>
                  <div className="small sky-muted">
                    Showing {rangeStart}–{rangeEnd} of {listenerTotal} active listener definition
                    {listenerTotal === 1 ? '' : 's'}.
                  </div>
                </div>
                <div className="sky-inline-filter-form">
                  <select
                    className="form-select form-select-sm sky-form-control"
                    onChange={(event) => updateFilter('enabled', event.target.value)}
                    value={filters.enabled}
                  >
                    <option value="">All states</option>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                  <select
                    className="form-select form-select-sm sky-form-control"
                    onChange={(event) => updateFilter('listenerType', event.target.value)}
                    value={filters.listenerType}
                  >
                    {LISTENER_TYPE_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-control form-control-sm sky-form-control"
                    onChange={(event) => updateFilter('q', event.target.value)}
                    placeholder="Search listeners"
                    type="search"
                    value={filters.q}
                  />
                  {sortingCustomized && (
                    <button className="btn btn-sm sky-btn-ghost" onClick={() => applySorting(LISTENER_DEFAULT_SORTS, false)} type="button">
                      Clear sorting
                    </button>
                  )}
                  <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">
                    Clear filters
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="sky-empty-state">
                <div className="spinner-border text-info" role="status" aria-label="Loading" />
                <div className="mt-3">Loading active listeners...</div>
              </div>
            ) : listeners.length === 0 ? (
              <div className="sky-empty-state">No active listeners configured yet.</div>
            ) : (
              <div className="table-responsive sky-canonical-operations-table-frame">
                <table className="table table-hover sky-table sky-canonical-operations-table align-middle mb-0">
                  <thead>
                    <tr>
                      {renderSortableHeader('Listener', 'listener')}
                      {renderSortableHeader('Type', 'type')}
                      {renderSortableHeader('Tool', 'tool')}
                      {renderSortableHeader('Status', 'status')}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleListeners.map((listener) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedListener?.listenerId === listener.listenerId
                            ? 'sky-selected-row'
                            : ''
                        }`}
                        key={listener.listenerId}
                        onClick={() => setSelectedListener(listener)}
                      >
                        <td>
                          <div className="fw-bold">{listener.listenerName}</div>
                          <div className="small sky-muted sky-mono">{listener.listenerCode}</div>
                        </td>
                        <td>{listener.listenerType}</td>
                        <td>
                          <div className="fw-bold">
                            {listener.toolLabel || listener.toolCode}
                          </div>
                          <div className="small sky-muted sky-mono">{listener.toolCode}</div>
                        </td>
                        <td>
                          <span
                            className={`sky-pill ${listener.enabled ? 'sky-pill-success' : 'sky-pill-info'}`}
                          >
                            {listener.enabled ? 'ENABLED' : 'DISABLED'}
                          </span>
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <button
                            className="btn btn-sm sky-btn-ghost"
                            disabled={!canChangeListeners || actionLoading}
                            onClick={() => handleListenerStatus(listener, !listener.enabled)}
                            type="button"
                          >
                            {listener.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="sky-pagination-row sky-canonical-operations-pagination-row">
              <div className="small sky-muted sky-canonical-operations-pagination-summary">
                Showing {rangeStart}–{rangeEnd} of {listenerTotal} listener definition{listenerTotal === 1 ? '' : 's'}
              </div>
              <div className="sky-pagination-controls sky-canonical-operations-pagination-controls" aria-label="Listener pagination">
                <button aria-label="First page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage <= 1} onClick={() => goToPage(1)} title="First page" type="button">«</button>
                <button aria-label="Previous page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage <= 1} onClick={() => goToPage(safeCurrentPage - 1)} title="Previous page" type="button">‹</button>
                <label className="sky-pagination-select-label" htmlFor="listenerPageSelect">Page</label>
                <select className="form-select form-select-sm sky-form-control sky-pagination-select" id="listenerPageSelect" onChange={(event) => goToPage(event.target.value)} value={safeCurrentPage}>
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                    <option key={pageNumber} value={pageNumber}>{pageNumber}</option>
                  ))}
                </select>
                <span className="small sky-muted">of {pageCount}</span>
                <button aria-label="Next page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage >= pageCount} onClick={() => goToPage(safeCurrentPage + 1)} title="Next page" type="button">›</button>
                <button aria-label="Last page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage >= pageCount} onClick={() => goToPage(pageCount)} title="Last page" type="button">»</button>
              </div>
              <div className="sky-canonical-rows-control">
                <label className="sky-pagination-select-label" htmlFor="listenerRowsSelect">Rows</label>
                <select className="form-select form-select-sm sky-form-control sky-pagination-select sky-canonical-rows-select" id="listenerRowsSelect" onChange={(event) => changePageSize(event.target.value)} value={pageSize}>
                  {pageSizeOptions.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </div>

        <div className="col-xl-4">
          <section className="sky-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-1">Listener detail</h2>
              <div className="small sky-muted">Selected active listener configuration.</div>
            </div>
            <div className="sky-card-body">
              {selectedListener ? (
                <>
                  <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
                    <div>
                      <div className="sky-page-kicker">{selectedListener.listenerType}</div>
                      <h3 className="h5 mb-1">{selectedListener.listenerName}</h3>
                      <div className="small sky-muted sky-mono">
                        {selectedListener.listenerCode}
                      </div>
                    </div>
                    <span
                      className={`sky-pill ${selectedListener.enabled ? 'sky-pill-success' : 'sky-pill-info'}`}
                    >
                      {selectedListener.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>

                  <dl className="row g-2">
                    <dt className="col-sm-5 sky-detail-label">Tool</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {selectedListener.toolLabel || selectedListener.toolCode}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Poll interval</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {selectedListener.pollIntervalSeconds}s
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Last checked</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {formatDate(selectedListener.lastCheckedAt)}
                    </dd>

                    <dt className="col-sm-5 sky-detail-label">Last event</dt>
                    <dd className="col-sm-7 sky-detail-value">
                      {formatDate(selectedListener.lastEventAt)}
                    </dd>
                  </dl>

                  <hr />
                  <div className="sky-page-kicker">Description</div>
                  <p className="sky-muted">{selectedListener.description || '—'}</p>

                  <div className="sky-page-kicker">Config</div>
                  <pre className="sky-code-block sky-worker-json-preview">
                    {getJsonPreview(selectedListener.config)}
                  </pre>

                  <div className="sky-page-kicker">Parameter template</div>
                  <pre className="sky-code-block sky-worker-json-preview">
                    {getJsonPreview(selectedListener.parametersTemplate)}
                  </pre>
                </>
              ) : (
                <div className="sky-empty-state">Select a listener to inspect it.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default AutomationListeners;
