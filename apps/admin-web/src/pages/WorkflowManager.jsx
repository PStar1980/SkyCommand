import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ConditionParameterEditor, {
  cleanConditionParameterValues,
  DEFAULT_CONDITION_PARAMETERS,
  getConditionExpressionSummary,
} from '../components/ConditionParameterEditor.jsx';
import ToolParameterEditor, {
  cleanToolParameterValues,
  getInitialToolParameterValues,
} from '../components/ToolParameterEditor.jsx';
import HumanApprovalParameterEditor, {
  cleanHumanApprovalParameterValues,
  DEFAULT_HUMAN_APPROVAL_PARAMETERS,
  getHumanApprovalSummary,
} from '../components/HumanApprovalParameterEditor.jsx';
import WaitParameterEditor, {
  cleanWaitParameterValues,
  DEFAULT_WAIT_PARAMETERS,
  formatWaitDuration,
} from '../components/WaitParameterEditor.jsx';
import WorkflowRetryPolicyEditor, {
  cleanNodeTimeoutMs,
  cleanRetryPolicyValues,
  DEFAULT_RETRY_POLICY,
  getInitialRetryPolicyValues,
  getRetryPolicySummary,
} from '../components/WorkflowRetryPolicyEditor.jsx';
import RuntimeParameterSchemaEditor, {
  cleanRuntimeParameterDefinitions,
  normalizeRuntimeParameterDefinitions,
} from '../components/RuntimeParameterSchemaEditor.jsx';
import SummaryParameterEditor, {
  cleanSummaryParameterValues,
  DEFAULT_SUMMARY_PARAMETERS,
  getSummaryExpressionSummary,
} from '../components/SummaryParameterEditor.jsx';
import WorkflowVisualGraph from '../components/WorkflowVisualGraph.jsx';
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

const VERSION_HISTORY_PAGE_SIZE = 5;
const MANAGE_WORKFLOW_PAGE_SIZE = 10;
const DEFAULT_MANAGE_WORKFLOW_FILTERS = {
  q: '',
  status: '',
  structure: '',
  parameterMode: '',
  nodeScale: '',
};

const EMPTY_NODE = {
  nodeKey: '',
  displayName: '',
  description: '',
  nodeTypeCode: 'TOOL',
  targetCode: '',
  inputParameters: {},
  retryPolicy: { ...DEFAULT_RETRY_POLICY },
  timeoutMs: '',
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
      : node.nodeTypeCode === 'CONDITION'
        ? { ...DEFAULT_CONDITION_PARAMETERS, ...(node.inputParameters || {}) }
        : node.nodeTypeCode === 'WAIT'
          ? { ...DEFAULT_WAIT_PARAMETERS, ...(node.inputParameters || {}) }
          : node.nodeTypeCode === 'HUMAN_APPROVAL'
            ? { ...DEFAULT_HUMAN_APPROVAL_PARAMETERS, ...(node.inputParameters || {}) }
            : node.nodeTypeCode === 'SUMMARY'
              ? { ...DEFAULT_SUMMARY_PARAMETERS, ...(node.inputParameters || {}) }
              : node.inputParameters || {},
    retryPolicy: getInitialRetryPolicyValues(node.retryPolicy),
    timeoutMs: node.timeoutMs ? String(node.timeoutMs) : '',
    positionX: node.positionX,
    positionY: node.positionY,
    enabled: node.enabled !== false,
    config: node.config || {},
  }));
}

