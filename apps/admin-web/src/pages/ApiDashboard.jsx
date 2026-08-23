import { useEffect, useMemo, useState } from 'react';
import ApiObservabilityPanel from '../components/charts/ApiObservabilityPanel.jsx';
import OutcomeBarChart from '../components/charts/OutcomeBarChart.jsx';
import StatusDonut from '../components/charts/StatusDonut.jsx';
import TrendAreaChart from '../components/charts/TrendAreaChart.jsx';
import { CHART_COLORS } from '../components/charts/chartTheme.js';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import adminService from '../services/adminService.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const DEFAULT_FILTERS = {
  days: '7',
  appCode: '',
  method: '',
  statusGroup: '',
  routeSearch: '',
  routeLimit: '20',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All response statuses' },
  { value: 'SUCCESS', label: 'Successful responses' },
  { value: 'CLIENT_ERROR', label: 'Client errors (4xx)' },
  { value: 'SERVER_ERROR', label: 'Server errors (5xx)' },
];

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function formatDuration(value) {
  const numeric = Number(value || 0);
  return numeric >= 1000 ? `${(numeric / 1000).toFixed(numeric >= 10_000 ? 0 : 1)} s` : `${Math.round(numeric)} ms`;
}

function formatDurationAxis(value) {
  const numeric = Number(value || 0);
  return numeric >= 1000 ? `${Math.round(numeric / 1000)}s` : `${Math.round(numeric)}ms`;
}

function formatBytes(value) {
  const numeric = Number(value || 0);

  if (numeric >= 1024 ** 3) {
    return `${(numeric / 1024 ** 3).toFixed(1)} GB`;
  }

  if (numeric >= 1024 ** 2) {
    return `${(numeric / 1024 ** 2).toFixed(1)} MB`;
  }

  if (numeric >= 1024) {
    return `${(numeric / 1024).toFixed(1)} KB`;
  }

  return `${numeric} B`;
}

