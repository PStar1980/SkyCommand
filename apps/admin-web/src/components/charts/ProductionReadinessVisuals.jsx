import { useMemo } from 'react';
import EChartCard from './EChartCard.jsx';

const CHART_TEXT = '#c8d7ef';
const CHART_MUTED = '#8094ba';
const CHART_GRID = 'rgba(124, 144, 177, 0.14)';
const SKY_BLUE = '#48a7ff';
const SKY_CYAN = '#50e3f2';
const SKY_GREEN = '#43e6a2';
const SKY_GOLD = '#f2cc60';
const SKY_RED = '#f06f8b';

const STATUS_BUCKETS = [
  { key: 'PASS', label: 'Pass', color: SKY_GREEN },
  { key: 'WARNING', label: 'Warning', color: SKY_GOLD },
  { key: 'FAIL', label: 'Fail', color: SKY_RED },
  { key: 'INFO', label: 'Info', color: SKY_BLUE },
];

function normalizeStatus(status) {
  return String(status || 'INFO').toUpperCase();
}

function countChecksByStatus(checks = []) {
  const counts = new Map(STATUS_BUCKETS.map((bucket) => [bucket.key, 0]));

  for (const check of checks) {
    const status = normalizeStatus(check.status);
    counts.set(status, (counts.get(status) || 0) + 1);
  }

  return counts;
}

function getSectionChecks(section) {
  return Array.isArray(section?.checks) ? section.checks : [];
}

function flattenChecks(sections = []) {
  return sections.flatMap((section) =>
    getSectionChecks(section).map((check) => ({
      ...check,
      sectionCode: section.code,
      sectionLabel: section.label || section.code || 'Readiness area',
    })),
  );
}

function getReadyScore(checks = []) {
  if (!checks.length) {
    return 0;
  }

  const statusScore = {
    PASS: 1,
    INFO: 0.72,
    WARNING: 0.34,
    FAIL: 0,
  };

  const total = checks.reduce((sum, check) => sum + (statusScore[normalizeStatus(check.status)] ?? 0.55), 0);

  return Math.max(0, Math.min(100, Math.round((total / checks.length) * 100)));
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
      type: 'shadow',
      shadowStyle: {
        color: 'rgba(80, 227, 242, 0.08)',
      },
    },
  };
}

function buildReadinessScoreOption(checks) {
  const score = getReadyScore(checks);
  const scoreColor = score >= 80 ? SKY_GREEN : score >= 55 ? SKY_GOLD : SKY_RED;

  return {
    backgroundColor: 'transparent',
    tooltip: baseTooltip(),
    series: [
      {
        name: 'Readiness score',
        type: 'gauge',
        min: 0,
        max: 100,
        radius: '84%',
        center: ['50%', '56%'],
        startAngle: 210,
        endAngle: -30,
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 18,
            color: [
              [0.55, SKY_RED],
              [0.8, SKY_GOLD],
              [1, SKY_GREEN],
            ],
          },
        },
        progress: {
          show: true,
          roundCap: true,
          width: 18,
          itemStyle: {
            color: scoreColor,
          },
        },
        pointer: {
          show: true,
          length: '58%',
          width: 5,
          itemStyle: {
            color: CHART_TEXT,
          },
        },
        anchor: {
          show: true,
          size: 10,
          itemStyle: {
            color: scoreColor,
            shadowBlur: 14,
            shadowColor: scoreColor,
          },
        },
        axisTick: {
          distance: -24,
          length: 6,
          lineStyle: {
            color: 'rgba(200, 215, 239, 0.42)',
            width: 1,
          },
        },
        splitLine: {
          distance: -28,
          length: 11,
          lineStyle: {
            color: 'rgba(200, 215, 239, 0.44)',
            width: 2,
          },
        },
        axisLabel: {
          distance: -10,
          color: CHART_MUTED,
          fontFamily: 'inherit',
          fontWeight: 700,
          fontSize: 10,
        },
        title: {
          offsetCenter: [0, '42%'],
          color: CHART_MUTED,
          fontFamily: 'inherit',
          fontWeight: 800,
          fontSize: 11,
        },
        detail: {
          offsetCenter: [0, '12%'],
          color: CHART_TEXT,
          fontFamily: 'inherit',
          fontWeight: 900,
          fontSize: 30,
          formatter: '{value}%',
        },
        data: [{ value: score, name: 'Weighted readiness' }],
      },
    ],
  };
}

function buildStatusMixOption(checks) {
  const counts = countChecksByStatus(checks);
  const data = STATUS_BUCKETS.map((bucket) => ({
    name: bucket.label,
    value: counts.get(bucket.key) || 0,
  })).filter((item) => item.value > 0);

  return {
    backgroundColor: 'transparent',
    color: STATUS_BUCKETS.map((bucket) => bucket.color),
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
        name: 'Checks',
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['40%', '52%'],
        avoidLabelOverlap: true,
        label: {
          color: CHART_TEXT,
          formatter: '{b}\n{d}%',
          fontFamily: 'inherit',
          fontWeight: 800,
        },
        labelLine: {
          lineStyle: { color: 'rgba(200, 215, 239, 0.28)' },
        },
        itemStyle: {
          borderColor: 'rgba(5, 10, 21, 0.86)',
          borderWidth: 3,
        },
        data: data.length ? data : [{ name: 'No checks', value: 1 }],
      },
    ],
  };
}