function getForwardBranchTargetOptions(nodes = [], currentIndex = 0) {
  return nodes
    .slice(currentIndex + 1)
    .map((node, offset) => {
      const originalIndex = currentIndex + offset + 1;
      const nodeKey = nodeKeyFrom(node.nodeKey || node.displayName || node.targetCode || `node_${originalIndex + 1}`);
      const displayName = String(node.displayName || nodeKey || `Node ${originalIndex + 1}`).trim();

      return {
        nodeKey,
        label: `Node ${originalIndex + 1} · ${displayName} (${nodeKey})`,
      };
    })
    .filter((target) => Boolean(target.nodeKey));
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

function formatRuntimeParameterSchema(parameters = []) {
  return JSON.stringify(Array.isArray(parameters) ? parameters : [], null, 2);
}

function parseRuntimeParameterSchema(value) {
  const parsed = parseJsonInput(value || '[]', 'Runtime parameter schema JSON', false);

  if (!Array.isArray(parsed)) {
    throw new Error('Runtime parameter schema JSON must be an array.');
  }

  return parsed;
}

function supportsRetryPolicy(nodeTypeCode) {
  return ['TOOL', 'API_CALL', 'WORKFLOW', 'TEMPORAL_WORKFLOW'].includes(String(nodeTypeCode || 'TOOL').toUpperCase());
}

function getRetryPolicyPayload(node = {}) {
  if (!supportsRetryPolicy(node.nodeTypeCode)) {
    return {
      retryPolicy: {},
      timeoutMs: null,
    };
  }

  return {
    retryPolicy: cleanRetryPolicyValues(node.retryPolicy),
    timeoutMs: cleanNodeTimeoutMs(node.timeoutMs),
  };
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

function getDefinitionNodeCount(definition = {}) {
  const count = Number(
    Array.isArray(definition.nodes)
      ? definition.nodes.length
      : definition.publishedNodeCount ?? definition.latestNodeCount ?? 0,
  );

  return Number.isFinite(count) ? count : 0;
}

function getDefinitionEdgeCount(definition = {}) {
  const count = Number(
    Array.isArray(definition.edges)
      ? definition.edges.length
      : definition.publishedEdgeCount ?? definition.latestEdgeCount ?? 0,
  );

  return Number.isFinite(count) ? count : 0;
}

function getDefinitionRuntimeParameterCount(definition = {}) {
  return normalizeRuntimeParameterDefinitions(
    definition.runtimeParameters || definition.config?.runtimeParameters || [],
  ).length;
}

function getDefinitionStructure(definition = {}) {
  const nodeCount = getDefinitionNodeCount(definition);
  const edgeCount = getDefinitionEdgeCount(definition);

  if (nodeCount <= 1) {
    return 'single';
  }

  if (edgeCount > Math.max(nodeCount - 1, 0)) {
    return 'branching';
  }

  return 'sequential';
}

function getDefinitionStructureLabel(definition = {}) {
  const structure = getDefinitionStructure(definition);

  if (structure === 'branching') {
    return 'Branching';
  }

  if (structure === 'single') {
    return 'Single node';
  }

  return 'Sequential';
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

function ToolTargetOption({ tool }) {
  return (
    <option value={tool.targetCode}>
      {tool.displayName} ({tool.targetCode})
    </option>
  );
}

function WorkflowTargetOption({ workflow }) {
  return (
    <option value={workflow.targetCode}>
      {workflow.displayName} ({workflow.targetCode})
    </option>
  );
}

function TemporalWorkflowTargetOption({ template }) {
  return (
    <option value={template.targetCode}>
      {template.displayName} ({template.targetCode})
    </option>
  );
}

function mapTemporalParameter(parameter = {}) {
  const parameterName = parameter.parameterName || parameter.name;
  const rawType = String(parameter.paramTypeCode || parameter.parameterType || parameter.type || 'STRING').toUpperCase();
  const typeMap = {
    BOOLEAN: 'boolean',
    INTEGER: 'number',
    NUMBER: 'number',
    STRING_ARRAY: 'string',
    ARRAY: 'string',
    STRING: 'string',
    REPO: 'repo',
    REPOSITORY: 'repo',
  };

  return {
    parameterId: parameter.parameterId || parameterName,
    parameterName,
    label: parameter.label || parameterName,
    prompt: parameter.placeholder || parameter.helpText || parameter.description || parameterName,
    paramTypeCode: typeMap[rawType] || 'string',
    required: Boolean(parameter.required),
    defaultValue: parameter.defaultValue,
    options: Array.isArray(parameter.allowedValues)
      ? parameter.allowedValues.map((value) => ({ value, label: String(value) }))
      : [],
  };
}

function getTemporalEditorParameters(template) {
  return (template?.parameters || []).map(mapTemporalParameter).filter((parameter) => parameter.parameterName);
}

function getInitialTemporalParameterValues(template, existingValues = {}) {
  return getInitialToolParameterValues({ parameters: getTemporalEditorParameters(template) }, existingValues);
}

function cleanTemporalParameterValues(values = {}) {
  return cleanToolParameterValues(values);
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
          <option value="SKYSERVER_INTERNAL">SkyCommand internal</option>
        </select>
        <div className="form-text">Auto adds SkyCommand internal auth for local SkyCommand API calls when configured.</div>
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

function getManagerNodeExpressionSummary(node, selectedTool) {
  const nodeTypeCode = String(node?.nodeTypeCode || 'TOOL').toUpperCase();

  if (nodeTypeCode === 'API_CALL') return node.inputParameters?.url || 'api endpoint';
  if (nodeTypeCode === 'WORKFLOW') return node.targetCode || 'child workflow';
  if (nodeTypeCode === 'TEMPORAL_WORKFLOW') return node.targetCode || 'temporal template';
  if (nodeTypeCode === 'CONDITION') return getConditionExpressionSummary(node.inputParameters);
  if (nodeTypeCode === 'WAIT') return formatWaitDuration(node.inputParameters);
  if (nodeTypeCode === 'HUMAN_APPROVAL') return getHumanApprovalSummary(node.inputParameters);
  if (nodeTypeCode === 'SUMMARY') return getSummaryExpressionSummary(node.inputParameters);

  return node.targetCode || selectedTool?.targetCode || 'target tool';
}

function EditableNodeCard({ index, node, allNodes = [], highlighted = false, toolTargets = [], workflowTargets = [], temporalWorkflowTargets = [], approvalRoleTargets = [], runtimeParameters = [], onChange, onMoveDown, onMoveUp, onRemove }) {
  const selectedTool = toolTargets.find((tool) => tool.targetCode === node.targetCode);
  const selectedWorkflow = workflowTargets.find((workflow) => workflow.targetCode === node.targetCode);
  const selectedTemporalWorkflow = temporalWorkflowTargets.find((template) => template.targetCode === node.targetCode);
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

    if (nextType === 'WORKFLOW') {
      patch({
        nodeTypeCode: 'WORKFLOW',
        targetCode: '',
        displayName: node.displayName || 'Run Child Workflow',
        nodeKey: node.nodeKey || `child_workflow_${index + 1}`,
        description: node.description || 'Runs another active SkyCommand workflow and waits for completion.',
        inputParameters: {},
      });
      return;
    }

    if (nextType === 'TEMPORAL_WORKFLOW') {
      patch({
        nodeTypeCode: 'TEMPORAL_WORKFLOW',
        targetCode: '',
        displayName: node.displayName || 'Run Temporal Workflow Template',
        nodeKey: node.nodeKey || `temporal_workflow_${index + 1}`,
        description: node.description || 'Runs an approved Temporal-native workflow template and waits for completion.',
        inputParameters: {},
      });
      return;
    }

    if (nextType === 'CONDITION') {
      patch({
        nodeTypeCode: 'CONDITION',
        targetCode: '',
        displayName: node.displayName || 'Evaluate Condition',
        nodeKey: node.nodeKey || `condition_${index + 1}`,
        description: node.description || 'Evaluates a safe condition and controls whether the remaining workflow continues.',
        inputParameters: { ...DEFAULT_CONDITION_PARAMETERS },
      });
      return;
    }

    if (nextType === 'WAIT') {
      patch({
        nodeTypeCode: 'WAIT',
        targetCode: '',
        displayName: node.displayName || 'Wait / Delay',
        nodeKey: node.nodeKey || `wait_${index + 1}`,
        description: node.description || 'Pauses the workflow for a configured duration before continuing.',
        inputParameters: { ...DEFAULT_WAIT_PARAMETERS },
      });
      return;
    }

    if (nextType === 'HUMAN_APPROVAL') {
      patch({
        nodeTypeCode: 'HUMAN_APPROVAL',
        targetCode: '',
        displayName: node.displayName || 'Human Approval',
        nodeKey: node.nodeKey || `approval_${index + 1}`,
        description: node.description || 'Pauses the workflow until an authorized user approves or rejects the request.',
        inputParameters: { ...DEFAULT_HUMAN_APPROVAL_PARAMETERS },
      });
      return;
    }

    if (nextType === 'SUMMARY') {
      patch({
        nodeTypeCode: 'SUMMARY',
        targetCode: '',
        displayName: node.displayName || 'Generate Run Summary',
        nodeKey: node.nodeKey || `summary_${index + 1}`,
        description: node.description || 'Generates a human-readable workflow run summary from params, context, outputs, errors, and timings.',
        inputParameters: { ...DEFAULT_SUMMARY_PARAMETERS },
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

  function handleWorkflowTargetChange(targetCode) {
    const workflow = workflowTargets.find((item) => item.targetCode === targetCode);
    const nextDisplayName = node.displayName || workflow?.displayName || targetCode;
    const nextNodeKey = node.nodeKey || nodeKeyFrom(nextDisplayName || targetCode);

    patch({
      targetCode,
      displayName: nextDisplayName,
      nodeKey: nextNodeKey,
      description: node.description || workflow?.description || 'Runs a child SkyCommand workflow.',
      inputParameters: {},
    });
  }

  function handleTemporalWorkflowTargetChange(targetCode) {
    const template = temporalWorkflowTargets.find((item) => item.targetCode === targetCode);
    const nextDisplayName = node.displayName || template?.displayName || targetCode;
    const nextNodeKey = node.nodeKey || nodeKeyFrom(nextDisplayName || targetCode);

    patch({
      targetCode,
      displayName: nextDisplayName,
      nodeKey: nextNodeKey,
      description: node.description || template?.description || 'Runs an approved Temporal workflow template.',
      inputParameters: getInitialTemporalParameterValues(template, node.inputParameters),
    });
  }

  return (
    <div
      className={`sky-worker-command-card ${highlighted ? 'sky-editor-node-highlight' : ''}`}
      id={`workflow-editor-node-${index}`}
    >
      <div className="d-flex flex-wrap justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Node {index + 1} · {getNodeTypeLabel(nodeTypeCode)}</div>
          <div className="fw-bold">{node.displayName || selectedTool?.displayName || selectedWorkflow?.displayName || selectedTemporalWorkflow?.displayName || 'Workflow node'}</div>
          <div className="small sky-muted sky-mono">{node.nodeKey || 'node_key'} → {getManagerNodeExpressionSummary(node, selectedTool)}</div>
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
            <option value="WORKFLOW">Child workflow</option>
            <option value="TEMPORAL_WORKFLOW">Temporal workflow template</option>
            <option value="CONDITION">Condition / branch</option>
            <option value="WAIT">Wait / delay</option>
            <option value="HUMAN_APPROVAL">Human approval</option>
            <option value="SUMMARY">Summary / run report</option>
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
        {nodeTypeCode === 'WORKFLOW' && (
          <div className="col-lg-8">
            <label className="form-label" htmlFor={`manager-node-${index}-workflow`}>Child workflow target</label>
            <select
              className="form-select sky-form-control"
              id={`manager-node-${index}-workflow`}
              onChange={(event) => handleWorkflowTargetChange(event.target.value)}
              value={node.targetCode}
            >
              <option value="">Select active workflow...</option>
              {workflowTargets.map((workflow) => <WorkflowTargetOption key={workflow.targetCode} workflow={workflow} />)}
            </select>
            {selectedWorkflow && (
              <div className="form-text">
                {selectedWorkflow.nodeCount || 0} node(s) · {selectedWorkflow.edgeCount || 0} edge(s) · active child workflow
              </div>
            )}
          </div>
        )}
        {nodeTypeCode === 'TEMPORAL_WORKFLOW' && (
          <div className="col-lg-8">
            <label className="form-label" htmlFor={`manager-node-${index}-temporal`}>Temporal workflow template</label>
            <select
              className="form-select sky-form-control"
              id={`manager-node-${index}-temporal`}
              onChange={(event) => handleTemporalWorkflowTargetChange(event.target.value)}
              value={node.targetCode}
            >
              <option value="">Select approved Temporal template...</option>
              {temporalWorkflowTargets.map((template) => <TemporalWorkflowTargetOption key={template.targetCode} template={template} />)}
            </select>
            {selectedTemporalWorkflow && (
              <div className="form-text">
                {selectedTemporalWorkflow.workflowType} · task queue {selectedTemporalWorkflow.taskQueue || 'default'}
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
          ) : nodeTypeCode === 'WORKFLOW' ? (
            <>
              <div className="sky-page-kicker mb-2">Child workflow behavior</div>
              <div className="sky-empty-state text-start">
                The parent workflow starts the selected SkyCommand workflow as a Temporal child execution and waits for it to complete. Child workflow inputs come from that workflow's saved node defaults.
              </div>
            </>
          ) : nodeTypeCode === 'TEMPORAL_WORKFLOW' ? (
            <>
              <div className="sky-page-kicker mb-2">Temporal template parameters</div>
              <ToolParameterEditor
                idPrefix={`manager-node-${index}-temporal-parameter`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameterValues={node.inputParameters || {}}
                parameters={getTemporalEditorParameters(selectedTemporalWorkflow)}
                workflowParameters={runtimeParameters}
              />
              <div className="form-text mt-2">
                Runs the approved Temporal-native template as a child execution and waits for completion. Use this for specialized durable subprocesses.
              </div>
            </>
          ) : nodeTypeCode === 'WAIT' ? (
            <>
              <div className="sky-page-kicker mb-2">Wait / delay parameters</div>
              <WaitParameterEditor
                idPrefix={`manager-node-${index}-wait`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameters={node.inputParameters || {}}
              />
              <div className="form-text mt-2">
                Pauses the workflow before the next sequential node. Temporal-backed executions use a durable timer instead of blocking the API request.
              </div>
            </>
          ) : nodeTypeCode === 'CONDITION' ? (
            <>
              <div className="sky-page-kicker mb-2">Condition parameters</div>
              <ConditionParameterEditor
                branchTargetOptions={getForwardBranchTargetOptions(allNodes, index)}
                idPrefix={`manager-node-${index}-condition`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameters={node.inputParameters || {}}
              />
              <div className="form-text mt-2">
                Reads workflow input, previous node output, or a named node output. False can stop successfully, fail, or continue.
              </div>
            </>
          ) : nodeTypeCode === 'HUMAN_APPROVAL' ? (
            <>
              <div className="sky-page-kicker mb-2">Human approval parameters</div>
              <HumanApprovalParameterEditor
                idPrefix={`manager-node-${index}-approval`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameters={node.inputParameters || {}}
                roleOptions={approvalRoleTargets}
              />
              <div className="form-text mt-2">
                Creates a pending approval request and waits for a Temporal signal before continuing.
              </div>
            </>
          ) : nodeTypeCode === 'SUMMARY' ? (
            <>
              <div className="sky-page-kicker mb-2">Run summary parameters</div>
              <SummaryParameterEditor
                idPrefix={`manager-node-${index}-summary`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameters={node.inputParameters || {}}
              />
              <div className="form-text mt-2">
                Generates a structured workflow summary from runtime params, workflow context, node outputs, errors, and timings.
              </div>
            </>
          ) : (
            <>
              <div className="sky-page-kicker mb-2">Tool parameters</div>
              <ToolParameterEditor
                idPrefix={`manager-node-${index}-parameter`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameterValues={node.inputParameters || {}}
                parameters={selectedTool?.parameters || []}
                workflowParameters={runtimeParameters}
              />
              <div className="form-text mt-2">
                Stored as node default tool parameters from the manifest configuration. Start Workflow uses these defaults.
              </div>
            </>
          )}
        </div>
        {supportsRetryPolicy(nodeTypeCode) ? (
          <div className="col-12">
            <WorkflowRetryPolicyEditor
              idPrefix={`manager-node-${index}-retry`}
              onChange={({ retryPolicy, timeoutMs }) => patch({ retryPolicy, timeoutMs })}
              retryPolicy={node.retryPolicy || {}}
              timeoutMs={node.timeoutMs ?? ''}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}


function getNodeTypeLabel(nodeTypeCode = 'TOOL') {
  const labels = {
    TOOL: 'Tool primitive',
    API_CALL: 'API call',
    WORKFLOW: 'Child workflow',
    TEMPORAL_WORKFLOW: 'Temporal workflow template',
    CONDITION: 'Condition / branch',
    WAIT: 'Wait / delay',
    HUMAN_APPROVAL: 'Human approval',
    SUMMARY: 'Run summary',
  };

  return labels[String(nodeTypeCode || 'TOOL').toUpperCase()] || labels.TOOL;
}

function formatParameterValue(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function ReadOnlyNodeParameterPanel({
  index,
  node,
  saving = false,
  toolTargets = [],
  workflowTargets = [],
  temporalWorkflowTargets = [],
  onCreateDraft,
}) {
  if (!node) {
    return null;
  }

  const nodeTypeCode = String(node.nodeTypeCode || 'TOOL').toUpperCase();
  const inputParameters = node.inputParameters || {};
  const parameterEntries = Object.entries(inputParameters);
  const selectedTool = toolTargets.find((tool) => tool.targetCode === node.targetCode);
  const selectedWorkflow = workflowTargets.find((workflow) => workflow.targetCode === node.targetCode);
  const selectedTemporalWorkflow = temporalWorkflowTargets.find((template) => template.targetCode === node.targetCode);
  const targetLabel = selectedTool?.displayName || selectedWorkflow?.displayName || selectedTemporalWorkflow?.displayName || node.targetCode || '—';

  return (
    <div className="sky-worker-command-card mt-4">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Selected node defaults · Node {index + 1}</div>
          <h3 className="h6 mb-1">{node.displayName || targetLabel || `Node ${index + 1}`}</h3>
          <p className="sky-muted mb-0">
            Published versions are read-only. Create a draft to edit this node's saved defaults, retry policy, and timeout.
          </p>
        </div>
        <span className="d-flex flex-wrap gap-2">
          <span className="sky-pill sky-pill-info">{getNodeTypeLabel(nodeTypeCode)}</span>
          <button className="btn btn-sm sky-btn-primary" disabled={saving} onClick={onCreateDraft} type="button">
            Create draft to edit
          </button>
        </span>
      </div>

      <div className="row g-3">
        <div className="col-lg-3">
          <div className="sky-page-kicker">Node key</div>
          <div className="sky-form-control-static sky-mono">{node.nodeKey || '—'}</div>
        </div>
        <div className="col-lg-3">
          <div className="sky-page-kicker">Target</div>
          <div className="sky-form-control-static">{targetLabel}</div>
        </div>
        <div className="col-lg-3">
          <div className="sky-page-kicker">Retry policy</div>
          <div className="sky-form-control-static sky-mono">{getRetryPolicySummary(node.retryPolicy)}</div>
        </div>
        <div className="col-lg-3">
          <div className="sky-page-kicker">Node timeout</div>
          <div className="sky-form-control-static sky-mono">{node.timeoutMs ? `${node.timeoutMs} ms` : 'default'}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="sky-page-kicker mb-2">Node-level input parameters</div>
        {parameterEntries.length > 0 ? (
          <div className="sky-node-parameter-preview-grid">
            {parameterEntries.map(([key, value]) => (
              <div className="sky-node-parameter-preview" key={key}>
                <div className="sky-page-kicker">{key}</div>
                <pre className="sky-code-block mb-0">{formatParameterValue(value)}</pre>
              </div>
            ))}
          </div>
        ) : (
          <div className="sky-empty-state text-start">
            No saved node-level input parameters. This node will use its target defaults unless a draft adds explicit values.
          </div>
        )}
      </div>
    </div>
  );
}


function WorkflowManager() {
  const [catalog, setCatalog] = useState({ toolTargets: [], workflowTargets: [], temporalWorkflowTargets: [], approvalRoleTargets: [], repositoryOptions: [] });
  const [definitions, setDefinitions] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [detail, setDetail] = useState(null);
  const [metadataForm, setMetadataForm] = useState({
    displayName: '',
    description: '',
    status: 'ACTIVE',
    runtimeParameters: [],
  });
  const [cloneForm, setCloneForm] = useState({ workflowCode: '', displayName: '', description: '', publish: true });
  const [publishForm, setPublishForm] = useState({ changeNote: '' });
  const [editorNodes, setEditorNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedVisualNodeIndex, setSelectedVisualNodeIndex] = useState(null);
  const [versionHistoryPage, setVersionHistoryPage] = useState(1);
  const [manageWorkflowFilters, setManageWorkflowFilters] = useState(DEFAULT_MANAGE_WORKFLOW_FILTERS);
  const [manageWorkflowPage, setManageWorkflowPage] = useState(1);

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

  const workflowTargets = useMemo(
    () => [...(catalog.workflowTargets || [])]
      .filter((workflow) => workflow.targetCode !== selectedCode)
      .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''))),
    [catalog.workflowTargets, selectedCode],
  );

  const temporalWorkflowTargets = useMemo(
    () => [...(catalog.temporalWorkflowTargets || [])]
      .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''))),
    [catalog.temporalWorkflowTargets],
  );

  const approvalRoleTargets = useMemo(
    () => [...(catalog.approvalRoleTargets || [])]
      .sort((a, b) => String(a.roleCode || '').localeCompare(String(b.roleCode || ''))),
    [catalog.approvalRoleTargets],
  );

  async function loadDefinitions(nextSelectedCode = selectedCode, detailOptions = {}) {
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
        workflowTargets: catalogResult.workflowTargets || [],
        temporalWorkflowTargets: catalogResult.temporalWorkflowTargets || [],
        approvalRoleTargets: catalogResult.approvalRoleTargets || [],
        repositoryOptions: catalogResult.repositoryOptions || [],
      });

      const selectedExists = items.some((item) => item.workflowCode === nextSelectedCode);
      const nextCode = selectedExists ? nextSelectedCode : items[0]?.workflowCode || '';
      setSelectedCode(nextCode);

      if (nextCode) {
        await loadDetail(nextCode, { silent: true, ...detailOptions });
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
        runtimeParameters: normalizeRuntimeParameterDefinitions(definition.runtimeParameters || definition.config?.runtimeParameters || []),
      });
      setCloneForm({
        workflowCode: `${definition.workflowCode}-copy`,
        displayName: `${definition.displayName} Copy`,
        description: definition.description || '',
        publish: true,
      });
      const nextEditorNodes = graphNodesToEditorNodes(definition.editGraph?.nodes || definition.draftGraph?.nodes || definition.publishedGraph?.nodes || definition.latestGraph?.nodes || []);
      const preferredNodeKey = String(options.selectedNodeKey || '').trim();
      const preferredNodeIndex = Number.isInteger(options.selectedNodeIndex) ? options.selectedNodeIndex : null;
      const matchedNodeIndex = preferredNodeKey
        ? nextEditorNodes.findIndex((node) => node.nodeKey === preferredNodeKey)
        : -1;
      const nextSelectedNodeIndex = matchedNodeIndex >= 0
        ? matchedNodeIndex
        : preferredNodeIndex !== null && nextEditorNodes.length > 0
          ? Math.min(Math.max(preferredNodeIndex, 0), nextEditorNodes.length - 1)
          : nextEditorNodes.length > 0
            ? 0
            : null;

      setEditorNodes(nextEditorNodes);
      setPublishForm({ changeNote: '' });
      setSelectedVisualNodeIndex(nextSelectedNodeIndex);
      setVersionHistoryPage(1);
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

  function handleVisualNodeSelect(index, options = {}) {
    setSelectedVisualNodeIndex(index);

    if (options.scrollToEditor === false) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(`workflow-editor-node-${index}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }

  function addEditorNode(nodeTypeCode = 'TOOL') {
    const nextIndex = editorNodes.length;
    const nextNode = nodeTypeCode === 'API_CALL'
      ? {
        ...EMPTY_NODE,
        nodeTypeCode: 'API_CALL',
        nodeKey: `api_call_${nextIndex + 1}`,
        displayName: 'Call API',
        description: 'Calls a configured HTTP endpoint.',
        inputParameters: { ...DEFAULT_API_PARAMETERS },
      }
      : nodeTypeCode === 'WORKFLOW'
        ? {
          ...EMPTY_NODE,
          nodeTypeCode: 'WORKFLOW',
          nodeKey: `child_workflow_${nextIndex + 1}`,
          displayName: 'Run Child Workflow',
          description: 'Runs another active SkyCommand workflow and waits for completion.',
          inputParameters: {},
        }
        : nodeTypeCode === 'TEMPORAL_WORKFLOW'
          ? {
            ...EMPTY_NODE,
            nodeTypeCode: 'TEMPORAL_WORKFLOW',
            nodeKey: `temporal_workflow_${nextIndex + 1}`,
            displayName: 'Run Temporal Workflow Template',
            description: 'Runs an approved Temporal-native workflow template and waits for completion.',
            inputParameters: {},
          }
          : nodeTypeCode === 'CONDITION'
            ? {
              ...EMPTY_NODE,
              nodeTypeCode: 'CONDITION',
              nodeKey: `condition_${nextIndex + 1}`,
              displayName: 'Evaluate Condition',
              description: 'Evaluates a safe condition and controls whether the remaining workflow continues.',
              inputParameters: { ...DEFAULT_CONDITION_PARAMETERS },
            }
            : nodeTypeCode === 'WAIT'
              ? {
                ...EMPTY_NODE,
                nodeTypeCode: 'WAIT',
                nodeKey: `wait_${nextIndex + 1}`,
                displayName: 'Wait / Delay',
                description: 'Pauses the workflow for a configured duration before continuing.',
                inputParameters: { ...DEFAULT_WAIT_PARAMETERS },
              }
              : nodeTypeCode === 'HUMAN_APPROVAL'
                ? {
                  ...EMPTY_NODE,
                  nodeTypeCode: 'HUMAN_APPROVAL',
                  nodeKey: `approval_${nextIndex + 1}`,
                  displayName: 'Human Approval',
                  description: 'Pauses the workflow until an authorized user approves or rejects the request.',
                  inputParameters: { ...DEFAULT_HUMAN_APPROVAL_PARAMETERS },
                }
                : nodeTypeCode === 'SUMMARY'
                  ? {
                    ...EMPTY_NODE,
                    nodeTypeCode: 'SUMMARY',
                    nodeKey: `summary_${nextIndex + 1}`,
                    displayName: 'Generate Run Summary',
                    description: 'Generates a human-readable workflow run summary from params, context, outputs, errors, and timings.',
                    inputParameters: { ...DEFAULT_SUMMARY_PARAMETERS },
                  }
                  : { ...EMPTY_NODE, nodeKey: `node_${nextIndex + 1}` };

    setEditorNodes((current) => [...current, nextNode]);
    setSelectedVisualNodeIndex(nextIndex);

    window.requestAnimationFrame(() => {
      document.getElementById(`workflow-editor-node-${nextIndex}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }

  function removeEditorNode(index) {
    setSelectedVisualNodeIndex(null);
    setEditorNodes((current) => current.filter((_, nodeIndex) => nodeIndex !== index));
  }

  function reorderEditorNode(sourceIndex, targetIndex, options = {}) {
    const source = Number(sourceIndex);
    const target = Number(targetIndex);

    if (
      !Number.isInteger(source)
      || !Number.isInteger(target)
      || source < 0
      || source >= editorNodes.length
      || target < 0
      || target >= editorNodes.length
    ) {
      return;
    }

    setEditorNodes((current) => {
      if (source < 0 || source >= current.length || target < 0 || target >= current.length || source === target) {
        return current;
      }

      const next = [...current];
      const [movedNode] = next.splice(source, 1);
      next.splice(target, 0, movedNode);
      return next;
    });

    if (options.selectMovedNode) {
      setSelectedVisualNodeIndex(target);
    } else {
      setSelectedVisualNodeIndex(null);
    }
  }

  function moveEditorNode(index, direction, options = {}) {
    reorderEditorNode(index, index + direction, options);
  }

  function handleVisualNodeReorder(sourceIndex, targetIndex) {
    reorderEditorNode(sourceIndex, targetIndex, { selectMovedNode: true });
  }

  function handleVisualNodeMove(index, direction) {
    moveEditorNode(index, direction, { selectMovedNode: true });
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
          ...getRetryPolicyPayload(node),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'api',
            updatedBy: 'workflow_manager_ui_v2',
          },
        };
      }

      if (nodeTypeCode === 'WORKFLOW') {
        const targetCode = String(node.targetCode || '').trim();

        if (!targetCode) {
          throw new Error(`Node ${index + 1} requires a child workflow target.`);
        }

        if (targetCode === selectedCode) {
          throw new Error('A workflow cannot contain itself as a child workflow.');
        }

        return {
          nodeKey,
          nodeTypeCode: 'WORKFLOW',
          displayName,
          description: String(node.description || '').trim(),
          targetCode,
          inputParameters: {},
          ...getRetryPolicyPayload(node),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'workflow',
            updatedBy: 'workflow_manager_ui_v3',
          },
        };
      }

      if (nodeTypeCode === 'TEMPORAL_WORKFLOW') {
        const targetCode = String(node.targetCode || '').trim();

        if (!targetCode) {
          throw new Error(`Node ${index + 1} requires a Temporal workflow template target.`);
        }

        return {
          nodeKey,
          nodeTypeCode: 'TEMPORAL_WORKFLOW',
          displayName,
          description: String(node.description || '').trim(),
          targetCode,
          inputParameters: cleanTemporalParameterValues(node.inputParameters),
          ...getRetryPolicyPayload(node),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'temporal',
            updatedBy: 'workflow_manager_ui_v4',
          },
        };
      }

      if (nodeTypeCode === 'CONDITION') {
        return {
          nodeKey,
          nodeTypeCode: 'CONDITION',
          displayName,
          description: String(node.description || '').trim(),
          targetCode: '',
          inputParameters: cleanConditionParameterValues(node.inputParameters),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'condition',
            updatedBy: 'workflow_manager_ui_v5',
          },
        };
      }

      if (nodeTypeCode === 'WAIT') {
        return {
          nodeKey,
          nodeTypeCode: 'WAIT',
          displayName,
          description: String(node.description || '').trim(),
          targetCode: '',
          inputParameters: cleanWaitParameterValues(node.inputParameters),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'wait',
            updatedBy: 'workflow_manager_ui_v6',
          },
        };
      }

      if (nodeTypeCode === 'HUMAN_APPROVAL') {
        return {
          nodeKey,
          nodeTypeCode: 'HUMAN_APPROVAL',
          displayName,
          description: String(node.description || '').trim(),
          targetCode: '',
          inputParameters: cleanHumanApprovalParameterValues(node.inputParameters, approvalRoleTargets),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'human_approval',
            updatedBy: 'workflow_manager_ui_v7',
          },
        };
      }

      if (nodeTypeCode === 'SUMMARY') {
        return {
          nodeKey,
          nodeTypeCode: 'SUMMARY',
          displayName,
          description: String(node.description || '').trim(),
          targetCode: '',
          inputParameters: cleanSummaryParameterValues(node.inputParameters),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'summary',
            updatedBy: 'workflow_manager_ui_v8',
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
        ...getRetryPolicyPayload(node),
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
      const result = await workflowService.updateDefinition(detail.workflowCode, {
        displayName: metadataForm.displayName,
        description: metadataForm.description,
        status: metadataForm.status,
        runtimeParameters: cleanRuntimeParameterDefinitions(metadataForm.runtimeParameters),
      });
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

  async function handleCreateDraft() {
    if (!detail) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await workflowService.createDraft(detail.workflowCode, {
        sourceWorkflowVersionId: detail.publishedVersionId || detail.latestVersionId,
      });
      setMessage(result.message || 'Draft created. You can now edit safely without changing the published workflow.');
      await loadDefinitions(result.definition?.workflowCode || detail.workflowCode);
    } catch (draftError) {
      setError(formatApiError(draftError, 'Failed to create workflow draft.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveGraph(event) {
    event.preventDefault();

    if (!detail || !draftGraph) {
      setError('Create a draft before saving graph edits. Published workflow versions are read-only.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        nodes: validateEditorNodes(),
        baseWorkflowVersionId: draftGraph.workflowVersionId,
        baseUpdatedAt: draftGraph.updatedAt,
      };
      const selectedNodeKey = Number.isInteger(selectedVisualNodeIndex)
        ? editorNodes[selectedVisualNodeIndex]?.nodeKey || null
        : null;
      const selectedNodeIndex = Number.isInteger(selectedVisualNodeIndex) ? selectedVisualNodeIndex : null;
      const result = await workflowService.saveDraftGraph(detail.workflowCode, draftGraph.workflowVersionId, payload);
      setMessage(result.message || 'Draft workflow graph saved. Publish the draft before new runs use it.');
      await loadDefinitions(result.definition?.workflowCode || detail.workflowCode, {
        selectedNodeKey,
        selectedNodeIndex,
      });
    } catch (graphError) {
      setError(formatApiError(graphError, 'Failed to save workflow draft graph.'));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishDraft() {
    if (!detail || !draftGraph) {
      return;
    }

    const warningText = guardrails?.hasWarnings
      ? `\n\nGuardrails:\n- ${(guardrails.warnings || []).join('\n- ')}\n\nExisting runs stay pinned to their original version. New starts will use this draft after publishing.`
      : '\n\nExisting runs stay pinned to their original version. New starts will use this draft after publishing.';

    if (!window.confirm(`Publish draft v${draftGraph.versionNumber} for ${detail.displayName}?${warningText}`)) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await workflowService.publishDraft(detail.workflowCode, draftGraph.workflowVersionId, {
        baseWorkflowVersionId: draftGraph.workflowVersionId,
        baseUpdatedAt: draftGraph.updatedAt,
        changeNote: publishForm.changeNote,
      });
      setMessage(result.message || 'Draft published as the active workflow version.');
      await loadDefinitions(result.definition?.workflowCode || detail.workflowCode);
    } catch (publishError) {
      setError(formatApiError(publishError, 'Failed to publish workflow draft.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscardDraft() {
    if (!detail || !draftGraph || !window.confirm(`Discard draft v${draftGraph.versionNumber} for ${detail.displayName}?`)) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await workflowService.discardDraft(detail.workflowCode, draftGraph.workflowVersionId);
      setMessage(result.message || 'Workflow draft discarded.');
      await loadDefinitions(result.definition?.workflowCode || detail.workflowCode);
    } catch (discardError) {
      setError(formatApiError(discardError, 'Failed to discard workflow draft.'));
    } finally {
      setSaving(false);
    }
  }

  const selectedDefinition = definitions.find((definition) => definition.workflowCode === selectedCode);
  const filteredDefinitions = useMemo(() => {
    const searchText = manageWorkflowFilters.q.trim().toLowerCase();

    return definitions.filter((definition) => {
      const nodeCount = getDefinitionNodeCount(definition);
      const parameterCount = getDefinitionRuntimeParameterCount(definition);

      if (manageWorkflowFilters.status && String(definition.status || 'ACTIVE').toUpperCase() !== manageWorkflowFilters.status) {
        return false;
      }

      if (manageWorkflowFilters.structure && getDefinitionStructure(definition) !== manageWorkflowFilters.structure) {
        return false;
      }

      if (manageWorkflowFilters.parameterMode === 'with' && parameterCount === 0) {
        return false;
      }

      if (manageWorkflowFilters.parameterMode === 'without' && parameterCount > 0) {
        return false;
      }

      if (manageWorkflowFilters.nodeScale === 'small' && (nodeCount < 1 || nodeCount > 5)) {
        return false;
      }

      if (manageWorkflowFilters.nodeScale === 'medium' && (nodeCount < 6 || nodeCount > 10)) {
        return false;
      }

      if (manageWorkflowFilters.nodeScale === 'large' && nodeCount < 11) {
        return false;
      }

      if (!searchText) {
        return true;
      }

      return [
        definition.displayName,
        definition.workflowCode,
        definition.description,
        definition.status,
        getDefinitionStructureLabel(definition),
      ].some((value) => String(value || '').toLowerCase().includes(searchText));
    });
  }, [definitions, manageWorkflowFilters]);
  const manageWorkflowPageCount = Math.max(1, Math.ceil(filteredDefinitions.length / MANAGE_WORKFLOW_PAGE_SIZE));
  const safeManageWorkflowPage = Math.min(manageWorkflowPage, manageWorkflowPageCount);
  const manageWorkflowPageStart = (safeManageWorkflowPage - 1) * MANAGE_WORKFLOW_PAGE_SIZE;
  const visibleDefinitions = filteredDefinitions.slice(
    manageWorkflowPageStart,
    manageWorkflowPageStart + MANAGE_WORKFLOW_PAGE_SIZE,
  );
  const manageWorkflowRangeStart = filteredDefinitions.length === 0 ? 0 : manageWorkflowPageStart + 1;
  const manageWorkflowRangeEnd = Math.min(
    manageWorkflowPageStart + MANAGE_WORKFLOW_PAGE_SIZE,
    filteredDefinitions.length,
  );
  const editing = detail?.editing || {};
  const draftGraph = detail?.draftGraph || null;
  const graphLocked = Boolean(detail && !draftGraph);
  const guardrails = detail?.guardrails || {};
  const selectedEditorNodeIndex = Number.isInteger(selectedVisualNodeIndex)
    && selectedVisualNodeIndex >= 0
    && selectedVisualNodeIndex < editorNodes.length
    ? selectedVisualNodeIndex
    : null;
  const selectedEditorNode = selectedEditorNodeIndex === null ? null : editorNodes[selectedEditorNodeIndex];
  const versionHistoryItems = detail?.versions || [];
  const versionHistoryPageCount = Math.max(1, Math.ceil(versionHistoryItems.length / VERSION_HISTORY_PAGE_SIZE));
  const safeVersionHistoryPage = Math.min(versionHistoryPage, versionHistoryPageCount);
  const versionHistoryStartIndex = (safeVersionHistoryPage - 1) * VERSION_HISTORY_PAGE_SIZE;
  const pagedVersionHistoryItems = versionHistoryItems.slice(
    versionHistoryStartIndex,
    versionHistoryStartIndex + VERSION_HISTORY_PAGE_SIZE,
  );
  const versionHistoryRangeStart = versionHistoryItems.length === 0 ? 0 : versionHistoryStartIndex + 1;
  const versionHistoryRangeEnd = Math.min(versionHistoryStartIndex + VERSION_HISTORY_PAGE_SIZE, versionHistoryItems.length);

  useEffect(() => {
    if (manageWorkflowPage > manageWorkflowPageCount) {
      setManageWorkflowPage(manageWorkflowPageCount);
    }
  }, [manageWorkflowPage, manageWorkflowPageCount]);

  useEffect(() => {
    if (filteredDefinitions.length === 0) {
      if (selectedCode) {
        setSelectedCode('');
        setDetail(null);
      }
      return;
    }

    const selectionVisible = selectedCode
      ? filteredDefinitions.some((definition) => definition.workflowCode === selectedCode)
      : false;

    if (!selectionVisible) {
      selectDefinition(filteredDefinitions[0].workflowCode);
    }
  }, [filteredDefinitions, selectedCode]);

  function goToVersionHistoryPage(page) {
    setVersionHistoryPage(Math.min(Math.max(1, Number(page) || 1), versionHistoryPageCount));
  }

  function updateManageWorkflowFilter(name, value) {
    setManageWorkflowFilters((current) => ({ ...current, [name]: value }));
    setManageWorkflowPage(1);
  }

  function clearManageWorkflowFilters() {
    setManageWorkflowFilters(DEFAULT_MANAGE_WORKFLOW_FILTERS);
    setManageWorkflowPage(1);
  }

  function goToManageWorkflowPage(page) {
    setManageWorkflowPage(Math.min(Math.max(1, Number(page) || 1), manageWorkflowPageCount));
  }

  function renderManageWorkflowPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {manageWorkflowRangeStart}-{manageWorkflowRangeEnd} of {filteredDefinitions.length} workflow definition(s)
        </div>
        <div className="sky-pagination-controls" aria-label="Manage workflows pagination">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeManageWorkflowPage <= 1}
            onClick={() => goToManageWorkflowPage(1)}
            type="button"
          >
            First
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeManageWorkflowPage <= 1}
            onClick={() => goToManageWorkflowPage(safeManageWorkflowPage - 1)}
            type="button"
          >
            Back
          </button>
          <label className="sky-pagination-select-label" htmlFor="manageWorkflowPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            id="manageWorkflowPageSelect"
            onChange={(event) => goToManageWorkflowPage(event.target.value)}
            value={safeManageWorkflowPage}
          >
            {Array.from({ length: manageWorkflowPageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
          <span className="small sky-muted">of {manageWorkflowPageCount}</span>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeManageWorkflowPage >= manageWorkflowPageCount}
            onClick={() => goToManageWorkflowPage(safeManageWorkflowPage + 1)}
            type="button"
          >
            Next
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeManageWorkflowPage >= manageWorkflowPageCount}
            onClick={() => goToManageWorkflowPage(manageWorkflowPageCount)}
            type="button"
          >
            Last
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Workflows · Manage</div>
          <h1 className="sky-page-title">Manage Workflows</h1>
          <p className="sky-page-subtitle">
            Review SkyCommand workflow definitions, update metadata, clone business workflows,
            delete old definitions, and publish graph edits through draft workflow versions.
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

      <section className="sky-card mb-4 sky-functional-history-browser sky-workflow-start-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Workflow browser</div>
            <h2 className="h5 mb-0">Workflow catalogue</h2>
            <p className="sky-muted small mb-0">
              Search and filter workflow definitions, then select a row to manage its metadata,
              graph, version history, and publishing controls below.
            </p>
          </div>
          <div className="sky-run-tools-filter-grid sky-workflow-start-filter-grid">
            <div className="sky-run-tools-search-filter">
              <label className="form-label" htmlFor="manageWorkflowSearchFilter">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="manageWorkflowSearchFilter"
                onChange={(event) => updateManageWorkflowFilter('q', event.target.value)}
                placeholder="Name, code, description..."
                type="search"
                value={manageWorkflowFilters.q}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="manageWorkflowStatusFilter">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="manageWorkflowStatusFilter"
                onChange={(event) => updateManageWorkflowFilter('status', event.target.value)}
                value={manageWorkflowFilters.status}
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="manageWorkflowStructureFilter">
                Structure
              </label>
              <select
                className="form-select sky-form-control"
                id="manageWorkflowStructureFilter"
                onChange={(event) => updateManageWorkflowFilter('structure', event.target.value)}
                value={manageWorkflowFilters.structure}
              >
                <option value="">All structures</option>
                <option value="single">Single node</option>
                <option value="sequential">Sequential</option>
                <option value="branching">Branching</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="manageWorkflowParameterFilter">
                Runtime parameters
              </label>
              <select
                className="form-select sky-form-control"
                id="manageWorkflowParameterFilter"
                onChange={(event) => updateManageWorkflowFilter('parameterMode', event.target.value)}
                value={manageWorkflowFilters.parameterMode}
              >
                <option value="">All workflows</option>
                <option value="with">With parameters</option>
                <option value="without">Without parameters</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="manageWorkflowNodeScaleFilter">
                Node count
              </label>
              <select
                className="form-select sky-form-control"
                id="manageWorkflowNodeScaleFilter"
                onChange={(event) => updateManageWorkflowFilter('nodeScale', event.target.value)}
                value={manageWorkflowFilters.nodeScale}
              >
                <option value="">Any size</option>
                <option value="small">1-5 nodes</option>
                <option value="medium">6-10 nodes</option>
                <option value="large">11+ nodes</option>
              </select>
            </div>
            <div className="sky-run-tools-filter-actions">
              <button className="btn btn-sm sky-btn-ghost" onClick={clearManageWorkflowFilters} type="button">
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card">
          <table className="table table-sm table-hover sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Code</th>
                <th>Status</th>
                <th>Structure</th>
                <th>Nodes</th>
                <th>Edges</th>
                <th>Runtime parameters</th>
                <th>Published version</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleDefinitions.length === 0 ? (
                <tr>
                  <td colSpan="9">
                    <div className="sky-empty-state">
                      No workflow definitions match the current filters.
                    </div>
                  </td>
                </tr>
              ) : (
                visibleDefinitions.map((definition) => {
                  const selected = selectedCode === definition.workflowCode;

                  return (
                    <tr
                      className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                      key={definition.workflowDefinitionId || definition.workflowCode}
                      onClick={() => selectDefinition(definition.workflowCode)}
                    >
                      <td>
                        <div className="fw-bold sky-detail-value">{definition.displayName}</div>
                        <div className="small sky-muted">
                          {definition.description || 'No workflow description.'}
                        </div>
                      </td>
                      <td className="sky-mono">{definition.workflowCode}</td>
                      <td>
                        <StatusPill status={definition.status || 'ACTIVE'} />
                      </td>
                      <td>{getDefinitionStructureLabel(definition)}</td>
                      <td>{getDefinitionNodeCount(definition)}</td>
                      <td>{getDefinitionEdgeCount(definition)}</td>
                      <td>{getDefinitionRuntimeParameterCount(definition)}</td>
                      <td>{definition.publishedVersionNumber || '—'}</td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            selectDefinition(definition.workflowCode);
                          }}
                          type="button"
                        >
                          {selected ? 'Selected' : 'Select workflow'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {renderManageWorkflowPagination()}
      </section>

      <div className="sky-workbench-main">

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
                    <div className="col-12">
                      <div className="sky-page-kicker mb-2">Workflow-level runtime params</div>
                      <RuntimeParameterSchemaEditor
                        disabled={saving || detailLoading}
                        idPrefix="workflow-manager-runtime-param"
                        onChange={(runtimeParameters) => setMetadataForm((current) => ({ ...current, runtimeParameters }))}
                        parameters={metadataForm.runtimeParameters}
                        repositoryOptions={catalog.repositoryOptions || []}
                      />
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
                    <div className="sky-page-kicker">Version guardrails</div>
                    <h2 className="h5 mb-0">Draft, validate, then publish</h2>
                  </div>
                  <StatusPill status={editing.versionStatus || 'PUBLISHED'} />
                </div>
                <div className="sky-card-body">
                  <div className="row g-3">
                    <div className="col-lg-4">
                      <div className="sky-worker-command-card h-100">
                        <div className="sky-page-kicker">Published version</div>
                        <div className="sky-worker-command-value">v{detail.publishedGraph?.versionNumber || detail.publishedVersionNumber || '—'}</div>
                        <div className="small sky-muted">New workflow starts use this version until a draft is published.</div>
                      </div>
                    </div>
                    <div className="col-lg-4">
                      <div className="sky-worker-command-card h-100">
                        <div className="sky-page-kicker">Editing version</div>
                        <div className="sky-worker-command-value">{draftGraph ? `v${draftGraph.versionNumber}` : 'Read-only'}</div>
                        <div className="small sky-muted">{draftGraph ? 'Draft edits are safe until published.' : 'Create a draft before graph edits are allowed.'}</div>
                      </div>
                    </div>
                    <div className="col-lg-4">
                      <div className="sky-worker-command-card h-100">
                        <div className="sky-page-kicker">Operational warnings</div>
                        <div className="d-flex flex-wrap gap-2 mt-1">
                          <span className="sky-pill sky-pill-info">{guardrails.activeRuns || 0} running</span>
                          <span className="sky-pill sky-pill-info">{guardrails.activeSchedules || 0} schedule(s)</span>
                          <span className="sky-pill sky-pill-info">{guardrails.pendingApprovals || 0} approval(s)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {guardrails.hasWarnings && (
                    <div className="alert alert-warning mt-3 mb-0">
                      <div className="fw-bold mb-1">Publish guardrail warning</div>
                      <ul className="mb-0">
                        {(guardrails.warnings || []).map((warning) => <li key={warning}>{warning}</li>)}
                        <li>Existing runs remain pinned to their original workflow version. New starts use the newly published version.</li>
                      </ul>
                    </div>
                  )}

                  <div className="mt-3">
                    <label className="form-label" htmlFor="publishChangeNote">Publish change note</label>
                    <textarea
                      className="form-control sky-form-control"
                      disabled={!draftGraph || saving}
                      id="publishChangeNote"
                      onChange={(event) => setPublishForm((current) => ({ ...current, changeNote: event.target.value }))}
                      placeholder="Example: Added branch around FRED failure path and increased retry attempts."
                      rows={2}
                      value={publishForm.changeNote}
                    />
                  </div>

                  <div className="d-flex flex-wrap gap-2 mt-3">
                    <button className="btn sky-btn-primary" disabled={saving || Boolean(draftGraph)} onClick={handleCreateDraft} type="button">
                      {draftGraph ? 'Draft active' : 'Create draft from published'}
                    </button>
                    <button className="btn sky-btn-ghost" disabled={saving || !draftGraph} onClick={handlePublishDraft} type="button">
                      Publish draft
                    </button>
                    <button className="btn btn-outline-danger" disabled={saving || !draftGraph} onClick={handleDiscardDraft} type="button">
                      Discard draft
                    </button>
                  </div>

                  <div className="mt-4">
                    <div className="sky-page-kicker mb-2">Version history</div>
                    <div className="table-responsive">
                      <table className="table table-sm sky-table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Version</th>
                            <th>Status</th>
                            <th>Nodes</th>
                            <th>Edges</th>
                            <th>Created</th>
                            <th>Published</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedVersionHistoryItems.map((version) => (
                            <tr key={version.workflowVersionId}>
                              <td className="sky-mono">v{version.versionNumber}</td>
                              <td><StatusPill status={version.status} /></td>
                              <td>{version.nodeCount || 0}</td>
                              <td>{version.edgeCount || 0}</td>
                              <td>{formatDateTime(version.createdAt)}</td>
                              <td>{formatDateTime(version.publishedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="sky-pagination-row px-0 pb-0">
                      <div className="small sky-muted">
                        Showing {versionHistoryRangeStart}-{versionHistoryRangeEnd} of {versionHistoryItems.length} version(s)
                      </div>
                      <div className="sky-pagination-controls" aria-label="Workflow version history pagination">
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={safeVersionHistoryPage <= 1}
                          onClick={() => goToVersionHistoryPage(1)}
                          type="button"
                        >
                          First
                        </button>
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={safeVersionHistoryPage <= 1}
                          onClick={() => goToVersionHistoryPage(safeVersionHistoryPage - 1)}
                          type="button"
                        >
                          Back
                        </button>
                        <label className="sky-pagination-select-label" htmlFor="workflowVersionHistoryPageSelect">Page</label>
                        <select
                          className="form-select form-select-sm sky-form-control sky-pagination-select"
                          id="workflowVersionHistoryPageSelect"
                          onChange={(event) => goToVersionHistoryPage(event.target.value)}
                          value={safeVersionHistoryPage}
                        >
                          {Array.from({ length: versionHistoryPageCount }, (_, index) => index + 1).map((page) => (
                            <option key={page} value={page}>{page}</option>
                          ))}
                        </select>
                        <span className="small sky-muted">of {versionHistoryPageCount}</span>
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={safeVersionHistoryPage >= versionHistoryPageCount}
                          onClick={() => goToVersionHistoryPage(safeVersionHistoryPage + 1)}
                          type="button"
                        >
                          Next
                        </button>
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={safeVersionHistoryPage >= versionHistoryPageCount}
                          onClick={() => goToVersionHistoryPage(versionHistoryPageCount)}
                          type="button"
                        >
                          Last
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="sky-card">
                <div className="sky-card-header d-flex flex-wrap justify-content-between gap-3">
                  <div>
                    <div className="sky-page-kicker">Workflow graph</div>
                    <h2 className="h5 mb-0">{graphLocked ? 'Published graph preview' : 'Edit draft sequential graph with condition gates, waits, and approvals'}</h2>
                  </div>
                  <div className="d-flex flex-wrap gap-2"><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('TOOL')} type="button">Add tool node</button><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('API_CALL')} type="button">Add API node</button><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('WORKFLOW')} type="button">Add child workflow</button><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('TEMPORAL_WORKFLOW')} type="button">Add Temporal template</button><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('CONDITION')} type="button">Add condition</button><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('WAIT')} type="button">Add wait/delay</button><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('HUMAN_APPROVAL')} type="button">Add approval</button><button className="btn btn-sm sky-btn-ghost" disabled={graphLocked || saving} onClick={() => addEditorNode('SUMMARY')} type="button">Add summary</button></div>
                </div>
                <form className="sky-card-body" onSubmit={handleSaveGraph}>
                  {graphLocked && (
                    <div className="alert alert-info">
                      Published workflow versions are read-only. Create a draft in Version Guardrails before editing nodes, retry policy, branches, waits, or approval gates.
                    </div>
                  )}
                  <WorkflowVisualGraph
                    nodes={editorNodes}
                    onNodeMove={graphLocked ? undefined : handleVisualNodeMove}
                    onNodeReorder={graphLocked ? undefined : handleVisualNodeReorder}
                    onNodeSelect={handleVisualNodeSelect}
                    selectedNodeIndex={selectedVisualNodeIndex}
                    temporalWorkflowTargets={temporalWorkflowTargets}
                    toolTargets={toolTargets}
                    workflowTargets={workflowTargets}
                  />

                  {editorNodes.length === 0 ? (
                    <div className="sky-empty-state mt-4">Add at least one node.</div>
                  ) : graphLocked ? (
                    selectedEditorNode ? (
                      <ReadOnlyNodeParameterPanel
                        index={selectedEditorNodeIndex}
                        node={selectedEditorNode}
                        onCreateDraft={handleCreateDraft}
                        saving={saving}
                        toolTargets={toolTargets}
                        workflowTargets={workflowTargets}
                        temporalWorkflowTargets={temporalWorkflowTargets}
                      />
                    ) : (
                      <div className="sky-empty-state mt-4">Select a node above to inspect its saved node-level defaults.</div>
                    )
                  ) : (
                    <>
                      {selectedEditorNode ? (
                        <div className="mt-4">
                          <EditableNodeCard
                            index={selectedEditorNodeIndex}
                            allNodes={editorNodes}
                            highlighted
                            key={`${selectedEditorNodeIndex}-${selectedEditorNode.nodeKey || selectedEditorNode.targetCode}`}
                            node={selectedEditorNode}
                            runtimeParameters={normalizeRuntimeParameterDefinitions(metadataForm.runtimeParameters)}
                            onChange={updateEditorNode}
                            onMoveDown={() => moveEditorNode(selectedEditorNodeIndex, 1, { selectMovedNode: true })}
                            onMoveUp={() => moveEditorNode(selectedEditorNodeIndex, -1, { selectMovedNode: true })}
                            onRemove={() => removeEditorNode(selectedEditorNodeIndex)}
                            toolTargets={toolTargets}
                            workflowTargets={workflowTargets}
                            temporalWorkflowTargets={temporalWorkflowTargets}
                            approvalRoleTargets={approvalRoleTargets}
                          />
                        </div>
                      ) : (
                        <div className="sky-empty-state mt-4">Select a node above to edit its node-level defaults.</div>
                      )}

                      <div className="d-flex justify-content-end mt-4">
                        <button className="btn sky-btn-primary" disabled={saving || editorNodes.length === 0} type="submit">
                          {saving ? 'Saving draft...' : 'Save draft graph'}
                        </button>
                      </div>
                    </>
                  )}
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
  );
}

export default WorkflowManager;
