import { getConditionExpressionSummary } from './ConditionParameterEditor.jsx';
import { getHumanApprovalSummary } from './HumanApprovalParameterEditor.jsx';
import { formatWaitDuration } from './WaitParameterEditor.jsx';

function normalizeNodeType(value) {
  return String(value || 'TOOL').trim().toUpperCase();
}

function findByTargetCode(items = [], targetCode = '') {
  return (items || []).find((item) => item.targetCode === targetCode);
}

function getNodeTypeMeta(nodeTypeCode) {
  const normalized = normalizeNodeType(nodeTypeCode);
  const metaByType = {
    TOOL: {
      badge: 'TOOL',
      label: 'Tool primitive',
      marker: 'T',
      className: 'sky-workflow-visual-node-tool',
      pillClassName: 'sky-pill-success',
    },
    API_CALL: {
      badge: 'API',
      label: 'API integration',
      marker: 'A',
      className: 'sky-workflow-visual-node-api',
      pillClassName: 'sky-pill-info',
    },
    WORKFLOW: {
      badge: 'CHILD',
      label: 'Child workflow',
      marker: 'W',
      className: 'sky-workflow-visual-node-workflow',
      pillClassName: 'sky-pill-info',
    },
    TEMPORAL_WORKFLOW: {
      badge: 'TEMPORAL',
      label: 'Temporal template',
      marker: 'Θ',
      className: 'sky-workflow-visual-node-temporal',
      pillClassName: 'sky-pill-warning',
    },
    CONDITION: {
      badge: 'IF',
      label: 'Condition gate',
      marker: '?',
      className: 'sky-workflow-visual-node-condition',
      pillClassName: 'sky-pill-info',
    },
    WAIT: {
      badge: 'WAIT',
      label: 'Timer pause',
      marker: '⏱',
      className: 'sky-workflow-visual-node-wait',
      pillClassName: 'sky-pill-warning',
    },
    HUMAN_APPROVAL: {
      badge: 'APPROVAL',
      label: 'Human checkpoint',
      marker: '✓',
      className: 'sky-workflow-visual-node-approval',
      pillClassName: 'sky-pill-success',
    },
  };

  return metaByType[normalized] || metaByType.TOOL;
}

function getApiSummary(node) {
  const parameters = node.inputParameters || {};
  const method = String(parameters.method || 'GET').toUpperCase();
  const url = parameters.url || node.targetCode || 'API endpoint';

  return `${method} ${url}`;
}

function getNodeSummary(node, catalogs = {}) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);

  if (nodeTypeCode === 'API_CALL') {
    return getApiSummary(node);
  }

  if (nodeTypeCode === 'WORKFLOW') {
    const workflow = findByTargetCode(catalogs.workflowTargets, node.targetCode);
    return workflow?.displayName || node.targetCode || 'Child workflow target not selected';
  }

  if (nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    const template = findByTargetCode(catalogs.temporalWorkflowTargets, node.targetCode);
    return template?.displayName || node.targetCode || 'Temporal template not selected';
  }

  if (nodeTypeCode === 'CONDITION') {
    return getConditionExpressionSummary(node.inputParameters);
  }

  if (nodeTypeCode === 'WAIT') {
    return formatWaitDuration(node.inputParameters);
  }

  if (nodeTypeCode === 'HUMAN_APPROVAL') {
    return getHumanApprovalSummary(node.inputParameters);
  }

  const tool = findByTargetCode(catalogs.toolTargets, node.targetCode);

  return tool?.displayName || node.targetCode || 'Tool target not selected';
}

function getNodeDetail(node) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);
  const parameters = node.inputParameters || {};

  if (nodeTypeCode === 'CONDITION') {
    const falseAction = String(parameters.onFalse || 'STOP_SUCCESS').replace(/_/g, ' ').toLowerCase();
    return `False action: ${falseAction}`;
  }

  if (nodeTypeCode === 'WAIT') {
    return parameters.reason || 'Durable timer before next node';
  }

  if (nodeTypeCode === 'HUMAN_APPROVAL') {
    const role = parameters.requiredRoleCode || 'No role gate';
    return `Role: ${role}`;
  }

  if (nodeTypeCode === 'API_CALL') {
    return `Timeout: ${parameters.timeoutMs || '30000'} ms`;
  }

  if (nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    return 'Temporal child execution';
  }

  if (nodeTypeCode === 'WORKFLOW') {
    return 'Reusable SkyServer workflow';
  }

  return node.description || 'Reusable tool primitive';
}

function WorkflowVisualNode({ index, node, catalogs, selected, onSelect }) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);
  const meta = getNodeTypeMeta(nodeTypeCode);
  const title = node.displayName || getNodeSummary(node, catalogs) || `Node ${index + 1}`;
  const summary = getNodeSummary(node, catalogs);
  const detail = getNodeDetail(node);

  return (
    <button
      aria-label={`Select workflow node ${index + 1}: ${title}`}
      className={`sky-workflow-visual-node ${meta.className} ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect?.(index)}
      type="button"
    >
      <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
        <div className="sky-workflow-visual-marker" aria-hidden="true">{meta.marker}</div>
        <span className={`sky-pill ${meta.pillClassName}`}>{meta.badge}</span>
      </div>
      <div className="sky-page-kicker mb-1">Node {index + 1} · {meta.label}</div>
      <div className="sky-workflow-visual-title">{title}</div>
      <div className="sky-workflow-visual-key sky-mono">{node.nodeKey || `node_${index + 1}`}</div>
      <div className="sky-workflow-visual-summary sky-truncate">{summary}</div>
      <div className="sky-workflow-visual-detail sky-truncate">{detail}</div>
    </button>
  );
}

function WorkflowVisualEdge({ index }) {
  return (
    <div className="sky-workflow-visual-edge" aria-label={`Sequential edge after node ${index + 1}`}>
      <div className="sky-workflow-visual-edge-line" />
      <div className="sky-workflow-visual-edge-arrow">→</div>
      <div className="sky-workflow-visual-edge-label">next</div>
    </div>
  );
}

function WorkflowVisualGraph({
  nodes = [],
  toolTargets = [],
  workflowTargets = [],
  temporalWorkflowTargets = [],
  selectedNodeIndex = null,
  onNodeSelect,
}) {
  const catalogs = {
    toolTargets,
    workflowTargets,
    temporalWorkflowTargets,
  };
  const totalEdges = Math.max(nodes.length - 1, 0);

  return (
    <div className="sky-workflow-visual-shell">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Visual designer foundation</div>
          <h3 className="h5 mb-1">Sequential workflow map</h3>
          <p className="sky-muted mb-0">
            Read-only live preview of the saved/editable graph. Click a visual node to jump to its editor card below.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className="sky-pill sky-pill-info">{nodes.length} node(s)</span>
          <span className="sky-pill sky-pill-info">{totalEdges} edge(s)</span>
          <span className="sky-pill sky-pill-success">Sequential lane</span>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="sky-empty-state">Add nodes below to preview the workflow lane.</div>
      ) : (
        <div className="sky-workflow-visual-map" role="list" aria-label="Sequential workflow visual map">
          {nodes.map((node, index) => (
            <div className="sky-workflow-visual-step" key={`${index}-${node.nodeKey || node.targetCode || node.nodeTypeCode}`} role="listitem">
              <WorkflowVisualNode
                catalogs={catalogs}
                index={index}
                node={node}
                onSelect={onNodeSelect}
                selected={selectedNodeIndex === index}
              />
              {index < nodes.length - 1 ? <WorkflowVisualEdge index={index} /> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default WorkflowVisualGraph;
