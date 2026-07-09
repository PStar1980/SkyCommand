import { NavLink } from 'react-router-dom';

function getNavLinkClass({ isActive }) {
  return `sky-sidebar-link ${isActive ? 'active' : ''}`;
}

function SidebarNav({ navGroups = [], onNavigate, onClose, open = false, user }) {
  return (
    <aside className={`sky-sidebar ${open ? 'is-open' : ''}`}>
      <div className="sky-sidebar-glow" aria-hidden="true" />
      <div className="sky-sidebar-brand-wrap">
        <NavLink className="sky-sidebar-brand" to="/dashboard" onClick={onNavigate}>
          <span className="sky-brand-mark">⌁</span>
          <span>
            <span className="sky-sidebar-brand-title">SkyServer</span>
            <span className="sky-sidebar-brand-subtitle">Command Glass</span>
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

      <div className="sky-sidebar-search" aria-label="Navigation scope">
        <span className="sky-sidebar-search-icon">⌕</span>
        <span>Control plane navigation</span>
      </div>

      <nav className="sky-sidebar-nav" aria-label="SkyServer navigation">
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

      <div className="sky-sidebar-footer">
        <div className="sky-sidebar-user-card">
          <div className="sky-sidebar-avatar">{(user?.displayName || user?.username || 'S').charAt(0)}</div>
          <div className="min-w-0">
            <div className="sky-sidebar-user-name text-truncate">{user?.displayName || user?.username}</div>
            <div className="sky-sidebar-user-email text-truncate">{user?.email}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default SidebarNav;
