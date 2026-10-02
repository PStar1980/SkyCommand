import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import agentService from '../services/agentService.js';

const REFERENCE_INSTRUCTION = 'Use the governed SkyCommand MCP Browser Automation capability to run the allowlisted command-center status snapshot. Observe the governed result/artifact and return the registered structured Agent result. Do not use native shell, browser, filesystem writes, Git, Docker, external messaging, spawning, alternate tools, or any unregistered capability.';

function RunAgent() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [instruction, setInstruction] = useState(REFERENCE_INSTRUCTION);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    agentService.getAgentRunOptions()
      .then((payload) => { if (active) setOptions(payload); })
      .catch((loadError) => { if (active) setError(loadError.message || 'Failed to load server-discovered Agent Run options.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const item = useMemo(() => options?.items?.[selectedIndex] || null, [options, selectedIndex]);
  const ready = Boolean(options?.readiness?.ok && options?.readiness?.executionEnabled && item?.runtime?.executionEnabled && item?.runtime?.accountExecutionEnabled);

  async function submit(event) {
    event.preventDefault();
    if (!item || !ready || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await agentService.admitAgentRun({
        projectId: item.project.projectId,
        definitionId: item.agent.definitionId,
        definitionVersionId: item.agent.definitionVersionId,
        projectWorkspaceId: item.workspace.projectWorkspaceId,
        instruction,
        requestedScope: { capabilities: ['AGENT_RUN', 'BROWSER_AUTOMATION'], actions: ['AGENT_RUN', 'RUN'], resources: ['codex-read-only', 'command-center-status-snapshot'], environments: ['DEV_LOCAL', 'LOCAL'], dataClasses: ['INTERNAL'] },
        requestedExecutionSurfaces: { surfaces: [{ surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW', reason: 'The A1 reference task uses only the governed managed Browser capability.' }] },
        constraints: { maxChildren: 0, maxConcurrentChildren: 0, maxDurationMs: 300000 },
        deadlineMs: 300000,
        idempotencyKey: `phase19.3a1-ui-${crypto.randomUUID()}`,
      });
      navigate('/agents/operations', { state: { runId: result.runId || result.run?.runId || null } });
    } catch (submitError) {
      setError(submitError.message || 'The Agent Run could not be admitted.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader kicker="Agents · Run" title="Run Managed Codex Agent" subtitle="Phase 19.3A1 bounded real-provider pilot: one read-only workspace snapshot and one registered Browser capability." />
      {error ? <DismissibleAlert tone="danger" onDismiss={() => setError('')}>{error}</DismissibleAlert> : null}
      <div className="row g-3">
        <div className="col-xl-8">
          <Panel title="Server-discovered admission" subtitle="Project, Agent revision, workspace, runtime, and account choices are supplied by the governed API.">
            {loading ? <div className="sky-empty-state py-4">Loading certified pilot options…</div> : !options?.items?.length ? <div className="sky-empty-state py-4">No certified Phase 19.3A1 pilot selection is currently available.</div> : <form onSubmit={submit}>
              <label className="form-label" htmlFor="agent-run-selection">Pilot selection</label>
              <select className="form-select" id="agent-run-selection" value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
                {options.items.map((entry, index) => <option key={`${entry.project.projectId}:${entry.agent.definitionVersionId}:${entry.workspace.projectWorkspaceId}`} value={index}>{entry.project.projectName} · {entry.agent.agentCode} v{entry.agent.revision} · {entry.workspace.environmentCode}</option>)}
              </select>
              <div className="row g-2 mt-2">
                <div className="col-md-6"><div className="small sky-muted">Managed runtime / account</div><div className="sky-mono">{item.runtime.runtimeKind} · {item.runtime.accountAlias}</div><div className="small">{item.runtime.runtimeProfile} · {item.runtime.accountState}</div></div>
                <div className="col-md-6"><div className="small sky-muted">Workspace</div><div className="sky-mono">{item.workspace.environmentCode} · {item.workspace.workspaceMode}</div><div className="small">Snapshot required · live checkout denied</div></div>
              </div>
              <label className="form-label mt-3" htmlFor="agent-run-instruction">Reference instruction</label>
              <textarea className="form-control" id="agent-run-instruction" rows="6" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={20000} />
              <div className="small sky-muted mt-2">The provider receives this bounded instruction inside the isolated managed runtime. It cannot add tools, routes, credentials, children, or writable workspace authority.</div>
              <button className="btn sky-btn-primary mt-3" disabled={!ready || submitting || !instruction.trim()} type="submit">{submitting ? 'Submitting…' : 'Run Agent'}</button>
            </form>}
          </Panel>
        </div>
        <div className="col-xl-4">
          <Panel title="Admission ceiling" subtitle="Fixed by the registered A1 profile.">
            <div className={`alert ${ready ? 'alert-success' : 'alert-warning'} mb-3`}>{ready ? 'Runtime ready for bounded execution.' : options?.readiness?.readinessReason || 'Runtime readiness is not current.'}</div>
            <dl className="row small mb-0"><dt className="col-7">Capability</dt><dd className="col-5 sky-mono">{options?.capability?.code || '—'}</dd><dt className="col-7">Side effect</dt><dd className="col-5">READ_ONLY</dd><dt className="col-7">Environment</dt><dd className="col-5">LOCAL</dd><dt className="col-7">Native routes</dt><dd className="col-5">DENIED</dd><dt className="col-7">Provider-native tools</dt><dd className="col-5">DENIED</dd><dt className="col-7">Promotion</dt><dd className="col-5">NOT AUTHORIZED</dd></dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

export { REFERENCE_INSTRUCTION };
export default RunAgent;
