import { useMemo } from 'react';
import StatusPill from '../ui/StatusPill.jsx';
import TrendAreaChart from './TrendAreaChart.jsx';
import { CHART_COLORS } from './chartTheme.js';

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function formatDuration(value) {
  const numeric = Number(value || 0);

  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(numeric >= 10_000 ? 0 : 1)} s`;
  }

  return `${Math.round(numeric)} ms`;
}

function formatDurationAxis(value) {
  const numeric = Number(value || 0);
  return numeric >= 1000 ? `${Math.round(numeric / 1000)}s` : `${Math.round(numeric)}ms`;
}

function formatDay(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  });
}

function getSuccessStatus(successRate) {
  if (successRate >= 99) {
    return 'SUCCESS';
  }

  if (successRate >= 95) {
    return 'WARNING';
  }

  return 'FAILED';
}

function ApiMetricCard({ helper, label, status = 'CURRENT', value }) {
  return (
    <div className="sky-api-metric-card">
      <div className="d-flex align-items-start justify-content-between gap-2">
        <div>
          <div className="sky-page-kicker">{label}</div>
          <div className="sky-api-metric-value">{value}</div>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="small sky-muted mt-2">{helper}</div>
    </div>
  );
}

function ApiObservabilityPanel({ className = '', data, showRouteTable = true }) {
  const summary = data?.summary || {};
  const daily = Array.isArray(data?.daily) ? data.daily : [];
  const topRoutes = Array.isArray(data?.topRoutes) ? data.topRoutes.slice(0, 10) : [];
  const applications = Array.isArray(data?.applications) ? data.applications : [];
  const days = Number(data?.window?.days || 7);
  const chartData = useMemo(
    () => ({
      labels: daily.map((item) => formatDay(item.date)),
      trafficSeries: [
        {
          name: 'Successful',
          values: daily.map((item) => Number(item.successfulRequests || 0)),
          areaOpacity: 0.14,
        },
        {
          name: 'Client errors',
          values: daily.map((item) => Number(item.clientErrors || 0)),
          areaOpacity: 0.08,
        },
        {
          name: 'Server errors',
          values: daily.map((item) => Number(item.serverErrors || 0)),
          areaOpacity: 0.08,
        },
      ],
      latencySeries: [
        {
          name: 'Average',
          values: daily.map((item) => Number(item.averageDurationMs || 0)),
          areaOpacity: 0.12,
        },
        {
          name: 'p95',
          values: daily.map((item) => Number(item.p95DurationMs || 0)),
          areaOpacity: 0.06,
        },
      ],
    }),
    [daily],
  );

  if (!data) {
    return null;
  }

  const successRate = Number(summary.successRate ?? 100);
  const serverErrors = Number(summary.serverErrors || 0);

  return (
    <section className={`sky-card sky-api-observability-panel ${className}`.trim()}>
      <div className="sky-card-header sky-dashboard-section-heading">
        <div>
          <div className="sky-page-kicker">API observability</div>
          <h2 className="h5 mb-0">Request traffic and service performance</h2>
          <div className="small sky-muted mt-1">
            Persistent PostgreSQL request evidence across the last {days} day(s).
          </div>
        </div>
        <span className="sky-muted small">Normalized routes · privacy-safe measurements</span>
      </div>

      <div className="sky-card-body">
        <div className="sky-api-metric-grid mb-3">
          <ApiMetricCard
            helper={`${formatCount(summary.successfulRequests)} successful request(s)`}
            label="Requests"
            status="CURRENT"
            value={formatCount(summary.totalRequests)}
          />
          <ApiMetricCard
            helper={`${formatCount(summary.clientErrors)} client error(s)`}
            label="Success rate"
            status={getSuccessStatus(successRate)}
            value={`${successRate.toFixed(1)}%`}
          />
          <ApiMetricCard
            helper={`Average ${formatDuration(summary.averageDurationMs)}`}
            label="p95 latency"
            status={Number(summary.p95DurationMs || 0) >= 2000 ? 'WARNING' : 'CURRENT'}
            value={formatDuration(summary.p95DurationMs)}
          />
          <ApiMetricCard
            helper={`p99 ${formatDuration(summary.p99DurationMs)}`}
            label="Server errors"
            status={serverErrors > 0 ? 'FAILED' : 'SUCCESS'}
            value={formatCount(serverErrors)}
          />
        </div>

        {applications.length > 0 && (
          <div className="sky-api-app-mix mb-3">
            <span className="sky-page-kicker">Application mix</span>
            {applications.slice(0, 5).map((application) => (
              <span className="sky-pill sky-pill-info" key={application.appCode}>
                {application.appCode} · {formatCount(application.requestCount)}
              </span>
            ))}
          </div>
        )}

        <div className="sky-dashboard-chart-grid sky-api-chart-grid mb-3">
          <TrendAreaChart
            colors={[CHART_COLORS.green, CHART_COLORS.gold, CHART_COLORS.red]}
            height={300}
            kicker="API usage"
            labels={chartData.labels}
            series={chartData.trafficSeries}
            subtitle="Daily successful requests, client errors, and server errors."
            title="API traffic trend"
          />
          <TrendAreaChart
            colors={[CHART_COLORS.cyan, CHART_COLORS.violet]}
            height={300}
            kicker="Service performance"
            labels={chartData.labels}
            series={chartData.latencySeries}
            subtitle="Average and p95 response duration by day."
            title="API latency trend"
            valueFormatter={formatDuration}
            yAxisFormatter={formatDurationAxis}
          />
        </div>

        {showRouteTable && (
          <section className="sky-api-route-card">
            <div className="sky-api-route-card-header d-flex align-items-start justify-content-between gap-3">
              <div>
                <div className="sky-page-kicker">Route pressure</div>
                <h2 className="h5 mb-0">Busiest API routes</h2>
                <div className="small sky-muted mt-1">
                  Normalized endpoint traffic ordered by request volume.
                </div>
              </div>
              <span className="sky-pill sky-pill-info">Top {topRoutes.length}</span>
            </div>
            <div className="table-responsive">
              <table className="table table-sm sky-table mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Route</th>
                    <th className="text-end">Requests</th>
                    <th className="text-end">Errors</th>
                    <th className="text-end">Average</th>
                    <th className="text-end">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {topRoutes.length === 0 ? (
                    <tr>
                      <td className="text-center sky-muted py-4" colSpan={6}>
                        API telemetry will appear after requests are recorded.
                      </td>
                    </tr>
                  ) : (
                    topRoutes.map((route) => (
                      <tr key={`${route.method}:${route.routeTemplate}`}>
                        <td>
                          <span className="sky-pill sky-pill-info">{route.method}</span>
                        </td>
                        <td className="sky-api-route-template">{route.routeTemplate}</td>
                        <td className="text-end">{formatCount(route.requestCount)}</td>
                        <td className="text-end">
                          <StatusPill
                            label={formatCount(route.errorCount)}
                            status={Number(route.errorCount || 0) > 0 ? 'WARNING' : 'SUCCESS'}
                          />
                        </td>
                        <td className="text-end">{formatDuration(route.averageDurationMs)}</td>
                        <td className="text-end">{formatDuration(route.p95DurationMs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

export default ApiObservabilityPanel;
