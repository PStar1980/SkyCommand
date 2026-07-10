import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import workflowService from '../services/workflowService.js';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'ALL', label: 'All' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'TIMED_OUT', label: 'Timed out' },
  { value: 'CANCELED', label: 'Canceled' },
];

function formatDate(value) {
  if (!value) {
    return '—';
  }

  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}

function formatDurationMs(value) {
  const durationMs = Number(value || 0);

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 'No timeout';
  }

  const minutes = durationMs / 60000;

  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  const hours = minutes / 60;

  if (hours < 48) {
    return `${Math.round(hours)} hr`;
  }

  return `${Math.round(hours / 24)} day(s)`;
}

function statusClass(status) {
  const normalized = String(status || '').toUpperCase();

  if (normalized === 'PENDING') {
    return 'sky-pill-warning';
  }

  if (normalized === 'APPROVED') {
    return 'sky-pill-success';
  }

  if (normalized === 'REJECTED' || normalized === 'TIMED_OUT') {
    return 'sky-pill-danger';
  }

  return 'sky-pill-info';
}

function formatApiError(error) {
  if (error?.details?.requiredRoleCode) {
    return `${error.message} Required role: ${error.details.requiredRoleCode}`;
  }

  return error?.message || 'Approval action failed.';
}

function WorkflowApprovals() {
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState('PENDING');
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState('');
  const [notesById, setNotesById] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canDecide = hasPermission('WORKFLOW_APPROVAL_DECIDE');
  const pendingCount = useMemo(
    () => approvals.filter((approval) => approval.status === 'PENDING').length,
    [approvals],
  );

  async function loadApprovals(nextStatus = status) {
    setLoading(true);
    setError('');

    try {
      const result = await workflowService.listApprovals({
        status: nextStatus,
        limit: 50,
      });
      setApprovals(result.items || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load workflow approvals.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApprovals(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function patchNote(approvalRequestId, value) {
    setNotesById((current) => ({
      ...current,
      [approvalRequestId]: value,
    }));
  }

  async function decide(approval, decision) {
    setDecidingId(approval.approvalRequestId);
    setError('');
    setMessage('');

    try {
      const result = await workflowService.decideApproval(approval.approvalRequestId, {
        decision,
        decisionNote: notesById[approval.approvalRequestId] || '',
      });
      setMessage(result.message || `Approval ${decision.toLowerCase()}.`);
      setNotesById((current) => ({
        ...current,
        [approval.approvalRequestId]: '',
      }));
      await loadApprovals(status);
    } catch (decisionError) {
      setError(formatApiError(decisionError));
    } finally {
      setDecidingId('');
    }
  }

  return (
    <div className="sky-page-shell">
      <header className="sky-page-header">
        <div className="sky-page-heading">
          <div className="sky-page-kicker">Workflows · Approvals</div>
          <h1 className="sky-page-title">Human Approval Queue</h1>
          <p className="sky-page-subtitle">
            Review durable approval checkpoints created by HUMAN_APPROVAL workflow nodes. Decisions are sent back to Temporal as workflow signals.
          </p>
        </div>
        <div className="sky-page-actions">
          <button className="btn sky-btn-ghost" disabled={loading} onClick={() => loadApprovals(status)} type="button">
            Refresh
          </button>
        </div>
      </header>

      <section className="sky-card mb-4">
        <div className="sky-card-header d-flex flex-wrap justify-content-between gap-3 align-items-center">
          <div>
            <div className="sky-page-kicker">Approval control</div>
            <h2 className="h5 mb-0">Pending human gates</h2>
          </div>
          <div className="d-flex gap-2 align-items-center">
            <span className="sky-pill sky-pill-warning">{pendingCount} pending</span>
            <select
              className="form-select sky-form-control"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="sky-card-body">
          {error && <div className="alert alert-danger py-2">{error}</div>}
          {message && <div className="alert alert-success py-2">{message}</div>}
          {loading ? (
            <div className="sky-muted">Loading approvals…</div>
          ) : approvals.length === 0 ? (
            <div className="sky-empty-state">
              <div className="sky-empty-title">No approval requests found</div>
              <p className="mb-0">When a running workflow hits a Human Approval node, its request will appear here.</p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              {approvals.map((approval) => {
                const isPending = approval.status === 'PENDING';
                const busy = decidingId === approval.approvalRequestId;

                return (
                  <article className="sky-nested-card" key={approval.approvalRequestId}>
                    <div className="d-flex flex-wrap justify-content-between gap-3 align-items-start">
                      <div>
                        <div className="sky-page-kicker">{approval.workflowDisplayName || approval.workflowCode}</div>
                        <h3 className="h5 mb-1">{approval.approvalTitle}</h3>
                        <div className="small sky-muted sky-mono">
                          {approval.nodeKey} · {approval.approvalKey} · {approval.workflowRunRecordId}
                        </div>
                      </div>
                      <span className={`sky-pill ${statusClass(approval.status)}`}>{approval.status}</span>
                    </div>

                    {approval.instructions && (
                      <p className="mt-3 mb-0">{approval.instructions}</p>
                    )}

                    <div className="row g-3 mt-2">
                      <div className="col-md-3">
                        <div className="sky-stat-card h-100">
                          <div className="sky-stat-label">Requested</div>
                          <div className="sky-stat-value small">{formatDate(approval.requestedAt)}</div>
                        </div>
                      </div>
                      <div className="col-md-3">
                        <div className="sky-stat-card h-100">
                          <div className="sky-stat-label">Timeout</div>
                          <div className="sky-stat-value small">{formatDurationMs(approval.timeoutMs)}</div>
                        </div>
                      </div>
                      <div className="col-md-3">
                        <div className="sky-stat-card h-100">
                          <div className="sky-stat-label">Required role</div>
                          <div className="sky-stat-value small">{approval.requiredRoleCode || 'Any approver'}</div>
                        </div>
                      </div>
                      <div className="col-md-3">
                        <div className="sky-stat-card h-100">
                          <div className="sky-stat-label">Temporal</div>
                          <div className="sky-stat-value small sky-mono">{approval.temporalWorkflowId ? 'Linked' : 'Not linked'}</div>
                        </div>
                      </div>
                    </div>

                    {approval.decisionNote && (
                      <div className="alert alert-secondary mt-3 mb-0 py-2">
                        Decision note: {approval.decisionNote}
                      </div>
                    )}

                    {isPending && canDecide && (
                      <div className="mt-3">
                        <label className="form-label" htmlFor={`approval-note-${approval.approvalRequestId}`}>Decision note</label>
                        <textarea
                          className="form-control sky-form-control"
                          id={`approval-note-${approval.approvalRequestId}`}
                          onChange={(event) => patchNote(approval.approvalRequestId, event.target.value)}
                          placeholder="Optional note stored with the approval decision"
                          rows={2}
                          value={notesById[approval.approvalRequestId] || ''}
                        />
                        <div className="d-flex flex-wrap gap-2 mt-3">
                          <button
                            className="btn btn-success"
                            disabled={busy}
                            onClick={() => decide(approval, 'APPROVED')}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-outline-danger"
                            disabled={busy}
                            onClick={() => decide(approval, 'REJECTED')}
                            type="button"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {isPending && !canDecide && (
                      <div className="alert alert-warning mt-3 mb-0 py-2">
                        You can view this request, but you do not have approval decision permission.
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default WorkflowApprovals;
