import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import EChartCanvas from './EChartCanvas.jsx';

function ChartFullscreenOverlay({ isOpen, kicker, onClose, option, subtitle, title }) {
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
    >
      <section className="sky-chart-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sky-chart-modal-header">
          <div>
            {kicker && <div className="sky-page-kicker">{kicker}</div>}
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
            ×
          </button>
        </div>
        <div className="sky-chart-modal-body">
          <EChartCanvas className="sky-chart-modal-canvas" height="100%" option={option} />
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default ChartFullscreenOverlay;
