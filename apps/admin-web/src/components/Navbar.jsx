import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import authService from '../services/authService';

const DEFAULT_PASSWORD_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  revokeOtherSessions: true,
};

function getDropdownItemClass({ isActive }) {
  return `dropdown-item ${isActive ? 'active' : ''}`;
}

function Navbar() {
  const navigate = useNavigate();
  const { hasPermission, isAuthenticated, logout, refreshSession, user } = useAuth();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState(DEFAULT_PASSWORD_FORM);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const canViewTools = hasPermission('CORE_VIEW_TOOLS') || hasPermission('SCRIPT_EXECUTION_READ');
  const canViewWorkflows = hasPermission('WORKFLOW_READ') || hasPermission('TEMPORAL_WORKFLOW_READ') || hasPermission('WORKFLOW_APPROVAL_READ');
  const canViewAutomation = hasPermission('WORKER_SCHEDULE_READ') || hasPermission('WORKER_LISTENER_READ');
  const canViewData = hasPermission('INGESTION_VIEW_STATUS');
  const canViewConfiguration = hasPermission('ADMIN_REPOSITORY_READ');
  const canViewAccessControl =
    hasPermission('ADMIN_USER_READ') ||
    hasPermission('ADMIN_ROLE_READ') ||
    hasPermission('ADMIN_PERMISSION_READ') ||
    hasPermission('AUDIT_READ');

  function openPasswordModal() {
    setPasswordForm(DEFAULT_PASSWORD_FORM);
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordModalOpen(true);
  }

  function closePasswordModal() {
    if (passwordSaving) {
      return;
    }

    setPasswordModalOpen(false);
    setPasswordForm(DEFAULT_PASSWORD_FORM);
    setPasswordError('');
    setPasswordSuccess('');
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setPasswordSaving(true);
    setPasswordError('');
    setPasswordSuccess('');

    try {
      const result = await authService.changePassword(passwordForm);
      setPasswordForm(DEFAULT_PASSWORD_FORM);
      setPasswordSuccess(
        result.revokedOtherSessionsCount > 0
          ? `Password changed. Revoked ${result.revokedOtherSessionsCount} other active session(s).`
          : 'Password changed successfully.',
      );
      await refreshSession();
    } catch (error) {
      setPasswordError(error.message || 'Failed to change password.');
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <>
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
              <ul className="navbar-nav me-auto mb-2 mb-lg-0 sky-navbar-primary-nav">
                <li className="nav-item">
                  <NavLink className="nav-link" to="/dashboard">
                    Dashboard
                  </NavLink>
                </li>

                {canViewTools && (
                  <li className="nav-item dropdown">
                    <button
                      aria-expanded="false"
                      className="nav-link dropdown-toggle btn btn-link sky-nav-dropdown-toggle"
                      data-bs-toggle="dropdown"
                      type="button"
                    >
                      Tools
                    </button>
                    <ul className="dropdown-menu dropdown-menu-dark sky-navbar-dropdown">
                      <li className="dropdown-header sky-dropdown-section-label">Tool operations</li>
                      {hasPermission('CORE_VIEW_TOOLS') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/tools/run">
                            Run Tools
                          </NavLink>
                        </li>
                      )}
                      {hasPermission('SCRIPT_EXECUTION_READ') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/tools/executions">
                            Tools History
                          </NavLink>
                        </li>
                      )}
                    </ul>
                  </li>
                )}

                {canViewWorkflows && (
                  <li className="nav-item dropdown">
                    <button
                      aria-expanded="false"
                      className="nav-link dropdown-toggle btn btn-link sky-nav-dropdown-toggle"
                      data-bs-toggle="dropdown"
                      type="button"
                    >
                      Workflows
                    </button>
                    <ul className="dropdown-menu dropdown-menu-dark sky-navbar-dropdown">
                      <li className="dropdown-header sky-dropdown-section-label">SkyServer workflows</li>
                      {hasPermission('WORKFLOW_WRITE') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/workflows/create">
                            Create Workflow
                          </NavLink>
                        </li>
                      )}
                      {hasPermission('WORKFLOW_WRITE') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/workflows/manage">
                            Manage Workflows
                          </NavLink>
                        </li>
                      )}
                      {hasPermission('WORKFLOW_READ') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/workflows/start">
                            Start Workflow
                          </NavLink>
                        </li>
                      )}
                      {hasPermission('WORKFLOW_READ') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/workflows/history">
                            Workflow History
                          </NavLink>
                        </li>
                      )}
                      {hasPermission('WORKFLOW_APPROVAL_READ') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/workflows/approvals">
                            Approvals
                          </NavLink>
                        </li>
                      )}
                      {(hasPermission('WORKFLOW_READ') || hasPermission('TEMPORAL_WORKFLOW_READ')) && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/workflows/worker-health">
                            Worker Health
                          </NavLink>
                        </li>
                      )}
                    </ul>
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
                      <li className="dropdown-header sky-dropdown-section-label">Scheduler lane</li>
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

                {canViewData && (
                  <li className="nav-item dropdown">
                    <button
                      aria-expanded="false"
                      className="nav-link dropdown-toggle btn btn-link sky-nav-dropdown-toggle"
                      data-bs-toggle="dropdown"
                      type="button"
                    >
                      Data
                    </button>
                    <ul className="dropdown-menu dropdown-menu-dark sky-navbar-dropdown">
                      <li className="dropdown-header sky-dropdown-section-label">Data operations</li>
                      {hasPermission('INGESTION_VIEW_STATUS') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/data/ingestion">
                            Ingestion Status
                          </NavLink>
                        </li>
                      )}
                    </ul>
                  </li>
                )}

                {canViewConfiguration && (
                  <li className="nav-item dropdown">
                    <button
                      aria-expanded="false"
                      className="nav-link dropdown-toggle btn btn-link sky-nav-dropdown-toggle"
                      data-bs-toggle="dropdown"
                      type="button"
                    >
                      Configuration
                    </button>
                    <ul className="dropdown-menu dropdown-menu-dark sky-navbar-dropdown">
                      <li className="dropdown-header sky-dropdown-section-label">System setup</li>
                      {hasPermission('ADMIN_REPOSITORY_READ') && (
                        <li>
                          <NavLink
                            className={getDropdownItemClass}
                            to="/configuration/production-readiness"
                          >
                            Production Readiness
                          </NavLink>
                        </li>
                      )}
                      {hasPermission('ADMIN_REPOSITORY_READ') && (
                        <li>
                          <NavLink
                            className={getDropdownItemClass}
                            to="/configuration/repositories"
                          >
                            Repositories
                          </NavLink>
                        </li>
                      )}
                    </ul>
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
                      <li className="dropdown-header sky-dropdown-section-label">Users and permissions</li>
                      {hasPermission('ADMIN_USER_READ') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/admin/users">
                            Users
                          </NavLink>
                        </li>
                      )}
                      {hasPermission('ADMIN_USER_READ') && (
                        <li>
                          <NavLink className={getDropdownItemClass} to="/admin/sessions">
                            Sessions
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
                      {hasPermission('AUDIT_READ') && (
                        <>
                          <li>
                            <hr className="dropdown-divider" />
                          </li>
                          <li>
                            <NavLink
                              className={getDropdownItemClass}
                              to="/access-control/user-history"
                            >
                              User History
                            </NavLink>
                          </li>
                        </>
                      )}
                    </ul>
                  </li>
                )}
              </ul>
            )}

            <div className="d-flex align-items-center gap-2 ms-auto">
              {isAuthenticated ? (
                <div className="dropdown text-end">
                  <button
                    aria-expanded="false"
                    className="btn btn-sm sky-account-menu-button dropdown-toggle"
                    data-bs-toggle="dropdown"
                    type="button"
                  >
                    <span className="d-block text-white fw-semibold">
                      {user?.displayName || user?.username}
                    </span>
                    <span className="d-none d-md-block small sky-muted">{user?.email}</span>
                  </button>
                  <ul className="dropdown-menu dropdown-menu-dark dropdown-menu-end sky-navbar-dropdown">
                    <li>
                      <button className="dropdown-item" onClick={openPasswordModal} type="button">
                        Change password
                      </button>
                    </li>
                    <li>
                      <hr className="dropdown-divider" />
                    </li>
                    <li>
                      <button className="dropdown-item" onClick={handleLogout} type="button">
                        Logout
                      </button>
                    </li>
                  </ul>
                </div>
              ) : (
                <NavLink className="btn btn-sm sky-btn-primary" to="/login">
                  Login
                </NavLink>
              )}
            </div>
          </div>
        </div>
      </nav>

      {passwordModalOpen && (
        <div className="sky-modal-backdrop" role="presentation">
          <div
            aria-modal="true"
            className="sky-modal-card"
            role="dialog"
            aria-labelledby="changePasswordTitle"
          >
            <div className="sky-modal-header">
              <div>
                <div className="sky-page-kicker">Account security</div>
                <h2 className="h5 mb-0" id="changePasswordTitle">
                  Change password
                </h2>
              </div>
              <button
                aria-label="Close"
                className="btn btn-sm sky-btn-ghost"
                disabled={passwordSaving}
                onClick={closePasswordModal}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="sky-card-body" onSubmit={handlePasswordSubmit}>
              {passwordError && <div className="alert alert-danger">{passwordError}</div>}
              {passwordSuccess && <div className="alert alert-success">{passwordSuccess}</div>}

              <div className="mb-3">
                <label className="form-label sky-form-label" htmlFor="currentPassword">
                  Current password
                </label>
                <input
                  className="form-control sky-form-control"
                  id="currentPassword"
                  minLength={1}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  required
                  type="password"
                  value={passwordForm.currentPassword}
                />
              </div>

              <div className="mb-3">
                <label className="form-label sky-form-label" htmlFor="newPassword">
                  New password
                </label>
                <input
                  className="form-control sky-form-control"
                  id="newPassword"
                  minLength={12}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                  required
                  type="password"
                  value={passwordForm.newPassword}
                />
                <div className="small sky-muted mt-1">Minimum 12 characters.</div>
              </div>

              <div className="mb-3">
                <label className="form-label sky-form-label" htmlFor="confirmPassword">
                  Confirm new password
                </label>
                <input
                  className="form-control sky-form-control"
                  id="confirmPassword"
                  minLength={12}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  required
                  type="password"
                  value={passwordForm.confirmPassword}
                />
              </div>

              <div className="form-check form-switch mb-4">
                <input
                  checked={passwordForm.revokeOtherSessions}
                  className="form-check-input"
                  id="revokeOtherSessions"
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      revokeOtherSessions: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <label className="form-check-label sky-muted" htmlFor="revokeOtherSessions">
                  Revoke other active sessions after password change
                </label>
              </div>

              <div className="d-flex justify-content-end gap-2">
                <button
                  className="btn sky-btn-ghost"
                  disabled={passwordSaving}
                  onClick={closePasswordModal}
                  type="button"
                >
                  Cancel
                </button>
                <button className="btn sky-btn-primary" disabled={passwordSaving} type="submit">
                  {passwordSaving ? 'Changing...' : 'Change password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default Navbar;
