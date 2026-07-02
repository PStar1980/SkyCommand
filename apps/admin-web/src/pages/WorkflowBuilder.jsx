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

function ToolTargetOption({ tool }) {
  return (
    <option value={tool.targetCode}>
      {tool.displayName} ({tool.targetCode})
    </option>
  );
}

function WorkflowBuilderNodeCard({
  index,
  node,
  toolTargets,
  onChange,
  onMoveDown,
  onMoveUp,
  onRemove,
}) {
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
          <div className="fw-bold">{node.displayName || selectedTool?.displayName || 'New workflow node'}</div>
          <div className="small sky-muted sky-mono">{node.nodeKey || 'node_key'} → {node.targetCode || 'target tool'}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-sm sky-btn-ghost" disabled={index === 0} onClick={onMoveUp} type="button">↑</button>
          <button className="btn btn-sm sky-btn-ghost" disabled={index >= 99} onClick={onMoveDown} type="button">↓</button>
          <button className="btn btn-sm btn-outline-danger" onClick={onRemove} type="button">Remove</button>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <label className="form-label" htmlFor={`node-${index}-tool`}>Tool target</label>
          <select
            className="form-select sky-form-control"
            id={`node-${index}-tool`}
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
          <label className="form-label" htmlFor={`node-${index}-key`}>Node key</label>
          <input
            className="form-control sky-form-control sky-mono"
            id={`node-${index}-key`}
            onChange={(event) => patch({ nodeKey: nodeKeyFrom(event.target.value) })}
            value={node.nodeKey}
          />
        </div>
        <div className="col-lg-6">
          <label className="form-label" htmlFor={`node-${index}-name`}>Display name</label>
          <input
            className="form-control sky-form-control"
            id={`node-${index}-name`}
            onChange={(event) => patch({ displayName: event.target.value })}
            value={node.displayName}
          />
        </div>
        <div className="col-lg-6">
          <label className="form-label" htmlFor={`node-${index}-description`}>Description</label>
          <input
            className="form-control sky-form-control"
            id={`node-${index}-description`}
            onChange={(event) => patch({ description: event.target.value })}
            value={node.description}
          />
        </div>
        <div className="col-12">
          <label className="form-label" htmlFor={`node-${index}-input`}>Default input JSON</label>
          <textarea
            className="form-control sky-form-control sky-mono"
            id={`node-${index}-input`}
            onChange={(event) => patch({ inputJson: event.target.value })}
            rows={5}
            value={node.inputJson}
          />
          <div className="form-text">Stored as node default parameters. Runtime input can still override these values by node key.</div>
        </div>
      </div>
    </div>
  );
}

