import { useMemo } from 'react';
import EChartCard from './EChartCard.jsx';
import { buildHorizontalBarOption } from './chartOptions.js';

function OutcomeBarChart({
  barWidth,
  className = '',
  colors,
  data = [],
  height = 285,
  kicker,
  name = 'Values',
  subtitle,
  title,
}) {
  const option = useMemo(
    () => buildHorizontalBarOption({ barWidth, colors, data, name }),
    [barWidth, colors, data, name],
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

export default OutcomeBarChart;
