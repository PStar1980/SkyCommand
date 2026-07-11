import TrendAreaChart from './TrendAreaChart.jsx';
import { CHART_COLORS } from './chartTheme.js';

const formatSeconds = (value) => `${Math.round(Number(value || 0) / 1000)}s`;
const formatSecondsWithSpace = (value) => `${Math.round(Number(value || 0) / 1000)} s`;

function DurationTrendChart({
  className = '',
  height = 285,
  kicker = 'Runtime pressure',
  labels = [],
  subtitle,
  title,
  values = [],
}) {
  return (
    <TrendAreaChart
      className={className}
      colors={[CHART_COLORS.cyan]}
      height={height}
      kicker={kicker}
      labels={labels}
      series={[{ name: 'Avg duration', values, areaOpacity: 0.16 }]}
      subtitle={subtitle}
      title={title}
      valueFormatter={formatSecondsWithSpace}
      yAxisFormatter={formatSeconds}
    />
  );
}

export default DurationTrendChart;
