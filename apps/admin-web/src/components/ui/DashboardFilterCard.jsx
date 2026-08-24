function DashboardFilterCard({ actions, children, meta, title = 'Chart filters' }) {
  return (
    <section className="sky-card sky-dashboard-filter-card">
      <div className="sky-card-body">
        <div className="d-flex flex-wrap align-items-end justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">Dashboard controls</div>
            <h2 className="h6 mb-0">{title}</h2>
            {meta && <div className="small sky-muted mt-1">{meta}</div>}
          </div>
          {actions && <div className="d-flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children && <div className="sky-dashboard-filter-grid mt-3">{children}</div>}
      </div>
    </section>
  );
}

export default DashboardFilterCard;
