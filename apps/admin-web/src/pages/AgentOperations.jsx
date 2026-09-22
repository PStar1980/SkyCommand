import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import agentService from '../services/agentService.js';
import { containmentEntries, runtimeIdentity } from './agentOperationsPresentation.mjs';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED']);

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function prettyJson(value) {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

function AgentOperations() {
  const { hasPermission } = useAuth();
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedRun = useMemo(() => runs.find((run) => run.runId === selectedId) || null, [runs, selectedId]);
  const canCancel = hasPermission('AGENT_RUN_CANCEL_OWN') || hasPermission('AGENT_RUN_CANCEL_PROJECT');
  const canRootStop = hasPermission('AGENT_ROOT_STOP');

  const loadDetail = useCallback(async (runId, quiet = false) => {
    if (!runId) {
      setDetail(null);
      return;
    }
    if (!quiet) setDetailLoading(true);
    try {
      const result = await agentService.getAgentRun(runId);
      setDetail(result);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Agent Run detail.');
    } finally {
      if (!quiet) setDetailLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await agentService.listAgentRuns({ limit: 100 });
      const nextRuns = result.items || [];
      setRuns(nextRuns);
      setSelectedId((current) => nextRuns.some((run) => run.runId === current) ? current : nextRuns[0]?.runId || '');
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Agent Operations.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
    const timer = window.setInterval(() => loadRuns(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadRuns]);

  useEffect(() => {
    loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const timer = window.setInterval(() => loadDetail(selectedId, true), 3000);
    return () => window.clearInterval(timer);
  }, [loadDetail, selectedId]);

  async function cancelRun() {
    if (!detail?.runId || !canCancel || TERMINAL_STATUSES.has(String(detail.status).toUpperCase())) return;
    if (!window.confirm('Cancel this Agent Run and revoke its active authority?')) return;
    setError('');
    try {
      await agentService.cancelAgentRun(detail.runId);
      setNotice('Cancellation requested. The durable workflow will publish the terminal evidence.');
      await Promise.all([loadRuns(true), loadDetail(detail.runId, true)]);
    } catch (actionError) {
      setError(actionError.message || 'Cancellation could not be requested.');
    }
  }

  async function stopRoot() {
    if (!detail?.rootExecutionId || !canRootStop) return;
    if (!window.confirm('Stop this root execution and revoke all active run grants?')) return;
    setError('');
    try {
      await agentService.stopExecutionScope(detail.rootExecutionId);
      setNotice('Root stop requested. All active run grants were revoked before signaling the workflow.');
      await Promise.all([loadRuns(true), loadDetail(detail.runId, true)]);
    } catch (actionError) {
      setError(actionError.message || 'Root stop could not be requested.');
    }
  }

  return (
    <>
      <PageHeader
        actions={<button className="btn sky-btn-ghost" disabled={loading} onClick={() => loadRuns()} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>}
        kicker="Agents · Operations"
        subtitle="Durable Phase 19.2A Agent Runs, authority snapshots, provider-operation journals, normalized events, and immutable results."
        title="Agent Operations"
      />
      <DismissibleAlert tone="danger">{error}</DismissibleAlert>
      <DismissibleAlert tone="success">{notice}</DismissibleAlert>
      <DismissibleAlert tone="info">Controlled source-backed fake runtime execution is enabled in Phase 19.2A. Real providers, capability effects, scheduler execution, delegation, writable development workspaces, and external Agent execution remain disabled.</DismissibleAlert>

      <div className="row g-3 mt-1">
        <div className="col-xl-5">
          <Panel title="Agent Runs" subtitle={`${runs.length} visible durable run(s)`}>
            {loading ? <div className="sky-empty-state py-4">Loading Agent Runs…</div> : runs.length === 0 ? <div className="sky-empty-state py-4">No visible Agent Runs.</div> : (
              <div className="table-responsive">
                <table className="table table-sm align-middle sky-table mb-0">
                  <thead><tr><th>Agent</th><th>Runtime</th><th>Status</th><th>Created</th></tr></thead>
                  <tbody>{runs.map((run) => <tr className={run.runId === selectedId ? 'table-active' : ''} key={run.runId} onClick={() => setSelectedId(run.runId)} role="button" tabIndex="0" onKeyDown={(event) => { if (event.key === 'Enter') setSelectedId(run.runId); }}>
                    <td><div className="fw-semibold">{run.agentCode || 'Agent'}</div><div className="small sky-muted sky-mono">{run.runId.slice(0, 12)}</div></td>
                    <td><span className="sky-pill sky-pill-info">{runtimeIdentity(run.runtimeKind)}</span><div className="small sky-muted">Scenario / case: {run.fakeRuntimeCaseId || 'UNKNOWN'}</div></td>
                    <td><StatusPill status={run.status} /></td>
                    <td className="small">{formatDate(run.createdAt)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="col-xl-7">
          <Panel
            actions={<div className="d-flex flex-wrap gap-2"><StatusPill status={detail?.status || 'UNKNOWN'} />{detail && canCancel && !TERMINAL_STATUSES.has(String(detail.status).toUpperCase()) && <button className="btn btn-sm sky-btn-ghost" onClick={cancelRun} type="button">Cancel Run</button>}{detail && canRootStop && <button className="btn btn-sm sky-btn-danger" onClick={stopRoot} type="button">Stop Root</button>}</div>}
            kicker="RUN DETAIL"
            subtitle={detail ? `${detail.projectCode || 'Project'} · ${detail.agentCode || 'Agent'} · ${runtimeIdentity(detail.runtimeKind)}` : 'Select a durable Agent Run.'}
            title={detail?.fakeRuntimeCaseId || 'No Agent Run selected'}
          >
            {detailLoading ? <div className="sky-empty-state py-4">Loading evidence…</div> : !detail ? <div className="sky-empty-state py-4">Select an Agent Run to inspect its durable evidence.</div> : <div className="sky-card-body">
              <div className="table-responsive"><table className="table table-sm sky-table"><tbody>
                <tr><th>Run / root / session</th><td className="sky-mono">{detail.runId}<br />{detail.rootExecutionId}<br />{detail.sessionId}</td></tr>
                <tr><th>Stable Temporal Workflow</th><td className="sky-mono">{detail.stableTemporalWorkflowId || '—'}</td></tr>
                <tr><th>Authority snapshot</th><td className="sky-mono">{detail.authoritySnapshot?.digest || '—'}</td></tr>
                <tr><th>Runtime identity</th><td><span className="sky-pill sky-pill-info">{runtimeIdentity(detail.runtimeKind)}</span><div className="small sky-muted">Fake-runtime scenario / case: {detail.fakeRuntimeCaseId || 'UNKNOWN'}</div></td></tr>
                <tr><th>Runtime Worker</th><td>{detail.runtimeCell?.workerIdentity || '—'} · {detail.runtimeCell?.workerGeneration || '—'}<div className="small sky-muted">{detail.runtimeCell?.taskQueue || '—'} · {detail.runtimeCell?.readinessStatus || 'UNKNOWN'}</div></td></tr>
                <tr><th>Containment</th><td className="small">{containmentEntries(detail.runtimeCell?.containmentProfile).length ? <div className="d-flex flex-wrap gap-2">{containmentEntries(detail.runtimeCell.containmentProfile).map((entry) => <span className="sky-pill sky-pill-info" key={entry.key}>{entry.label}: {entry.value}</span>)}</div> : 'Not yet observed.'}</td></tr>
                <tr><th>Created / terminal</th><td>{formatDate(detail.createdAt)} · {formatDate(detail.terminalAt)}</td></tr>
              </tbody></table></div>

              <div className="mt-3"><div className="sky-page-kicker mb-2">Provider Operation Journal</div><div className="table-responsive"><table className="table table-sm sky-table"><thead><tr><th>Operation</th><th>State</th><th>Certainty</th><th>Fence</th></tr></thead><tbody>{(detail.providerOperations || []).map((operation) => <tr key={operation.operationId}><td className="sky-mono">{operation.operationType}<div className="small sky-muted">{operation.operationId.slice(0, 12)}</div></td><td><StatusPill status={operation.state} /></td><td>{operation.outcomeCertainty}</td><td>{operation.fenceEpoch}</td></tr>)}</tbody></table></div></div>

              <div className="mt-3"><div className="sky-page-kicker mb-2">Normalized Events</div><div className="table-responsive"><table className="table table-sm sky-table"><thead><tr><th>#</th><th>Event</th><th>Availability</th><th>Freshness</th><th>Observed</th></tr></thead><tbody>{(detail.events || []).map((event) => <tr key={event.eventId}><td>{event.sequence}</td><td>{event.eventType}<div className="small sky-muted sky-mono">{event.sourceKind}</div></td><td>{event.availability}</td><td>{event.freshness}</td><td className="small">{formatDate(event.observedAt)}</td></tr>)}</tbody></table></div></div>

              <div className="mt-3"><div className="sky-page-kicker mb-2">Immutable Result</div>{detail.result ? <><div className="d-flex flex-wrap gap-2 mb-2"><StatusPill status={detail.result.resultStatus} /><span className="sky-pill sky-pill-info sky-mono">{detail.result.resultDigest}</span></div><pre className="sky-code-block">{prettyJson(detail.result.result)}</pre></> : <div className="sky-empty-state py-3">No terminal result has been published yet.</div>}</div>
            </div>}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default AgentOperations;
