import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import App from './App.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import AuditEvents from './pages/AuditEvents.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import ScriptExecutions from './pages/ScriptExecutions.jsx';
import Tools from './pages/Tools.jsx';
import './index.css';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />

            <Route
              path="dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="tools"
              element={
                <ProtectedRoute permissionCode="CORE_VIEW_TOOLS">
                  <Tools />
                </ProtectedRoute>
              }
            />

            <Route
              path="script-executions"
              element={
                <ProtectedRoute permissionCode="SCRIPT_EXECUTION_READ">
                  <ScriptExecutions />
                </ProtectedRoute>
              }
            />

            <Route
              path="audit-events"
              element={
                <ProtectedRoute permissionCode="AUDIT_READ">
                  <AuditEvents />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
