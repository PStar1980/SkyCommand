import { useMemo } from 'react';
import { rollups } from 'd3-array';
import { timeDay } from 'd3-time';
import { timeFormat } from 'd3-time-format';
import EChartCard from './EChartCard.jsx';

const CHART_TEXT = '#d7e1ee';
const CHART_MUTED = '#8295ad';
const CHART_GRID = 'rgba(124, 144, 177, 0.14)';
const SKY_BLUE = '#65c8ff';
const SKY_CYAN = '#77ddff';
const SKY_VIOLET = '#8c78d8';
const SKY_GREEN = '#42d69b';
const SKY_GOLD = '#dcb13f';
const SKY_RED = '#ff6178';

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

function getRunDate(run) {
  return dateFromField(run, 'startedAt') || dateFromField(run, 'createdAt');
}

function buildRecentDayLabels(daysBack = 7) {
  const today = timeDay.floor(new Date());
  const days = Array.from({ length: daysBack }, (_, index) =>
    timeDay.offset(today, index - (daysBack - 1)),
  );
  const formatKey = timeFormat('%Y-%m-%d');
  const formatLabel = timeFormat('%b %d');

  return {
    days,
    formatKey,
    labels: days.map((date) => formatLabel(date)),
    startDate: days[0],
  };
}

function buildRecentDaySeries(items, getDate, predicate = () => true, daysBack = 7) {
  const { days, formatKey, labels, startDate } = buildRecentDayLabels(daysBack);

  const rolled = new Map(
    rollups(
      items
        .filter(predicate)
        .map(getDate)
        .filter((date) => date && date >= startDate),
      (values) => values.length,
      (date) => formatKey(timeDay.floor(date)),
    ),
  );

  return {
    labels,
    values: days.map((date) => rolled.get(formatKey(date)) || 0),
  };
}

function countStatuses(items, getStatus, statusOrder = []) {
  const rolled = new Map(
    rollups(
      items,
      (values) => values.length,
      (item) => normalizeStatus(getStatus(item)),
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

function baseGrid() {
  return {
    left: 10,
    right: 16,
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

function buildHeartbeatTimelineOption(heartbeats) {
  const recentSeries = buildRecentDaySeries(
    heartbeats,
    (heartbeat) => dateFromField(heartbeat, 'lastSeenAt'),
    (heartbeat) => Boolean(heartbeat.isRecent),
  );
  const staleSeries = buildRecentDaySeries(
    heartbeats,
    (heartbeat) => dateFromField(heartbeat, 'lastSeenAt'),
    (heartbeat) => !heartbeat.isRecent,
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_GOLD],
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
    xAxis: baseCategoryAxis(recentSeries.labels),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Recent heartbeat',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.14 },
        data: recentSeries.values,
      },
      {
        name: 'Stale heartbeat',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
        data: staleSeries.values,
      },
    ],
  };
}

function buildWorkerMixOption(heartbeats) {
  const data = countStatuses(
    heartbeats,
    (heartbeat) => (heartbeat.isRecent ? heartbeat.status || 'ONLINE' : 'STALE'),
    ['ONLINE', 'POLLING', 'STALE', 'OFFLINE'],
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_CYAN, SKY_GOLD, SKY_RED, SKY_BLUE, SKY_VIOLET],
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
        name: 'Worker heartbeats',
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
        data: data.length ? data : [{ name: 'No heartbeat data', value: 1 }],
      },
    ],
  };
}

