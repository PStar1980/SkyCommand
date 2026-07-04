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
  authMode: 'AUTO',
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

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function graphNodesToEditorNodes(nodes = []) {
  return nodes.map((node, index) => ({
    nodeKey: node.nodeKey || `node_${index + 1}`,
    displayName: node.displayName || '',
    description: node.description || '',
    nodeTypeCode: node.nodeTypeCode || 'TOOL',
    targetCode: node.targetCode || '',
    inputParameters: node.nodeTypeCode === 'API_CALL'
      ? { ...DEFAULT_API_PARAMETERS, ...(node.inputParameters || {}) }
      : node.inputParameters || {},
  }));
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

function StatusPill({ status }) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  const className = normalized === 'ACTIVE' || normalized === 'PUBLISHED' || normalized === 'COMPLETED'
    ? 'sky-pill-success'
    : normalized === 'INACTIVE' || normalized === 'ARCHIVED' || normalized === 'RETIRED'
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
        <span className="sky-pill sky-pill-info">{definition.publishedNodeCount || definition.latestNodeCount || 0} node(s)</span>
        <span className="sky-pill sky-pill-info">{definition.publishedEdgeCount || definition.latestEdgeCount || 0} edge(s)</span>
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
        <label className="form-label" htmlFor={`${idPrefix}-authMode`}>Auth mode</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-authMode`}
          onChange={(event) => patch({ authMode: event.target.value })}
          value={values.authMode || 'AUTO'}
        >
          <option value="AUTO">Auto</option>
          <option value="NONE">No auth</option>
          <option value="SKYSERVER_INTERNAL">SkyServer internal</option>
        </select>
        <div className="form-text">Auto adds SkyServer internal auth for local SkyServer API calls when configured.</div>
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-successCodes`}>Success codes</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-successCodes`}
          onChange={(event) => patch({ successCodes: event.target.value })}
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
    </div>
  );
}

function EditableNodeCard({ index, node, toolTargets, onChange, onMoveDown, onMoveUp, onRemove }) {
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
      inputParameters: getInitialToolParameterValues(tool, tool?.targetCode === node.targetCode ? node.inputParameters : {}),
    });
  }

  return (
    <div className="sky-worker-command-card">
      <div className="d-flex flex-wrap justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Node {index + 1} · {nodeTypeCode === 'API_CALL' ? 'API call' : 'Tool'}</div>
          <div className="fw-bold">{node.displayName || selectedTool?.displayName || 'Workflow node'}</div>
          <div className="small sky-muted sky-mono">{node.nodeKey || 'node_key'} → {nodeTypeCode === 'API_CALL' ? node.inputParameters?.url || 'api endpoint' : node.targetCode || 'target tool'}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-sm sky-btn-ghost" disabled={index === 0} onClick={onMoveUp} type="button">↑</button>
          <button className="btn btn-sm sky-btn-ghost" onClick={onMoveDown} type="button">↓</button>
          <button className="btn btn-sm btn-outline-danger" onClick={onRemove} type="button">Remove</button>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-4">
          <label className="form-label" htmlFor={`manager-node-${index}-type`}>Node type</label>
          <select
            className="form-select sky-form-control"
            id={`manager-node-${index}-type`}
            onChange={(event) => handleNodeTypeChange(event.target.value)}
            value={nodeTypeCode}
          >
            <option value="TOOL">Tool</option>
            <option value="API_CALL">API call</option>
          </select>
        </div>
        {nodeTypeCode === 'TOOL' && (
          <div className="col-lg-8">
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
        )}
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
        <div className="col-12">
          <label className="form-label" htmlFor={`manager-node-${index}-description`}>Description</label>
          <input
            className="form-control sky-form-control"
            id={`manager-node-${index}-description`}
            onChange={(event) => patch({ description: event.target.value })}
            value={node.description}
          />
        </div>
        <div className="col-12">
          {nodeTypeCode === 'API_CALL' ? (
            <>
              <div className="sky-page-kicker mb-2">API call parameters</div>
              <ApiParameterEditor
                idPrefix={`manager-node-${index}-api`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameters={node.inputParameters || {}}
              />
            </>
          ) : (
            <>
              <div className="sky-page-kicker mb-2">Tool parameters</div>
              <ToolParameterEditor
                idPrefix={`manager-node-${index}-parameter`}
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


function WorkflowManager() {
  const [catalog, setCatalog] = useState({ toolTargets: [] });
  const [definitions, setDefinitions] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [detail, setDetail] = useState(null);
  const [metadataForm, setMetadataForm] = useState({
    displayName: '',
    description: '',
    status: 'ACTIVE',
  });
  const [cloneForm, setCloneForm] = useState({ workflowCode: '', displayName: '', description: '', publish: true });
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
          activeOnly: 'false',
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
      });
      setCloneForm({
        workflowCode: `${definition.workflowCode}-copy`,
        displayName: `${definition.displayName} Copy`,
        description: definition.description || '',
        publish: true,
      });
      setEditorNodes(graphNodesToEditorNodes(definition.publishedGraph?.nodes || definition.latestGraph?.nodes || []));
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

  function addEditorNode(nodeTypeCode = 'TOOL') {
    setEditorNodes((current) => [
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
        : { ...EMPTY_NODE, nodeKey: `node_${current.length + 1}` },
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
            updatedBy: 'workflow_manager_ui_v2',
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
          updatedBy: 'workflow_manager_ui_v2',
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

  async function handleDeleteWorkflow() {
    if (!detail || !window.confirm(`Delete workflow ${detail.displayName}? Run history remains, but the workflow definition and graph will be removed.`)) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await workflowService.deleteDefinition(detail.workflowCode);
      setMessage(result.message || 'Workflow deleted.');
      setDetail(null);
      await loadDefinitions('');
    } catch (deleteError) {
      setError(formatApiError(deleteError, 'Failed to delete workflow.'));
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

  async function handleSaveGraph(event) {
    event.preventDefault();

    if (!detail) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        nodes: validateEditorNodes(),
      };
      const result = await workflowService.replaceGraph(detail.workflowCode, payload);
      setMessage(result.message || 'Workflow graph saved.');
      await loadDefinitions(result.definition?.workflowCode || detail.workflowCode);
    } catch (graphError) {
      setError(formatApiError(graphError, 'Failed to save workflow graph.'));
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
            delete old definitions, and save the current sequential workflow graph.
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
            Manage the current workflow graph and lifecycle before branching, approvals, agents, and the visual graph editor arrive.
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
            <p className="sky-muted mb-3">{selectedDefinition?.description || 'Select a workflow to inspect its graph and lifecycle controls.'}</p>
            {selectedDefinition && (
              <div className="d-flex flex-wrap gap-2">
                <StatusPill status={selectedDefinition.status} />
                <span className="sky-pill sky-pill-info">{selectedDefinition.publishedNodeCount || selectedDefinition.latestNodeCount || 0} node(s)</span>
                <span className="sky-pill sky-pill-info">{selectedDefinition.publishedEdgeCount || selectedDefinition.latestEdgeCount || 0} edge(s)</span>
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
              <span className="sky-pill sky-pill-success">Save current graph</span>
              <span className="sky-pill sky-pill-success">Delete workflow</span>
              <span className="sky-pill sky-pill-info">Sequential TOOL + API nodes</span>
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
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                      <div className="form-text sky-muted">Inactive workflows are hidden from Start Workflow and blocked from scheduled execution.</div>
                    </div>
                  </div>

                  <div className="d-flex flex-wrap justify-content-between gap-2 mt-4">
                    <button className="btn btn-outline-danger" disabled={saving} onClick={handleDeleteWorkflow} type="button">
                      Delete workflow
                    </button>
                    <button className="btn sky-btn-primary" disabled={saving || detailLoading} type="submit">
                      {saving ? 'Saving...' : 'Save metadata'}
                    </button>
                  </div>
                </form>
              </section>
              <section className="sky-card">
                <div className="sky-card-header d-flex flex-wrap justify-content-between gap-3">
                  <div>
                    <div className="sky-page-kicker">Workflow graph</div>
                    <h2 className="h5 mb-0">Edit current sequential graph</h2>
                  </div>
                  <div className="d-flex flex-wrap gap-2"><button className="btn btn-sm sky-btn-ghost" onClick={() => addEditorNode('TOOL')} type="button">Add tool node</button><button className="btn btn-sm sky-btn-ghost" onClick={() => addEditorNode('API_CALL')} type="button">Add API node</button></div>
                </div>
                <form className="sky-card-body" onSubmit={handleSaveGraph}>
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
                      {saving ? 'Saving workflow...' : 'Save workflow graph'}
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
