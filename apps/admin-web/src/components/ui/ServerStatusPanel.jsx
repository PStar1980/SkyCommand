import { Link } from 'react-router-dom';
import { StatusDot } from './StatusPill.jsx';

const ONLINE_STATUSES = new Set(['ONLINE', 'HEALTHY', 'CURRENT', 'READY', 'SUCCESS']);

function isOnlineService(item = {}) {
  const normalizedStatus = String(item.status || '').trim().toUpperCase();
  const normalizedValue = String(item.value || '').trim().toUpperCase();

  return ONLINE_STATUSES.has(normalizedStatus) || normalizedValue === 'ONLINE';
}

function getContainerHref(item = {}) {
  const query = String(item.containerQuery || item.service || item.label || '').trim();
  return `/docker/containers?${new URLSearchParams({ q: query }).toString()}`;
}

function ServerStatusPanel({ error = null, footer = null, segments = [] }) {
  return (
    <section className="sky-card sky-server-status-panel mb-3">
      <div className="sky-card-header sky-dashboard-section-heading">
        <div>
          <div className="sky-page-kicker">Platform availability</div>
          <h2 className="h5 mb-0">Runtime inventory</h2>
        </div>
      </div>
      <div className="sky-card-body">
        {error}
        <div className="sky-runtime-segments">
          {segments.map((segment) => (
            <section className="sky-runtime-segment" key={segment.label}>
              <header className="sky-runtime-segment-header">
                <div className="sky-runtime-segment-title">
                  <div className="sky-page-kicker">{segment.label}</div>
                  <div className="small sky-muted">{segment.items.length} runtime(s)</div>
                </div>
                {segment.controls && (
                  <div className="sky-runtime-segment-controls">{segment.controls}</div>
                )}
              </header>
              <div className="sky-server-status-grid">
                {segment.items.map((item) => (
                  <Link
                    aria-label={`Open ${item.label} in Docker Containers, filtered by ${item.containerQuery || item.service || item.label}`}
                    className={`sky-server-status-card ${isOnlineService(item) ? 'is-online' : ''}`}
                    key={item.service || item.label}
                    title={`Open ${item.label} in Docker Containers`}
                    to={getContainerHref(item)}
                  >
                    <div className="d-flex align-items-start justify-content-between gap-2">
                      <div>
                        <div className="sky-page-kicker">{item.label}</div>
                        <div className="sky-server-status-value">{item.value}</div>
                      </div>
                      <StatusDot status={item.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
        {footer && <div className="mt-3 pt-3 border-top">{footer}</div>}
      </div>
    </section>
  );
}

export default ServerStatusPanel;
