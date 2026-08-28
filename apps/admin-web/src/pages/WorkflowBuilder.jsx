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
import WorkflowVisualGraph from '../components/WorkflowVisualGraph.jsx';
import WorkflowRetryPolicyEditor, {
  cleanNodeTimeoutMs,
  cleanRetryPolicyValues,
  DEFAULT_RETRY_POLICY,
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
import workflowService from '../services/workflowService';
import {
  DEFAULT_WORKFLOW_CATEGORY_CODE,
  groupWorkflowsByCategory,
  normalizeWorkflowCategories,
} from '../utils/workflowCategories.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
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
        API nodes run as Temporal activities. SkyCommand internal auth uses SKYCOMMAND_INTERNAL_API_TOKEN from the environment; do not paste secrets into headers JSON.
      </div>
    </div>
  );
}


function getBuilderNodeTypeLabel(nodeTypeCode) {
  const map = {
    API_CALL: 'API call',
    WORKFLOW: 'Child workflow',
    TEMPORAL_WORKFLOW: 'Temporal workflow',
    CONDITION: 'Condition',
    WAIT: 'Wait / delay',
    HUMAN_APPROVAL: 'Human approval',
    SUMMARY: 'Run summary',
    TOOL: 'Tool',
  };

  return map[String(nodeTypeCode || 'TOOL').toUpperCase()] || 'Tool';
}

