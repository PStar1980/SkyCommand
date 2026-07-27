import SkyCommandMark from './SkyCommandMark.jsx';
import { NavLink } from 'react-router-dom';

function getNavLinkClass({ isActive }) {
  return `sky-sidebar-link ${isActive ? 'active' : ''}`;
}

function shouldUseExactMatch(item) {
  return item.end ?? true;
}

function getGroupPanelId(groupLabel) {
  return `sky-sidebar-group-${String(groupLabel || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}

function SidebarNav({
  expandedGroupLabel = 'Dashboards',
  navGroups = [],
  onGroupSelect,
  onNavigate,
  onClose,
  open = false,
}) {
  return (
    <aside className={`sky-sidebar ${open ? 'is-open' : ''}`}>
      <div className="sky-sidebar-glow" aria-hidden="true" />
      <div className="sky-sidebar-brand-wrap">
        <NavLink className="sky-sidebar-brand" to="/dashboard" onClick={onNavigate}>
          <SkyCommandMark variant="lockup" />
        </NavLink>
        <button
          aria-label="Close navigation"
          className="btn btn-sm sky-sidebar-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>

      <nav className="sky-sidebar-nav" aria-label="SkyCommand navigation">
        {navGroups.map((group) => {
          const expanded = group.label === expandedGroupLabel;
          const groupPanelId = getGroupPanelId(group.label);

          return (
            <section
              className={`sky-sidebar-group ${expanded ? 'is-expanded' : 'is-collapsed'}`}
              key={group.label}
            >
              <button
                aria-controls={groupPanelId}
                aria-expanded={expanded}
                className="sky-sidebar-group-label"
                onClick={() => onGroupSelect?.(group)}
                type="button"
              >
                <span className="sky-sidebar-group-icon" aria-hidden="true">
                  {group.icon}
                </span>
                <span className="sky-sidebar-group-title">{group.label}</span>
                <span className="sky-sidebar-group-chevron" aria-hidden="true">
                  ›
                </span>
              </button>

              <div
                aria-hidden={!expanded}
                className="sky-sidebar-group-panel"
                id={groupPanelId}
              >
                <div className="sky-sidebar-group-items">
                  {group.items.map((item) => (
                    <NavLink
                      className={getNavLinkClass}
                      end={shouldUseExactMatch(item)}
                      key={item.to}
                      onClick={onNavigate}
                      tabIndex={expanded ? undefined : -1}
                      to={item.to}
                    >
                      <span className="sky-sidebar-link-icon">{item.icon}</span>
                      <span className="sky-sidebar-link-copy">
                        <span className="sky-sidebar-link-title">{item.label}</span>
                        <span className="sky-sidebar-link-description">{item.description}</span>
                      </span>
                    </NavLink>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

export default SidebarNav;
