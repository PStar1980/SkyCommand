import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import adminService from '../services/adminService';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';

const USER_HISTORY_PAGE_SIZE = 10;
const USER_HISTORY_FETCH_LIMIT = 200;
const USER_HISTORY_DEFAULT_SORTS = [{ field: 'created', direction: 'desc' }];
const DEFAULT_FILTERS = {
  success: '',
  user: '',
  role: '',
  privilege: '',
  appCode: '',
  from: '',
  to: '',
};

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getUserLabel(item = {}) {
  return item.userLabel || item.displayName || item.username || item.email || 'System';
}

function getLoginUserLabel(item = {}) {
  return (
    item.displayName ||
    item.username ||
    item.matchedUserEmail ||
    item.emailAttempted ||
    'Unknown user'
  );
}

function formatCodes(values = [], maxItems = null) {
  if (!Array.isArray(values) || values.length === 0) {
    return '—';
  }

  if (!maxItems || values.length <= maxItems) {
    return values.join(', ');
  }

  return `${values.slice(0, maxItems).join(', ')} +${values.length - maxItems}`;
}

function addOneDay(value) {
  if (!value) {
    return '';
  }

  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function getInitialState(searchParams) {
  const source = searchParams.get('source') === 'login' ? 'login' : 'audit';

  return {
    source,
    filters: {
      ...DEFAULT_FILTERS,
      success: searchParams.get('success') || '',
      user: searchParams.get('user') || searchParams.get('q') || '',
      role: searchParams.get('role') || '',
      privilege: searchParams.get('privilege') || '',
      appCode: searchParams.get('appCode') || '',
      from: searchParams.get('from') || '',
      to: searchParams.get('to') || '',
    },
  };
}

function getItemId(item, source) {
  return source === 'login' ? item?.loginEventId : item?.auditEventId;
}

function getHistorySortValue(item, field, source) {
  if (field === 'event') {
    return source === 'login'
      ? item?.success
        ? 'LOGIN_SUCCESS'
        : 'LOGIN_FAILED'
      : `${item?.eventType || ''} ${item?.resourceType || ''}`.trim();
  }
  if (field === 'action') return source === 'login' ? 'authenticate' : item?.action || '';
  if (field === 'user') return source === 'login' ? getLoginUserLabel(item) : getUserLabel(item);
  if (field === 'application') return `${item?.appTitle || ''} ${item?.appCode || ''}`.trim();
  if (field === 'reason') return item?.failureReason || null;
  if (field === 'role') return formatCodes(item?.roleCodes);
  if (field === 'privilege') return formatCodes(item?.privilegeCodes);
  if (field === 'result') return item?.success ? 1 : 0;
  if (field === 'created') {
    const timestamp = new Date(item?.createdAt || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return item?.[field] ?? '';
}

function AuditEvents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialState = getInitialState(searchParams);
  const [source, setSource] = useState(initialState.source);
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState(initialState.filters);
  const [currentPage, setCurrentPage] = useState(1);
  const [sorts, setSorts] = useState(() => USER_HISTORY_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const sortedItems = useMemo(
    () => sortItemsBySorts(items, sorts, (item, field) => getHistorySortValue(item, field, source)),
    [items, sorts, source],
  );
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / USER_HISTORY_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart =
    sortedItems.length === 0 ? 0 : (safeCurrentPage - 1) * USER_HISTORY_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * USER_HISTORY_PAGE_SIZE, sortedItems.length);
  const visibleItems = useMemo(
    () =>
      sortedItems.slice(
        (safeCurrentPage - 1) * USER_HISTORY_PAGE_SIZE,
        safeCurrentPage * USER_HISTORY_PAGE_SIZE,
      ),
    [safeCurrentPage, sortedItems],
  );
  const sourceLabel = source === 'login' ? 'login attempt' : 'user history event';

  function syncUrl(nextSource, nextFilters) {
    const nextParams = new URLSearchParams();

    if (nextSource === 'login') {
      nextParams.set('source', 'login');
    }

    Object.entries(nextFilters).forEach(([key, value]) => {
      if (!value) {
        return;
      }

      if (nextSource === 'audit' && key === 'appCode') {
        return;
      }

      if (nextSource === 'login' && ['role', 'privilege'].includes(key)) {
        return;
      }

      nextParams.set(key, value);
    });

    setSearchParams(nextParams, { replace: true });
  }

  async function fetchAllHistory(nextSource, nextFilters) {
    const allItems = [];
    let offset = 0;
    let totalCount = null;

    while (totalCount === null || allItems.length < totalCount) {
      const commonFilters = {
        success: nextFilters.success,
        from: nextFilters.from,
        to: addOneDay(nextFilters.to),
        limit: USER_HISTORY_FETCH_LIMIT,
        offset,
      };
      const result =
        nextSource === 'login'
          ? await adminService.listLoginEvents({
              ...commonFilters,
              appCode: nextFilters.appCode,
              q: nextFilters.user,
            })
          : await adminService.listAuditEvents({
              ...commonFilters,
              user: nextFilters.user,
              role: nextFilters.role,
              privilege: nextFilters.privilege,
            });
      const batch = result.items || [];
      totalCount = Number(result.total || 0);
      allItems.push(...batch);

      if (
        batch.length === 0 ||
        allItems.length >= totalCount ||
        batch.length < USER_HISTORY_FETCH_LIMIT
      ) {
        break;
      }

      offset += batch.length;
    }

    return allItems;
  }

  async function loadHistory(
    nextSource = source,
    nextFilters = filters,
    { keepSelection = true } = {},
  ) {
    setLoading(true);
    setError('');

    try {
      const resultItems = await fetchAllHistory(nextSource, nextFilters);
      const activeSorts = nextSource === source ? sorts : USER_HISTORY_DEFAULT_SORTS;
      const sortedResultItems = sortItemsBySorts(resultItems, activeSorts, (item, field) =>
        getHistorySortValue(item, field, nextSource),
      );
      const selectedId = keepSelection ? getItemId(selectedItem, nextSource) : null;
      const resolvedSelection =
        (selectedId
          ? resultItems.find((item) => getItemId(item, nextSource) === selectedId)
          : null) ||
        sortedResultItems[0] ||
        null;
      const resolvedSelectionId = getItemId(resolvedSelection, nextSource);
      const selectedIndex = resolvedSelectionId
        ? sortedResultItems.findIndex(
            (item) => getItemId(item, nextSource) === resolvedSelectionId,
          )
        : -1;

      setItems(resultItems);
      setSelectedItem(resolvedSelection);
      setCurrentPage(
        selectedIndex >= 0 ? Math.floor(selectedIndex / USER_HISTORY_PAGE_SIZE) + 1 : 1,
      );
    } catch (loadError) {
      setError(loadError.message || 'Failed to load user history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory(initialState.source, initialState.filters, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeSource(nextSource) {
    setSource(nextSource);
    setSorts(USER_HISTORY_DEFAULT_SORTS);
    setSortingCustomized(false);
    setCurrentPage(1);
    setSelectedItem(null);
    syncUrl(nextSource, filters);
    loadHistory(nextSource, filters, { keepSelection: false });
  }

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    syncUrl(source, nextFilters);
    loadHistory(source, nextFilters, { keepSelection: false });
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    syncUrl(source, DEFAULT_FILTERS);
    loadHistory(source, DEFAULT_FILTERS, { keepSelection: false });
  }

  function applySorting(nextSorts, customized) {
    const nextSortedItems = sortItemsBySorts(items, nextSorts, (item, field) =>
      getHistorySortValue(item, field, source),
    );
    const selectedId = getItemId(selectedItem, source);
    const selectedIndex = selectedId
      ? nextSortedItems.findIndex((item) => getItemId(item, source) === selectedId)
      : -1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(
      selectedIndex >= 0 ? Math.floor(selectedIndex / USER_HISTORY_PAGE_SIZE) + 1 : 1,
    );
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: USER_HISTORY_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(USER_HISTORY_DEFAULT_SORTS, false);
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

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    const firstItem = sortedItems[(nextPage - 1) * USER_HISTORY_PAGE_SIZE] || null;
    setCurrentPage(nextPage);
    setSelectedItem(firstItem);
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-canonical-operations-pagination-row">
        <div className="small sky-muted sky-canonical-operations-pagination-summary">
          Showing {rangeStart}-{rangeEnd} of {sortedItems.length} {sourceLabel}(s)
        </div>
        <div
          className="sky-pagination-controls sky-canonical-operations-pagination-controls"
          aria-label="User history pagination"
        >
          <button
            aria-label="First page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(1)}
            title="First page"
            type="button"
          >
            «
          </button>
          <button
            aria-label="Previous page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(safeCurrentPage - 1)}
            title="Previous page"
            type="button"
          >
            ‹
          </button>
          <label className="sky-pagination-select-label" htmlFor="userHistoryPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="userHistoryPageSelect"
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
            aria-label="Next page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(safeCurrentPage + 1)}
            title="Next page"
            type="button"
          >
            ›
          </button>
          <button
            aria-label="Last page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(pageCount)}
            title="Last page"
            type="button"
          >
            »
          </button>
        </div>
        <div className="sky-canonical-operations-pagination-balance" aria-hidden="true" />
      </div>
    );
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Access Control · User History</div>
          <h1 className="sky-page-title">User History</h1>
          <p className="sky-page-subtitle">
            Review login attempts, authorization decisions, and user-facing activity from one
            access-control history surface.
          </p>
        </div>
        <button
          className="btn sky-btn-ghost"
          disabled={loading}
          onClick={() => loadHistory(source, filters)}
          type="button"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <section className="sky-card sky-functional-history-browser sky-admin-user-history-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">User history browser</div>
            <h2 className="h5 mb-0">Access activity directory</h2>
            <p className="sky-muted small mb-0">
              Switch history sources, filter access activity, then select a row to inspect its
              evidence below.
            </p>
          </div>
          <div className="sky-admin-user-history-filter-grid">
            <div>
              <label className="form-label" htmlFor="historySourceFilter">
                History source
              </label>
              <select
                className="form-select sky-form-control"
                id="historySourceFilter"
                onChange={(event) => changeSource(event.target.value)}
                value={source}
              >
                <option value="audit">Audit events</option>
                <option value="login">Login attempts</option>
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="successFilter">
                Result
              </label>
              <select
                className="form-select sky-form-control"
                id="successFilter"
                onChange={(event) => updateFilter('success', event.target.value)}
                value={filters.success}
              >
                <option value="">All results</option>
                <option value="true">Success</option>
                <option value="false">Failed</option>
              </select>
            </div>

            <div className="sky-admin-user-history-user-filter">
              <label className="form-label" htmlFor="userFilter">
                User
              </label>
              <input
                className="form-control sky-form-control"
                id="userFilter"
                onChange={(event) => updateFilter('user', event.target.value)}
                placeholder="Name, username, or email"
                type="search"
                value={filters.user}
              />
            </div>

            {source === 'login' ? (
              <div>
                <label className="form-label" htmlFor="historyApplicationFilter">
                  Application
                </label>
                <input
                  className="form-control sky-form-control sky-mono"
                  id="historyApplicationFilter"
                  onChange={(event) => updateFilter('appCode', event.target.value.toUpperCase())}
                  placeholder="SKYSERVER_ADMIN"
                  value={filters.appCode}
                />
              </div>
            ) : (
              <div>
                <label className="form-label" htmlFor="roleFilter">
                  Role
                </label>
                <input
                  className="form-control sky-form-control sky-mono"
                  id="roleFilter"
                  onChange={(event) => updateFilter('role', event.target.value)}
                  placeholder="ADMIN"
                  type="search"
                  value={filters.role}
                />
              </div>
            )}

            {source === 'audit' && (
              <div>
                <label className="form-label" htmlFor="privilegeFilter">
                  Privilege
                </label>
                <input
                  className="form-control sky-form-control sky-mono"
                  id="privilegeFilter"
                  onChange={(event) => updateFilter('privilege', event.target.value)}
                  placeholder="WORKFLOW_RUN"
                  type="search"
                  value={filters.privilege}
                />
              </div>
            )}

            <div>
              <label className="form-label" htmlFor="historyFromFilter">
                From
              </label>
              <input
                className="form-control sky-form-control"
                id="historyFromFilter"
                onChange={(event) => updateFilter('from', event.target.value)}
                type="date"
                value={filters.from}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="historyToFilter">
                Through
              </label>
              <input
                className="form-control sky-form-control"
                id="historyToFilter"
                onChange={(event) => updateFilter('to', event.target.value)}
                type="date"
                value={filters.to}
              />
            </div>

            <div className="sky-admin-user-history-filter-actions">
              {sortingCustomized && (
                <button
                  className="btn btn-sm sky-btn-ghost"
                  disabled={loading}
                  onClick={clearSorting}
                  type="button"
                >
                  Clear sorting
                </button>
              )}
              <button
                className="btn btn-sm sky-btn-ghost"
                disabled={loading}
                onClick={clearFilters}
                type="button"
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
          <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
            <thead>
              <tr>
                {renderSortableHeader('Event', 'event')}
                {renderSortableHeader('Action', 'action')}
                {renderSortableHeader('User', 'user')}
                {source === 'login'
                  ? renderSortableHeader('Application', 'application')
                  : renderSortableHeader('Role', 'role')}
                {source === 'login'
                  ? renderSortableHeader('Reason', 'reason')
                  : renderSortableHeader('Privilege', 'privilege')}
                {renderSortableHeader('Result', 'result')}
                {renderSortableHeader('Created', 'created')}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7">
                    <div className="sky-empty-state py-4">
                      <div className="spinner-border text-info" role="status" aria-label="Loading" />
                    </div>
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td className="sky-empty-state" colSpan="7">
                    No {sourceLabel}s match the selected filters.
                  </td>
                </tr>
              ) : source === 'login' ? (
                visibleItems.map((item) => (
                  <tr
                    className={`sky-clickable-row ${
                      selectedItem?.loginEventId === item.loginEventId ? 'sky-selected-row' : ''
                    }`}
                    key={item.loginEventId}
                    onClick={() => setSelectedItem(item)}
                  >
                    <td>
                      <div className="fw-bold sky-detail-value">
                        {item.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED'}
                      </div>
                      <div className="small sky-muted">auth.login_events</div>
                    </td>
                    <td className="sky-mono small">authenticate</td>
                    <td>
                      <div className="fw-semibold sky-detail-value">{getLoginUserLabel(item)}</div>
                      {item.emailAttempted && item.emailAttempted !== getLoginUserLabel(item) && (
                        <div className="small sky-muted">{item.emailAttempted}</div>
                      )}
                    </td>
                    <td>
                      <div className="fw-semibold">{item.appTitle || item.appCode || '—'}</div>
                      <div className="small sky-muted sky-mono">{item.appCode || '—'}</div>
                    </td>
                    <td>{item.failureReason || '—'}</td>
                    <td>
                      <span
                        className={`sky-pill ${
                          item.success ? 'sky-pill-success' : 'sky-pill-danger'
                        }`}
                      >
                        {item.success ? 'SUCCESS' : 'FAILED'}
                      </span>
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                  </tr>
                ))
              ) : (
                visibleItems.map((item) => (
                  <tr
                    className={`sky-clickable-row ${
                      selectedItem?.auditEventId === item.auditEventId ? 'sky-selected-row' : ''
                    }`}
                    key={item.auditEventId}
                    onClick={() => setSelectedItem(item)}
                  >
                    <td>
                      <div className="fw-bold sky-detail-value">{item.eventType}</div>
                      <div className="small sky-muted">{item.resourceType || '—'}</div>
                    </td>
                    <td className="sky-mono small">{item.action}</td>
                    <td>
                      <div className="fw-semibold sky-detail-value">{getUserLabel(item)}</div>
                      {item.email && item.email !== getUserLabel(item) && (
                        <div className="small sky-muted">{item.email}</div>
                      )}
                    </td>
                    <td className="sky-mono small">{formatCodes(item.roleCodes)}</td>
                    <td className="sky-mono small">{formatCodes(item.privilegeCodes)}</td>
                    <td>
                      <span
                        className={`sky-pill ${
                          item.success ? 'sky-pill-success' : 'sky-pill-danger'
                        }`}
                      >
                        {item.success ? 'SUCCESS' : 'FAILED'}
                      </span>
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </section>

      <section className="sky-card sky-admin-user-history-detail-card">
        <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">
              {source === 'login' ? 'Login attempt detail' : 'User history detail'}
            </div>
            <h2 className="h5 mb-1">
              {selectedItem
                ? source === 'login'
                  ? getLoginUserLabel(selectedItem)
                  : getUserLabel(selectedItem)
                : 'Select an event'}
            </h2>
            <div className="small sky-muted">
              {selectedItem
                ? source === 'login'
                  ? selectedItem.appTitle || selectedItem.appCode || 'Authentication evidence'
                  : selectedItem.eventType || 'Authorization evidence'
                : `Select a ${sourceLabel} to inspect its evidence.`}
            </div>
          </div>
          {selectedItem && (
            <div className="d-flex flex-wrap gap-2">
              <span className={`sky-pill ${selectedItem.success ? 'sky-pill-success' : 'sky-pill-danger'}`}>
                {selectedItem.success ? 'SUCCESS' : 'FAILED'}
              </span>
              <span className="sky-pill sky-pill-info">
                {source === 'login' ? 'LOGIN' : 'AUDIT'}
              </span>
              <span className="sky-pill sky-pill-info">{formatDate(selectedItem.createdAt)}</span>
            </div>
          )}
        </div>

        <div className="sky-card-body sky-admin-user-history-detail-stack">
          {!selectedItem ? (
            <div className="sky-empty-state py-4">
              Select a {sourceLabel} to inspect its evidence.
            </div>
          ) : source === 'login' ? (
            <>
              <section className="sky-admin-user-history-detail-section">
                <div className="sky-admin-user-history-detail-section-header">
                  <div>
                    <h3 className="h6 mb-1">Identity &amp; outcome</h3>
                    <div className="small sky-muted">
                      Authentication identity, application, result, and lifecycle evidence.
                    </div>
                  </div>
                </div>
                <div className="sky-admin-user-history-detail-grid">
                  <dl className="sky-admin-user-history-detail-list">
                    <dt>Login ID</dt>
                    <dd className="sky-mono small">{selectedItem.loginEventId}</dd>
                    <dt>User</dt>
                    <dd>{getLoginUserLabel(selectedItem)}</dd>
                    <dt>Email attempted</dt>
                    <dd>{selectedItem.emailAttempted || '—'}</dd>
                    <dt>Application</dt>
                    <dd>{selectedItem.appTitle || selectedItem.appCode || '—'}</dd>
                  </dl>
                  <dl className="sky-admin-user-history-detail-list">
                    <dt>Result</dt>
                    <dd>{selectedItem.success ? 'SUCCESS' : 'FAILED'}</dd>
                    <dt>Reason</dt>
                    <dd>{selectedItem.failureReason || '—'}</dd>
                    <dt>Created</dt>
                    <dd>{formatDate(selectedItem.createdAt)}</dd>
                    <dt>IP address</dt>
                    <dd className="sky-mono small">{selectedItem.ipAddress || '—'}</dd>
                  </dl>
                </div>
              </section>

              <section className="sky-admin-user-history-detail-section">
                <div className="sky-admin-user-history-detail-section-header">
                  <div>
                    <h3 className="h6 mb-1">Client evidence</h3>
                    <div className="small sky-muted">
                      Raw client information captured with the authentication attempt.
                    </div>
                  </div>
                </div>
                <div className="sky-admin-user-history-evidence-grid">
                  <div>
                    <div className="sky-detail-label mb-2">User agent</div>
                    <pre className="sky-code-block mb-0">{selectedItem.userAgent || '—'}</pre>
                  </div>
                  <div>
                    <div className="sky-detail-label mb-2">Application code</div>
                    <pre className="sky-code-block mb-0">{selectedItem.appCode || '—'}</pre>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="sky-admin-user-history-detail-section">
                <div className="sky-admin-user-history-detail-section-header">
                  <div>
                    <h3 className="h6 mb-1">Authorization event</h3>
                    <div className="small sky-muted">
                      User, action, role, privilege, and event-outcome evidence.
                    </div>
                  </div>
                </div>
                <div className="sky-admin-user-history-detail-grid">
                  <dl className="sky-admin-user-history-detail-list">
                    <dt>Audit ID</dt>
                    <dd className="sky-mono small">{selectedItem.auditEventId}</dd>
                    <dt>Event</dt>
                    <dd>{selectedItem.eventType || '—'}</dd>
                    <dt>Resource</dt>
                    <dd className="sky-mono small">{selectedItem.resourceType || '—'}</dd>
                    <dt>Action</dt>
                    <dd className="sky-mono small">{selectedItem.action || '—'}</dd>
                  </dl>
                  <dl className="sky-admin-user-history-detail-list">
                    <dt>User</dt>
                    <dd>{getUserLabel(selectedItem)}</dd>
                    <dt>Roles</dt>
                    <dd className="sky-mono small">{formatCodes(selectedItem.roleCodes)}</dd>
                    <dt>Privileges</dt>
                    <dd className="sky-mono small">{formatCodes(selectedItem.privilegeCodes)}</dd>
                    <dt>Created</dt>
                    <dd>{formatDate(selectedItem.createdAt)}</dd>
                  </dl>
                </div>
                <div className="sky-admin-user-history-message-block">
                  <div className="sky-detail-label mb-2">Message</div>
                  <div className="sky-detail-value">{selectedItem.message || '—'}</div>
                </div>
              </section>

              <section className="sky-admin-user-history-detail-section">
                <div className="sky-admin-user-history-detail-section-header">
                  <div>
                    <h3 className="h6 mb-1">Authorization metadata</h3>
                    <div className="small sky-muted">
                      Raw event metadata and request-origin evidence retained for investigation.
                    </div>
                  </div>
                </div>
                <div className="sky-admin-user-history-evidence-grid">
                  <div>
                    <div className="sky-detail-label mb-2">Metadata</div>
                    <pre className="sky-code-block mb-0">
                      {JSON.stringify(selectedItem.metadata || {}, null, 2)}
                    </pre>
                  </div>
                  <dl className="sky-admin-user-history-detail-list sky-admin-user-history-origin-list">
                    <dt>IP address</dt>
                    <dd className="sky-mono small">{selectedItem.ipAddress || '—'}</dd>
                    <dt>Email</dt>
                    <dd>{selectedItem.email || '—'}</dd>
                    <dt>Result</dt>
                    <dd>{selectedItem.success ? 'SUCCESS' : 'FAILED'}</dd>
                  </dl>
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </>
  );
}

export default AuditEvents;
