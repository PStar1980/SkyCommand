import { useState } from 'react';
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

function formatBooleanFlag(value) {
  return value ? 'Yes' : 'No';
}

function formatAction(value, fallback = '—') {
  return String(value || fallback).replace(/_/g, ' ').toLowerCase();
}

function getBranchTargetLabel(nodes = [], targetNodeKey = '') {
  const target = nodes.find((node) => node.nodeKey === targetNodeKey);

  return target?.displayName || targetNodeKey || 'next';
}

function getConditionBranchBadges(node = {}, nodes = []) {
  if (normalizeNodeType(node.nodeTypeCode) !== 'CONDITION') {
    return [];
  }

  const parameters = node.inputParameters || {};
  const trueTargetNodeKey = String(parameters.trueTargetNodeKey || '').trim();
  const falseTargetNodeKey = String(parameters.falseTargetNodeKey || '').trim();
  const badges = [];

  if (trueTargetNodeKey) {
    badges.push({
      label: 'TRUE',
      value: getBranchTargetLabel(nodes, trueTargetNodeKey),
      className: 'sky-pill-success',
    });
  }

  if (falseTargetNodeKey) {
    badges.push({
      label: 'FALSE',
      value: getBranchTargetLabel(nodes, falseTargetNodeKey),
      className: 'sky-pill-warning',
    });
  }

  return badges;
}

function getCatalogLabel(catalogs = {}, node = {}) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);

  if (nodeTypeCode === 'WORKFLOW') {
    const workflow = findByTargetCode(catalogs.workflowTargets, node.targetCode);
    return workflow?.displayName || node.targetCode || 'Child workflow target not selected';
  }

  if (nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    const template = findByTargetCode(catalogs.temporalWorkflowTargets, node.targetCode);
    return template?.displayName || node.targetCode || 'Temporal template not selected';
  }

  const tool = findByTargetCode(catalogs.toolTargets, node.targetCode);
  return tool?.displayName || node.targetCode || 'Tool target not selected';
}

function getNodeSummary(node, catalogs = {}) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);

  if (nodeTypeCode === 'API_CALL') {
    return getApiSummary(node);
  }

  if (nodeTypeCode === 'WORKFLOW' || nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    return getCatalogLabel(catalogs, node);
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

  return getCatalogLabel(catalogs, node);
}

function getNodeDetail(node, nodes = []) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);
  const parameters = node.inputParameters || {};

  if (nodeTypeCode === 'CONDITION') {
    const branchBadges = getConditionBranchBadges(node, nodes);

    if (branchBadges.length > 0) {
      return branchBadges.map((badge) => `${badge.label} → ${badge.value}`).join(' · ');
    }

    return `False action: ${formatAction(parameters.onFalse, 'STOP_SUCCESS')}`;
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

function getInspectorRows(node, catalogs = {}, nodes = []) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);
  const parameters = node.inputParameters || {};
  const rows = [
    ['Node key', node.nodeKey || '—'],
    ['Type', getNodeTypeMeta(nodeTypeCode).label],
  ];

  if (nodeTypeCode === 'API_CALL') {
    rows.push(
      ['Method', String(parameters.method || 'GET').toUpperCase()],
      ['URL', parameters.url || node.targetCode || '—'],
      ['Auth mode', parameters.authMode || 'AUTO'],
      ['Success codes', parameters.successCodes || '200,201,202,204'],
      ['Timeout', `${parameters.timeoutMs || '30000'} ms`],
    );
    return rows;
  }

  if (nodeTypeCode === 'WORKFLOW' || nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    rows.push(
      ['Target', getCatalogLabel(catalogs, node)],
      ['Target code', node.targetCode || '—'],
    );
    return rows;
  }

  if (nodeTypeCode === 'CONDITION') {
    rows.push(
      ['Expression', getConditionExpressionSummary(parameters)],
      ['Left path', parameters.leftPath || '—'],
      ['Operator', parameters.operator || '—'],
      ['Comparison value', parameters.rightValue || parameters.compareValue || '—'],
      ['Case sensitive', formatBooleanFlag(Boolean(parameters.caseSensitive))],
      ['When false', formatAction(parameters.onFalse, 'STOP_SUCCESS')],
      ['True branch', parameters.trueTargetNodeKey ? getBranchTargetLabel(nodes, parameters.trueTargetNodeKey) : 'next sequential node'],
      ['False branch', parameters.falseTargetNodeKey ? getBranchTargetLabel(nodes, parameters.falseTargetNodeKey) : 'false action'],
    );
    return rows;
  }

  if (nodeTypeCode === 'WAIT') {
    rows.push(
      ['Duration', formatWaitDuration(parameters)],
      ['Reason', parameters.reason || '—'],
    );
    return rows;
  }

  if (nodeTypeCode === 'HUMAN_APPROVAL') {
    rows.push(
      ['Approval title', parameters.approvalTitle || node.displayName || 'Approval required'],
      ['Approval key', parameters.approvalKey || node.nodeKey || '—'],
      ['Required role', parameters.requiredRoleCode || '—'],
      ['Timeout', `${parameters.timeoutDuration || 24} ${String(parameters.timeoutUnit || 'HOURS').toLowerCase()}`],
      ['When rejected', formatAction(parameters.onReject || parameters.onRejected, 'STOP_SUCCESS')],
      ['When timed out', formatAction(parameters.onTimeout, 'FAIL_WORKFLOW')],
    );
    return rows;
  }

  rows.push(
    ['Target', getCatalogLabel(catalogs, node)],
    ['Target code', node.targetCode || '—'],
  );
  return rows;
}

