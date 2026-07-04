import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ToolParameterEditor, {
  cleanToolParameterValues,
  getInitialToolParameterValues,
} from '../components/ToolParameterEditor.jsx';
import workflowService from '../services/workflowService';

const DEFAULT_API_PARAMETERS = {
  method: 'GET',
  url: '',
  headersJson: '{}',
  bodyJson: '',
  successCodes: '200,201,202,204',
  timeoutMs: '30000',
  maxResponseBytes: '32768',
};

const EMPTY_NODE = {
  nodeKey: '',
  displayName: '',
  description: '',
  nodeTypeCode: 'TOOL',
  targetCode: '',
  inputParameters: {},
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

function parseJsonInput(value, fieldName, allowBlank = true) {
  const text = String(value || '').trim();

  if (!text && allowBlank) {
    return null;
  }

  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${error.message}`);
  }
}

function cleanApiParameters(values = {}) {
  const parameters = {
    ...DEFAULT_API_PARAMETERS,
    ...(values || {}),
  };

  parseJsonInput(parameters.headersJson || '{}', 'API headers JSON', false);
  if (parameters.bodyJson) {
    parseJsonInput(parameters.bodyJson, 'API body JSON');
  }

  if (!String(parameters.url || '').trim()) {
    throw new Error('API nodes require a URL.');
  }

  return Object.fromEntries(
    Object.entries(parameters).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function ToolTargetOption({ tool }) {
  return (
    <option value={tool.targetCode}>
      {tool.displayName} ({tool.targetCode})
    </option>
  );
}

function ApiParameterEditor({ idPrefix, parameters = {}, onChange }) {
  const values = { ...DEFAULT_API_PARAMETERS, ...(parameters || {}) };

  function patch(changes) {
    onChange({ ...values, ...changes });
  }

  return (
    <div className="row g-3">
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-method`}>Method</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-method`}
          onChange={(event) => patch({ method: event.target.value })}
          value={values.method || 'GET'}
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => (
            <option key={method} value={method}>{method}</option>
          ))}
        </select>
      </div>
      <div className="col-lg-8">
        <label className="form-label" htmlFor={`${idPrefix}-url`}>URL</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-url`}
          onChange={(event) => patch({ url: event.target.value })}
          placeholder="http://localhost:7171/api/temporal/health"
          value={values.url || ''}
        />
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-successCodes`}>Success codes</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-successCodes`}
          onChange={(event) => patch({ successCodes: event.target.value })}
          placeholder="200,201,202,204"
          value={values.successCodes || ''}
        />
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-timeout`}>Timeout ms</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-timeout`}
          onChange={(event) => patch({ timeoutMs: event.target.value })}
          type="number"
          value={values.timeoutMs || ''}
        />
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-maxBytes`}>Preview bytes</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-maxBytes`}
          onChange={(event) => patch({ maxResponseBytes: event.target.value })}
          type="number"
          value={values.maxResponseBytes || ''}
        />
      </div>
      <div className="col-12">
        <label className="form-label" htmlFor={`${idPrefix}-headers`}>Headers JSON</label>
        <textarea
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-headers`}
          onChange={(event) => patch({ headersJson: event.target.value })}
          rows={3}
          value={values.headersJson ?? '{}'}
        />
      </div>
      <div className="col-12">
        <label className="form-label" htmlFor={`${idPrefix}-body`}>Body JSON</label>
        <textarea
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-body`}
          onChange={(event) => patch({ bodyJson: event.target.value })}
          placeholder="Leave blank for GET/HEAD requests."
          rows={4}
          value={values.bodyJson ?? ''}
        />
      </div>
      <div className="form-text sky-muted">
        API nodes run as Temporal activities. Secrets should stay in environment-backed connection profiles later; v1 is for safe local/dev HTTP automation.
      </div>
    </div>
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
  const nodeTypeCode = node.nodeTypeCode || 'TOOL';

  function patch(changes) {
    onChange(index, { ...node, ...changes });
  }

  function handleNodeTypeChange(nextType) {
    if (nextType === 'API_CALL') {
      patch({
        nodeTypeCode: 'API_CALL',
        targetCode: '',
        displayName: node.displayName || 'Call API',
        nodeKey: node.nodeKey || `api_call_${index + 1}`,
        description: node.description || 'Calls a configured HTTP endpoint.',
        inputParameters: { ...DEFAULT_API_PARAMETERS },
      });
      return;
    }

    patch({
      nodeTypeCode: 'TOOL',
      targetCode: '',
      displayName: '',
      nodeKey: node.nodeKey || `node_${index + 1}`,
      description: '',
      inputParameters: {},
    });
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
      inputParameters: getInitialToolParameterValues(tool),
    });
  }

  return (
    <div className="sky-worker-command-card">
      <div className="d-flex flex-wrap justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Node {index + 1} · {nodeTypeCode === 'API_CALL' ? 'API call' : 'Tool'}</div>
          <div className="fw-bold">{node.displayName || selectedTool?.displayName || 'New workflow node'}</div>
          <div className="small sky-muted sky-mono">{node.nodeKey || 'node_key'} → {nodeTypeCode === 'API_CALL' ? node.inputParameters?.url || 'api endpoint' : node.targetCode || 'target tool'}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-sm sky-btn-ghost" disabled={index === 0} onClick={onMoveUp} type="button">↑</button>
          <button className="btn btn-sm sky-btn-ghost" disabled={index >= 99} onClick={onMoveDown} type="button">↓</button>
          <button className="btn btn-sm btn-outline-danger" onClick={onRemove} type="button">Remove</button>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-4">
          <label className="form-label" htmlFor={`node-${index}-type`}>Node type</label>
          <select
            className="form-select sky-form-control"
            id={`node-${index}-type`}
            onChange={(event) => handleNodeTypeChange(event.target.value)}
            value={nodeTypeCode}
          >
            <option value="TOOL">Tool</option>
            <option value="API_CALL">API call</option>
          </select>
        </div>
        {nodeTypeCode === 'TOOL' && (
          <div className="col-lg-8">
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
        )}
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
        <div className="col-12">
          <label className="form-label" htmlFor={`node-${index}-description`}>Description</label>
          <input
            className="form-control sky-form-control"
            id={`node-${index}-description`}
            onChange={(event) => patch({ description: event.target.value })}
            value={node.description}
          />
        </div>
        <div className="col-12">
          {nodeTypeCode === 'API_CALL' ? (
            <>
              <div className="sky-page-kicker mb-2">API call parameters</div>
              <ApiParameterEditor
                idPrefix={`node-${index}-api`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameters={node.inputParameters || {}}
              />
            </>
          ) : (
            <>
              <div className="sky-page-kicker mb-2">Tool parameters</div>
              <ToolParameterEditor
                idPrefix={`node-${index}-parameter`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameterValues={node.inputParameters || {}}
                parameters={selectedTool?.parameters || []}
              />
              <div className="form-text mt-2">
                Stored as node default tool parameters from the manifest configuration. Start Workflow uses these defaults.
              </div>
            </>
          )}
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

  const previewNodes = useMemo(
    () => nodes.map((node) => {
      if (node.nodeTypeCode === 'API_CALL') {
        return {
          displayName: node.displayName || 'Call API',
          description: node.description || node.inputParameters?.url || 'HTTP endpoint',
          code: node.inputParameters?.method ? `${node.inputParameters.method} ${node.inputParameters?.url || ''}` : 'API_CALL',
        };
      }

      const tool = toolTargets.find((item) => item.targetCode === node.targetCode);
      return {
        displayName: node.displayName || tool?.displayName || 'Tool node',
        description: node.description || tool?.description || 'No description.',
        code: node.targetCode || 'TOOL',
      };
    }),
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

  function addNode(nodeTypeCode = 'TOOL') {
    setNodes((current) => [
      ...current,
      nodeTypeCode === 'API_CALL'
        ? {
          ...EMPTY_NODE,
          nodeTypeCode: 'API_CALL',
          nodeKey: `api_call_${current.length + 1}`,
          displayName: 'Call API',
          description: 'Calls a configured HTTP endpoint.',
          inputParameters: { ...DEFAULT_API_PARAMETERS },
        }
        : {
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
      const nodeTypeCode = node.nodeTypeCode || 'TOOL';
      const nodeKey = nodeKeyFrom(node.nodeKey || node.displayName || node.targetCode || `node_${index + 1}`);
      const displayName = String(node.displayName || '').trim();

      if (!displayName) {
        throw new Error(`Node ${index + 1} requires a display name.`);
      }

      if (seenKeys.has(nodeKey)) {
        throw new Error(`Node key ${nodeKey} is duplicated.`);
      }

      seenKeys.add(nodeKey);

      if (nodeTypeCode === 'API_CALL') {
        const inputParameters = cleanApiParameters(node.inputParameters);
        return {
          nodeKey,
          nodeTypeCode: 'API_CALL',
          displayName,
          description: String(node.description || '').trim(),
          targetCode: inputParameters.url,
          inputParameters,
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'api',
            createdBy: 'workflow_builder_ui_v2',
          },
        };
      }

      const targetCode = String(node.targetCode || '').trim();
      if (!targetCode) {
        throw new Error(`Node ${index + 1} requires a tool target.`);
      }

      return {
        nodeKey,
        nodeTypeCode: 'TOOL',
        displayName,
        description: String(node.description || '').trim(),
        targetCode,
        inputParameters: cleanToolParameterValues(node.inputParameters),
        displayOrder: (index + 1) * 10,
        config: {
          builderCard: 'tool',
          createdBy: 'workflow_builder_ui_v2',
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
            Build a sequential SkyServer workflow from tools and API calls. SkyServer owns the business graph;
            Temporal executes it durably.
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
          <div className="sky-page-kicker">Workflow builder v2</div>
          <h2 className="h4 mb-2">Sequential node composer</h2>
          <p className="sky-muted mb-3">
            Tools remain reusable primitives, API calls become integration nodes, and Temporal runs the active workflow graph.
          </p>
          <div className="sky-worker-command-strip">
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Supported now</div>
              <div className="sky-worker-command-value">TOOL + API</div>
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
              <span className="sky-pill sky-pill-success">{form.publish ? 'Active on create' : 'Create inactive'}</span>
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
                    placeholder="My Automation Pipeline"
                    value={form.displayName}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="workflowCode">Workflow code</label>
                  <input
                    className="form-control sky-form-control sky-mono"
                    id="workflowCode"
                    onChange={(event) => patchForm({ workflowCode: slugify(event.target.value) })}
                    placeholder="my-automation-pipeline"
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
                    Make workflow active immediately
                  </label>
                </div>
                <button className="btn sky-btn-primary w-100" disabled={saving || loading} type="submit">
                  {saving ? 'Creating workflow...' : 'Create workflow'}
                </button>
              </div>
            </section>

            <section className="sky-card">
              <div className="sky-card-header">
                <div className="sky-page-kicker">Palette</div>
                <h2 className="h5 mb-0">Node types</h2>
              </div>
              <div className="sky-card-body">
                <div className="d-flex flex-wrap gap-2">
                  {(catalog.nodeTypes || []).map((nodeType) => (
                    <span
                      className={`sky-pill ${['TOOL', 'API_CALL'].includes(nodeType.nodeTypeCode) ? 'sky-pill-success' : 'sky-pill-info'}`}
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
                <div className="d-flex flex-wrap gap-2">
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('TOOL')} type="button">Add tool node</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('API_CALL')} type="button">Add API node</button>
                </div>
              </div>
              <div className="sky-card-body d-flex flex-column gap-3">
                {nodes.map((node, index) => (
                  <WorkflowBuilderNodeCard
                    index={index}
                    key={`${index}-${node.nodeKey || node.targetCode || node.nodeTypeCode}`}
                    node={node}
                    onChange={updateNode}
                    onMoveDown={() => moveNode(index, 1)}
                    onMoveUp={() => moveNode(index, -1)}
                    onRemove={() => removeNode(index)}
                    toolTargets={toolTargets}
                  />
                ))}
                {nodes.length === 0 && <div className="sky-empty-state">Add at least one node.</div>}
              </div>
            </section>

            <section className="sky-card">
              <div className="sky-card-header">
                <div className="sky-page-kicker">Business preview</div>
                <h2 className="h5 mb-0">What SkyServer will publish</h2>
              </div>
              <div className="sky-card-body">
                {previewNodes.length === 0 ? (
                  <div className="sky-empty-state">Add nodes to preview the workflow path.</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {previewNodes.map((item, index) => (
                      <div className="sky-worker-command-card" key={`${item.code}-${index}`}>
                        <div className="d-flex justify-content-between gap-3">
                          <div>
                            <div className="sky-page-kicker">Step {index + 1}</div>
                            <div className="fw-bold">{item.displayName}</div>
                            <div className="small sky-muted">{item.description || 'No description.'}</div>
                          </div>
                          <span className="sky-pill sky-pill-info sky-mono">{item.code}</span>
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