function getBuilderNodeExpressionSummary(node, selectedTool) {
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

function WorkflowBuilderNodeCard({
  index,
  node,
  allNodes = [],
  toolTargets = [],
  workflowTargets = [],
  temporalWorkflowTargets = [],
  approvalRoleTargets = [],
  runtimeParameters = [],
  onChange,
  onMoveDown,
  onMoveUp,
  onRemove,
}) {
  const selectedTool = toolTargets.find((tool) => tool.targetCode === node.targetCode);
  const selectedWorkflow = workflowTargets.find((workflow) => workflow.targetCode === node.targetCode);
  const groupedWorkflowTargets = groupWorkflowsByCategory(workflowTargets);
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
    <div className="sky-worker-command-card">
      <div className="d-flex flex-wrap justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Node {index + 1} · {getBuilderNodeTypeLabel(nodeTypeCode)}</div>
          <div className="fw-bold">{node.displayName || selectedTool?.displayName || selectedWorkflow?.displayName || selectedTemporalWorkflow?.displayName || 'New workflow node'}</div>
          <div className="small sky-muted sky-mono">{node.nodeKey || 'node_key'} → {getBuilderNodeExpressionSummary(node, selectedTool)}</div>
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
        {nodeTypeCode === 'WORKFLOW' && (
          <div className="col-lg-8">
            <label className="form-label" htmlFor={`node-${index}-workflow`}>Child workflow target</label>
            <select
              className="form-select sky-form-control"
              id={`node-${index}-workflow`}
              onChange={(event) => handleWorkflowTargetChange(event.target.value)}
              value={node.targetCode}
            >
              <option value="">Select active workflow...</option>
              {groupedWorkflowTargets.map((group) => (
                <optgroup key={group.categoryCode} label={group.displayName}>
                  {group.items.map((workflow) => (
                    <WorkflowTargetOption key={workflow.targetCode} workflow={workflow} />
                  ))}
                </optgroup>
              ))}
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
            <label className="form-label" htmlFor={`node-${index}-temporal`}>Temporal workflow template</label>
            <select
              className="form-select sky-form-control"
              id={`node-${index}-temporal`}
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
          ) : nodeTypeCode === 'WORKFLOW' ? (
            <>
              <div className="sky-page-kicker mb-2">Child workflow behavior</div>
              <div className="sky-empty-state text-start">
                The parent workflow will start the selected SkyCommand workflow as a Temporal child execution and wait for it to complete before continuing. Child workflow inputs come from that workflow's saved node defaults.
              </div>
            </>
          ) : nodeTypeCode === 'TEMPORAL_WORKFLOW' ? (
            <>
              <div className="sky-page-kicker mb-2">Temporal template parameters</div>
              <ToolParameterEditor
                idPrefix={`node-${index}-temporal-parameter`}
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
                idPrefix={`node-${index}-wait`}
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
                idPrefix={`node-${index}-condition`}
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
                branchTargetOptions={getForwardBranchTargetOptions(allNodes, index)}
                idPrefix={`node-${index}-approval`}
                onChange={(inputParameters) => patch({ inputParameters })}
                parameters={node.inputParameters || {}}
                roleOptions={approvalRoleTargets}
              />
              <div className="form-text mt-2">
                Creates a pending approval request and waits for a Temporal signal. Rejection can stop, fail, continue, or jump to a later node.
              </div>
            </>
          ) : nodeTypeCode === 'SUMMARY' ? (
            <>
              <div className="sky-page-kicker mb-2">Run summary parameters</div>
              <SummaryParameterEditor
                idPrefix={`node-${index}-summary`}
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
                idPrefix={`node-${index}-parameter`}
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
              idPrefix={`node-${index}-retry`}
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

function WorkflowBuilder() {
  const [catalog, setCatalog] = useState({ nodeTypes: [], toolTargets: [], workflowTargets: [], temporalWorkflowTargets: [], approvalRoleTargets: [], repositoryOptions: [] });
  const [workflowCategories, setWorkflowCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createdDefinition, setCreatedDefinition] = useState(null);
  const [form, setForm] = useState({
    workflowCode: '',
    displayName: '',
    categoryCode: DEFAULT_WORKFLOW_CATEGORY_CODE,
    description: '',
    publish: true,
    runtimeParameters: [],
  });
  const [nodes, setNodes] = useState([]);
  const [selectedBuilderNodeIndex, setSelectedBuilderNodeIndex] = useState(null);

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
      .filter((workflow) => workflow.targetCode !== slugify(form.workflowCode || form.displayName))
      .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''))),
    [catalog.workflowTargets, form.workflowCode, form.displayName],
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

  const previewNodes = useMemo(
    () => nodes.map((node) => {
      if (node.nodeTypeCode === 'API_CALL') {
        return {
          displayName: node.displayName || 'Call API',
          description: node.description || node.inputParameters?.url || 'HTTP endpoint',
          code: node.inputParameters?.method ? `${node.inputParameters.method} ${node.inputParameters?.url || ''}` : 'API_CALL',
        };
      }

      if (node.nodeTypeCode === 'WORKFLOW') {
        const workflow = workflowTargets.find((item) => item.targetCode === node.targetCode);
        return {
          displayName: node.displayName || workflow?.displayName || 'Child workflow node',
          description: node.description || workflow?.description || 'Runs a child SkyCommand workflow.',
          code: node.targetCode || 'WORKFLOW',
        };
      }

      if (node.nodeTypeCode === 'TEMPORAL_WORKFLOW') {
        const template = temporalWorkflowTargets.find((item) => item.targetCode === node.targetCode);
        return {
          displayName: node.displayName || template?.displayName || 'Temporal workflow template node',
          description: node.description || template?.description || 'Runs an approved Temporal workflow template.',
          code: node.targetCode || 'TEMPORAL_WORKFLOW',
        };
      }

      if (node.nodeTypeCode === 'CONDITION') {
        return {
          displayName: node.displayName || 'Condition node',
          description: node.description || 'Evaluates a condition before continuing.',
          code: getConditionExpressionSummary(node.inputParameters),
        };
      }

      if (node.nodeTypeCode === 'WAIT') {
        return {
          displayName: node.displayName || 'Wait / delay node',
          description: node.description || 'Pauses before continuing to the next node.',
          code: formatWaitDuration(node.inputParameters),
        };
      }

      if (node.nodeTypeCode === 'HUMAN_APPROVAL') {
        return {
          displayName: node.displayName || 'Human approval node',
          description: node.description || 'Waits for an authorized approval decision before continuing.',
          code: getHumanApprovalSummary(node.inputParameters),
        };
      }

      const tool = toolTargets.find((item) => item.targetCode === node.targetCode);
      return {
        displayName: node.displayName || tool?.displayName || 'Tool node',
        description: node.description || tool?.description || 'No description.',
        code: node.targetCode || 'TOOL',
      };
    }),
    [nodes, toolTargets, workflowTargets, temporalWorkflowTargets],
  );
  const selectedBuilderNode = Number.isInteger(selectedBuilderNodeIndex)
    ? nodes[selectedBuilderNodeIndex]
    : null;

  async function loadCatalog() {
    setLoading(true);
    setError('');

    try {
      const [result, categoryResult] = await Promise.all([
        workflowService.getBuilderCatalog(),
        workflowService.listCategories(),
      ]);
      setCatalog({
        nodeTypes: result.nodeTypes || [],
        supportedNodeTypes: result.supportedNodeTypes || [],
        toolTargets: result.toolTargets || [],
        workflowTargets: result.workflowTargets || [],
        temporalWorkflowTargets: result.temporalWorkflowTargets || [],
        approvalRoleTargets: result.approvalRoleTargets || [],
        repositoryOptions: result.repositoryOptions || [],
      });
      setWorkflowCategories(normalizeWorkflowCategories(categoryResult.items || []));
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

  function buildNodeTemplate(nodeTypeCode = 'TOOL', ordinal = 1) {
    if (nodeTypeCode === 'API_CALL') {
      return {
        ...EMPTY_NODE,
        nodeTypeCode: 'API_CALL',
        nodeKey: `api_call_${ordinal}`,
        displayName: 'Call API',
        description: 'Calls a configured HTTP endpoint.',
        inputParameters: { ...DEFAULT_API_PARAMETERS },
      };
    }

    if (nodeTypeCode === 'WORKFLOW') {
      return {
        ...EMPTY_NODE,
        nodeTypeCode: 'WORKFLOW',
        nodeKey: `child_workflow_${ordinal}`,
        displayName: 'Run Child Workflow',
        description: 'Runs another active SkyCommand workflow and waits for completion.',
        inputParameters: {},
      };
    }

    if (nodeTypeCode === 'TEMPORAL_WORKFLOW') {
      return {
        ...EMPTY_NODE,
        nodeTypeCode: 'TEMPORAL_WORKFLOW',
        nodeKey: `temporal_workflow_${ordinal}`,
        displayName: 'Run Temporal Workflow Template',
        description: 'Runs an approved Temporal-native workflow template and waits for completion.',
        inputParameters: {},
      };
    }

    if (nodeTypeCode === 'CONDITION') {
      return {
        ...EMPTY_NODE,
        nodeTypeCode: 'CONDITION',
        nodeKey: `condition_${ordinal}`,
        displayName: 'Evaluate Condition',
        description: 'Evaluates a safe condition and controls whether the remaining workflow continues.',
        inputParameters: { ...DEFAULT_CONDITION_PARAMETERS },
      };
    }

    if (nodeTypeCode === 'WAIT') {
      return {
        ...EMPTY_NODE,
        nodeTypeCode: 'WAIT',
        nodeKey: `wait_${ordinal}`,
        displayName: 'Wait / Delay',
        description: 'Pauses the workflow for a configured duration before continuing.',
        inputParameters: { ...DEFAULT_WAIT_PARAMETERS },
      };
    }

    if (nodeTypeCode === 'HUMAN_APPROVAL') {
      return {
        ...EMPTY_NODE,
        nodeTypeCode: 'HUMAN_APPROVAL',
        nodeKey: `approval_${ordinal}`,
        displayName: 'Human Approval',
        description: 'Pauses the workflow until an authorized user approves or rejects the request.',
        inputParameters: { ...DEFAULT_HUMAN_APPROVAL_PARAMETERS },
      };
    }

    if (nodeTypeCode === 'SUMMARY') {
      return {
        ...EMPTY_NODE,
        nodeTypeCode: 'SUMMARY',
        nodeKey: `summary_${ordinal}`,
        displayName: 'Generate Run Summary',
        description: 'Generates a human-readable workflow run summary from params, context, outputs, errors, and timings.',
        inputParameters: { ...DEFAULT_SUMMARY_PARAMETERS },
      };
    }

    return {
      ...EMPTY_NODE,
      nodeKey: `node_${ordinal}`,
    };
  }

  function addNode(nodeTypeCode = 'TOOL') {
    const nextIndex = nodes.length;
    setNodes((current) => [...current, buildNodeTemplate(nodeTypeCode, current.length + 1)]);
    setSelectedBuilderNodeIndex(nextIndex);
  }

  function removeNode(index) {
    setNodes((current) => current.filter((_, nodeIndex) => nodeIndex !== index));
    setSelectedBuilderNodeIndex((current) => {
      if (current === null) {
        return null;
      }

      if (current === index) {
        return nodes.length > 1 ? Math.max(0, index - 1) : null;
      }

      return current > index ? current - 1 : current;
    });
  }

  function moveNode(index, direction) {
    setNodes((current) => {
      const next = [...current];
      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= next.length) {
        return current;
      }

      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      setSelectedBuilderNodeIndex(targetIndex);
      return next;
    });
  }

  function reorderNode(sourceIndex, targetIndex) {
    setNodes((current) => {
      if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= current.length || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [movedNode] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, movedNode);
      return next;
    });
    setSelectedBuilderNodeIndex(targetIndex);
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
          ...getRetryPolicyPayload(node),
          displayOrder: (index + 1) * 10,
          config: {
            builderCard: 'api',
            createdBy: 'workflow_builder_ui_v2',
          },
        };
      }

      if (nodeTypeCode === 'WORKFLOW') {
        const targetCode = String(node.targetCode || '').trim();

        if (!targetCode) {
          throw new Error(`Node ${index + 1} requires a child workflow target.`);
        }

        if (targetCode === slugify(form.workflowCode || form.displayName)) {
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
            createdBy: 'workflow_builder_ui_v3',
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
            createdBy: 'workflow_builder_ui_v4',
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
            createdBy: 'workflow_builder_ui_v5',
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
            createdBy: 'workflow_builder_ui_v6',
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
            createdBy: 'workflow_builder_ui_v7',
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
            createdBy: 'workflow_builder_ui_v8',
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

      const categoryCode = String(form.categoryCode || '').trim();
      if (!categoryCode) {
        throw new Error('Workflow category is required.');
      }

      const payload = {
        workflowCode,
        displayName,
        categoryCode,
        description: String(form.description || '').trim(),
        publish: form.publish,
        visibleInAdmin: true,
        enabled: true,
        runtimeParameters: cleanRuntimeParameterDefinitions(form.runtimeParameters),
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
            Build a sequential SkyCommand workflow from tools, API calls, child workflows, Temporal templates, condition gates, waits, and human approvals. SkyCommand owns the business graph;
            Temporal executes it durably.
          </p>
        </div>
        <button className="btn sky-btn-ghost" disabled={loading || saving} onClick={loadCatalog} type="button">
          {loading ? 'Refreshing...' : 'Refresh catalog'}
        </button>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {message && (
        <DismissibleAlert className="alert alert-success d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>{message}</span>
          {createdDefinition?.workflowCode && (
            <span className="d-flex flex-wrap gap-2">
              <Link className="btn btn-sm sky-btn-ghost" to="/workflows/start">Start workflow</Link>
              <Link className="btn btn-sm sky-btn-ghost" to="/workflows/history">Workflow history</Link>
            </span>
          )}
        </DismissibleAlert>
      )}

      <form onSubmit={handleSubmit}>
        <section className="sky-card mb-4">
          <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
            <div>
              <div className="sky-page-kicker">Definition</div>
              <h2 className="h5 mb-0">Workflow metadata</h2>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <span className="sky-pill sky-pill-info sky-mono">{slugify(form.workflowCode || form.displayName) || 'workflow-code'}</span>
              <span className={`sky-pill ${form.publish ? 'sky-pill-success' : 'sky-pill-warning'}`}>{form.publish ? 'Active on create' : 'Create inactive'}</span>
              <span className="sky-pill sky-pill-info">{nodes.length} node(s)</span>
              <span className="sky-pill sky-pill-info">{normalizeRuntimeParameterDefinitions(form.runtimeParameters).length} runtime param(s)</span>
            </div>
          </div>
          <div className="sky-card-body">
            <div className="row g-4">
              <div className="col-xl-5">
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
                  <label className="form-label" htmlFor="workflowCategory">Category</label>
                  <select
                    className="form-select sky-form-control"
                    id="workflowCategory"
                    onChange={(event) => patchForm({ categoryCode: event.target.value })}
                    required
                    value={form.categoryCode}
                  >
                    {workflowCategories.map((category) => (
                      <option key={category.workflowCategoryId || category.categoryCode} value={category.categoryCode}>
                        {category.displayName}
                      </option>
                    ))}
                  </select>
                  <div className="form-text sky-muted">Categories organize the workflow catalogue without changing executable graph semantics.</div>
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
                <button className="btn sky-btn-primary" disabled={saving || loading} type="submit">
                  {saving ? 'Creating workflow...' : 'Create workflow'}
                </button>
              </div>
              <div className="col-xl-7">
                <div className="sky-page-kicker mb-2">Workflow-level runtime params</div>
                <RuntimeParameterSchemaEditor
                  idPrefix="workflow-create-runtime-param"
                  onChange={(runtimeParameters) => patchForm({ runtimeParameters })}
                  parameters={form.runtimeParameters}
                  repositoryOptions={catalog.repositoryOptions || []}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="sky-card mb-4">
          <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
            <div>
              <div className="sky-page-kicker">Workflow graph</div>
              <h2 className="h5 mb-0">Sequential workflow map</h2>
            </div>
            <div className="d-flex flex-wrap gap-2">
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('TOOL')} type="button">Add tool node</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('API_CALL')} type="button">Add API node</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('WORKFLOW')} type="button">Add child workflow</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('TEMPORAL_WORKFLOW')} type="button">Add Temporal template</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('CONDITION')} type="button">Add condition</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('WAIT')} type="button">Add wait/delay</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('HUMAN_APPROVAL')} type="button">Add approval</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={() => addNode('SUMMARY')} type="button">Add summary</button>
                </div>
          </div>
          <div className="sky-card-body">
            <WorkflowVisualGraph
              inspectorMode="navigation"
              nodes={nodes}
              onNodeMove={(index, direction) => moveNode(index, direction)}
              onNodeReorder={reorderNode}
              onNodeSelect={(index) => setSelectedBuilderNodeIndex(index)}
              selectedNodeIndex={selectedBuilderNodeIndex}
              subtitle="Build the workflow visually, select a node to edit its defaults, and drag nodes to reorder the sequential lane before publishing."
              title="Sequential workflow map"
              toolTargets={toolTargets}
              workflowTargets={workflowTargets}
              temporalWorkflowTargets={temporalWorkflowTargets}
            />

            {nodes.length === 0 ? (
              <div className="sky-empty-state mt-4">Add at least one node.</div>
            ) : selectedBuilderNode ? (
              <div className="mt-4">
                <WorkflowBuilderNodeCard
                  allNodes={nodes}
                  approvalRoleTargets={approvalRoleTargets}
                  index={selectedBuilderNodeIndex}
                  key={`${selectedBuilderNodeIndex}-${selectedBuilderNode.nodeKey || selectedBuilderNode.targetCode || selectedBuilderNode.nodeTypeCode}`}
                  node={selectedBuilderNode}
                  runtimeParameters={normalizeRuntimeParameterDefinitions(form.runtimeParameters)}
                  onChange={updateNode}
                  onMoveDown={() => moveNode(selectedBuilderNodeIndex, 1)}
                  onMoveUp={() => moveNode(selectedBuilderNodeIndex, -1)}
                  onRemove={() => removeNode(selectedBuilderNodeIndex)}
                  temporalWorkflowTargets={temporalWorkflowTargets}
                  toolTargets={toolTargets}
                  workflowTargets={workflowTargets}
                />
              </div>
            ) : (
              <div className="sky-empty-state mt-4">Select a node above to edit its node-level defaults.</div>
            )}
          </div>
        </section>
      </form>
    </div>
  );
}

export default WorkflowBuilder;
