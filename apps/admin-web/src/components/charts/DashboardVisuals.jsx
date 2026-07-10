import { useMemo } from 'react';
import { rollups } from 'd3-array';
import { timeDay } from 'd3-time';
import { timeFormat } from 'd3-time-format';
import EChartCard from './EChartCard.jsx';

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

function buildActivityOption(executions, audits) {
  const executionSeries = buildRecentDaySeries(executions, 'startedAt');
  const auditSeries = buildRecentDaySeries(audits, 'createdAt');

  return {
    backgroundColor: 'transparent',
    color: [SKY_BLUE, SKY_VIOLET],
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: 'rgba(80, 227, 242, 0.35)',
        },
      },
    },
    legend: {
      top: 0,
      right: 8,
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    grid: {
      left: 10,
      right: 12,
      top: 44,
      bottom: 8,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: executionSeries.labels,
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: { color: CHART_MUTED, fontFamily: 'inherit' },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: CHART_GRID } },
      axisLabel: { color: CHART_MUTED, fontFamily: 'inherit' },
    },
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

function DashboardVisuals({ ingestionCounts, recentAudits, recentExecutions }) {
  const activityOption = useMemo(
    () => buildActivityOption(recentExecutions, recentAudits),
    [recentAudits, recentExecutions],
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

      <div className="sky-dashboard-chart-grid">
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
