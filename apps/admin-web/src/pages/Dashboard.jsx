import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';
import toolService from '../services/toolService';

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function Dashboard() {
  const { permissions, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    tools: 0,
    executions: 0,
    auditEvents: 0,
    recentExecution: null,
  });
  const [error, setError] = useState('');

  const permissionCount = useMemo(() => permissions.length, [permissions]);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setError('');

      try {
        const [toolsResult, executionsResult, auditResult] = await Promise.all([
          toolService.listTools(),
          adminService.listScriptExecutions({ limit: 5 }),
          adminService.listAuditEvents({ limit: 5 }),
        ]);

        if (!active) {
          return;
        }

        setSummary({
          tools: toolsResult.tools?.length || 0,
          executions: executionsResult.total || 0,
          auditEvents: auditResult.total || 0,
          recentExecution: executionsResult.items?.[0] || null,
        });
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load dashboard.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Operational dashboard</div>
          <h1 className="sky-page-title">
            Welcome back, {user?.displayName || user?.username || 'Operator'}
          </h1>
          <p className="sky-page-subtitle">
            The Admin-Web control surface is now reading from the authenticated API and
            database-backed manifest.
          </p>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3">
        <div className="col-md-3">
          <section className="sky-card sky-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Visible tools</div>
              <div className="sky-stat-value">{loading ? '—' : summary.tools}</div>
              <div className="sky-muted small">Permission-filtered Admin-Web tools</div>
            </div>
          </section>
        </div>

        <div className="col-md-3">
          <section className="sky-card sky-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Executions</div>
              <div className="sky-stat-value">{loading ? '—' : summary.executions}</div>
              <div className="sky-muted small">Logged script execution records</div>
            </div>
          </section>
        </div>

        <div className="col-md-3">
          <section className="sky-card sky-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Audit events</div>
              <div className="sky-stat-value">{loading ? '—' : summary.auditEvents}</div>
              <div className="sky-muted small">Authorization and operational trail</div>
            </div>
          </section>
        </div>

        <div className="col-md-3">
          <section className="sky-card sky-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Permissions</div>
              <div className="sky-stat-value">{permissionCount}</div>
              <div className="sky-muted small">Granted to current session</div>
            </div>
          </section>
        </div>
      </div>

      <section className="sky-card mt-4">
        <div className="sky-card-header">
          <h2 className="h5 mb-0">Latest execution</h2>
        </div>
        <div className="sky-card-body">
          {summary.recentExecution ? (
            <div className="row g-3">
              <div className="col-md-3">
                <div className="sky-muted small">Tool</div>
                <div className="fw-bold">{summary.recentExecution.scriptName}</div>
              </div>
              <div className="col-md-3">
                <div className="sky-muted small">Status</div>
                <span className="sky-pill sky-pill-success">{summary.recentExecution.status}</span>
              </div>
              <div className="col-md-3">
                <div className="sky-muted small">Started</div>
                <div>{formatDate(summary.recentExecution.startedAt)}</div>
              </div>
              <div className="col-md-3">
                <div className="sky-muted small">Summary</div>
                <div>{summary.recentExecution.summary || '—'}</div>
              </div>
            </div>
          ) : (
            <div className="sky-empty-state">No script executions yet.</div>
          )}
        </div>
      </section>
    </>
  );
}

export default Dashboard;
