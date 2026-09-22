import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import Panel from '../components/ui/Panel.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import agentService from '../services/agentService.js';

const RIGHTS = ['PROJECT_READ', 'PROJECT_MANAGE', 'AUTHORITY_PREVIEW'];
const EMPTY_PROJECT = { projectCode: '', projectName: '', description: '' };
const EMPTY_MEMBER = { userId: '', membershipState: 'ACTIVE', rights: ['PROJECT_READ'] };

function prettyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function AgentProjects() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AGENT_PROJECT_MANAGE');
  const canAgentManage = hasPermission('AGENT_MANAGE');
  const [projects, setProjects] = useState([]);
  const [options, setOptions] = useState({ repositories: [], workspaceBindings: [] });
  const [users, setUsers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState(EMPTY_PROJECT);
  const [editForm, setEditForm] = useState({ ...EMPTY_PROJECT, lifecycleState: 'DRAFT', dataClassification: 'INTERNAL', authorityPolicy: '{}' });
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER);
  const [allowForm, setAllowForm] = useState({ definitionId: '', definitionVersionId: '', allowState: 'ACTIVE' });
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState(null);
  const [workspaceForm, setWorkspaceForm] = useState({ repoPathId: '' });
  const [repositoryForm, setRepositoryForm] = useState({ repoId: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.definitionId === allowForm.definitionId),
    [agents, allowForm.definitionId],
  );

  async function loadSelected(projectId) {
    if (!projectId) { setDetail(null); return; }
    const nextDetail = await agentService.getProject(projectId);
    setDetail(nextDetail);
    setEditForm({
      projectName: nextDetail.project.projectName || '',
      description: nextDetail.project.description || '',
      lifecycleState: nextDetail.project.lifecycleState || 'DRAFT',
      dataClassification: nextDetail.project.dataClassification || 'INTERNAL',
      authorityPolicy: prettyJson(nextDetail.project.authorityPolicy),
    });
    if (canManage) {
      const memberOptions = await agentService.listProjectUsers(projectId);
      setUsers(memberOptions.items || []);
    }
    if (canAgentManage) {
      try {
        const agentResult = await agentService.listAgents();
        setAgents(agentResult.items || []);
      } catch { setAgents([]); }
    }
  }

  async function loadProjects(preferredId = selected) {
    setLoading(true);
    try {
      const result = await agentService.listProjects({ limit: 200 });
      setProjects(result.items || []);
      const nextId = (result.items || []).some((item) => item.projectId === preferredId)
        ? preferredId : result.items?.[0]?.projectId || '';
      setSelected(nextId);
      await loadSelected(nextId);
    } catch (loadError) { setError(loadError.message || 'Failed to load Agent Projects.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    Promise.all([agentService.getProjectOptions(), agentService.listProjects({ limit: 200 })])
      .then(async ([optionResult, projectResult]) => {
        if (!active) return;
        setOptions(optionResult);
        setProjects(projectResult.items || []);
        const nextId = projectResult.items?.[0]?.projectId || '';
        setSelected(nextId);
        if (nextId) await loadSelected(nextId);
      })
      .catch((loadError) => active && setError(loadError.message || 'Failed to load Agent Projects.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function save(action) {
    setSaving(true); setError(''); setSuccess('');
    try { await action(); }
    catch (saveError) { setError(saveError.message || 'The Agent Project change could not be saved.'); }
    finally { setSaving(false); }
  }

  async function createProject(event) {
    event.preventDefault();
    if (!canManage) return;
    await save(async () => {
      const result = await agentService.createProject(form);
      setForm(EMPTY_PROJECT);
      setSuccess(`Created Agent Project ${result.project?.projectCode || form.projectCode}.`);
      await loadProjects(result.project?.projectId);
    });
  }

  async function updateProject(event) {
    event.preventDefault();
    if (!canManage || !detail) return;
    let authorityPolicy;
    try { authorityPolicy = JSON.parse(editForm.authorityPolicy || '{}'); }
    catch { setError('Authority policy must be valid JSON.'); return; }
    await save(async () => {
      await agentService.updateProject(selected, {
        projectName: editForm.projectName,
        description: editForm.description,
        lifecycleState: editForm.lifecycleState,
        dataClassification: editForm.dataClassification,
        authorityPolicy,
        expectedRecordVersion: detail.project.recordVersion,
      });
      setSuccess('Updated Agent Project metadata and policy.');
      await loadSelected(selected);
    });
  }

  async function bindRepository(event) {
    event.preventDefault();
    if (!canManage || !selected || !repositoryForm.repoId) return;
    await save(async () => {
      await agentService.bindRepository(selected, repositoryForm);
      setRepositoryForm({ repoId: '' });
      setSuccess('Bound the registered repository to this Project.');
      await loadSelected(selected);
    });
  }

  async function bindWorkspace(event) {
    event.preventDefault();
    if (!canManage || !selected || !workspaceForm.repoPathId) return;
    await save(async () => {
      await agentService.bindWorkspace(selected, workspaceForm);
      setWorkspaceForm({ repoPathId: '' });
      setSuccess('Registered a read-only workspace binding.');
      await loadSelected(selected);
    });
  }

  async function saveMember(event) {
    event.preventDefault();
    if (!canManage || !selected || !memberForm.userId) return;
    await save(async () => {
      await agentService.upsertProjectMember(selected, memberForm);
      setMemberForm(EMPTY_MEMBER);
      setSuccess('Saved Project membership and rights.');
      await loadSelected(selected);
    });
  }

  async function saveAllowRule(event) {
    event.preventDefault();
    if (!canManage || !selected || !allowForm.definitionId) return;
    await save(async () => {
      await agentService.setProjectAgentAllowRule(selected, allowForm);
      setAllowForm({ definitionId: '', definitionVersionId: '', allowState: 'ACTIVE' });
      setSuccess('Saved the Project → Agent allow rule.');
      await loadSelected(selected);
    });
  }

  return (
    <>
      <PageHeader kicker="Agents · Project registry" title="Agent Projects" subtitle="Register Project ownership, policy, repository/workspace bindings, membership, and Agent allow rules for authority preview." />
      <DismissibleAlert tone="danger">{error}</DismissibleAlert>
      <DismissibleAlert tone="success">{success}</DismissibleAlert>
      <DismissibleAlert tone="info">Controlled source-backed fake runtime execution and one bounded managed Browser Automation capability are enabled in Phase 19.2B. Real providers, generic capability effects, scheduler execution, delegation, writable development workspaces, and external Agent execution remain disabled.</DismissibleAlert>

      {canManage && <Panel title="Create Agent Project" subtitle="Project paths must be selected from the registered repository catalogue.">
        <form className="row g-3" onSubmit={createProject}>
          <div className="col-md-4"><label className="form-label" htmlFor="agent-project-code">Project code</label><input id="agent-project-code" className="form-control" value={form.projectCode} onChange={(event) => setForm({ ...form, projectCode: event.target.value })} required /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="agent-project-name">Project name</label><input id="agent-project-name" className="form-control" value={form.projectName} onChange={(event) => setForm({ ...form, projectName: event.target.value })} required /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="agent-project-description">Description</label><input id="agent-project-description" className="form-control" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
          <div className="col-12"><button className="btn sky-btn-primary" disabled={saving} type="submit">{saving ? 'Creating…' : 'Create project'}</button></div>
        </form>
      </Panel>}

      <div className="row g-3 mt-1">
        <div className="col-lg-4"><Panel title="Visible Projects">
          {loading ? <div className="sky-empty-state py-4">Loading…</div> : projects.length === 0 ? <div className="sky-empty-state py-4">No visible Agent Projects.</div> : <div className="list-group list-group-flush">{projects.map((project) => <button className={`list-group-item list-group-item-action ${selected === project.projectId ? 'active' : ''}`} key={project.projectId} onClick={async () => { setSelected(project.projectId); await loadSelected(project.projectId); }} type="button"><span className="fw-semibold">{project.projectName}</span><span className="d-block small opacity-75">{project.projectCode} · {project.lifecycleState}</span></button>)}</div>}
        </Panel></div>
        <div className="col-lg-8"><Panel title={detail?.project?.projectName || 'Project detail'} subtitle={detail ? `${detail.project.projectCode} · ${detail.project.lifecycleState}` : 'Select a project.'}>
          {!detail ? <div className="sky-empty-state py-4">No project selected.</div> : <>
            <p className="small sky-muted">Repository roots, credentials, and executable paths are never displayed by this surface.</p>
            {canManage && <form className="row g-2 mb-4" onSubmit={updateProject}>
              <div className="col-md-4"><label className="form-label" htmlFor="agent-project-edit-name">Name</label><input id="agent-project-edit-name" className="form-control" value={editForm.projectName} onChange={(event) => setEditForm({ ...editForm, projectName: event.target.value })} required /></div>
              <div className="col-md-4"><label className="form-label" htmlFor="agent-project-edit-state">Lifecycle</label><select id="agent-project-edit-state" className="form-select" value={editForm.lifecycleState} onChange={(event) => setEditForm({ ...editForm, lifecycleState: event.target.value })}><option>DRAFT</option><option>ACTIVE</option><option>INACTIVE</option><option>ARCHIVED</option></select></div>
              <div className="col-md-4"><label className="form-label" htmlFor="agent-project-edit-class">Classification</label><input id="agent-project-edit-class" className="form-control" value={editForm.dataClassification} onChange={(event) => setEditForm({ ...editForm, dataClassification: event.target.value })} /></div>
              <div className="col-12"><label className="form-label" htmlFor="agent-project-edit-description">Description</label><input id="agent-project-edit-description" className="form-control" value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} /></div>
              <div className="col-12"><label className="form-label" htmlFor="agent-project-edit-policy">Authority policy JSON</label><textarea id="agent-project-edit-policy" className="form-control font-monospace" rows="4" value={editForm.authorityPolicy} onChange={(event) => setEditForm({ ...editForm, authorityPolicy: event.target.value })} /></div>
              <div className="col-12"><button className="btn sky-btn-primary" disabled={saving} type="submit">Save Project</button></div>
            </form>}

            <div className="row g-3">
              <div className="col-md-6"><h3 className="h6">Repository bindings</h3><ul className="small">{detail.repositories?.map((repo) => <li key={repo.projectRepositoryId}>{repo.repoCode} · {repo.repoName}</li>)}</ul>{canManage && <form className="row g-2" onSubmit={bindRepository}><div className="col-8"><select aria-label="Registered repository" className="form-select" value={repositoryForm.repoId} onChange={(event) => setRepositoryForm({ repoId: event.target.value })} required><option value="">Select repository…</option>{options.repositories.map((repo) => <option key={repo.repoId} value={repo.repoId}>{repo.repoCode} · {repo.repoName}</option>)}</select></div><div className="col-4"><button className="btn sky-btn-ghost w-100" disabled={saving} type="submit">Bind repo</button></div></form>}</div>
              <div className="col-md-6"><h3 className="h6">Read-only workspace bindings</h3><ul className="small">{detail.workspaces?.map((workspace) => <li key={workspace.projectWorkspaceId}>{workspace.repoCode} · {workspace.profileCode} · {workspace.workspaceMode}</li>)}</ul>{canManage && <form className="row g-2" onSubmit={bindWorkspace}><div className="col-8"><select aria-label="Registered workspace" className="form-select" value={workspaceForm.repoPathId} onChange={(event) => setWorkspaceForm({ repoPathId: event.target.value })} required><option value="">Select workspace…</option>{options.workspaceBindings.map((binding) => <option key={binding.repoPathId} value={binding.repoPathId}>{binding.repoCode} · {binding.profileCode} · {binding.environmentCode}</option>)}</select></div><div className="col-4"><button className="btn sky-btn-ghost w-100" disabled={saving} type="submit">Bind workspace</button></div></form>}</div>
            </div>

            <hr />
            <h3 className="h6">Project membership</h3>
            <div className="table-responsive"><table className="table table-sm sky-table"><thead><tr><th>User</th><th>State</th><th>Rights</th><th /></tr></thead><tbody>{detail.members?.map((member) => <tr key={member.projectMemberId}><td>{member.displayName || member.email}<div className="small sky-muted">{member.email}</div></td><td>{member.membershipState}</td><td>{member.rights?.join(', ') || 'none'}</td><td>{canManage && <button className="btn btn-sm sky-btn-ghost" type="button" onClick={() => setMemberForm({ userId: member.userId, membershipState: member.membershipState, rights: member.rights || [] })}>Edit</button>}</td></tr>)}</tbody></table></div>
            {canManage && <form className="row g-2" onSubmit={saveMember}><div className="col-md-4"><select aria-label="Project member" className="form-select" value={memberForm.userId} onChange={(event) => setMemberForm({ ...memberForm, userId: event.target.value })} required><option value="">Select active user…</option>{users.map((user) => <option key={user.userId} value={user.userId}>{user.displayName || user.email} · {user.email}</option>)}</select></div><div className="col-md-2"><select aria-label="Membership state" className="form-select" value={memberForm.membershipState} onChange={(event) => setMemberForm({ ...memberForm, membershipState: event.target.value })}><option>ACTIVE</option><option>INACTIVE</option><option>REVOKED</option></select></div><div className="col-md-4 d-flex gap-2 align-items-center">{RIGHTS.map((right) => <label className="small" key={right}><input checked={memberForm.rights.includes(right)} onChange={(event) => setMemberForm({ ...memberForm, rights: event.target.checked ? [...memberForm.rights, right] : memberForm.rights.filter((item) => item !== right) })} type="checkbox" /> {right}</label>)}</div><div className="col-md-2"><button className="btn sky-btn-ghost w-100" disabled={saving} type="submit">Save member</button></div></form>}

            <hr />
            <h3 className="h6">Project → Agent allow rules</h3>
            {detail.allowRules?.length ? <ul className="small">{detail.allowRules.map((rule) => <li key={rule.projectAgentAllowRuleId}>{rule.agentName} · {rule.definitionVersionId ? `version ${rule.definitionVersionId}` : 'all revisions'} · {rule.allowState}</li>)}</ul> : <p className="small sky-muted">No Agent allow rules.</p>}
            {canManage && canAgentManage && <form className="row g-2" onSubmit={saveAllowRule}><div className="col-md-5"><select aria-label="Agent definition" className="form-select" value={allowForm.definitionId} onChange={(event) => setAllowForm({ ...allowForm, definitionId: event.target.value, definitionVersionId: '' })} required><option value="">Select Agent…</option>{agents.map((agent) => <option key={agent.definitionId} value={agent.definitionId}>{agent.agentName} · {agent.agentCode}</option>)}</select></div><div className="col-md-4"><select aria-label="Agent version" className="form-select" value={allowForm.definitionVersionId} onChange={(event) => setAllowForm({ ...allowForm, definitionVersionId: event.target.value })}><option value="">All immutable revisions</option>{selectedAgent?.versions?.map((version) => <option key={version.definitionVersionId} value={version.definitionVersionId}>Revision {version.revision}</option>)}</select></div><div className="col-md-2"><select aria-label="Allow state" className="form-select" value={allowForm.allowState} onChange={(event) => setAllowForm({ ...allowForm, allowState: event.target.value })}><option>ACTIVE</option><option>INACTIVE</option><option>REVOKED</option></select></div><div className="col-md-1"><button className="btn sky-btn-ghost" disabled={saving} type="submit">Save</button></div></form>}
          </>}
        </Panel></div>
      </div>
      <p className="small mt-3"><Link to="/agents/manage">Manage runtimes, immutable Agent revisions, and authority preview →</Link></p>
    </>
  );
}

export default AgentProjects;
