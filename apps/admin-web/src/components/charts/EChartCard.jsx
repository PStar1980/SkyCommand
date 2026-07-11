import { useCallback, useEffect, useRef, useState } from 'react';
import ChartFullscreenOverlay from './ChartFullscreenOverlay.jsx';
import EChartCanvas from './EChartCanvas.jsx';
import EmptyChartState from './EmptyChartState.jsx';

function ExpandIcon() {
  return (
    <svg aria-hidden="true" className="sky-chart-expand-icon" viewBox="0 0 24 24">
      <path d="M8 4H4v4" />
      <path d="M4 4l6.2 6.2" />
      <path d="M16 20h4v-4" />
      <path d="M20 20l-6.2-6.2" />
      <path d="M20 8V4h-4" />
      <path d="M20 4l-6.2 6.2" />
      <path d="M4 16v4h4" />
      <path d="M4 20l6.2-6.2" />
    </svg>
  );
}

function EChartCard({
  className = '',
  emptyMessage,
  emptyTitle,
  expandable = true,
  height = 260,
  isEmpty = false,
  kicker,
  option,
  subtitle,
  title,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [chartAspectRatio, setChartAspectRatio] = useState(16 / 9);
  const chartShellRef = useRef(null);
  const openExpanded = useCallback(() => setIsExpanded(true), []);
  const closeExpanded = useCallback(() => setIsExpanded(false), []);

  useEffect(() => {
    if (!chartShellRef.current) {
      return undefined;
    }

    const updateAspectRatio = () => {
      const rect = chartShellRef.current.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        setChartAspectRatio(rect.width / rect.height);
      }
    };

    const resizeObserver = new ResizeObserver(updateAspectRatio);
    resizeObserver.observe(chartShellRef.current);
    updateAspectRatio();

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <>
      <section className={`sky-card sky-chart-card ${className}`.trim()}>
        <div className="sky-card-header sky-chart-card-header">
          <div>
            {kicker && <div className="sky-page-kicker">{kicker}</div>}
            <h2 className="h5 mb-0">{title}</h2>
            {subtitle && <div className="small sky-muted mt-1">{subtitle}</div>}
          </div>
          {expandable && !isEmpty && (
            <button
              aria-label={`Expand ${title} chart`}
              className="sky-chart-expand-button"
              onClick={openExpanded}
              title="Expand chart"
              type="button"
            >
              <ExpandIcon />
            </button>
          )}
        </div>
        <div className="sky-chart-canvas-shell" ref={chartShellRef}>
          {isEmpty ? (
            <EmptyChartState message={emptyMessage} title={emptyTitle} />
          ) : (
            <EChartCanvas height={height} option={option} />
          )}
        </div>
      </section>

      <ChartFullscreenOverlay
        chartAspectRatio={chartAspectRatio}
        isOpen={isExpanded && !isEmpty}
        kicker={kicker}
        onClose={closeExpanded}
        option={option}
        subtitle={subtitle}
        title={title}
      />
    </>
  );
}

export default EChartCard;
