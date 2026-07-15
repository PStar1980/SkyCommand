import { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

function formatDateTime(value, fallback = 'No successful login recorded') {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
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

function getHealthClass(status) {
  const normalized = String(status || 'NORMAL').toUpperCase();

  if (normalized === 'CRITICAL') {
    return 'sky-pill-danger';
  }

  if (normalized === 'ATTENTION') {
    return 'sky-pill-warning';
  }

  if (normalized === 'ELEVATED') {
    return 'sky-pill-info';
  }

  return 'sky-pill-success';
}

function getComparisonText(metric = {}, label = 'vs prior period') {
  const delta = Number(metric.delta || 0);

  if (delta === 0) {
    return `No change ${label}`;
  }

  if (metric.percentChange === null || metric.percentChange === undefined) {
    return `${delta > 0 ? '+' : ''}${delta} ${label} (no prior activity)`;
  }

  const arrow = delta > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(Number(metric.percentChange || 0))}% ${label}`;
}

function getComparisonClass(metric = {}, favorableDirection = 'NEUTRAL') {
  const delta = Number(metric.delta || 0);

  if (delta === 0 || favorableDirection === 'NEUTRAL') {
    return 'is-neutral';
  }

  const isFavorable = favorableDirection === 'UP' ? delta > 0 : delta < 0;
  return isFavorable ? 'is-positive' : 'is-negative';
}

function UserMetric({ comparison, comparisonLabel, favorableDirection, helper, label, to, value }) {
  const content = (
    <>
      <div className="sky-page-kicker">{label}</div>
      <div className="sky-mini-metric-value">{value}</div>
      {helper ? <div className="small sky-muted mt-2">{helper}</div> : null}
      {comparison ? (
        <div className={`sky-identity-delta ${getComparisonClass(comparison, favorableDirection)}`}>
          {getComparisonText(comparison, comparisonLabel)}
        </div>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link className="sky-mini-metric sky-identity-metric-link" to={to}>
        {content}
      </Link>
    );
  }

  return <div className="sky-mini-metric">{content}</div>;
}

function ApplicationUserSummaryRow({ data, loading = false, title }) {
  const navigate = useNavigate();
  const summary = data?.summary || {};
  const comparison = data?.comparison || {};
  const health = data?.health || {};
  const activity = Array.isArray(data?.activity) ? data.activity : [];
  const days = Number(data?.days || 7);
  const rangeLabel = `${days}-day`;
  const appCode = data?.appCode || '';
  const appTitle = data?.appTitle || title || appCode || 'Application';
  const labels = useMemo(() => activity.map((item) => formatDayLabel(item.date)), [activity]);
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
        name: 'Daily session footprint',
        values: activity.map((item) => Number(item.activeSessions || 0)),
        areaOpacity: 0.16,
      },
    ],
    [activity],
  );
  const hasLoginActivity = activity.some(
    (item) => Number(item.successfulLogins || 0) > 0 || Number(item.failedLogins || 0) > 0,
  );
  const hasSessionActivity = activity.some((item) => Number(item.activeSessions || 0) > 0);
  const generatedAtLabel = formatDateTime(data?.generatedAt, 'Update time unavailable');
  const healthReason = Array.isArray(health.reasons) ? health.reasons.join(' · ') : '';
  const periodStart = activity[0]?.date || '';
  const periodEnd = activity[activity.length - 1]?.date || '';
  const failedLoginSearch = new URLSearchParams({
    source: 'login',
    appCode,
    success: 'false',
  });

  if (periodStart) {
    failedLoginSearch.set('from', periodStart);
  }

  if (periodEnd) {
    failedLoginSearch.set('to', periodEnd);
  }

  const handleLoginChartClick = useCallback(
    (params) => {
      const index = Number(params?.dataIndex);
      const item = Number.isInteger(index) ? activity[index] : null;

      if (!item?.date) {
        return;
      }

      const search = new URLSearchParams({
        source: 'login',
        appCode,
        from: item.date,
        to: item.date,
      });

      if (params?.seriesName === 'Successful') {
        search.set('success', 'true');
      } else if (params?.seriesName === 'Failed') {
        search.set('success', 'false');
      }

      navigate(`/access-control/user-history?${search.toString()}`);
    },
    [activity, appCode, navigate],
  );

  const handleSessionChartClick = useCallback(
    (params) => {
      const index = Number(params?.dataIndex);
      const item = Number.isInteger(index) ? activity[index] : null;
      const search = new URLSearchParams({ appCode });

      if (item?.date) {
        search.set('observedDate', item.date);
      }

      navigate(`/admin/sessions?${search.toString()}`);
    },
    [activity, appCode, navigate],
  );

  return (
    <div className="sky-user-summary-grid">
      <section className="sky-card sky-user-summary-card h-100">
        <div className="sky-card-header d-flex align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">Identity telemetry</div>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <h2 className="h5 mb-0">{title}</h2>
              {data ? (
                <span
                  className={`sky-pill ${getHealthClass(health.status)}`}
                  title={healthReason || undefined}
                >
                  {health.status || 'NORMAL'}
                </span>
              ) : null}
            </div>
            <div className="small sky-muted mt-1">
              Current access posture and the latest {rangeLabel} authentication window.
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 justify-content-end">
            <Link
              className="btn btn-sm sky-btn-ghost"
              to={`/admin/users?appCode=${encodeURIComponent(appCode)}`}
            >
              Users
            </Link>
            <Link
              className="btn btn-sm sky-btn-ghost"
              to={`/admin/sessions?appCode=${encodeURIComponent(appCode)}`}
            >
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
                comparison={comparison.newUsers}
                comparisonLabel="new users vs prior period"
                favorableDirection="NEUTRAL"
                helper={`${summary.activeUsers || 0} active · ${summary.disabledUsers || 0} disabled`}
                label="Users"
                to={`/admin/users?appCode=${encodeURIComponent(appCode)}`}
                value={summary.totalUsers || 0}
              />
              <UserMetric
                comparison={comparison.sessionFootprintEnd}
                comparisonLabel="daily footprint vs prior close"
                favorableDirection="NEUTRAL"
                helper={`${summary.usersOnline || 0} unique user(s) online`}
                label="Active sessions"
                to={`/admin/sessions?appCode=${encodeURIComponent(appCode)}`}
                value={summary.activeSessions || 0}
              />
              <UserMetric
                helper={`${summary.staleSessions || 0} stale session(s) · ${health.staleSessionThresholdHours || 12}h threshold`}
                label="Longest session"
                to={`/admin/sessions?appCode=${encodeURIComponent(appCode)}`}
                value={formatDurationSeconds(summary.longestSessionSeconds)}
              />
              <UserMetric
                comparison={comparison.failedLogins}
                comparisonLabel="vs prior period"
                favorableDirection="DOWN"
                helper={`${summary.successfulLogins || 0} successful in ${days} days`}
                label="Failed logins"
                to={`/access-control/user-history?${failedLoginSearch.toString()}`}
                value={summary.failedLogins || 0}
              />
            </div>

            <div className="sky-identity-health-note mt-3">
              <div className="sky-page-kicker">Identity health</div>
              <div>{healthReason || 'No health assessment is available.'}</div>
            </div>

            <div className="sky-user-summary-footer mt-3">
              <span className="sky-muted">Successful logins</span>
              <strong>
                {summary.successfulLogins || 0}
                <span
                  className={`sky-identity-footer-delta ${getComparisonClass(
                    comparison.successfulLogins,
                    'UP',
                  )}`}
                >
                  {getComparisonText(comparison.successfulLogins)}
                </span>
              </strong>
              <span className="sky-muted">Failed-login rate</span>
              <strong>{Number(summary.failedLoginRate || 0).toFixed(1)}%</strong>
              <span className="sky-muted">Peak daily sessions</span>
              <strong>{summary.peakSessionFootprint || 0}</strong>
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
        emptyMessage={`No ${appTitle} login attempts were recorded during this ${rangeLabel} period.`}
        emptyTitle="No login activity"
        footer={`Click a point to inspect login attempts · Current as of ${generatedAtLabel}`}
        height={245}
        isEmpty={!loading && data && !hasLoginActivity}
        kicker={`${rangeLabel} authentication`}
        labels={labels}
        onChartClick={handleLoginChartClick}
        series={loginSeries}
        subtitle="Successful and failed login attempts grouped by day."
        title="User logins"
      />

      <TrendAreaChart
        colors={[CHART_COLORS.blue]}
        emptyMessage={`No ${appTitle} sessions were active during this ${rangeLabel} period.`}
        emptyTitle="No session activity"
        footer={`Click a point to open current ${appTitle} sessions · Current as of ${generatedAtLabel}`}
        height={245}
        isEmpty={!loading && data && !hasSessionActivity}
        kicker={`${rangeLabel} session pressure`}
        labels={labels}
        onChartClick={handleSessionChartClick}
        series={sessionSeries}
        subtitle="Sessions observed at any point during each day."
        title="Daily session footprint"
      />
    </div>
  );
}

export default ApplicationUserSummaryRow;
