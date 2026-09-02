import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import workflowService from '../services/workflowService.js';

import DismissibleAlert from './ui/DismissibleAlert.jsx';
function formatDate(value) {
  if (!value) {
    return '—';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
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

function formatApiError(error) {
  if (error?.details?.requiredRoleCode) {
    return `${error.message || 'Approval action failed.'} Required role: ${error.details.requiredRoleCode}.`;
  }

  if (error?.details?.permissionCode) {
    return `${error.message || 'Approval action failed.'} Required permission: ${error.details.permissionCode}.`;
  }

  return error?.message || 'Approval action failed.';
}

function WorkflowApprovalOverlay({
  approval,
  canDecide = false,
  hasRequiredRole = false,
  onClose,
  onDecisionComplete,
}) {
  const [decisionNote, setDecisionNote] = useState('');
  const [deciding, setDeciding] = useState('');
  const [error, setError] = useState('');
  const decisionNoteRef = useRef(null);
  const approveButtonRef = useRef(null);

  const open = Boolean(approval);
  const pending = String(approval?.status || '').toUpperCase() === 'PENDING';
  const authorized = pending && canDecide && hasRequiredRole;

  useEffect(() => {
    setDecisionNote('');
    setDeciding('');
    setError('');
  }, [approval?.approvalRequestId]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !deciding) {
        onClose?.();
        return;
      }

      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        authorized &&
        !deciding &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        approveButtonRef.current?.click();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [authorized, deciding, onClose, open]);

  useEffect(() => {
    if (!open || !authorized) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      decisionNoteRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [approval?.approvalRequestId, authorized, open]);

  async function decide(decision) {
    if (!approval?.approvalRequestId || !authorized || deciding) {
      return;
    }

    setDeciding(decision);
    setError('');

    try {
      const result = await workflowService.decideApproval(approval.approvalRequestId, {
        decision,
        decisionNote,
      });

      await onDecisionComplete?.(result, approval);
      setDeciding('');
      onClose?.();
    } catch (decisionError) {
      setError(formatApiError(decisionError));
      setDeciding('');
    }
  }

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      aria-modal="true"
      className="sky-chart-modal-backdrop sky-workflow-approval-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deciding) {
          onClose?.();
        }
      }}
      role="dialog"
    >
      <section
        className="sky-chart-modal sky-workflow-approval-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sky-chart-modal-header">
          <div>
            <div className="sky-page-kicker sky-chart-modal-kicker">Human approval checkpoint</div>
            <h2>{approval.approvalTitle || 'Approval required'}</h2>
            <p>
              Review the completed workflow evidence, record an optional decision note, and signal
              Temporal when the required human work is complete.
            </p>
          </div>
          <button
            aria-label="Close approval review"
            className="sky-chart-modal-close"
            disabled={Boolean(deciding)}
            onClick={() => onClose?.()}
            type="button"
          >
            <svg aria-hidden="true" className="sky-chart-modal-close-icon" viewBox="0 0 24 24">
              <path d="M6.5 6.5l11 11" />
              <path d="M17.5 6.5l-11 11" />
            </svg>
          </button>
        </div>

        <div className="sky-workflow-approval-modal-body">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
            <div>
              <div className="sky-page-kicker">
                {approval.workflowDisplayName || approval.workflowCode || 'Workflow'}
              </div>
              <div className="small sky-muted sky-mono mt-1">
                {approval.nodeKey || 'approval node'} · {approval.approvalKey || 'approval'}
              </div>
            </div>
            <span className={`sky-pill ${pending ? 'sky-pill-warning' : 'sky-pill-info'}`}>
              {approval.status || 'PENDING'}
            </span>
          </div>

          {approval.instructions ? (
            <div className="sky-workflow-approval-instructions mt-3">
              <div className="sky-page-kicker mb-1">Required human processing</div>
              <p className="mb-0">{approval.instructions}</p>
            </div>
          ) : null}

          <div className="sky-workflow-approval-metrics mt-3">
            <div className="sky-stat-card">
              <div className="sky-stat-label">Requested</div>
              <div className="sky-stat-value small">{formatDate(approval.requestedAt)}</div>
            </div>
            <div className="sky-stat-card">
              <div className="sky-stat-label">Timeout</div>
              <div className="sky-stat-value small">{formatDurationMs(approval.timeoutMs)}</div>
            </div>
            <div className="sky-stat-card">
              <div className="sky-stat-label">Required role</div>
              <div className="sky-stat-value small">{approval.requiredRoleCode || 'Any approver'}</div>
            </div>
            <div className="sky-stat-card">
              <div className="sky-stat-label">Temporal signal</div>
              <div className="sky-stat-value small">{approval.temporalWorkflowId ? 'Ready' : 'Not linked'}</div>
            </div>
          </div>

          {error ? (
            <DismissibleAlert className="alert alert-danger mt-3 mb-0">{error}</DismissibleAlert>
          ) : null}

          {!pending ? (
            <div className="alert alert-secondary mt-3 mb-0">
              This approval request has already been decided.
            </div>
          ) : !canDecide ? (
            <div className="alert alert-warning mt-3 mb-0">
              You can inspect this checkpoint, but your account does not have workflow approval
              decision permission.
            </div>
          ) : !hasRequiredRole ? (
            <div className="alert alert-warning mt-3 mb-0">
              This checkpoint requires the {approval.requiredRoleCode} role. The approval controls
              remain disabled for this account.
            </div>
          ) : null}

          <div className="mt-3">
            <label className="form-label" htmlFor="workflowGraphApprovalDecisionNote">
              Decision note
            </label>
            <textarea
              className="form-control sky-form-control"
              disabled={!authorized || Boolean(deciding)}
              id="workflowGraphApprovalDecisionNote"
              maxLength={4000}
              onChange={(event) => setDecisionNote(event.target.value)}
              placeholder="Optional note stored with the approval decision"
              ref={decisionNoteRef}
              rows={4}
              value={decisionNote}
            />
          </div>

          <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-4">
            <div className="small sky-muted">
              Approval resumes the workflow. Rejection follows the node&apos;s configured action or
              forward branch.
            </div>
            <div className="d-flex flex-wrap gap-2">
              <button
                className="btn btn-outline-danger"
                disabled={!authorized || Boolean(deciding)}
                onClick={() => decide('REJECTED')}
                type="button"
              >
                {deciding === 'REJECTED' ? 'Rejecting…' : 'Reject'}
              </button>
              <button
                className="btn sky-btn-primary"
                disabled={!authorized || Boolean(deciding)}
                onClick={() => decide('APPROVED')}
                ref={approveButtonRef}
                type="button"
              >
                {deciding === 'APPROVED' ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default WorkflowApprovalOverlay;
