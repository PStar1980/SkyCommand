import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function Navbar() {
  const navigate = useNavigate();
  const { hasPermission, isAuthenticated, logout, user } = useAuth();

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
