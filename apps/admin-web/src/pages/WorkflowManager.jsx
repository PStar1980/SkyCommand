import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import workflowService from '../services/workflowService';

const EMPTY_NODE = {
  nodeKey: '',
  displayName: '',
  description: '',
  nodeTypeCode: 'TOOL',
  targetCode: '',
  inputJson: '{}',
};

function slugify(value, separator = '-') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`${separator}+$|^${separator}+`, 'g'), '')
    .slice(0, 80);
}

function nodeKeyFrom(value) {
  return slugify(value, '_') || 'node';
}

function parseJson(value, fieldName) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed);

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${fieldName} must be a JSON object.`);
  }

  return parsed;
}

function formatApiError(error, fallback = 'Request failed.') {
  const missingPermissions = error?.details?.missingPermissions;
  const permissionCode = error?.details?.permissionCode;
  const missingTools = error?.details?.missingTools;

  if (Array.isArray(missingPermissions) && missingPermissions.length > 0) {
    return `${error.message || fallback} Missing permission(s): ${missingPermissions.join(', ')}.`;
  }

  if (Array.isArray(missingTools) && missingTools.length > 0) {
    return `${error.message || fallback} Missing tool(s): ${missingTools.join(', ')}.`;
  }

  if (permissionCode) {
    return `${error.message || fallback} Required permission: ${permissionCode}.`;
  }

  return error?.message || fallback;
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function buildInputTemplate(tool) {
  const parameters = tool?.parameters || [];
  const input = {};

  for (const parameter of parameters) {
    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null && parameter.defaultValue !== '') {
      input[parameter.parameterName] = parameter.defaultValue;
    }
  }

  return JSON.stringify(input, null, 2);
}

function graphNodesToEditorNodes(nodes = []) {
  return nodes.map((node, index) => ({
    nodeKey: node.nodeKey || `node_${index + 1}`,
    displayName: node.displayName || '',
    description: node.description || '',
    nodeTypeCode: 'TOOL',
    targetCode: node.targetCode || '',
    inputJson: JSON.stringify(node.inputParameters || {}, null, 2),
  }));
}

function StatusPill({ status }) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  const className = normalized === 'ACTIVE' || normalized === 'PUBLISHED' || normalized === 'COMPLETED'
    ? 'sky-pill-success'
    : normalized === 'ARCHIVED' || normalized === 'RETIRED'
      ? 'sky-pill-danger'
      : 'sky-pill-info';

  return <span className={`sky-pill ${className}`}>{normalized}</span>;
}

function WorkflowListCard({ definition, selected, onSelect }) {
  return (
    <button
      className={`sky-worker-command-card text-start w-100 ${selected ? 'sky-selected-card' : ''}`}
      onClick={onSelect}
      type="button"
    >
      <div className="d-flex flex-wrap justify-content-between gap-2">
        <div>
          <div className="fw-bold">{definition.displayName}</div>
          <div className="small sky-muted sky-mono">{definition.workflowCode}</div>
        </div>
        <StatusPill status={definition.status} />
      </div>
      <p className="small sky-muted mt-2 mb-2">{definition.description || 'No description.'}</p>
      <div className="d-flex flex-wrap gap-2">
        <span className="sky-pill sky-pill-info">v{definition.latestVersionNumber || '—'} latest</span>
        <span className="sky-pill sky-pill-info">v{definition.publishedVersionNumber || '—'} published</span>
        <span className="sky-pill sky-pill-info">{definition.latestNodeCount || 0} node(s)</span>
        {!definition.enabled && <span className="sky-pill sky-pill-danger">disabled</span>}
      </div>
    </button>
  );
}

function ToolTargetOption({ tool }) {
  return (
    <option value={tool.targetCode}>
      {tool.displayName} ({tool.targetCode})
    </option>
  );
}

function EditableNodeCard({ index, node, toolTargets, onChange, onMoveDown, onMoveUp, onRemove }) {
  const selectedTool = toolTargets.find((tool) => tool.targetCode === node.targetCode);

  function patch(changes) {
    onChange(index, { ...node, ...changes });
  }

  function handleTargetChange(targetCode) {
    const tool = toolTargets.find((item) => item.targetCode === targetCode);
    const nextDisplayName = node.displayName || tool?.displayName || targetCode;
    const nextNodeKey = node.nodeKey || nodeKeyFrom(nextDisplayName || targetCode);

    patch({
      targetCode,
      displayName: nextDisplayName,
      nodeKey: nextNodeKey,
      description: node.description || tool?.description || '',
      inputJson: node.inputJson === '{}' ? buildInputTemplate(tool) : node.inputJson,
    });
  }

  return (
    <div className="sky-worker-command-card">
      <div className="d-flex flex-wrap justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Node {index + 1} · Tool</div>
          <div className="fw-bold">{node.displayName || selectedTool?.displayName || 'Workflow node'}</div>
          <div className="small sky-muted sky-mono">{node.nodeKey || 'node_key'} → {node.targetCode || 'target tool'}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-sm sky-btn-ghost" disabled={index === 0} onClick={onMoveUp} type="button">↑</button>
          <button className="btn btn-sm sky-btn-ghost" onClick={onMoveDown} type="button">↓</button>
          <button className="btn btn-sm btn-outline-danger" onClick={onRemove} type="button">Remove</button>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <label className="form-label" htmlFor={`manager-node-${index}-tool`}>Tool target</label>
          <select
            className="form-select sky-form-control"
            id={`manager-node-${index}-tool`}
            onChange={(event) => handleTargetChange(event.target.value)}
            value={node.targetCode}
          >
            <option value="">Select tool...</option>
            {toolTargets.map((tool) => <ToolTargetOption key={tool.targetCode} tool={tool} />)}
          </select>
          {selectedTool && (
            <div className="form-text">
              {selectedTool.categoryLabel} · risk {selectedTool.riskCode || 'n/a'} · permission {selectedTool.permissionCode || 'none'}
            </div>
          )}
        </div>
        <div className="col-lg-6">
          <label className="form-label" htmlFor={`manager-node-${index}-key`}>Node key</label>
          <input
            className="form-control sky-form-control sky-mono"
            id={`manager-node-${index}-key`}
            onChange={(event) => patch({ nodeKey: nodeKeyFrom(event.target.value) })}
            value={node.nodeKey}
          />
        </div>
        <div className="col-lg-6">
          <label className="form-label" htmlFor={`manager-node-${index}-name`}>Display name</label>
          <input
            className="form-control sky-form-control"
            id={`manager-node-${index}-name`}
            onChange={(event) => patch({ displayName: event.target.value })}
            value={node.displayName}
          />
        </div>
        <div className="col-lg-6">
          <label className="form-label" htmlFor={`manager-node-${index}-description`}>Description</label>
          <input
            className="form-control sky-form-control"
            id={`manager-node-${index}-description`}
            onChange={(event) => patch({ description: event.target.value })}
            value={node.description}
          />
        </div>
        <div className="col-12">
          <label className="form-label" htmlFor={`manager-node-${index}-input`}>Default input JSON</label>
          <textarea
            className="form-control sky-form-control sky-mono"
            id={`manager-node-${index}-input`}
            onChange={(event) => patch({ inputJson: event.target.value })}
            rows={4}
            value={node.inputJson}
          />
        </div>
      </div>
    </div>
  );
}

function WorkflowManager() {
  const [catalog, setCatalog] = useState({ toolTargets: [] });
  const [definitions, setDefinitions] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [detail, setDetail] = useState(null);
  const [metadataForm, setMetadataForm] = useState({
    displayName: '',
    description: '',
    status: 'ACTIVE',
    enabled: true,
    visibleInAdmin: true,
  });
  const [cloneForm, setCloneForm] = useState({ workflowCode: '', displayName: '', description: '', publish: true });
  const [versionForm, setVersionForm] = useState({ publish: true, versionLabel: '' });
  const [editorNodes, setEditorNodes] = useState([{ ...EMPTY_NODE }]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const toolTargets = useMemo(
    () => [...(catalog.toolTargets || [])].sort((a, b) => {
      const categoryCompare = String(a.categoryLabel || '').localeCompare(String(b.categoryLabel || ''));

      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      return String(a.displayName || '').localeCompare(String(b.displayName || ''));
    }),
    [catalog.toolTargets],
  );

  async function loadDefinitions(nextSelectedCode = selectedCode) {
    setLoading(true);
    setError('');

    try {
      const [definitionResult, catalogResult] = await Promise.all([
        workflowService.listDefinitions({
          visibleOnly: 'false',
          enabledOnly: 'false',
          publishedOnly: 'false',
        }),
        workflowService.getBuilderCatalog(),
      ]);
      const items = definitionResult.items || [];
      setDefinitions(items);
      setCatalog({
        nodeTypes: catalogResult.nodeTypes || [],
        toolTargets: catalogResult.toolTargets || [],
      });

      const selectedExists = items.some((item) => item.workflowCode === nextSelectedCode);
      const nextCode = selectedExists ? nextSelectedCode : items[0]?.workflowCode || '';
      setSelectedCode(nextCode);

      if (nextCode) {
        await loadDetail(nextCode, { silent: true });
      } else {
        setDetail(null);
      }
    } catch (loadError) {
      setError(formatApiError(loadError, 'Failed to load workflow definitions.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(workflowCode, options = {}) {
    if (!workflowCode) {
      return;
    }

    if (!options.silent) {
      setDetailLoading(true);
      setError('');
    }

    try {
      const result = await workflowService.getManagedDefinition(workflowCode);
      const definition = result.definition;
      setDetail(definition);
      setMetadataForm({
        displayName: definition.displayName || '',
        description: definition.description || '',
        status: definition.status || 'ACTIVE',
        enabled: definition.enabled !== false,
        visibleInAdmin: definition.visibleInAdmin !== false,
      });
      setCloneForm({
        workflowCode: `${definition.workflowCode}-copy`,
        displayName: `${definition.displayName} Copy`,
        description: definition.description || '',
        publish: true,
      });
      setVersionForm({
        publish: true,
        versionLabel: `Version ${(definition.latestVersionNumber || 0) + 1}`,
      });
      setEditorNodes(graphNodesToEditorNodes(definition.latestGraph?.nodes || definition.publishedGraph?.nodes || []));
    } catch (loadError) {
      setError(formatApiError(loadError, 'Failed to load workflow detail.'));
    } finally {
      if (!options.silent) {
        setDetailLoading(false);
      }
    }
  }

  useEffect(() => {
    loadDefinitions();
  }, []);

  async function selectDefinition(workflowCode) {
    setSelectedCode(workflowCode);
    await loadDetail(workflowCode);
  }

  function updateEditorNode(index, nextNode) {
    setEditorNodes((current) => current.map((node, nodeIndex) => (nodeIndex === index ? nextNode : node)));
  }

  function addEditorNode() {
    setEditorNodes((current) => [
      ...current,
      { ...EMPTY_NODE, nodeKey: `node_${current.length + 1}` },
    ]);
  }

  function removeEditorNode(index) {
    setEditorNodes((current) => current.filter((_, nodeIndex) => nodeIndex !== index));
  }

  function moveEditorNode(index, direction) {
    setEditorNodes((current) => {
      const next = [...current];
      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= next.length) {
        return current;
      }

      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function validateEditorNodes() {
    const seenKeys = new Set();

    return editorNodes.map((node, index) => {
      const nodeKey = nodeKeyFrom(node.nodeKey || node.displayName || node.targetCode || `node_${index + 1}`);
      const displayName = String(node.displayName || '').trim();
      const targetCode = String(node.targetCode || '').trim();

      if (!displayName) {
        throw new Error(`Node ${index + 1} requires a display name.`);
      }

      if (!targetCode) {
        throw new Error(`Node ${index + 1} requires a tool target.`);
      }

      if (seenKeys.has(nodeKey)) {
        throw new Error(`Node key ${nodeKey} is duplicated.`);
      }

      seenKeys.add(nodeKey);

      return {
        nodeKey,
        nodeTypeCode: 'TOOL',
        displayName,
        description: String(node.description || '').trim(),
        targetCode,
        inputParameters: parseJson(node.inputJson, `Node ${index + 1} input JSON`),
        displayOrder: (index + 1) * 10,
        config: {
          builderCard: 'tool',
          updatedBy: 'workflow_manager_ui_v1',
        },
      };
    });
  }

  async function handleMetadataSubmit(event) {
    event.preventDefault();

    if (!detail) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await workflowService.updateDefinition(detail.workflowCode, metadataForm);
      setMessage(result.message || 'Workflow updated.');
      await loadDefinitions(result.definition?.workflowCode || detail.workflowCode);
    } catch (saveError) {
      setError(formatApiError(saveError, 'Failed to update workflow.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!detail || !window.confirm(`Archive workflow ${detail.displayName}? Existing run history will remain.`)) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await workflowService.archiveDefinition(detail.workflowCode);
      setMessage(result.message || 'Workflow archived.');
      await loadDefinitions(detail.workflowCode);
    } catch (archiveError) {
      setError(formatApiError(archiveError, 'Failed to archive workflow.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleClone(event) {
    event.preventDefault();

    if (!detail) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        workflowCode: slugify(cloneForm.workflowCode),
        displayName: String(cloneForm.displayName || '').trim(),
        description: String(cloneForm.description || '').trim(),
        publish: cloneForm.publish,
      };
      const result = await workflowService.cloneDefinition(detail.workflowCode, payload);
      setMessage(result.message || 'Workflow cloned.');
      await loadDefinitions(result.definition?.workflowCode || payload.workflowCode);
    } catch (cloneError) {
      setError(formatApiError(cloneError, 'Failed to clone workflow.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateVersion(event) {
    event.preventDefault();

    if (!detail) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        publish: versionForm.publish,
        versionLabel: String(versionForm.versionLabel || '').trim(),
        nodes: validateEditorNodes(),
      };
      const result = await workflowService.createVersion(detail.workflowCode, payload);
      setMessage(result.message || 'Workflow version created.');
      await loadDefinitions(result.definition?.workflowCode || detail.workflowCode);
    } catch (versionError) {
      setError(formatApiError(versionError, 'Failed to create workflow version.'));
    } finally {
      setSaving(false);
    }
  }

  const selectedDefinition = definitions.find((definition) => definition.workflowCode === selectedCode);

  return (
    <div>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Workflows · Manage</div>
          <h1 className="sky-page-title">Manage Workflows</h1>
          <p className="sky-page-subtitle">
            Review SkyServer workflow definitions, update metadata, clone business workflows,
            archive old definitions, and publish new sequential tool-node versions.
          </p>
        </div>
        <button className="btn sky-btn-ghost" disabled={loading || saving} onClick={() => loadDefinitions()} type="button">
          {loading ? 'Refreshing...' : 'Refresh workflows'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {message && (
        <div className="alert alert-success d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>{message}</span>
          <span className="d-flex flex-wrap gap-2">
            <Link className="btn btn-sm sky-btn-ghost" to="/workflows/start">Start workflow</Link>
            <Link className="btn btn-sm sky-btn-ghost" to="/workflows/history">Workflow history</Link>
          </span>
        </div>
      )}

      <section className="sky-worker-hero mb-4">
        <div>
          <div className="sky-page-kicker">Workflow lifecycle</div>
          <h2 className="h4 mb-2">Definition control center</h2>
          <p className="sky-muted mb-3">
            The v1 management layer keeps workflow definitions maintainable before advanced node types and the visual graph editor arrive.
          </p>
          <div className="sky-worker-command-strip">
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Definitions</div>
              <div className="sky-worker-command-value">{definitions.length}</div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Active</div>
              <div className="sky-worker-command-value">{definitions.filter((definition) => definition.status === 'ACTIVE').length}</div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Tool targets</div>
              <div className="sky-worker-command-value">{toolTargets.length}</div>
            </div>
          </div>
        </div>
        <div className="sky-card">
          <div className="sky-card-header">
            <div className="sky-page-kicker">Selected workflow</div>
            <h3 className="h5 mb-0">{selectedDefinition?.displayName || 'No workflow selected'}</h3>
          </div>
          <div className="sky-card-body">
            <p className="sky-muted mb-3">{selectedDefinition?.description || 'Select a workflow to inspect its versions and lifecycle controls.'}</p>
            {selectedDefinition && (
              <div className="d-flex flex-wrap gap-2">
                <StatusPill status={selectedDefinition.status} />
                <span className="sky-pill sky-pill-info">v{selectedDefinition.latestVersionNumber || '—'} latest</span>
                <span className="sky-pill sky-pill-success">v{selectedDefinition.publishedVersionNumber || '—'} published</span>
                <span className="sky-pill sky-pill-info">{selectedDefinition.latestNodeCount || 0} node(s)</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="row g-4">
        <div className="col-xl-4">
          <section className="sky-card mb-4">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Catalog</div>
              <h2 className="h5 mb-0">Workflow definitions</h2>
            </div>
            <div className="sky-card-body d-flex flex-column gap-3">
              {definitions.map((definition) => (
                <WorkflowListCard
                  definition={definition}
                  key={definition.workflowCode}
                  onSelect={() => selectDefinition(definition.workflowCode)}
                  selected={definition.workflowCode === selectedCode}
                />
              ))}
              {definitions.length === 0 && <div className="sky-empty-state">No workflow definitions found.</div>}
            </div>
          </section>

          <section className="sky-card">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Lifecycle map</div>
              <h2 className="h5 mb-0">What v1 supports</h2>
            </div>
            <div className="sky-card-body d-flex flex-column gap-2">
              <span className="sky-pill sky-pill-success">Edit metadata</span>
              <span className="sky-pill sky-pill-success">Clone workflow</span>
              <span className="sky-pill sky-pill-success">Create/publish vNext</span>
              <span className="sky-pill sky-pill-success">Archive workflow</span>
              <span className="sky-pill sky-pill-info">Sequential TOOL nodes only</span>
            </div>
          </section>
        </div>

        <div className="col-xl-8">
          {!detail && (
            <section className="sky-card">
              <div className="sky-empty-state">Select a workflow definition to manage it.</div>
            </section>
          )}

          {detail && (
            <div className="d-flex flex-column gap-4">
              <section className="sky-card">
                <div className="sky-card-header d-flex flex-wrap justify-content-between gap-3">
                  <div>
                    <div className="sky-page-kicker">Definition</div>
                    <h2 className="h5 mb-0">Metadata and status</h2>
                  </div>
                  <StatusPill status={detail.status} />
                </div>
                <form className="sky-card-body" onSubmit={handleMetadataSubmit}>
                  <div className="row g-3">
                    <div className="col-lg-6">
                      <label className="form-label" htmlFor="managerDisplayName">Display name</label>
                      <input
                        className="form-control sky-form-control"
                        id="managerDisplayName"
                        onChange={(event) => setMetadataForm((current) => ({ ...current, displayName: event.target.value }))}
                        value={metadataForm.displayName}
                      />
                    </div>
                    <div className="col-lg-6">
                      <label className="form-label" htmlFor="managerWorkflowCode">Workflow code</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        disabled
                        id="managerWorkflowCode"
                        value={detail.workflowCode}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="managerDescription">Description</label>
                      <textarea
                        className="form-control sky-form-control"
                        id="managerDescription"
                        onChange={(event) => setMetadataForm((current) => ({ ...current, description: event.target.value }))}
                        rows={3}
                        value={metadataForm.description}
                      />
                    </div>
                    <div className="col-lg-4">
                      <label className="form-label" htmlFor="managerStatus">Status</label>
                      <select
                        className="form-select sky-form-control"
                        id="managerStatus"
                        onChange={(event) => setMetadataForm((current) => ({ ...current, status: event.target.value }))}
                        value={metadataForm.status}
                      >
                        <option value="DRAFT">DRAFT</option>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                      </select>
                    </div>
                    <div className="col-lg-4 d-flex align-items-end">
                      <div className="form-check form-switch">
                        <input
                          checked={metadataForm.enabled}
                          className="form-check-input"
                          id="managerEnabled"
                          onChange={(event) => setMetadataForm((current) => ({ ...current, enabled: event.target.checked }))}
                          type="checkbox"
                        />
                        <label className="form-check-label" htmlFor="managerEnabled">Enabled</label>
                      </div>
                    </div>
                    <div className="col-lg-4 d-flex align-items-end">
                      <div className="form-check form-switch">
                        <input
                          checked={metadataForm.visibleInAdmin}
                          className="form-check-input"
                          id="managerVisible"
                          onChange={(event) => setMetadataForm((current) => ({ ...current, visibleInAdmin: event.target.checked }))}
                          type="checkbox"
                        />
                        <label className="form-check-label" htmlFor="managerVisible">Visible in Admin</label>
                      </div>
                    </div>
                  </div>

                  <div className="d-flex flex-wrap justify-content-between gap-2 mt-4">
                    <button className="btn btn-outline-danger" disabled={saving || detail.status === 'ARCHIVED'} onClick={handleArchive} type="button">
                      Archive workflow
                    </button>
                    <button className="btn sky-btn-primary" disabled={saving || detailLoading} type="submit">
                      {saving ? 'Saving...' : 'Save metadata'}
                    </button>
                  </div>
                </form>
              </section>

              <section className="sky-card">
                <div className="sky-card-header">
                  <div className="sky-page-kicker">Versions</div>
                  <h2 className="h5 mb-0">Published and draft history</h2>
                </div>
                <div className="table-responsive">
                  <table className="table table-dark table-hover align-middle mb-0 sky-table">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Status</th>
                        <th>Nodes</th>
                        <th>Edges</th>
                        <th>Published</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.versions || []).map((version) => (
                        <tr key={version.workflowVersionId}>
                          <td>
                            <div className="fw-bold">v{version.versionNumber}</div>
                            <div className="small sky-muted">{version.versionLabel || 'No label'}</div>
                          </td>
                          <td><StatusPill status={version.status} /></td>
                          <td>{version.nodeCount}</td>
                          <td>{version.edgeCount}</td>
                          <td>{formatDateTime(version.publishedAt)}</td>
                          <td>{formatDateTime(version.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="sky-card">
                <div className="sky-card-header d-flex flex-wrap justify-content-between gap-3">
                  <div>
                    <div className="sky-page-kicker">Version editor</div>
                    <h2 className="h5 mb-0">Create vNext from latest graph</h2>
                  </div>
                  <button className="btn btn-sm sky-btn-ghost" onClick={addEditorNode} type="button">Add tool node</button>
                </div>
                <form className="sky-card-body" onSubmit={handleCreateVersion}>
                  <div className="row g-3 mb-3">
                    <div className="col-lg-6">
                      <label className="form-label" htmlFor="versionLabel">Version label</label>
                      <input
                        className="form-control sky-form-control"
                        id="versionLabel"
                        onChange={(event) => setVersionForm((current) => ({ ...current, versionLabel: event.target.value }))}
                        value={versionForm.versionLabel}
                      />
                    </div>
                    <div className="col-lg-6 d-flex align-items-end">
                      <div className="form-check form-switch">
                        <input
                          checked={versionForm.publish}
                          className="form-check-input"
                          id="publishVersion"
                          onChange={(event) => setVersionForm((current) => ({ ...current, publish: event.target.checked }))}
                          type="checkbox"
                        />
                        <label className="form-check-label" htmlFor="publishVersion">Publish this version immediately</label>
                      </div>
                    </div>
                  </div>

                  <div className="d-flex flex-column gap-3">
                    {editorNodes.map((node, index) => (
                      <EditableNodeCard
                        index={index}
                        key={`${index}-${node.nodeKey || node.targetCode}`}
                        node={node}
                        onChange={updateEditorNode}
                        onMoveDown={() => moveEditorNode(index, 1)}
                        onMoveUp={() => moveEditorNode(index, -1)}
                        onRemove={() => removeEditorNode(index)}
                        toolTargets={toolTargets}
                      />
                    ))}
                    {editorNodes.length === 0 && <div className="sky-empty-state">Add at least one tool node.</div>}
                  </div>

                  <div className="d-flex justify-content-end mt-4">
                    <button className="btn sky-btn-primary" disabled={saving || editorNodes.length === 0} type="submit">
                      {saving ? 'Creating version...' : 'Create version'}
                    </button>
                  </div>
                </form>
              </section>

              <section className="sky-card">
                <div className="sky-card-header">
                  <div className="sky-page-kicker">Clone</div>
                  <h2 className="h5 mb-0">Create a new workflow from this one</h2>
                </div>
                <form className="sky-card-body" onSubmit={handleClone}>
                  <div className="row g-3">
                    <div className="col-lg-6">
                      <label className="form-label" htmlFor="cloneDisplayName">Clone display name</label>
                      <input
                        className="form-control sky-form-control"
                        id="cloneDisplayName"
                        onChange={(event) => setCloneForm((current) => ({
                          ...current,
                          displayName: event.target.value,
                          workflowCode: current.workflowCode || slugify(event.target.value),
                        }))}
                        value={cloneForm.displayName}
                      />
                    </div>
                    <div className="col-lg-6">
                      <label className="form-label" htmlFor="cloneWorkflowCode">Clone workflow code</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        id="cloneWorkflowCode"
                        onChange={(event) => setCloneForm((current) => ({ ...current, workflowCode: slugify(event.target.value) }))}
                        value={cloneForm.workflowCode}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="cloneDescription">Clone description</label>
                      <textarea
                        className="form-control sky-form-control"
                        id="cloneDescription"
                        onChange={(event) => setCloneForm((current) => ({ ...current, description: event.target.value }))}
                        rows={3}
                        value={cloneForm.description}
                      />
                    </div>
                    <div className="col-12">
                      <div className="form-check form-switch">
                        <input
                          checked={cloneForm.publish}
                          className="form-check-input"
                          id="publishClone"
                          onChange={(event) => setCloneForm((current) => ({ ...current, publish: event.target.checked }))}
                          type="checkbox"
                        />
                        <label className="form-check-label" htmlFor="publishClone">Publish clone immediately</label>
                      </div>
                    </div>
                  </div>
                  <div className="d-flex justify-content-end mt-4">
                    <button className="btn sky-btn-ghost" disabled={saving} type="submit">
                      Clone workflow
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkflowManager;
