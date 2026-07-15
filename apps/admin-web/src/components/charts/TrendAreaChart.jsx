import { useMemo } from 'react';
import EChartCard from './EChartCard.jsx';
import { buildTrendAreaOption } from './chartOptions.js';

function TrendAreaChart({
  className = '',
  colors,
  emptyMessage,
  emptyTitle,
  footer,
  grid,
  height = 285,
  isEmpty = false,
  kicker,
  labels = [],
  onChartClick,
  series = [],
  subtitle,
  title,
  valueFormatter,
  yAxisFormatter,
}) {
  const option = useMemo(
    () => buildTrendAreaOption({ colors, grid, labels, series, valueFormatter, yAxisFormatter }),
    [colors, grid, labels, series, valueFormatter, yAxisFormatter],
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

export default TrendAreaChart;
