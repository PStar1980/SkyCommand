import { Outlet } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';

function App() {
  return (
    <div className="sky-app-shell">
      <Navbar />
      <main className="container-fluid sky-main">
        <Outlet />
      </main>
    </div>
  );
}

export default App;
