import { useMemo } from 'react';
import EChartCard from './EChartCard.jsx';
import { buildTrendAreaOption } from './chartOptions.js';

function TrendAreaChart({
  className = '',
  colors,
  grid,
  height = 285,
  kicker,
  labels = [],
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
      height={height}
      kicker={kicker}
      option={option}
      subtitle={subtitle}
      title={title}
    />
  );
}

export default TrendAreaChart;
