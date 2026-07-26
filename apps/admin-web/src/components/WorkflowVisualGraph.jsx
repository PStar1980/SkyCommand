import { useEffect, useRef, useState } from 'react';
import { getConditionExpressionSummary } from './ConditionParameterEditor.jsx';
import { getHumanApprovalSummary } from './HumanApprovalParameterEditor.jsx';
import { formatWaitDuration } from './WaitParameterEditor.jsx';
import { getSummaryExpressionSummary } from './SummaryParameterEditor.jsx';
import { getRetryPolicySummary } from './WorkflowRetryPolicyEditor.jsx';

function normalizeNodeType(value) {
  return String(value || 'TOOL').trim().toUpperCase();
}

function findByTargetCode(items = [], targetCode = '') {
  return (items || []).find((item) => item.targetCode === targetCode);
}

function formatNodeTimeout(value) {
  return value ? `${value} ms` : 'default';
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
    SUMMARY: {
      badge: 'SUMMARY',
      label: 'Run summary',
      marker: 'Σ',
      className: 'sky-workflow-visual-node-summary',
      pillClassName: 'sky-pill-info',
    },
  };

  return metaByType[normalized] || metaByType.TOOL;
}


function normalizeRuntimeStatus(value, fallback = 'NOT_RUN') {
  const normalized = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return normalized || fallback;
}

function getRuntimeStatusMeta(status) {
  const normalized = normalizeRuntimeStatus(status);
  const metaByStatus = {
    COMPLETED: {
      label: 'COMPLETED',
      pillClassName: 'sky-pill-success',
      nodeClassName: 'is-runtime-completed',
      accentLabel: 'Completed',
    },
    SUCCESS: {
      label: 'COMPLETED',
      pillClassName: 'sky-pill-success',
      nodeClassName: 'is-runtime-completed',
      accentLabel: 'Completed',
    },
    APPROVED: {
      label: 'APPROVED',
      pillClassName: 'sky-pill-success',
      nodeClassName: 'is-runtime-completed',
      accentLabel: 'Approved',
    },
    RUNNING: {
      label: 'RUNNING',
      pillClassName: 'sky-pill-warning',
      nodeClassName: 'is-runtime-running',
      accentLabel: 'Running',
    },
    QUEUED: {
      label: 'QUEUED',
      pillClassName: 'sky-pill-warning',
      nodeClassName: 'is-runtime-running',
      accentLabel: 'Queued',
    },
    PENDING: {
      label: 'PENDING',
      pillClassName: 'sky-pill-warning',
      nodeClassName: 'is-runtime-pending',
      accentLabel: 'Pending',
    },
    PENDING_APPROVAL: {
      label: 'WAITING APPROVAL',
      pillClassName: 'sky-pill-warning',
      nodeClassName: 'is-runtime-pending',
      accentLabel: 'Waiting approval',
    },
    FAILED: {
      label: 'FAILED',
      pillClassName: 'sky-pill-danger',
      nodeClassName: 'is-runtime-failed',
      accentLabel: 'Failed',
    },
    REJECTED: {
      label: 'REJECTED',
      pillClassName: 'sky-pill-danger',
      nodeClassName: 'is-runtime-failed',
      accentLabel: 'Rejected',
    },
    TIMED_OUT: {
      label: 'TIMED OUT',
      pillClassName: 'sky-pill-danger',
      nodeClassName: 'is-runtime-failed',
      accentLabel: 'Timed out',
    },
    TERMINATED: {
      label: 'TERMINATED',
      pillClassName: 'sky-pill-danger',
      nodeClassName: 'is-runtime-failed',
      accentLabel: 'Terminated',
    },
    CANCELED: {
      label: 'CANCELED',
      pillClassName: 'sky-pill-danger',
      nodeClassName: 'is-runtime-failed',
      accentLabel: 'Canceled',
    },
    CANCELLED: {
      label: 'CANCELED',
      pillClassName: 'sky-pill-danger',
      nodeClassName: 'is-runtime-failed',
      accentLabel: 'Canceled',
    },
    SKIPPED: {
      label: 'SKIPPED',
      pillClassName: 'sky-pill-info',
      nodeClassName: 'is-runtime-skipped',
      accentLabel: 'Skipped',
    },
    NOT_RUN: {
      label: 'NOT RUN',
      pillClassName: 'sky-pill-info',
      nodeClassName: 'is-runtime-not-run',
      accentLabel: 'Not run',
    },
  };

  return metaByStatus[normalized] || {
    label: normalized.replace(/_/g, ' '),
    pillClassName: 'sky-pill-info',
    nodeClassName: 'is-runtime-unknown',
    accentLabel: normalized.replace(/_/g, ' ').toLowerCase(),
  };
}

