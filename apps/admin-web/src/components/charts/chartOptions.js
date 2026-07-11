import {
  CHART_COLORS,
  baseAxisTooltip,
  baseCategoryAxis,
  baseChartGrid,
  baseHorizontalBarGrid,
  baseLegend,
  basePieItemStyle,
  basePieLabel,
  basePieLabelLine,
  baseTooltip,
  baseValueAxis,
  baseVerticalLegend,
} from './chartTheme.js';

const NO_DATA_SLICE = [{ name: 'No data', value: 1 }];

export function buildTrendAreaOption({
  colors = [CHART_COLORS.blue],
  grid,
  labels = [],
  series = [],
  valueFormatter,
  yAxisFormatter,
} = {}) {
  return {
    backgroundColor: 'transparent',
    color: colors,
    tooltip: {
      ...baseAxisTooltip(),
      ...(valueFormatter ? { valueFormatter } : {}),
    },
    legend: baseLegend(),
    grid: baseChartGrid(grid),
    xAxis: baseCategoryAxis(labels),
    yAxis: baseValueAxis(yAxisFormatter),
    series: series.map((item, index) => ({
      name: item.name,
      type: 'line',
      smooth: item.smooth ?? true,
      symbolSize: item.symbolSize ?? 7,
      lineStyle: { width: item.lineWidth ?? 3, ...(item.lineStyle || {}) },
      areaStyle: { opacity: item.areaOpacity ?? (index === 0 ? 0.16 : 0.1), ...(item.areaStyle || {}) },
      data: item.values || item.data || [],
    })),
  };
}

export function buildDonutOption({
  center = ['40%', '52%'],
  colors = [CHART_COLORS.green, CHART_COLORS.gold, CHART_COLORS.blue, CHART_COLORS.red],
  data = [],
  name = 'Status',
  radius = ['52%', '76%'],
} = {}) {
  return {
    backgroundColor: 'transparent',
    color: colors,
    tooltip: baseTooltip(),
    legend: baseVerticalLegend(),
    series: [
      {
        name,
        type: 'pie',
        radius,
        center,
        avoidLabelOverlap: true,
        label: basePieLabel(),
        labelLine: basePieLabelLine(),
        itemStyle: basePieItemStyle(),
        data: data.length ? data : NO_DATA_SLICE,
      },
    ],
  };
}

export function buildHorizontalBarOption({
  barWidth = 18,
  colors = [CHART_COLORS.green, CHART_COLORS.blue, CHART_COLORS.red, CHART_COLORS.gold],
  data = [],
  grid,
  name = 'Values',
} = {}) {
  return {
    backgroundColor: 'transparent',
    color: colors,
    tooltip: baseTooltip(),
    grid: baseHorizontalBarGrid(grid),
    xAxis: baseValueAxis(),
    yAxis: {
      type: 'category',
      data: data.map((item) => item.name),
      axisLine: { lineStyle: { color: CHART_COLORS.grid } },
      axisTick: { show: false },
      axisLabel: { color: CHART_COLORS.text, fontFamily: 'inherit', fontWeight: 700 },
    },
    series: [
      {
        name,
        type: 'bar',
        barWidth,
        data: data.map((item) => item.value),
        itemStyle: {
          borderRadius: [0, 10, 10, 0],
        },
        label: {
          show: true,
          position: 'right',
          color: CHART_COLORS.text,
          fontFamily: 'inherit',
          fontWeight: 800,
        },
      },
    ],
  };
}