function ApiDashboard() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadTelemetry(nextFilters = filters, { quiet = false } = {}) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      const result = await adminService.getApiTelemetrySummary(nextFilters);
      setTelemetry(result);
      setRefreshingAt(new Date());
      return { activeCount: 0 };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load API telemetry.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadTelemetry(DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollingState = useSmartPolling({
    dependencies: [
      filters.days,
      filters.appCode,
      filters.method,
      filters.statusGroup,
      filters.routeSearch,
      filters.routeLimit,
    ],
    getDelay: ({ hidden = false } = {}) =>
      getSmartPollingDelay({
        activeCount: 0,
        hidden,
        idleMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
      }),
    initialIntervalMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
    onPoll: () => loadTelemetry(filters, { quiet: true }),
  });

  const applicationOptions = telemetry?.filterOptions?.applications || [];
  const methodOptions = telemetry?.filterOptions?.methods || [];
  const summary = telemetry?.summary || {};
  const methods = Array.isArray(telemetry?.methods) ? telemetry.methods : [];
  const applications = Array.isArray(telemetry?.applications) ? telemetry.applications : [];
  const hourly = Array.isArray(telemetry?.hourly) ? telemetry.hourly : [];
  const slowRoutes = Array.isArray(telemetry?.slowRoutes) ? telemetry.slowRoutes : [];
  const authModes = Array.isArray(telemetry?.authModes) ? telemetry.authModes : [];

  const distributionData = useMemo(
    () => ({
      status: [
        { name: 'Successful', value: Number(summary.successfulRequests || 0) },
        { name: 'Client errors', value: Number(summary.clientErrors || 0) },
        { name: 'Server errors', value: Number(summary.serverErrors || 0) },
      ].filter((item) => item.value > 0),
      methods: methods.map((item) => ({ name: item.method, value: item.requestCount })),
      applications: applications
        .slice(0, 8)
        .map((item) => ({ name: item.appCode, value: item.requestCount })),
      hourlyLabels: hourly.map((item) => `${String(item.hour).padStart(2, '0')}:00`),
      hourlyTraffic: [
        {
          name: 'Requests',
          values: hourly.map((item) => Number(item.requestCount || 0)),
          areaOpacity: 0.14,
        },
        {
          name: 'Errors',
          values: hourly.map((item) => Number(item.errorCount || 0)),
          areaOpacity: 0.08,
        },
      ],
      hourlyLatency: [
        {
          name: 'Average',
          values: hourly.map((item) => Number(item.averageDurationMs || 0)),
          areaOpacity: 0.12,
        },
        {
          name: 'p95',
          values: hourly.map((item) => Number(item.p95DurationMs || 0)),
          areaOpacity: 0.06,
        },
      ],
    }),
    [applications, hourly, methods, summary.clientErrors, summary.serverErrors, summary.successfulRequests],
  );

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    loadTelemetry(filters);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    loadTelemetry(DEFAULT_FILTERS);
  }

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Requests"
            activeValue={summary.totalRequests || 0}
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadTelemetry()}
            pollingState={pollingState}
          />
        }
        kicker="Dashboards · API"
        subtitle="Analyze persistent request volume, response quality, latency pressure, caller mix, normalized route load, and authentication traffic."
        title="API Dashboard"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <form onSubmit={applyFilters}>
        <DashboardFilterCard
          actions={
            <>
              <button className="btn sky-btn-primary" disabled={loading} type="submit">
                Apply filters
              </button>
              <button
                className="btn sky-btn-ghost"
                disabled={loading}
                onClick={resetFilters}
                type="button"
              >
                Reset
              </button>
            </>
          }
          meta={`${formatCount(summary.totalRequests)} request(s) in the selected telemetry window`}
          title="API analytics filters"
        >
          <div>
            <label className="form-label" htmlFor="apiDashboardDays">
              Observation window
            </label>
            <select
              className="form-select sky-form-control"
              id="apiDashboardDays"
              onChange={(event) => updateFilter('days', event.target.value)}
              value={filters.days}
            >
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="apiDashboardApplication">
              Application
            </label>
            <select
              className="form-select sky-form-control"
              id="apiDashboardApplication"
              onChange={(event) => updateFilter('appCode', event.target.value)}
              value={filters.appCode}
            >
              <option value="">All applications</option>
              {applicationOptions.map((appCode) => (
                <option key={appCode} value={appCode}>
                  {appCode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="apiDashboardMethod">
              HTTP method
            </label>
            <select
              className="form-select sky-form-control"
              id="apiDashboardMethod"
              onChange={(event) => updateFilter('method', event.target.value)}
              value={filters.method}
            >
              <option value="">All methods</option>
              {methodOptions.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="apiDashboardStatus">
              Response status
            </label>
            <select
              className="form-select sky-form-control"
              id="apiDashboardStatus"
              onChange={(event) => updateFilter('statusGroup', event.target.value)}
              value={filters.statusGroup}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="apiDashboardRoute">
              Route contains
            </label>
            <input
              className="form-control sky-form-control"
              id="apiDashboardRoute"
              onChange={(event) => updateFilter('routeSearch', event.target.value)}
              placeholder="Example: /api/workflows"
              type="search"
              value={filters.routeSearch}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="apiDashboardRouteLimit">
              Route table size
            </label>
            <select
              className="form-select sky-form-control"
              id="apiDashboardRouteLimit"
              onChange={(event) => updateFilter('routeLimit', event.target.value)}
              value={filters.routeLimit}
            >
              <option value="10">Top 10 routes</option>
              <option value="20">Top 20 routes</option>
              <option value="30">Top 30 routes</option>
              <option value="50">Top 50 routes</option>
            </select>
          </div>
        </DashboardFilterCard>
      </form>

      <ApiObservabilityPanel data={telemetry} />

      <section className="sky-card mt-3">
        <div className="sky-card-header sky-dashboard-section-heading">
          <div>
            <div className="sky-page-kicker">Traffic composition</div>
            <h2 className="h5 mb-0">Request distribution</h2>
            <div className="small sky-muted mt-1">
              Compare response quality, HTTP verbs, and caller applications for the active filters.
            </div>
          </div>
          <span className="sky-muted small">Filtered PostgreSQL telemetry</span>
        </div>
        <div className="sky-card-body">
          <div className="sky-dashboard-chart-grid sky-api-analysis-grid">
            <StatusDonut
              colors={[CHART_COLORS.green, CHART_COLORS.gold, CHART_COLORS.red]}
              data={distributionData.status}
              height={300}
              kicker="Response quality"
              name="Responses"
              subtitle="Successful, client-error, and server-error request distribution."
              title="HTTP outcome mix"
            />
            <OutcomeBarChart
              colors={[CHART_COLORS.blue, CHART_COLORS.green, CHART_COLORS.violet, CHART_COLORS.gold]}
              data={distributionData.methods}
              height={300}
              kicker="Protocol usage"
              name="Requests"
              subtitle="Request volume grouped by HTTP method."
              title="Method distribution"
            />
            <OutcomeBarChart
              colors={[CHART_COLORS.cyan, CHART_COLORS.violet, CHART_COLORS.blue, CHART_COLORS.green]}
              data={distributionData.applications}
              height={300}
              kicker="Caller mix"
              name="Requests"
              subtitle="Request volume grouped by authenticated application scope."
              title="Application distribution"
            />
          </div>
        </div>
      </section>

      <section className="sky-card mt-3">
        <div className="sky-card-header sky-dashboard-section-heading">
          <div>
            <div className="sky-page-kicker">Daily operating rhythm</div>
            <h2 className="h5 mb-0">Hourly pressure profile</h2>
            <div className="small sky-muted mt-1">
              Aggregate request volume and response latency by hour of day across the selected window.
            </div>
          </div>
          <span className="sky-muted small">00:00–23:00 server time</span>
        </div>
        <div className="sky-card-body">
          <div className="sky-dashboard-chart-grid sky-api-chart-grid">
            <TrendAreaChart
              colors={[CHART_COLORS.blue, CHART_COLORS.red]}
              height={300}
              kicker="Hourly traffic"
              labels={distributionData.hourlyLabels}
              series={distributionData.hourlyTraffic}
              subtitle="Requests and errors grouped by hour of day."
              title="Request pressure"
            />
            <TrendAreaChart
              colors={[CHART_COLORS.cyan, CHART_COLORS.violet]}
              height={300}
              kicker="Hourly performance"
              labels={distributionData.hourlyLabels}
              series={distributionData.hourlyLatency}
              subtitle="Average and p95 latency grouped by hour of day."
              title="Latency pressure"
              valueFormatter={formatDuration}
              yAxisFormatter={formatDurationAxis}
            />
          </div>
        </div>
      </section>

      <div className="sky-api-detail-grid mt-3">
        <section className="sky-card sky-table-card">
          <div className="sky-card-header d-flex align-items-start justify-content-between gap-3">
            <div>
              <div className="sky-page-kicker">Latency hotspots</div>
              <h2 className="h5 mb-0">Slowest normalized routes</h2>
              <div className="small sky-muted mt-1">Routes ordered by p95 response duration.</div>
            </div>
            <span className="sky-pill sky-pill-warning">Top {slowRoutes.length}</span>
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
                {slowRoutes.length === 0 ? (
                  <tr><td className="text-center sky-muted py-4" colSpan={6}>No route telemetry matches the selected filters.</td></tr>
                ) : (
                  slowRoutes.map((route) => (
                    <tr key={`${route.method}:${route.routeTemplate}`}>
                      <td><span className="sky-pill sky-pill-info">{route.method}</span></td>
                      <td className="sky-api-route-template">{route.routeTemplate}</td>
                      <td className="text-end">{formatCount(route.requestCount)}</td>
                      <td className="text-end">
                        <StatusPill label={formatCount(route.errorCount)} status={route.errorCount > 0 ? 'WARNING' : 'SUCCESS'} />
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

        <section className="sky-card sky-table-card">
          <div className="sky-card-header">
            <div className="sky-page-kicker">Access channel</div>
            <h2 className="h5 mb-0">Authentication modes</h2>
            <div className="small sky-muted mt-1">Request volume and average response time by authentication mode.</div>
          </div>
          <div className="table-responsive">
            <table className="table table-sm sky-table mb-0 align-middle">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th className="text-end">Requests</th>
                  <th className="text-end">Errors</th>
                  <th className="text-end">Average</th>
                </tr>
              </thead>
              <tbody>
                {authModes.length === 0 ? (
                  <tr><td className="text-center sky-muted py-4" colSpan={4}>No authentication telemetry matches the selected filters.</td></tr>
                ) : (
                  authModes.map((mode) => (
                    <tr key={mode.authMode}>
                      <td>{mode.authMode}</td>
                      <td className="text-end">{formatCount(mode.requestCount)}</td>
                      <td className="text-end">{formatCount(mode.errorCount)}</td>
                      <td className="text-end">{formatDuration(mode.averageDurationMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="sky-api-evidence-volume">
            <div><span>Request bytes</span><strong>{formatBytes(summary.requestBytes)}</strong></div>
            <div><span>Response bytes</span><strong>{formatBytes(summary.responseBytes)}</strong></div>
            <div><span>Total transfer</span><strong>{formatBytes(Number(summary.requestBytes || 0) + Number(summary.responseBytes || 0))}</strong></div>
          </div>
        </section>
      </div>
    </>
  );
}

export default ApiDashboard;
