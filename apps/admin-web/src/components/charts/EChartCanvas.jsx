import { useEffect, useRef } from 'react';
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GaugeChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

function EChartCanvas({ className = '', height = 260, option }) {
  const chartStyle = typeof height === 'number' ? { minHeight: height } : { height, minHeight: height };
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

    const resizeChart = () => {
      instance.resize();
    };

    const resizeObserver = new ResizeObserver(resizeChart);
    resizeObserver.observe(chartRef.current);

    requestAnimationFrame(resizeChart);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, [option]);

  return (
    <div
      className={`sky-chart-body ${className}`.trim()}
      ref={chartRef}
      style={chartStyle}
    />
  );
}

export default EChartCanvas;
