import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function getDropdownItemClass({ isActive }) {
  return `dropdown-item ${isActive ? 'active' : ''}`;
}

function Navbar() {
  const navigate = useNavigate();
  const { hasPermission, isAuthenticated, logout, user } = useAuth();
  const canViewAccessControl =
    hasPermission('ADMIN_USER_READ') ||
    hasPermission('ADMIN_ROLE_READ') ||
    hasPermission('ADMIN_PERMISSION_READ');
  const canViewAutomation =
    hasPermission('WORKER_SCHEDULE_READ') || hasPermission('WORKER_LISTENER_READ');

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <nav className="navbar navbar-expand-lg navbar-dark sky-navbar sticky-top">
      <div className="container-fluid">
        <NavLink className="navbar-brand d-flex align-items-center gap-2 fw-bold" to="/">
          <span className="sky-brand-mark">⌁</span>
          <span>SkyServer Admin</span>
        </NavLink>

        <button
          aria-controls="skyAdminNavbar"
          aria-expanded="false"
          aria-label="Toggle navigation"
          className="navbar-toggler"
          data-bs-target="#skyAdminNavbar"
          data-bs-toggle="collapse"
          type="button"
        >
          <span className="navbar-toggler-icon" />
        </button>

        <div className="collapse navbar-collapse" id="skyAdminNavbar">
          {isAuthenticated && (
            <ul className="navbar-nav me-auto mb-2 mb-lg-0">
              <li className="nav-item">
                <NavLink className="nav-link" to="/dashboard">
                  Dashboard
                </NavLink>
              </li>

              {hasPermission('CORE_VIEW_TOOLS') && (
                <li className="nav-item">
                  <NavLink className="nav-link" to="/tools">
                    Tools
                  </NavLink>
                </li>
              )}

              {hasPermission('INGESTION_VIEW_STATUS') && (
                <li className="nav-item">
                  <NavLink className="nav-link" to="/ingestion-status">
                    Ingestion
                  </NavLink>
                </li>
              )}

              {canViewAutomation && (
                <li className="nav-item dropdown">
                  <button
                    aria-expanded="false"
                    className="nav-link dropdown-toggle btn btn-link sky-nav-dropdown-toggle"
                    data-bs-toggle="dropdown"
                    type="button"
                  >
                    Automation
                  </button>
                  <ul className="dropdown-menu dropdown-menu-dark sky-navbar-dropdown">
                    {hasPermission('WORKER_SCHEDULE_READ') && (
                      <li>
                        <NavLink className={getDropdownItemClass} to="/automation/scheduler">
                          Scheduler
                        </NavLink>
                      </li>
                    )}

                    {hasPermission('WORKER_LISTENER_READ') && (
                      <li>
                        <NavLink className={getDropdownItemClass} to="/automation/listeners">
                          Listener
                        </NavLink>
                      </li>
                    )}
                  </ul>
                </li>
              )}

              {hasPermission('SCRIPT_EXECUTION_READ') && (
                <li className="nav-item">
                  <NavLink className="nav-link" to="/script-executions">
                    Executions
                  </NavLink>
                </li>
              )}

              {hasPermission('AUDIT_READ') && (
                <li className="nav-item">
                  <NavLink className="nav-link" to="/audit-events">
                    Audit
                  </NavLink>
                </li>
              )}

              {canViewAccessControl && (
                <li className="nav-item dropdown">
                  <button
                    aria-expanded="false"
                    className="nav-link dropdown-toggle btn btn-link sky-nav-dropdown-toggle"
                    data-bs-toggle="dropdown"
                    type="button"
                  >
                    Access Control
                  </button>
                  <ul className="dropdown-menu dropdown-menu-dark sky-navbar-dropdown">
                    {hasPermission('ADMIN_USER_READ') && (
                      <li>
                        <NavLink className={getDropdownItemClass} to="/admin/users">
                          Users
                        </NavLink>
                      </li>
                    )}

                    {hasPermission('ADMIN_ROLE_READ') && (
                      <li>
                        <NavLink className={getDropdownItemClass} to="/admin/roles">
                          Roles
                        </NavLink>
                      </li>
                    )}

                    {hasPermission('ADMIN_PERMISSION_READ') && (
                      <li>
                        <NavLink className={getDropdownItemClass} to="/admin/privileges">
                          Privileges
                        </NavLink>
                      </li>
                    )}
                  </ul>
                </li>
              )}
            </ul>
          )}

          <div className="d-flex align-items-center gap-2 ms-auto">
            {isAuthenticated ? (
              <>
                <div className="d-none d-md-block text-end">
                  <div className="small text-white fw-semibold">
                    {user?.displayName || user?.username}
                  </div>
                  <div className="small sky-muted">{user?.email}</div>
                </div>
                <button className="btn btn-sm sky-btn-ghost" onClick={handleLogout} type="button">
                  Logout
                </button>
              </>
            ) : (
              <NavLink className="btn btn-sm sky-btn-primary" to="/login">
                Login
              </NavLink>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
