import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function statusClass(status) {
  if (status === 'PENDING') return 'sky-pill-warning';
  if (status === 'APPROVED') return 'sky-pill-success';
  if (status === 'REJECTED' || status === 'STALE' || status === 'EXPIRED') return 'sky-pill-danger';
  return 'sky-pill-info';
}

function Field({ label, value, mono = false }) {
  return (
    <div className="col-md-6 col-xl-4 mb-3">
      <div className="sky-page-kicker">{label}</div>
      <div className={`sky-detail-value mt-1 ${mono ? 'sky-mono' : ''}`}>{value || '—'}</div>
    </div>
  );
}

export default function DatabaseUpgradeRequests() {
  const { hasPermission } = useAuth();
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => requests.find((request) => request.requestId === selectedId) || null,
    [requests, selectedId],
  );

  async function loadRequests() {
    setLoading(true);
    setError('');
    try {
      const result = await adminService.listDatabaseUpgradeApplyRequests();
      const items = result.items || [];
      setRequests(items);
      setSelectedId((current) =>
        items.some((item) => item.requestId === current) ? current : items[0]?.requestId || '',
      );
    } catch (loadError) {
      setError(loadError.message || 'Failed to load database-upgrade APPLY requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
  }, []);

  async function decide(decision) {
    if (!selected || selected.status !== 'PENDING') return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await adminService.decideDatabaseUpgradeApplyRequest(selected.requestId, {
        decision,
        ...(note.trim() ? { decisionNote: note.trim() } : {}),
      });
      setMessage(`Request ${decision.toLowerCase()}.`);
      setNote('');
      await loadRequests();
    } catch (saveError) {
      setError(saveError.message || 'Decision was rejected.');
      await loadRequests();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sky-page-shell">
      <header className="sky-page-header">
        <div className="sky-page-heading">
          <div className="sky-page-kicker">Workflows · Database Upgrade</div>
          <h1 className="sky-page-title">Database-upgrade APPLY requests</h1>
          <p className="sky-page-subtitle">
            Review the exact server-derived PLAN envelope before recording a human decision.
          </p>
        </div>
        <button
          className="btn sky-btn-ghost"
          disabled={loading}
          onClick={loadRequests}
          type="button"
        >
          Refresh
        </button>
      </header>

      <div className="alert alert-warning" role="note">
        Approval records authorization only. D2B.1 does not execute database changes.
      </div>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="alert alert-success" role="status">
          {message}
        </div>
      )}

      <div className="row g-4">
        <div className="col-lg-4">
          <section className="sky-card h-100">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Request queue</div>
                <h2 className="h5 mb-0">{requests.length} request(s)</h2>
              </div>
            </div>
            {requests.length === 0 && (
              <div className="p-3 sky-muted">No database-upgrade requests.</div>
            )}
            <div className="list-group list-group-flush">
              {requests.map((request) => (
                <button
                  className={`list-group-item list-group-item-action ${request.requestId === selectedId ? 'active' : ''}`}
                  key={request.requestId}
                  onClick={() => setSelectedId(request.requestId)}
                  type="button"
                >
                  <div className="d-flex justify-content-between gap-2">
                    <span className="sky-mono small">{request.requestId}</span>
                    <span className={`sky-pill ${statusClass(request.status)}`}>
                      {request.status}
                    </span>
                  </div>
                  <div className="small mt-2">
                    {request.databaseName} · {request.pendingCount} pending
                  </div>
                  <div className="small sky-muted">Expires {formatDate(request.expiresAt)}</div>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="col-lg-8">
          <section className="sky-card">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Exact approval envelope</div>
                <h2 className="h5 mb-0">{selected ? selected.requestId : 'Select a request'}</h2>
              </div>
              {selected && (
                <span className={`sky-pill ${statusClass(selected.status)}`}>
                  {selected.status}
                </span>
              )}
            </div>
            {!selected ? (
              <div className="p-3 sky-muted">Choose a request to inspect its evidence.</div>
            ) : (
              <div className="p-3">
                <div className="row">
                  <Field label="Database" value={selected.databaseName} />
                  <Field
                    label="PostgreSQL system identifier"
                    mono
                    value={selected.systemIdentifier}
                  />
                  <Field label="PLAN digest" mono value={selected.planDigest} />
                  <Field label="Request/action digest" mono value={selected.requestDigest} />
                  <Field label="Baseline ordinal" value={selected.baselineOrdinal} />
                  <Field label="Source revision" mono value={selected.sourceRevision} />
                  <Field label="Requester" value={selected.requestedByAgentId} />
                  <Field label="Trigger source" value={selected.triggerSource} />
                  <Field
                    label="Requested / expires"
                    value={`${formatDate(selected.requestedAt)} · ${formatDate(selected.expiresAt)}`}
                  />
                  <Field
                    label="Human decision"
                    value={
                      selected.humanDecisionIdentity?.displayName || selected.humanDecisionUserId
                    }
                  />
                  <Field label="Decision time" value={formatDate(selected.humanDecisionAt)} />
                </div>
                <h3 className="h6 mt-2">Pending governed changes ({selected.pendingCount})</h3>
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th>Ordinal</th>
                        <th>Kind</th>
                        <th>Path</th>
                        <th>SHA-256</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.pendingChanges.map((change) => (
                        <tr key={`${change.kind}-${change.ordinal}`}>
                          <td>{change.ordinal}</td>
                          <td>{change.kind}</td>
                          <td className="sky-mono small">{change.relativePath}</td>
                          <td className="sky-mono small">{change.sha256}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selected.humanDecisionNote && (
                  <p className="small sky-muted mb-3">Note: {selected.humanDecisionNote}</p>
                )}
                {selected.status === 'PENDING' && hasPermission('DB_UPGRADE_APPLY_APPROVE') && (
                  <>
                    <label className="form-label" htmlFor="databaseUpgradeDecisionNote">
                      Decision note (optional)
                    </label>
                    <textarea
                      className="form-control sky-form-control mb-3"
                      id="databaseUpgradeDecisionNote"
                      maxLength={4000}
                      onChange={(event) => setNote(event.target.value)}
                      rows="3"
                      value={note}
                    />
                    <div className="d-flex gap-2">
                      <button
                        className="btn btn-success"
                        disabled={saving}
                        onClick={() => decide('APPROVED')}
                        type="button"
                      >
                        Approve request
                      </button>
                      <button
                        className="btn btn-outline-danger"
                        disabled={saving}
                        onClick={() => decide('REJECTED')}
                        type="button"
                      >
                        Reject request
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
