export const CHART_COLORS = {
  text: '#c8d7ef',
  muted: '#9aadd0',
  grid: 'rgba(124, 144, 177, 0.14)',
  blue: '#48a7ff',
  cyan: '#50e3f2',
  violet: '#896dff',
  green: '#43e6a2',
  gold: '#f2cc60',
  red: '#f06f8b',
};

export const CHART_TYPOGRAPHY = {
  card: {
    tooltipFontSize: 14,
    tooltipLineHeight: 20,
    legendFontSize: 16,
    legendLineHeight: 22,
    axisFontSize: 16,
    axisLineHeight: 22,
    labelFontSize: 16,
    labelLineHeight: 22,
    axisLabelMargin: 14,
    legendItemWidth: 20,
    legendItemHeight: 12,
    legendItemGap: 18,
  },
  overlay: {
    tooltipFontSize: 20,
    tooltipLineHeight: 26,
    legendFontSize: 22,
    legendLineHeight: 28,
    axisFontSize: 22,
    axisLineHeight: 28,
    labelFontSize: 22,
    labelLineHeight: 28,
    axisLabelMargin: 16,
    legendItemWidth: 32,
    legendItemHeight: 18,
    legendItemGap: 24,
  },
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

function cloneChartValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneChartValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, cloneChartValue(nestedValue)]),
  );
}

function normalizeArrayOrObject(value, normalizer) {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === 'object' ? normalizer(item) : item));
  }

  if (value && typeof value === 'object') {
    return normalizer(value);
  }

  return value;
}

function withMinimumFontSize(textStyle = {}, minimumFontSize = 14, minimumLineHeight = 20) {
  const nextStyle = {
    ...textStyle,
    fontFamily: textStyle.fontFamily || 'inherit',
    fontSize: Math.max(Number(textStyle.fontSize || 0), minimumFontSize),
    lineHeight: Math.max(Number(textStyle.lineHeight || 0), minimumLineHeight),
  };

  if (textStyle.rich && typeof textStyle.rich === 'object') {
    nextStyle.rich = Object.fromEntries(
      Object.entries(textStyle.rich).map(([name, richStyle]) => [
        name,
        withMinimumFontSize(richStyle || {}, minimumFontSize, minimumLineHeight),
      ]),
    );
  }

  return nextStyle;
}

export function applyChartTypography(option, variant = 'card') {
  const typography = CHART_TYPOGRAPHY[variant] || CHART_TYPOGRAPHY.card;
  const normalized = cloneChartValue(option);

  if (!normalized || typeof normalized !== 'object') {
    return normalized;
  }

  normalized.textStyle = withMinimumFontSize(
    normalized.textStyle || {},
    typography.axisFontSize,
    typography.axisLineHeight,
  );

  if (normalized.tooltip && typeof normalized.tooltip === 'object') {
    normalized.tooltip = {
      ...normalized.tooltip,
      textStyle: withMinimumFontSize(
        normalized.tooltip.textStyle || {},
        typography.tooltipFontSize,
        typography.tooltipLineHeight,
      ),
    };
  }

  const normalizeLegend = (legend) => ({
    ...legend,
    itemWidth: Math.max(Number(legend.itemWidth || 0), typography.legendItemWidth),
    itemHeight: Math.max(Number(legend.itemHeight || 0), typography.legendItemHeight),
    itemGap: Math.max(Number(legend.itemGap || 0), typography.legendItemGap),
    textStyle: {
      fontWeight: 600,
      ...withMinimumFontSize(
        legend.textStyle || {},
        typography.legendFontSize,
        typography.legendLineHeight,
      ),
    },
    pageTextStyle: withMinimumFontSize(
      legend.pageTextStyle || {},
      typography.legendFontSize,
      typography.legendLineHeight,
    ),
    selectorLabel: legend.selectorLabel
      ? withMinimumFontSize(
          legend.selectorLabel,
          typography.legendFontSize,
          typography.legendLineHeight,
        )
      : legend.selectorLabel,
  });

  const normalizeAxis = (axis) => ({
    ...axis,
    axisLabel: {
      hideOverlap: true,
      margin: typography.axisLabelMargin,
      fontWeight: 650,
      ...withMinimumFontSize(
        axis.axisLabel || {},
        typography.axisFontSize,
        typography.axisLineHeight,
      ),
    },
    nameTextStyle: axis.nameTextStyle
      ? withMinimumFontSize(
          axis.nameTextStyle,
          typography.axisFontSize,
          typography.axisLineHeight,
        )
      : axis.nameTextStyle,
  });

  const normalizeSeries = (series) => ({
    ...series,
    axisLabel: series.axisLabel
      ? withMinimumFontSize(
          series.axisLabel,
          typography.axisFontSize,
          typography.axisLineHeight,
        )
      : series.axisLabel,
    label: series.label
      ? withMinimumFontSize(
          series.label,
          typography.labelFontSize,
          typography.labelLineHeight,
        )
      : series.label,
    title: series.title
      ? withMinimumFontSize(
          series.title,
          typography.labelFontSize,
          typography.labelLineHeight,
        )
      : series.title,
    detail: series.detail
      ? withMinimumFontSize(
          series.detail,
          typography.labelFontSize,
          typography.labelLineHeight,
        )
      : series.detail,
    emphasis:
      series.emphasis && typeof series.emphasis === 'object'
        ? {
            ...series.emphasis,
            label: series.emphasis.label
              ? withMinimumFontSize(
                  series.emphasis.label,
                  typography.labelFontSize,
                  typography.labelLineHeight,
                )
              : series.emphasis.label,
          }
        : series.emphasis,
  });

  if (normalized.legend) {
    normalized.legend = normalizeArrayOrObject(normalized.legend, normalizeLegend);
  }

  if (normalized.grid) {
    normalized.grid = normalizeArrayOrObject(normalized.grid, (grid) => ({
      ...grid,
      containLabel: true,
    }));
  }

  if (normalized.xAxis) {
    normalized.xAxis = normalizeArrayOrObject(normalized.xAxis, normalizeAxis);
  }

  if (normalized.yAxis) {
    normalized.yAxis = normalizeArrayOrObject(normalized.yAxis, normalizeAxis);
  }

  if (normalized.series) {
    normalized.series = normalizeArrayOrObject(normalized.series, normalizeSeries);
  }

  return normalized;
}

