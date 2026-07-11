export const CHART_COLORS = {
  text: '#c8d7ef',
  muted: '#8094ba',
  grid: 'rgba(124, 144, 177, 0.14)',
  blue: '#48a7ff',
  cyan: '#50e3f2',
  violet: '#896dff',
  green: '#43e6a2',
  gold: '#f2cc60',
  red: '#f06f8b',
};

export const STATUS_COLORS = {
  ACTIVE: CHART_COLORS.green,
  CANCELED: CHART_COLORS.violet,
  COMPLETED: CHART_COLORS.green,
  CURRENT: CHART_COLORS.green,
  ERROR: CHART_COLORS.red,
  FAIL: CHART_COLORS.red,
  FAILED: CHART_COLORS.red,
  INACTIVE: CHART_COLORS.violet,
  INFO: CHART_COLORS.blue,
  MISSING_TABLE: CHART_COLORS.red,
  NO_DATA: CHART_COLORS.blue,
  ONLINE: CHART_COLORS.green,
  PASS: CHART_COLORS.green,
  PROBLEMS: CHART_COLORS.red,
  QUEUED: CHART_COLORS.blue,
  RUNNING: CHART_COLORS.blue,
  STALE: CHART_COLORS.gold,
  STARTED: CHART_COLORS.blue,
  SUCCESS: CHART_COLORS.green,
  TERMINATED: CHART_COLORS.gold,
  TIMED_OUT: CHART_COLORS.red,
  WARNING: CHART_COLORS.gold,
};

export function normalizeChartStatus(value) {
  return String(value || 'UNKNOWN').toUpperCase();
}

export function getStatusColor(status, fallback = CHART_COLORS.blue) {
  return STATUS_COLORS[normalizeChartStatus(status)] || fallback;
}

export function baseTooltip() {
  return {
    trigger: 'item',
    backgroundColor: 'rgba(5, 10, 21, 0.96)',
    borderColor: 'rgba(124, 144, 177, 0.24)',
    textStyle: {
      color: CHART_COLORS.text,
      fontFamily: 'inherit',
    },
  };
}

export function baseAxisTooltip() {
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

export function baseChartGrid(overrides = {}) {
  return {
    left: 10,
    right: 12,
    top: 44,
    bottom: 8,
    containLabel: true,
    ...overrides,
  };
}

export function baseHorizontalBarGrid(overrides = {}) {
  return baseChartGrid({
    left: 8,
    right: 12,
    top: 16,
    bottom: 8,
    ...overrides,
  });
}

export function baseLegend(overrides = {}) {
  return {
    top: 0,
    right: 8,
    textStyle: {
      color: CHART_COLORS.muted,
      fontFamily: 'inherit',
    },
    ...overrides,
  };
}

export function baseVerticalLegend(overrides = {}) {
  return baseLegend({
    orient: 'vertical',
    right: 0,
    top: 'middle',
    ...overrides,
  });
}

export function baseCategoryAxis(labels, { boundaryGap = false, labelColor = CHART_COLORS.muted } = {}) {
  return {
    type: 'category',
    boundaryGap,
    data: labels,
    axisLine: { lineStyle: { color: CHART_COLORS.grid } },
    axisTick: { show: false },
    axisLabel: { color: labelColor, fontFamily: 'inherit' },
  };
}

export function baseValueAxis(formatter) {
  return {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: CHART_COLORS.grid } },
    axisLabel: { color: CHART_COLORS.muted, fontFamily: 'inherit', formatter },
  };
}

export function basePieLabel(overrides = {}) {
  return {
    color: CHART_COLORS.text,
    formatter: '{b}\n{d}%',
    fontFamily: 'inherit',
    fontWeight: 700,
    ...overrides,
  };
}

export function basePieLabelLine() {
  return {
    lineStyle: { color: 'rgba(200, 215, 239, 0.28)' },
  };
}

export function basePieItemStyle() {
  return {
    borderColor: 'rgba(5, 10, 21, 0.86)',
    borderWidth: 3,
  };
}
