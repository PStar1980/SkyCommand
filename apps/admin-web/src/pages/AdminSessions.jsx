import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
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
  limit: '50',
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

function AdminSessions() {
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const initialFilters = getInitialSessionFilters(searchParams);
  const observedDate = searchParams.get('observedDate') || '';
  const canRevoke = hasPermission('ADMIN_USER_WRITE');
  const [applications, setApplications] = useState([]);
  const [filters, setFilters] = useState(() => initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(() => initialFilters);
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [revokingSessionId, setRevokingSessionId] = useState(null);

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
      currentSessions: sessions.filter((item) => item.isCurrentSession).length,
      expiringSoon,
    };
  }, [sessions, total]);

  async function loadSessions(nextFilters = appliedFilters) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listSessions(nextFilters);
      const items = result.items || [];

      setSessions(items);
      setTotal(result.total || 0);
      setSelectedSessionId((current) => {
        if (current && items.some((item) => item.sessionId === current)) {
          return current;
        }

        return items[0]?.sessionId || null;
      });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load active sessions.');
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(event) {
    event.preventDefault();
    const nextFilters = {
      q: filters.q.trim(),
      appCode: filters.appCode,
      ageRange: filters.ageRange,
      limit: filters.limit,
    };

    setAppliedFilters(nextFilters);
    loadSessions(nextFilters);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    loadSessions(DEFAULT_FILTERS);
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
      await loadSessions(appliedFilters);
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
          adminService.listSessions(initialFilters),
        ]);

        if (!active) {
          return;
        }

        const items = sessionsResult.items || [];
        setApplications(applicationsResult.items || []);
        setSessions(items);
        setTotal(sessionsResult.total || 0);
        setSelectedSessionId(items[0]?.sessionId || null);
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load active sessions.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      active = false;
    };
  }, []);

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
            onClick={() => loadSessions(appliedFilters)}
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
        <div className="alert alert-info">
          Showing the current-session age band selected from the Command Center. Adjust or clear the
          Session age filter below to broaden the result set.
        </div>
      ) : null}

      <div className="row g-3 mb-3">
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

      <section className="sky-card mb-3">
        <form className="sky-card-body" onSubmit={applyFilters}>
          <div className="row g-3 align-items-end">
            <div className="col-lg-4">
              <label className="form-label sky-form-label" htmlFor="sessionSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="sessionSearch"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, q: event.target.value }))
                }
                placeholder="Email, username, display name, IP address, or user agent..."
                value={filters.q}
              />
            </div>
            <div className="col-lg-2">
              <label className="form-label sky-form-label" htmlFor="sessionAppFilter">
                Application
              </label>
              <select
                className="form-select sky-form-control"
                id="sessionAppFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, appCode: event.target.value }))
                }
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
            <div className="col-lg-2">
              <label className="form-label sky-form-label" htmlFor="sessionAgeFilter">
                Session age
              </label>
              <select
                className="form-select sky-form-control"
                id="sessionAgeFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, ageRange: event.target.value }))
                }
                value={filters.ageRange}
              >
                {SESSION_AGE_OPTIONS.map((option) => (
                  <option key={option.value || 'ALL'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-1">
              <label className="form-label sky-form-label" htmlFor="sessionLimit">
                Limit
              </label>
              <select
                className="form-select sky-form-control"
                id="sessionLimit"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, limit: event.target.value }))
                }
                value={filters.limit}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </div>
            <div className="col-lg-3 d-flex gap-2">
              <button className="btn sky-btn-primary flex-fill" disabled={loading} type="submit">
                Apply
              </button>
              <button
                className="btn sky-btn-ghost"
                disabled={loading}
                onClick={clearFilters}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>
        </form>
      </section>

      <div className="row g-3">
        <div className="col-xl-8">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Active Sessions</h2>
              <div className="small sky-muted">
                Showing {sessions.length} of {total} active session record(s).
              </div>
            </div>

            {sessions.length > 0 ? (
              <div className="table-responsive">
                <table className="table sky-table align-middle">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Application</th>
                      <th>Session</th>
                      <th>Client</th>
                      <th>Last seen</th>
                      <th>Expires</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((item) => (
                      <tr
                        className={
                          item.sessionId === selectedSession?.sessionId
                            ? 'sky-table-row-selected'
                            : ''
                        }
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
                          <div className="small sky-muted">
                            {getUserAgentSummary(item.userAgent)}
                          </div>
                        </td>
                        <td>{formatDate(item.lastSeenAt || item.createdAt)}</td>
                        <td>
                          <span className={`sky-pill ${getExpiryClass(item)}`}>
                            {formatSeconds(item.secondsUntilExpiry)}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm sky-btn-ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedSessionId(item.sessionId);
                            }}
                            type="button"
                          >
                            Inspect
                          </button>
                          {canRevoke && (
                            <button
                              className="btn btn-sm sky-btn-danger ms-2"
                              disabled={
                                item.isCurrentSession || revokingSessionId === item.sessionId
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                revokeSession(item);
                              }}
                              title={
                                item.isCurrentSession
                                  ? 'Use Logout to end your current session.'
                                  : ''
                              }
                              type="button"
                            >
                              {revokingSessionId === item.sessionId ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sky-empty-state">
                {loading ? 'Loading active sessions...' : 'No active sessions found.'}
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-4">
          <section className="sky-card h-100">
            <div className="sky-card-header d-flex align-items-start justify-content-between gap-3">
              <div>
                <h2 className="h5 mb-0">Session detail</h2>
                <div className="small sky-muted">Selected active session metadata.</div>
              </div>
              {selectedSession?.isCurrentSession && (
                <span className="sky-pill sky-pill-info">Current</span>
              )}
            </div>

            {selectedSession ? (
              <div className="sky-card-body">
                <dl className="row g-3 mb-0">
                  <dt className="col-5 sky-detail-label">Application</dt>
                  <dd className="col-7 sky-detail-value">
                    {selectedSession.appTitle || selectedSession.appCode || '—'}
                  </dd>

                  <dt className="col-5 sky-detail-label">User</dt>
                  <dd className="col-7 sky-detail-value">
                    {selectedSession.displayName || selectedSession.username || '—'}
                  </dd>

                  <dt className="col-5 sky-detail-label">Email</dt>
                  <dd className="col-7 sky-detail-value">{selectedSession.email || '—'}</dd>

                  <dt className="col-5 sky-detail-label">Session ID</dt>
                  <dd className="col-7 sky-detail-value sky-mono small">
                    {selectedSession.sessionId}
                  </dd>

                  <dt className="col-5 sky-detail-label">IP address</dt>
                  <dd className="col-7 sky-detail-value">{selectedSession.ipAddress || '—'}</dd>

                  <dt className="col-5 sky-detail-label">Created</dt>
                  <dd className="col-7 sky-detail-value">
                    {formatDate(selectedSession.createdAt)}
                  </dd>

                  <dt className="col-5 sky-detail-label">Last seen</dt>
                  <dd className="col-7 sky-detail-value">
                    {formatDate(selectedSession.lastSeenAt)}
                  </dd>

                  <dt className="col-5 sky-detail-label">Expires</dt>
                  <dd className="col-7 sky-detail-value">
                    {formatDate(selectedSession.expiresAt)}
                  </dd>

                  <dt className="col-5 sky-detail-label">Time left</dt>
                  <dd className="col-7 sky-detail-value">
                    {formatSeconds(selectedSession.secondsUntilExpiry)}
                  </dd>
                </dl>

                <hr />

                <div className="sky-page-kicker mb-2">User agent</div>
                <pre className="sky-code-block small mb-3">{selectedSession.userAgent || '—'}</pre>

                <div className="sky-page-kicker mb-2">Metadata</div>
                <pre className="sky-code-block small">
                  {JSON.stringify(selectedSession.metadata || {}, null, 2)}
                </pre>

                {canRevoke && (
                  <button
                    className="btn sky-btn-danger mt-3"
                    disabled={
                      selectedSession.isCurrentSession ||
                      revokingSessionId === selectedSession.sessionId
                    }
                    onClick={() => revokeSession(selectedSession)}
                    title={
                      selectedSession.isCurrentSession
                        ? 'Use Logout to end your current session.'
                        : ''
                    }
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
            ) : (
              <div className="sky-empty-state">Select a session to inspect it.</div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

export default AdminSessions;