function WorkflowBuilder() {
  const [catalog, setCatalog] = useState({ nodeTypes: [], toolTargets: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createdDefinition, setCreatedDefinition] = useState(null);
  const [form, setForm] = useState({
    workflowCode: '',
    displayName: '',
    description: '',
    publish: true,
  });
  const [nodes, setNodes] = useState([
    { ...EMPTY_NODE },
  ]);

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

  const selectedToolTargets = useMemo(
    () => nodes
      .map((node) => toolTargets.find((tool) => tool.targetCode === node.targetCode))
      .filter(Boolean),
    [nodes, toolTargets],
  );

  async function loadCatalog() {
    setLoading(true);
    setError('');

    try {
      const result = await workflowService.getBuilderCatalog();
      setCatalog({
        nodeTypes: result.nodeTypes || [],
        supportedNodeTypes: result.supportedNodeTypes || [],
        toolTargets: result.toolTargets || [],
      });
    } catch (loadError) {
      setError(formatApiError(loadError, 'Failed to load workflow builder catalog.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  function patchForm(changes) {
    setForm((current) => {
      const next = { ...current, ...changes };

      if (Object.prototype.hasOwnProperty.call(changes, 'displayName') && !current.workflowCode) {
        next.workflowCode = slugify(changes.displayName);
      }

      return next;
    });
  }

  function updateNode(index, nextNode) {
    setNodes((current) => current.map((node, nodeIndex) => (nodeIndex === index ? nextNode : node)));
  }

  function addNode() {
    setNodes((current) => [
      ...current,
      {
        ...EMPTY_NODE,
        nodeKey: `node_${current.length + 1}`,
      },
    ]);
  }

  function removeNode(index) {
    setNodes((current) => current.filter((_, nodeIndex) => nodeIndex !== index));
  }

  function moveNode(index, direction) {
    setNodes((current) => {
      const next = [...current];
      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= next.length) {
        return current;
      }

      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function validateNodesForSubmit() {
    const seenKeys = new Set();

    return nodes.map((node, index) => {
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
          createdBy: 'workflow_builder_ui_v1',
        },
      };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    setCreatedDefinition(null);

    try {
      const workflowCode = slugify(form.workflowCode || form.displayName);
      const displayName = String(form.displayName || '').trim();

      if (!workflowCode) {
        throw new Error('Workflow code is required.');
      }

      if (!displayName) {
        throw new Error('Display name is required.');
      }

      const payload = {
        workflowCode,
        displayName,
        description: String(form.description || '').trim(),
        publish: form.publish,
        visibleInAdmin: true,
        enabled: true,
        nodes: validateNodesForSubmit(),
      };

      const result = await workflowService.createDefinition(payload);
      setCreatedDefinition(result.definition);
      setMessage(result.message || `Workflow ${payload.displayName} created.`);
    } catch (saveError) {
      setError(formatApiError(saveError, 'Failed to create workflow.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Workflows · Create</div>
          <h1 className="sky-page-title">Create Workflow</h1>
          <p className="sky-page-subtitle">
            Build a simple sequential SkyServer workflow from existing tool primitives. This v1 builder
            creates one published workflow version that can be started manually or scheduled.
          </p>
        </div>
        <button className="btn sky-btn-ghost" disabled={loading || saving} onClick={loadCatalog} type="button">
          {loading ? 'Refreshing...' : 'Refresh catalog'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {message && (
        <div className="alert alert-success d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>{message}</span>
          {createdDefinition?.workflowCode && (
            <span className="d-flex flex-wrap gap-2">
              <Link className="btn btn-sm sky-btn-ghost" to="/workflows/start">Start workflow</Link>
              <Link className="btn btn-sm sky-btn-ghost" to="/workflows/history">Workflow history</Link>
            </span>
          )}
        </div>
      )}

      <section className="sky-worker-hero mb-4">
        <div>
          <div className="sky-page-kicker">Workflow builder v1</div>
          <h2 className="h4 mb-2">Sequential tool-node composer</h2>
          <p className="sky-muted mb-3">
            This first builder keeps the hierarchy clean: tools stay as reusable primitives,
            SkyServer workflows compose the primitives, and Temporal executes the published workflow.
          </p>
          <div className="sky-worker-command-strip">
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Supported now</div>
              <div className="sky-worker-command-value">TOOL</div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Tool targets</div>
              <div className="sky-worker-command-value">{toolTargets.length}</div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Draft nodes</div>
              <div className="sky-worker-command-value">{nodes.length}</div>
            </div>
          </div>
        </div>

        <div className="sky-card">
          <div className="sky-card-header">
            <div className="sky-page-kicker">Preview</div>
            <h3 className="h5 mb-0">{form.displayName || 'Untitled workflow'}</h3>
          </div>
          <div className="sky-card-body">
            <p className="sky-muted mb-3">{form.description || 'No workflow description yet.'}</p>
            <div className="d-flex flex-wrap gap-2">
              <span className="sky-pill sky-pill-info sky-mono">{slugify(form.workflowCode || form.displayName) || 'workflow-code'}</span>
              <span className="sky-pill sky-pill-success">{form.publish ? 'Publish v1' : 'Draft only'}</span>
              <span className="sky-pill sky-pill-info">{nodes.length} node(s)</span>
              <span className="sky-pill sky-pill-info">{Math.max(0, nodes.length - 1)} edge(s)</span>
            </div>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit}>
        <div className="row g-4">
          <div className="col-xl-4">
            <section className="sky-card mb-4">
              <div className="sky-card-header">
                <div className="sky-page-kicker">Definition</div>
                <h2 className="h5 mb-0">Workflow metadata</h2>
              </div>
              <div className="sky-card-body">
                <div className="mb-3">
                  <label className="form-label" htmlFor="workflowDisplayName">Display name</label>
                  <input
                    className="form-control sky-form-control"
                    id="workflowDisplayName"
                    onChange={(event) => patchForm({ displayName: event.target.value })}
                    placeholder="My Macro Pipeline"
                    value={form.displayName}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="workflowCode">Workflow code</label>
                  <input
                    className="form-control sky-form-control sky-mono"
                    id="workflowCode"
                    onChange={(event) => patchForm({ workflowCode: slugify(event.target.value) })}
                    placeholder="my-macro-pipeline"
                    value={form.workflowCode}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="workflowDescription">Description</label>
                  <textarea
                    className="form-control sky-form-control"
                    id="workflowDescription"
                    onChange={(event) => patchForm({ description: event.target.value })}
                    rows={4}
                    value={form.description}
                  />
                </div>
                <div className="form-check form-switch mb-3">
                  <input
                    checked={form.publish}
                    className="form-check-input"
                    id="publishWorkflow"
                    onChange={(event) => patchForm({ publish: event.target.checked })}
                    type="checkbox"
                  />
                  <label className="form-check-label" htmlFor="publishWorkflow">
                    Publish version 1 immediately
                  </label>
                </div>
                <button className="btn sky-btn-primary w-100" disabled={saving || loading} type="submit">
                  {saving ? 'Creating workflow...' : 'Create workflow'}
                </button>
                <div className="form-text mt-2">
                  Builder v1 creates sequential TOOL-node workflows. Advanced node types come later.
                </div>
              </div>
            </section>

            <section className="sky-card">
              <div className="sky-card-header">
                <div className="sky-page-kicker">Palette</div>
                <h2 className="h5 mb-0">Future node types</h2>
              </div>
              <div className="sky-card-body">
                <div className="d-flex flex-wrap gap-2">
                  {(catalog.nodeTypes || []).map((nodeType) => (
                    <span
                      className={`sky-pill ${nodeType.initiallySupported ? 'sky-pill-success' : 'sky-pill-info'}`}
                      key={nodeType.nodeTypeCode}
                      title={nodeType.description || ''}
                    >
                      {nodeType.nodeTypeCode}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="col-xl-8">
            <section className="sky-card mb-4">
              <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
                <div>
                  <div className="sky-page-kicker">Node timeline</div>
                  <h2 className="h5 mb-0">Sequential execution plan</h2>
                </div>
                <button className="btn btn-sm sky-btn-ghost" onClick={addNode} type="button">Add tool node</button>
              </div>
              <div className="sky-card-body d-flex flex-column gap-3">
                {nodes.map((node, index) => (
                  <WorkflowBuilderNodeCard
                    index={index}
                    key={`${index}-${node.nodeKey || node.targetCode}`}
                    node={node}
                    onChange={updateNode}
                    onMoveDown={() => moveNode(index, 1)}
                    onMoveUp={() => moveNode(index, -1)}
                    onRemove={() => removeNode(index)}
                    toolTargets={toolTargets}
                  />
                ))}
                {nodes.length === 0 && <div className="sky-empty-state">Add at least one tool node.</div>}
              </div>
            </section>

            <section className="sky-card">
              <div className="sky-card-header">
                <div className="sky-page-kicker">Business preview</div>
                <h2 className="h5 mb-0">What SkyServer will publish</h2>
              </div>
              <div className="sky-card-body">
                {selectedToolTargets.length === 0 ? (
                  <div className="sky-empty-state">Select tool targets to preview the workflow path.</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {selectedToolTargets.map((tool, index) => (
                      <div className="sky-worker-command-card" key={`${tool.targetCode}-${index}`}>
                        <div className="d-flex justify-content-between gap-3">
                          <div>
                            <div className="sky-page-kicker">Step {index + 1}</div>
                            <div className="fw-bold">{tool.displayName}</div>
                            <div className="small sky-muted">{tool.description || 'No description.'}</div>
                          </div>
                          <span className="sky-pill sky-pill-info sky-mono">{tool.targetCode}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </form>
    </div>
  );
}

export default WorkflowBuilder;
