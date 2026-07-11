import { useMemo } from 'react';
import { mean, rollups } from 'd3-array';
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

const STATUS_BUCKETS = [
  { key: 'SUCCESS', label: 'Success', color: SKY_GREEN },
  { key: 'FAILED', label: 'Failed', color: SKY_RED },
  { key: 'STARTED', label: 'Running', color: SKY_GOLD },
  { key: 'CANCELLED', label: 'Cancelled', color: SKY_BLUE },
  { key: 'OTHER', label: 'Other', color: SKY_VIOLET },
];

function normalizeStatus(value) {
  return String(value || 'UNKNOWN').toUpperCase();
}

function statusBucket(status) {
  const normalized = normalizeStatus(status);

  if (['SUCCESS', 'FAILED', 'STARTED', 'CANCELLED'].includes(normalized)) {
    return normalized;
  }

  return 'OTHER';
}

function getExecutionDate(execution) {
  const value = execution?.startedAt || execution?.finishedAt;

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

function getExecutionDurationMs(execution) {
  const durationMs = Number(execution?.durationMs);

  if (Number.isFinite(durationMs) && durationMs >= 0) {
    return durationMs;
  }

  return getDateDiffMs(execution?.startedAt, execution?.finishedAt);
}

function getToolName(execution) {
  return execution?.scriptName || execution?.metadata?.toolLabel || execution?.metadata?.toolCode || 'Unknown tool';
}

function getCategoryName(execution) {
  return execution?.category || execution?.metadata?.categoryCode || 'Uncategorized';
}

function buildRecentDaySeries(items, predicate = () => true, daysBack = 7) {
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
        .filter(predicate)
        .map((item) => getExecutionDate(item))
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

function countBy(items, getKey) {
  return rollups(
    items,
    (values) => values.length,
    getKey,
  )
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0);
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

function baseGrid() {
  return {
    left: 10,
    right: 18,
    top: 48,
    bottom: 8,
    containLabel: true,
  };
}

function baseCategoryAxis(labels, boundaryGap = false) {
  return {
    type: 'category',
    boundaryGap,
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

function buildStatusTrendOption(executions) {
  const successSeries = buildRecentDaySeries(
    executions,
    (execution) => statusBucket(execution.status) === 'SUCCESS',
  );
  const failedSeries = buildRecentDaySeries(
    executions,
    (execution) => statusBucket(execution.status) === 'FAILED',
  );
  const runningSeries = buildRecentDaySeries(
    executions,
    (execution) => statusBucket(execution.status) === 'STARTED',
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_RED, SKY_GOLD],
    tooltip: baseAxisTooltip(),
    legend: {
      top: 0,
      right: 8,
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    grid: baseGrid(),
    xAxis: baseCategoryAxis(successSeries.labels),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Success',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.14 },
        data: successSeries.values,
      },
      {
        name: 'Failed',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
        data: failedSeries.values,
      },
      {
        name: 'Running',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
        data: runningSeries.values,
      },
    ],
  };
}

function buildCategoryStackOption(executions) {
  const categories = countBy(executions, getCategoryName)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((item) => item.name)
    .reverse();

  const categoryCounts = new Map();
  for (const category of categories) {
    categoryCounts.set(category, new Map());
  }

  for (const execution of executions) {
    const category = getCategoryName(execution);

    if (!categoryCounts.has(category)) {
      continue;
    }

    const counts = categoryCounts.get(category);
    const bucket = statusBucket(execution.status);
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }

  return {
    backgroundColor: 'transparent',
    color: STATUS_BUCKETS.map((bucket) => bucket.color),
    tooltip: baseAxisTooltip(),
    legend: {
      top: 0,
      right: 8,
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    grid: {
      left: 8,
      right: 18,
      top: 52,
      bottom: 8,
      containLabel: true,
    },
    xAxis: baseValueAxis(),
    yAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 700,
        overflow: 'truncate',
        width: 132,
      },
    },
    series: STATUS_BUCKETS.map((bucket) => ({
      name: bucket.label,
      type: 'bar',
      stack: 'executions',
      barWidth: 18,
      emphasis: { focus: 'series' },
      data: categories.map((category) => categoryCounts.get(category)?.get(bucket.key) || 0),
      label: {
        show: true,
        formatter: ({ value }) => (value > 0 ? value : ''),
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 800,
      },
    })),
  };
}

function buildTopUsedToolsOption(executions) {
  const data = countBy(executions, getToolName)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .reverse();

  return {
    backgroundColor: 'transparent',
    color: [SKY_BLUE],
    tooltip: baseTooltip(),
    grid: {
      left: 8,
      right: 18,
      top: 16,
      bottom: 8,
      containLabel: true,
    },
    xAxis: baseValueAxis(),
    yAxis: {
      type: 'category',
      data: data.map((item) => item.name),
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 700,
        overflow: 'truncate',
        width: 150,
      },
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

function buildSlowToolsOption(executions) {
  const durationRows = executions
    .map((execution) => ({
      name: getToolName(execution),
      durationMs: getExecutionDurationMs(execution),
    }))
    .filter((item) => Number.isFinite(item.durationMs));

  const data = rollups(
    durationRows,
    (values) => Math.round(mean(values, (item) => item.durationMs) || 0),
    (item) => item.name,
  )
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .reverse();

  return {
    backgroundColor: 'transparent',
    color: [SKY_VIOLET],
    tooltip: {
      ...baseTooltip(),
      valueFormatter: (value) => `${(Number(value || 0) / 1000).toFixed(1)} s`,
    },
    grid: {
      left: 8,
      right: 18,
      top: 16,
      bottom: 8,
      containLabel: true,
    },
    xAxis: baseValueAxis((value) => `${Math.round(Number(value || 0) / 1000)}s`),
    yAxis: {
      type: 'category',
      data: data.map((item) => item.name),
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 700,
        overflow: 'truncate',
        width: 150,
      },
    },
    series: [
      {
        name: 'Avg duration',
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
          formatter: ({ value }) => `${(Number(value || 0) / 1000).toFixed(1)}s`,
        },
      },
    ],
  };
}

function buildDurationDistributionOption(executions) {
  const buckets = [
    { label: '< 1s', min: 0, max: 1000 },
    { label: '1-5s', min: 1000, max: 5000 },
    { label: '5-15s', min: 5000, max: 15000 },
    { label: '15-60s', min: 15000, max: 60000 },
    { label: '60s+', min: 60000, max: Number.POSITIVE_INFINITY },
  ];

  const values = buckets.map((bucket) =>
    executions.filter((execution) => {
      const durationMs = getExecutionDurationMs(execution);
      return Number.isFinite(durationMs) && durationMs >= bucket.min && durationMs < bucket.max;
    }).length,
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_CYAN],
    tooltip: baseAxisTooltip(),
    grid: baseGrid(),
    xAxis: baseCategoryAxis(buckets.map((bucket) => bucket.label), true),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Executions',
        type: 'bar',
        barWidth: 26,
        data: values,
        itemStyle: {
          borderRadius: [10, 10, 0, 0],
        },
        label: {
          show: true,
          position: 'top',
          color: CHART_TEXT,
          fontFamily: 'inherit',
          fontWeight: 800,
        },
      },
    ],
  };
}

