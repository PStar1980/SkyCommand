import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import EChartCanvas from './EChartCanvas.jsx';

const DEFAULT_CHART_RATIO = 16 / 9;
const MIN_CHART_RATIO = 1.12;
const MAX_CHART_RATIO = 4.8;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSafeRatio(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return DEFAULT_CHART_RATIO;
  }

  return clampNumber(numericValue, MIN_CHART_RATIO, MAX_CHART_RATIO);
}

function getViewportMetrics(chartAspectRatio) {
  if (typeof window === 'undefined') {
    return {
      chartHeight: 720,
      chartWidth: Math.round(720 * getSafeRatio(chartAspectRatio)),
      gap: 28,
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const gap = viewportWidth < 900
    ? 12
    : clampNumber(Math.round(viewportWidth * 0.024), 24, 42);
  const headerEstimate = viewportWidth < 900 ? 116 : 128;
  const availableWidth = Math.max(320, viewportWidth - gap * 2);
  const availableHeight = Math.max(320, viewportHeight - gap * 2 - headerEstimate);
  const ratio = getSafeRatio(chartAspectRatio);

  let chartWidth = availableWidth;
  let chartHeight = chartWidth / ratio;

  if (chartHeight > availableHeight) {
    chartHeight = availableHeight;
    chartWidth = chartHeight * ratio;
  }

  return {
    chartHeight: Math.round(chartHeight),
    chartWidth: Math.round(chartWidth),
    gap,
  };
}

function cloneAndScaleChartOption(value, scale = 1.35, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => cloneAndScaleChartOption(item, scale, parentKey));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cloned = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === 'number') {
      if (key === 'fontSize') {
        cloned[key] = Math.round(nestedValue * scale);
        continue;
      }

      if (['symbolSize', 'barWidth', 'borderWidth'].includes(key)) {
        cloned[key] = Math.round(nestedValue * Math.min(scale, 1.22));
        continue;
      }
    }

    cloned[key] = cloneAndScaleChartOption(nestedValue, scale, key);
  }

  if (parentKey === 'axisLabel') {
    cloned.fontSize = cloned.fontSize || 13;
  }

  if (parentKey === 'label') {
    cloned.fontSize = cloned.fontSize || 14;
    cloned.lineHeight = cloned.lineHeight || 16;
  }

  if (parentKey === 'textStyle') {
    cloned.fontSize = cloned.fontSize || 14;
  }

  if (cloned.textStyle && typeof cloned.textStyle === 'object') {
    cloned.textStyle = {
      ...cloned.textStyle,
      fontSize: cloned.textStyle.fontSize || 14,
    };
  }

  if (cloned.axisLabel && typeof cloned.axisLabel === 'object') {
    cloned.axisLabel = {
      ...cloned.axisLabel,
      fontSize: cloned.axisLabel.fontSize || 13,
    };
  }

  if (cloned.label && typeof cloned.label === 'object') {
    cloned.label = {
      ...cloned.label,
      fontSize: cloned.label.fontSize || 14,
      lineHeight: cloned.label.lineHeight || 16,
    };
  }

  if (cloned.legend && typeof cloned.legend === 'object') {
    cloned.legend = {
      ...cloned.legend,
      itemWidth: cloned.legend.itemWidth || 18,
      itemHeight: cloned.legend.itemHeight || 10,
      textStyle: {
        ...(cloned.legend.textStyle || {}),
        fontSize: cloned.legend.textStyle?.fontSize || 14,
      },
    };
  }

  return cloned;
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="sky-chart-modal-close-icon" viewBox="0 0 24 24">
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </svg>
  );
}

function ChartFullscreenOverlay({
  chartAspectRatio = DEFAULT_CHART_RATIO,
  isOpen,
  kicker,
  onClose,
  option,
  subtitle,
  title,
}) {
  const [viewportMetrics, setViewportMetrics] = useState(() => getViewportMetrics(chartAspectRatio));
  const expandedOption = useMemo(() => cloneAndScaleChartOption(option), [option]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const updateMetrics = () => {
      setViewportMetrics(getViewportMetrics(chartAspectRatio));
    };

    updateMetrics();
    window.addEventListener('resize', updateMetrics);

    return () => {
      window.removeEventListener('resize', updateMetrics);
    };
  }, [chartAspectRatio, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      aria-modal="true"
      className="sky-chart-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      style={{ '--sky-chart-modal-gap': `${viewportMetrics.gap}px` }}
    >
      <section
        className="sky-chart-modal"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          '--sky-chart-modal-chart-height': `${viewportMetrics.chartHeight}px`,
          '--sky-chart-modal-width': `${viewportMetrics.chartWidth}px`,
        }}
      >
        <div className="sky-chart-modal-header">
          <div>
            {kicker && <div className="sky-page-kicker sky-chart-modal-kicker">{kicker}</div>}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            aria-label="Close expanded chart"
            autoFocus
            className="sky-chart-modal-close"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="sky-chart-modal-body">
          <EChartCanvas className="sky-chart-modal-canvas" height="100%" option={expandedOption} />
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default ChartFullscreenOverlay;
