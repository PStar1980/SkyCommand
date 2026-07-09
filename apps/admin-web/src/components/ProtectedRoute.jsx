import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Panel from './ui/Panel.jsx';
import StatusPill from './ui/StatusPill.jsx';

function ProtectedRoute({ children, permissionCode }) {
  const location = useLocation();
  const { hasPermission, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="sky-empty-state">
        <div className="spinner-border text-info" role="status" aria-label="Loading" />
        <div className="mt-3">Checking session...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate replace to="/login" state={{ from: location }} />;
  }

  if (!hasPermission(permissionCode)) {
    return (
      <Panel className="sky-table-card">
        <div className="sky-card-body">
          <StatusPill status="BLOCKED">Access blocked</StatusPill>
          <h1 className="h4 mt-3">Permission required</h1>
          <p className="sky-muted mb-0">
            This screen requires <span className="sky-mono">{permissionCode}</span>.
          </p>
        </div>
      </Panel>
    );
  }

  return children;
}

export default ProtectedRoute;
