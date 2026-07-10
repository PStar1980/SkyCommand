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

const STOPPED_STATUSES = ['FAILED', 'TERMINATED', 'CANCELED', 'TIMED_OUT'];

function normalizeStatus(value) {
  return String(value || 'UNKNOWN').toUpperCase();
}

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

function getRunDate(run) {
  return dateFromField(run, 'startedAt') || dateFromField(run, 'createdAt');
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
        .map((item) => getRunDate(item))
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
      date: getRunDate(item),
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

function countBy(items, getKey) {
  return rollups(
    items,
    (values) => values.length,
    getKey,
  )
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0);
}

function countStatuses(items, statusOrder = []) {
  const rolled = new Map(countBy(items, (item) => normalizeStatus(item.status)).map((item) => [item.name, item.value]));
  const ordered = statusOrder.map((status) => ({ name: status, value: rolled.get(status) || 0 }));

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

function baseGrid() {
  return {
    left: 10,
    right: 14,
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

function buildRunTrendOption(runs) {
  const completedSeries = buildRecentDaySeries(
    runs,
    (run) => normalizeStatus(run.status) === 'COMPLETED',
  );
  const stoppedSeries = buildRecentDaySeries(
    runs,
    (run) => STOPPED_STATUSES.includes(normalizeStatus(run.status)),
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
    grid: baseGrid(),
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
        data: stoppedSeries.values,
      },
    ],
  };
}

function buildDurationTrendOption(runs) {
  const durationSeries = buildRecentDayDurationSeries(runs);

  return {
    backgroundColor: 'transparent',
    color: [SKY_CYAN],
    tooltip: {
      ...baseAxisTooltip(),
      valueFormatter: (value) => `${Math.round(Number(value || 0) / 1000)} s`,
    },
    grid: baseGrid(),
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

function buildFailureTrendOption(runs) {
  const failedSeries = buildRecentDaySeries(
    runs,
    (run) => STOPPED_STATUSES.includes(normalizeStatus(run.status)),
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_RED],
    tooltip: baseAxisTooltip(),
    grid: baseGrid(),
    xAxis: baseCategoryAxis(failedSeries.labels),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Failed / stopped',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.12 },
        data: failedSeries.values,
      },
    ],
  };
}

function buildOutcomeOption(runs) {
  const data = countStatuses(runs, [
    'COMPLETED',
    'FAILED',
    'TERMINATED',
    'CANCELED',
    'RUNNING',
    'QUEUED',
  ]);

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_RED, SKY_GOLD, SKY_VIOLET, SKY_BLUE, SKY_CYAN],
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

function buildRuntimeSplitOption(runs) {
  const temporalCount = runs.filter((run) => run.temporalWorkflowId || run.metadata?.temporalBacked).length;
  const inlineCount = Math.max(0, runs.length - temporalCount);
  const data = [
    { name: 'Temporal-backed', value: temporalCount },
    { name: 'Inline / local', value: inlineCount },
  ].filter((item) => item.value > 0);

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_BLUE],
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
        name: 'Runtime backend',
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

function buildRunsByDefinitionOption(runs) {
  const data = countBy(
    runs,
    (run) => run.workflowDisplayName || run.workflowCode || 'Unknown workflow',
  )
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .reverse();

  return {
    backgroundColor: 'transparent',
    color: [SKY_VIOLET],
    tooltip: baseTooltip(),
    grid: {
      left: 8,
      right: 16,
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
      axisLabel: {
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 700,
        overflow: 'truncate',
        width: 130,
      },
    },
    series: [
      {
        name: 'Runs',
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

function WorkflowHistoryVisuals({ runs = [] }) {
  const runTrendOption = useMemo(() => buildRunTrendOption(runs), [runs]);
  const durationTrendOption = useMemo(() => buildDurationTrendOption(runs), [runs]);
  const outcomeOption = useMemo(() => buildOutcomeOption(runs), [runs]);
  const definitionOption = useMemo(() => buildRunsByDefinitionOption(runs), [runs]);
  const failureTrendOption = useMemo(() => buildFailureTrendOption(runs), [runs]);
  const runtimeSplitOption = useMemo(() => buildRuntimeSplitOption(runs), [runs]);

  return (
    <section className="sky-dashboard-visuals sky-workflow-visuals mb-4">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Workflow intelligence</div>
          <h2 className="h5 mb-0">Run analytics layer</h2>
        </div>
        <span className="sky-muted small">Recent workflow runs · expandable ECharts overlays</span>
      </div>

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <EChartCard
          className="sky-dashboard-chart-wide"
          height={285}
          kicker="Workflow activity"
          option={runTrendOption}
          subtitle="Completed and stopped workflow runs across the recent run window."
          title="Workflow run trend"
        />
        <EChartCard
          height={285}
          kicker="Workflow outcomes"
          option={outcomeOption}
          subtitle="Completed, failed, terminated, canceled, queued, and running runs."
          title="Outcome mix"
        />
        <EChartCard
          height={260}
          kicker="Runtime pressure"
          option={durationTrendOption}
          subtitle="Average workflow duration by day from the recent run window."
          title="Duration trend"
        />
        <EChartCard
          height={260}
          kicker="Definition load"
          option={definitionOption}
          subtitle="Most active workflow definitions by recent run count."
          title="Runs by workflow"
        />
        <EChartCard
          height={260}
          kicker="Failure pressure"
          option={failureTrendOption}
          subtitle="Failed, terminated, and canceled workflow runs over time."
          title="Failures over time"
        />
        <EChartCard
          height={260}
          kicker="Runtime backend"
          option={runtimeSplitOption}
          subtitle="Temporal-backed runs compared with inline/local runs."
          title="Backend split"
        />
      </div>
    </section>
  );
}

export default WorkflowHistoryVisuals;
