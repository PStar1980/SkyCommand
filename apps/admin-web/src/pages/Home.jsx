import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function Home() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="sky-empty-state">
        <div className="spinner-border text-info" role="status" aria-label="Loading" />
      </div>
    );
  }

  return <Navigate replace to={isAuthenticated ? '/dashboard' : '/login'} />;
}

export default Home;
