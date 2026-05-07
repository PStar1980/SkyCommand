import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

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
      <section className="sky-card">
        <div className="sky-card-body">
          <span className="sky-pill sky-pill-danger">Access blocked</span>
          <h1 className="h4 mt-3">Permission required</h1>
          <p className="sky-muted mb-0">
            This screen requires <span className="sky-mono">{permissionCode}</span>.
          </p>
        </div>
      </section>
    );
  }

  return children;
}

export default ProtectedRoute;
