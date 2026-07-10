import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import adminService from '../services/adminService';

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusClass(status) {
  const normalized = String(status || '').toUpperCase();

  if (['PASS', 'ONLINE', 'CURRENT', 'HEALTHY'].includes(normalized)) {
    return 'sky-pill-success';
  }

  if (['FAIL', 'FAILED', 'ERROR', 'OFFLINE'].includes(normalized)) {
    return 'sky-pill-danger';
  }

  if (['WARNING', 'DEGRADED', 'STALE', 'BUSY'].includes(normalized)) {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function dotClass(status) {
  const pillClass = statusClass(status);

  if (pillClass.includes('success')) {
    return 'sky-status-dot-success';
  }

  if (pillClass.includes('danger')) {
    return 'sky-status-dot-danger';
  }

  if (pillClass.includes('warning')) {
    return 'sky-status-dot-warning';
  }

  return 'sky-status-dot-info';
}

function CheckRow({ check }) {
  return (
    <tr>
      <td>
        <div className="fw-bold sky-detail-value">{check.label}</div>
        <div className="small sky-muted sky-mono">{check.code}</div>
      </td>
      <td>
        <span className={`sky-pill ${statusClass(check.status)}`}>{check.status}</span>
      </td>
      <td>{check.message || '—'}</td>
    </tr>
  );
}

function SectionCard({ section }) {
  return (
    <section className="sky-card sky-table-card h-100">
      <div className="sky-card-header d-flex align-items-start justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">{section.code}</div>
          <h2 className="h5 mb-1">{section.label}</h2>
          <div className="small sky-muted">{section.description}</div>
        </div>
        <span className={`sky-pill ${statusClass(section.status)}`}>{section.status}</span>
      </div>
      <div className="table-responsive">
        <table className="table sky-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {(section.checks || []).map((check) => (
              <CheckRow check={check} key={check.code} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CommandCard({ label, command }) {
  return (
    <div className="sky-worker-command-card">
      <div className="sky-page-kicker mb-2">{label}</div>
      <pre className="sky-code-block sky-worker-json-preview mb-0"><code>{command || '—'}</code></pre>
    </div>
  );
}

function ProductionReadiness() {
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadReadiness() {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.getProductionReadiness();
      setReadiness(result);
      setRefreshingAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load production readiness.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReadiness();
  }, []);

  const counts = readiness?.counts || {};
  const sections = readiness?.sections || [];
  const workerHealth = readiness?.workerHealth || {};
  const commands = readiness?.commands || {};
  const topRisks = useMemo(
    () =>
      sections.flatMap((section) =>
        (section.checks || [])
          .filter((check) => ['FAIL', 'WARNING'].includes(check.status))
          .map((check) => ({
            ...check,
            sectionLabel: section.label,
          })),
      ),
    [sections],
  );

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Configuration · Production readiness</div>
          <h1 className="sky-page-title">Production Readiness</h1>
          <p className="sky-page-subtitle">
            Inspect environment secrets, Temporal worker health, database objects, workflow graph safety,
            authorization, and operational reminders before SkyCommand leaves local-dev comfort.
          </p>
        </div>
        <div className="text-md-end">
          <button className="btn sky-btn-ghost" disabled={loading} onClick={loadReadiness} type="button">
            {loading ? 'Refreshing...' : 'Refresh checklist'}
          </button>
          <div className="small sky-muted mt-2">
            Last refresh: {refreshingAt ? formatDate(refreshingAt) : '—'}
          </div>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-worker-hero mb-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className={`sky-status-dot ${dotClass(readiness?.overallStatus)}`} />
            <span className={`sky-pill ${statusClass(readiness?.overallStatus)}`}>
              {readiness?.overallStatus || 'LOADING'}
            </span>
          </div>
          <h2 className="h4 mb-2">Production hardening pulse</h2>
          <p className="sky-muted mb-3">
            {counts.pass || 0} pass · {counts.warning || 0} warning · {counts.fail || 0} fail ·{' '}
            {counts.info || 0} info across {readiness?.totalChecks || 0} checks.
          </p>
          {topRisks.length > 0 ? (
            <div className="alert alert-warning mb-0">
              <div className="fw-bold mb-1">Top readiness items</div>
              <ul className="mb-0 ps-3">
                {topRisks.slice(0, 4).map((risk) => (
                  <li key={`${risk.sectionLabel}-${risk.code}`}>
                    <span className="fw-bold">{risk.sectionLabel}:</span> {risk.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="alert alert-success mb-0">
              No blocking production readiness issues were detected by the local checklist.
            </div>
          )}
        </div>

        <div className="sky-worker-command-strip">
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Temporal</div>
            <div className="sky-worker-command-value">
              {workerHealth.temporalReachable ? 'Reachable' : 'Offline'}
            </div>
            <div className="small sky-muted mt-2">Worker {workerHealth.workerStatus || 'UNKNOWN'}</div>
          </div>
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Task queue</div>
            <div className="sky-worker-command-value">
              {workerHealth.taskQueueHealthy ? 'Healthy' : 'Check'}
            </div>
            <div className="small sky-muted mt-2">Active runs {workerHealth.activeRuns || 0}</div>
          </div>
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Approvals</div>
            <div className="sky-worker-command-value">{workerHealth.pendingApprovals || 0}</div>
            <div className="small sky-muted mt-2">Pending approval gates</div>
          </div>
        </div>
      </section>

      <div className="row g-3 mb-3">
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card sky-dashboard-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Passed</div>
              <div className="sky-stat-value">{counts.pass || 0}</div>
              <div className="small sky-muted mt-2">Checks that look ready</div>
            </div>
          </section>
        </div>
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card sky-dashboard-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Warnings</div>
              <div className="sky-stat-value">{counts.warning || 0}</div>
              <div className="small sky-muted mt-2">Needs review before production</div>
            </div>
          </section>
        </div>
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card sky-dashboard-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Failures</div>
              <div className="sky-stat-value">{counts.fail || 0}</div>
              <div className="small sky-muted mt-2">Blocking readiness gaps</div>
            </div>
          </section>
        </div>
        <div className="col-sm-6 col-xl-3">
          <section className="sky-card sky-stat-card sky-dashboard-stat-card">
            <div className="sky-card-body">
              <div className="sky-page-kicker">Info</div>
              <div className="sky-stat-value">{counts.info || 0}</div>
              <div className="small sky-muted mt-2">Manual hardening reminders</div>
            </div>
          </section>
        </div>
      </div>

      <div className="row g-3">
        {sections.map((section) => (
          <div className="col-12" key={section.code}>
            <SectionCard section={section} />
          </div>
        ))}
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-8">
          <section className="sky-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Operator commands</h2>
                <div className="small sky-muted">Local commands to verify the automation engine while hardening.</div>
              </div>
              <Link className="btn btn-sm sky-btn-ghost" to="/workflows/worker-health">
                Open worker health
              </Link>
            </div>
            <div className="sky-card-body sky-worker-param-grid">
              <CommandCard label="Start API" command={commands.startApi} />
              <CommandCard label="Start Admin-Web" command={commands.startWeb} />
              <CommandCard label="Start Temporal" command={commands.startTemporal} />
              <CommandCard label="Start worker" command={commands.startTemporalWorker} />
              <CommandCard label="Describe task queue" command={commands.describeTaskQueue} />
              <CommandCard label="DB health" command={commands.dbHealth} />
            </div>
          </section>
        </div>

        <div className="col-xl-4">
          <section className="sky-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">What this is not yet</h2>
              <div className="small sky-muted">Deployment work intentionally left for later phases.</div>
            </div>
            <div className="sky-card-body">
              <ul className="sky-muted mb-0 ps-3">
                <li>No process supervisor or auto-restart control.</li>
                <li>No Docker, Kubernetes, NSSM, or systemd packaging.</li>
                <li>No external secrets vault integration.</li>
                <li>No production Temporal database provisioning.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default ProductionReadiness;
