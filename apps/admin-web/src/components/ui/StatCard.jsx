import { StatusDot } from './StatusPill.jsx';

function StatCard({ className = '', helper = '', label, status = 'INFO', value }) {
  return (
    <section className={`sky-card sky-stat-card ${className}`.trim()}>
      <div className="sky-card-body">
        <div className="d-flex align-items-start justify-content-between gap-2">
          <div>
            <div className="sky-page-kicker">{label}</div>
            <div className="sky-stat-value">{value}</div>
          </div>
          <StatusDot status={status} />
        </div>
        {helper && <div className="sky-muted small mt-2">{helper}</div>}
      </div>
    </section>
  );
}

export default StatCard;
