import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import EChartCanvas from './EChartCanvas.jsx';

const DEFAULT_CHART_RATIO = 16 / 9;
const MIN_CHART_RATIO = 1.12;
const MAX_CHART_RATIO = 4.8;

const OVERLAY_FONT_SCALE = 2.1;
const OVERLAY_LEGEND_FONT_SIZE = 30;
const OVERLAY_LEGEND_LINE_HEIGHT = 36;
const OVERLAY_AXIS_FONT_SIZE = 24;
const OVERLAY_AXIS_LINE_HEIGHT = 30;
const OVERLAY_LABEL_FONT_SIZE = 26;
const OVERLAY_LABEL_LINE_HEIGHT = 32;
const OVERLAY_TOOLTIP_FONT_SIZE = 20;
const OVERLAY_TOOLTIP_LINE_HEIGHT = 26;

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
  const gap = viewportWidth < 900 ? 12 : clampNumber(Math.round(viewportWidth * 0.024), 24, 42);
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

function normalizeArrayOrObject(value, normalizer) {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === 'object' ? normalizer(item) : item));
  }

  if (value && typeof value === 'object') {
    return normalizer(value);
  }

  return value;
}

function withMinimumFontSize(textStyle = {}, minimumFontSize = 16, minimumLineHeight = 20) {
  const nextFontSize = Math.max(Number(textStyle.fontSize || 0), minimumFontSize);
  const nextTextStyle = {
    ...textStyle,
    fontSize: nextFontSize,
    lineHeight: Math.max(Number(textStyle.lineHeight || 0), minimumLineHeight),
  };

  if (textStyle.rich && typeof textStyle.rich === 'object') {
    nextTextStyle.rich = Object.fromEntries(
      Object.entries(textStyle.rich).map(([name, richStyle]) => [
        name,
        withMinimumFontSize(richStyle || {}, minimumFontSize, minimumLineHeight),
      ]),
    );
  }

  return nextTextStyle;
}

function cloneAndScaleChartOption(value, scale = OVERLAY_FONT_SCALE) {
  const cloneValue = (nestedValue) => {
    if (Array.isArray(nestedValue)) {
      return nestedValue.map(cloneValue);
    }

    if (!nestedValue || typeof nestedValue !== 'object') {
      return nestedValue;
    }

    const cloned = {};

    for (const [key, childValue] of Object.entries(nestedValue)) {
      if (typeof childValue === 'number') {
        if (key === 'fontSize') {
          cloned[key] = Math.round(childValue * scale);
          continue;
        }

        if (key === 'lineHeight') {
          cloned[key] = Math.round(childValue * Math.min(scale, 1.55));
          continue;
        }

        if (['symbolSize', 'barWidth', 'borderWidth'].includes(key)) {
          cloned[key] = Math.round(childValue * Math.min(scale, 1.28));
          continue;
        }
      }

      cloned[key] = cloneValue(childValue);
    }

    return cloned;
  };

  const cloned = cloneValue(value);

  if (!cloned || typeof cloned !== 'object') {
    return cloned;
  }

  const normalizeLegend = (legend) => ({
    ...legend,
    itemWidth: Math.max(Number(legend.itemWidth || 0), 48),
    itemHeight: Math.max(Number(legend.itemHeight || 0), 26),
    itemGap: Math.max(Number(legend.itemGap || 0), 28),
    textStyle: withMinimumFontSize(
      legend.textStyle || {},
      OVERLAY_LEGEND_FONT_SIZE,
      OVERLAY_LEGEND_LINE_HEIGHT,
    ),
    pageTextStyle: withMinimumFontSize(
      legend.pageTextStyle || {},
      OVERLAY_LEGEND_FONT_SIZE,
      OVERLAY_LEGEND_LINE_HEIGHT,
    ),
    selectorLabel: legend.selectorLabel
      ? withMinimumFontSize(
          legend.selectorLabel,
          OVERLAY_LEGEND_FONT_SIZE,
          OVERLAY_LEGEND_LINE_HEIGHT,
        )
      : legend.selectorLabel,
  });

  const normalizeAxis = (axis) => ({
    ...axis,
    axisLabel: withMinimumFontSize(
      axis.axisLabel || {},
      OVERLAY_AXIS_FONT_SIZE,
      OVERLAY_AXIS_LINE_HEIGHT,
    ),
    nameTextStyle: axis.nameTextStyle
      ? withMinimumFontSize(axis.nameTextStyle, OVERLAY_AXIS_FONT_SIZE, OVERLAY_AXIS_LINE_HEIGHT)
      : axis.nameTextStyle,
  });

  const normalizeSeries = (series) => ({
    ...series,
    label: series.label
      ? withMinimumFontSize(series.label, OVERLAY_LABEL_FONT_SIZE, OVERLAY_LABEL_LINE_HEIGHT)
      : series.label,
    emphasis:
      series.emphasis && typeof series.emphasis === 'object'
        ? {
            ...series.emphasis,
            label: series.emphasis.label
              ? withMinimumFontSize(
                  series.emphasis.label,
                  OVERLAY_LABEL_FONT_SIZE,
                  OVERLAY_LABEL_LINE_HEIGHT,
                )
              : series.emphasis.label,
          }
        : series.emphasis,
  });

  const normalizeGrid = (grid) => ({
    ...grid,
    top: typeof grid.top === 'number' ? Math.max(grid.top, 74) : grid.top,
    bottom: typeof grid.bottom === 'number' ? Math.max(grid.bottom, 46) : grid.bottom,
    left: typeof grid.left === 'number' ? Math.max(grid.left, 32) : grid.left,
    right: typeof grid.right === 'number' ? Math.max(grid.right, 42) : grid.right,
  });

  if (cloned.tooltip && typeof cloned.tooltip === 'object') {
    cloned.tooltip = {
      ...cloned.tooltip,
      textStyle: withMinimumFontSize(
        cloned.tooltip.textStyle || {},
        OVERLAY_TOOLTIP_FONT_SIZE,
        OVERLAY_TOOLTIP_LINE_HEIGHT,
      ),
    };
  }

  if (cloned.legend) {
    cloned.legend = normalizeArrayOrObject(cloned.legend, normalizeLegend);
  }

  if (cloned.xAxis) {
    cloned.xAxis = normalizeArrayOrObject(cloned.xAxis, normalizeAxis);
  }

  if (cloned.yAxis) {
    cloned.yAxis = normalizeArrayOrObject(cloned.yAxis, normalizeAxis);
  }

  if (cloned.series) {
    cloned.series = normalizeArrayOrObject(cloned.series, normalizeSeries);
  }

  if (cloned.grid) {
    cloned.grid = normalizeArrayOrObject(cloned.grid, normalizeGrid);
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
  onChartClick,
  onClose,
  option,
  subtitle,
  title,
}) {
  const [viewportMetrics, setViewportMetrics] = useState(() =>
    getViewportMetrics(chartAspectRatio),
  );
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
          <EChartCanvas
            className="sky-chart-modal-canvas"
            height="100%"
            onChartClick={onChartClick}
            option={expandedOption}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default ChartFullscreenOverlay;
