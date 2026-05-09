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

function formatDuration(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  const milliseconds = Number(value);

  if (!Number.isFinite(milliseconds)) {
    return '—';
  }

  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${totalSeconds} s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
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

function resultClass(success) {
  if (success === true) {
    return 'sky-pill-success';
  }

  if (success === false) {
    return 'sky-pill-danger';
  }

  return 'sky-pill-info';
}

function buildToolLabelMap(tools = []) {
  return tools.reduce((toolLabels, tool) => {
    if (tool.toolCode) {
      toolLabels[tool.toolCode] = tool.label || tool.toolCode;
    }

    return toolLabels;
  }, {});
}

function getToolDisplayName(execution, toolLabels = {}) {
  if (!execution) {
    return '—';
  }

  return (
    execution.metadata?.toolLabel ||
    execution.toolLabel ||
    toolLabels[execution.scriptName] ||
    toolLabels[execution.script_name] ||
    execution.scriptName ||
    execution.script_name ||
    '—'
  );
}

function formatAction(value) {
  if (!value) {
    return '—';
  }

  return String(value)
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function Dashboard() {
  const { permissions, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    tools: 0,
    executions: 0,
    auditEvents: 0,
    recentExecution: null,
    recentAudit: null,
    toolLabels: {},
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
          recentAudit: auditResult.items?.[0] || null,
          toolLabels: buildToolLabelMap(toolsResult.tools || []),
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

      <section className="sky-card sky-table-card mt-4">
        <div className="sky-card-header">
          <h2 className="h5 mb-0">Latest Execution</h2>
        </div>

        {summary.recentExecution ? (
          <div className="table-responsive">
            <table className="table sky-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div className="fw-bold sky-detail-value">
                      {getToolDisplayName(summary.recentExecution, summary.toolLabels)}
                    </div>
                    <div className="small sky-muted sky-mono">
                      {summary.recentExecution.scriptName ||
                        summary.recentExecution.script_name ||
                        '—'}
                    </div>
                  </td>
                  <td>
                    <span className={`sky-pill ${statusClass(summary.recentExecution.status)}`}>
                      {summary.recentExecution.status || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{formatDate(summary.recentExecution.startedAt)}</td>
                  <td>{formatDuration(summary.recentExecution.durationMs)}</td>
                  <td>{formatDate(summary.recentExecution.finishedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sky-card-body">
            <div className="sky-empty-state">No script executions yet.</div>
          </div>
        )}
      </section>

      <section className="sky-card sky-table-card mt-4">
        <div className="sky-card-header">
          <h2 className="h5 mb-0">Latest Audit</h2>
        </div>

        {summary.recentAudit ? (
          <div className="table-responsive">
            <table className="table sky-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Message</th>
                  <th>Result</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div className="fw-bold sky-detail-value">
                      {formatAction(summary.recentAudit.action)}
                    </div>
                    <div className="small sky-muted">{summary.recentAudit.resourceType || '—'}</div>
                  </td>
                  <td>
                    <div className="sky-detail-value sky-truncate">
                      {summary.recentAudit.message || '—'}
                    </div>
                  </td>
                  <td>
                    <span className={`sky-pill ${resultClass(summary.recentAudit.success)}`}>
                      {summary.recentAudit.success === true
                        ? 'SUCCESS'
                        : summary.recentAudit.success === false
                          ? 'FAILED'
                          : 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{formatDate(summary.recentAudit.createdAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sky-card-body">
            <div className="sky-empty-state">No audit events yet.</div>
          </div>
        )}
      </section>
    </>
  );
}

export default Dashboard;
