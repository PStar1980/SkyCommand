import { useMemo } from 'react';
import { mean, rollups } from 'd3-array';
import { timeDay } from 'd3-time';
import { timeFormat } from 'd3-time-format';
import EChartCard from './EChartCard.jsx';
import { StatusDot } from '../ui/StatusPill.jsx';

const CHART_TEXT = '#c8d7ef';
const CHART_MUTED = '#8094ba';
const CHART_GRID = 'rgba(124, 144, 177, 0.14)';
const SKY_BLUE = '#48a7ff';
const SKY_CYAN = '#50e3f2';
const SKY_VIOLET = '#896dff';
const SKY_GREEN = '#43e6a2';
const SKY_GOLD = '#f2cc60';
const SKY_RED = '#f06f8b';

function dateFromField(item, fieldName) {
  const value = item?.[fieldName];

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateDiffMs(start, end) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;

  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  return Math.max(0, endDate.getTime() - startDate.getTime());
}

function getRunDurationMs(run) {
  const metadataDuration = Number(run?.metadata?.durationMs);

  if (Number.isFinite(metadataDuration) && metadataDuration >= 0) {
    return metadataDuration;
  }

  return getDateDiffMs(run?.startedAt || run?.createdAt, run?.completedAt);
}

function buildRecentDaySeries(items, fieldName, daysBack = 7) {
  const today = timeDay.floor(new Date());
  const days = Array.from({ length: daysBack }, (_, index) =>
    timeDay.offset(today, index - (daysBack - 1)),
  );
  const formatKey = timeFormat('%Y-%m-%d');
  const formatLabel = timeFormat('%b %d');
  const startDate = days[0];

  const rolled = new Map(
    rollups(
      items
        .map((item) => dateFromField(item, fieldName))
        .filter((date) => date && date >= startDate),
      (values) => values.length,
      (date) => formatKey(timeDay.floor(date)),
    ),
  );

  return {
    labels: days.map((date) => formatLabel(date)),
    values: days.map((date) => rolled.get(formatKey(date)) || 0),
  };
}

function buildRecentDayDurationSeries(items, daysBack = 7) {
  const today = timeDay.floor(new Date());
  const days = Array.from({ length: daysBack }, (_, index) =>
    timeDay.offset(today, index - (daysBack - 1)),
  );
  const formatKey = timeFormat('%Y-%m-%d');
  const formatLabel = timeFormat('%b %d');
  const startDate = days[0];

  const durationRows = items
    .map((item) => ({
      date: dateFromField(item, 'startedAt') || dateFromField(item, 'createdAt'),
      durationMs: getRunDurationMs(item),
    }))
    .filter((item) => item.date && item.date >= startDate && Number.isFinite(item.durationMs));

  const rolled = new Map(
    rollups(
      durationRows,
      (values) => Math.round(mean(values, (item) => item.durationMs) || 0),
      (item) => formatKey(timeDay.floor(item.date)),
    ),
  );

  return {
    labels: days.map((date) => formatLabel(date)),
    values: days.map((date) => rolled.get(formatKey(date)) || 0),
  };
}

function countByField(items, fieldName, statusOrder = []) {
  const rolled = new Map(
    rollups(
      items,
      (values) => values.length,
      (item) => item?.[fieldName] || 'UNKNOWN',
    ),
  );

  const ordered = statusOrder.map((status) => ({
    name: status,
    value: rolled.get(status) || 0,
  }));

  for (const [status, value] of rolled.entries()) {
    if (!statusOrder.includes(status)) {
      ordered.push({ name: status, value });
    }
  }

  return ordered.filter((item) => item.value > 0);
}

function baseTooltip() {
  return {
    trigger: 'item',
    backgroundColor: 'rgba(5, 10, 21, 0.96)',
    borderColor: 'rgba(124, 144, 177, 0.24)',
    textStyle: {
      color: CHART_TEXT,
      fontFamily: 'inherit',
    },
  };
}

function baseAxisTooltip() {
  return {
    ...baseTooltip(),
    trigger: 'axis',
    axisPointer: {
      type: 'line',
      lineStyle: {
        color: 'rgba(80, 227, 242, 0.35)',
      },
    },
  };
}

