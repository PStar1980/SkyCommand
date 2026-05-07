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

function statusClass(status) {
  if (status === 'SUCCESS') {
    return 'sky-pill-success';
  }

  if (status === 'FAILED') {
    return 'sky-pill-danger';
  }

  if (status === 'STARTED') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function getDisplaySummary(summary) {
  if (!summary) {
    return '—';
  }

  const lines = String(summary)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const preferredLine =
    lines.find((line) => /✅|successfully|connected|complete|completed/i.test(line)) ||
    lines.find((line) => !line.includes('[dotenv')) ||
    lines[0] ||
    String(summary);

  return preferredLine.length > 180 ? `${preferredLine.slice(0, 177)}...` : preferredLine;
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

  const statCards = useMemo(
    () => [
      {
        label: 'Visible tools',
        value: loading ? '—' : summary.tools,
        help: 'Permission-filtered Admin-Web tools',
      },
      {
        label: 'Executions',
        value: loading ? '—' : summary.executions,
        help: 'Logged script execution records',
      },
      {
        label: 'Audit events',
        value: loading ? '—' : summary.auditEvents,
        help: 'Authorization and operational trail',
      },
      {
        label: 'Permissions',
        value: permissionCount,
        help: 'Granted to current session',
      },
    ],
    [loading, permissionCount, summary.auditEvents, summary.executions, summary.tools],
  );

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
        {statCards.map((card) => (
          <div className="col-md-3" key={card.label}>
            <section className="sky-card sky-stat-card">
              <div className="sky-card-body">
                <div className="sky-page-kicker">{card.label}</div>
                <div className="sky-stat-value">{card.value}</div>
                <div className="sky-muted small">{card.help}</div>
              </div>
            </section>
          </div>
        ))}
      </div>

      <section className="sky-card mt-4">
        <div className="sky-card-header">
          <h2 className="h5 mb-0">Latest execution</h2>
        </div>
        <div className="sky-card-body">
          {summary.recentExecution ? (
            <div className="row g-3">
              <div className="col-md-3">
                <div className="sky-detail-label small">Tool</div>
                <div className="fw-bold sky-detail-value">{summary.recentExecution.scriptName}</div>
              </div>
              <div className="col-md-3">
                <div className="sky-detail-label small">Status</div>
                <span className={`sky-pill ${statusClass(summary.recentExecution.status)}`}>
                  {summary.recentExecution.status}
                </span>
              </div>
              <div className="col-md-3">
                <div className="sky-detail-label small">Started</div>
                <div className="sky-detail-value">
                  {formatDate(summary.recentExecution.startedAt)}
                </div>
              </div>
              <div className="col-md-3">
                <div className="sky-detail-label small">Summary</div>
                <div className="sky-detail-value sky-truncate">
                  {getDisplaySummary(summary.recentExecution.summary)}
                </div>
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
