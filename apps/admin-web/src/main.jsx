import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import App from './App.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import AuditEvents from './pages/AuditEvents.jsx';
import AdminPrivileges from './pages/AdminPrivileges.jsx';
import AdminRoles from './pages/AdminRoles.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Home from './pages/Home.jsx';
import IngestionStatus from './pages/IngestionStatus.jsx';
import Login from './pages/Login.jsx';
import ScriptExecutions from './pages/ScriptExecutions.jsx';
import Tools from './pages/Tools.jsx';
import AutomationListeners from './pages/AutomationListeners.jsx';
import SchedulerControl from './pages/SchedulerControl.jsx';
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
              path="ingestion-status"
              element={
                <ProtectedRoute permissionCode="INGESTION_VIEW_STATUS">
                  <IngestionStatus />
                </ProtectedRoute>
              }
            />

            <Route path="worker" element={<Navigate replace to="/automation/scheduler" />} />

            <Route
              path="automation/scheduler"
              element={
                <ProtectedRoute permissionCode="WORKER_SCHEDULE_READ">
                  <SchedulerControl />
                </ProtectedRoute>
              }
            />

            <Route
              path="automation/listeners"
              element={
                <ProtectedRoute permissionCode="WORKER_LISTENER_READ">
                  <AutomationListeners />
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

            <Route
              path="admin/users"
              element={
                <ProtectedRoute permissionCode="ADMIN_USER_READ">
                  <AdminUsers />
                </ProtectedRoute>
              }
            />

            <Route
              path="admin/roles"
              element={
                <ProtectedRoute permissionCode="ADMIN_ROLE_READ">
                  <AdminRoles />
                </ProtectedRoute>
              }
            />

            <Route
              path="admin/privileges"
              element={
                <ProtectedRoute permissionCode="ADMIN_PERMISSION_READ">
                  <AdminPrivileges />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