function buildPollerOption(taskQueue = {}, pollers = []) {
  const workflowPollers = Number(taskQueue.workflowPollerCount || 0);
  const activityPollers = Number(taskQueue.activityPollerCount || 0);
  const totalPollers = Number(taskQueue.pollerCount || pollers.length || 0);
  const otherPollers = Math.max(0, totalPollers - workflowPollers - activityPollers);
  const categories = ['Workflow', 'Activity', 'Other'];
  const values = [workflowPollers, activityPollers, otherPollers];

  return {
    backgroundColor: 'transparent',
    color: [SKY_CYAN],
    tooltip: baseAxisTooltip(),
    grid: {
      left: 8,
      right: 22,
      top: 18,
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
      data: categories,
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 700,
      },
    },
    series: [
      {
        name: 'Pollers',
        type: 'bar',
        barWidth: 18,
        data: values,
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

function buildRunActivityOption(runs) {
  const completedSeries = buildRecentDaySeries(
    runs,
    getRunDate,
    (run) => normalizeStatus(run.status) === 'COMPLETED',
  );
  const activeSeries = buildRecentDaySeries(
    runs,
    getRunDate,
    (run) => ['RUNNING', 'QUEUED'].includes(normalizeStatus(run.status)),
  );
  const stoppedSeries = buildRecentDaySeries(
    runs,
    getRunDate,
    (run) => STOPPED_STATUSES.includes(normalizeStatus(run.status)),
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_GREEN, SKY_BLUE, SKY_RED],
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
        name: 'Running / queued',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
        data: activeSeries.values,
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

function buildGatePressureOption(health = {}, pendingApprovals = []) {
  const runs = health.runs || {};
  const approvals = health.approvals || {};
  const data = [
    { name: 'Pending approvals', value: Number(approvals.pending || pendingApprovals.length || 0) },
    { name: 'Running runs', value: Number(runs.running || 0) },
    { name: 'Queued runs', value: Number(runs.queued || 0) },
    { name: 'Stale runs', value: Number(runs.staleRunning || 0) },
  ];

  return {
    backgroundColor: 'transparent',
    color: [SKY_GOLD, SKY_BLUE, SKY_VIOLET, SKY_RED],
    tooltip: baseAxisTooltip(),
    grid: {
      left: 8,
      right: 22,
      top: 18,
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
      },
    },
    series: [
      {
        name: 'Pressure',
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

function WorkerHealthVisuals({ health = {}, pendingApprovals = [], runs = [] }) {
  const heartbeats = health?.worker?.heartbeats || [];
  const pollers = health?.taskQueue?.pollers || [];
  const heartbeatTimelineOption = useMemo(() => buildHeartbeatTimelineOption(heartbeats), [heartbeats]);
  const workerMixOption = useMemo(() => buildWorkerMixOption(heartbeats), [heartbeats]);
  const pollerOption = useMemo(
    () => buildPollerOption(health?.taskQueue || {}, pollers),
    [health?.taskQueue, pollers],
  );
  const runActivityOption = useMemo(() => buildRunActivityOption(runs), [runs]);
  const gatePressureOption = useMemo(
    () => buildGatePressureOption(health, pendingApprovals),
    [health, pendingApprovals],
  );

  return (
    <section className="sky-dashboard-visuals sky-worker-health-visuals mb-4 mt-3">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Worker health intelligence</div>
          <h2 className="h5 mb-0">Execution pulse layer</h2>
        </div>
        <span className="sky-muted small">Heartbeats, pollers, run pressure, and approval gates</span>
      </div>

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <EChartCard
          height={285}
          kicker="Heartbeat timeline"
          option={heartbeatTimelineOption}
          subtitle="Recent and stale worker check-ins grouped across the last 7 days."
          title="Worker heartbeat trend"
        />
        <EChartCard
          height={285}
          kicker="Worker mix"
          option={workerMixOption}
          subtitle="Current and stale SkyCommand worker heartbeat status distribution."
          title="Active vs stale workers"
        />
        <EChartCard
          height={260}
          kicker="Task queue polling"
          option={pollerOption}
          subtitle="Workflow, activity, and other Temporal poller coverage."
          title="Poller coverage"
        />
        <EChartCard
          height={260}
          kicker="Run throughput"
          option={runActivityOption}
          subtitle="Completed, running, queued, failed, and stopped workflow activity."
          title="Runs per day"
        />
        <EChartCard
          height={260}
          kicker="Approval pressure"
          option={gatePressureOption}
          subtitle="Pending approvals and queued/stale run pressure before execution resumes."
          title="Gate pressure"
        />
      </div>
    </section>
  );
}

export default WorkerHealthVisuals;