function getDateDiffMs(start, end) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;

  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  return Math.max(0, endDate.getTime() - startDate.getTime());
}

function formatRuntimeDuration(ms) {
  const value = Number(ms);

  if (!Number.isFinite(value)) {
    return '—';
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

function getNodeRunDurationMs(nodeRun) {
  return nodeRun?.metadata?.durationMs || getDateDiffMs(nodeRun?.startedAt || nodeRun?.createdAt, nodeRun?.completedAt);
}

function getNodeRunForNode(node = {}, nodeRuns = []) {
  if (!nodeRuns.length) {
    return null;
  }

  return nodeRuns.find((nodeRun) => nodeRun.nodeKey && nodeRun.nodeKey === node.nodeKey)
    || nodeRuns.find((nodeRun) => node.workflowNodeId && nodeRun.workflowNodeId === node.workflowNodeId)
    || null;
}

function getApprovalForNode({ node = {}, nodeRun = null, approvals = [] } = {}) {
  if (!approvals.length) {
    return null;
  }

  return approvals.find((approval) => nodeRun?.workflowNodeRunRecordId && approval.workflowNodeRunRecordId === nodeRun.workflowNodeRunRecordId)
    || approvals.find((approval) => approval.nodeKey && approval.nodeKey === node.nodeKey)
    || null;
}

function getRuntimeStatusForNode({ nodeRun = null, approval = null } = {}) {
  if (approval?.status === 'PENDING') {
    return 'PENDING_APPROVAL';
  }

  if (approval?.status === 'APPROVED' && nodeRun?.status === 'COMPLETED') {
    return 'APPROVED';
  }

  if (approval?.status === 'REJECTED') {
    return nodeRun?.status || 'REJECTED';
  }

  return nodeRun?.status || 'NOT_RUN';
}

function getConditionRuntimeRoute({ node = {}, nodeRun = null, nodes = [] } = {}) {
  if (normalizeNodeType(node.nodeTypeCode) !== 'CONDITION' || !nodeRun?.output) {
    return null;
  }

  const output = nodeRun.output || {};
  const inferredBranchLabel = typeof output.passed === 'boolean'
    ? (output.passed ? 'TRUE' : 'FALSE')
    : '';
  const branchLabel = String(output.branchLabel || output.route || inferredBranchLabel)
    .trim()
    .toUpperCase();
  const targetNodeKey = String(
    output.branchTargetNodeKey || output.nextNodeKey || output.targetNodeKey || '',
  ).trim();
  const targetIndex = targetNodeKey
    ? nodes.findIndex((candidate) => candidate.nodeKey === targetNodeKey)
    : -1;
  const targetLabel = targetNodeKey ? getBranchTargetLabel(nodes, targetNodeKey) : '';
  const falseAction = formatAction(node.inputParameters?.onFalse, 'STOP_SUCCESS');

  if (!branchLabel && !targetNodeKey) {
    return null;
  }

  return {
    branchLabel: branchLabel || 'ROUTE',
    detail: targetNodeKey
      ? `${branchLabel || 'ROUTE'} → ${targetLabel}`
      : branchLabel === 'FALSE'
        ? `${branchLabel} · ${falseAction}`
        : branchLabel || 'Route captured',
    targetIndex,
    targetLabel,
    targetNodeKey,
  };
}

function getRuntimeOverlay({ node = {}, nodeRun = null, approval = null, nodes = [] } = {}) {
  const status = getRuntimeStatusForNode({ nodeRun, approval });
  const meta = getRuntimeStatusMeta(status);
  const durationMs = getNodeRunDurationMs(nodeRun);
  const conditionRoute = getConditionRuntimeRoute({ node, nodeRun, nodes });
  const pieces = [];

  if (nodeRun?.attemptCount !== undefined && nodeRun?.attemptCount !== null) {
    pieces.push(`Attempts ${nodeRun.attemptCount}`);
  }

  if (durationMs !== null && durationMs !== undefined) {
    pieces.push(`Duration ${formatRuntimeDuration(durationMs)}`);
  }

  if (approval?.status) {
    pieces.push(`Approval ${String(approval.status).toLowerCase()}`);
  }

  if (nodeRun?.errorMessage) {
    pieces.push('Has error');
  }

  return {
    ...meta,
    status,
    detail: pieces.join(' · ') || (nodeRun ? 'Runtime captured' : 'No node run recorded'),
    conditionRoute,
    nodeRun,
    approval,
    node,
  };
}


function isRuntimeActiveStatus(status) {
  const normalized = normalizeRuntimeStatus(status);
  return ['RUNNING', 'QUEUED', 'PENDING', 'PENDING_APPROVAL'].includes(normalized);
}

function isRuntimeTerminalStatus(status) {
  const normalized = normalizeRuntimeStatus(status);
  return ['COMPLETED', 'SUCCESS', 'APPROVED', 'FAILED', 'REJECTED', 'TIMED_OUT', 'TERMINATED', 'CANCELED', 'CANCELLED', 'SKIPPED'].includes(normalized);
}

function isRuntimeCompletedStatus(status) {
  const normalized = normalizeRuntimeStatus(status);
  return ['COMPLETED', 'SUCCESS', 'APPROVED'].includes(normalized);
}

function getRuntimeConditionRoutes(nodes = [], nodeRuns = [], approvals = []) {
  return nodes.reduce((routes, node, index) => {
    if (normalizeNodeType(node.nodeTypeCode) !== 'CONDITION') {
      return routes;
    }

    const nodeRun = getNodeRunForNode(node, nodeRuns);
    const approval = getApprovalForNode({ node, nodeRun, approvals });
    const status = getRuntimeStatusForNode({ nodeRun, approval });
    const route = getConditionRuntimeRoute({ node, nodeRun, nodes });

    if (!isRuntimeCompletedStatus(status) || !route || route.targetIndex <= index) {
      return routes;
    }

    routes.push({
      ...route,
      conditionIndex: index,
      edgeIndices: Array.from(
        { length: route.targetIndex - index },
        (_, offset) => index + offset,
      ),
    });

    return routes;
  }, []);
}

function prefersReducedWorkflowMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getActiveRuntimeNodeIndex(nodes = [], nodeRuns = [], approvals = []) {
  const activeByNode = nodes
    .map((node, index) => {
      const nodeRun = getNodeRunForNode(node, nodeRuns);
      const approval = getApprovalForNode({ node, nodeRun, approvals });
      const status = getRuntimeStatusForNode({ nodeRun, approval });
      return isRuntimeActiveStatus(status) ? index : -1;
    })
    .find((index) => index >= 0);

  if (activeByNode !== undefined) {
    return activeByNode;
  }

  return -1;
}

function getNextIncompleteRuntimeNodeIndex(nodes = [], nodeRuns = [], approvals = []) {
  return nodes
    .map((node, index) => {
      const nodeRun = getNodeRunForNode(node, nodeRuns);
      const approval = getApprovalForNode({ node, nodeRun, approvals });
      const status = getRuntimeStatusForNode({ nodeRun, approval });
      return isRuntimeTerminalStatus(status) ? -1 : index;
    })
    .find((index) => index >= 0) ?? -1;
}

function getLastCompletedRuntimeNodeIndex(nodes = [], nodeRuns = [], approvals = []) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const nodeRun = getNodeRunForNode(node, nodeRuns);
    const approval = getApprovalForNode({ node, nodeRun, approvals });
    const status = getRuntimeStatusForNode({ nodeRun, approval });

    if (isRuntimeCompletedStatus(status)) {
      return index;
    }
  }

  return -1;
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

  if (nodeTypeCode === 'SUMMARY') {
    return getSummaryExpressionSummary(node.inputParameters);
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

  if (nodeTypeCode === 'SUMMARY') {
    return parameters.summaryTemplate ? 'Custom summary template' : 'Auto summary from workflow context';
  }

  if (nodeTypeCode === 'API_CALL') {
    return `Timeout: ${parameters.timeoutMs || '30000'} ms`;
  }

  if (nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    return 'Temporal child execution';
  }

  if (nodeTypeCode === 'WORKFLOW') {
    return 'Reusable SkyCommand workflow';
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
      ['Retry policy', getRetryPolicySummary(node.retryPolicy)],
      ['Node timeout', formatNodeTimeout(node.timeoutMs)],
    );
    return rows;
  }

  if (nodeTypeCode === 'WORKFLOW' || nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    rows.push(
      ['Target', getCatalogLabel(catalogs, node)],
      ['Target code', node.targetCode || '—'],
      ['Retry policy', getRetryPolicySummary(node.retryPolicy)],
      ['Node timeout', formatNodeTimeout(node.timeoutMs)],
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

  if (nodeTypeCode === 'SUMMARY') {
    rows.push(
      ['Summary mode', getSummaryExpressionSummary(parameters)],
      ['Title', parameters.title || node.displayName || 'Workflow run summary'],
      ['Technical details', parameters.technicalDetailsTemplate ? 'custom template' : 'auto'],
      ['Recommended actions', parameters.recommendedNextActions ? 'configured' : '—'],
    );
    return rows;
  }

  rows.push(
    ['Target', getCatalogLabel(catalogs, node)],
    ['Target code', node.targetCode || '—'],
    ['Retry policy', getRetryPolicySummary(node.retryPolicy)],
    ['Node timeout', formatNodeTimeout(node.timeoutMs)],
  );
  return rows;
}

function WorkflowVisualNode({
  active = false,
  approval,
  dragging,
  dragReorderEnabled,
  dropTarget,
  index,
  node,
  nodeRun,
  nodes,
  catalogs,
  runtimeMode,
  selected,
  setNodeRef,
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
  const runtimeOverlay = runtimeMode ? getRuntimeOverlay({ node, nodeRun, approval, nodes }) : null;

  return (
    <button
      aria-label={`Select workflow node ${index + 1}: ${title}`}
      className={`sky-workflow-visual-node ${meta.className} ${runtimeOverlay?.nodeClassName || ''} ${active ? 'is-runtime-active' : ''} ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${dropTarget ? 'is-drop-target' : ''}`}
      draggable={dragReorderEnabled}
      ref={setNodeRef}
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
        <span className="d-flex flex-column align-items-end gap-1">
          <span className={`sky-pill ${meta.pillClassName}`}>{meta.badge}</span>
          {runtimeOverlay ? <span className={`sky-pill ${runtimeOverlay.pillClassName}`}>{runtimeOverlay.label}</span> : null}
        </span>
      </div>
      <div className="sky-page-kicker mb-1">Node {index + 1} · {meta.label}</div>
      <div className="sky-workflow-visual-title">{title}</div>
      <div className="sky-workflow-visual-key sky-mono">{node.nodeKey || `node_${index + 1}`}</div>
      <div className="sky-workflow-visual-summary sky-truncate">{summary}</div>
      <div className="sky-workflow-visual-detail sky-truncate">{detail}</div>
      {runtimeOverlay ? (
        <div className="sky-workflow-runtime-overlay">
          <div className="sky-page-kicker">Runtime</div>
          <div>{runtimeOverlay.detail}</div>
          {runtimeOverlay.conditionRoute ? (
            <div
              className={`sky-workflow-runtime-route is-${runtimeOverlay.conditionRoute.branchLabel.toLowerCase()}`}
              title={runtimeOverlay.conditionRoute.detail}
            >
              <span className="sky-workflow-runtime-route-label">Condition route</span>
              <strong>{runtimeOverlay.conditionRoute.detail}</strong>
            </div>
          ) : null}
          {nodeRun?.errorMessage ? <div className="sky-workflow-runtime-error">{nodeRun.errorMessage}</div> : null}
        </div>
      ) : null}
      {dragReorderEnabled ? <div className="sky-workflow-visual-drag-hint">Drag to reorder</div> : null}
    </button>
  );
}

function WorkflowVisualEdge({ active = false, branchPath = false, completed = false, index }) {
  return (
    <div
      className={`sky-workflow-visual-edge ${completed ? 'is-runtime-completed-edge' : ''} ${active ? 'is-runtime-active-edge' : ''} ${branchPath ? 'is-runtime-branch-path-edge' : ''}`}
      aria-label={`${branchPath ? 'Condition route' : 'Sequential'} edge after node ${index + 1}`}
    >
      <div className="sky-workflow-visual-edge-line" />
      <div className="sky-workflow-visual-edge-arrow">→</div>
      <div className="sky-workflow-visual-edge-label">next</div>
    </div>
  );
}

function WorkflowVisualInspector({ approvals = [], catalogs, includeRuntimeInspectorRows = false, nodeRuns = [], nodes = [], runtimeMode = false, selectedNodeIndex = null, onNodeMove, onNodeSelect }) {
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
  const nodeRun = getNodeRunForNode(node, nodeRuns);
  const approval = getApprovalForNode({ node, nodeRun, approvals });
  const runtimeOverlay = (runtimeMode || includeRuntimeInspectorRows) ? getRuntimeOverlay({ node, nodeRun, approval }) : null;
  const meta = getNodeTypeMeta(node.nodeTypeCode);
  const title = node.displayName || getNodeSummary(node, catalogs) || `Node ${selectedNodeIndex + 1}`;
  const rows = getInspectorRows(node, catalogs, nodes);
  const runtimeRows = runtimeOverlay
    ? [
        ['Run status', runtimeOverlay.label],
        ['Attempts', nodeRun?.attemptCount ?? '—'],
        ['Duration', formatRuntimeDuration(getNodeRunDurationMs(nodeRun))],
        ['Approval status', approval?.status || '—'],
        ['Branch taken', nodeRun?.output?.branchTaken ? `${nodeRun.output.branchLabel || ''} → ${nodeRun.output.branchTargetNodeKey || 'next'}` : '—'],
      ]
    : [];
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
        <span className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${meta.pillClassName}`}>{meta.badge}</span>
          {runtimeOverlay ? <span className={`sky-pill ${runtimeOverlay.pillClassName}`}>{runtimeOverlay.label}</span> : null}
        </span>
      </div>

      <div className="sky-workflow-visual-inspector-grid">
        {[...rows, ...runtimeRows].map(([label, value]) => (
          <div className="sky-workflow-visual-inspector-row" key={label}>
            <div className="sky-page-kicker">{label}</div>
            <div className="sky-workflow-visual-inspector-value sky-mono">{String(value || '—')}</div>
          </div>
        ))}
      </div>

      {runtimeOverlay?.nodeRun?.output?.summary ? (
        <div className="sky-workflow-visual-inspector-note mt-3">
          <div className="sky-page-kicker mb-1">Runtime summary</div>
          <p className="mb-0">{runtimeOverlay.nodeRun.output.summary}</p>
        </div>
      ) : null}

      {runtimeOverlay?.nodeRun?.errorMessage ? (
        <div className="sky-workflow-visual-inspector-note sky-workflow-visual-inspector-error mt-3">
          <div className="sky-page-kicker mb-1">Runtime error</div>
          <p className="mb-0">{runtimeOverlay.nodeRun.errorMessage}</p>
        </div>
      ) : null}

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

function WorkflowVisualNavigation({ nodes = [], selectedNodeIndex = null, onNodeSelect }) {
  const hasSelection = Number.isInteger(selectedNodeIndex)
    && selectedNodeIndex >= 0
    && selectedNodeIndex < nodes.length;
  const previousIndex = hasSelection ? selectedNodeIndex - 1 : -1;
  const nextIndex = hasSelection ? selectedNodeIndex + 1 : 0;

  return (
    <div className="d-flex flex-wrap justify-content-end align-items-center gap-2 mt-3">
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
    </div>
  );
}

function WorkflowVisualGraph({
  approvals = [],
  followActiveNode = false,
  headingKicker,
  headerActions = null,
  headerActionsStandalone = false,
  includeRuntimeInspectorRows = false,
  inspectorMode = 'full',
  nodeRuns = [],
  nodes = [],
  runStatus = '',
  runtimeMode = false,
  subtitle,
  temporalRuntime = null,
  title,
  toolTargets = [],
  workflowTargets = [],
  temporalWorkflowTargets = [],
  selectedNodeIndex = null,
  onFollowActiveNodeChange,
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
  const runtimeOverlays = runtimeMode
    ? nodes.map((node) => {
        const nodeRun = getNodeRunForNode(node, nodeRuns);
        const approval = getApprovalForNode({ node, nodeRun, approvals });
        return getRuntimeOverlay({ node, nodeRun, approval, nodes });
      })
    : [];
  const runtimeCounts = runtimeOverlays.reduce((counts, overlay) => {
    const status = normalizeRuntimeStatus(overlay?.status);

    if (['COMPLETED', 'SUCCESS', 'APPROVED'].includes(status)) {
      counts.completed += 1;
    } else if (['RUNNING', 'QUEUED', 'PENDING', 'PENDING_APPROVAL'].includes(status)) {
      counts.active += 1;
    } else if (['FAILED', 'REJECTED', 'TIMED_OUT', 'TERMINATED', 'CANCELED', 'CANCELLED'].includes(status)) {
      counts.failed += 1;
    } else {
      counts.notRun += 1;
    }

    return counts;
  }, { completed: 0, active: 0, failed: 0, notRun: 0 });
  const runtimeConditionRoutes = runtimeMode
    ? getRuntimeConditionRoutes(nodes, nodeRuns, approvals)
    : [];
  const runtimeBranchEdgeIndices = new Set(
    runtimeConditionRoutes.flatMap((route) => route.edgeIndices),
  );
  const activeNodeIndex = runtimeMode ? getActiveRuntimeNodeIndex(nodes, nodeRuns, approvals) : -1;
  const nextIncompleteNodeIndex = runtimeMode ? getNextIncompleteRuntimeNodeIndex(nodes, nodeRuns, approvals) : -1;
  const normalizedRunStatus = normalizeRuntimeStatus(runStatus || temporalRuntime?.status || 'UNKNOWN');
  const completedRun = ['COMPLETED', 'SUCCESS'].includes(normalizedRunStatus);
  const lastCompletedNodeIndex = runtimeMode
    ? getLastCompletedRuntimeNodeIndex(nodes, nodeRuns, approvals)
    : -1;
  const terminalIssueRun = ['FAILED', 'REJECTED', 'TIMED_OUT', 'TERMINATED', 'CANCELED', 'CANCELLED'].includes(normalizedRunStatus);
  const lastIssueNodeIndex = runtimeMode
    ? runtimeOverlays.reduce((lastIndex, overlay, index) => {
        const status = normalizeRuntimeStatus(overlay?.status);
        return ['FAILED', 'REJECTED', 'TIMED_OUT', 'TERMINATED', 'CANCELED', 'CANCELLED'].includes(status)
          ? index
          : lastIndex;
      }, -1)
    : -1;
  const followTargetIndex = terminalIssueRun && lastIssueNodeIndex >= 0
    ? lastIssueNodeIndex
    : activeNodeIndex >= 0
      ? activeNodeIndex
      : completedRun && lastCompletedNodeIndex >= 0
        ? lastCompletedNodeIndex
        : nextIncompleteNodeIndex;
  const activeEdgeIndex = followTargetIndex > 0 ? followTargetIndex - 1 : -1;
  const activeConditionRoute = runtimeConditionRoutes.find(
    (route) => route.targetIndex === followTargetIndex,
  );
  const activeBranchEdgeIndices = new Set(activeConditionRoute?.edgeIndices || []);
  const activeNode = followTargetIndex >= 0 ? nodes[followTargetIndex] : null;
  const runtimeStatus = normalizeRuntimeStatus(runStatus || temporalRuntime?.status || 'UNKNOWN');
  const runStatusMeta = runtimeMode ? getRuntimeStatusMeta(runtimeStatus) : null;
  const hasRuntimeExecution = runtimeMode && runtimeStatus !== 'NOT_RUN';
  const resolvedHeadingKicker = headingKicker || (runtimeMode ? 'Runtime status overlay' : 'Visual designer foundation');
  const resolvedTitle = title || (runtimeMode ? 'Runtime workflow map' : 'Sequential workflow map');
  const resolvedSubtitle = subtitle || (runtimeMode
    ? 'Run-aware visual map with node status, approval waits, failures, and condition branch decisions overlaid on the workflow graph.'
    : 'Live visual preview with node inspection and drag reorder. Save the graph to publish the new sequential order.');
  const [draggedNodeIndex, setDraggedNodeIndex] = useState(null);
  const [dropTargetIndex, setDropTargetIndex] = useState(null);
  const nodeRefs = useRef([]);
  const viewportRef = useRef(null);
  const nodeSignature = nodes.map((node, index) => node.nodeKey || node.workflowNodeId || `${index}`).join('|');

  useEffect(() => {
    const viewport = viewportRef.current;

    if (viewport) {
      viewport.scrollTo({ behavior: 'auto', left: 0 });
    }
  }, [nodeSignature]);

  useEffect(() => {
    if (!runtimeMode || !followActiveNode || followTargetIndex < 0) {
      return;
    }

    if (selectedNodeIndex !== followTargetIndex) {
      onNodeSelect?.(followTargetIndex, { scrollToEditor: false, followActiveNode: true });
    }

    const nodeElement = nodeRefs.current[followTargetIndex];
    const viewport = viewportRef.current;

    if (nodeElement && viewport) {
      const nodeRect = nodeElement.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const targetLeft = Math.max(
        0,
        viewport.scrollLeft
          + (nodeRect.left - viewportRect.left)
          - (viewport.clientWidth - nodeRect.width) / 2,
      );
      viewport.scrollTo({
        behavior: prefersReducedWorkflowMotion() ? 'auto' : 'smooth',
        left: targetLeft,
      });
    }
  }, [followActiveNode, followTargetIndex, onNodeSelect, runtimeMode, selectedNodeIndex]);

  function suspendFollowForManualNavigation() {
    if (runtimeMode && followActiveNode && onFollowActiveNodeChange) {
      onFollowActiveNodeChange(false);
    }
  }

  function handleViewportPointerDown(event) {
    const interactiveTarget = event.target.closest?.(
      '.sky-workflow-visual-node, .sky-workflow-visual-edge, button, input, label',
    );

    if (!interactiveTarget) {
      suspendFollowForManualNavigation();
    }
  }

  function handleViewportTouchStart(event) {
    const interactiveTarget = event.target.closest?.('.sky-workflow-visual-node, button, input, label');

    if (!interactiveTarget) {
      suspendFollowForManualNavigation();
    }
  }

  function handleViewportWheel(event) {
    if (Math.abs(event.deltaX) > 0 || event.shiftKey) {
      suspendFollowForManualNavigation();
    }
  }

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
          <div className="sky-page-kicker">{resolvedHeadingKicker}</div>
          <h3 className="h5 mb-1">{resolvedTitle}</h3>
          <p className="sky-muted mb-0">{resolvedSubtitle}</p>
        </div>
        <div className={`d-flex flex-wrap align-items-center justify-content-end gap-2 ms-auto ${headerActionsStandalone ? 'flex-grow-1' : ''}`}>
          {headerActions ? (
            headerActionsStandalone ? (
              <div className="d-flex w-100 justify-content-end">{headerActions}</div>
            ) : headerActions
          ) : null}
          {runtimeMode && onFollowActiveNodeChange ? (
            followActiveNode ? (
              <label className="sky-follow-active-toggle is-enabled">
                <input
                  checked
                  onChange={(event) => onFollowActiveNodeChange?.(event.target.checked)}
                  type="checkbox"
                />
                Follow active node
              </label>
            ) : followTargetIndex >= 0 ? (
              <button
                className="sky-follow-active-return"
                onClick={() => onFollowActiveNodeChange?.(true)}
                type="button"
              >
                ↪ Return to active node
              </button>
            ) : (
              <label className="sky-follow-active-toggle">
                <input
                  checked={false}
                  onChange={(event) => onFollowActiveNodeChange?.(event.target.checked)}
                  type="checkbox"
                />
                Follow active node
              </label>
            )
          ) : null}
          {runtimeMode && runtimeCounts.active > 0 && activeNode ? (
            <span className="sky-pill sky-pill-warning">Active: {activeNode.displayName || activeNode.nodeKey || `Node ${followTargetIndex + 1}`}</span>
          ) : null}
          <span className="sky-pill sky-pill-info">{nodes.length} node(s)</span>
          <span className="sky-pill sky-pill-info">{totalEdges} edge(s)</span>
          <span className="sky-pill sky-pill-success">Sequential lane</span>
          {branchEdgeCount > 0 ? <span className="sky-pill sky-pill-warning">{branchEdgeCount} branch edge(s)</span> : null}
          {runtimeMode && runStatusMeta ? <span className={`sky-pill ${runStatusMeta.pillClassName}`}>Run {runStatusMeta.label}</span> : null}
          {hasRuntimeExecution && runtimeCounts.completed > 0 ? <span className="sky-pill sky-pill-success">{runtimeCounts.completed} completed</span> : null}
          {hasRuntimeExecution && runtimeCounts.active > 0 ? <span className="sky-pill sky-pill-warning">{runtimeCounts.active} active</span> : null}
          {hasRuntimeExecution && runtimeCounts.failed > 0 ? <span className="sky-pill sky-pill-danger">{runtimeCounts.failed} issue(s)</span> : null}
          {hasRuntimeExecution && runtimeCounts.notRun > 0 ? <span className="sky-pill sky-pill-info">{runtimeCounts.notRun} not run</span> : null}
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
          {runtimeMode ? (
            <div className="sky-workflow-visual-runtime-note mb-3">
              Runtime overlay is read-only. Completed nodes and executed condition routes illuminate gold; skipped or unexecuted nodes remain dim.
            </div>
          ) : null}
          <div className="sky-workflow-visual-viewport">
            <div
              className="sky-workflow-visual-map"
              ref={viewportRef}
              role="list"
              aria-label="Sequential workflow visual map"
              onPointerDown={handleViewportPointerDown}
              onTouchStart={handleViewportTouchStart}
              onWheel={handleViewportWheel}
            >
              {nodes.map((node, index) => (
              <div className="sky-workflow-visual-step" key={`${index}-${node.nodeKey || node.targetCode || node.nodeTypeCode}`} role="listitem">
                <WorkflowVisualNode
                  active={runtimeMode && followTargetIndex === index}
                  approval={runtimeMode ? getApprovalForNode({ node, nodeRun: getNodeRunForNode(node, nodeRuns), approvals }) : null}
                  catalogs={catalogs}
                  dragging={draggedNodeIndex === index}
                  dragReorderEnabled={dragReorderEnabled}
                  dropTarget={dropTargetIndex === index && draggedNodeIndex !== index}
                  index={index}
                  node={node}
                  nodeRun={runtimeMode ? getNodeRunForNode(node, nodeRuns) : null}
                  nodes={nodes}
                  runtimeMode={runtimeMode}
                  setNodeRef={(element) => { nodeRefs.current[index] = element; }}
                  onDragEnd={clearDragState}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                  onSelect={onNodeSelect}
                  selected={selectedNodeIndex === index}
                />
                {index < nodes.length - 1 ? (
                  <WorkflowVisualEdge
                    active={runtimeMode
                      && (activeEdgeIndex === index || activeBranchEdgeIndices.has(index))}
                    branchPath={runtimeMode && runtimeBranchEdgeIndices.has(index)}
                    completed={runtimeMode
                      && (runtimeBranchEdgeIndices.has(index)
                        || (isRuntimeCompletedStatus(runtimeOverlays[index]?.status)
                          && isRuntimeCompletedStatus(runtimeOverlays[index + 1]?.status)))}
                    index={index}
                  />
                ) : null}
              </div>
            ))}
            </div>
          </div>

          {inspectorMode === 'full' ? (
            <WorkflowVisualInspector
              approvals={approvals}
              catalogs={catalogs}
              includeRuntimeInspectorRows={includeRuntimeInspectorRows}
              nodeRuns={nodeRuns}
              nodes={nodes}
              runtimeMode={runtimeMode}
              onNodeMove={onNodeMove}
              onNodeSelect={onNodeSelect}
              selectedNodeIndex={selectedNodeIndex}
            />
          ) : inspectorMode === 'navigation' ? (
            <WorkflowVisualNavigation
              nodes={nodes}
              onNodeSelect={onNodeSelect}
              selectedNodeIndex={selectedNodeIndex}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export default WorkflowVisualGraph;
