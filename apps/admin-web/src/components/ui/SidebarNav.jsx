import SkyCommandMark from './SkyCommandMark.jsx';
import { NavLink } from 'react-router-dom';

function getNavLinkClass({ isActive }) {
  return `sky-sidebar-link ${isActive ? 'active' : ''}`;
}

function SidebarNav({ navGroups = [], onNavigate, onClose, open = false }) {
  return (
    <aside className={`sky-sidebar ${open ? 'is-open' : ''}`}>
      <div className="sky-sidebar-glow" aria-hidden="true" />
      <div className="sky-sidebar-brand-wrap">
        <NavLink className="sky-sidebar-brand" to="/dashboard" onClick={onNavigate}>
          <SkyCommandMark />
          <span className="sky-sidebar-brand-copy">
            <span className="sky-sidebar-brand-title">SkyCommand</span>
            <span className="sky-sidebar-brand-subtitle">Workflow Automation</span>
          </span>
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
        {navGroups.map((group) => (
          <section className="sky-sidebar-group" key={group.label}>
            <div className="sky-sidebar-group-label">
              <span>{group.icon}</span>
              <span>{group.label}</span>
            </div>
            <div className="sky-sidebar-group-items">
              {group.items.map((item) => (
                <NavLink className={getNavLinkClass} key={item.to} onClick={onNavigate} to={item.to}>
                  <span className="sky-sidebar-link-icon">{item.icon}</span>
                  <span className="sky-sidebar-link-copy">
                    <span className="sky-sidebar-link-title">{item.label}</span>
                    <span className="sky-sidebar-link-description">{item.description}</span>
                  </span>
                </NavLink>
              ))}
            </div>
          </section>
        ))}
      </nav>

    </aside>
  );
}

export default SidebarNav;
