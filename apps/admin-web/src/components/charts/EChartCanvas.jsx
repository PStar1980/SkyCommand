import { useEffect, useMemo, useRef } from 'react';
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { applyChartTypography } from './chartTheme.js';

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

function EChartCanvas({ className = '', height = 260, onChartClick, option, variant = 'card' }) {
  const chartStyle =
    typeof height === 'number' ? { minHeight: height } : { height, minHeight: height };
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const normalizedOption = useMemo(
    () => applyChartTypography(option, variant),
    [option, variant],
  );

  // Initialize the canvas once. Data refreshes deliberately update the existing
  // ECharts instance instead of disposing/recreating it so hover state, tooltip
  // interaction, and chart identity survive live telemetry and dashboard polls.
  useEffect(() => {
    if (!chartRef.current) return undefined;

    const instance = echarts.init(chartRef.current, null, {
      renderer: 'canvas',
    });
    instanceRef.current = instance;

    const resizeChart = () => instance.resize();
    const resizeObserver = new ResizeObserver(resizeChart);
    resizeObserver.observe(chartRef.current);
    requestAnimationFrame(resizeChart);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !normalizedOption) return;

    instance.setOption(normalizedOption, {
      lazyUpdate: true,
      notMerge: false,
      replaceMerge: ['series'],
    });
  }, [normalizedOption]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || typeof onChartClick !== 'function') return undefined;

    instance.on('click', onChartClick);
    return () => instance.off('click', onChartClick);
  }, [onChartClick]);

  return <div className={`sky-chart-body ${className}`.trim()} ref={chartRef} style={chartStyle} />;
}

export default EChartCanvas;
