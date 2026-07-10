import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

function EChartCard({ className = '', height = 260, kicker, option, subtitle, title }) {
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

    const resizeObserver = new ResizeObserver(() => {
      instance.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, [option]);

  return (
    <section className={`sky-card sky-chart-card ${className}`.trim()}>
      <div className="sky-card-header sky-chart-card-header">
        <div>
          {kicker && <div className="sky-page-kicker">{kicker}</div>}
          <h2 className="h5 mb-0">{title}</h2>
          {subtitle && <div className="small sky-muted mt-1">{subtitle}</div>}
        </div>
      </div>
      <div className="sky-chart-body" ref={chartRef} style={{ minHeight: height }} />
    </section>
  );
}

export default EChartCard;
