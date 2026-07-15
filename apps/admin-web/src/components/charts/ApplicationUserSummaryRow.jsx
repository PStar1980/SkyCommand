import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import TrendAreaChart from './TrendAreaChart.jsx';
import { CHART_COLORS } from './chartTheme.js';

function formatDurationSeconds(value) {
  const totalSeconds = Math.max(0, Number(value) || 0);

  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds)}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${totalMinutes}m`;
  }

  if (hours < 24) {
    return `${hours}h ${minutes}m`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

function formatDateTime(value) {
  if (!value) {
    return 'No successful login recorded';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'No successful login recorded';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDayLabel(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function UserMetric({ helper, label, value }) {
  return (
    <div className="sky-mini-metric">
      <div className="sky-page-kicker">{label}</div>
      <div className="sky-mini-metric-value">{value}</div>
      {helper ? <div className="small sky-muted mt-2">{helper}</div> : null}
    </div>
  );
}

function ApplicationUserSummaryRow({ data, loading = false, title }) {
  const summary = data?.summary || {};
  const activity = Array.isArray(data?.activity) ? data.activity : [];
  const labels = useMemo(
    () => activity.map((item) => formatDayLabel(item.date)),
    [activity],
  );
  const loginSeries = useMemo(
    () => [
      {
        name: 'Successful',
        values: activity.map((item) => Number(item.successfulLogins || 0)),
        areaOpacity: 0.16,
      },
      {
        name: 'Failed',
        values: activity.map((item) => Number(item.failedLogins || 0)),
        areaOpacity: 0.08,
      },
    ],
    [activity],
  );
  const sessionSeries = useMemo(
    () => [
      {
        name: 'Active sessions',
        values: activity.map((item) => Number(item.activeSessions || 0)),
        areaOpacity: 0.16,
      },
    ],
    [activity],
  );

  return (
    <div className="sky-user-summary-grid">
      <section className="sky-card sky-user-summary-card h-100">
        <div className="sky-card-header d-flex align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">Identity telemetry</div>
            <h2 className="h5 mb-0">{title}</h2>
            <div className="small sky-muted mt-1">
              Current access posture and the latest seven-day authentication window.
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 justify-content-end">
            <Link className="btn btn-sm sky-btn-ghost" to="/admin/users">
              Users
            </Link>
            <Link className="btn btn-sm sky-btn-ghost" to="/admin/sessions">
              Sessions
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="sky-empty-state">Loading user summary...</div>
        ) : data ? (
          <div className="sky-card-body">
            <div className="sky-user-summary-metrics">
              <UserMetric
                helper={`${summary.activeUsers || 0} active · ${summary.disabledUsers || 0} disabled`}
                label="Users"
                value={summary.totalUsers || 0}
              />
              <UserMetric
                helper={`${summary.usersOnline || 0} unique user(s) online`}
                label="Active sessions"
                value={summary.activeSessions || 0}
              />
              <UserMetric
                helper="Longest currently active session"
                label="Longest session"
                value={formatDurationSeconds(summary.longestSessionSeconds)}
              />
              <UserMetric
                helper={`${summary.successfulLogins || 0} successful in 7 days`}
                label="Failed logins"
                value={summary.failedLogins || 0}
              />
            </div>
            <div className="sky-user-summary-footer mt-3">
              <span className="sky-muted">Locked users</span>
              <strong>{summary.lockedUsers || 0}</strong>
              <span className="sky-muted">Latest login</span>
              <strong>{formatDateTime(summary.lastLoginAt)}</strong>
            </div>
          </div>
        ) : (
          <div className="sky-empty-state">User telemetry is unavailable for this application.</div>
        )}
      </section>

      <TrendAreaChart
        colors={[CHART_COLORS.green, CHART_COLORS.red]}
        height={245}
        kicker="Seven-day authentication"
        labels={labels}
        series={loginSeries}
        subtitle="Successful and failed login attempts grouped by day."
        title="User logins"
      />

      <TrendAreaChart
        colors={[CHART_COLORS.blue]}
        height={245}
        kicker="Seven-day session pressure"
        labels={labels}
        series={sessionSeries}
        subtitle="Sessions active at any point during each day."
        title="Active sessions"
      />
    </div>
  );
}

export default ApplicationUserSummaryRow;