function baseChartGrid() {
  return {
    left: 10,
    right: 12,
    top: 44,
    bottom: 8,
    containLabel: true,
  };
}

function baseCategoryAxis(labels) {
  return {
    type: 'category',
    boundaryGap: false,
    data: labels,
    axisLine: { lineStyle: { color: CHART_GRID } },
    axisTick: { show: false },
    axisLabel: { color: CHART_MUTED, fontFamily: 'inherit' },
  };
}

function baseValueAxis(formatter) {
  return {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: CHART_GRID } },
    axisLabel: { color: CHART_MUTED, fontFamily: 'inherit', formatter },
  };
}

function buildActivityOption(executions, audits) {
  const executionSeries = buildRecentDaySeries(executions, 'startedAt');
  const auditSeries = buildRecentDaySeries(audits, 'createdAt');

  return {
    backgroundColor: 'transparent',
    color: [SKY_BLUE, SKY_VIOLET],
    tooltip: baseAxisTooltip(),
    legend: {
      top: 0,
      right: 8,
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    grid: baseChartGrid(),
    xAxis: baseCategoryAxis(executionSeries.labels),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Tool runs',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.16 },
        data: executionSeries.values,
      },
      {
        name: 'Audit events',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.1 },
        data: auditSeries.values,
      },
    ],
  };
}

function buildWorkflowActivityOption(workflowRuns) {
  const completedSeries = buildRecentDaySeries(
    workflowRuns.filter((run) => String(run.status || '').toUpperCase() === 'COMPLETED'),
    'startedAt',
  );
  const failedSeries = buildRecentDaySeries(
    workflowRuns.filter((run) => ['FAILED', 'TERMINATED', 'CANCELED'].includes(String(run.status || '').toUpperCase())),
    'startedAt',
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_RED],
    tooltip: baseAxisTooltip(),
    legend: {
      top: 0,
      right: 8,
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    grid: baseChartGrid(),
    xAxis: baseCategoryAxis(completedSeries.labels),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Completed',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.14 },
        data: completedSeries.values,
      },
      {
        name: 'Failed / stopped',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
        data: failedSeries.values,
      },
    ],
  };
}

function buildRuntimePressureOption(workflowRuns) {
  const durationSeries = buildRecentDayDurationSeries(workflowRuns);

  return {
    backgroundColor: 'transparent',
    color: [SKY_CYAN],
    tooltip: {
      ...baseAxisTooltip(),
      valueFormatter: (value) => `${Math.round(Number(value || 0) / 1000)} s`,
    },
    grid: baseChartGrid(),
    xAxis: baseCategoryAxis(durationSeries.labels),
    yAxis: baseValueAxis((value) => `${Math.round(Number(value || 0) / 1000)}s`),
    series: [
      {
        name: 'Avg duration',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.16 },
        data: durationSeries.values,
      },
    ],
  };
}

function buildFreshnessOption(ingestionCounts) {
  const problems =
    Number(ingestionCounts.errorIndicators || 0) +
    Number(ingestionCounts.missingTableIndicators || 0);
  const data = [
    { name: 'Current', value: Number(ingestionCounts.currentIndicators || 0) },
    { name: 'Stale', value: Number(ingestionCounts.staleIndicators || 0) },
    { name: 'No data', value: Number(ingestionCounts.noDataIndicators || 0) },
    { name: 'Problems', value: problems },
  ].filter((item) => item.value > 0);

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_GOLD, SKY_BLUE, SKY_RED],
    tooltip: baseTooltip(),
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    series: [
      {
        name: 'Indicators',
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['40%', '52%'],
        avoidLabelOverlap: true,
        label: {
          color: CHART_TEXT,
          formatter: '{b}\n{d}%',
          fontFamily: 'inherit',
          fontWeight: 700,
        },
        labelLine: {
          lineStyle: { color: 'rgba(200, 215, 239, 0.28)' },
        },
        itemStyle: {
          borderColor: 'rgba(5, 10, 21, 0.86)',
          borderWidth: 3,
        },
        data: data.length ? data : [{ name: 'No data', value: 1 }],
      },
    ],
  };
}

