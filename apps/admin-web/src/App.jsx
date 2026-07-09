import { Outlet } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import { useAuth } from './context/AuthContext.jsx';

function App() {
  const { isAuthenticated } = useAuth();

  return (
    <div className={`sky-app-shell ${isAuthenticated ? 'sky-app-shell-authenticated' : ''}`}>
      <Navbar />
      <main className="container-fluid sky-main">
        <Outlet />
      </main>
    </div>
  );
}

export default App;
