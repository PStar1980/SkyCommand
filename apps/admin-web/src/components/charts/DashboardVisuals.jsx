import { useMemo } from 'react';
import ApiObservabilityPanel from './ApiObservabilityPanel.jsx';
import DurationTrendChart from './DurationTrendChart.jsx';
import OutcomeBarChart from './OutcomeBarChart.jsx';
import StatusDonut from './StatusDonut.jsx';
import TrendAreaChart from './TrendAreaChart.jsx';
import { buildRecentDayDurationSeries, buildRecentDaySeriesFromField, countByField, dateFromField, getDateDiffMs } from './chartData.js';
import { CHART_COLORS } from './chartTheme.js';
import { StatusDot } from '../ui/StatusPill.jsx';

const STOPPED_WORKFLOW_STATUSES = ['FAILED', 'TERMINATED', 'CANCELED'];

function getRunDurationMs(run) {
  const metadataDuration = Number(run?.metadata?.durationMs);

  if (Number.isFinite(metadataDuration) && metadataDuration >= 0) {
    return metadataDuration;
  }

  return getDateDiffMs(run?.startedAt || run?.createdAt, run?.completedAt);
}

function buildWorkflowRunSeries(workflowRuns) {
  const completedSeries = buildRecentDaySeriesFromField(
    workflowRuns.filter((run) => String(run.status || '').toUpperCase() === 'COMPLETED'),
    'startedAt',
  );
  const stoppedSeries = buildRecentDaySeriesFromField(
    workflowRuns.filter((run) => STOPPED_WORKFLOW_STATUSES.includes(String(run.status || '').toUpperCase())),
    'startedAt',
  );

  return {
    labels: completedSeries.labels,
    series: [
      { name: 'Completed', values: completedSeries.values, areaOpacity: 0.14 },
      { name: 'Failed / stopped', values: stoppedSeries.values, areaOpacity: 0.08 },
    ],
  };
}

function buildOperationsSeries(recentExecutions, recentAudits) {
  const executionSeries = buildRecentDaySeriesFromField(recentExecutions, 'startedAt');
  const auditSeries = buildRecentDaySeriesFromField(recentAudits, 'createdAt');

  return {
    labels: executionSeries.labels,
    series: [
      { name: 'Tool runs', values: executionSeries.values, areaOpacity: 0.16 },
      { name: 'Audit events', values: auditSeries.values, areaOpacity: 0.1 },
    ],
  };
}

function buildRuntimePressureSeries(workflowRuns) {
  return buildRecentDayDurationSeries(workflowRuns, {
    dateAccessor: (run) => dateFromField(run, 'startedAt') || dateFromField(run, 'createdAt'),
    durationAccessor: getRunDurationMs,
  });
}

function buildFreshnessData(ingestionCounts) {
  const problems =
    Number(ingestionCounts.errorIndicators || 0) +
    Number(ingestionCounts.missingTableIndicators || 0);

  return [
    { name: 'Current', value: Number(ingestionCounts.currentIndicators || 0) },
    { name: 'Stale', value: Number(ingestionCounts.staleIndicators || 0) },
    { name: 'No data', value: Number(ingestionCounts.noDataIndicators || 0) },
    { name: 'Problems', value: problems },
  ].filter((item) => item.value > 0);
}

function SystemHealthStrip({ items = [] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="sky-system-health-strip mb-3">
      {items.map((item) => (
        <div className="sky-system-health-card" key={item.label}>
          <div className="d-flex align-items-start justify-content-between gap-2">
            <div>
              <div className="sky-page-kicker">{item.label}</div>
              <div className="sky-system-health-value">{item.value}</div>
            </div>
            <StatusDot status={item.status} />
          </div>
          {item.helper && <div className="small sky-muted mt-2">{item.helper}</div>}
        </div>
      ))}
    </div>
  );
}

function DashboardVisuals({
  apiTelemetry,
  ingestionCounts,
  recentAudits,
  recentExecutions,
  systemStatusItems = [],
  workflowRuns = [],
}) {
  const operations = useMemo(
    () => buildOperationsSeries(recentExecutions, recentAudits),
    [recentAudits, recentExecutions],
  );
  const workflowActivity = useMemo(
    () => buildWorkflowRunSeries(workflowRuns),
    [workflowRuns],
  );
  const runtimePressure = useMemo(
    () => buildRuntimePressureSeries(workflowRuns),
    [workflowRuns],
  );
  const workflowOutcomes = useMemo(
    () => countByField(workflowRuns, 'status', ['COMPLETED', 'FAILED', 'TERMINATED', 'CANCELED', 'RUNNING']),
    [workflowRuns],
  );
  const freshnessData = useMemo(
    () => buildFreshnessData(ingestionCounts),
    [ingestionCounts],
  );
  const executionStatusData = useMemo(
    () => countByField(recentExecutions, 'status', ['SUCCESS', 'STARTED', 'FAILED', 'TERMINATED']),
    [recentExecutions],
  );

  return (
    <section className="sky-dashboard-visuals mb-3">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Automation intelligence</div>
          <h2 className="h5 mb-0">Visual operations layer</h2>
        </div>
        <span className="sky-muted small">Apache ECharts rendering · D3-powered grouping</span>
      </div>

      <SystemHealthStrip items={systemStatusItems} />

      <ApiObservabilityPanel data={apiTelemetry} />

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <TrendAreaChart
          colors={[CHART_COLORS.blue, CHART_COLORS.violet]}
          height={285}
          kicker="Weekly activity"
          labels={operations.labels}
          series={operations.series}
          subtitle="Tool executions and audit events grouped across the last 7 days."
          title="Operations activity"
        />
        <TrendAreaChart
          colors={[CHART_COLORS.green, CHART_COLORS.red]}
          height={285}
          kicker="Workflow activity"
          labels={workflowActivity.labels}
          series={workflowActivity.series}
          subtitle="Completed and stopped workflow runs across the last 7 days."
          title="Workflow run trend"
        />
        <DurationTrendChart
          height={285}
          labels={runtimePressure.labels}
          subtitle="Average workflow run duration by day, based on recent completed runs."
          title="Average duration"
          values={runtimePressure.values}
        />
        <StatusDonut
          colors={[CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.gold, CHART_COLORS.violet, CHART_COLORS.blue]}
          data={workflowOutcomes}
          height={285}
          kicker="Workflow outcomes"
          name="Workflow runs"
          subtitle="Completed, failed, terminated, canceled, and running workflow runs."
          title="Workflow quality mix"
        />
        <StatusDonut
          colors={[CHART_COLORS.green, CHART_COLORS.gold, CHART_COLORS.blue, CHART_COLORS.red]}
          data={freshnessData}
          height={285}
          kicker="Macro freshness"
          name="Indicators"
          subtitle="Current, stale, no-data, and problem indicators at a glance."
          title="Indicator health mix"
        />
        <OutcomeBarChart
          colors={[CHART_COLORS.green, CHART_COLORS.blue, CHART_COLORS.red, CHART_COLORS.gold, CHART_COLORS.violet]}
          data={executionStatusData}
          height={285}
          kicker="Execution quality"
          name="Executions"
          subtitle="Recent tool execution outcomes from the latest dashboard load."
          title="Tool run status"
        />
      </div>
    </section>
  );
}

export default DashboardVisuals;
