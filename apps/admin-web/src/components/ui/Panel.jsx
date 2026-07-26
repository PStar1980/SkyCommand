function Panel({
  actions = null,
  children,
  className = '',
  headerClassName = '',
  kicker = '',
  subtitle = '',
  title = '',
  titleClassName = 'h5 mb-0',
}) {
  return (
    <section className={`sky-card ${className}`.trim()}>
      {(title || subtitle || kicker || actions) && (
        <div className={`sky-card-header d-flex align-items-center justify-content-between gap-2 ${headerClassName}`.trim()}>
          <div>
            {kicker && <div className="sky-page-kicker">{kicker}</div>}
            {title && <h2 className={titleClassName}>{title}</h2>}
            {subtitle && <div className="small sky-muted">{subtitle}</div>}
          </div>
          {actions && <div className="d-flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export default Panel;
