function PageHeader({
  actions = null,
  actionClassName = '',
  children = null,
  className = '',
  kicker = '',
  subtitle = '',
  title,
}) {
  return (
    <header className={`sky-page-header ${className}`.trim()}>
      <div className="sky-page-heading">
        {kicker && <div className="sky-page-kicker">{kicker}</div>}
        <h1 className="sky-page-title">{title}</h1>
        {subtitle && <p className="sky-page-subtitle">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className={`sky-page-actions ${actionClassName}`.trim()}>{actions}</div>}
    </header>
  );
}

export default PageHeader;
