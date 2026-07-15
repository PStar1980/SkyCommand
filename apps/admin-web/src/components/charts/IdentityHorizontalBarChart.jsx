import { useMemo } from 'react';
import EChartCard from './EChartCard.jsx';
import { CHART_COLORS, baseHorizontalBarGrid, baseTooltip, baseValueAxis } from './chartTheme.js';

function IdentityHorizontalBarChart({
  className = '',
  colors = [CHART_COLORS.blue],
  data = [],
  emptyMessage,
  emptyTitle,
  footer,
  height = 140,
  isEmpty = false,
  kicker,
  name = 'Users',
  onChartClick,
  subtitle,
  title,
  tooltipFormatter,
}) {
  const option = useMemo(
    () => ({
      backgroundColor: 'transparent',
      color: colors,
      tooltip: {
        ...baseTooltip(),
        formatter: tooltipFormatter
          ? (params) => tooltipFormatter(params?.data || {}, params)
          : undefined,
      },
      grid: baseHorizontalBarGrid({
        left: 8,
        right: 20,
        top: 8,
        bottom: 6,
      }),
      xAxis: baseValueAxis(),
      yAxis: {
        type: 'category',
        data: data.map((item) => item.name),
        axisLine: { lineStyle: { color: CHART_COLORS.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: CHART_COLORS.text,
          fontFamily: 'inherit',
          fontWeight: 700,
          width: 110,
          overflow: 'truncate',
        },
      },
      series: [
        {
          name,
          type: 'bar',
          barMaxWidth: 20,
          data: data.map((item, index) => ({
            ...item,
            itemStyle: {
              borderRadius: [0, 10, 10, 0],
              color: item.color || colors[index % colors.length] || CHART_COLORS.blue,
            },
          })),
          label: {
            show: true,
            position: 'right',
            color: CHART_COLORS.text,
            fontFamily: 'inherit',
            fontWeight: 800,
          },
        },
      ],
    }),
    [colors, data, name, tooltipFormatter],
  );

  return (
    <EChartCard
      className={className}
      emptyMessage={emptyMessage}
      emptyTitle={emptyTitle}
      footer={footer}
      height={height}
      isEmpty={isEmpty}
      kicker={kicker}
      onChartClick={onChartClick}
      option={option}
      subtitle={subtitle}
      title={title}
    />
  );
}

export default IdentityHorizontalBarChart;