function buildChecksByCategoryOption(sections) {
  const labels = sections.map((section) => section.label || section.code || 'Readiness area').reverse();
  const sectionCounts = sections
    .map((section) => countChecksByStatus(getSectionChecks(section)))
    .reverse();

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
      top: 48,
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
      data: labels,
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 800,
        overflow: 'truncate',
        width: 150,
      },
    },
    series: STATUS_BUCKETS.map((bucket) => ({
      name: bucket.label,
      type: 'bar',
      stack: 'checks',
      barWidth: 18,
      emphasis: { focus: 'series' },
      data: sectionCounts.map((counts) => counts.get(bucket.key) || 0),
      label: {
        show: true,
        formatter: ({ value }) => (value > 0 ? value : ''),
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 900,
      },
    })),
  };
}

function buildHardeningProgressOption(sections) {
  const labels = sections.map((section) => section.label || section.code || 'Readiness area');
  const scores = sections.map((section) => getReadyScore(getSectionChecks(section)));

  return {
    backgroundColor: 'transparent',
    color: [SKY_CYAN],
    tooltip: baseAxisTooltip(),
    grid: {
      left: 12,
      right: 16,
      top: 18,
      bottom: 8,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: labels,
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
        interval: 0,
        rotate: 18,
        overflow: 'truncate',
        width: 92,
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      splitLine: { lineStyle: { color: CHART_GRID } },
      axisLabel: {
        color: CHART_MUTED,
        fontFamily: 'inherit',
        formatter: '{value}%',
      },
    },
    series: [
      {
        name: 'Readiness score',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.14 },
        data: scores,
        label: {
          show: true,
          position: 'top',
          formatter: '{c}%',
          color: CHART_TEXT,
          fontFamily: 'inherit',
          fontWeight: 900,
        },
      },
    ],
  };
}

function buildRiskConcentrationOption(sections) {
  const data = sections
    .map((section) => {
      const checks = getSectionChecks(section);
      const warningCount = checks.filter((check) => normalizeStatus(check.status) === 'WARNING').length;
      const failCount = checks.filter((check) => normalizeStatus(check.status) === 'FAIL').length;
      return {
        name: section.label || section.code || 'Readiness area',
        warningCount,
        failCount,
        total: warningCount + failCount,
      };
    })
    .filter((item) => item.total > 0)
    .sort((a, b) => a.total - b.total);

  const labels = data.map((item) => item.name);

  return {
    backgroundColor: 'transparent',
    color: [SKY_GOLD, SKY_RED],
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
      top: 48,
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
      data: labels.length ? labels : ['No active risks'],
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_TEXT,
        fontFamily: 'inherit',
        fontWeight: 800,
        overflow: 'truncate',
        width: 150,
      },
    },
    series: [
      {
        name: 'Warnings',
        type: 'bar',
        stack: 'risk',
        barWidth: 18,
        data: data.length ? data.map((item) => item.warningCount) : [0],
        label: {
          show: true,
          formatter: ({ value }) => (value > 0 ? value : ''),
          color: CHART_TEXT,
          fontFamily: 'inherit',
          fontWeight: 900,
        },
      },
      {
        name: 'Failures',
        type: 'bar',
        stack: 'risk',
        barWidth: 18,
        data: data.length ? data.map((item) => item.failCount) : [0],
        label: {
          show: true,
          formatter: ({ value }) => (value > 0 ? value : ''),
          color: CHART_TEXT,
          fontFamily: 'inherit',
          fontWeight: 900,
        },
      },
    ],
  };
}

function ProductionReadinessVisuals({ readiness }) {
  const sections = useMemo(() => (Array.isArray(readiness?.sections) ? readiness.sections : []), [readiness]);
  const checks = useMemo(() => flattenChecks(sections), [sections]);
  const readyScoreOption = useMemo(() => buildReadinessScoreOption(checks), [checks]);
  const statusMixOption = useMemo(() => buildStatusMixOption(checks), [checks]);
  const categoryOption = useMemo(() => buildChecksByCategoryOption(sections), [sections]);
  const hardeningProgressOption = useMemo(() => buildHardeningProgressOption(sections), [sections]);
  const riskConcentrationOption = useMemo(() => buildRiskConcentrationOption(sections), [sections]);

  return (
    <section className="sky-dashboard-visuals sky-production-readiness-visuals mb-4">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Readiness intelligence</div>
          <h2 className="h5 mb-0">Hardening analytics layer</h2>
        </div>
        <span className="sky-muted small">
          {checks.length} checks · {sections.length} readiness areas · expandable ECharts overlays
        </span>
      </div>

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded">
        <EChartCard
          height={280}
          kicker="Readiness score"
          option={readyScoreOption}
          subtitle="Weighted production-readiness score across pass, warning, fail, and info checks."
          title="Hardening score"
        />
        <EChartCard
          height={280}
          kicker="Readiness mix"
          option={statusMixOption}
          subtitle="Pass, warning, failure, and info checks across the current checklist."
          title="Check status mix"
        />
        <EChartCard
          className="sky-dashboard-chart-wide"
          height={280}
          kicker="Category coverage"
          option={categoryOption}
          subtitle="Checks grouped by readiness area and current outcome."
          title="Checks by category"
        />
        <EChartCard
          className="sky-dashboard-chart-wide"
          height={260}
          kicker="Hardening progress"
          option={hardeningProgressOption}
          subtitle="Weighted readiness percentage by checklist area from the current snapshot."
          title="Progress by area"
        />
        <EChartCard
          height={260}
          kicker="Risk focus"
          option={riskConcentrationOption}
          subtitle="Warning and failure concentration by readiness area."
          title="Risk concentration"
        />
      </div>
    </section>
  );
}

export default ProductionReadinessVisuals;
