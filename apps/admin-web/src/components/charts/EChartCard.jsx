import { useCallback, useState } from 'react';
import ChartFullscreenOverlay from './ChartFullscreenOverlay.jsx';
import EChartCanvas from './EChartCanvas.jsx';

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

function EChartCard({ className = '', expandable = true, height = 260, kicker, option, subtitle, title }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const openExpanded = useCallback(() => setIsExpanded(true), []);
  const closeExpanded = useCallback(() => setIsExpanded(false), []);

  return (
    <>
      <section className={`sky-card sky-chart-card ${className}`.trim()}>
        <div className="sky-card-header sky-chart-card-header">
          <div>
            {kicker && <div className="sky-page-kicker">{kicker}</div>}
            <h2 className="h5 mb-0">{title}</h2>
            {subtitle && <div className="small sky-muted mt-1">{subtitle}</div>}
          </div>
          {expandable && (
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
        <EChartCanvas height={height} option={option} />
      </section>

      <ChartFullscreenOverlay
        isOpen={isExpanded}
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
