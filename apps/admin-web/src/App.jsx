import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import { useAuth } from './context/AuthContext.jsx';

const WORKBENCH_ROUTE_PREFIXES = [
  '/dashboard',
  '/tools',
  '/workflows',
  '/automation',
  '/data',
  '/configuration',
  '/admin',
  '/access-control',
];

function App() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const isWorkbenchPage = WORKBENCH_ROUTE_PREFIXES.some((prefix) =>
    location.pathname.startsWith(prefix),
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      const mainContent = document.querySelector('.sky-main');
      if (mainContent && typeof mainContent.scrollTo === 'function') {
        mainContent.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [location.pathname]);

  return (
    <div
      className={`sky-app-shell ${
        isAuthenticated ? 'sky-app-shell-authenticated' : 'sky-app-shell-public'
      }`}
    >
      <Navbar />
      <main className={`container-fluid sky-main ${isWorkbenchPage ? 'sky-main-workbench' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}

export default App;