function WorkflowVisualNode({
  dragging,
  dragReorderEnabled,
  dropTarget,
  index,
  node,
  nodes,
  catalogs,
  selected,
  onDragEnd,
  onDragEnter,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
}) {
  const nodeTypeCode = normalizeNodeType(node.nodeTypeCode);
  const meta = getNodeTypeMeta(nodeTypeCode);
  const title = node.displayName || getNodeSummary(node, catalogs) || `Node ${index + 1}`;
  const summary = getNodeSummary(node, catalogs);
  const detail = getNodeDetail(node, nodes);

  return (
    <button
      aria-label={`Select workflow node ${index + 1}: ${title}`}
      className={`sky-workflow-visual-node ${meta.className} ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${dropTarget ? 'is-drop-target' : ''}`}
      draggable={dragReorderEnabled}
      onClick={() => onSelect?.(index, { scrollToEditor: true })}
      onDragEnd={onDragEnd}
      onDragEnter={(event) => onDragEnter?.(event, index)}
      onDragOver={(event) => onDragOver?.(event, index)}
      onDragStart={(event) => onDragStart?.(event, index)}
      onDrop={(event) => onDrop?.(event, index)}
      title={dragReorderEnabled ? 'Drag this node to reorder the sequential lane.' : undefined}
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
      {getConditionBranchBadges(node, nodes).length > 0 ? (
        <div className="sky-workflow-visual-branch-list">
          {getConditionBranchBadges(node, nodes).map((branch) => (
            <span className={`sky-pill ${branch.className}`} key={branch.label}>
              {branch.label} → {branch.value}
            </span>
          ))}
        </div>
      ) : null}
      {dragReorderEnabled ? <div className="sky-workflow-visual-drag-hint">Drag to reorder</div> : null}
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

function WorkflowVisualInspector({ catalogs, nodes = [], selectedNodeIndex = null, onNodeMove, onNodeSelect }) {
  const hasSelection = Number.isInteger(selectedNodeIndex)
    && selectedNodeIndex >= 0
    && selectedNodeIndex < nodes.length;

  if (!hasSelection) {
    return (
      <div className="sky-workflow-visual-inspector sky-workflow-visual-inspector-empty">
        <div>
          <div className="sky-page-kicker">Inspector</div>
          <h4 className="h6 mb-1">Select a node</h4>
          <p className="sky-muted mb-0">
            Click any visual block to inspect its target, behavior, and execution notes before editing the card below.
          </p>
        </div>
      </div>
    );
  }

  const node = nodes[selectedNodeIndex];
  const meta = getNodeTypeMeta(node.nodeTypeCode);
  const title = node.displayName || getNodeSummary(node, catalogs) || `Node ${selectedNodeIndex + 1}`;
  const rows = getInspectorRows(node, catalogs, nodes);
  const previousIndex = selectedNodeIndex - 1;
  const nextIndex = selectedNodeIndex + 1;

  return (
    <div className="sky-workflow-visual-inspector">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Inspector · Node {selectedNodeIndex + 1}</div>
          <h4 className="h6 mb-1">{title}</h4>
          <p className="sky-muted mb-0">{getNodeSummary(node, catalogs)}</p>
        </div>
        <span className={`sky-pill ${meta.pillClassName}`}>{meta.badge}</span>
      </div>

      <div className="sky-workflow-visual-inspector-grid">
        {rows.map(([label, value]) => (
          <div className="sky-workflow-visual-inspector-row" key={label}>
            <div className="sky-page-kicker">{label}</div>
            <div className="sky-workflow-visual-inspector-value sky-mono">{String(value || '—')}</div>
          </div>
        ))}
      </div>

      {node.description ? (
        <div className="sky-workflow-visual-inspector-note mt-3">
          <div className="sky-page-kicker mb-1">Description</div>
          <p className="mb-0">{node.description}</p>
        </div>
      ) : null}

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3">
        <span className="sky-muted small">Selected {selectedNodeIndex + 1} of {nodes.length}</span>
        <span className="d-flex flex-wrap gap-2">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={previousIndex < 0}
            onClick={() => onNodeSelect?.(previousIndex, { scrollToEditor: false })}
            type="button"
          >
            Previous
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={nextIndex >= nodes.length}
            onClick={() => onNodeSelect?.(nextIndex, { scrollToEditor: false })}
            type="button"
          >
            Next
          </button>
          {onNodeMove ? (
            <>
              <button
                className="btn btn-sm sky-btn-ghost"
                disabled={previousIndex < 0}
                onClick={() => onNodeMove?.(selectedNodeIndex, -1)}
                type="button"
              >
                Move left
              </button>
              <button
                className="btn btn-sm sky-btn-ghost"
                disabled={nextIndex >= nodes.length}
                onClick={() => onNodeMove?.(selectedNodeIndex, 1)}
                type="button"
              >
                Move right
              </button>
            </>
          ) : null}
          <button
            className="btn btn-sm sky-btn-primary"
            onClick={() => onNodeSelect?.(selectedNodeIndex, { scrollToEditor: true })}
            type="button"
          >
            Jump to editor
          </button>
        </span>
      </div>
    </div>
  );
}

function WorkflowVisualGraph({
  nodes = [],
  toolTargets = [],
  workflowTargets = [],
  temporalWorkflowTargets = [],
  selectedNodeIndex = null,
  onNodeMove,
  onNodeReorder,
  onNodeSelect,
}) {
  const catalogs = {
    toolTargets,
    workflowTargets,
    temporalWorkflowTargets,
  };
  const branchEdgeCount = nodes.reduce((count, node) => count + getConditionBranchBadges(node, nodes).length, 0);
  const totalEdges = Math.max(nodes.length - 1, 0) + branchEdgeCount;
  const dragReorderEnabled = Boolean(onNodeReorder) && nodes.length > 1;
  const [draggedNodeIndex, setDraggedNodeIndex] = useState(null);
  const [dropTargetIndex, setDropTargetIndex] = useState(null);

  function clearDragState() {
    setDraggedNodeIndex(null);
    setDropTargetIndex(null);
  }

  function handleDragStart(event, index) {
    if (!dragReorderEnabled) {
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDraggedNodeIndex(index);
    setDropTargetIndex(index);
    onNodeSelect?.(index, { scrollToEditor: false });
  }

  function handleDragEnter(event, index) {
    if (!dragReorderEnabled || draggedNodeIndex === null) {
      return;
    }

    event.preventDefault();
    setDropTargetIndex(index);
  }

  function handleDragOver(event, index) {
    if (!dragReorderEnabled || draggedNodeIndex === null) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  }

  function handleDrop(event, targetIndex) {
    if (!dragReorderEnabled) {
      return;
    }

    event.preventDefault();
    const sourceText = event.dataTransfer.getData('text/plain');
    const sourceIndex = Number.isInteger(draggedNodeIndex) ? draggedNodeIndex : Number.parseInt(sourceText, 10);

    clearDragState();

    if (!Number.isInteger(sourceIndex) || sourceIndex === targetIndex) {
      return;
    }

    onNodeReorder?.(sourceIndex, targetIndex);
  }

  return (
    <div className="sky-workflow-visual-shell">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Visual designer foundation</div>
          <h3 className="h5 mb-1">Sequential workflow map</h3>
          <p className="sky-muted mb-0">
            Live visual preview with node inspection and drag reorder. Save the graph to publish the new sequential order.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className="sky-pill sky-pill-info">{nodes.length} node(s)</span>
          <span className="sky-pill sky-pill-info">{totalEdges} edge(s)</span>
          <span className="sky-pill sky-pill-success">Sequential lane</span>
          {branchEdgeCount > 0 ? <span className="sky-pill sky-pill-warning">{branchEdgeCount} branch edge(s)</span> : null}
          {dragReorderEnabled ? <span className="sky-pill sky-pill-warning">Drag reorder</span> : null}
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="sky-empty-state">Add nodes below to preview the workflow lane.</div>
      ) : (
        <>
          {dragReorderEnabled ? (
            <div className="sky-workflow-visual-reorder-note mb-3">
              Drag a visual block onto another block to move it into that position. The editor cards below update immediately; execution changes only after you save the workflow graph.
            </div>
          ) : null}
          <div className="sky-workflow-visual-map" role="list" aria-label="Sequential workflow visual map">
            {nodes.map((node, index) => (
              <div className="sky-workflow-visual-step" key={`${index}-${node.nodeKey || node.targetCode || node.nodeTypeCode}`} role="listitem">
                <WorkflowVisualNode
                  catalogs={catalogs}
                  dragging={draggedNodeIndex === index}
                  dragReorderEnabled={dragReorderEnabled}
                  dropTarget={dropTargetIndex === index && draggedNodeIndex !== index}
                  index={index}
                  node={node}
                  nodes={nodes}
                  onDragEnd={clearDragState}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                  onSelect={onNodeSelect}
                  selected={selectedNodeIndex === index}
                />
                {index < nodes.length - 1 ? <WorkflowVisualEdge index={index} /> : null}
              </div>
            ))}
          </div>

          <WorkflowVisualInspector
            catalogs={catalogs}
            nodes={nodes}
            onNodeMove={onNodeMove}
            onNodeSelect={onNodeSelect}
            selectedNodeIndex={selectedNodeIndex}
          />
        </>
      )}
    </div>
  );
}

export default WorkflowVisualGraph;
