import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import Panel from '../components/ui/Panel.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import agentService from '../services/agentService.js';

const SURFACES = [
  'REPOSITORY_FILE_EDIT', 'LOCAL_SHELL', 'SKYCOMMAND_MCP_API', 'SKYCOMMAND_UI_COMPUTER_USE',
  'GENERAL_DESKTOP_COMPUTER_USE', 'EXTERNAL_BROWSER', 'CONNECTED_APP_READ',
  'CONNECTED_APP_MUTATION', 'REMOTE_DEVICE', 'PLAYWRIGHT_REGISTERED',
];
const MODES = ['ALLOW', 'READ_ONLY', 'DENY', 'EXPLICIT_APPROVAL_REQUIRED'];
const EMPTY_SCOPE = { capabilities: [], actions: [], resources: [], environments: [], dataClasses: [] };
const DEFAULT_SURFACE_MODES = SURFACES.reduce((result, surface) => {
  result[surface] = surface === 'REPOSITORY_FILE_EDIT' ? 'ALLOW' : 'DENY';
  return result;
}, {});

function json(value) { return JSON.stringify(value, null, 2); }

function ManageAgents() {
  const { hasPermission, hasRole } = useAuth();
  const canManage = hasPermission('AGENT_MANAGE');
  const canRuntimeManage = hasPermission('AGENT_RUNTIME_MANAGE');
  const canPreview = hasPermission('AGENT_AUTHORITY_PREVIEW');
  const adminAll = hasRole('SUPER_ADMIN');
  const [agents, setAgents] = useState([]);
  const [previewAgents, setPreviewAgents] = useState([]);
  const [runtimes, setRuntimes] = useState({ runtimes: [], installations: [], accounts: [], capabilityProfiles: [] });
  const [projects, setProjects] = useState([]);
  const [projectDetails, setProjectDetails] = useState({});
  const [selectedAgent, setSelectedAgent] = useState('');
  const [form, setForm] = useState({ agentCode: '', agentName: '', description: '' });
  const [definitionEditForm, setDefinitionEditForm] = useState({ agentName: '', description: '', lifecycleState: 'DRAFT', expectedRecordVersion: 1 });
  const [runtimeForm, setRuntimeForm] = useState({ runtimeCode: '', runtimeName: '', description: '' });
  const [installationForm, setInstallationForm] = useState({ runtimeId: '', installationCode: '', adapterVersion: '', runtimeProfile: 'UNKNOWN', enabled: false, certificationState: 'UNVERIFIED', freshnessStatus: 'UNKNOWN', capabilityManifest: json({ scope: EMPTY_SCOPE, executionSurfaces: { surfaces: [] }, constraints: {} }) });
  const [accountForm, setAccountForm] = useState({ installationId: '', accountCode: '', accountAlias: '', usageVisibility: 'PROJECT_MEMBERS', accountState: 'UNCONFIGURED', accountPolicy: json({ scope: EMPTY_SCOPE, executionSurfaces: { surfaces: [] }, constraints: {} }) });
  const [profileForm, setProfileForm] = useState({ profileCode: '', profileName: '', policy: json({ scope: EMPTY_SCOPE, executionSurfaces: { surfaces: [] }, constraints: {} }) });
  const [versionForm, setVersionForm] = useState({ installationId: '', accountBindingId: '', capabilityProfileId: '', configuration: json({ scope: EMPTY_SCOPE, executionSurfaces: { surfaces: [] }, constraints: {} }), instructionReference: '', instructionDigest: '' });
  const [previewForm, setPreviewForm] = useState({ projectId: '', definitionId: '', definitionVersionId: '', projectWorkspaceId: '', requestedScope: json(EMPTY_SCOPE), constraints: json({}), surfaceModes: DEFAULT_SURFACE_MODES });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selected = useMemo(() => agents.find((agent) => agent.definitionId === selectedAgent) || null, [agents, selectedAgent]);
  const previewSelected = useMemo(() => previewAgents.find((agent) => agent.definitionId === previewForm.definitionId) || agents.find((agent) => agent.definitionId === previewForm.definitionId), [agents, previewAgents, previewForm.definitionId]);
  const selectedProject = projectDetails[previewForm.projectId];

  useEffect(() => {
    if (selected) {
      setDefinitionEditForm({
        agentName: selected.agentName || '',
        description: selected.description || '',
        lifecycleState: selected.lifecycleState || 'DRAFT',
        expectedRecordVersion: selected.recordVersion || 1,
      });
    }
  }, [selected?.definitionId, selected?.recordVersion]);

  async function loadProject(projectId) {
    if (!projectId) return;
    const detail = await agentService.getProject(projectId);
    setProjectDetails((current) => ({ ...current, [projectId]: detail }));
    try {
      const result = await agentService.listAgents({ projectId });
      setPreviewAgents(result.items || []);
      if (!previewForm.definitionId && result.items?.[0]) {
        setPreviewForm((current) => ({ ...current, definitionId: result.items[0].definitionId, definitionVersionId: result.items[0].versions?.[0]?.definitionVersionId || '' }));
      }
    } catch { setPreviewAgents([]); }
  }

  async function reload() {
    setLoading(true); setError('');
    try {
      const [runtimeResult, projectResult] = await Promise.all([
        canRuntimeManage || canPreview ? agentService.listRuntimes() : Promise.resolve({ runtimes: [], installations: [], accounts: [], capabilityProfiles: [] }),
        canPreview ? agentService.listProjects({ limit: 200 }) : Promise.resolve({ items: [] }),
      ]);
      setRuntimes(runtimeResult);
      setProjects(projectResult.items || []);
      const projectId = previewForm.projectId || projectResult.items?.[0]?.projectId || '';
      if (projectId) { setPreviewForm((current) => ({ ...current, projectId })); await loadProject(projectId); }
      if (canManage) {
        try {
          const result = await agentService.listAgents(adminAll ? undefined : (projectId ? { projectId } : undefined));
          setAgents(result.items || []);
          if (!selectedAgent && result.items?.[0]) setSelectedAgent(result.items[0].definitionId);
        } catch { setAgents([]); }
      }
    } catch (loadError) { setError(loadError.message || 'Failed to load Agent registry metadata.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []);

  async function save(action, message) {
    setSaving(true); setError(''); setSuccess('');
    try { await action(); setSuccess(message); await reload(); }
    catch (saveError) { setError(saveError.message || 'The Agent registry change could not be saved.'); }
    finally { setSaving(false); }
  }

  async function createAgent(event) {
    event.preventDefault();
    if (!canManage) return;
    await save(() => agentService.createAgent(form), 'Registered Agent definition.');
    setForm({ agentCode: '', agentName: '', description: '' });
  }

  async function updateAgent(event) {
    event.preventDefault();
    if (!canManage || !selectedAgent) return;
    await save(() => agentService.updateAgent(selectedAgent, definitionEditForm), 'Updated Agent lifecycle metadata.');
  }

  async function createRuntime(event) {
    event.preventDefault();
    if (!canRuntimeManage) return;
    await save(() => agentService.createRuntime(runtimeForm), 'Registered runtime metadata.');
    setRuntimeForm({ runtimeCode: '', runtimeName: '', description: '' });
  }

  async function createInstallation(event) {
    event.preventDefault();
    if (!canRuntimeManage || !installationForm.runtimeId) return;
    let capabilityManifest;
    try { capabilityManifest = JSON.parse(installationForm.capabilityManifest || '{}'); } catch { setError('Capability manifest must be valid JSON.'); return; }
    await save(() => agentService.createInstallation(installationForm.runtimeId, { ...installationForm, capabilityManifest, executionEnabled: false }), 'Registered runtime installation metadata.');
    setInstallationForm((current) => ({ ...current, installationCode: '', capabilityManifest: json({ scope: EMPTY_SCOPE, executionSurfaces: { surfaces: [] }, constraints: {} }) }));
  }

  async function createAccount(event) {
    event.preventDefault();
    if (!canRuntimeManage || !accountForm.installationId) return;
    let accountPolicy;
    try { accountPolicy = JSON.parse(accountForm.accountPolicy || '{}'); } catch { setError('Account policy must be valid JSON.'); return; }
    await save(() => agentService.createAccount(accountForm.installationId, { ...accountForm, accountPolicy, executionEnabled: false }), 'Registered runtime-account metadata.');
    setAccountForm((current) => ({ ...current, accountCode: '', accountAlias: '' }));
  }

  async function createProfile(event) {
    event.preventDefault();
    if (!canRuntimeManage) return;
    let policy;
    try { policy = JSON.parse(profileForm.policy || '{}'); } catch { setError('Capability policy must be valid JSON.'); return; }
    await save(() => agentService.createCapabilityProfile({ ...profileForm, policy }), 'Registered capability profile metadata.');
    setProfileForm({ profileCode: '', profileName: '', policy: json({ scope: EMPTY_SCOPE, executionSurfaces: { surfaces: [] }, constraints: {} }) });
  }

  async function createVersion(event) {
    event.preventDefault();
    if (!canManage || !selectedAgent) return;
    let configuration;
    try { configuration = JSON.parse(versionForm.configuration || '{}'); } catch { setError('Agent version configuration must be valid JSON.'); return; }
    await save(() => agentService.createAgentVersion(selectedAgent, { ...versionForm, configuration, accountBindingId: versionForm.accountBindingId || undefined }), 'Created the next immutable Agent revision.');
    setVersionForm((current) => ({ ...current, configuration: json({ scope: EMPTY_SCOPE, executionSurfaces: { surfaces: [] }, constraints: {} }) }));
  }

  async function calculatePreview(event) {
    event.preventDefault();
    if (!canPreview) return;
    let requestedScope; let constraints;
    try { requestedScope = JSON.parse(previewForm.requestedScope || '{}'); constraints = JSON.parse(previewForm.constraints || '{}'); } catch { setError('Requested scope and constraints must be valid JSON.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const result = await agentService.previewAuthority({
        projectId: previewForm.projectId,
        definitionId: previewForm.definitionId,
        definitionVersionId: previewForm.definitionVersionId || undefined,
        projectWorkspaceId: previewForm.projectWorkspaceId,
        requestedScope,
        constraints,
        requestedExecutionSurfaces: { surfaces: SURFACES.map((surface) => ({ surface, mode: previewForm.surfaceModes[surface], reason: 'Acceptance preview request.' })) },
      });
      setPreview(result.preview); setSuccess('Complete advisory authority preview calculated and audited.');
    } catch (previewError) { setError(previewError.message || 'Failed to calculate authority preview.'); }
    finally { setSaving(false); }
  }

  function renderPolicyScope(label, value) {
    return <div className="col-md-4"><h4 className="h6">{label} scope</h4><pre className="small bg-light p-2 rounded">{json(value)}</pre></div>;
  }

  function renderSurfaceIntersection(result) {
    const policy = result?.policyEffectiveAuthority;
    const runtime = result?.runtimeCompatibleAuthority;
    const findMode = (authority, layer, surface) => authority?.executionSurfaces?.[layer]?.surfaces?.find((entry) => entry.surface === surface);
    return <div className="col-12"><strong>Execution-surface intersection</strong><div className="table-responsive"><table className="table table-sm sky-table"><thead><tr><th>Surface</th><th>Requested</th><th>Configured</th><th>Policy-effective</th><th>Runtime-compatible</th></tr></thead><tbody>{SURFACES.map((surface) => { const requested = findMode(policy, 'requested', surface); const configured = findMode(policy, 'configured', surface); const policyGranted = findMode(policy, 'granted', surface); const runtimeGranted = findMode(runtime, 'granted', surface); return <tr key={surface}><td>{surface}</td><td>{requested?.mode || 'DENY'}</td><td>{configured?.mode || 'DENY'}</td><td><strong>{policyGranted?.mode || 'DENY'}</strong>{policyGranted?.reason ? <div className="text-muted">{policyGranted.reason}</div> : null}</td><td><strong>{runtimeGranted?.mode || 'DENY'}</strong>{runtimeGranted?.reason ? <div className="text-muted">{runtimeGranted.reason}</div> : null}</td></tr>; })}</tbody></table></div></div>;
  }

  return (
    <>
      <PageHeader kicker="Agents · Registry" title="Manage Agents" subtitle="Register provider-neutral runtimes, accounts, profiles, immutable Agent revisions, and complete advisory authority previews." />
      <DismissibleAlert tone="danger">{error}</DismissibleAlert>
      <DismissibleAlert tone="success">{success}</DismissibleAlert>
      <DismissibleAlert tone="info">Agent execution is disabled/not implemented in Phase 19.1. No run, session, launch, scheduler, or provider transport controls are available.</DismissibleAlert>

      {canManage && <Panel title="Register Agent definition" subtitle="Definitions are metadata; revisions are immutable and require registered runtime/account/profile references."><form className="row g-3" onSubmit={createAgent}><div className="col-md-4"><label className="form-label" htmlFor="agent-code">Agent code</label><input id="agent-code" className="form-control" value={form.agentCode} onChange={(event) => setForm({ ...form, agentCode: event.target.value })} required /></div><div className="col-md-4"><label className="form-label" htmlFor="agent-name">Agent name</label><input id="agent-name" className="form-control" value={form.agentName} onChange={(event) => setForm({ ...form, agentName: event.target.value })} required /></div><div className="col-md-4"><label className="form-label" htmlFor="agent-description">Description</label><input id="agent-description" className="form-control" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div><div className="col-12"><button className="btn sky-btn-primary" disabled={saving} type="submit">Register Agent</button></div></form></Panel>}

      {canRuntimeManage && <Panel className="mt-3" title="Runtime, account, and capability registration" subtitle="These records are entitlement and policy metadata only. Execution flags remain false.">
        <div className="row g-3">
          <form className="col-lg-4" onSubmit={createRuntime}><h3 className="h6">Runtime</h3><input aria-label="Runtime code" className="form-control mb-2" placeholder="Runtime code" value={runtimeForm.runtimeCode} onChange={(event) => setRuntimeForm({ ...runtimeForm, runtimeCode: event.target.value })} required /><input aria-label="Runtime name" className="form-control mb-2" placeholder="Runtime name" value={runtimeForm.runtimeName} onChange={(event) => setRuntimeForm({ ...runtimeForm, runtimeName: event.target.value })} required /><button className="btn sky-btn-ghost" type="submit">Register runtime</button></form>
          <form className="col-lg-4" onSubmit={createInstallation}><h3 className="h6">Installation</h3><p className="small text-muted">New metadata starts <code>UNVERIFIED</code>, <code>UNKNOWN</code>, and disabled. Only an authoritative runtime/certification path can establish readiness.</p><select aria-label="Runtime" className="form-select mb-2" value={installationForm.runtimeId} onChange={(event) => setInstallationForm({ ...installationForm, runtimeId: event.target.value })} required><option value="">Runtime…</option>{runtimes.runtimes?.map((runtime) => <option key={runtime.agentRuntimeId} value={runtime.agentRuntimeId}>{runtime.runtimeName}</option>)}</select><input aria-label="Installation code" className="form-control mb-2" placeholder="Installation code" value={installationForm.installationCode} onChange={(event) => setInstallationForm({ ...installationForm, installationCode: event.target.value })} required /><textarea aria-label="Capability manifest" className="form-control mb-2 font-monospace" rows="3" value={installationForm.capabilityManifest} onChange={(event) => setInstallationForm({ ...installationForm, capabilityManifest: event.target.value })} /><button className="btn sky-btn-ghost" type="submit">Register installation</button></form>
          <form className="col-lg-4" onSubmit={createProfile}><h3 className="h6">Capability profile</h3><input aria-label="Profile code" className="form-control mb-2" placeholder="Profile code" value={profileForm.profileCode} onChange={(event) => setProfileForm({ ...profileForm, profileCode: event.target.value })} required /><input aria-label="Profile name" className="form-control mb-2" placeholder="Profile name" value={profileForm.profileName} onChange={(event) => setProfileForm({ ...profileForm, profileName: event.target.value })} required /><textarea aria-label="Capability policy" className="form-control mb-2 font-monospace" rows="3" value={profileForm.policy} onChange={(event) => setProfileForm({ ...profileForm, policy: event.target.value })} /><button className="btn sky-btn-ghost" type="submit">Register profile</button></form>
          <form className="col-lg-6" onSubmit={createAccount}><h3 className="h6">Runtime account entitlement</h3><p className="small text-muted">New account metadata starts <code>UNCONFIGURED</code>; entitlement is not implied by registration.</p><select aria-label="Installation for account" className="form-select mb-2" value={accountForm.installationId} onChange={(event) => setAccountForm({ ...accountForm, installationId: event.target.value })} required><option value="">Installation…</option>{runtimes.installations?.map((installation) => <option key={installation.installationId} value={installation.installationId}>{installation.installationCode}</option>)}</select><div className="row g-2"><div className="col"><input aria-label="Account code" className="form-control" placeholder="Account code" value={accountForm.accountCode} onChange={(event) => setAccountForm({ ...accountForm, accountCode: event.target.value })} required /></div><div className="col"><select aria-label="Account visibility" className="form-select" value={accountForm.usageVisibility} onChange={(event) => setAccountForm({ ...accountForm, usageVisibility: event.target.value })}><option>PROJECT_MEMBERS</option><option>OWNER_ONLY</option><option>ADMIN_ONLY</option></select></div></div><textarea aria-label="Account policy" className="form-control my-2 font-monospace" rows="3" value={accountForm.accountPolicy} onChange={(event) => setAccountForm({ ...accountForm, accountPolicy: event.target.value })} /><button className="btn sky-btn-ghost" type="submit">Register account</button></form>
        </div>
      </Panel>}

      {canManage && <Panel className="mt-3" title="Agent definitions and immutable revisions"><div className="row g-3"><div className="col-lg-5"><div className="list-group">{loading ? <div className="sky-empty-state py-4">Loading…</div> : agents.length === 0 ? <div className="sky-empty-state py-4">No scoped Agent definitions.</div> : agents.map((agent) => <button className={`list-group-item list-group-item-action ${selectedAgent === agent.definitionId ? 'active' : ''}`} key={agent.definitionId} onClick={() => { setSelectedAgent(agent.definitionId); setVersionForm((current) => ({ ...current, installationId: '', accountBindingId: '', capabilityProfileId: '' })); }} type="button"><span className="fw-semibold">{agent.agentName}</span><span className="d-block small opacity-75">{agent.agentCode} · {agent.versions?.length || 0} immutable revisions</span></button>)}</div></div><div className="col-lg-7">{selected ? <><form className="row g-2 mb-3" onSubmit={updateAgent}><div className="col-md-5"><label className="form-label" htmlFor="agent-edit-name">Agent name</label><input id="agent-edit-name" className="form-control" value={definitionEditForm.agentName} onChange={(event) => setDefinitionEditForm({ ...definitionEditForm, agentName: event.target.value })} required /></div><div className="col-md-3"><label className="form-label" htmlFor="agent-edit-lifecycle">Lifecycle</label><select id="agent-edit-lifecycle" aria-label="Agent lifecycle" className="form-select" value={definitionEditForm.lifecycleState} onChange={(event) => setDefinitionEditForm({ ...definitionEditForm, lifecycleState: event.target.value })}><option>DRAFT</option><option>ACTIVE</option><option>INACTIVE</option><option>ARCHIVED</option></select></div><div className="col-md-4"><label className="form-label" htmlFor="agent-edit-description">Description</label><input id="agent-edit-description" className="form-control" value={definitionEditForm.description} onChange={(event) => setDefinitionEditForm({ ...definitionEditForm, description: event.target.value })} /></div><div className="col-12"><button className="btn sky-btn-ghost" disabled={saving} type="submit">Save Agent metadata</button></div></form><p className="small sky-muted">Revision rows cannot be edited or deleted. Credentials, raw paths, and process launch controls are intentionally unavailable.</p><table className="table table-sm sky-table"><thead><tr><th>Revision</th><th>Digest</th><th>Installation</th><th>Profile</th></tr></thead><tbody>{selected.versions?.map((version) => <tr key={version.definitionVersionId}><td>{version.revision}</td><td><code>{version.contentDigest?.slice(0, 16)}</code></td><td><code>{version.installationId?.slice(0, 8)}</code></td><td><code>{version.capabilityProfileId?.slice(0, 8)}</code></td></tr>)}</tbody></table><form className="row g-2" onSubmit={createVersion}><div className="col-md-4"><select aria-label="Version installation" className="form-select" value={versionForm.installationId} onChange={(event) => setVersionForm({ ...versionForm, installationId: event.target.value })} required><option value="">Installation…</option>{runtimes.installations?.map((item) => <option key={item.installationId} value={item.installationId}>{item.installationCode}</option>)}</select></div><div className="col-md-4"><select aria-label="Version account" className="form-select" value={versionForm.accountBindingId} onChange={(event) => setVersionForm({ ...versionForm, accountBindingId: event.target.value })}><option value="">No account binding</option>{runtimes.accounts?.map((item) => <option key={item.accountBindingId} value={item.accountBindingId}>{item.accountCode}</option>)}</select></div><div className="col-md-4"><select aria-label="Version profile" className="form-select" value={versionForm.capabilityProfileId} onChange={(event) => setVersionForm({ ...versionForm, capabilityProfileId: event.target.value })} required><option value="">Capability profile…</option>{runtimes.capabilityProfiles?.map((item) => <option key={item.capabilityProfileId} value={item.capabilityProfileId}>{item.profileName}</option>)}</select></div><div className="col-12"><textarea aria-label="Version configuration" className="form-control font-monospace" rows="4" value={versionForm.configuration} onChange={(event) => setVersionForm({ ...versionForm, configuration: event.target.value })} /><button className="btn sky-btn-ghost mt-2" disabled={saving} type="submit">Create next immutable revision</button></div></form></> : <div className="sky-empty-state py-4">Select a scoped Agent definition.</div>}</div></div></Panel>}

      {canPreview && <Panel className="mt-3" title="Advisory authority preview · complete policy display" subtitle="Policy-effective authority is shown independently from the Phase 19.1 execution-disabled admission gate; no preview can start execution.">
        <form className="row g-3" onSubmit={calculatePreview}><div className="col-md-3"><label className="form-label" htmlFor="preview-project">Project</label><select id="preview-project" className="form-select" value={previewForm.projectId} onChange={async (event) => { const projectId = event.target.value; setPreviewForm((current) => ({ ...current, projectId, projectWorkspaceId: '', definitionId: '', definitionVersionId: '' })); await loadProject(projectId); }} required><option value="">Select project…</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select></div><div className="col-md-3"><label className="form-label" htmlFor="preview-workspace">Workspace</label><select id="preview-workspace" className="form-select" value={previewForm.projectWorkspaceId} onChange={(event) => setPreviewForm({ ...previewForm, projectWorkspaceId: event.target.value })} required><option value="">Select workspace…</option>{(selectedProject?.workspaces || []).map((workspace) => <option key={workspace.projectWorkspaceId} value={workspace.projectWorkspaceId}>{workspace.repoCode} · {workspace.profileCode}</option>)}</select></div><div className="col-md-3"><label className="form-label" htmlFor="preview-agent">Project-scoped Agent</label><select id="preview-agent" className="form-select" value={previewForm.definitionId} onChange={(event) => setPreviewForm({ ...previewForm, definitionId: event.target.value, definitionVersionId: '' })} required><option value="">Select Agent…</option>{previewAgents.map((agent) => <option key={agent.definitionId} value={agent.definitionId}>{agent.agentName}</option>)}</select></div><div className="col-md-3"><label className="form-label" htmlFor="preview-version">Immutable revision</label><select id="preview-version" className="form-select" value={previewForm.definitionVersionId} onChange={(event) => setPreviewForm({ ...previewForm, definitionVersionId: event.target.value })}><option value="">Latest allowed revision</option>{previewSelected?.versions?.map((version) => <option key={version.definitionVersionId} value={version.definitionVersionId}>Revision {version.revision}</option>)}</select></div><div className="col-md-6"><label className="form-label" htmlFor="preview-scope">Requested scope JSON</label><textarea id="preview-scope" className="form-control font-monospace" rows="5" value={previewForm.requestedScope} onChange={(event) => setPreviewForm({ ...previewForm, requestedScope: event.target.value })} /></div><div className="col-md-6"><label className="form-label" htmlFor="preview-constraints">Requested numeric constraints JSON</label><textarea id="preview-constraints" className="form-control font-monospace" rows="5" value={previewForm.constraints} onChange={(event) => setPreviewForm({ ...previewForm, constraints: event.target.value })} /></div><div className="col-12"><h3 className="h6">Requested execution-surface modes</h3><div className="row g-2">{SURFACES.map((surface) => <div className="col-md-6 col-lg-4" key={surface}><label className="small" htmlFor={`surface-${surface}`}>{surface}</label><select id={`surface-${surface}`} className="form-select form-select-sm" value={previewForm.surfaceModes[surface]} onChange={(event) => setPreviewForm({ ...previewForm, surfaceModes: { ...previewForm.surfaceModes, [surface]: event.target.value } })}>{MODES.map((mode) => <option key={mode}>{mode}</option>)}</select></div>)}</div></div><div className="col-12"><button className="btn sky-btn-primary" disabled={saving} type="submit">{saving ? 'Calculating…' : 'Preview complete authority'}</button></div></form>
        {preview && <div className="mt-4"><div className="alert alert-warning"><strong>Advisory only:</strong> executionEnabled={String(preview.executionEnabled)} · {preview.reason}</div><div className="row g-3 small"><div className="col-md-3"><strong>Runtime compatibility</strong><pre className="bg-light p-2 rounded">{json(preview.runtimeCompatibility)}</pre></div><div className="col-md-3"><strong>Execution admission</strong><pre className="bg-light p-2 rounded">{json(preview.executionAdmission)}</pre></div><div className="col-md-3"><strong>Account entitlement</strong><pre className="bg-light p-2 rounded">{json(preview.accountEntitlement)}</pre></div><div className="col-md-3"><strong>Identity</strong><pre className="bg-light p-2 rounded">{json({ project: preview.project, agent: preview.agent, workspace: preview.workspace, runtime: preview.runtime, account: preview.account, capabilityProfile: preview.capabilityProfile })}</pre></div></div><div className="row g-3 small"><div className="col-12"><h4 className="h6">Policy-effective authority</h4></div>{renderPolicyScope('Requested', preview.policyEffectiveAuthority?.requested)}{renderPolicyScope('Configured', preview.policyEffectiveAuthority?.configured)}{renderPolicyScope('Granted', preview.policyEffectiveAuthority?.granted)}</div><div className="row g-3 small mt-1"><div className="col-12"><h4 className="h6">Runtime-compatible authority</h4></div>{renderPolicyScope('Requested', preview.runtimeCompatibleAuthority?.requested)}{renderPolicyScope('Configured', preview.runtimeCompatibleAuthority?.configured)}{renderPolicyScope('Granted', preview.runtimeCompatibleAuthority?.granted)}</div><div className="row g-3 small mt-1"><div className="col-md-4"><strong>Policy-effective constraints</strong><pre className="bg-light p-2 rounded">{json(preview.policyEffectiveAuthority?.constraints)}</pre><strong>Runtime-compatible constraints</strong><pre className="bg-light p-2 rounded">{json(preview.runtimeCompatibleAuthority?.constraints)}</pre></div>{renderSurfaceIntersection(preview)}</div><div className="row g-3 small"><div className="col-md-4"><strong>Policy-effective obligations</strong><ul>{preview.policyEffectiveAuthority?.obligations?.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="col-md-4"><strong>Runtime-compatible obligations</strong><ul>{preview.runtimeCompatibleAuthority?.obligations?.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="col-md-4"><strong>Runtime-compatible denials and differences</strong><ul>{preview.runtimeCompatibleAuthority?.denials?.map((item, index) => <li key={`denial-${item.dimension}-${item.value}-${index}`}>{item.dimension}: {item.value} — {item.reason}</li>)}{preview.runtimeCompatibleAuthority?.differences?.map((item, index) => <li key={`difference-${item.dimension}-${item.requested}-${index}`}>{item.dimension}: {item.requested} → {item.effective}</li>)}</ul></div></div><p className="small">Policy-effective digest: <code>{preview.policyEffectiveAuthority?.digest}</code> · Runtime-compatible digest: <code>{preview.runtimeCompatibleAuthority?.digest}</code> · Audited preview · Phase {preview.phase}</p></div>}
      </Panel>}
    </>
  );
}

export default ManageAgents;
