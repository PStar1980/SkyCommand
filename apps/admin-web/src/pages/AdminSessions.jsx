import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';

const SESSION_PAGE_SIZE = 10;
const SESSION_FETCH_LIMIT = 200;
const SESSION_DEFAULT_SORTS = [{ field: 'lastSeen', direction: 'desc' }];
const SESSION_AGE_OPTIONS = [
  { value: '', label: 'All session ages' },
  { value: 'UNDER_15_MIN', label: 'Under 15 min' },
  { value: 'MIN_15_TO_60', label: '15–60 min' },
  { value: 'HOUR_1_TO_4', label: '1–4 hours' },
  { value: 'HOUR_4_TO_12', label: '4–12 hours' },
  { value: 'OVER_12_HOURS', label: 'Over 12 hours' },
];

const DEFAULT_FILTERS = {
  q: '',
  appCode: 'ALL',
  ageRange: '',
};

function getInitialSessionFilters(searchParams) {
  return {
    ...DEFAULT_FILTERS,
    q: searchParams.get('q') || '',
    appCode: searchParams.get('appCode') || 'ALL',
    ageRange: searchParams.get('ageRange') || '',
  };
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

function formatSeconds(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  const totalSeconds = Number(value);

  if (!Number.isFinite(totalSeconds)) {
    return '—';
  }

  if (totalSeconds <= 0) {
    return 'Expired';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  return `${minutes}m`;
}

function getShortId(value) {
  if (!value) {
    return '—';
  }

  return `${String(value).slice(0, 8)}…${String(value).slice(-6)}`;
}

function getUserAgentSummary(userAgent) {
  if (!userAgent) {
    return '—';
  }

  if (userAgent.includes('Edg/')) {
    return 'Microsoft Edge';
  }

  if (userAgent.includes('Chrome/')) {
    return 'Chrome';
  }

  if (userAgent.includes('Firefox/')) {
    return 'Firefox';
  }

  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) {
    return 'Safari';
  }

  return userAgent.split(' ')[0] || 'Unknown client';
}

function getExpiryClass(session) {
  const seconds = Number(session?.secondsUntilExpiry || 0);

  if (session?.isCurrentSession) {
    return 'sky-pill-info';
  }

  if (seconds > 0 && seconds <= 900) {
    return 'sky-pill-warning';
  }

  return 'sky-pill-success';
}

function formatApplicationLabel(application) {
  if (!application) {
    return 'Unknown app';
  }

  return application.title || application.appCode || 'Unknown app';
}

function getSessionSortValue(session, field) {
  if (field === 'user') {
    return `${session?.displayName || ''} ${session?.username || ''} ${session?.email || ''}`.trim();
  }

  if (field === 'application') {
    return `${session?.appTitle || ''} ${session?.appCode || ''}`.trim();
  }

  if (field === 'session') {
    return session?.sessionId || '';
  }

  if (field === 'client') {
    return `${getUserAgentSummary(session?.userAgent)} ${session?.ipAddress || ''}`.trim();
  }

  if (field === 'lastSeen') {
    const timestamp = Date.parse(session?.lastSeenAt || session?.createdAt || '');
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (field === 'expires') {
    const timestamp = Date.parse(session?.expiresAt || '');
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return session?.[field] ?? '';
}

function AdminSessions() {
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const initialFilters = getInitialSessionFilters(searchParams);
  const observedDate = searchParams.get('observedDate') || '';
  const canRevoke = hasPermission('ADMIN_USER_WRITE');
  const [applications, setApplications] = useState([]);
  const [filters, setFilters] = useState(() => initialFilters);
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [sorts, setSorts] = useState(() => SESSION_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [revokingSessionId, setRevokingSessionId] = useState(null);
  const initialLoadCompleteRef = useRef(false);

  const sortedSessions = useMemo(
    () => sortItemsBySorts(sessions, sorts, getSessionSortValue),
    [sessions, sorts],
  );
  const pageCount = Math.max(1, Math.ceil(sortedSessions.length / SESSION_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart =
    sortedSessions.length === 0 ? 0 : (safeCurrentPage - 1) * SESSION_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * SESSION_PAGE_SIZE, sortedSessions.length);
  const visibleSessions = useMemo(
    () =>
      sortedSessions.slice(
        (safeCurrentPage - 1) * SESSION_PAGE_SIZE,
        safeCurrentPage * SESSION_PAGE_SIZE,
      ),
    [safeCurrentPage, sortedSessions],
  );

  const selectedSession = useMemo(
    () => sessions.find((item) => item.sessionId === selectedSessionId) || sessions[0] || null,
    [selectedSessionId, sessions],
  );

  const stats = useMemo(() => {
    const userIds = new Set(sessions.map((item) => item.userId).filter(Boolean));
    const appCodes = new Set(sessions.map((item) => item.appCode).filter(Boolean));
    const expiringSoon = sessions.filter((item) => {
      const seconds = Number(item.secondsUntilExpiry || 0);
      return seconds > 0 && seconds <= 900;
    }).length;

    return {
      activeSessions: total,
      usersOnline: userIds.size,
      appSessions: appCodes.size,
      expiringSoon,
    };
  }, [sessions, total]);

  async function fetchAllSessions(nextFilters = filters) {
    const items = [];
    let offset = 0;
    let totalCount = 0;

    while (true) {
      const result = await adminService.listSessions({
        ...nextFilters,
        limit: SESSION_FETCH_LIMIT,
        offset,
      });
      const batch = result.items || [];
      totalCount = Number(result.total || 0);
      items.push(...batch);

      if (batch.length === 0 || items.length >= totalCount || batch.length < SESSION_FETCH_LIMIT) {
        break;
      }

      offset += batch.length;
    }

    return { items, total: totalCount };
  }

  async function loadSessions(nextFilters = filters, preferredSessionId = selectedSessionId) {
    setLoading(true);
    setError('');

    try {
      const result = await fetchAllSessions(nextFilters);
      const items = result.items || [];
      const sortedItems = sortItemsBySorts(items, sorts, getSessionSortValue);

      setSessions(items);
      setTotal(result.total || items.length);

      if (items.length === 0) {
        setCurrentPage(1);
        setSelectedSessionId(null);
        return;
      }

      const preferredVisible = items.some((item) => item.sessionId === preferredSessionId);
      const resolvedSessionId = preferredVisible
        ? preferredSessionId
        : sortedItems[0]?.sessionId || null;
      const selectedIndex = sortedItems.findIndex((item) => item.sessionId === resolvedSessionId);

      setSelectedSessionId(resolvedSessionId);
      setCurrentPage(selectedIndex >= 0 ? Math.floor(selectedIndex / SESSION_PAGE_SIZE) + 1 : 1);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load active sessions.');
    } finally {
      setLoading(false);
    }
  }

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
    setCurrentPage(1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setCurrentPage(1);
  }

  function applySorting(nextSorts, customized) {
    const nextSortedSessions = sortItemsBySorts(sessions, nextSorts, getSessionSortValue);
    const selectedIndex = selectedSessionId
      ? nextSortedSessions.findIndex((item) => item.sessionId === selectedSessionId)
      : -1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(selectedIndex >= 0 ? Math.floor(selectedIndex / SESSION_PAGE_SIZE) + 1 : 1);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: SESSION_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(SESSION_DEFAULT_SORTS, false);
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
    const nextPageStart = (nextPage - 1) * SESSION_PAGE_SIZE;
    const nextSession = sortedSessions[nextPageStart] || null;

    setCurrentPage(nextPage);
    if (nextSession) {
      setSelectedSessionId(nextSession.sessionId);
    }
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-canonical-operations-pagination-row">
        <div className="small sky-muted sky-canonical-operations-pagination-summary">
          Showing {rangeStart}-{rangeEnd} of {total} active session(s)
        </div>
        <div
          className="sky-pagination-controls sky-canonical-operations-pagination-controls"
          aria-label="Sessions pagination"
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
          <label className="sky-pagination-select-label" htmlFor="sessionsPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="sessionsPageSelect"
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

  async function revokeSession(sessionItem) {
    if (!sessionItem || sessionItem.isCurrentSession) {
      return;
    }

    const label = sessionItem.displayName || sessionItem.username || sessionItem.email;
    const appLabel = sessionItem.appTitle || sessionItem.appCode || 'selected app';
    const confirmed = window.confirm(`Revoke ${appLabel} session for ${label}?`);

    if (!confirmed) {
      return;
    }

    setRevokingSessionId(sessionItem.sessionId);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.revokeSession(sessionItem.sessionId, {
        reason: 'ADMIN_REVOKE_SESSION',
      });

      setSuccess(`Revoked ${result.revokedSessionCount || 0} active session(s) for ${label}.`);
      await loadSessions(filters, '');
    } catch (revokeError) {
      setError(revokeError.message || 'Failed to revoke session.');
    } finally {
      setRevokingSessionId(null);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      setLoading(true);
      setError('');

      try {
        const [applicationsResult, sessionsResult] = await Promise.all([
          adminService.listApplications({ active: true, limit: 200 }),
          fetchAllSessions(initialFilters),
        ]);

        if (!active) {
          return;
        }

        const items = sessionsResult.items || [];
        const sortedItems = sortItemsBySorts(items, SESSION_DEFAULT_SORTS, getSessionSortValue);
        setApplications(applicationsResult.items || []);
        setSessions(items);
        setTotal(sessionsResult.total || items.length);
        setCurrentPage(1);
        setSelectedSessionId(sortedItems[0]?.sessionId || null);
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load active sessions.');
        }
      } finally {
        if (active) {
          initialLoadCompleteRef.current = true;
          setLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialLoadCompleteRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      loadSessions(filters, '');
    }, 250);

    return () => window.clearTimeout(timeoutId);
    // loadSessions intentionally uses the filter snapshot from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.appCode, filters.ageRange]);

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Access control</div>
          <h1 className="sky-page-title">Sessions</h1>
          <p className="sky-page-subtitle">
            Monitor active sessions across all applications, inspect live access metadata, and
            revoke sessions when needed.
          </p>
        </div>

        <div className="text-md-end">
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={() => loadSessions(filters)}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh sessions'}
          </button>
        </div>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {success && <DismissibleAlert tone="success">{success}</DismissibleAlert>}
      {observedDate ? (
        <DismissibleAlert tone="info">
          The Command Center chart point for {observedDate} opened this application filter. This
          page shows sessions active now; the chart preserves the historical daily footprint.
        </DismissibleAlert>
      ) : null}
      {initialFilters.ageRange ? (
        <DismissibleAlert tone="info">
          Showing the current-session age band selected from the Command Center. Adjust or clear the
          Session age filter below to broaden the result set.
        </DismissibleAlert>
      ) : null}

      <div className="row g-3 sky-access-control-surface-row">
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card h-100">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Active sessions</div>
              <div className="sky-stat-value">{stats.activeSessions}</div>
              <div className="sky-muted small">Non-revoked and unexpired</div>
            </div>
          </section>
        </div>
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card h-100">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Users online</div>
              <div className="sky-stat-value">{stats.usersOnline}</div>
              <div className="sky-muted small">Unique authenticated users</div>
            </div>
          </section>
        </div>
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card h-100">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Applications</div>
              <div className="sky-stat-value">{stats.appSessions}</div>
              <div className="sky-muted small">Apps with active sessions</div>
            </div>
          </section>
        </div>
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card h-100">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Expiring soon</div>
              <div className="sky-stat-value">{stats.expiringSoon}</div>
              <div className="sky-muted small">Within 15 minutes</div>
            </div>
          </section>
        </div>
      </div>

      <section className="sky-card sky-functional-history-browser sky-admin-sessions-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Session browser</div>
            <h2 className="h5 mb-0">Active session directory</h2>
            <p className="sky-muted small mb-0">
              Search and filter live sessions, then select a row to inspect and manage the complete
              session workspace below.
            </p>
          </div>

          <div className="sky-admin-sessions-filter-grid">
            <div className="sky-admin-sessions-search-filter">
              <label className="form-label" htmlFor="sessionSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="sessionSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Email, username, display name, IP address, or user agent..."
                type="search"
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="sessionAppFilter">
                Application
              </label>
              <select
                className="form-select sky-form-control"
                id="sessionAppFilter"
                onChange={(event) => updateFilter('appCode', event.target.value)}
                value={filters.appCode}
              >
                <option value="ALL">All applications</option>
                {applications.map((application) => (
                  <option key={application.appCode} value={application.appCode}>
                    {formatApplicationLabel(application)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="sessionAgeFilter">
                Session age
              </label>
              <select
                className="form-select sky-form-control"
                id="sessionAgeFilter"
                onChange={(event) => updateFilter('ageRange', event.target.value)}
                value={filters.ageRange}
              >
                {SESSION_AGE_OPTIONS.map((option) => (
                  <option key={option.value || 'ALL'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sky-run-tools-filter-actions">
              {sortingCustomized && (
                <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                  Clear sorting
                </button>
              )}
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
          <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
            <thead>
              <tr>
                {renderSortableHeader('User', 'user')}
                {renderSortableHeader('Application', 'application')}
                {renderSortableHeader('Session', 'session')}
                {renderSortableHeader('Client', 'client')}
                {renderSortableHeader('Last seen', 'lastSeen')}
                {renderSortableHeader('Expires', 'expires')}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6">
                    <div className="sky-empty-state py-4">
                      <div className="spinner-border text-info" role="status" aria-label="Loading" />
                    </div>
                  </td>
                </tr>
              ) : visibleSessions.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <div className="sky-empty-state py-4">No active sessions match the current filters.</div>
                  </td>
                </tr>
              ) : (
                visibleSessions.map((item) => (
                  <tr
                    className={`sky-clickable-row ${
                      item.sessionId === selectedSession?.sessionId ? 'sky-selected-row' : ''
                    }`}
                    key={item.sessionId}
                    onClick={() => setSelectedSessionId(item.sessionId)}
                  >
                    <td>
                      <div className="fw-bold sky-detail-value">
                        {item.displayName || item.username || 'Unknown user'}
                      </div>
                      <div className="small sky-muted">{item.email}</div>
                    </td>
                    <td>
                      <span className="sky-pill sky-pill-info">{item.appCode || 'APP'}</span>
                      <div className="small sky-muted mt-1">{item.appTitle || '—'}</div>
                    </td>
                    <td>
                      <div className="sky-mono small">{getShortId(item.sessionId)}</div>
                      {item.isCurrentSession && (
                        <span className="sky-pill sky-pill-info mt-1">Current</span>
                      )}
                    </td>
                    <td>
                      <div className="sky-detail-value">{item.ipAddress || '—'}</div>
                      <div className="small sky-muted">{getUserAgentSummary(item.userAgent)}</div>
                    </td>
                    <td>{formatDate(item.lastSeenAt || item.createdAt)}</td>
                    <td>
                      <span className={`sky-pill ${getExpiryClass(item)}`}>
                        {formatSeconds(item.secondsUntilExpiry)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </section>

      <section className="sky-card sky-admin-session-detail-card">
        <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">Session detail</div>
            <h2 className="h5 mb-1">
              {selectedSession
                ? selectedSession.displayName || selectedSession.username || selectedSession.email
                : 'Selected session workspace'}
            </h2>
            {selectedSession && (
              <div className="small sky-muted sky-mono">{selectedSession.sessionId}</div>
            )}
          </div>
          {selectedSession && (
            <div className="d-flex flex-wrap align-items-center gap-2">
              {selectedSession.isCurrentSession && (
                <span className="sky-pill sky-pill-info">Current session</span>
              )}
              <span className="sky-pill sky-pill-info">{selectedSession.appCode || 'APP'}</span>
              <span className={`sky-pill ${getExpiryClass(selectedSession)}`}>
                {formatSeconds(selectedSession.secondsUntilExpiry)} left
              </span>
            </div>
          )}
        </div>

        <div className="sky-card-body">
          {selectedSession ? (
            <div className="sky-admin-session-detail-stack">
              <section className="sky-admin-session-detail-section">
                <div className="sky-admin-session-detail-section-header">
                  <div>
                    <div className="sky-detail-label">Identity &amp; session</div>
                    <div className="small sky-muted">
                      Review the authenticated identity, lifecycle timestamps, and client footprint for this session.
                    </div>
                  </div>
                </div>

                <div className="sky-admin-session-overview-grid">
                  <div className="sky-admin-session-detail-pane">
                    <div className="sky-detail-label mb-3">Identity</div>
                    <dl className="sky-admin-session-detail-list mb-0">
                      <dt>User</dt>
                      <dd>{selectedSession.displayName || selectedSession.username || '—'}</dd>
                      <dt>Email</dt>
                      <dd>{selectedSession.email || '—'}</dd>
                      <dt>Application</dt>
                      <dd>{selectedSession.appTitle || selectedSession.appCode || '—'}</dd>
                    </dl>
                  </div>

                  <div className="sky-admin-session-detail-pane">
                    <div className="sky-detail-label mb-3">Lifecycle</div>
                    <dl className="sky-admin-session-detail-list mb-0">
                      <dt>Created</dt>
                      <dd>{formatDate(selectedSession.createdAt)}</dd>
                      <dt>Last seen</dt>
                      <dd>{formatDate(selectedSession.lastSeenAt)}</dd>
                      <dt>Expires</dt>
                      <dd>{formatDate(selectedSession.expiresAt)}</dd>
                      <dt>Time left</dt>
                      <dd>{formatSeconds(selectedSession.secondsUntilExpiry)}</dd>
                    </dl>
                  </div>

                  <div className="sky-admin-session-detail-pane">
                    <div className="sky-detail-label mb-3">Client</div>
                    <dl className="sky-admin-session-detail-list mb-0">
                      <dt>IP address</dt>
                      <dd>{selectedSession.ipAddress || '—'}</dd>
                      <dt>Client</dt>
                      <dd>{getUserAgentSummary(selectedSession.userAgent)}</dd>
                      <dt>Session</dt>
                      <dd className="sky-mono small text-break">{selectedSession.sessionId}</dd>
                    </dl>
                  </div>
                </div>
              </section>

              <section className="sky-admin-session-detail-section">
                <div className="sky-admin-session-detail-section-header">
                  <div>
                    <div className="sky-detail-label">Client evidence</div>
                    <div className="small sky-muted">
                      Inspect the full user-agent string and server-side session metadata.
                    </div>
                  </div>
                </div>
                <div className="sky-admin-session-evidence-grid">
                  <div className="sky-admin-session-detail-pane">
                    <div className="sky-page-kicker mb-2">User agent</div>
                    <pre className="sky-code-block small mb-0">{selectedSession.userAgent || '—'}</pre>
                  </div>
                  <div className="sky-admin-session-detail-pane">
                    <div className="sky-page-kicker mb-2">Metadata</div>
                    <pre className="sky-code-block small mb-0">
                      {JSON.stringify(selectedSession.metadata || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </section>

              <section className="sky-admin-session-detail-section">
                <div className="sky-admin-session-detail-section-header">
                  <div>
                    <div className="sky-detail-label">Security &amp; session control</div>
                    <div className="small sky-muted">
                      Revoke the selected remote session when access should be terminated immediately.
                    </div>
                  </div>
                  {selectedSession.isCurrentSession && (
                    <span className="sky-pill sky-pill-warning">Current session protected</span>
                  )}
                </div>

                <div className="sky-admin-session-control-row">
                  <div className="small sky-muted">
                    {selectedSession.isCurrentSession
                      ? 'Use Logout to end your own active session. Administrative self-revocation is blocked.'
                      : 'Revocation invalidates this session without changing the user account or other active sessions.'}
                  </div>
                  {canRevoke && (
                    <button
                      className="btn sky-btn-danger"
                      disabled={
                        selectedSession.isCurrentSession ||
                        revokingSessionId === selectedSession.sessionId
                      }
                      onClick={() => revokeSession(selectedSession)}
                      type="button"
                    >
                      {selectedSession.isCurrentSession
                        ? 'Current session protected'
                        : revokingSessionId === selectedSession.sessionId
                          ? 'Revoking...'
                          : 'Revoke session'}
                    </button>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="sky-empty-state py-5">Select a session to inspect it.</div>
          )}
        </div>
      </section>
    </>
  );
}

export default AdminSessions;
