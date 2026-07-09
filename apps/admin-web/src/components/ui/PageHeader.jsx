function PageHeader({ actions = null, children = null, kicker = '', subtitle = '', title }) {
  return (
    <header className="sky-page-header">
      <div>
        {kicker && <div className="sky-page-kicker">{kicker}</div>}
        <h1 className="sky-page-title">{title}</h1>
        {subtitle && <p className="sky-page-subtitle">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="text-md-end">{actions}</div>}
    </header>
  );
}

export default PageHeader;