function buildWorkflowOutcomeOption(workflowRuns) {
  const data = countByField(workflowRuns, 'status', [
    'COMPLETED',
    'FAILED',
    'TERMINATED',
    'CANCELED',
    'RUNNING',
  ]);

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_RED, SKY_GOLD, SKY_VIOLET, SKY_BLUE],
    tooltip: baseTooltip(),
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    series: [
      {
        name: 'Workflow runs',
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['40%', '52%'],
        avoidLabelOverlap: true,
        label: {
          color: CHART_TEXT,
          formatter: '{b}\n{d}%',
          fontFamily: 'inherit',
          fontWeight: 700,
        },
        labelLine: {
          lineStyle: { color: 'rgba(200, 215, 239, 0.28)' },
        },
        itemStyle: {
          borderColor: 'rgba(5, 10, 21, 0.86)',
          borderWidth: 3,
        },
        data: data.length ? data : [{ name: 'No data', value: 1 }],
      },
    ],
  };
}

function buildExecutionStatusOption(executions) {
  const data = countByField(executions, 'status', ['SUCCESS', 'STARTED', 'FAILED', 'TERMINATED']);

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_BLUE, SKY_RED, SKY_GOLD, SKY_VIOLET],
    tooltip: baseTooltip(),
    grid: {
      left: 8,
      right: 12,
      top: 16,
      bottom: 8,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: CHART_GRID } },
      axisLabel: { color: CHART_MUTED, fontFamily: 'inherit' },
    },
    yAxis: {
      type: 'category',
      data: data.map((item) => item.name),
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: { color: CHART_TEXT, fontFamily: 'inherit', fontWeight: 700 },
    },
    series: [
      {
        name: 'Executions',
        type: 'bar',
        barWidth: 18,
        data: data.map((item) => item.value),
        itemStyle: {
          borderRadius: [0, 10, 10, 0],
        },
        label: {
          show: true,
          position: 'right',
          color: CHART_TEXT,
          fontFamily: 'inherit',
          fontWeight: 800,
        },
      },
    ],
  };
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
  ingestionCounts,
  recentAudits,
  recentExecutions,
  systemStatusItems = [],
  workflowRuns = [],
}) {
  const activityOption = useMemo(
    () => buildActivityOption(recentExecutions, recentAudits),
    [recentAudits, recentExecutions],
  );
  const workflowActivityOption = useMemo(
    () => buildWorkflowActivityOption(workflowRuns),
    [workflowRuns],
  );
  const runtimePressureOption = useMemo(
    () => buildRuntimePressureOption(workflowRuns),
    [workflowRuns],
  );
  const workflowOutcomeOption = useMemo(
    () => buildWorkflowOutcomeOption(workflowRuns),
    [workflowRuns],
  );
  const freshnessOption = useMemo(
    () => buildFreshnessOption(ingestionCounts),
    [ingestionCounts],
  );
  const executionStatusOption = useMemo(
    () => buildExecutionStatusOption(recentExecutions),
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

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <EChartCard
          className="sky-dashboard-chart-wide"
          height={285}
          kicker="Weekly activity"
          option={activityOption}
          subtitle="Tool executions and audit events grouped across the last 7 days."
          title="Operations activity"
        />
        <EChartCard
          height={285}
          kicker="Workflow activity"
          option={workflowActivityOption}
          subtitle="Completed and stopped workflow runs across the last 7 days."
          title="Workflow run trend"
        />
        <EChartCard
          height={285}
          kicker="Runtime pressure"
          option={runtimePressureOption}
          subtitle="Average workflow run duration by day, based on recent completed runs."
          title="Average duration"
        />
        <EChartCard
          height={285}
          kicker="Workflow outcomes"
          option={workflowOutcomeOption}
          subtitle="Completed, failed, terminated, canceled, and running workflow runs."
          title="Workflow quality mix"
        />
        <EChartCard
          height={285}
          kicker="Macro freshness"
          option={freshnessOption}
          subtitle="Current, stale, no-data, and problem indicators at a glance."
          title="Indicator health mix"
        />
        <EChartCard
          height={285}
          kicker="Execution quality"
          option={executionStatusOption}
          subtitle="Recent tool execution outcomes from the latest dashboard load."
          title="Tool run status"
        />
      </div>
    </section>
  );
}

export default DashboardVisuals;
