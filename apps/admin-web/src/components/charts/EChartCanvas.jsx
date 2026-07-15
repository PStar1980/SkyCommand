import { useEffect, useRef } from 'react';
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  GaugeChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

function EChartCanvas({ className = '', height = 260, onChartClick, option }) {
  const chartStyle =
    typeof height === 'number' ? { minHeight: height } : { height, minHeight: height };
  const chartRef = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    const instance = echarts.init(chartRef.current, null, {
      renderer: 'canvas',
    });

    instanceRef.current = instance;
    instance.setOption(option, true);

    if (typeof onChartClick === 'function') {
      instance.on('click', onChartClick);
    }

    const resizeChart = () => {
      instance.resize();
    };

    const resizeObserver = new ResizeObserver(resizeChart);
    resizeObserver.observe(chartRef.current);

    requestAnimationFrame(resizeChart);

    return () => {
      resizeObserver.disconnect();
      if (typeof onChartClick === 'function') {
        instance.off('click', onChartClick);
      }
      instance.dispose();
      instanceRef.current = null;
    };
  }, [onChartClick, option]);

  return <div className={`sky-chart-body ${className}`.trim()} ref={chartRef} style={chartStyle} />;
}

export default EChartCanvas;
