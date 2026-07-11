import { useMemo } from 'react';
import EChartCard from './EChartCard.jsx';
import { buildDonutOption } from './chartOptions.js';

function StatusDonut({
  className = '',
  colors,
  data = [],
  height = 285,
  kicker,
  name = 'Status',
  subtitle,
  title,
}) {
  const option = useMemo(
    () => buildDonutOption({ colors, data, name }),
    [colors, data, name],
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

export default StatusDonut;
