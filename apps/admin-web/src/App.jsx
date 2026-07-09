import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import { useAuth } from './context/AuthContext.jsx';

const WORKBENCH_ROUTE_PREFIXES = [
  '/workflows/manage',
  '/workflows/history',
  '/workflows/start',
  '/workflows/create',
  '/workflows/worker-health',
  '/configuration/production-readiness',
];

function App() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const isWorkbenchPage = WORKBENCH_ROUTE_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix),
  );

  return (
    <div className={`sky-app-shell ${isAuthenticated ? 'sky-app-shell-authenticated' : ''}`}>
      <Navbar />
      <main className={`container-fluid sky-main ${isWorkbenchPage ? 'sky-main-workbench' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}

export default App;
