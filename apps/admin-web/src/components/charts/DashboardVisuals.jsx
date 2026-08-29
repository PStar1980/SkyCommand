import { useMemo } from 'react';
import OutcomeBarChart from './OutcomeBarChart.jsx';
import StatusDonut from './StatusDonut.jsx';
import TrendAreaChart from './TrendAreaChart.jsx';
import {
  buildRecentDayDurationPercentileSeries,
  buildRecentDaySeriesFromField,
  countByField,
  dateFromField,
  getDateDiffMs,
} from './chartData.js';
import { CHART_COLORS } from './chartTheme.js';

const TOOL_ERROR_STATUSES = ['FAILED'];
const WORKFLOW_ERROR_STATUSES = ['FAILED'];
const AUTOMATION_ERROR_STATUSES = ['FAILED'];

function getRunDurationMs(run) {
  const metadataDuration = Number(run?.metadata?.durationMs);

  if (Number.isFinite(metadataDuration) && metadataDuration >= 0) {
    return metadataDuration;
  }

  return getDateDiffMs(run?.startedAt || run?.createdAt, run?.completedAt);
}

function buildActivitySeries(items, { dateField, errorStatuses = [] } = {}) {
  const runSeries = buildRecentDaySeriesFromField(items, dateField);
  const errorSeries = buildRecentDaySeriesFromField(
    items.filter((item) => errorStatuses.includes(String(item.status || '').toUpperCase())),
    dateField,
  );

  return {
    labels: runSeries.labels,
    series: [
      { name: 'Runs', values: runSeries.values, areaOpacity: 0.16 },
      { name: 'Errors', values: errorSeries.values, areaOpacity: 0.04 },
    ],
  };
}

function buildWorkflowPerformanceSeries(workflowRuns) {
  const completedRuns = workflowRuns.filter(
    (run) => String(run.status || '').toUpperCase() === 'COMPLETED',
  );
  const result = buildRecentDayDurationPercentileSeries(completedRuns, {
    dateAccessor: (run) => dateFromField(run, 'startedAt') || dateFromField(run, 'createdAt'),
    durationAccessor: getRunDurationMs,
    percentiles: [0.5, 0.95],
  });

  return {
    labels: result.labels,
    series: [
      { name: 'P50 duration', values: result.percentileValues[0] || [], areaOpacity: 0.08 },
      { name: 'P95 duration', values: result.percentileValues[1] || [], areaOpacity: 0.03 },
    ],
  };
}

function buildTopToolData(executions, limit = 5) {
  const counts = new Map();

  for (const execution of executions) {
    const label =
      execution?.metadata?.toolLabel ||
      execution?.metadata?.toolCode ||
      execution?.scriptName ||
      'Unknown tool';
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .reverse()
    .map(([name, value]) => ({ name, value }));
}

const formatSeconds = (value) => `${Math.round(Number(value || 0) / 1000)}s`;
const formatSecondsWithSpace = (value) => `${Math.round(Number(value || 0) / 1000)} s`;

function DashboardVisuals({ recentExecutions = [], scheduleRuns = [], workflowRuns = [] }) {
  const toolActivity = useMemo(
    () =>
      buildActivitySeries(recentExecutions, {
        dateField: 'startedAt',
        errorStatuses: TOOL_ERROR_STATUSES,
      }),
    [recentExecutions],
  );
  const workflowActivity = useMemo(
    () =>
      buildActivitySeries(workflowRuns, {
        dateField: 'startedAt',
        errorStatuses: WORKFLOW_ERROR_STATUSES,
      }),
    [workflowRuns],
  );
  const automationActivity = useMemo(
    () =>
      buildActivitySeries(scheduleRuns, {
        dateField: 'queuedAt',
        errorStatuses: AUTOMATION_ERROR_STATUSES,
      }),
    [scheduleRuns],
  );
  const topTools = useMemo(() => buildTopToolData(recentExecutions), [recentExecutions]);
  const workflowPerformance = useMemo(
    () => buildWorkflowPerformanceSeries(workflowRuns),
    [workflowRuns],
  );
  const automationOutcomes = useMemo(
    () =>
      countByField(scheduleRuns, 'status', [
        'SUCCESS',
        'FAILED',
        'STARTED',
        'QUEUED',
        'SKIPPED',
        'CANCELLED',
      ]),
    [scheduleRuns],
  );

  return (
    <section className="sky-dashboard-visuals mb-3">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Automation intelligence</div>
          <h2 className="h5 mb-0">Visual operations layer</h2>
        </div>
        <span className="sky-muted small">True 7-day window · Apache ECharts rendering</span>
      </div>

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <TrendAreaChart
          colors={[CHART_COLORS.cyan, CHART_COLORS.red]}
          height={285}
          kicker="Tool activity"
          labels={toolActivity.labels}
          series={toolActivity.series}
          subtitle="All tool executions and failed tool executions across the last 7 calendar days."
          title="Runs & errors"
        />
        <TrendAreaChart
          colors={[CHART_COLORS.green, CHART_COLORS.red]}
          height={285}
          kicker="Workflow activity"
          labels={workflowActivity.labels}
          series={workflowActivity.series}
          subtitle="All workflow runs and failed workflow runs across the last 7 calendar days."
          title="Runs & errors"
        />
        <TrendAreaChart
          colors={[CHART_COLORS.gold, CHART_COLORS.red]}
          height={285}
          kicker="Automation activity"
          labels={automationActivity.labels}
          series={automationActivity.series}
          subtitle="Scheduled executions and failed scheduled executions across the last 7 calendar days."
          title="Scheduled runs & errors"
        />
        <OutcomeBarChart
          barWidth={20}
          colors={[CHART_COLORS.cyan]}
          data={topTools}
          height={285}
          kicker="Tool utilization"
          name="Executions"
          subtitle="Top five tools by execution volume across the same 7-day window."
          title="Top executed tools"
        />
        <TrendAreaChart
          colors={[CHART_COLORS.gold, CHART_COLORS.violet]}
          height={285}
          kicker="Workflow performance"
          labels={workflowPerformance.labels}
          series={workflowPerformance.series}
          subtitle="Median and 95th-percentile duration for completed workflow runs by day."
          title="P50 / P95 duration"
          valueFormatter={formatSecondsWithSpace}
          yAxisFormatter={formatSeconds}
        />
        <StatusDonut
          colors={[
            CHART_COLORS.green,
            CHART_COLORS.red,
            CHART_COLORS.blue,
            CHART_COLORS.cyan,
            CHART_COLORS.gold,
            CHART_COLORS.violet,
          ]}
          data={automationOutcomes}
          height={285}
          kicker="Automation reliability"
          name="Schedule runs"
          subtitle="Outcome distribution for scheduled executions across the same 7-day window."
          title="Schedule outcome mix"
        />
      </div>
    </section>
  );
}

export default DashboardVisuals;
