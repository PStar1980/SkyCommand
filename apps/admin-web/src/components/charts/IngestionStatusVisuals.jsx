import { useMemo } from 'react';
import { mean, rollups } from 'd3-array';
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

const SOURCE_ORDER = ['FRED', 'BOC', 'STATCAN'];
function normalizeStatus(status) {
  return String(status || 'UNKNOWN').toUpperCase();
}

function normalizeSource(source) {
  return String(source || 'UNKNOWN').toUpperCase();
}

function getLatestDataDate(indicator) {
  const value = indicator?.stats?.maxDate || indicator?.latestDataDate;

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getExecutionDate(execution) {
  const value = execution?.startedAt || execution?.createdAt || execution?.finishedAt;

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getExecutionDurationMs(execution) {
  const value = Number(execution?.durationMs);

  if (Number.isFinite(value) && value >= 0) {
    return value;
  }

  return null;
}

function getSourceName(sourceCode, sources = []) {
  const source = sources.find((item) => normalizeSource(item.source) === normalizeSource(sourceCode));
  return source?.source || sourceCode || 'UNKNOWN';
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
    left: 12,
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

function countIndicatorStatuses(indicators) {
  const counts = new Map();

  for (const indicator of indicators) {
    const status = normalizeStatus(indicator.status);
    counts.set(status, (counts.get(status) || 0) + 1);
  }

  return counts;
}

function buildSourceFreshnessOption(summary = {}) {
  const problemCount =
    Number(summary?.missingTableIndicators || 0) + Number(summary?.errorIndicators || 0);
  const data = [
    { name: 'Current', value: Number(summary?.currentIndicators || 0) },
    { name: 'Stale', value: Number(summary?.staleIndicators || 0) },
    { name: 'No data', value: Number(summary?.noDataIndicators || 0) },
    { name: 'Problems', value: problemCount },
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

function buildIndicatorsBySourceOption(indicators, sources) {
  const sourceCounts = new Map();

  for (const source of sources) {
    const sourceCode = normalizeSource(source.source || source.sourceCode);
    const counts = source.counts || {};

    sourceCounts.set(
      sourceCode,
      new Map([
        ['CURRENT', Number(counts.current || 0)],
        ['STALE', Number(counts.stale || 0)],
        ['NO_DATA', Number(counts.noData || 0)],
        ['PROBLEMS', Number(counts.missingTable || 0) + Number(counts.error || 0)],
        ['INACTIVE', Number(counts.inactive || 0)],
      ]),
    );
  }

  if (sourceCounts.size === 0) {
    for (const source of SOURCE_ORDER) {
      sourceCounts.set(source, new Map());
    }

    for (const indicator of indicators) {
      const source = normalizeSource(indicator.source);
      const status = normalizeStatus(indicator.status);
      const bucket = status === 'MISSING_TABLE' || status === 'ERROR' ? 'PROBLEMS' : status;

      if (!sourceCounts.has(source)) {
        sourceCounts.set(source, new Map());
      }

      const counts = sourceCounts.get(source);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }
  }

  const orderedSourceCodes = [
    ...SOURCE_ORDER.filter((sourceCode) => sourceCounts.has(sourceCode)),
    ...Array.from(sourceCounts.keys()).filter((sourceCode) => !SOURCE_ORDER.includes(sourceCode)),
  ];
  const labels = orderedSourceCodes.map((sourceCode) => getSourceName(sourceCode, sources));
  const buckets = [
    { key: 'CURRENT', label: 'Current', color: SKY_GREEN },
    { key: 'STALE', label: 'Stale', color: SKY_GOLD },
    { key: 'NO_DATA', label: 'No data', color: SKY_BLUE },
    { key: 'PROBLEMS', label: 'Problems', color: SKY_RED },
    { key: 'INACTIVE', label: 'Inactive', color: SKY_VIOLET },
  ];

  return {
    backgroundColor: 'transparent',
    color: buckets.map((bucket) => bucket.color),
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
    xAxis: baseValueAxis(),
    yAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: { color: CHART_TEXT, fontFamily: 'inherit', fontWeight: 700 },
    },
    series: buckets.map((bucket) => ({
      name: bucket.label,
      type: 'bar',
      stack: 'indicators',
      barWidth: 18,
      data: orderedSourceCodes.map((sourceCode) => sourceCounts.get(sourceCode)?.get(bucket.key) || 0),
      itemStyle: {
        borderRadius: bucket.key === 'INACTIVE' ? [0, 10, 10, 0] : 0,
      },
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

function buildStaleAgeBucketOption(indicators) {
  const buckets = [
    { label: '0-7d', min: 0, max: 7 },
    { label: '8-30d', min: 8, max: 30 },
    { label: '31-60d', min: 31, max: 60 },
    { label: '61-90d', min: 61, max: 90 },
    { label: '90d+', min: 91, max: Infinity },
  ];

  const staleIndicators = indicators.filter((indicator) =>
    ['STALE', 'NO_DATA', 'MISSING_TABLE', 'ERROR'].includes(normalizeStatus(indicator.status)),
  );
  const counts = buckets.map((bucket) =>
    staleIndicators.filter((indicator) => {
      const daysOld = Number(indicator.daysSinceLatestData);
      return Number.isFinite(daysOld) && daysOld >= bucket.min && daysOld <= bucket.max;
    }).length,
  );

  return {
    backgroundColor: 'transparent',
    color: [SKY_GOLD],
    tooltip: baseAxisTooltip(),
    grid: baseChartGrid(),
    xAxis: baseCategoryAxis(buckets.map((bucket) => bucket.label), true),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Stale indicators',
        type: 'bar',
        barWidth: 30,
        data: counts,
        itemStyle: {
          borderRadius: [10, 10, 0, 0],
          color: SKY_GOLD,
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

function buildLatestDataDistributionOption(indicators) {
  const formatKey = timeFormat('%Y-%m');
  const formatLabel = timeFormat('%b %Y');
  const datedRows = indicators
    .map((indicator) => getLatestDataDate(indicator))
    .filter(Boolean)
    .sort((a, b) => a - b);

  const rolled = new Map(
    rollups(
      datedRows,
      (values) => values.length,
      (date) => formatKey(date),
    ),
  );
  const labels = Array.from(rolled.keys()).slice(-8);

  return {
    backgroundColor: 'transparent',
    color: [SKY_BLUE],
    tooltip: baseAxisTooltip(),
    grid: baseChartGrid(),
    xAxis: baseCategoryAxis(labels.map((label) => {
      const [year, month] = label.split('-').map(Number);
      return formatLabel(new Date(year, month - 1, 1));
    }), true),
    yAxis: baseValueAxis(),
    series: [
      {
        name: 'Indicators',
        type: 'bar',
        barWidth: 26,
        data: labels.map((label) => rolled.get(label) || 0),
        itemStyle: {
          borderRadius: [10, 10, 0, 0],
          color: SKY_BLUE,
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

function buildSourceRunDurationOption(executions, sources) {
  const today = timeDay.floor(new Date());
  const days = Array.from({ length: 7 }, (_, index) => timeDay.offset(today, index - 6));
  const formatKey = timeFormat('%Y-%m-%d');
  const formatLabel = timeFormat('%b %d');
  const startDate = days[0];

  const rows = executions
    .map((execution) => ({
      source: normalizeSource(execution.source),
      date: getExecutionDate(execution),
      durationMs: getExecutionDurationMs(execution),
    }))
    .filter((item) => item.date && item.date >= startDate && Number.isFinite(item.durationMs));

  const sourcesInRows = Array.from(new Set(rows.map((row) => row.source)));
  const chartSources = sourcesInRows.length
    ? sourcesInRows
    : SOURCE_ORDER.filter((source) => sources.some((item) => normalizeSource(item.source) === source));

  const rolled = rollups(
    rows,
    (values) => Math.round(mean(values, (item) => item.durationMs) || 0),
    (item) => item.source,
    (item) => formatKey(timeDay.floor(item.date)),
  );
  const sourceMap = new Map(rolled.map(([source, values]) => [source, new Map(values)]));

  return {
    backgroundColor: 'transparent',
    color: [SKY_BLUE, SKY_CYAN, SKY_VIOLET, SKY_GREEN, SKY_GOLD],
    tooltip: {
      ...baseAxisTooltip(),
      valueFormatter: (value) => `${Math.round(Number(value || 0) / 1000)} s`,
    },
    legend: {
      top: 0,
      right: 8,
      textStyle: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
      },
    },
    grid: baseChartGrid(),
    xAxis: baseCategoryAxis(days.map((date) => formatLabel(date))),
    yAxis: baseValueAxis((value) => `${Math.round(Number(value || 0) / 1000)}s`),
    series: chartSources.map((source) => ({
      name: getSourceName(source, sources),
      type: 'line',
      smooth: true,
      symbolSize: 7,
      lineStyle: { width: 3 },
      areaStyle: { opacity: 0.09 },
      data: days.map((date) => sourceMap.get(source)?.get(formatKey(date)) || 0),
    })),
  };
}

function buildExecutionStatusOption(executions) {
  const rolled = new Map(
    rollups(
      executions,
      (values) => values.length,
      (execution) => normalizeStatus(execution.status),
    ),
  );
  const data = ['SUCCESS', 'STARTED', 'FAILED', 'CANCELLED', 'UNKNOWN']
    .map((status) => ({ name: status === 'STARTED' ? 'RUNNING' : status, value: rolled.get(status) || 0 }))
    .filter((item) => item.value > 0);

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
    xAxis: baseValueAxis(),
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

function IngestionStatusVisuals({ indicators = [], recentExecutions = [], sources = [], summary = {} }) {
  const visibleStatusCounts = useMemo(() => countIndicatorStatuses(indicators), [indicators]);
  const sourceFreshnessOption = useMemo(() => buildSourceFreshnessOption(summary), [summary]);
  const sourceStackOption = useMemo(
    () => buildIndicatorsBySourceOption(indicators, sources),
    [indicators, sources],
  );
  const staleAgeOption = useMemo(() => buildStaleAgeBucketOption(indicators), [indicators]);
  const latestDataOption = useMemo(
    () => buildLatestDataDistributionOption(indicators),
    [indicators],
  );
  const durationOption = useMemo(
    () => buildSourceRunDurationOption(recentExecutions, sources),
    [recentExecutions, sources],
  );
  const executionStatusOption = useMemo(
    () => buildExecutionStatusOption(recentExecutions),
    [recentExecutions],
  );

  return (
    <section className="sky-dashboard-visuals mt-4 mb-3">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Ingestion intelligence</div>
          <h2 className="h5 mb-0">Macro pipeline analytics</h2>
        </div>
        <span className="sky-muted small">
          {indicators.length} visible indicators · {recentExecutions.length} recent runs ·{' '}
          {visibleStatusCounts.get('CURRENT') || 0} current
        </span>
      </div>

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <EChartCard
          height={285}
          kicker="Source freshness"
          option={sourceFreshnessOption}
          subtitle="Current, stale, no-data, and problem indicators across the macro pipeline."
          title="Freshness mix"
        />
        <EChartCard
          height={285}
          kicker="Source composition"
          option={sourceStackOption}
          subtitle="Configured indicators grouped by source and freshness state."
          title="Indicators by source"
        />
        <EChartCard
          height={285}
          kicker="Stale age"
          option={staleAgeOption}
          subtitle="Stale/problem indicators bucketed by days since latest data."
          title="Stale age buckets"
        />
        <EChartCard
          height={285}
          kicker="Latest data"
          option={latestDataOption}
          subtitle="Visible indicators grouped by the month of their latest available data."
          title="Latest data distribution"
        />
        <EChartCard
          height={285}
          kicker="Run duration"
          option={durationOption}
          subtitle="Average ingestion run duration by source across the last 7 days."
          title="Source runtime trend"
        />
        <EChartCard
          height={285}
          kicker="Execution quality"
          option={executionStatusOption}
          subtitle="Recent ingestion execution outcomes from the current result set."
          title="Ingestion run status"
        />
      </div>
    </section>
  );
}

export default IngestionStatusVisuals;