export function baseTooltip() {
  return {
    trigger: 'item',
    backgroundColor: 'rgba(5, 10, 21, 0.96)',
    borderColor: 'rgba(124, 144, 177, 0.24)',
    textStyle: {
      color: CHART_COLORS.text,
      fontFamily: 'inherit',
      fontSize: CHART_TYPOGRAPHY.card.tooltipFontSize,
      lineHeight: CHART_TYPOGRAPHY.card.tooltipLineHeight,
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
    right: 14,
    top: 52,
    bottom: 14,
    containLabel: true,
    ...overrides,
  };
}

export function baseHorizontalBarGrid(overrides = {}) {
  return baseChartGrid({
    left: 8,
    right: 18,
    top: 18,
    bottom: 12,
    ...overrides,
  });
}

export function baseLegend(overrides = {}) {
  return {
    top: 0,
    right: 8,
    itemWidth: CHART_TYPOGRAPHY.card.legendItemWidth,
    itemHeight: CHART_TYPOGRAPHY.card.legendItemHeight,
    itemGap: CHART_TYPOGRAPHY.card.legendItemGap,
    textStyle: {
      color: CHART_COLORS.muted,
      fontFamily: 'inherit',
      fontSize: CHART_TYPOGRAPHY.card.legendFontSize,
      lineHeight: CHART_TYPOGRAPHY.card.legendLineHeight,
      fontWeight: 600,
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
    axisLabel: {
      color: labelColor,
      fontFamily: 'inherit',
      fontSize: CHART_TYPOGRAPHY.card.axisFontSize,
      lineHeight: CHART_TYPOGRAPHY.card.axisLineHeight,
      fontWeight: 600,
      hideOverlap: true,
      margin: 12,
    },
  };
}

export function baseValueAxis(formatter) {
  return {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: CHART_COLORS.grid } },
    axisLabel: {
      color: CHART_COLORS.muted,
      fontFamily: 'inherit',
      fontSize: CHART_TYPOGRAPHY.card.axisFontSize,
      lineHeight: CHART_TYPOGRAPHY.card.axisLineHeight,
      fontWeight: 600,
      hideOverlap: true,
      margin: 12,
      formatter,
    },
  };
}

export function basePieLabel(overrides = {}) {
  return {
    color: CHART_COLORS.text,
    formatter: '{b}\n{d}%',
    fontFamily: 'inherit',
    fontSize: CHART_TYPOGRAPHY.card.labelFontSize,
    lineHeight: CHART_TYPOGRAPHY.card.labelLineHeight,
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