function ToolsHistoryVisuals({ executions = [] }) {
  const statusTrendOption = useMemo(() => buildStatusTrendOption(executions), [executions]);
  const categoryStackOption = useMemo(() => buildCategoryStackOption(executions), [executions]);
  const topUsedToolsOption = useMemo(() => buildTopUsedToolsOption(executions), [executions]);
  const slowToolsOption = useMemo(() => buildSlowToolsOption(executions), [executions]);
  const durationDistributionOption = useMemo(
    () => buildDurationDistributionOption(executions),
    [executions],
  );

  return (
    <section className="sky-dashboard-visuals sky-tools-visuals mb-4">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Tool intelligence</div>
          <h2 className="h5 mb-0">Execution analytics layer</h2>
        </div>
        <span className="sky-muted small">Recent tool runs · category, quality, speed, and usage</span>
      </div>

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <EChartCard
          height={285}
          kicker="Execution quality"
          option={statusTrendOption}
          subtitle="Successful, failed, and running tool executions across the recent activity window."
          title="Success / failure trend"
        />
        <EChartCard
          height={285}
          kicker="Tool categories"
          option={categoryStackOption}
          subtitle="Recent tool executions grouped by category and status."
          title="Executions by category"
        />
        <EChartCard
          height={260}
          kicker="Tool usage"
          option={topUsedToolsOption}
          subtitle="Most frequently executed tools in the current recent window."
          title="Top-used tools"
        />
        <EChartCard
          height={260}
          kicker="Runtime pressure"
          option={slowToolsOption}
          subtitle="Tools with the highest average execution duration."
          title="Top slowest tools"
        />
        <EChartCard
          height={260}
          kicker="Duration profile"
          option={durationDistributionOption}
          subtitle="Tool executions grouped into runtime duration buckets."
          title="Runtime distribution"
        />
      </div>
    </section>
  );
}

export default ToolsHistoryVisuals;
