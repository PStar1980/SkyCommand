import { StatusDot } from './StatusPill.jsx';

const ONLINE_STATUSES = new Set(['ONLINE', 'HEALTHY', 'CURRENT', 'READY', 'SUCCESS']);

function isOnlineService(item = {}) {
  const normalizedStatus = String(item.status || '').trim().toUpperCase();
  const normalizedValue = String(item.value || '').trim().toUpperCase();

  return ONLINE_STATUSES.has(normalizedStatus) || normalizedValue === 'ONLINE';
}

function ServerStatusPanel({ items = [] }) {
  return (
    <section className="sky-card sky-server-status-panel mb-3">
      <div className="sky-card-header sky-dashboard-section-heading">
        <div>
          <div className="sky-page-kicker">Platform availability</div>
          <h2 className="h5 mb-0">Server Status</h2>
          <div className="small sky-muted mt-1">
            Live availability of the web, database, API, Node worker, Temporal server, and Temporal worker services.
          </div>
        </div>
        <span className="sky-pill sky-pill-info">{items.length} services</span>
      </div>
      <div className="sky-card-body">
        <div className="sky-server-status-grid">
          {items.map((item) => (
            <article
              className={`sky-server-status-card ${isOnlineService(item) ? 'is-online' : ''}`}
              key={item.label}
            >
              <div className="d-flex align-items-start justify-content-between gap-2">
                <div>
                  <div className="sky-page-kicker">{item.label}</div>
                  <div className="sky-server-status-value">{item.value}</div>
                </div>
                <StatusDot status={item.status} />
              </div>
              <div className="small sky-muted mt-2">{item.helper || 'No status detail.'}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default ServerStatusPanel;
