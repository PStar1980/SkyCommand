import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import WorkflowApprovalOverlay from '../components/WorkflowApprovalOverlay.jsx';
import WorkflowVisualGraph from '../components/WorkflowVisualGraph.jsx';
import workflowService from '../services/workflowService';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELED', label: 'Canceled' },
  { value: 'TERMINATED', label: 'Terminated' },
];

const HISTORY_PAGE_SIZE = 10;
const START_WORKFLOW_PAGE_SIZE = 10;
const HISTORY_LOAD_LIMIT = 200;
const HISTORY_POLL_IDLE_MS = 8000;
const HISTORY_POLL_ACTIVE_MS = 2000;
const HISTORY_POLL_SELECTED_ACTIVE_MS = 1500;
const HISTORY_POLL_HIDDEN_MS = 30000;
const APPROVAL_RESUME_POLL_MS = 500;
const APPROVAL_RESUME_FAST_WINDOW_MS = 12000;

const RUNTIME_FILTER_OPTIONS = [
  { value: 'skycommand', label: 'SkyCommand ledger' },
  { value: 'temporal', label: 'Temporal-backed only' },
  { value: 'inline', label: 'Inline/local only' },
];

const DEFAULT_START_WORKFLOW_FILTERS = {
  q: '',
  structure: '',
  parameterMode: '',
  nodeScale: '',
};

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getSafeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function normalizeRuntimeParameterOptions(options = []) {
  return getSafeArray(options)
    .map((option) => {
      if (option && typeof option === 'object') {
        const value = option.value ?? option.optionValue ?? option.key ?? option.id ?? '';
        const label = option.label ?? option.displayName ?? option.name ?? value;

        return { value: String(value), label: String(label || value) };
      }

      return { value: String(option), label: String(option) };
    })
    .filter((option) => option.value !== '');
}

function normalizeRuntimeParameterDefinitions(definition = {}) {
  const config = getSafeObject(definition.config);
  const parameterSchema = getSafeObject(config.parameterSchema);
  const rawParameters = getSafeArray(
    definition.runtimeParameters ||
      config.runtimeParameters ||
      parameterSchema.runtimeParameters ||
      parameterSchema.parameters,
  );

  return rawParameters
    .map((parameter, index) => {
      const raw = getSafeObject(parameter);
      const key = String(
        raw.key || raw.parameterName || raw.name || raw.paramName || `param_${index + 1}`,
      )
        .trim()
        .replace(/[^A-Za-z0-9_.:-]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const requestedType = String(raw.type || raw.paramTypeCode || raw.parameterType || 'string')
        .trim()
        .toLowerCase();
      const type = requestedType === 'repository' ? 'repo' : requestedType;
      const normalizedType = ['string', 'number', 'boolean', 'select', 'date', 'json', 'repo'].includes(
        type,
      )
        ? type
        : 'string';

      return {
        key,
        parameterName: key,
        label: raw.label || raw.displayName || key,
        type: normalizedType,
        paramTypeCode: normalizedType,
        required: raw.required === true || raw.required === 'true',
        defaultValue: raw.defaultValue ?? raw.default ?? '',
        description: raw.description || raw.prompt || '',
        prompt: raw.prompt || raw.description || '',
        options: normalizeRuntimeParameterOptions(raw.options || raw.allowedValues || raw.values),
        optionSourceCode: raw.optionSourceCode || (normalizedType === 'repo' ? 'repositories' : null),
        maxLength: Number.isFinite(Number(raw.maxLength)) ? Number(raw.maxLength) : null,
        displayOrder: Number.isFinite(Number(raw.displayOrder))
          ? Number(raw.displayOrder)
          : index * 10 + 10,
      };
    })
    .filter((parameter) => parameter.key)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || a.key.localeCompare(b.key));
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
  return normalizeRuntimeParameterDefinitions(definition).length;
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

function getInitialRuntimeParameterValues(parameters = []) {
  return parameters.reduce((accumulator, parameter) => {
    if (parameter.type === 'boolean') {
      accumulator[parameter.key] =
        parameter.defaultValue === true || parameter.defaultValue === 'true';
    } else if (parameter.type === 'json') {
      accumulator[parameter.key] =
        parameter.defaultValue && typeof parameter.defaultValue === 'object'
          ? JSON.stringify(parameter.defaultValue, null, 2)
          : String(parameter.defaultValue || '');
    } else {
      accumulator[parameter.key] = parameter.defaultValue ?? '';
    }

    return accumulator;
  }, {});
}

function getClearedRuntimeParameterValues(parameters = []) {
  return parameters.reduce((accumulator, parameter) => {
    accumulator[parameter.key] = parameter.type === 'boolean' ? false : '';
    return accumulator;
  }, {});
}

function parseRuntimeParameterValues(parameters = [], values = {}) {
  return parameters.reduce((accumulator, parameter) => {
    const rawValue = values[parameter.key];
    const empty = rawValue === undefined || rawValue === null || rawValue === '';

    if (parameter.required && empty) {
      throw new Error(`${parameter.label || parameter.key} is required.`);
    }

    if (empty) {
      if (parameter.type === 'boolean') {
        accumulator[parameter.key] = false;
      }
      return accumulator;
    }

    if (parameter.type === 'number') {
      const numericValue = Number(rawValue);

      if (!Number.isFinite(numericValue)) {
        throw new Error(`${parameter.label || parameter.key} must be a number.`);
      }

      accumulator[parameter.key] = numericValue;
      return accumulator;
    }

    if (parameter.type === 'boolean') {
      accumulator[parameter.key] = Boolean(rawValue);
      return accumulator;
    }

    if (parameter.type === 'json') {
      try {
        accumulator[parameter.key] =
          typeof rawValue === 'object' ? rawValue : JSON.parse(String(rawValue));
      } catch (error) {
        throw new Error(`${parameter.label || parameter.key} must be valid JSON.`);
      }
      return accumulator;
    }

    const stringValue = String(rawValue);

    if (parameter.maxLength && stringValue.length > parameter.maxLength) {
      throw new Error(
        `${parameter.label || parameter.key} must be ${parameter.maxLength} characters or less.`,
      );
    }

    accumulator[parameter.key] = stringValue;
    return accumulator;
  }, {});
}

function getRuntimeParameterOptions(parameter = {}, repositoryOptions = []) {
  if (parameter.type === 'repo' || parameter.optionSourceCode === 'repositories') {
    return Array.isArray(repositoryOptions) ? repositoryOptions : [];
  }

  return Array.isArray(parameter.options) ? parameter.options : [];
}

function normalizeRuntimeFilter(value) {
  const normalized = String(value || '').toLowerCase();

  if (normalized === 'temporal' || normalized === 'inline') {
    return normalized;
  }

  return 'skycommand';
}

function runMatchesRuntimeFilter(run, runtimeFilter) {
  if (runtimeFilter === 'temporal') {
    return Boolean(run?.temporalWorkflowId || run?.temporalRunId || run?.temporalRuntime);
  }

  if (runtimeFilter === 'inline') {
    return !run?.temporalWorkflowId && !run?.temporalRunId && !run?.temporalRuntime;
  }

  return true;
}

function runMatchesHistorySearch(run, searchText = '') {
  const normalizedSearch = String(searchText || '').trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    run?.workflowDisplayName,
    run?.workflowCode,
    run?.status,
    run?.summary,
    run?.triggerType,
    run?.runSource,
    run?.temporalWorkflowId,
    run?.temporalRunId,
    run?.workflowRunRecordId,
  ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDuration(ms) {
  const value = Number(ms);

  if (!Number.isFinite(value)) {
    return '—';
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

const DUPLICATE_NODE_OUTPUT_FIELDS = new Set([
  'kind',
  'status',
  'summary',
  'message',
  'toolcode',
  'targetcode',
  'nodetypecode',
  'nodekey',
  'attemptcount',
  'durationms',
  'startedat',
  'completedat',
  'createdat',
  'updatedat',
  'exitcode',
  'contextupdates',
  'saveoutputas',
  'schemaversion',
  'success',
  'outputtype',
]);

const DUPLICATE_NODE_CONTEXT_SUFFIXES = new Set([
  'attemptcount',
  'completedat',
  'durationms',
  'nodekey',
  'nodetypecode',
  'output',
  'startedat',
  'status',
  'summary',
  'targetcode',
  'result',
  'warnings',
  'error',
  'metadata',
]);

function humanizeOutputKey(value) {
  const label = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!label) {
    return 'Value';
  }

  return label
    .split(' ')
    .map((word) => {
      const normalized = word.toLowerCase();
      const acronym = {
        api: 'API',
        http: 'HTTP',
        https: 'HTTPS',
        id: 'ID',
        ids: 'IDs',
        json: 'JSON',
        ms: 'ms',
        url: 'URL',
        ui: 'UI',
        stdout: 'Standard output',
        stderr: 'Error output',
      }[normalized];

      return acronym || `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');
}

function parseFriendlyOutputValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const text = value.trim();

  if (
    !text ||
    !((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))
  ) {
    return value;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return value;
  }
}

function isIsoDateValue(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function formatByteCount(value) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes)) {
    return String(value ?? '—');
  }

  if (bytes < 1024) {
    return `${bytes.toLocaleString()} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = bytes / 1024;
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function FriendlyOutputScalar({ fieldKey = '', value }) {
  const normalizedKey = String(fieldKey || '').toLowerCase();

  if (value === null || value === undefined || value === '') {
    return <span className="sky-muted">—</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={`sky-pill ${value ? 'sky-pill-success' : 'sky-pill-info'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    );
  }

  if (typeof value === 'number') {
    if (normalizedKey.endsWith('ms') || normalizedKey.includes('duration')) {
      return <span>{formatDuration(value)}</span>;
    }

    if (normalizedKey.includes('byte')) {
      return <span>{formatByteCount(value)}</span>;
    }

    return <span>{value.toLocaleString()}</span>;
  }

  const text = String(value);

  if (isIsoDateValue(text) || normalizedKey.endsWith('at') || normalizedKey.includes('timestamp')) {
    const formatted = formatDate(text);

    if (formatted !== '—') {
      return <span>{formatted}</span>;
    }
  }

  if (normalizedKey === 'status' || normalizedKey.endsWith('status')) {
    return <span className={`sky-pill ${statusClass(text)}`}>{text}</span>;
  }

  if (/^https?:\/\//i.test(text)) {
    return (
      <a href={text} rel="noreferrer" target="_blank">
        {text}
      </a>
    );
  }

  if (text.includes('\n') || text.length > 180) {
    return <pre className="sky-node-output-readable-text mb-0">{text}</pre>;
  }

  const mono =
    normalizedKey.endsWith('id') ||
    normalizedKey.endsWith('key') ||
    normalizedKey.endsWith('code') ||
    normalizedKey.includes('hash') ||
    normalizedKey.includes('path');

  return <span className={mono ? 'sky-mono' : undefined}>{text}</span>;
}

function appendUniqueOutputRows(rows, value, { source = 'Result', path = [] } = {}) {
  const parsedValue = parseFriendlyOutputValue(value);

  if (parsedValue === null || parsedValue === undefined || parsedValue === '') {
    return;
  }

  if (Array.isArray(parsedValue)) {
    parsedValue.forEach((item, index) => {
      appendUniqueOutputRows(rows, item, {
        source,
        path: [...path, `Item ${index + 1}`],
      });
    });
    return;
  }

  if (typeof parsedValue === 'object') {
    Object.entries(parsedValue).forEach(([key, nestedValue]) => {
      const normalizedKey = String(key).toLowerCase();

      if (path.length === 0 && DUPLICATE_NODE_OUTPUT_FIELDS.has(normalizedKey)) {
        return;
      }

      const nextPath = path.length === 0 && normalizedKey === 'output' ? path : [...path, key];

      appendUniqueOutputRows(rows, nestedValue, {
        source,
        path: nextPath,
      });
    });
    return;
  }

  const leafKey = String(path[path.length - 1] || 'value');
  const normalizedLeafKey = leafKey.toLowerCase();

  if (normalizedLeafKey === 'stdoutpreview' || normalizedLeafKey === 'stderrpreview') {
    return;
  }

  rows.push({
    source,
    field: path.length > 0 ? path.map(humanizeOutputKey).join(' › ') : 'Value',
    fieldKey: leafKey,
    value: parsedValue,
  });
}

function isDuplicateNodeContextValue(item, nodeKey) {
  const contextKey = String(item?.contextKey || '').trim();
  const normalizedContextKey = contextKey.toLowerCase();
  const normalizedNodeKey = String(nodeKey || '')
    .trim()
    .toLowerCase();

  if (normalizedContextKey.startsWith('last.')) {
    return true;
  }

  const nodePrefix = normalizedNodeKey ? `nodes.${normalizedNodeKey}.` : '';

  if (!nodePrefix || !normalizedContextKey.startsWith(nodePrefix)) {
    return false;
  }

  return DUPLICATE_NODE_CONTEXT_SUFFIXES.has(normalizedContextKey.slice(nodePrefix.length));
}

function getContextDisplayPath(contextKey, nodeKey) {
  const normalizedNodePrefix = `nodes.${String(nodeKey || '').trim()}.`;
  const value = String(contextKey || 'context value');

  return value.startsWith(normalizedNodePrefix) ? value.slice(normalizedNodePrefix.length) : value;
}

function isStructuredToolResult(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.schemaVersion === 'string' &&
    typeof value.outputType === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'output')
  );
}

function getFocusedToolResult(outputs = [], nodeKey = '') {
  return (
    outputs
      .filter((output) => output.nodeKey === nodeKey)
      .map((output) => parseFriendlyOutputValue(output.output))
      .find(isStructuredToolResult) || null
  );
}

function getFocusedWorkflowSummaryResult(outputs = [], nodeKey = '') {
  for (const record of outputs.filter((output) => output.nodeKey === nodeKey)) {
    const output = parseFriendlyOutputValue(record.output);

    if (output?.kind === 'workflow_run_summary') {
      return output;
    }

    if (output?.output?.kind === 'workflow_run_summary') {
      return output.output;
    }
  }

  return null;
}

function getFocusedHumanApprovalResult(outputs = [], nodeKey = '') {
  for (const record of outputs.filter((output) => output.nodeKey === nodeKey)) {
    const output = parseFriendlyOutputValue(record.output);

    if (output?.kind === 'human_approval') {
      return output;
    }

    if (output?.output?.kind === 'human_approval') {
      return output.output;
    }
  }

  return null;
}

function getFocusedConditionResult(outputs = [], nodeKey = '') {
  for (const record of outputs.filter((output) => output.nodeKey === nodeKey)) {
    const output = parseFriendlyOutputValue(record.output);

    if (output?.kind === 'condition_evaluation') {
      return output;
    }

    if (output?.output?.kind === 'condition_evaluation') {
      return output.output;
    }
  }

  return null;
}

function macroOutcomeClass(outcome) {
  const normalized = String(outcome || '').toUpperCase();

  if (normalized === 'UPDATED') {
    return 'sky-pill-success';
  }

  if (normalized === 'FAILED') {
    return 'sky-pill-danger';
  }

  if (normalized === 'PARTIAL') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function operationOutcomeClass(outcome) {
  const normalized = String(outcome || '').toUpperCase();

  if (['FAILED', 'REJECTED', 'TIMED_OUT'].includes(normalized)) {
    return 'sky-pill-danger';
  }

  if (['PARTIAL', 'WARNING', 'STOPPED', 'BLOCKED', 'DIFFERENT', 'REMOTE_PROMOTED'].includes(normalized)) {
    return 'sky-pill-warning';
  }

  if (
    [
      'SUCCESS',
      'COMPLETED',
      'CREATED',
      'PUSHED',
      'APPROVED',
      'PROMOTED',
      'SYNCHRONIZED',
      'TAGGED',
      'READY',
      'MATCH',
      'BUILT',
      'ONLINE',
      'PASSED',
    ].includes(normalized)
  ) {
    return 'sky-pill-success';
  }

  return 'sky-pill-info';
}

function buildFocusedNodeOutputRows({ outputs = [], contextValues = [], node = null } = {}) {
  if (!node?.nodeKey) {
    return [];
  }

  const rows = [];
  const selectedOutputs = outputs.filter((output) => output.nodeKey === node.nodeKey);
  const selectedContextValues = contextValues.filter((item) => item.sourceNodeKey === node.nodeKey);
  const summaryNode = String(node.nodeTypeCode || '').toUpperCase() === 'SUMMARY';

  selectedOutputs.forEach((output) => {
    const outputValue = parseFriendlyOutputValue(output.output);

    if (summaryNode && outputValue && typeof outputValue === 'object') {
      const keyOutputs = outputValue.keyOutputs || outputValue.output?.keyOutputs;

      if (keyOutputs && typeof keyOutputs === 'object') {
        appendUniqueOutputRows(rows, keyOutputs, { source: 'Key outputs' });
      }
      return;
    }

    if (isStructuredToolResult(outputValue)) {
      appendUniqueOutputRows(rows, outputValue.output, {
        source: humanizeOutputKey(outputValue.outputType || 'Structured output'),
      });

      if (outputValue.error) {
        appendUniqueOutputRows(rows, outputValue.error, { source: 'Error' });
      }

      return;
    }

    appendUniqueOutputRows(rows, outputValue, {
      source: humanizeOutputKey(output.outputKey || 'result'),
    });
  });

  if (!summaryNode) {
    const persistedOutputValues = new Set();

    selectedOutputs.forEach((output) => {
      const outputValue = parseFriendlyOutputValue(output.output);

      try {
        persistedOutputValues.add(JSON.stringify(outputValue));
        if (outputValue?.output && typeof outputValue.output === 'object') {
          persistedOutputValues.add(JSON.stringify(outputValue.output));
        }
      } catch (error) {
        // Non-serializable values still render from the persisted output record.
      }
    });

    selectedContextValues
      .filter((item) => !isDuplicateNodeContextValue(item, node.nodeKey))
      .filter((item) => {
        try {
          return !persistedOutputValues.has(JSON.stringify(parseFriendlyOutputValue(item.value)));
        } catch (error) {
          return true;
        }
      })
      .forEach((item) => {
        appendUniqueOutputRows(rows, item.value, {
          source: 'Context',
          path: [getContextDisplayPath(item.contextKey, node.nodeKey)],
        });
      });
  }

  const seen = new Set();

  return rows.filter((row) => {
    const signature = JSON.stringify([row.field, row.value]);

    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}

function getWorkflowHistoryPollingDelay({
  activeRunCount = 0,
  hidden = false,
  selectedRunActive = false,
} = {}) {
  if (hidden) {
    return HISTORY_POLL_HIDDEN_MS;
  }

  if (selectedRunActive) {
    return HISTORY_POLL_SELECTED_ACTIVE_MS;
  }

  if (activeRunCount > 0) {
    return HISTORY_POLL_ACTIVE_MS;
  }

  return HISTORY_POLL_IDLE_MS;
}

function getDateDiffMs(start, end) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;

  if (
    !startDate ||
    !endDate ||
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return null;
  }

  return Math.max(0, endDate.getTime() - startDate.getTime());
}

function getRunDurationMs(run) {
  return (
    run?.metadata?.durationMs || getDateDiffMs(run?.startedAt || run?.createdAt, run?.completedAt)
  );
}

function getNodeRunDurationMs(nodeRun) {
  return (
    nodeRun?.metadata?.durationMs ||
    getDateDiffMs(nodeRun?.startedAt || nodeRun?.createdAt, nodeRun?.completedAt)
  );
}

function getTemporalRuntime(runDetail) {
  return runDetail?.temporalRuntime || runDetail?.run?.temporalRuntime || null;
}

function getRunRelationLabel(run) {
  if (!run) {
    return null;
  }

  if (
    run.parentWorkflowRunRecordId ||
    run.triggerType === 'CHILD_WORKFLOW' ||
    run.runSource === 'child_workflow'
  ) {
    return 'CHILD';
  }

  return null;
}

function getChildRunIdFromNodeRun(nodeRun) {
  return (
    nodeRun?.output?.childWorkflowRunRecordId ||
    nodeRun?.output?.workflowRunRecordId ||
    nodeRun?.metadata?.childWorkflowRunRecordId ||
    null
  );
}

function flattenRunTree(tree, output = []) {
  if (!tree?.run) {
    return output;
  }

  output.push(tree.run);

  for (const child of tree.children || []) {
    flattenRunTree(child, output);
  }

  return output;
}

function statusClass(status) {
  const normalized = String(status || '').toUpperCase();

  if (normalized === 'COMPLETED' || normalized === 'SUCCESS' || normalized === 'APPROVED') {
    return 'sky-pill-success';
  }

  if (
    normalized === 'FAILED' ||
    normalized === 'TERMINATED' ||
    normalized === 'REJECTED' ||
    normalized === 'TIMED_OUT'
  ) {
    return 'sky-pill-danger';
  }

  if (
    normalized === 'RUNNING' ||
    normalized === 'QUEUED' ||
    normalized === 'PENDING' ||
    normalized === 'PENDING_APPROVAL'
  ) {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function SmartRunStatusBadges({ run }) {
  if (!run) {
    return null;
  }

  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <span className={`sky-pill ${statusClass(run.status)}`}>Run {run.status || 'UNKNOWN'}</span>
      <span className="sky-pill sky-pill-info">{formatDuration(getRunDurationMs(run))}</span>
    </div>
  );
}

function eventCategoryClass(category) {
  const normalized = String(category || '').toLowerCase();

  if (normalized === 'success') {
    return 'sky-pill-success';
  }

  if (normalized === 'danger') {
    return 'sky-pill-danger';
  }

  if (normalized === 'warning') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function jsonPreview(value) {
  if (!value) {
    return '{}';
  }

  return JSON.stringify(value, null, 2);
}

function shortenIdentifier(value, head = 18, tail = 10) {
  const text = String(value || '');

  if (!text || text.length <= head + tail + 3) {
    return text || '—';
  }

  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function TemporalCopyButton({ label = 'Copy', value }) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return null;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      setCopied(false);
      window.prompt('Copy value:', String(value));
    }
  }

  return (
    <button className="btn btn-sm sky-btn-ghost" onClick={handleCopy} type="button">
      {copied ? 'Copied' : label}
    </button>
  );
}

function TemporalIdentifierCard({ href, label, value }) {
  return (
    <div className="sky-temporal-id-card">
      <div className="sky-page-kicker">{label}</div>
      <div className="sky-mono sky-temporal-id-value" title={value || ''}>
        {shortenIdentifier(value)}
      </div>
      <div className="d-flex flex-wrap gap-2 mt-2">
        <TemporalCopyButton label="Copy" value={value} />
        {href && (
          <a className="btn btn-sm sky-btn-ghost" href={href} rel="noreferrer" target="_blank">
            Open
          </a>
        )}
      </div>
    </div>
  );
}

function TemporalCliCommands({ commands = {} }) {
  const entries = [
    ['Describe', commands.describe],
    ['Show history', commands.showHistory],
    ['Cancel', commands.cancel],
    ['Terminate', commands.terminate],
  ].filter(([, value]) => value);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="sky-temporal-command-grid mb-3">
      {entries.map(([label, command]) => (
        <div className="sky-temporal-command-card" key={label}>
          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">{label}</div>
            <TemporalCopyButton label="Copy command" value={command} />
          </div>
          <code className="sky-mono sky-temporal-command-text">{command}</code>
        </div>
      ))}
    </div>
  );
}

function TemporalEventTable({
  emptyText = 'No Temporal event preview available.',
  events = [],
  title,
}) {
  if (!events || events.length === 0) {
    return title ? (
      <div className="mb-3">
        <div className="sky-page-kicker mb-2">{title}</div>
        <div className="sky-empty-state">{emptyText}</div>
      </div>
    ) : (
      <div className="sky-empty-state">{emptyText}</div>
    );
  }

  return (
    <div className="mb-3">
      {title && <div className="sky-page-kicker mb-2">{title}</div>}
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Event</th>
              <th>Type</th>
              <th>Time</th>
              <th>Summary</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={`${event.eventId}-${event.eventType}-${event.eventTime}`}>
                <td className="sky-mono">{event.eventId || '—'}</td>
                <td>
                  <span className={`sky-pill ${eventCategoryClass(event.category)}`}>
                    {event.eventType}
                  </span>
                </td>
                <td>{formatDate(event.eventTime)}</td>
                <td>
                  <div>{event.summary}</div>
                  {event.failureMessage && (
                    <div className="small text-danger-emphasis mt-1">{event.failureMessage}</div>
                  )}
                  {event.retryState && (
                    <div className="small sky-muted mt-1">Retry state: {event.retryState}</div>
                  )}
                </td>
                <td className="sky-mono small text-break">
                  {event.target || event.identity || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatApiError(error, fallback = 'Request failed.') {
  const missingPermissions = error?.details?.missingPermissions;
  const permissionCode = error?.details?.permissionCode;

  if (Array.isArray(missingPermissions) && missingPermissions.length > 0) {
    return `${error.message || fallback} Missing permission(s): ${missingPermissions.join(', ')}.`;
  }

  if (permissionCode) {
    return `${error.message || fallback} Required permission: ${permissionCode}.`;
  }

  return error?.message || fallback;
}

function isActiveRun(run) {
  const status = String(run?.status || '').toUpperCase();
  return status === 'RUNNING' || status === 'QUEUED';
}

function getLastExecutedVisualNodeIndex(nodes = [], nodeRuns = []) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const matchingRun = nodeRuns.find(
      (nodeRun) =>
        (nodeRun.nodeKey && nodeRun.nodeKey === node.nodeKey) ||
        (node.workflowNodeId && nodeRun.workflowNodeId === node.workflowNodeId),
    );

    if (matchingRun) {
      return index;
    }
  }

  return nodeRuns.length > 0 && nodes.length > 0
    ? Math.min(nodeRuns.length - 1, nodes.length - 1)
    : -1;
}

function isRetryableRun(run) {
  return ['FAILED', 'CANCELED', 'TERMINATED'].includes(String(run?.status || '').toUpperCase());
}

function WorkflowRunControls({
  busyAction,
  canCancel,
  canTerminate,
  canRetry,
  onCancel,
  onRetry,
  onTerminate,
  run,
}) {
  if (!run) {
    return null;
  }

  const active = isActiveRun(run);
  const retryable = isRetryableRun(run);
  const busy = Boolean(busyAction);
  const showControls = active || retryable;

  if (!showControls) {
    return null;
  }

  return (
    <div className="sky-worker-command-card mb-3">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Run controls</div>
          <div className="fw-bold">Run operation</div>
          <p className="small sky-muted mb-0">
            Cancel requests a graceful stop, terminate force-closes the Temporal execution, and
            retry starts a fresh run from the same workflow input.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {active && (
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={!canCancel || busy}
              onClick={onCancel}
              type="button"
            >
              {busyAction === 'cancel' ? 'Canceling...' : 'Cancel run'}
            </button>
          )}
          {active && (
            <button
              className="btn btn-sm btn-outline-danger"
              disabled={!canTerminate || busy}
              onClick={onTerminate}
              type="button"
            >
              {busyAction === 'terminate' ? 'Terminating...' : 'Terminate'}
            </button>
          )}
          {retryable && (
            <button
              className="btn btn-sm sky-btn-primary"
              disabled={!canRetry || busy}
              onClick={onRetry}
              type="button"
            >
              {busyAction === 'retry' ? 'Starting retry...' : 'Retry run'}
            </button>
          )}
        </div>
      </div>
      {((active && (!canCancel || !canTerminate)) || (retryable && !canRetry)) && (
        <div className="small sky-muted mt-2">
          Additional workflow or Temporal permissions may be required for unavailable actions.
        </div>
      )}
    </div>
  );
}

function WorkflowDefinitionCard({ definition, selected, onSelect }) {
  return (
    <button
      className={`sky-tool-card text-start w-100 ${selected ? 'active' : ''}`}
      onClick={() => onSelect(definition)}
      type="button"
    >
      <div className="d-flex justify-content-between align-items-start gap-2">
        <div>
          <div className="fw-bold">{definition.displayName}</div>
          <div className="small sky-mono sky-muted">{definition.workflowCode}</div>
        </div>
        <span className={`sky-pill ${statusClass(definition.status)}`}>{definition.status}</span>
      </div>
      <p className="small sky-muted mb-2 mt-2">{definition.description || 'No description.'}</p>
      <div className="d-flex flex-wrap gap-2">
        <span className="sky-pill sky-pill-info">{definition.publishedNodeCount || 0} node(s)</span>
        <span className="sky-pill sky-pill-info">{definition.publishedEdgeCount || 0} edge(s)</span>
      </div>
    </button>
  );
}

function getNodeOutputSummary(output = {}) {
  if (output.kind === 'workflow_run_summary') {
    return output.summary || output.message || output.title || 'Workflow summary generated.';
  }

  if (output.summary) {
    return output.summary;
  }

  if (output.kind === 'condition_evaluation') {
    return `Condition ${output.passed ? 'passed' : 'did not pass'}; ${output.onFalse || 'STOP_SUCCESS'}.`;
  }

  if (output.kind === 'temporal_workflow_execution') {
    return (
      output.summary ||
      `Temporal workflow template ${output.workflowDisplayName || output.workflowCode || ''} completed.`.trim()
    );
  }

  if (output.kind === 'temporal_workflow_start') {
    return `Started Temporal workflow ${output.workflowId || output.workflowCode || ''}`.trim();
  }

  if (output.kind === 'api_call') {
    return (
      output.summary ||
      `API ${output.method || ''} ${output.url || ''} returned ${output.statusCode || 'unknown status'}`.trim()
    );
  }

  if (output.kind === 'wait_delay') {
    return (
      output.summary || `Waited ${output.requestedDurationMs || output.actualDurationMs || 0} ms.`
    );
  }

  if (output.kind === 'human_approval') {
    return output.summary || `Human approval ${output.status || output.decision || 'completed'}.`;
  }

  if (output.kind === 'child_workflow_execution') {
    return `Child workflow ${output.workflowDisplayName || output.workflowCode || ''} completed successfully.`.trim();
  }

  if (output.kind === 'child_workflow_start') {
    return `Started child SkyCommand workflow ${output.workflowDisplayName || output.workflowCode || ''}.`.trim();
  }

  if (output.kind === 'tool_execution') {
    return `${output.toolCode || 'Tool'} finished with ${output.status || 'UNKNOWN'}`;
  }

  return '';
}

function WorkflowNodesTimeline({ nodes = [], nodeRuns = [], approvals = [], onOpenRun }) {
  const runsByNodeKey = new Map(nodeRuns.map((nodeRun) => [nodeRun.nodeKey, nodeRun]));
  const approvalsByNodeRunId = new Map(
    approvals.map((approval) => [approval.workflowNodeRunRecordId, approval]),
  );
  const approvalsByNodeKey = new Map(approvals.map((approval) => [approval.nodeKey, approval]));

  return (
    <div className="d-flex flex-column gap-2">
      {nodes.map((node, index) => {
        const nodeKey = node.nodeKey;
        const nodeRun = runsByNodeKey.get(nodeKey) || (node.status ? node : null);
        const nodeTypeCode = node.nodeTypeCode || nodeRun?.nodeTypeCode || 'NODE';
        const targetCode = node.targetCode || nodeRun?.targetCode || 'No target';
        const displayName = node.displayName || nodeKey || 'Workflow node';
        const description =
          node.description || getNodeOutputSummary(nodeRun?.output) || 'No description';
        const durationMs = getNodeRunDurationMs(nodeRun);
        const outputSummary = getNodeOutputSummary(nodeRun?.output);
        const approval = nodeRun
          ? approvalsByNodeRunId.get(nodeRun.workflowNodeRunRecordId) ||
            approvalsByNodeKey.get(nodeRun.nodeKey)
          : approvalsByNodeKey.get(nodeKey);

        return (
          <div
            className="sky-worker-command-card"
            key={node.workflowNodeId || node.workflowNodeRunRecordId || nodeKey}
          >
            <div className="d-flex justify-content-between gap-3">
              <div>
                <div className="sky-page-kicker">
                  Node {index + 1} · {nodeTypeCode}
                </div>
                <div className="fw-bold">{displayName}</div>
                <div className="small sky-muted">
                  {targetCode} · {description}
                </div>
              </div>
              <span className={`sky-pill ${statusClass(nodeRun?.status || 'QUEUED')}`}>
                {nodeRun?.status || 'READY'}
              </span>
            </div>

            {nodeRun && (
              <div className="d-flex flex-wrap gap-2 mt-3 small">
                <span className="sky-pill sky-pill-info">Attempts {nodeRun.attemptCount ?? 0}</span>
                <span className="sky-pill sky-pill-info">
                  Started {formatDate(nodeRun.startedAt || nodeRun.createdAt)}
                </span>
                <span className="sky-pill sky-pill-info">
                  Duration {formatDuration(durationMs)}
                </span>
                {nodeRun.metadata?.temporalBacked && (
                  <span className="sky-pill sky-pill-success">Temporal activity</span>
                )}
              </div>
            )}

            {outputSummary && <div className="small sky-muted mt-2">{outputSummary}</div>}
            {approval && (
              <div className="alert alert-secondary mt-3 mb-0 py-2">
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <span className={`sky-pill ${statusClass(approval.status)}`}>
                    {approval.status}
                  </span>
                  <span className="fw-semibold">{approval.approvalTitle}</span>
                  <span className="small sky-muted">
                    Requested {formatDate(approval.requestedAt)}
                  </span>
                  {approval.decidedAt && (
                    <span className="small sky-muted">
                      Decided {formatDate(approval.decidedAt)}
                    </span>
                  )}
                </div>
                {approval.decisionNote && (
                  <div className="small mt-1">Decision note: {approval.decisionNote}</div>
                )}
              </div>
            )}
            {nodeRun?.output?.executionId && (
              <div className="small sky-muted mt-1">
                Execution <span className="sky-mono">{nodeRun.output.executionId}</span>
              </div>
            )}
            {getChildRunIdFromNodeRun(nodeRun) && (
              <div className="small sky-muted mt-2 d-flex flex-wrap align-items-center gap-2">
                <span>
                  Child run <span className="sky-mono">{getChildRunIdFromNodeRun(nodeRun)}</span>
                </span>
                {onOpenRun && (
                  <button
                    className="btn btn-sm sky-btn-ghost"
                    onClick={() => onOpenRun(getChildRunIdFromNodeRun(nodeRun))}
                    type="button"
                  >
                    Open child run
                  </button>
                )}
              </div>
            )}
            {nodeRun?.output?.workflowDisplayName &&
              nodeRun?.output?.kind === 'child_workflow_execution' && (
                <div className="small sky-muted mt-1">
                  Child workflow{' '}
                  <span className="fw-semibold">{nodeRun.output.workflowDisplayName}</span>
                </div>
              )}
            {nodeRun?.output?.temporalWorkflowId && (
              <div className="small sky-muted mt-1">
                Child Temporal workflow{' '}
                <span className="sky-mono">{nodeRun.output.temporalWorkflowId}</span>
              </div>
            )}
            {nodeRun?.errorMessage && (
              <div className="alert alert-danger mt-2 mb-0 py-2">{nodeRun.errorMessage}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getWorkflowRunSummaryFromOutputs(outputs = []) {
  for (const record of outputs) {
    const output = record?.output || {};

    if (output?.kind === 'workflow_run_summary') {
      return {
        ...output,
        nodeKey: record.nodeKey,
        outputKey: record.outputKey,
        savedAt: record.updatedAt || record.createdAt,
      };
    }

    if (output?.output?.kind === 'workflow_run_summary') {
      return {
        ...output.output,
        nodeKey: record.nodeKey,
        outputKey: record.outputKey,
        savedAt: record.updatedAt || record.createdAt,
      };
    }
  }

  return null;
}

function WorkflowRunSummaryPanel({ run, outputs = [] }) {
  if (!run) {
    return null;
  }

  const summaryOutput = getWorkflowRunSummaryFromOutputs(outputs);
  const summaryText = summaryOutput?.summary || run.summary || '';

  if (!summaryText) {
    return null;
  }

  const counts = summaryOutput?.counts || {};
  const timings = summaryOutput?.timings || {};
  const recommendedNextActions = Array.isArray(summaryOutput?.recommendedNextActions)
    ? summaryOutput.recommendedNextActions
    : [];
  const warnings = Array.isArray(summaryOutput?.warnings) ? summaryOutput.warnings : [];
  const errors = Array.isArray(summaryOutput?.errors) ? summaryOutput.errors : [];

  return (
    <section className="sky-card mb-4">
      <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Run summary</div>
          <h2 className="h5 mb-0">
            {summaryOutput?.title || run.workflowDisplayName || 'Workflow run summary'}
          </h2>
          <p className="small sky-muted mb-0 mt-1">{summaryText}</p>
        </div>
        <div className="d-flex flex-wrap gap-2 small">
          <span className={`sky-pill ${statusClass(summaryOutput?.status || run.status)}`}>
            {summaryOutput?.status || run.status}
          </span>
          {summaryOutput?.nodeKey && (
            <span className="sky-pill sky-pill-info">{summaryOutput.nodeKey}</span>
          )}
          {timings.durationMs !== undefined && timings.durationMs !== null && (
            <span className="sky-pill sky-pill-info">{formatDuration(timings.durationMs)}</span>
          )}
        </div>
      </div>
      <div className="sky-card-body">
        <div className="row g-3">
          <div className="col-md-3">
            <div className="sky-worker-command-card h-100">
              <div className="sky-page-kicker">Completed</div>
              <div className="sky-stat-value">{counts.completedNodes ?? '—'}</div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="sky-worker-command-card h-100">
              <div className="sky-page-kicker">Failed</div>
              <div className="sky-stat-value">{counts.failedNodes ?? 0}</div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="sky-worker-command-card h-100">
              <div className="sky-page-kicker">Skipped</div>
              <div className="sky-stat-value">{counts.skippedNodes ?? 0}</div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="sky-worker-command-card h-100">
              <div className="sky-page-kicker">Total nodes</div>
              <div className="sky-stat-value">{counts.totalNodes ?? '—'}</div>
            </div>
          </div>
        </div>
        {summaryOutput?.technicalDetails && (
          <pre className="sky-json-block mt-3 mb-0">{summaryOutput.technicalDetails}</pre>
        )}
        {recommendedNextActions.length > 0 && (
          <div className="mt-3">
            <div className="sky-page-kicker mb-2">Recommended next actions</div>
            <ul className="small sky-muted mb-0">
              {recommendedNextActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>
        )}
        {(warnings.length > 0 || errors.length > 0) && (
          <div className="alert alert-warning mt-3 mb-0 py-2">
            {[...warnings, ...errors.map((error) => error.message || String(error))].map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MacroIngestionOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const totals = getSafeObject(output.totals);
  const indicators = getSafeArray(output.indicators);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-macro-ingestion-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Macro ingestion result</div>
          <h3 className="h6 mb-1">{output.sourceCode || 'Macro source'} update summary</h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured ingestion result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${macroOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">
            {output.selectedIndicators ? 'Selected indicators' : 'Full catalogue'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Run totals</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Succeeded</th>
              <th>Updated</th>
              <th>Unchanged</th>
              <th>Failed</th>
              <th>Rows staged</th>
              <th>New rows</th>
              <th>Rows inserted</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{Number(totals.indicatorsRequested || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsSucceeded || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsUpdated || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsUnchanged || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsFailed || 0).toLocaleString()}</td>
              <td>{Number(totals.rowsStaged || 0).toLocaleString()}</td>
              <td>{Number(totals.rowsDetectedAsNew || 0).toLocaleString()}</td>
              <td className="fw-semibold">{Number(totals.rowsInserted || 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Indicator results</div>
        <span className="sky-pill sky-pill-info">{indicators.length} indicator(s)</span>
      </div>

      {indicators.length === 0 ? (
        <div className="sky-empty-state">No indicator-level result records were emitted.</div>
      ) : (
        <div className="table-responsive sky-table-card sky-macro-ingestion-indicator-table">
          <table className="table table-sm sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Outcome</th>
                <th>Rows inserted</th>
                <th>New rows</th>
                <th>Staging rows</th>
                <th>Previous max</th>
                <th>Source max</th>
                <th>Current max</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((indicator, index) => (
                <tr key={`${indicator.indicatorCode || 'indicator'}-${index}`}>
                  <td className="fw-semibold sky-mono">{indicator.indicatorCode || '—'}</td>
                  <td>
                    <span className={`sky-pill ${macroOutcomeClass(indicator.outcome)}`}>
                      {indicator.outcome || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{Number(indicator.rowsInserted || 0).toLocaleString()}</td>
                  <td>{Number(indicator.newRowsDetected || 0).toLocaleString()}</td>
                  <td>{Number(indicator.stagingRows || 0).toLocaleString()}</td>
                  <td>
                    <FriendlyOutputScalar
                      fieldKey="previousTargetMaxDate"
                      value={indicator.previousTargetMaxDate}
                    />
                  </td>
                  <td>
                    <FriendlyOutputScalar
                      fieldKey="sourceMaxDate"
                      value={indicator.sourceMaxDate}
                    />
                  </td>
                  <td>
                    <FriendlyOutputScalar
                      fieldKey="currentTargetMaxDate"
                      value={indicator.currentTargetMaxDate}
                    />
                  </td>
                  <td>{formatDuration(indicator.durationMs)}</td>
                  <td className="sky-macro-ingestion-error-cell">
                    {indicator.error?.message || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function RepositoryPackageOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const options = getSafeObject(output.options);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const compressionPercent = Number.isFinite(Number(output.compressionRatio))
    ? `${(Number(output.compressionRatio) * 100).toFixed(1)}%`
    : '—';

  return (
    <div className="sky-repository-package-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Repository package result</div>
          <h3 className="h6 mb-1">{output.fileName || 'Repository archive'}</h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured repository package result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span
            className={`sky-pill ${output.outcome === 'CREATED' ? 'sky-pill-success' : 'sky-pill-danger'}`}
          >
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Artifact summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Repository</th>
              <td>{output.repositoryName || '—'}</td>
              <th>Files included</th>
              <td>{Number(output.filesIncluded || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Source size</th>
              <td>{formatByteCount(output.sourceBytes)}</td>
              <th>Archive size</th>
              <td>{formatByteCount(output.archiveBytes)}</td>
            </tr>
            <tr>
              <th>Compression ratio</th>
              <td>{compressionPercent}</td>
              <th>Created</th>
              <td>
                <FriendlyOutputScalar fieldKey="completedAt" value={output.completedAt} />
              </td>
            </tr>
            <tr>
              <th>Archive path</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.artifactPath || '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Packaging policy</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Node modules</th>
              <th>Images</th>
              <th>Sensitive environment files</th>
              <th>Generated artifacts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{options.nodeModulesIncluded ? 'Included' : 'Excluded'}</td>
              <td>{options.imagesIncluded ? 'Included' : 'Excluded'}</td>
              <td>{options.sensitiveEnvironmentFilesExcluded ? 'Excluded' : 'Included'}</td>
              <td>{options.generatedArtifactsExcluded ? 'Excluded' : 'Included'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function RepositoryMapOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const policy = getSafeObject(output.policy);
  const extensions = Object.entries(getSafeObject(output.extensionCounts)).sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  );
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-repository-map-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Repository map result</div>
          <h3 className="h6 mb-1">{output.fileName || 'Repository map'}</h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured repository map result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span
            className={`sky-pill ${output.outcome === 'CREATED' ? 'sky-pill-success' : 'sky-pill-danger'}`}
          >
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>
      <div className="sky-page-kicker mb-2">Map summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Repository</th>
              <td>{output.repositoryName || '—'}</td>
              <th>Format</th>
              <td>{output.format || '—'}</td>
            </tr>
            <tr>
              <th>Directories documented</th>
              <td>{Number(output.directoriesDocumented || 0).toLocaleString()}</td>
              <th>Files documented</th>
              <td>{Number(output.filesDocumented || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Directories excluded</th>
              <td>{Number(output.directoriesExcluded || 0).toLocaleString()}</td>
              <th>Files excluded</th>
              <td>{Number(output.filesExcluded || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Output size</th>
              <td>{formatByteCount(output.outputBytes)}</td>
              <th>Created</th>
              <td>
                <FriendlyOutputScalar fieldKey="completedAt" value={output.completedAt} />
              </td>
            </tr>
            <tr>
              <th>Map path</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.artifactPath || '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sky-page-kicker mb-2">Documentation policy</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Node modules</th>
              <th>Environment files</th>
              <th>Generated artifacts</th>
              <th>E2E tests</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{policy.nodeModulesExcluded ? 'Excluded' : 'Included'}</td>
              <td>{policy.sensitiveEnvironmentFilesExcluded ? 'Excluded' : 'Included'}</td>
              <td>{policy.generatedArtifactsExcluded ? 'Excluded' : 'Included'}</td>
              <td>{policy.e2eTestsExcluded ? 'Excluded' : 'Included'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {extensions.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">File extension breakdown</div>
          <div className="table-responsive sky-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Extension</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {extensions.map(([extension, count]) => (
                  <tr key={extension}>
                    <td className="sky-mono">{extension}</td>
                    <td>{Number(count || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function GitRepositoryStatusOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const workingTree = getSafeObject(output.workingTree);
  const branches = getSafeObject(output.branches);
  const relationship = getSafeObject(output.relationship);
  const repositoryState = getSafeObject(output.repositoryState);
  const blockers = getSafeArray(output.blockers);
  const advisories = getSafeArray(output.advisories);
  const recommendedActions = getSafeArray(output.recommendedActions);
  const recentCommits = getSafeArray(output.recentCommits);
  const workingTreeEntries = getSafeArray(workingTree.entries).slice(0, 50);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const branchRows = [branches.dev, branches.main].filter(Boolean);
  const stateRows = [
    ['Index lock', repositoryState.indexLockPresent],
    ['Merge', repositoryState.mergeInProgress],
    ['Rebase', repositoryState.rebaseInProgress],
    ['Cherry-pick', repositoryState.cherryPickInProgress],
    ['Revert', repositoryState.revertInProgress],
    ['Bisect', repositoryState.bisectInProgress],
  ];

  return (
    <div className="sky-git-repository-status-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Repository intelligence</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'} promotion preflight
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured repository status recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          <span
            className={`sky-pill ${
              output.readyForDevelopmentPromotion ? 'sky-pill-success' : 'sky-pill-warning'
            }`}
          >
            {output.readyForDevelopmentPromotion ? 'Promotion ready' : `${blockers.length} blocker(s)`}
          </span>
          <span className="sky-pill sky-pill-info">Watcher-safe</span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Promotion readiness</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Repository</th>
              <td>{output.repositoryCode || output.repositoryName || '—'}</td>
              <th>Inspection strategy</th>
              <td>{humanizeOutputKey(output.executionStrategy || 'checkout free inspection')}</td>
            </tr>
            <tr>
              <th>Active branch</th>
              <td className="sky-mono">{output.currentBranch || 'Detached HEAD'}</td>
              <th>Expected branch</th>
              <td className="sky-mono">{output.expectedBranch || '—'}</td>
            </tr>
            <tr>
              <th>Remote refresh</th>
              <td>{output.fetchSucceeded ? 'Completed' : 'Unavailable'}</td>
              <th>Remote baseline synchronized</th>
              <td>{relationship.remoteBranchesSynchronized ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Development promotion</th>
              <td>
                <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
                  {output.readyForDevelopmentPromotion ? 'READY' : 'BLOCKED'}
                </span>
              </td>
              <th>Common ancestor</th>
              <td className="sky-mono text-break">{relationship.commonAncestorSha || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Working tree</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Clean</th>
              <th>Total changes</th>
              <th>Staged</th>
              <th>Modified</th>
              <th>Untracked</th>
              <th>Conflicted</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{workingTree.clean ? 'Yes' : 'No'}</td>
              <td>{Number(workingTree.totalChanges || 0).toLocaleString()}</td>
              <td>{Number(workingTree.staged || 0).toLocaleString()}</td>
              <td>{Number(workingTree.modified || 0).toLocaleString()}</td>
              <td>{Number(workingTree.untracked || 0).toLocaleString()}</td>
              <td>{Number(workingTree.conflicted || 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Branch tracking</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Local head</th>
              <th>Remote head</th>
              <th>Ahead</th>
              <th>Behind</th>
              <th>Tracking synchronized</th>
              <th>Latest remote commit</th>
            </tr>
          </thead>
          <tbody>
            {branchRows.map((branch) => (
              <tr key={branch.name || branch.remoteSha || branch.localSha}>
                <td className="fw-semibold sky-mono">{branch.name || '—'}</td>
                <td className="sky-mono text-break">{branch.localSha || '—'}</td>
                <td className="sky-mono text-break">{branch.remoteSha || '—'}</td>
                <td>{branch.ahead ?? '—'}</td>
                <td>{branch.behind ?? '—'}</td>
                <td>{branch.localMatchesRemote ? 'Yes' : 'No'}</td>
                <td>
                  <div className="sky-mono">{branch.latestRemoteCommit?.shortSha || '—'}</div>
                  <div className="small sky-muted">{branch.latestRemoteCommit?.subject || '—'}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Repository operation state</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              {stateRows.map(([label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {stateRows.map(([label, active]) => (
                <td key={label}>{active ? 'In progress' : 'Clear'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {blockers.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Promotion blockers</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Finding</th>
                </tr>
              </thead>
              <tbody>
                {blockers.map((blocker, index) => (
                  <tr key={`${blocker.code || 'blocker'}-${index}`}>
                    <td className="sky-mono">{blocker.code || 'REPOSITORY_BLOCKER'}</td>
                    <td>{blocker.message || String(blocker)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {workingTreeEntries.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Working-tree paths</div>
            <span className="sky-pill sky-pill-info">
              {workingTreeEntries.length}
              {getSafeArray(workingTree.entries).length > workingTreeEntries.length ? '+' : ''} path(s)
            </span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Index</th>
                  <th>Working tree</th>
                  <th>Classification</th>
                </tr>
              </thead>
              <tbody>
                {workingTreeEntries.map((entry, index) => (
                  <tr key={`${entry.path || 'path'}-${index}`}>
                    <td className="sky-mono text-break">{entry.path || '—'}</td>
                    <td className="sky-mono">{entry.indexStatus || '—'}</td>
                    <td className="sky-mono">{entry.workTreeStatus || '—'}</td>
                    <td>
                      {entry.conflicted
                        ? 'Conflicted'
                        : entry.untracked
                          ? 'Untracked'
                          : entry.staged && entry.modified
                            ? 'Staged + modified'
                            : entry.staged
                              ? 'Staged'
                              : entry.modified
                                ? 'Modified'
                                : 'Changed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {recentCommits.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Recent repository history</div>
            <span className="sky-pill sky-pill-info">{recentCommits.length} commit(s)</span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Commit</th>
                  <th>Subject</th>
                  <th>References</th>
                  <th>Author</th>
                  <th>Authored</th>
                </tr>
              </thead>
              <tbody>
                {recentCommits.map((commit, index) => (
                  <tr key={`${commit.sha || commit.shortSha || 'commit'}-${index}`}>
                    <td className="sky-mono">{commit.shortSha || commit.sha || '—'}</td>
                    <td>{commit.subject || '—'}</td>
                    <td className="sky-mono small">{commit.decorations || '—'}</td>
                    <td>{commit.authorName || '—'}</td>
                    <td>
                      <FriendlyOutputScalar fieldKey="authoredAt" value={commit.authoredAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {advisories.length > 0 || recommendedActions.length > 0 ? (
        <div className="row g-3">
          <div className="col-lg-6">
            <div className="sky-page-kicker mb-2">Advisories</div>
            <div className="sky-table-card p-3 h-100">
              {advisories.length > 0 ? (
                <ul className="small mb-0">
                  {advisories.map((advisory, index) => (
                    <li key={`${advisory}-${index}`}>{advisory}</li>
                  ))}
                </ul>
              ) : (
                <div className="small sky-muted">No advisories.</div>
              )}
            </div>
          </div>
          <div className="col-lg-6">
            <div className="sky-page-kicker mb-2">Recommended actions</div>
            <div className="sky-table-card p-3 h-100">
              {recommendedActions.length > 0 ? (
                <ol className="small mb-0">
                  {recommendedActions.map((action, index) => (
                    <li key={`${action}-${index}`}>{action}</li>
                  ))}
                </ol>
              ) : (
                <div className="small sky-muted">No corrective action is required.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`${warning}-${index}`}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function GitCommitOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const changes = getSafeObject(output.changes);
  const steps = getSafeObject(output.steps);
  return (
    <div className="sky-git-commit-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Git commit result</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured git commit result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span
            className={`sky-pill ${output.outcome === 'FAILED' ? 'sky-pill-danger' : output.outcome === 'NO_CHANGES' ? 'sky-pill-info' : 'sky-pill-success'}`}
          >
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>
      <div className="sky-page-kicker mb-2">Commit summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Branch</th>
              <td className="sky-mono">{output.branch || '—'}</td>
              <th>Changed files</th>
              <td>{Number(output.changedFiles || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Commit</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.commitSha || output.currentHeadSha || 'No new commit'}
              </td>
            </tr>
            <tr>
              <th>Message</th>
              <td colSpan="3">{output.commitMessage || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sky-page-kicker mb-2">Change set</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Added</th>
              <th>Modified</th>
              <th>Deleted</th>
              <th>Renamed</th>
              <th>Untracked</th>
              <th>Other</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {['added', 'modified', 'deleted', 'renamed', 'untracked', 'other'].map((key) => (
                <td key={key}>{Number(changes[key] || 0).toLocaleString()}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sky-page-kicker mb-2">Git steps</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Fetched</th>
              <th>Branch selected</th>
              <th>Pulled</th>
              <th>Staged</th>
              <th>Committed</th>
              <th>Pushed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {['fetched', 'switchedBranch', 'pulled', 'staged', 'committed', 'pushed'].map(
                (key) => (
                  <td key={key}>{steps[key] ? 'Completed' : 'Not performed'}</td>
                ),
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GitLocalSyncOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const safeguards = getSafeObject(output.safeguards);
  const steps = getSafeObject(output.steps);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-git-local-sync-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Host local repository synchronization</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'} · {output.mainBranch || 'main'} /{' '}
            {output.devBranch || 'dev'}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured guarded host synchronization result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">HOST</span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Synchronization contract</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Expected local dev baseline</th>
              <td className="sky-mono text-break">{output.expectedLocalDevSha || '—'}</td>
              <th>Approved synchronized head</th>
              <td className="sky-mono text-break">{output.expectedSynchronizedHeadSha || '—'}</td>
            </tr>
            <tr>
              <th>Local main before</th>
              <td className="sky-mono text-break">{output.localMainBeforeSha || '—'}</td>
              <th>Local dev before</th>
              <td className="sky-mono text-break">{output.localDevBeforeSha || '—'}</td>
            </tr>
            <tr>
              <th>Local main after</th>
              <td className="sky-mono text-break">{output.localMainAfterSha || '—'}</td>
              <th>Local dev after</th>
              <td className="sky-mono text-break">{output.localDevAfterSha || '—'}</td>
            </tr>
            <tr>
              <th>Origin main after</th>
              <td className="sky-mono text-break">{output.remoteMainAfterSha || '—'}</td>
              <th>Origin dev after</th>
              <td className="sky-mono text-break">{output.remoteDevAfterSha || '—'}</td>
            </tr>
            <tr>
              <th>Four-way synchronized</th>
              <td>{output.fourWaySynchronized ? 'Yes' : 'No'}</td>
              <th>Working tree clean</th>
              <td>{output.workingTreeCleanAfter ? 'Yes' : 'No'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Safety guardrails</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            {[
              ['Host profile verified', 'hostProfileVerified'],
              ['Repository lock acquired', 'repositoryLockAcquired'],
              ['No Git operation in progress', 'gitOperationClear'],
              ['Working tree clean', 'workingTreeClean'],
              ['Worktree ownership safe', 'worktreeOwnershipSafe'],
              ['Dev baseline matched', 'devBaselineMatched'],
              ['Remote target matched', 'remoteTargetMatched'],
              ['Local main fast-forward safe', 'localMainFastForwardSafe'],
              ['Local dev fast-forward safe', 'localDevFastForwardSafe'],
              ['Remote reverified before mutation', 'remoteReverifiedBeforeMutation'],
            ].map(([label, key]) => (
              <tr key={key}>
                <th>{label}</th>
                <td>{safeguards[key] ? 'Passed' : 'Not passed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Execution steps</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Remote inspected</th>
              <th>Fetched</th>
              <th>Main updated</th>
              <th>Dev updated</th>
              <th>Remote reverified</th>
              <th>Post verified</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {[
                'remoteInspected',
                'fetched',
                'mainRefUpdated',
                'devRefUpdated',
                'remoteReverified',
                'postVerified',
              ].map((key) => (
                <td key={key}>{steps[key] ? 'Completed' : 'Not performed'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`local-sync-warning-${index}`}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function GitBranchSyncOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const steps = getSafeObject(output.steps);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const sourceBranch = output.sourceBranch || output.mainBranch || 'main';
  const targetBranch = output.targetBranch || output.devBranch || 'dev';

  return (
    <div className="sky-git-branch-sync-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Git branch synchronization result</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'} · {sourceBranch} →{' '}
            {targetBranch}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured branch synchronization result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Synchronization summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Source branch</th>
              <td className="sky-mono">{sourceBranch}</td>
              <th>Target branch</th>
              <td className="sky-mono">{targetBranch}</td>
            </tr>
            <tr>
              <th>Commits applied</th>
              <td>{Number(output.commitsApplied || 0).toLocaleString()}</td>
              <th>Branches synchronized</th>
              <td>{output.branchesSynchronized ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Development branch advanced</th>
              <td>{output.devAdvanced ? 'Yes' : 'No'}</td>
              <th>Tag</th>
              <td>{output.tagCreated ? output.tagName || 'Created' : 'Not created'}</td>
            </tr>
            <tr>
              <th>Execution strategy</th>
              <td>{output.executionStrategy === 'CHECKOUT_FREE_REMOTE_SYNC' ? 'Checkout-free remote sync' : output.executionStrategy || '—'}</td>
              <th>Watcher safe</th>
              <td>{output.watcherSafe ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Local workspace</th>
              <td>{output.localWorkspaceUpdated ? 'Updated without file rewrite' : 'Not rewritten'}</td>
              <th>Refresh required</th>
              <td>{output.localWorkspaceRefreshRequired ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Host local sync required</th>
              <td>{output.localHostSyncRequired ? 'Yes' : 'No'}</td>
              <th>Deferred local branches</th>
              <td className="sky-mono">
                {getSafeArray(output.deferredLocalBranches).join(', ') || 'None'}
              </td>
            </tr>
            <tr>
              <th>Synchronized head</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.synchronizedHeadSha || output.devHeadAfterSha || '—'}
              </td>
            </tr>
            {output.localSyncCommandTemplate ? (
              <tr>
                <th>Host sync command template</th>
                <td colSpan="3" className="sky-mono text-break">
                  {output.localSyncCommandTemplate}
                </td>
              </tr>
            ) : null}
            {output.localRefreshCommand ? (
              <tr>
                <th>Local refresh command</th>
                <td colSpan="3" className="sky-mono text-break">
                  {output.localRefreshCommand}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Branch head movement</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Checkpoint</th>
              <th>Commit SHA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Main after pull</td>
              <td className="sky-mono text-break">{output.mainHeadSha || '—'}</td>
            </tr>
            <tr>
              <td>Development before synchronization</td>
              <td className="sky-mono text-break">{output.devHeadBeforeSha || '—'}</td>
            </tr>
            <tr>
              <td>Development after synchronization</td>
              <td className="sky-mono text-break">{output.devHeadAfterSha || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Git steps</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Fetched</th>
              <th>Remote fast-forward</th>
              <th>Remote verified</th>
              <th>Main ref updated</th>
              <th>Dev ref updated</th>
              <th>Workspace updated</th>
              <th>Tag pushed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {[
                'fetched',
                'fastForwardMerged',
                'remoteFastForwardVerified',
                'localMainRefUpdated',
                'localDevRefUpdated',
                'localWorkspaceUpdated',
                'tagsPushed',
              ].map((key) => (
                <td key={key}>{steps[key] ? 'Completed' : 'Not performed'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function ConditionEvaluationOutput({ conditionResult }) {
  const condition = getSafeObject(conditionResult);
  const passed = Boolean(condition.passed);
  const branchLabel = condition.branchLabel || condition.route || (passed ? 'TRUE' : 'FALSE');

  return (
    <div className="sky-condition-evaluation-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Condition decision</div>
          <h3 className="h6 mb-1">{condition.leftPath || 'Workflow condition'}</h3>
          <p className="small sky-muted mb-0">
            {condition.summary || condition.reason || 'Condition evaluation recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${passed ? 'sky-pill-success' : 'sky-pill-warning'}`}>
            {passed ? 'PASSED' : 'DID NOT PASS'}
          </span>
          <span className="sky-pill sky-pill-info">{branchLabel}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Evaluation evidence</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Left path</th>
              <td className="sky-mono text-break">{condition.leftPath || '—'}</td>
              <th>Path resolved</th>
              <td>{condition.leftPathResolved ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Observed value</th>
              <td>
                <FriendlyOutputScalar fieldKey="leftValue" value={condition.leftValue} />
              </td>
              <th>Fallback used</th>
              <td>{condition.leftPathUsedFallback ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Operator</th>
              <td>{humanizeOutputKey(condition.operator || 'truthy')}</td>
              <th>Comparison value</th>
              <td>
                {condition.rightValue === undefined || condition.rightValue === null ? (
                  'Not required'
                ) : (
                  <FriendlyOutputScalar fieldKey="rightValue" value={condition.rightValue} />
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Branch routing</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Branch</th>
              <td>
                <span className={`sky-pill ${passed ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                  {branchLabel}
                </span>
              </td>
              <th>Target node</th>
              <td className="sky-mono">{condition.branchTargetNodeKey || 'Next sequential node'}</td>
            </tr>
            <tr>
              <th>When false</th>
              <td>{humanizeOutputKey(condition.onFalse || 'stop_success')}</td>
              <th>Explicit branch taken</th>
              <td>{condition.branchTaken ? 'Yes' : 'No'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HumanApprovalOutput({ approvalResult }) {
  const approval = getSafeObject(approvalResult);
  const decision = String(approval.decision || approval.status || 'UNKNOWN').toUpperCase();

  return (
    <div className="sky-human-approval-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Human approval result</div>
          <h3 className="h6 mb-1">{approval.approvalTitle || 'Approval checkpoint'}</h3>
          <p className="small sky-muted mb-0">
            {approval.summary || 'Approval decision recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(decision)}`}>{decision}</span>
          {approval.requiredRoleCode ? (
            <span className="sky-pill sky-pill-info">{approval.requiredRoleCode}</span>
          ) : null}
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Decision</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Decision</th>
              <td>
                <span className={`sky-pill ${operationOutcomeClass(decision)}`}>{decision}</span>
              </td>
              <th>Workflow action</th>
              <td>
                {approval.branchTargetNodeKey
                  ? `Jump to ${approval.branchTargetNodeKey}`
                  : humanizeOutputKey(approval.action || 'continue')}
              </td>
            </tr>
            <tr>
              <th>Decided by</th>
              <td>{approval.decidedByDisplayName || '—'}</td>
              <th>Decided at</th>
              <td>
                <FriendlyOutputScalar fieldKey="decidedAt" value={approval.decidedAt} />
              </td>
            </tr>
            <tr>
              <th>Required role</th>
              <td>{approval.requiredRoleCode || 'Any authorized approver'}</td>
              <th>Approval key</th>
              <td className="sky-mono">{approval.approvalKey || '—'}</td>
            </tr>
            {approval.decisionNote ? (
              <tr>
                <th>Decision note</th>
                <td colSpan="3">{approval.decisionNote}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {approval.instructions ? (
        <>
          <div className="sky-page-kicker mb-2">Instructions</div>
          <div className="sky-table-card p-3 small">{approval.instructions}</div>
        </>
      ) : null}
    </div>
  );
}

function GitPromotionSummary({ promotion }) {
  const value = getSafeObject(promotion);
  const stages = getSafeArray(value.stages);
  const preflight = getSafeObject(value.preflight, null);
  const preflightCondition = getSafeObject(preflight?.condition, null);
  const approval = getSafeObject(value.approval);
  const artifacts = getSafeObject(value.artifacts);
  const repositoryMap = getSafeObject(artifacts.repositoryMap, null);
  const repositoryPackage = getSafeObject(artifacts.repositoryPackage, null);

  return (
    <div className="sky-git-promotion-summary mb-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Development promotion</div>
        <span className={`sky-pill ${operationOutcomeClass(value.outcome)}`}>
          {value.outcome || 'UNKNOWN'}
        </span>
      </div>

      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Repository</th>
              <td>{value.repositoryCode || value.repositoryName || '—'}</td>
              <th>Pull request direction</th>
              <td className="sky-mono">{value.pullRequestDirection || '—'}</td>
            </tr>
            <tr>
              <th>Synchronization direction</th>
              <td className="sky-mono">{value.synchronizationDirection || '—'}</td>
              <th>Branches synchronized</th>
              <td>{value.branchesSynchronized ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Development commit</th>
              <td className="sky-mono text-break">{value.devCommitSha || '—'}</td>
              <th>Synchronized head</th>
              <td className="sky-mono text-break">{value.synchronizedHeadSha || '—'}</td>
            </tr>
            <tr>
              <th>Changed files</th>
              <td>{Number(value.changedFiles || 0).toLocaleString()}</td>
              <th>Commits synchronized</th>
              <td>{Number(value.commitsApplied || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Watcher-safe remote synchronization</th>
              <td>{value.watcherSafe ? 'Yes' : 'No'}</td>
              <th>Host local sync</th>
              <td>{value.localSyncCompleted ? 'Completed' : value.localHostSyncRequired ? 'Required' : 'Not required'}</td>
            </tr>
            {value.localHostSyncRequired && value.deferredLocalBranches?.length ? (
              <tr>
                <th>Deferred local branches</th>
                <td className="sky-mono">{value.deferredLocalBranches.join(', ')}</td>
                <th>Promotion state</th>
                <td>Remote promoted; host synchronization pending</td>
              </tr>
            ) : null}
            {value.localSync?.fourWaySynchronized ? (
              <tr>
                <th>Four-way synchronization</th>
                <td colSpan="3" className="sky-mono text-break">
                  local main / local dev / origin main / origin dev = {value.localSync.expectedSynchronizedHeadSha || value.synchronizedHeadSha || 'verified'}
                </td>
              </tr>
            ) : null}
            {value.localHostSyncRequired && (value.localSyncCommand || value.localSyncCommandTemplate) ? (
              <tr>
                <th>Host sync command</th>
                <td colSpan="3" className="sky-mono text-break">
                  {value.localSyncCommand || value.localSyncCommandTemplate}
                </td>
              </tr>
            ) : null}
            {value.localRefreshCommand ? (
              <tr>
                <th>Local refresh command</th>
                <td colSpan="3" className="sky-mono text-break">
                  {value.localRefreshCommand}
                </td>
              </tr>
            ) : null}
            {value.tagCreated ? (
              <tr>
                <th>Tag</th>
                <td colSpan="3" className="sky-mono">{value.tagName || 'Created'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {preflight && Object.keys(preflight).length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Repository preflight</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <tbody>
                <tr>
                  <th>Outcome</th>
                  <td>
                    <span className={`sky-pill ${operationOutcomeClass(preflight.outcome)}`}>
                      {preflight.outcome || 'UNKNOWN'}
                    </span>
                  </td>
                  <th>Promotion ready</th>
                  <td>{preflight.readyForDevelopmentPromotion ? 'Yes' : 'No'}</td>
                </tr>
                <tr>
                  <th>Active branch</th>
                  <td className="sky-mono">{preflight.currentBranch || '—'}</td>
                  <th>Expected branch</th>
                  <td className="sky-mono">{preflight.expectedBranch || '—'}</td>
                </tr>
                <tr>
                  <th>Working-tree changes</th>
                  <td>{Number(preflight.workingTreeChanges || 0).toLocaleString()}</td>
                  <th>Remote baseline synchronized</th>
                  <td>{preflight.remoteBranchesSynchronized ? 'Yes' : 'No'}</td>
                </tr>
                <tr>
                  <th>Promotion blockers</th>
                  <td colSpan="3">{Number(preflight.blockerCount || 0).toLocaleString()}</td>
                </tr>
                {preflightCondition ? (
                  <>
                    <tr>
                      <th>Condition gate</th>
                      <td>
                        <span
                          className={`sky-pill ${
                            preflightCondition.passed ? 'sky-pill-success' : 'sky-pill-warning'
                          }`}
                        >
                          {preflightCondition.passed ? 'PASSED' : 'DID NOT PASS'}
                        </span>
                      </td>
                      <th>Branch route</th>
                      <td>
                        {preflightCondition.branchLabel || '—'}
                        {preflightCondition.branchTargetNodeKey
                          ? ` → ${preflightCondition.branchTargetNodeKey}`
                          : ''}
                      </td>
                    </tr>
                    <tr>
                      <th>Condition path</th>
                      <td colSpan="3" className="sky-mono text-break">
                        {preflightCondition.leftPath || '—'}
                      </td>
                    </tr>
                  </>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {approval && Object.keys(approval).length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Merge approval</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <tbody>
                <tr>
                  <th>Decision</th>
                  <td>
                    <span className={`sky-pill ${operationOutcomeClass(approval.decision)}`}>
                      {approval.decision || 'UNKNOWN'}
                    </span>
                  </td>
                  <th>Decided by</th>
                  <td>{approval.decidedByDisplayName || '—'}</td>
                </tr>
                <tr>
                  <th>Approval title</th>
                  <td>{approval.title || '—'}</td>
                  <th>Decided at</th>
                  <td>
                    <FriendlyOutputScalar fieldKey="decidedAt" value={approval.decidedAt} />
                  </td>
                </tr>
                {approval.decisionNote ? (
                  <tr>
                    <th>Decision note</th>
                    <td colSpan="3">{approval.decisionNote}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {repositoryMap || repositoryPackage ? (
        <>
          <div className="sky-page-kicker mb-2">Generated artifacts</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Artifact</th>
                  <th>File</th>
                  <th>Evidence</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {repositoryMap ? (
                  <tr>
                    <td>Repository map</td>
                    <td>{repositoryMap.fileName || '—'}</td>
                    <td>{Number(repositoryMap.filesDocumented || 0).toLocaleString()} file(s)</td>
                    <td className="sky-mono text-break">{repositoryMap.artifactPath || '—'}</td>
                  </tr>
                ) : null}
                {repositoryPackage ? (
                  <tr>
                    <td>Repository package</td>
                    <td>{repositoryPackage.fileName || '—'}</td>
                    <td>{Number(repositoryPackage.filesIncluded || 0).toLocaleString()} file(s)</td>
                    <td className="sky-mono text-break">{repositoryPackage.artifactPath || '—'}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {stages.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Promotion stage results</div>
            <span className="sky-pill sky-pill-info">{stages.length} stage(s)</span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Node</th>
                  <th>Status</th>
                  <th>Outcome</th>
                  <th>Evidence</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage) => (
                  <tr key={`${stage.nodeKey}-${stage.stageCode}`}>
                    <td className="fw-semibold">{stage.label || humanizeOutputKey(stage.stageCode)}</td>
                    <td className="sky-mono">{stage.nodeKey || '—'}</td>
                    <td>
                      <span className={`sky-pill ${operationOutcomeClass(stage.status)}`}>
                        {stage.status || 'UNKNOWN'}
                      </span>
                    </td>
                    <td>{stage.outcome || '—'}</td>
                    <td className="sky-mono text-break">{stage.evidence || '—'}</td>
                    <td>{formatDuration(stage.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}



function DatabaseHealthOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const databases = getSafeArray(output.databases);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const outcome = toolResult?.success === false ? 'FAILED' : output.allOnline ? 'ONLINE' : 'PARTIAL';

  return (
    <div className="sky-database-health-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">PostgreSQL database health</div>
          <h3 className="h6 mb-1">
            {Number(output.onlineCount || 0).toLocaleString()} of{' '}
            {Number(output.requestedCount || databases.length || 0).toLocaleString()} database(s) online
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult?.message || 'Structured PostgreSQL connection evidence recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(outcome)}`}>{outcome}</span>
          <span className="sky-pill sky-pill-success">
            {Number(output.onlineCount || 0).toLocaleString()} online
          </span>
          {Number(output.offlineCount || 0) > 0 ? (
            <span className="sky-pill sky-pill-warning">
              {Number(output.offlineCount || 0).toLocaleString()} offline
            </span>
          ) : null}
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Health-check overview</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Checked at</th>
              <th>Requested</th>
              <th>Online</th>
              <th>Offline</th>
              <th>All online</th>
              <th>Offline policy</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><FriendlyOutputScalar fieldKey="checkedAt" value={output.checkedAt} /></td>
              <td>{Number(output.requestedCount || databases.length || 0).toLocaleString()}</td>
              <td>{Number(output.onlineCount || 0).toLocaleString()}</td>
              <td>{Number(output.offlineCount || 0).toLocaleString()}</td>
              <td>
                <span className={`sky-pill ${output.allOnline ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                  {output.allOnline ? 'YES' : 'NO'}
                </span>
              </td>
              <td>{output.failWhenOffline ? 'Fail execution' : 'Report evidence'}</td>
              <td>{formatDuration(output.durationMs)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Database results</div>
        <span className="sky-pill sky-pill-info">{databases.length} database(s)</span>
      </div>
      {databases.length > 0 ? (
        <div className="table-responsive sky-table-card">
          <table className="table table-sm sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Database</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Server version</th>
                <th>User</th>
                <th>Endpoint</th>
                <th>Checked at</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {databases.map((database, index) => {
                const endpoint = database?.serverAddress
                  ? `${database.serverAddress}${database.serverPort ? `:${database.serverPort}` : ''}`
                  : '—';
                const evidence = database?.online
                  ? 'Connection succeeded'
                  : [database?.errorCode, database?.errorMessage].filter(Boolean).join(' · ') || 'Connection failed';

                return (
                  <tr key={`${database?.databaseName || 'database'}-${index}`}>
                    <td className="fw-semibold sky-mono">{database?.databaseName || '—'}</td>
                    <td>
                      <span className={`sky-pill ${database?.online ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                        {database?.online ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </td>
                    <td>{database?.online ? formatDuration(database?.latencyMs) : '—'}</td>
                    <td>{database?.serverVersion || '—'}</td>
                    <td className="sky-mono">{database?.currentUser || '—'}</td>
                    <td className="sky-mono text-break">{endpoint}</td>
                    <td><FriendlyOutputScalar fieldKey="checkedAt" value={database?.checkedAt} /></td>
                    <td className="text-break">{evidence}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sky-empty-state">No database health rows were returned.</div>
      )}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`database-health-warning-${index}`}>
              {typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}
            </div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function DatabaseBuildOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const allFiles = getSafeArray(output.files);
  const files = allFiles.slice(0, 250);
  const uiFilesTruncated = allFiles.length > files.length;
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const buildStatus = output.status || (output.buildCompleted ? 'BUILT' : 'FAILED');
  const sqlRemaining = Math.max(
    0,
    Number(output.sqlFilesDiscovered || 0) - Number(output.sqlFilesExecuted || 0),
  );
  const migrationRemaining = Math.max(
    0,
    Number(output.migrationFilesDiscovered || 0) - Number(output.migrationFilesExecuted || 0),
  );
  const seedRemaining = Math.max(
    0,
    Number(output.seedFilesDiscovered || 0) - Number(output.seedFilesExecuted || 0),
  );

  return (
    <div className="sky-database-build-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">PostgreSQL database build</div>
          <h3 className="h6 mb-1 sky-mono">{output.targetDatabase || 'Target database'}</h3>
          <p className="small sky-muted mb-0">
            {toolResult?.message || 'Structured database rebuild evidence recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(buildStatus)}`}>
            {buildStatus}
          </span>
          <span className={`sky-pill ${output.buildCompleted ? 'sky-pill-success' : 'sky-pill-warning'}`}>
            {output.buildCompleted ? 'Build completed' : humanizeOutputKey(output.phase || 'Incomplete')}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Build overview</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Target database</th>
              <th>Phase</th>
              <th>Dropped</th>
              <th>Created</th>
              <th>Completed</th>
              <th>Started</th>
              <th>Completed at</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fw-semibold sky-mono">{output.targetDatabase || '—'}</td>
              <td>{humanizeOutputKey(output.phase || '—')}</td>
              <td>{output.databaseDropped ? 'Yes' : 'No'}</td>
              <td>{output.databaseCreated ? 'Yes' : 'No'}</td>
              <td>
                <span className={`sky-pill ${output.buildCompleted ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                  {output.buildCompleted ? 'YES' : 'NO'}
                </span>
              </td>
              <td><FriendlyOutputScalar fieldKey="startedAt" value={output.startedAt} /></td>
              <td><FriendlyOutputScalar fieldKey="completedAt" value={output.completedAt} /></td>
              <td>{formatDuration(output.durationMs)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">SQL execution totals</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>File group</th>
              <th>Discovered</th>
              <th>Executed</th>
              <th>Remaining</th>
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['All SQL files', output.sqlFilesDiscovered, output.sqlFilesExecuted, sqlRemaining],
              ['Migrations', output.migrationFilesDiscovered, output.migrationFilesExecuted, migrationRemaining],
              ['Seeds', output.seedFilesDiscovered, output.seedFilesExecuted, seedRemaining],
            ].map(([label, discovered, executed, remaining]) => {
              const complete =
                (Number(discovered || 0) > 0 || output.buildCompleted) &&
                Number(discovered || 0) === Number(executed || 0) &&
                Number(remaining || 0) === 0;
              return (
                <tr key={label}>
                  <td className="fw-semibold">{label}</td>
                  <td>{Number(discovered || 0).toLocaleString()}</td>
                  <td>{Number(executed || 0).toLocaleString()}</td>
                  <td>{Number(remaining || 0).toLocaleString()}</td>
                  <td>
                    <span className={`sky-pill ${complete ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                      {complete ? 'COMPLETE' : 'INCOMPLETE'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Build checkpoints</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>SQL roots</th>
              <td colSpan="3" className="sky-mono text-break">
                {getSafeArray(output.sqlRoots).join(', ') || '—'}
              </td>
            </tr>
            <tr>
              <th>First SQL file</th>
              <td className="sky-mono text-break">{output.firstSqlFile || '—'}</td>
              <th>Last SQL file</th>
              <td className="sky-mono text-break">{output.lastSqlFile || '—'}</td>
            </tr>
            <tr>
              <th>Last completed SQL file</th>
              <td className="sky-mono text-break">{output.lastCompletedSqlFile || '—'}</td>
              <th>Failed SQL file</th>
              <td className="sky-mono text-break">{output.failedSqlFile || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Ordered SQL execution</div>
        <span className="sky-pill sky-pill-info">
          {files.length}{uiFilesTruncated ? '+' : ''} file row(s)
        </span>
      </div>
      {files.length > 0 ? (
        <div className="table-responsive sky-table-card">
          <table className="table table-sm sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Ordinal</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Repository-relative SQL file</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file, index) => (
                <tr key={`${file?.relativePath || 'sql-file'}-${index}`}>
                  <td>{Number(file?.ordinal || 0).toLocaleString()}</td>
                  <td>{humanizeOutputKey(file?.kind || 'OTHER')}</td>
                  <td>
                    <span className={`sky-pill ${operationOutcomeClass(file?.status)}`}>
                      {file?.status || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{file?.durationMs == null ? '—' : formatDuration(file.durationMs)}</td>
                  <td className="sky-mono text-break">{file?.relativePath || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sky-empty-state">No SQL execution rows were returned.</div>
      )}

      {uiFilesTruncated ? (
        <div className="small sky-muted mt-2">
          Workflow Operations displays the first 250 SQL rows; the complete structured result remains persisted.
        </div>
      ) : null}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`database-build-warning-${index}`}>
              {typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}
            </div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function DatabaseComparisonOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const byType = getSafeArray(output.byType);
  const allDifferences = getSafeArray(output.differences);
  const differences = allDifferences.slice(0, 250);
  const uiDifferenceDetailsTruncated = allDifferences.length > differences.length;
  const differenceTypes = byType.filter(
    (item) =>
      Number(item.onlyInDatabaseA || 0) > 0 ||
      Number(item.onlyInDatabaseB || 0) > 0 ||
      Number(item.definitionMismatches || 0) > 0,
  );
  const typeRows = differenceTypes.length > 0 ? differenceTypes : byType;
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-database-comparison-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">PostgreSQL database comparison</div>
          <h3 className="h6 mb-1">
            {output.databaseA || 'Database A'} ↔ {output.databaseB || 'Database B'}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult?.message || 'Structured PostgreSQL catalogue comparison recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.status)}`}>
            {output.status || 'UNKNOWN'}
          </span>
          <span
            className={`sky-pill ${output.databasesMatch ? 'sky-pill-success' : 'sky-pill-warning'}`}
          >
            {output.databasesMatch ? 'Definitions match' : `${Number(output.totalDifferenceCount || 0).toLocaleString()} difference(s)`}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Comparison overview</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Database</th>
              <th>Objects</th>
              <th>Fingerprint</th>
              <th>Compared at</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fw-semibold sky-mono">{output.databaseA || '—'}</td>
              <td>{Number(output.databaseAObjectCount || 0).toLocaleString()}</td>
              <td className="sky-mono text-break">{output.databaseAFingerprint || '—'}</td>
              <td rowSpan="2">
                <FriendlyOutputScalar fieldKey="comparedAt" value={output.comparedAt} />
              </td>
            </tr>
            <tr>
              <td className="fw-semibold sky-mono">{output.databaseB || '—'}</td>
              <td>{Number(output.databaseBObjectCount || 0).toLocaleString()}</td>
              <td className="sky-mono text-break">{output.databaseBFingerprint || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Object reconciliation</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Matched</th>
              <th>Only in {output.databaseA || 'Database A'}</th>
              <th>Only in {output.databaseB || 'Database B'}</th>
              <th>Definition mismatches</th>
              <th>Total differences</th>
              <th>Details returned</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fw-semibold">
                {Number(output.matchedObjectCount || 0).toLocaleString()}
              </td>
              <td>{Number(output.onlyInDatabaseACount || 0).toLocaleString()}</td>
              <td>{Number(output.onlyInDatabaseBCount || 0).toLocaleString()}</td>
              <td>{Number(output.definitionMismatchCount || 0).toLocaleString()}</td>
              <td className={output.totalDifferenceCount ? 'fw-semibold' : ''}>
                {Number(output.totalDifferenceCount || 0).toLocaleString()}
              </td>
              <td>
                {Number(output.differenceDetailsReturned || differences.length || 0).toLocaleString()}
                {output.differenceDetailsTruncated || uiDifferenceDetailsTruncated ? ' (truncated)' : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {typeRows.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">
              {differenceTypes.length > 0 ? 'Differences by object type' : 'Object counts by type'}
            </div>
            <span className="sky-pill sky-pill-info">{typeRows.length} type(s)</span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Object type</th>
                  <th>{output.databaseA || 'Database A'}</th>
                  <th>{output.databaseB || 'Database B'}</th>
                  <th>Only in A</th>
                  <th>Only in B</th>
                  <th>Definition mismatches</th>
                  <th>Total differences</th>
                </tr>
              </thead>
              <tbody>
                {typeRows.map((item) => {
                  const differenceCount =
                    Number(item.onlyInDatabaseA || 0) +
                    Number(item.onlyInDatabaseB || 0) +
                    Number(item.definitionMismatches || 0);

                  return (
                    <tr key={item.objectType || JSON.stringify(item)}>
                      <td className="fw-semibold">{humanizeOutputKey(item.objectType)}</td>
                      <td>{Number(item.databaseACount || 0).toLocaleString()}</td>
                      <td>{Number(item.databaseBCount || 0).toLocaleString()}</td>
                      <td>{Number(item.onlyInDatabaseA || 0).toLocaleString()}</td>
                      <td>{Number(item.onlyInDatabaseB || 0).toLocaleString()}</td>
                      <td>{Number(item.definitionMismatches || 0).toLocaleString()}</td>
                      <td className={differenceCount ? 'fw-semibold' : ''}>
                        {differenceCount.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {differences.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Difference details</div>
            <span className="sky-pill sky-pill-warning">
              {differences.length}
              {output.differenceDetailsTruncated || uiDifferenceDetailsTruncated ? '+' : ''} row(s)
            </span>
          </div>
          <div className="table-responsive sky-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Difference</th>
                  <th>Object type</th>
                  <th>Object</th>
                  <th>Identity</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((difference, index) => (
                  <tr key={`${difference.objectKey || difference.objectName || 'difference'}-${index}`}>
                    <td>
                      <span className={`sky-pill ${operationOutcomeClass('DIFFERENT')}`}>
                        {humanizeOutputKey(difference.kind)}
                      </span>
                    </td>
                    <td>{humanizeOutputKey(difference.objectType)}</td>
                    <td className="sky-mono text-break">
                      {difference.schemaName ? `${difference.schemaName}.` : ''}
                      {difference.objectName || '—'}
                    </td>
                    <td className="sky-mono text-break">{difference.identity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="alert alert-success py-2 mb-0">
          No PostgreSQL catalogue differences were detected.
        </div>
      )}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`database-comparison-warning-${index}`}>
              {typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}
            </div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function DatabaseSynchronizationSummary({ synchronization }) {
  const health = getSafeObject(synchronization?.health, null);
  const condition = getSafeObject(synchronization?.condition, null);
  const build = getSafeObject(synchronization?.build, null);
  const comparison = getSafeObject(synchronization?.comparison, null);
  const stages = getSafeArray(synchronization?.stages);
  const databases = getSafeArray(health?.databases);
  const differenceTypes = getSafeArray(comparison?.byType).filter(
    (item) =>
      Number(item.onlyInDatabaseA || 0) > 0 ||
      Number(item.onlyInDatabaseB || 0) > 0 ||
      Number(item.definitionMismatches || 0) > 0,
  );
  const differences = getSafeArray(comparison?.differences);

  return (
    <div className="sky-database-synchronization-summary">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Database synchronization proof</div>
          <h3 className="h6 mb-1">
            {comparison?.databaseA || 'Source database'} ↔{' '}
            {comparison?.databaseB || build?.targetDatabase || 'Built database'}
          </h3>
          <p className="small sky-muted mb-0">
            Health, build, and PostgreSQL catalogue comparison evidence from this workflow run.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(synchronization?.outcome)}`}>
            {synchronization?.outcome || 'UNKNOWN'}
          </span>
          <span
            className={`sky-pill ${synchronization?.validationPassed ? 'sky-pill-success' : 'sky-pill-warning'}`}
          >
            {synchronization?.validationPassed ? 'Validation passed' : 'Review differences'}
          </span>
          <span className="sky-pill sky-pill-info">
            {formatDuration(synchronization?.durationMs)}
          </span>
        </div>
      </div>

      {databases.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Pre-build health</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Database</th>
                  <th>Online</th>
                  <th>Latency</th>
                  <th>Server version</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {databases.map((database, index) => (
                  <tr key={`${database.databaseName || 'database'}-${index}`}>
                    <td className="fw-semibold sky-mono">{database.databaseName || '—'}</td>
                    <td>
                      <span
                        className={`sky-pill ${database.online ? 'sky-pill-success' : 'sky-pill-warning'}`}
                      >
                        {database.online ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </td>
                    <td>{database.online ? formatDuration(database.latencyMs) : '—'}</td>
                    <td>{database.serverVersion || '—'}</td>
                    <td>{database.online ? 'Connection succeeded' : database.errorMessage || database.errorCode || 'Unavailable'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {condition || build ? (
        <>
          <div className="sky-page-kicker mb-2">Build gate and result</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Primary health gate</th>
                  <th>Target database</th>
                  <th>Build status</th>
                  <th>SQL files</th>
                  <th>Migrations</th>
                  <th>Seeds</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {condition ? (
                      <span className={`sky-pill ${condition.passed ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                        {condition.passed ? 'PASSED' : 'BLOCKED'}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="fw-semibold sky-mono">{build?.targetDatabase || '—'}</td>
                  <td>
                    <span className={`sky-pill ${operationOutcomeClass(build?.status)}`}>
                      {build?.status || '—'}
                    </span>
                  </td>
                  <td>
                    {Number(build?.sqlFilesExecuted || 0).toLocaleString()} /{' '}
                    {Number(build?.sqlFilesDiscovered || 0).toLocaleString()}
                  </td>
                  <td>
                    {Number(build?.migrationFilesExecuted || 0).toLocaleString()} /{' '}
                    {Number(build?.migrationFilesDiscovered || 0).toLocaleString()}
                  </td>
                  <td>
                    {Number(build?.seedFilesExecuted || 0).toLocaleString()} /{' '}
                    {Number(build?.seedFilesDiscovered || 0).toLocaleString()}
                  </td>
                  <td>{formatDuration(build?.durationMs)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {build ? (
            <div className="table-responsive sky-table-card mb-3">
              <table className="table table-sm sky-table align-middle mb-0">
                <tbody>
                  <tr>
                    <th>SQL roots</th>
                    <td colSpan="3" className="sky-mono text-break">
                      {getSafeArray(build.sqlRoots).join(', ') || '—'}
                    </td>
                  </tr>
                  <tr>
                    <th>First SQL file</th>
                    <td className="sky-mono text-break">{build.firstSqlFile || '—'}</td>
                    <th>Last SQL file</th>
                    <td className="sky-mono text-break">{build.lastSqlFile || '—'}</td>
                  </tr>
                  <tr>
                    <th>Last completed SQL file</th>
                    <td className="sky-mono text-break">
                      {build.lastCompletedSqlFile || '—'}
                    </td>
                    <th>Failed SQL file</th>
                    <td className="sky-mono text-break">{build.failedSqlFile || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      {comparison ? (
        <>
          <div className="sky-page-kicker mb-2">Database comparison</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Source objects</th>
                  <th>Built objects</th>
                  <th>Matched</th>
                  <th>Only in source</th>
                  <th>Only in built</th>
                  <th>Definition mismatches</th>
                  <th>Total differences</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className={`sky-pill ${operationOutcomeClass(comparison.status)}`}>
                      {comparison.status || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{Number(comparison.databaseAObjectCount || 0).toLocaleString()}</td>
                  <td>{Number(comparison.databaseBObjectCount || 0).toLocaleString()}</td>
                  <td className="fw-semibold">
                    {Number(comparison.matchedObjectCount || 0).toLocaleString()}
                  </td>
                  <td>{Number(comparison.onlyInDatabaseACount || 0).toLocaleString()}</td>
                  <td>{Number(comparison.onlyInDatabaseBCount || 0).toLocaleString()}</td>
                  <td>{Number(comparison.definitionMismatchCount || 0).toLocaleString()}</td>
                  <td className={comparison.totalDifferenceCount ? 'fw-semibold' : ''}>
                    {Number(comparison.totalDifferenceCount || 0).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {differenceTypes.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Difference distribution</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Object type</th>
                  <th>Only in source</th>
                  <th>Only in built</th>
                  <th>Definition mismatches</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {differenceTypes.map((item) => {
                  const total =
                    Number(item.onlyInDatabaseA || 0) +
                    Number(item.onlyInDatabaseB || 0) +
                    Number(item.definitionMismatches || 0);
                  return (
                    <tr key={item.objectType || JSON.stringify(item)}>
                      <td className="fw-semibold">{humanizeOutputKey(item.objectType)}</td>
                      <td>{Number(item.onlyInDatabaseA || 0).toLocaleString()}</td>
                      <td>{Number(item.onlyInDatabaseB || 0).toLocaleString()}</td>
                      <td>{Number(item.definitionMismatches || 0).toLocaleString()}</td>
                      <td className="fw-semibold">{total.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {differences.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Comparison differences</div>
            <span className="sky-pill sky-pill-warning">
              {differences.length}
              {comparison?.differenceDetailsTruncated ? '+' : ''} row(s)
            </span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Difference</th>
                  <th>Type</th>
                  <th>Object</th>
                  <th>Identity</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((difference, index) => (
                  <tr key={`${difference.objectType}-${difference.objectName}-${index}`}>
                    <td>{humanizeOutputKey(difference.kind)}</td>
                    <td>{humanizeOutputKey(difference.objectType)}</td>
                    <td className="sky-mono text-break">
                      {difference.schemaName ? `${difference.schemaName}.` : ''}
                      {difference.objectName || '—'}
                    </td>
                    <td className="sky-mono text-break">{difference.identity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : comparison?.comparisonCompleted ? (
        <div className="alert alert-success py-2 mb-3">
          The source and rebuilt databases contain matching PostgreSQL object definitions.
        </div>
      ) : null}

      {stages.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Workflow validation stages</div>
          <div className="table-responsive sky-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Node</th>
                  <th>Status</th>
                  <th>Outcome</th>
                  <th>Evidence</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage) => (
                  <tr key={`${stage.nodeKey}-${stage.stageCode}`}>
                    <td className="fw-semibold">{stage.label || humanizeOutputKey(stage.stageCode)}</td>
                    <td className="sky-mono">{stage.nodeKey || '—'}</td>
                    <td>
                      <span className={`sky-pill ${statusClass(stage.status)}`}>
                        {stage.status || 'UNKNOWN'}
                      </span>
                    </td>
                    <td>{stage.outcome || '—'}</td>
                    <td>{stage.evidence || '—'}</td>
                    <td>{formatDuration(stage.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function WorkflowSummaryNodeOutput({ summaryResult }) {
  const structuredResults = getSafeObject(
    summaryResult?.structuredResults || summaryResult?.output?.structuredResults,
  );
  const macroIngestion = getSafeObject(
    summaryResult?.macroIngestion || summaryResult?.output?.macroIngestion,
  );
  const macroSources = getSafeArray(macroIngestion.sources);
  const macroTotals = getSafeObject(macroIngestion.totals);
  const gitPromotion = getSafeObject(
    summaryResult?.gitPromotion ||
      summaryResult?.output?.gitPromotion ||
      structuredResults.gitPromotion,
    null,
  );
  const databaseSynchronization = getSafeObject(
    summaryResult?.databaseSynchronization ||
      summaryResult?.output?.databaseSynchronization ||
      structuredResults.databaseSynchronization,
    null,
  );
  const keyOutputs = getSafeObject(summaryResult?.keyOutputs || summaryResult?.output?.keyOutputs);
  const nodeSummaries = Object.values(keyOutputs);
  const warnings = getSafeArray(summaryResult?.warnings);
  const errors = getSafeArray(summaryResult?.errors);

  return (
    <div className="sky-workflow-summary-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Structured workflow summary</div>
          <h3 className="h6 mb-1">{summaryResult?.title || 'Workflow summary'}</h3>
          <p className="small sky-muted mb-0">
            {summaryResult?.summary || summaryResult?.message || 'Summary node completed.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${statusClass(summaryResult?.status || 'SUCCESS')}`}>
            {summaryResult?.status || 'SUCCESS'}
          </span>
          {structuredResults.resultCount !== undefined ? (
            <span className="sky-pill sky-pill-info">
              {structuredResults.resultCount} structured result(s)
            </span>
          ) : null}
          {macroSources.length > 0 ? (
            <span className={`sky-pill ${macroOutcomeClass(macroIngestion.outcome)}`}>
              {macroIngestion.outcome || 'UNKNOWN'}
            </span>
          ) : null}
          {gitPromotion ? (
            <span className={`sky-pill ${operationOutcomeClass(gitPromotion.outcome)}`}>
              {gitPromotion.outcome || 'UNKNOWN'}
            </span>
          ) : null}
          {databaseSynchronization ? (
            <span
              className={`sky-pill ${operationOutcomeClass(databaseSynchronization.outcome)}`}
            >
              {databaseSynchronization.outcome || 'UNKNOWN'}
            </span>
          ) : null}
        </div>
      </div>

      {gitPromotion ? <GitPromotionSummary promotion={gitPromotion} /> : null}
      {databaseSynchronization ? (
        <DatabaseSynchronizationSummary synchronization={databaseSynchronization} />
      ) : null}

      {macroSources.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Macro source results</div>
            <span className="sky-pill sky-pill-info">{macroSources.length} source(s)</span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Node</th>
                  <th>Outcome</th>
                  <th>Requested</th>
                  <th>Updated</th>
                  <th>Unchanged</th>
                  <th>Failed</th>
                  <th>Rows inserted</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {macroSources.map((source) => (
                  <tr key={`${source.nodeKey || source.sourceCode}-${source.sourceCode}`}>
                    <td className="fw-semibold">{source.sourceCode || 'Macro source'}</td>
                    <td className="sky-mono">{source.nodeKey || '—'}</td>
                    <td>
                      <span className={`sky-pill ${macroOutcomeClass(source.outcome)}`}>
                        {source.outcome || 'UNKNOWN'}
                      </span>
                    </td>
                    <td>{Number(source.totals?.indicatorsRequested || 0).toLocaleString()}</td>
                    <td>{Number(source.totals?.indicatorsUpdated || 0).toLocaleString()}</td>
                    <td>{Number(source.totals?.indicatorsUnchanged || 0).toLocaleString()}</td>
                    <td>{Number(source.totals?.indicatorsFailed || 0).toLocaleString()}</td>
                    <td className="fw-semibold">
                      {Number(source.totals?.rowsInserted || 0).toLocaleString()}
                    </td>
                    <td>{formatDuration(source.durationMs)}</td>
                  </tr>
                ))}
                <tr className="fw-semibold">
                  <td>Combined</td>
                  <td>{macroSources.length} nodes</td>
                  <td>
                    <span className={`sky-pill ${macroOutcomeClass(macroIngestion.outcome)}`}>
                      {macroIngestion.outcome || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{Number(macroTotals.indicatorsRequested || 0).toLocaleString()}</td>
                  <td>{Number(macroTotals.indicatorsUpdated || 0).toLocaleString()}</td>
                  <td>{Number(macroTotals.indicatorsUnchanged || 0).toLocaleString()}</td>
                  <td>{Number(macroTotals.indicatorsFailed || 0).toLocaleString()}</td>
                  <td>{Number(macroTotals.rowsInserted || 0).toLocaleString()}</td>
                  <td>{formatDuration(macroIngestion.durationMs)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {nodeSummaries.length > 0 && !databaseSynchronization ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Node result index</div>
            <span className="sky-pill sky-pill-info">{nodeSummaries.length} node(s)</span>
          </div>
          <div className="table-responsive sky-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Summary</th>
                  <th>Output contract</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {nodeSummaries.map((item) => (
                  <tr key={item.nodeKey || item.toolCode || item.summary}>
                    <td className="sky-mono">{item.nodeKey || '—'}</td>
                    <td>{humanizeOutputKey(item.kind || 'node output')}</td>
                    <td>
                      <span
                        className={`sky-pill ${statusClass(item.status || (item.success === false ? 'FAILED' : 'SUCCESS'))}`}
                      >
                        {item.status || (item.success === false ? 'FAILED' : 'SUCCESS')}
                      </span>
                    </td>
                    <td>{item.summary || '—'}</td>
                    <td className="sky-mono">{item.outputType || 'generic'}</td>
                    <td>{formatDuration(item.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {warnings.length > 0 || errors.length > 0 ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`warning-${index}`}>
              {typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}
            </div>
          ))}
          {errors.map((error, index) => (
            <div key={`error-${index}`}>{error?.message || String(error)}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getVisualNodeRun(node = {}, nodeRuns = []) {
  if (!node || !Array.isArray(nodeRuns)) {
    return null;
  }

  return (
    nodeRuns.find((nodeRun) => nodeRun?.nodeKey && nodeRun.nodeKey === node.nodeKey) ||
    nodeRuns.find(
      (nodeRun) =>
        node.workflowNodeId && nodeRun?.workflowNodeId === node.workflowNodeId,
    ) ||
    null
  );
}

function getVisualNodeApproval(node = {}, nodeRun = null, approvals = []) {
  if (!node || !Array.isArray(approvals)) {
    return null;
  }

  return (
    approvals.find(
      (approval) =>
        nodeRun?.workflowNodeRunRecordId &&
        approval?.workflowNodeRunRecordId === nodeRun.workflowNodeRunRecordId,
    ) ||
    approvals.find((approval) => approval?.nodeKey && approval.nodeKey === node.nodeKey) ||
    null
  );
}

function getVisualNodeRuntimeStatus(node = {}, nodeRuns = [], approvals = []) {
  const nodeRun = getVisualNodeRun(node, nodeRuns);
  const approval = getVisualNodeApproval(node, nodeRun, approvals);

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

function isVisualNodeCompleted(node = {}, nodeRuns = [], approvals = []) {
  return ['COMPLETED', 'SUCCESS', 'APPROVED'].includes(
    String(getVisualNodeRuntimeStatus(node, nodeRuns, approvals)).toUpperCase(),
  );
}

function WorkflowNodeParameterCard({
  approvals = [],
  nodeRuns = [],
  nodes = [],
  selectedNodeIndex = null,
}) {
  const hasSelection =
    Number.isInteger(selectedNodeIndex) &&
    selectedNodeIndex >= 0 &&
    selectedNodeIndex < nodes.length;
  const selectedNode = hasSelection ? nodes[selectedNodeIndex] : null;

  if (!selectedNode) {
    return null;
  }

  const inputParameters = getSafeObject(selectedNode.inputParameters);
  const parameterEntries = Object.entries(inputParameters);
  const runtimeStatus = getVisualNodeRuntimeStatus(selectedNode, nodeRuns, approvals);
  const displayName = selectedNode.displayName || selectedNode.nodeKey || 'Selected node';
  const configurationRows = [
    { field: 'Node key', fieldKey: 'nodeKey', value: selectedNode.nodeKey || '—' },
    {
      field: 'Node type',
      fieldKey: 'nodeTypeCode',
      value: humanizeOutputKey(selectedNode.nodeTypeCode || 'TOOL'),
    },
    {
      field: 'Target',
      fieldKey: 'targetCode',
      value: selectedNode.targetCode || 'Saved target defaults',
    },
    {
      field: 'Node timeout',
      fieldKey: 'timeoutMs',
      value: selectedNode.timeoutMs ? formatDuration(selectedNode.timeoutMs) : 'Default policy',
    },
    {
      field: 'Retry policy',
      fieldKey: 'retryPolicy',
      value:
        selectedNode.retryPolicy && Object.keys(getSafeObject(selectedNode.retryPolicy)).length > 0
          ? selectedNode.retryPolicy
          : 'Default policy',
    },
  ];

  return (
    <section className="sky-card mb-4">
      <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Node parameters</div>
          <h2 className="h5 mb-0">Node {selectedNodeIndex + 1} · {displayName}</h2>
          <p className="small sky-muted mb-0 mt-1">
            This node has not completed. Its saved configuration remains visible until runtime
            output becomes available.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2 small">
          <span className={`sky-pill ${statusClass(runtimeStatus)}`}>{runtimeStatus}</span>
          <span className="sky-pill sky-pill-info">
            {parameterEntries.length} input parameter(s)
          </span>
        </div>
      </div>
      <div className="sky-card-body">
        <div className="sky-page-kicker mb-2">Execution configuration</div>
        <div className="table-responsive sky-table-card mb-3">
          <table className="table table-sm sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {configurationRows.map((row) => (
                <tr key={row.fieldKey}>
                  <td className="fw-semibold">{row.field}</td>
                  <td className="sky-focused-node-output-value">
                    <FriendlyOutputScalar fieldKey={row.fieldKey} value={row.value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sky-page-kicker mb-2">Saved node input parameters</div>
        {parameterEntries.length > 0 ? (
          <div className="table-responsive sky-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Saved value</th>
                </tr>
              </thead>
              <tbody>
                {parameterEntries.map(([key, value]) => (
                  <tr key={key}>
                    <td className="fw-semibold">{humanizeOutputKey(key)}</td>
                    <td className="sky-focused-node-output-value">
                      <FriendlyOutputScalar fieldKey={key} value={value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sky-empty-state text-start">
            No node-level input parameters are saved. This node will use its target defaults.
          </div>
        )}
      </div>
    </section>
  );
}

function WorkflowNodeOutputLedger({
  outputs = [],
  contextValues = [],
  nodes = [],
  selectedNodeIndex = null,
}) {
  const hasSelection =
    Number.isInteger(selectedNodeIndex) &&
    selectedNodeIndex >= 0 &&
    selectedNodeIndex < nodes.length;
  const selectedNode = hasSelection ? nodes[selectedNodeIndex] : null;
  const selectedOutputs = selectedNode
    ? outputs.filter((output) => output.nodeKey === selectedNode.nodeKey)
    : [];
  const selectedContextValues = selectedNode
    ? contextValues.filter((item) => item.sourceNodeKey === selectedNode.nodeKey)
    : [];
  const rows = useMemo(
    () => buildFocusedNodeOutputRows({ outputs, contextValues, node: selectedNode }),
    [contextValues, outputs, selectedNode],
  );
  const structuredToolResult = useMemo(
    () => getFocusedToolResult(outputs, selectedNode?.nodeKey),
    [outputs, selectedNode?.nodeKey],
  );
  const workflowSummaryResult = useMemo(
    () => getFocusedWorkflowSummaryResult(outputs, selectedNode?.nodeKey),
    [outputs, selectedNode?.nodeKey],
  );
  const humanApprovalResult = useMemo(
    () => getFocusedHumanApprovalResult(outputs, selectedNode?.nodeKey),
    [outputs, selectedNode?.nodeKey],
  );
  const conditionResult = useMemo(
    () => getFocusedConditionResult(outputs, selectedNode?.nodeKey),
    [outputs, selectedNode?.nodeKey],
  );
  const macroIngestionResult =
    structuredToolResult?.outputType === 'macro_ingestion_summary.v1' ? structuredToolResult : null;
  const repositoryPackageResult =
    structuredToolResult?.outputType === 'repository_package_summary.v1'
      ? structuredToolResult
      : null;
  const repositoryMapResult =
    structuredToolResult?.outputType === 'repository_map_summary.v1' ? structuredToolResult : null;
  const gitRepositoryStatusResult =
    structuredToolResult?.outputType === 'git_repository_status.v1'
      ? structuredToolResult
      : null;
  const gitCommitResult =
    structuredToolResult?.outputType === 'git_commit_summary.v1' ? structuredToolResult : null;
  const gitBranchSyncResult =
    structuredToolResult?.outputType === 'git_branch_sync_summary.v1'
      ? structuredToolResult
      : null;
  const gitLocalSyncResult =
    structuredToolResult?.outputType === 'git_local_sync_summary.v1'
      ? structuredToolResult
      : null;
  const databaseHealthResult =
    structuredToolResult?.outputType === 'database_health_summary.v1'
      ? structuredToolResult
      : null;
  const databaseBuildResult =
    structuredToolResult?.outputType === 'database_build_summary.v1'
      ? structuredToolResult
      : null;
  const databaseComparisonResult =
    structuredToolResult?.outputType === 'postgresql_database_comparison_summary.v1'
      ? structuredToolResult
      : null;
  const summaryMacroSources = getSafeArray(
    workflowSummaryResult?.macroIngestion?.sources ||
      workflowSummaryResult?.output?.macroIngestion?.sources,
  );
  const displayName = selectedNode?.displayName || selectedNode?.nodeKey || 'Focused node';

  return (
    <section className="sky-card mb-4">
      <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Focused node output</div>
          <h2 className="h5 mb-0">
            {selectedNode
              ? `Node ${selectedNodeIndex + 1} · ${displayName}`
              : 'Select a workflow node'}
          </h2>
          <p className="small sky-muted mb-0 mt-1">
            Only node-specific result values not already shown in the runtime graph or run summary
            are displayed here.
          </p>
        </div>
        {selectedNode && (
          <div className="d-flex flex-wrap gap-2 small">
            <span className="sky-pill sky-pill-info">
              {selectedOutputs.length} output record(s)
            </span>
            {macroIngestionResult ? (
              <span className="sky-pill sky-pill-success">
                {getSafeArray(macroIngestionResult.output?.indicators).length} indicator result(s)
              </span>
            ) : repositoryPackageResult ? (
              <span className="sky-pill sky-pill-success">
                {Number(repositoryPackageResult.output?.filesIncluded || 0).toLocaleString()}{' '}
                file(s)
              </span>
            ) : repositoryMapResult ? (
              <span className="sky-pill sky-pill-success">
                {Number(repositoryMapResult.output?.filesDocumented || 0).toLocaleString()} file(s)
              </span>
            ) : gitRepositoryStatusResult ? (
              <span
                className={`sky-pill ${
                  gitRepositoryStatusResult.output?.readyForDevelopmentPromotion
                    ? 'sky-pill-success'
                    : 'sky-pill-warning'
                }`}
              >
                {gitRepositoryStatusResult.output?.readyForDevelopmentPromotion
                  ? 'Promotion ready'
                  : `${getSafeArray(gitRepositoryStatusResult.output?.blockers).length} blocker(s)`}
              </span>
            ) : gitCommitResult ? (
              <span className="sky-pill sky-pill-success">
                {Number(gitCommitResult.output?.changedFiles || 0).toLocaleString()} change(s)
              </span>
            ) : gitBranchSyncResult ? (
              <span className={`sky-pill ${operationOutcomeClass(gitBranchSyncResult.output?.outcome)}`}>
                {gitBranchSyncResult.output?.localHostSyncRequired
                  ? 'Host sync required'
                  : `${Number(gitBranchSyncResult.output?.commitsApplied || 0).toLocaleString()} commit(s) synchronized`}
              </span>
            ) : gitLocalSyncResult ? (
              <span className={`sky-pill ${operationOutcomeClass(gitLocalSyncResult.output?.outcome)}`}>
                {gitLocalSyncResult.output?.fourWaySynchronized
                  ? 'Four-way synchronized'
                  : gitLocalSyncResult.output?.outcome || 'Host sync'}
              </span>
            ) : databaseHealthResult ? (
              <span
                className={`sky-pill ${
                  databaseHealthResult.output?.allOnline ? 'sky-pill-success' : 'sky-pill-warning'
                }`}
              >
                {Number(databaseHealthResult.output?.onlineCount || 0).toLocaleString()} of{' '}
                {Number(databaseHealthResult.output?.requestedCount || 0).toLocaleString()} online
              </span>
            ) : databaseBuildResult ? (
              <span
                className={`sky-pill ${operationOutcomeClass(databaseBuildResult.output?.status)}`}
              >
                {Number(databaseBuildResult.output?.sqlFilesExecuted || 0).toLocaleString()} of{' '}
                {Number(databaseBuildResult.output?.sqlFilesDiscovered || 0).toLocaleString()} SQL file(s)
              </span>
            ) : databaseComparisonResult ? (
              <span
                className={`sky-pill ${operationOutcomeClass(databaseComparisonResult.output?.status)}`}
              >
                {Number(databaseComparisonResult.output?.totalDifferenceCount || 0).toLocaleString()}{' '}
                difference(s)
              </span>
            ) : conditionResult ? (
              <span
                className={`sky-pill ${conditionResult.passed ? 'sky-pill-success' : 'sky-pill-warning'}`}
              >
                {conditionResult.passed ? 'Condition passed' : 'Condition did not pass'}
              </span>
            ) : humanApprovalResult ? (
              <span className={`sky-pill ${operationOutcomeClass(humanApprovalResult.decision)}`}>
                {humanApprovalResult.decision || humanApprovalResult.status || 'UNKNOWN'}
              </span>
            ) : workflowSummaryResult ? (
              <span className="sky-pill sky-pill-success">
                {summaryMacroSources.length ||
                  Object.keys(getSafeObject(workflowSummaryResult.keyOutputs)).length}{' '}
                summarized node(s)
              </span>
            ) : (
              <span className="sky-pill sky-pill-success">{rows.length} unique value(s)</span>
            )}
          </div>
        )}
      </div>
      <div className="sky-card-body">
        {!selectedNode ? (
          <div className="sky-empty-state">
            Select a node in the Runtime Status Overlay to inspect that node&apos;s unique output.
          </div>
        ) : macroIngestionResult ? (
          <MacroIngestionOutput toolResult={macroIngestionResult} />
        ) : repositoryPackageResult ? (
          <RepositoryPackageOutput toolResult={repositoryPackageResult} />
        ) : repositoryMapResult ? (
          <RepositoryMapOutput toolResult={repositoryMapResult} />
        ) : gitRepositoryStatusResult ? (
          <GitRepositoryStatusOutput toolResult={gitRepositoryStatusResult} />
        ) : gitCommitResult ? (
          <GitCommitOutput toolResult={gitCommitResult} />
        ) : gitBranchSyncResult ? (
          <GitBranchSyncOutput toolResult={gitBranchSyncResult} />
        ) : gitLocalSyncResult ? (
          <GitLocalSyncOutput toolResult={gitLocalSyncResult} />
        ) : databaseHealthResult ? (
          <DatabaseHealthOutput toolResult={databaseHealthResult} />
        ) : databaseBuildResult ? (
          <DatabaseBuildOutput toolResult={databaseBuildResult} />
        ) : databaseComparisonResult ? (
          <DatabaseComparisonOutput toolResult={databaseComparisonResult} />
        ) : conditionResult ? (
          <ConditionEvaluationOutput conditionResult={conditionResult} />
        ) : humanApprovalResult ? (
          <HumanApprovalOutput approvalResult={humanApprovalResult} />
        ) : workflowSummaryResult ? (
          <WorkflowSummaryNodeOutput summaryResult={workflowSummaryResult} />
        ) : rows.length === 0 ? (
          <div className="sky-empty-state">
            No additional node-specific output was recorded. Status, attempts, duration, target, and
            summary details are already shown above.
          </div>
        ) : (
          <div className="table-responsive sky-table-card sky-focused-node-output-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.source}-${row.field}-${index}`}>
                    <td>
                      <span className="sky-pill sky-pill-info">{row.source}</span>
                    </td>
                    <td className="fw-semibold">{row.field}</td>
                    <td className="sky-focused-node-output-value">
                      <FriendlyOutputScalar fieldKey={row.fieldKey} value={row.value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selectedNode &&
        !macroIngestionResult &&
        !repositoryPackageResult &&
        !repositoryMapResult &&
        !gitRepositoryStatusResult &&
        !gitCommitResult &&
        !gitBranchSyncResult &&
        !gitLocalSyncResult &&
        !databaseHealthResult &&
        !databaseBuildResult &&
        !databaseComparisonResult &&
        !conditionResult &&
        !humanApprovalResult &&
        !workflowSummaryResult &&
        selectedContextValues.length > 0 &&
        rows.length === 0 ? (
          <div className="small sky-muted mt-2">
            {selectedContextValues.length} runtime context value(s) were omitted because they repeat
            graph telemetry or persisted output.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function WorkflowRunTreeNode({ node, selectedRunId, onOpenRun }) {
  if (!node?.run) {
    return null;
  }

  const run = node.run;
  const childNodesByParentKey = new Map();

  for (const child of node.children || []) {
    const key = child.parentNodeKey || child.run?.parentNodeKey || '__unknown__';
    const current = childNodesByParentKey.get(key) || [];
    current.push(child);
    childNodesByParentKey.set(key, current);
  }

  return (
    <div
      className={`sky-worker-command-card ${run.workflowRunRecordId === selectedRunId ? 'sky-selected-row' : ''}`}
    >
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
        <div>
          <div className="sky-page-kicker">
            {node.depth === 0 ? 'Root workflow' : `Child workflow · depth ${node.depth}`}
          </div>
          <div className="fw-bold">{run.workflowDisplayName || run.workflowCode}</div>
          <div className="small sky-mono sky-muted">{run.workflowCode}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {run.workflowRunRecordId === selectedRunId && (
            <span className="sky-pill sky-pill-info">Selected</span>
          )}
          <span className={`sky-pill ${statusClass(run.status)}`}>{run.status}</span>
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 mt-2 small">
        <span className="sky-pill sky-pill-info">
          Started {formatDate(run.startedAt || run.createdAt)}
        </span>
        <span className="sky-pill sky-pill-info">
          Duration {formatDuration(getRunDurationMs(run))}
        </span>
        {run.temporalWorkflowId && (
          <span className="sky-pill sky-pill-success">Temporal-backed</span>
        )}
        {run.childWorkflow && <span className="sky-pill sky-pill-warning">Child</span>}
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mt-2 small">
        <span className="sky-muted">
          Run <span className="sky-mono">{run.workflowRunRecordId}</span>
        </span>
        {run.workflowRunRecordId !== selectedRunId && onOpenRun && (
          <button
            className="btn btn-sm sky-btn-ghost"
            onClick={() => onOpenRun(run.workflowRunRecordId)}
            type="button"
          >
            Open run
          </button>
        )}
      </div>

      {(node.nodeRuns || []).length > 0 && (
        <div className="mt-3 d-flex flex-column gap-2">
          {(node.nodeRuns || []).map((nodeRun, index) => {
            const childNodes = childNodesByParentKey.get(nodeRun.nodeKey) || [];

            return (
              <div
                className="border rounded p-2"
                key={
                  nodeRun.workflowNodeRunRecordId || `${run.workflowRunRecordId}-${nodeRun.nodeKey}`
                }
              >
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                  <div>
                    <div className="sky-page-kicker">
                      Node {index + 1} · {nodeRun.nodeTypeCode}
                    </div>
                    <div className="fw-semibold">
                      {nodeRun.metadata?.displayName || nodeRun.nodeKey}
                    </div>
                    <div className="small sky-muted">{nodeRun.targetCode || 'No target'}</div>
                  </div>
                  <span className={`sky-pill ${statusClass(nodeRun.status)}`}>
                    {nodeRun.status}
                  </span>
                </div>
                {getNodeOutputSummary(nodeRun.output) && (
                  <div className="small sky-muted mt-1">{getNodeOutputSummary(nodeRun.output)}</div>
                )}
                {childNodes.length > 0 && (
                  <div className="mt-2 ms-3 d-flex flex-column gap-2">
                    {childNodes.map((child) => (
                      <WorkflowRunTreeNode
                        key={child.run.workflowRunRecordId}
                        node={child}
                        onOpenRun={onOpenRun}
                        selectedRunId={selectedRunId}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(node.children || []).filter((child) => !child.parentNodeKey).length > 0 && (
        <div className="mt-3 ms-3 d-flex flex-column gap-2">
          {(node.children || [])
            .filter((child) => !child.parentNodeKey)
            .map((child) => (
              <WorkflowRunTreeNode
                key={child.run.workflowRunRecordId}
                node={child}
                onOpenRun={onOpenRun}
                selectedRunId={selectedRunId}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function WorkflowRunTreePanel({ tree, selectedRunId, onOpenRun }) {
  if (!tree?.run) {
    return (
      <section className="sky-card mb-4">
        <div className="sky-card-header">
          <div className="sky-page-kicker">Run tree</div>
          <h2 className="h5 mb-0">Workflow family</h2>
        </div>
        <div className="sky-card-body">
          <div className="sky-empty-state">
            Select a workflow run to inspect parent/child relationships.
          </div>
        </div>
      </section>
    );
  }

  const flattened = flattenRunTree(tree, []);
  const childCount = Math.max(0, flattened.length - 1);

  return (
    <section className="sky-card mb-4">
      <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Run tree</div>
          <h2 className="h5 mb-0">Workflow family</h2>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className="sky-pill sky-pill-info">{flattened.length} run(s)</span>
          <span className="sky-pill sky-pill-info">{childCount} child run(s)</span>
        </div>
      </div>
      <div className="sky-card-body">
        <WorkflowRunTreeNode node={tree} onOpenRun={onOpenRun} selectedRunId={selectedRunId} />
      </div>
    </section>
  );
}

function TemporalRuntimePanel({ runtime }) {
  if (!runtime) {
    return (
      <section className="sky-card mb-4">
        <div className="sky-card-header">
          <div className="sky-page-kicker">Temporal runtime</div>
          <h2 className="h5 mb-0">Execution diagnostics</h2>
        </div>
        <div className="sky-card-body">
          <div className="sky-empty-state">
            Select a Temporal-backed run to inspect runtime details.
          </div>
        </div>
      </section>
    );
  }

  const history = runtime.history || {};
  const diagnostics = runtime.diagnostics || {};
  const links = runtime.links || {};
  const activityCounts = history.activityCounts || {};
  const workflowTaskCounts = history.workflowTaskCounts || {};
  const signalCounts = history.signalCounts || {};
  const issueSummary = history.issueSummary || {};
  const latestEvents = history.latestEvents || [];
  const notableEvents = history.notableEvents || [];
  const issueEvents = history.issueEvents || [];
  const issueTotal = issueSummary.total || 0;

  return (
    <section className="sky-card mb-4">
      <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Temporal runtime</div>
          <h2 className="h5 mb-0">Execution diagnostics</h2>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${statusClass(runtime.status || 'UNKNOWN')}`}>
            {runtime.status || 'UNKNOWN'}
          </span>
          {(links.workflow || runtime.uiUrl) && (
            <a
              className="btn btn-sm sky-btn-ghost"
              href={links.workflow || runtime.uiUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open workflow
            </a>
          )}
          {links.history && (
            <a
              className="btn btn-sm sky-btn-ghost"
              href={links.history}
              rel="noreferrer"
              target="_blank"
            >
              Open history
            </a>
          )}
          {links.query && (
            <a
              className="btn btn-sm sky-btn-ghost"
              href={links.query}
              rel="noreferrer"
              target="_blank"
            >
              Search Temporal
            </a>
          )}
        </div>
      </div>
      <div className="sky-card-body">
        {runtime.warnings?.length > 0 && (
          <div className="alert alert-warning py-2">{runtime.warnings.join(' ')}</div>
        )}

        <div className="row g-2 mb-3">
          <div className="col-md-3 col-6">
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Namespace</div>
              <div className="sky-mini-metric-value sky-mono small">{runtime.namespace || '—'}</div>
            </div>
          </div>
          <div className="col-md-3 col-6">
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Task queue</div>
              <div className="sky-mini-metric-value sky-mono small">{runtime.taskQueue || '—'}</div>
            </div>
          </div>
          <div className="col-md-3 col-6">
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">History events</div>
              <div className="sky-mini-metric-value">
                {history.eventCount || runtime.historyLength || '—'}
              </div>
            </div>
          </div>
          <div className="col-md-3 col-6">
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Issues</div>
              <div className="sky-mini-metric-value">{issueTotal}</div>
            </div>
          </div>
        </div>

        <div className="sky-temporal-id-grid mb-3">
          <TemporalIdentifierCard
            label="Workflow ID"
            href={links.workflow || runtime.uiUrl}
            value={runtime.workflowId}
          />
          <TemporalIdentifierCard
            label="Run ID"
            href={links.history || links.workflow || runtime.uiUrl}
            value={runtime.runId}
          />
          <TemporalIdentifierCard label="Workflow type" value={runtime.workflowType} />
          <TemporalIdentifierCard label="Address" value={runtime.address || diagnostics.address} />
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3 small">
          <span className="sky-pill sky-pill-info">
            Workflow tasks {workflowTaskCounts.completed || 0}/{workflowTaskCounts.scheduled || 0}
          </span>
          <span className="sky-pill sky-pill-success">
            Activities completed {activityCounts.completed || 0}
          </span>
          {(activityCounts.failed || activityCounts.timedOut || activityCounts.canceled) > 0 && (
            <span className="sky-pill sky-pill-danger">
              Activity issues{' '}
              {(activityCounts.failed || 0) +
                (activityCounts.timedOut || 0) +
                (activityCounts.canceled || 0)}
            </span>
          )}
          {Object.keys(signalCounts).map((signalName) => (
            <span className="sky-pill sky-pill-info" key={signalName}>
              Signal {signalName}: {signalCounts[signalName]}
            </span>
          ))}
          {history.truncated && (
            <span className="sky-pill sky-pill-warning">History preview truncated</span>
          )}
        </div>

        <TemporalCliCommands commands={diagnostics.cliCommands} />

        {issueEvents.length > 0 && (
          <TemporalEventTable
            emptyText="No issue events found."
            events={issueEvents}
            title="Issue events"
          />
        )}

        {notableEvents.length > 0 && (
          <TemporalEventTable
            emptyText="No notable Temporal events found."
            events={notableEvents}
            title="Notable events"
          />
        )}

        <TemporalEventTable
          emptyText="No Temporal event preview available."
          events={latestEvents}
          title="Latest events"
        />
      </div>
    </section>
  );
}

function SkyWorkflows({ mode = 'start' }) {
  const { hasPermission, hasRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canStart = hasPermission('WORKFLOW_RUN');
  const canCancelRun = hasPermission('WORKFLOW_RUN');
  const canTerminateRun = hasPermission('WORKFLOW_RUN');
  const canDecideApproval = hasPermission('WORKFLOW_APPROVAL_DECIDE');

  const [definitions, setDefinitions] = useState([]);
  const [selectedDefinition, setSelectedDefinition] = useState(null);
  const [selectedDefinitionDetail, setSelectedDefinitionDetail] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRunDetail, setSelectedRunDetail] = useState(null);
  const [filters, setFilters] = useState(() => ({
    q: (searchParams.get('runId') || '').trim(),
    status: '',
    runtime: normalizeRuntimeFilter(searchParams.get('runtime')),
  }));
  const [historyPage, setHistoryPage] = useState(1);
  const [startWorkflowFilters, setStartWorkflowFilters] = useState(
    DEFAULT_START_WORKFLOW_FILTERS,
  );
  const [startWorkflowPage, setStartWorkflowPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [runActionLoading, setRunActionLoading] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedRuntimeNodeIndex, setSelectedRuntimeNodeIndex] = useState(null);
  const [followActiveRuntimeNode, setFollowActiveRuntimeNode] = useState(true);
  const [runtimeParameterValues, setRuntimeParameterValues] = useState({});
  const [repositoryOptions, setRepositoryOptions] = useState([]);
  const [runtimeParameterError, setRuntimeParameterError] = useState('');
  const [runDetailOverlayOpen, setRunDetailOverlayOpen] = useState(false);
  const [approvalOverlayRequest, setApprovalOverlayRequest] = useState(null);
  const [approvalResumePollingUntil, setApprovalResumePollingUntil] = useState(0);
  const [telemetryState, setTelemetryState] = useState({
    activeRunCount: 0,
    consecutiveErrors: 0,
    error: '',
    intervalMs: HISTORY_POLL_IDLE_MS,
    lastErrorAt: null,
    lastSuccessfulAt: null,
    lastUpdatedAt: null,
    selectedRunActive: false,
    warning: '',
  });
  const telemetryPollingRef = useRef(false);
  const completionFocusRef = useRef({
    applied: false,
    runId: null,
    wasActive: false,
  });
  const approvalPauseFocusRef = useRef({
    approvalRequestId: null,
    runId: null,
  });
  const requestedRunId = (searchParams.get('runId') || '').trim();

  useEffect(() => {
    if (!requestedRunId) return;
    setFilters((current) =>
      current.q === requestedRunId ? current : { ...current, q: requestedRunId },
    );
    setHistoryPage(1);
    setSelectedRunDetail(null);
  }, [requestedRunId]);

  const selectedRun = selectedRunDetail?.run || null;
  const selectedNodeRuns = selectedRunDetail?.nodeRuns || [];
  const selectedNodeOutputs = selectedRunDetail?.nodeOutputs || [];
  const selectedContextValues = selectedRunDetail?.contextValues || [];
  const selectedApprovals = selectedRunDetail?.approvals || [];
  const pendingApproval = selectedApprovals.find(
    (approval) => String(approval?.status || '').toUpperCase() === 'PENDING',
  ) || null;
  const workflowApprovalPaused = Boolean(isActiveRun(selectedRun) && pendingApproval);
  const workflowSelectionLocked = Boolean(isActiveRun(selectedRun) && !workflowApprovalPaused);
  const selectedTemporalRuntime = getTemporalRuntime(selectedRunDetail);
  const selectedRelations = selectedRunDetail?.relations || {};
  const runtimeParameters = useMemo(
    () =>
      normalizeRuntimeParameterDefinitions(selectedDefinitionDetail || selectedDefinition || {}),
    [selectedDefinition, selectedDefinitionDetail],
  );
  const runtimeVisualNodes = selectedRunDetail?.definitionGraph?.nodes?.length
    ? selectedRunDetail.definitionGraph.nodes
    : selectedDefinitionDetail?.nodes?.length
      ? selectedDefinitionDetail.nodes
      : selectedNodeRuns;
  const isHistoryMode = mode === 'history';

  function handleRuntimeNodeSelect(index, options = {}) {
    if (workflowSelectionLocked && !options.followActiveNode) {
      return;
    }

    setSelectedRuntimeNodeIndex(index);

    // Manual inspection must remain under user control whenever execution is
    // paused for approval or the run is terminal. Only telemetry-driven
    // selection keeps follow mode enabled.
    if (!options.followActiveNode) {
      setFollowActiveRuntimeNode(false);
    }
  }

  function handleApprovalReview(approval, nodeIndex) {
    if (!approval) {
      return;
    }

    setSelectedRuntimeNodeIndex(nodeIndex);
    setFollowActiveRuntimeNode(false);
    setApprovalOverlayRequest(approval);
  }

  async function handleApprovalDecisionComplete(result, sourceApproval) {
    const resolvedApproval = result?.approval || {
      ...sourceApproval,
      status: result?.output?.status || 'APPROVED',
    };
    const runId = selectedRun?.workflowRunRecordId || sourceApproval?.workflowRunRecordId;

    setApprovalResumePollingUntil(Date.now() + APPROVAL_RESUME_FAST_WINDOW_MS);
    setFollowActiveRuntimeNode(true);
    setMessage(result?.message || `Approval ${String(resolvedApproval.status || 'approved').toLowerCase()}.`);
    setSelectedRunDetail((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        approvals: (current.approvals || []).map((approval) =>
          approval.approvalRequestId === resolvedApproval.approvalRequestId
            ? { ...approval, ...resolvedApproval }
            : approval,
        ),
      };
    });

    if (runId) {
      loadRunDetail(runId, { quiet: true, telemetry: true });
    }
  }

  useEffect(() => {
    if (!runDetailOverlayOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRunDetailOverlayOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [runDetailOverlayOpen]);

  const runStats = useMemo(() => {
    const completed = runs.filter((run) => run.status === 'COMPLETED').length;
    const running = runs.filter(
      (run) => run.status === 'RUNNING' || run.status === 'QUEUED',
    ).length;
    const failed = runs.filter(
      (run) => run.status === 'FAILED' || run.status === 'TERMINATED',
    ).length;

    return { completed, running, failed };
  }, [runs]);

  const historyRuns = useMemo(
    () => runs.filter(
      (run) =>
        runMatchesRuntimeFilter(run, filters.runtime) &&
        runMatchesHistorySearch(run, filters.q),
    ),
    [filters.q, filters.runtime, runs],
  );
  const historyPageCount = Math.max(1, Math.ceil(historyRuns.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const historyPageStart = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pagedHistoryRuns = historyRuns.slice(
    historyPageStart,
    historyPageStart + HISTORY_PAGE_SIZE,
  );
  const historyRangeStart = historyRuns.length === 0 ? 0 : historyPageStart + 1;
  const historyRangeEnd = Math.min(historyPageStart + HISTORY_PAGE_SIZE, historyRuns.length);
  const filteredStartDefinitions = useMemo(() => {
    const searchText = startWorkflowFilters.q.trim().toLowerCase();

    return definitions.filter((definition) => {
      const nodeCount = getDefinitionNodeCount(definition);
      const parameterCount = getDefinitionRuntimeParameterCount(definition);

      if (
        startWorkflowFilters.structure &&
        getDefinitionStructure(definition) !== startWorkflowFilters.structure
      ) {
        return false;
      }

      if (startWorkflowFilters.parameterMode === 'with' && parameterCount === 0) {
        return false;
      }

      if (startWorkflowFilters.parameterMode === 'without' && parameterCount > 0) {
        return false;
      }

      if (startWorkflowFilters.nodeScale === 'small' && (nodeCount < 1 || nodeCount > 5)) {
        return false;
      }

      if (startWorkflowFilters.nodeScale === 'medium' && (nodeCount < 6 || nodeCount > 10)) {
        return false;
      }

      if (startWorkflowFilters.nodeScale === 'large' && nodeCount < 11) {
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
  }, [definitions, startWorkflowFilters]);
  const startWorkflowPageCount = Math.max(
    1,
    Math.ceil(filteredStartDefinitions.length / START_WORKFLOW_PAGE_SIZE),
  );
  const safeStartWorkflowPage = Math.min(startWorkflowPage, startWorkflowPageCount);
  const startWorkflowPageStart =
    (safeStartWorkflowPage - 1) * START_WORKFLOW_PAGE_SIZE;
  const visibleStartDefinitions = filteredStartDefinitions.slice(
    startWorkflowPageStart,
    startWorkflowPageStart + START_WORKFLOW_PAGE_SIZE,
  );
  const startWorkflowRangeStart =
    filteredStartDefinitions.length === 0 ? 0 : startWorkflowPageStart + 1;
  const startWorkflowRangeEnd = Math.min(
    startWorkflowPageStart + START_WORKFLOW_PAGE_SIZE,
    filteredStartDefinitions.length,
  );

  async function loadDefinitions({ keepSelection = true } = {}) {
    const [result, catalogResult] = await Promise.all([
      workflowService.listDefinitions(),
      mode === 'start' ? workflowService.getBuilderCatalog() : Promise.resolve(null),
    ]);
    const items = result.items || [];
    setDefinitions(items);

    if (catalogResult) {
      setRepositoryOptions(catalogResult.repositoryOptions || []);
    }

    const preservedSelection =
      keepSelection && selectedDefinition
        ? items.find((item) => item.workflowCode === selectedDefinition.workflowCode)
        : null;
    const nextSelection = preservedSelection || (items[0] || null);

    setSelectedDefinition(nextSelection);

    if (nextSelection) {
      const detail = await workflowService.getDefinition(nextSelection.workflowCode);
      setSelectedDefinitionDetail(detail.definition);
    } else {
      setSelectedDefinitionDetail(null);
    }
  }

  async function loadRuns(nextFilters = filters, { keepSelection = true } = {}) {
    const query = {
      limit: HISTORY_LOAD_LIMIT,
      status: nextFilters.status,
    };
    const result = await workflowService.listRuns(query);
    const items = result.items || [];
    setRuns(items);

    if (keepSelection && selectedRun?.workflowRunRecordId) {
      const stillVisible = items.find(
        (item) => item.workflowRunRecordId === selectedRun.workflowRunRecordId,
      );

      if (stillVisible) {
        await loadRunDetail(stillVisible.workflowRunRecordId);
        return items;
      }
    }

    if (!keepSelection) {
      setSelectedRunDetail(null);
    }

    return items;
  }

  async function loadPage({ keepSelection = true } = {}) {
    setLoading(true);
    setError('');

    try {
      // Workflow Operations refreshes only the execution ledger/detail. Reloading the
      // definition catalogue here is unnecessary and can transiently desynchronize the
      // selected run from its graph while a manual refresh is in flight. Start Workflow
      // still refreshes definitions because its catalogue is part of that page's surface.
      if (!isHistoryMode) {
        await loadDefinitions({ keepSelection });
      }

      const loadedRuns = (await loadRuns(filters, { keepSelection })) || [];

      if (isHistoryMode) {
        const refreshedAt = new Date().toISOString();
        setTelemetryState((current) => ({
          ...current,
          activeRunCount: loadedRuns.filter(isActiveRun).length,
          error: '',
          lastSuccessfulAt: refreshedAt,
          lastUpdatedAt: refreshedAt,
          warning: '',
        }));
      }
    } catch (loadError) {
      setError(formatApiError(loadError, 'Failed to load workflows.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDefinitionDetail(definition) {
    setError('');
    setSelectedDefinition(definition);

    try {
      const detail = await workflowService.getDefinition(definition.workflowCode);
      setSelectedDefinitionDetail(detail.definition);
    } catch (loadError) {
      setError(formatApiError(loadError, 'Failed to load workflow definition.'));
    }
  }

  async function handleDefinitionSelect(workflowCode) {
    const definition = definitions.find((item) => item.workflowCode === workflowCode) || null;

    setSelectedRunDetail(null);
    setSelectedRuntimeNodeIndex(null);
    setFollowActiveRuntimeNode(true);
    setMessage('');
    setRuntimeParameterError('');

    if (!definition) {
      setSelectedDefinition(null);
      setSelectedDefinitionDetail(null);
      return;
    }

    setSelectedDefinitionDetail(null);
    await loadDefinitionDetail(definition);
  }

  async function loadRunDetail(
    workflowRunRecordId,
    { quiet = false, telemetry = isHistoryMode } = {},
  ) {
    if (!workflowRunRecordId) {
      return null;
    }

    if (!quiet) {
      setError('');
    }

    try {
      const detail = telemetry
        ? await workflowService.getRunTelemetry(workflowRunRecordId)
        : await workflowService.getRun(workflowRunRecordId);
      setSelectedRunDetail(detail);

      if (detail.run?.workflowCode && !quiet) {
        const definitionDetail = await workflowService.getDefinition(detail.run.workflowCode);
        setSelectedDefinitionDetail(definitionDetail.definition);
      }

      return detail;
    } catch (loadError) {
      if (!quiet) {
        setError(formatApiError(loadError, 'Failed to load workflow run detail.'));
      }
      return null;
    }
  }

  async function refreshWorkflowHistoryTelemetry({ quiet = true } = {}) {
    if (!isHistoryMode || telemetryPollingRef.current) {
      return null;
    }

    telemetryPollingRef.current = true;

    try {
      const result = await workflowService.listRuns({
        limit: HISTORY_LOAD_LIMIT,
        status: filters.status,
      });
      const items = result.items || [];
      const activeRunCount = items.filter(isActiveRun).length;
      const visibleRuns = items.filter(
        (run) =>
          runMatchesRuntimeFilter(run, filters.runtime) &&
          runMatchesHistorySearch(run, filters.q),
      );
      const visiblePageCount = Math.max(1, Math.ceil(visibleRuns.length / HISTORY_PAGE_SIZE));
      const visibleCurrentPage = Math.min(historyPage, visiblePageCount);
      const visiblePageStart = (visibleCurrentPage - 1) * HISTORY_PAGE_SIZE;
      const visiblePageRuns = visibleRuns.slice(
        visiblePageStart,
        visiblePageStart + HISTORY_PAGE_SIZE,
      );
      const selectedRunId = selectedRun?.workflowRunRecordId;
      const selectedVisibleRun = selectedRunId
        ? visiblePageRuns.find((run) => run.workflowRunRecordId === selectedRunId)
        : null;
      const nextSelectedRun = selectedVisibleRun || visiblePageRuns[0] || null;
      let refreshedDetail = null;

      setRuns(items);

      if (nextSelectedRun) {
        refreshedDetail = await loadRunDetail(nextSelectedRun.workflowRunRecordId, {
          quiet: true,
          telemetry: true,
        });
      } else {
        setSelectedRunDetail(null);
      }

      const selectedRunActive = isActiveRun(refreshedDetail?.run || nextSelectedRun);
      const approvalResumeFast = selectedRunActive && approvalResumePollingUntil > Date.now();
      const nextIntervalMs = approvalResumeFast
        ? APPROVAL_RESUME_POLL_MS
        : getWorkflowHistoryPollingDelay({
            activeRunCount,
            hidden: document.visibilityState === 'hidden',
            selectedRunActive,
          });

      const successfulAt = new Date().toISOString();

      setTelemetryState({
        activeRunCount,
        consecutiveErrors: 0,
        error: '',
        intervalMs: nextIntervalMs,
        lastErrorAt: null,
        lastSuccessfulAt: successfulAt,
        lastUpdatedAt: successfulAt,
        selectedRunActive,
        warning: '',
      });

      return {
        activeRunCount,
        intervalMs: nextIntervalMs,
        selectedRunActive,
      };
    } catch (pollError) {
      const errorMessage = formatApiError(pollError, 'Workflow telemetry refresh failed.');

      if (!quiet) {
        setError(errorMessage);
      }

      setTelemetryState((current) => {
        const consecutiveErrors = Number(current.consecutiveErrors || 0) + 1;

        return {
          ...current,
          consecutiveErrors,
          error: consecutiveErrors >= 2 ? errorMessage : '',
          lastErrorAt: new Date().toISOString(),
          warning: errorMessage,
        };
      });

      return null;
    } finally {
      telemetryPollingRef.current = false;
    }
  }

  async function handleStartWorkflow(event) {
    event.preventDefault();

    if (!selectedDefinitionDetail || !canStart) {
      return;
    }

    setStarting(true);
    setError('');
    setMessage('');
    setRuntimeParameterError('');
    setSelectedRuntimeNodeIndex(null);
    setFollowActiveRuntimeNode(true);

    try {
      const params = parseRuntimeParameterValues(runtimeParameters, runtimeParameterValues);
      const result = await workflowService.startWorkflow(selectedDefinitionDetail.workflowCode, {
        input: {
          runSource: 'manual',
          triggerType: 'MANUAL',
          params,
          runtimeParameters: params,
        },
      });

      // A successful launch consumes the operator-entered values. Clearing them here
      // prevents an accidental second execution with the same repository/message/etc.
      // Validation failures intentionally keep the form populated so they can be corrected.
      setRuntimeParameterValues(getClearedRuntimeParameterValues(runtimeParameters));
      setRuntimeParameterError('');

      setMessage(
        result.started
          ? result.message || result.run?.summary || 'Workflow started through Temporal.'
          : result.ok
            ? result.run?.summary || 'Workflow completed.'
            : result.error || 'Workflow failed.',
      );
      setSelectedRunDetail({ run: result.run, nodeRuns: result.nodeRuns || [] });
      await loadRuns(filters, { keepSelection: false });
      if (result.run?.workflowRunRecordId) {
        await loadRunDetail(result.run.workflowRunRecordId, { telemetry: true });
      }
    } catch (startError) {
      const messageText = formatApiError(startError, 'Failed to start workflow.');
      setRuntimeParameterError(messageText);
      setError(messageText);
    } finally {
      setStarting(false);
    }
  }

  async function handleCancelRun() {
    if (!selectedRun || !canCancelRun || !isActiveRun(selectedRun)) {
      return;
    }

    const confirmed = window.confirm(
      'Cancel this workflow run? Temporal will receive a graceful cancellation request when available.',
    );

    if (!confirmed) {
      return;
    }

    setRunActionLoading('cancel');
    setError('');
    setMessage('');

    try {
      const result = await workflowService.cancelRun(selectedRun.workflowRunRecordId, {
        reason: 'Canceled from SkyCommand Workflow Operations.',
      });
      setMessage(result.message || 'Workflow run canceled.');
      await loadRuns(filters, { keepSelection: true });
      await loadRunDetail(result.run?.workflowRunRecordId || selectedRun.workflowRunRecordId);
    } catch (actionError) {
      setError(formatApiError(actionError, 'Failed to cancel workflow run.'));
    } finally {
      setRunActionLoading('');
    }
  }

  async function handleTerminateRun() {
    if (!selectedRun || !canTerminateRun || !isActiveRun(selectedRun)) {
      return;
    }

    const reason = window.prompt(
      'Terminate this workflow run? Add a cleanup reason:',
      'Terminated from SkyCommand Workflow Operations.',
    );

    if (reason === null) {
      return;
    }

    setRunActionLoading('terminate');
    setError('');
    setMessage('');

    try {
      const result = await workflowService.terminateRun(selectedRun.workflowRunRecordId, {
        reason,
      });
      setMessage(result.message || 'Workflow run terminated.');
      await loadRuns(filters, { keepSelection: true });
      await loadRunDetail(result.run?.workflowRunRecordId || selectedRun.workflowRunRecordId);
    } catch (actionError) {
      setError(formatApiError(actionError, 'Failed to terminate workflow run.'));
    } finally {
      setRunActionLoading('');
    }
  }

  async function handleRetryRun() {
    if (!selectedRun || !canStart || !isRetryableRun(selectedRun)) {
      return;
    }

    const confirmed = window.confirm(
      'Retry this workflow run using the same saved input and current published workflow definition?',
    );

    if (!confirmed) {
      return;
    }

    setRunActionLoading('retry');
    setError('');
    setMessage('');

    try {
      const result = await workflowService.retryRun(selectedRun.workflowRunRecordId);
      setMessage(result.message || 'Workflow retry started.');
      await loadRuns(filters, { keepSelection: false });
      if (result.run?.workflowRunRecordId) {
        await loadRunDetail(result.run.workflowRunRecordId, { telemetry: true });
      }
    } catch (actionError) {
      setError(formatApiError(actionError, 'Failed to retry workflow run.'));
    } finally {
      setRunActionLoading('');
    }
  }

  function updateFilter(name, value) {
    const nextFilters = { ...filters, [name]: value };
    setFilters(nextFilters);
    setHistoryPage(1);
    setSelectedRunDetail(null);

    if (name === 'runtime' || name === 'q') {
      if (name === 'q' && searchParams.has('runId')) {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.delete('runId');
        setSearchParams(nextSearchParams, { replace: true });
      }

      if (name === 'runtime') {
        const nextSearchParams = new URLSearchParams(searchParams);

        if (value === 'skycommand') {
          nextSearchParams.delete('runtime');
        } else {
          nextSearchParams.set('runtime', value);
        }

        setSearchParams(nextSearchParams, { replace: true });
      }
      return;
    }

    loadRuns(nextFilters, { keepSelection: false });
  }

  function clearHistoryFilters() {
    const nextFilters = { q: '', status: '', runtime: 'skycommand' };
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete('runtime');
    nextSearchParams.delete('runId');
    setSearchParams(nextSearchParams, { replace: true });
    setFilters(nextFilters);
    setHistoryPage(1);
    setSelectedRunDetail(null);
    loadRuns(nextFilters, { keepSelection: false });
  }

  async function openWorkflowDetails(workflowRunRecordId) {
    const detail = await loadRunDetail(workflowRunRecordId);

    if (detail) {
      setRunDetailOverlayOpen(true);
    }
  }

  useEffect(() => {
    loadPage({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedRuntimeNodeIndex(null);
    setApprovalOverlayRequest(null);

    if (isActiveRun(selectedRun)) {
      setFollowActiveRuntimeNode(!pendingApproval);
    }

    completionFocusRef.current = {
      applied: false,
      runId: selectedRun?.workflowRunRecordId || null,
      wasActive: isActiveRun(selectedRun),
    };
    approvalPauseFocusRef.current = {
      approvalRequestId: null,
      runId: selectedRun?.workflowRunRecordId || null,
    };
  }, [selectedRun?.workflowRunRecordId]);

  useEffect(() => {
    const runId = selectedRun?.workflowRunRecordId || null;

    if (!workflowApprovalPaused || !pendingApproval) {
      approvalPauseFocusRef.current = {
        approvalRequestId: null,
        runId,
      };
      return;
    }

    setFollowActiveRuntimeNode(false);

    const approvalRequestId =
      pendingApproval.approvalRequestId ||
      pendingApproval.workflowApprovalId ||
      pendingApproval.nodeKey ||
      'pending-approval';
    const approvalFocusAlreadyApplied =
      approvalPauseFocusRef.current.runId === runId &&
      approvalPauseFocusRef.current.approvalRequestId === approvalRequestId;
    const approvalNodeIndex = runtimeVisualNodes.findIndex(
      (node) => node.nodeKey && node.nodeKey === pendingApproval.nodeKey,
    );

    if (approvalNodeIndex >= 0 && !approvalFocusAlreadyApplied) {
      setSelectedRuntimeNodeIndex(approvalNodeIndex);
      approvalPauseFocusRef.current = {
        approvalRequestId,
        runId,
      };
    }
  }, [
    pendingApproval?.approvalRequestId,
    pendingApproval?.nodeKey,
    pendingApproval?.workflowApprovalId,
    runtimeVisualNodes,
    selectedRun?.workflowRunRecordId,
    workflowApprovalPaused,
  ]);

  useEffect(() => {
    if (!selectedRun?.workflowRunRecordId) {
      return;
    }

    const runId = selectedRun.workflowRunRecordId;
    let focusState = completionFocusRef.current;

    if (focusState.runId !== runId) {
      focusState = {
        applied: false,
        runId,
        wasActive: isActiveRun(selectedRun),
      };
      completionFocusRef.current = focusState;
    }

    if (isActiveRun(selectedRun)) {
      focusState.wasActive = true;
      focusState.applied = false;
      return;
    }

    const normalizedRunStatus = String(selectedRun.status || '').toUpperCase();
    const completedStartRun = !isHistoryMode
      && ['COMPLETED', 'SUCCESS'].includes(normalizedRunStatus);
    const shouldApplyTerminalFocus = isHistoryMode
      ? focusState.wasActive
      : completedStartRun;

    if (!shouldApplyTerminalFocus || focusState.applied) {
      return;
    }

    const expectedCompletedNodeCount = Number(selectedRun.metadata?.completedNodeCount || 0);

    if (
      Number.isFinite(expectedCompletedNodeCount) &&
      expectedCompletedNodeCount > 0 &&
      selectedNodeRuns.length < expectedCompletedNodeCount
    ) {
      return;
    }

    const finalNodeIndex = getLastExecutedVisualNodeIndex(runtimeVisualNodes, selectedNodeRuns);

    if (finalNodeIndex < 0) {
      return;
    }

    setSelectedRuntimeNodeIndex(finalNodeIndex);
    focusState.applied = true;
  }, [
    followActiveRuntimeNode,
    isHistoryMode,
    runtimeVisualNodes,
    selectedNodeRuns,
    selectedRun?.metadata?.completedNodeCount,
    selectedRun?.status,
    selectedRun?.workflowRunRecordId,
  ]);

  useEffect(() => {
    setRuntimeParameterValues(getInitialRuntimeParameterValues(runtimeParameters));
    setRuntimeParameterError('');
  }, [selectedDefinitionDetail?.workflowCode]);

  useEffect(() => {
    if (startWorkflowPage > startWorkflowPageCount) {
      setStartWorkflowPage(startWorkflowPageCount);
    }
  }, [startWorkflowPage, startWorkflowPageCount]);

  useEffect(() => {
    if (isHistoryMode) {
      return;
    }

    if (filteredStartDefinitions.length === 0) {
      if (selectedDefinition) {
        setSelectedDefinition(null);
        setSelectedDefinitionDetail(null);
        setSelectedRunDetail(null);
        setSelectedRuntimeNodeIndex(null);
        setRuntimeParameterError('');
      }
      return;
    }

    const selectionVisible = selectedDefinition
      ? filteredStartDefinitions.some(
          (definition) => definition.workflowCode === selectedDefinition.workflowCode,
        )
      : false;

    if (!selectionVisible) {
      handleDefinitionSelect(filteredStartDefinitions[0].workflowCode);
    }
  }, [filteredStartDefinitions, isHistoryMode, selectedDefinition]);

  useEffect(() => {
    if (historyPage > historyPageCount) {
      setHistoryPage(historyPageCount);
    }
  }, [historyPage, historyPageCount]);

  useEffect(() => {
    if (!isHistoryMode || loading || pagedHistoryRuns.length === 0) {
      return;
    }

    const selectedRunId = selectedRun?.workflowRunRecordId;
    const selectedRunIsVisible = pagedHistoryRuns.some(
      (run) => run.workflowRunRecordId === selectedRunId,
    );

    if (!selectedRunIsVisible) {
      loadRunDetail(pagedHistoryRuns[0].workflowRunRecordId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHistoryMode, loading, pagedHistoryRuns, selectedRun?.workflowRunRecordId]);

  useEffect(() => {
    if (!isHistoryMode) {
      return undefined;
    }

    let canceled = false;
    let timerId = null;

    async function pollWorkflowHistory() {
      const pollResult = await refreshWorkflowHistoryTelemetry({ quiet: true });

      if (canceled) {
        return;
      }

      const fallbackActiveRunCount = runs.filter(isActiveRun).length;
      const fallbackSelectedRunActive = isActiveRun(selectedRun);
      const delay =
        pollResult?.intervalMs ||
        getWorkflowHistoryPollingDelay({
          activeRunCount: pollResult?.activeRunCount ?? fallbackActiveRunCount,
          hidden: document.visibilityState === 'hidden',
          selectedRunActive: pollResult?.selectedRunActive ?? fallbackSelectedRunActive,
        });

      timerId = window.setTimeout(pollWorkflowHistory, delay);
    }

    const initialDelay = isActiveRun(selectedRun) && approvalResumePollingUntil > Date.now()
      ? APPROVAL_RESUME_POLL_MS
      : getWorkflowHistoryPollingDelay({
          activeRunCount: runs.filter(isActiveRun).length,
          hidden: document.visibilityState === 'hidden',
          selectedRunActive: isActiveRun(selectedRun),
        });

    setTelemetryState((current) => ({
      ...current,
      intervalMs: initialDelay,
    }));

    timerId = window.setTimeout(pollWorkflowHistory, initialDelay);

    return () => {
      canceled = true;

      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isHistoryMode,
    filters.q,
    filters.status,
    filters.runtime,
    selectedRun?.workflowRunRecordId,
    selectedRun?.status,
    approvalResumePollingUntil,
  ]);

  useEffect(() => {
    if (isHistoryMode || !selectedRun?.workflowRunRecordId || !isActiveRun(selectedRun)) {
      return undefined;
    }

    let canceled = false;
    let timerId = null;

    async function pollStartedWorkflow() {
      const detail = await loadRunDetail(selectedRun.workflowRunRecordId, {
        quiet: true,
        telemetry: true,
      });

      if (canceled) {
        return;
      }

      const stillActive = isActiveRun(detail?.run || selectedRun);
      const delay = stillActive
        ? approvalResumePollingUntil > Date.now()
          ? APPROVAL_RESUME_POLL_MS
          : HISTORY_POLL_SELECTED_ACTIVE_MS
        : HISTORY_POLL_IDLE_MS;

      setTelemetryState((current) => ({
        ...current,
        activeRunCount: stillActive ? 1 : 0,
        error: '',
        intervalMs: delay,
        lastUpdatedAt: new Date().toISOString(),
        selectedRunActive: stillActive,
      }));

      if (stillActive) {
        timerId = window.setTimeout(pollStartedWorkflow, delay);
      }
    }

    timerId = window.setTimeout(
      pollStartedWorkflow,
      approvalResumePollingUntil > Date.now()
        ? APPROVAL_RESUME_POLL_MS
        : HISTORY_POLL_SELECTED_ACTIVE_MS,
    );

    return () => {
      canceled = true;

      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    approvalResumePollingUntil,
    isHistoryMode,
    selectedRun?.workflowRunRecordId,
    selectedRun?.status,
  ]);

  function renderSelectedRunDetailContent() {
    if (!selectedRun) {
      return <div className="sky-empty-state py-4">Select a workflow run to inspect it.</div>;
    }

    return (
      <>
        <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
          <span className={`sky-pill ${statusClass(selectedRun.status)}`}>
            {selectedRun.status}
          </span>
          <span className="small sky-muted">{formatDuration(getRunDurationMs(selectedRun))}</span>
        </div>
        <dl className="row small mb-3">
          <dt className="col-4 sky-detail-label">Workflow</dt>
          <dd className="col-8 sky-detail-value">
            {selectedRun.workflowDisplayName || selectedRun.workflowCode}
          </dd>
          <dt className="col-4 sky-detail-label">Run</dt>
          <dd className="col-8 sky-detail-value sky-mono text-break">
            {selectedRun.workflowRunRecordId}
          </dd>
          {selectedRelations.parentRun && (
            <>
              <dt className="col-4 sky-detail-label">Parent</dt>
              <dd className="col-8 sky-detail-value">
                <button
                  className="btn btn-link btn-sm p-0 align-baseline"
                  onClick={() => loadRunDetail(selectedRelations.parentRun.workflowRunRecordId)}
                  type="button"
                >
                  {selectedRelations.parentRun.workflowDisplayName ||
                    selectedRelations.parentRun.workflowCode}
                </button>
                {selectedRun.parentNodeKey && (
                  <div className="small sky-muted sky-mono">via {selectedRun.parentNodeKey}</div>
                )}
              </dd>
            </>
          )}
          {(selectedRelations.childRuns || []).length > 0 && (
            <>
              <dt className="col-4 sky-detail-label">Children</dt>
              <dd className="col-8 sky-detail-value">
                <span className="sky-pill sky-pill-info">
                  {selectedRelations.childRuns.length} child run(s)
                </span>
              </dd>
            </>
          )}
          {selectedApprovals.length > 0 && (
            <>
              <dt className="col-4 sky-detail-label">Approvals</dt>
              <dd className="col-8 sky-detail-value">
                <span className="sky-pill sky-pill-warning">
                  {selectedApprovals.filter((approval) => approval.status === 'PENDING').length}{' '}
                  pending
                </span>
                <span className="sky-pill sky-pill-info ms-1">
                  {selectedApprovals.length} total
                </span>
              </dd>
            </>
          )}
          <dt className="col-4 sky-detail-label">Started</dt>
          <dd className="col-8 sky-detail-value">
            {formatDate(selectedRun.startedAt || selectedRun.createdAt)}
          </dd>
          <dt className="col-4 sky-detail-label">Completed</dt>
          <dd className="col-8 sky-detail-value">{formatDate(selectedRun.completedAt)}</dd>
          <dt className="col-4 sky-detail-label">Source</dt>
          <dd className="col-8 sky-detail-value sky-mono">{selectedRun.runSource}</dd>
          <dt className="col-4 sky-detail-label">Runtime params</dt>
          <dd className="col-8 sky-detail-value">
            {Object.keys(getSafeObject(selectedRun.input?.params)).length > 0 ? (
              <span className="sky-pill sky-pill-info">
                {Object.keys(getSafeObject(selectedRun.input.params)).length} parameter(s)
              </span>
            ) : (
              '—'
            )}
          </dd>
          <dt className="col-4 sky-detail-label">Started by</dt>
          <dd className="col-8 sky-detail-value">
            {selectedRun.startedByDisplayName || selectedRun.startedByEmail || '—'}
          </dd>
          <dt className="col-4 sky-detail-label">Executor</dt>
          <dd className="col-8 sky-detail-value sky-mono">
            {selectedRun.metadata?.executor || '—'}
          </dd>
          <dt className="col-4 sky-detail-label">Temporal workflow</dt>
          <dd className="col-8 sky-detail-value sky-mono text-break">
            {selectedRun.temporalWorkflowId || '—'}
          </dd>
          <dt className="col-4 sky-detail-label">Temporal run</dt>
          <dd className="col-8 sky-detail-value sky-mono text-break">
            {selectedRun.temporalRunId || '—'}
          </dd>
          <dt className="col-4 sky-detail-label">Runtime</dt>
          <dd className="col-8 sky-detail-value">
            {selectedRun.temporalWorkflowId ? (
              <span className="sky-pill sky-pill-success">Temporal-backed</span>
            ) : (
              <span className="sky-pill sky-pill-info">Inline/local</span>
            )}
          </dd>
          <dt className="col-4 sky-detail-label">Temporal status</dt>
          <dd className="col-8 sky-detail-value">
            <span
              className={`sky-pill ${statusClass(selectedTemporalRuntime?.status || selectedRun.status)}`}
            >
              {selectedTemporalRuntime?.status || selectedRun.status || '—'}
            </span>
          </dd>
          <dt className="col-4 sky-detail-label">History events</dt>
          <dd className="col-8 sky-detail-value">
            {selectedTemporalRuntime?.history?.eventCount ||
              selectedTemporalRuntime?.historyLength ||
              '—'}
          </dd>
          {selectedTemporalRuntime?.uiUrl && (
            <>
              <dt className="col-4 sky-detail-label">Temporal UI</dt>
              <dd className="col-8 sky-detail-value">
                <a href={selectedTemporalRuntime.uiUrl} rel="noreferrer" target="_blank">
                  Open diagnostics
                </a>
              </dd>
            </>
          )}
        </dl>
        <WorkflowRunControls
          busyAction={runActionLoading}
          canCancel={canCancelRun}
          canRetry={canStart}
          canTerminate={canTerminateRun}
          onCancel={handleCancelRun}
          onRetry={handleRetryRun}
          onTerminate={handleTerminateRun}
          run={selectedRun}
        />
        <p className="sky-muted small">{selectedRun.summary || 'No summary.'}</p>
        <pre className="sky-code-block sky-worker-json-preview">{jsonPreview(selectedRun)}</pre>
      </>
    );
  }

  function renderSelectedRunDetailOverlay() {
    if (!runDetailOverlayOpen) {
      return null;
    }

    return createPortal(
      <div
        aria-modal="true"
        className="sky-chart-modal-backdrop sky-run-detail-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setRunDetailOverlayOpen(false);
          }
        }}
        role="dialog"
      >
        <section
          className="sky-chart-modal sky-run-detail-modal"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="sky-chart-modal-header">
            <div>
              <div className="sky-page-kicker sky-chart-modal-kicker">Run detail</div>
              <h2>Selected workflow</h2>
              <p>
                Review run identity, runtime source, controls, Temporal diagnostics, and raw
                metadata without compressing the workflow map.
              </p>
            </div>
            <button
              aria-label="Close run detail"
              autoFocus
              className="sky-chart-modal-close"
              onClick={() => setRunDetailOverlayOpen(false)}
              type="button"
            >
              <svg aria-hidden="true" className="sky-chart-modal-close-icon" viewBox="0 0 24 24">
                <path d="M6.5 6.5l11 11" />
                <path d="M17.5 6.5l-11 11" />
              </svg>
            </button>
          </div>
          <div className="sky-run-detail-modal-body">{renderSelectedRunDetailContent()}</div>
        </section>
      </div>,
      document.body,
    );
  }

  function updateStartWorkflowFilter(name, value) {
    setStartWorkflowFilters((current) => ({ ...current, [name]: value }));
    setStartWorkflowPage(1);
  }

  function clearStartWorkflowFilters() {
    setStartWorkflowFilters(DEFAULT_START_WORKFLOW_FILTERS);
    setStartWorkflowPage(1);
  }

  function goToStartWorkflowPage(page) {
    setStartWorkflowPage(
      Math.min(Math.max(1, Number(page) || 1), startWorkflowPageCount),
    );
  }

  function renderStartWorkflowPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {startWorkflowRangeStart}-{startWorkflowRangeEnd} of{' '}
          {filteredStartDefinitions.length} available workflow(s)
        </div>
        <div className="sky-pagination-controls" aria-label="Start workflow pagination">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeStartWorkflowPage <= 1}
            onClick={() => goToStartWorkflowPage(1)}
            type="button"
          >
            First
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeStartWorkflowPage <= 1}
            onClick={() => goToStartWorkflowPage(safeStartWorkflowPage - 1)}
            type="button"
          >
            Back
          </button>
          <label className="sky-pagination-select-label" htmlFor="startWorkflowPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            id="startWorkflowPageSelect"
            onChange={(event) => goToStartWorkflowPage(event.target.value)}
            value={safeStartWorkflowPage}
          >
            {Array.from({ length: startWorkflowPageCount }, (_, index) => index + 1).map(
              (page) => (
                <option key={page} value={page}>
                  {page}
                </option>
              ),
            )}
          </select>
          <span className="small sky-muted">of {startWorkflowPageCount}</span>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeStartWorkflowPage >= startWorkflowPageCount}
            onClick={() => goToStartWorkflowPage(safeStartWorkflowPage + 1)}
            type="button"
          >
            Next
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeStartWorkflowPage >= startWorkflowPageCount}
            onClick={() => goToStartWorkflowPage(startWorkflowPageCount)}
            type="button"
          >
            Last
          </button>
        </div>
      </div>
    );
  }

  function renderHistoryPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {historyRangeStart}-{historyRangeEnd} of {historyRuns.length} workflow run(s)
        </div>
        <div className="sky-pagination-controls" aria-label="Workflow history pagination">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={currentHistoryPage <= 1}
            onClick={() => setHistoryPage(1)}
            type="button"
          >
            First
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={currentHistoryPage <= 1}
            onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
            type="button"
          >
            Back
          </button>
          <label className="sky-pagination-select-label" htmlFor="workflowHistoryPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            id="workflowHistoryPageSelect"
            onChange={(event) => setHistoryPage(Number(event.target.value) || 1)}
            value={currentHistoryPage}
          >
            {Array.from({ length: historyPageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
          <span className="small sky-muted">of {historyPageCount}</span>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={currentHistoryPage >= historyPageCount}
            onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))}
            type="button"
          >
            Next
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={currentHistoryPage >= historyPageCount}
            onClick={() => setHistoryPage(historyPageCount)}
            type="button"
          >
            Last
          </button>
        </div>
      </div>
    );
  }

  function renderHistoryView() {
    return (
      <div className="sky-workflow-history-shell">
        <section className="sky-card mb-4 sky-workflow-history-browser">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Run browser</div>
              <h2 className="h5 mb-0">Workflow operations data</h2>
              <p className="sky-muted small mb-0">
                Select the execution surface and status, then inspect a run in the detail workspace
                below.
              </p>
              {telemetryState.warning && !telemetryState.error && (
                <div className="small sky-muted mt-2">
                  Last poll warning: {telemetryState.warning}
                </div>
              )}
              {telemetryState.error && (
                <div className="small text-warning-emphasis mt-2">{telemetryState.error}</div>
              )}
            </div>
            <div className="sky-history-browser-filter-grid">
              <div className="sky-run-tools-search-filter">
                <label className="form-label" htmlFor="workflowHistorySearch">
                  Search
                </label>
                <input
                  className="form-control sky-form-control"
                  id="workflowHistorySearch"
                  onChange={(event) => updateFilter('q', event.target.value)}
                  placeholder="Workflow, code, status, summary..."
                  type="search"
                  value={filters.q}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="workflowHistoryRuntime">
                  Runtime source
                </label>
                <select
                  className="form-select sky-form-control"
                  id="workflowHistoryRuntime"
                  onChange={(event) => updateFilter('runtime', event.target.value)}
                  value={filters.runtime}
                >
                  {RUNTIME_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="workflowHistoryStatus">
                  Status
                </label>
                <select
                  className="form-select sky-form-control"
                  id="workflowHistoryStatus"
                  onChange={(event) => updateFilter('status', event.target.value)}
                  value={filters.status}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sky-run-tools-filter-actions">
                <button
                  className="btn btn-sm sky-btn-ghost"
                  onClick={clearHistoryFilters}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            </div>
          </div>
          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-workflow-history-table-card">
            <table className="table table-sm table-hover sky-table align-middle">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Completed</th>
                  <th>Runtime</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="7">
                      <div className="sky-empty-state">Loading workflow runs...</div>
                    </td>
                  </tr>
                )}
                {!loading && historyRuns.length === 0 && (
                  <tr>
                    <td colSpan="7">
                      <div className="sky-empty-state">
                        No workflow runs found for these filters.
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  pagedHistoryRuns.map((run) => (
                    <tr
                      className={`sky-clickable-row ${selectedRun?.workflowRunRecordId === run.workflowRunRecordId ? 'sky-selected-row' : ''}`}
                      key={run.workflowRunRecordId}
                      onClick={() => loadRunDetail(run.workflowRunRecordId)}
                    >
                      <td>
                        <div className="fw-bold">{run.workflowDisplayName || run.workflowCode}</div>
                        <div className="small sky-mono sky-muted">{run.workflowCode}</div>
                        {(getRunRelationLabel(run) || run.metadata?.parentWorkflowRunRecordId) && (
                          <div className="d-flex flex-wrap gap-1 mt-1">
                            {getRunRelationLabel(run) && (
                              <span className="sky-pill sky-pill-warning">
                                {getRunRelationLabel(run)}
                              </span>
                            )}
                            {run.metadata?.parentWorkflowRunRecordId && (
                              <span className="sky-pill sky-pill-info">Has parent</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`sky-pill ${statusClass(run.status)}`}>{run.status}</span>
                      </td>
                      <td>{formatDate(run.startedAt || run.createdAt)}</td>
                      <td>{formatDuration(getRunDurationMs(run))}</td>
                      <td>{formatDate(run.completedAt)}</td>
                      <td>
                        {run.temporalWorkflowId ? (
                          <span className="sky-pill sky-pill-success">Temporal-backed</span>
                        ) : (
                          <span className="sky-pill sky-pill-info">Inline/local</span>
                        )}
                      </td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            openWorkflowDetails(run.workflowRunRecordId);
                          }}
                          type="button"
                        >
                          Workflow Details
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {renderHistoryPagination()}
        </section>

        <section className="sky-card sky-workflow-history-detail-zone">
          <div className="sky-card-header d-flex flex-wrap align-items-end justify-content-between gap-2">
            <div>
              <div className="sky-page-kicker">Selected run workspace</div>
              <h2 className="h5 mb-0">Execution detail</h2>
            </div>
            <div className="small sky-muted">
              Detail panels scroll independently from the run browser.
            </div>
          </div>

          <div className="sky-card-body sky-workflow-history-detail-stack">
            {!selectedRun ? (
              <div className="sky-empty-state">
                Select a workflow run to view the runtime graph overlay.
              </div>
            ) : (
              <WorkflowVisualGraph
                approvals={selectedApprovals}
                headingKicker="Runtime status overlay"
                followActiveNode={followActiveRuntimeNode}
                inspectorMode="navigation"
                nodeRuns={selectedNodeRuns}
                nodes={runtimeVisualNodes}
                onFollowActiveNodeChange={setFollowActiveRuntimeNode}
                onApprovalReview={handleApprovalReview}
                onNodeSelect={handleRuntimeNodeSelect}
                runStatus={selectedTemporalRuntime?.status || selectedRun.status}
                runtimeMode
                selectedNodeIndex={selectedRuntimeNodeIndex}
                subtitle="Read-only execution overlay showing node outcomes, pending approvals, errors, and condition or approval branch decisions for the selected run."
                temporalRuntime={selectedTemporalRuntime}
                title="Runtime workflow map"
              />
            )}

            {Number.isInteger(selectedRuntimeNodeIndex)
            && selectedRuntimeNodeIndex >= 0
            && selectedRuntimeNodeIndex < runtimeVisualNodes.length ? (
              isVisualNodeCompleted(
                runtimeVisualNodes[selectedRuntimeNodeIndex],
                selectedNodeRuns,
                selectedApprovals,
              ) ? (
                <WorkflowNodeOutputLedger
                  contextValues={selectedContextValues}
                  nodes={runtimeVisualNodes}
                  outputs={selectedNodeOutputs}
                  selectedNodeIndex={selectedRuntimeNodeIndex}
                />
              ) : (
                <WorkflowNodeParameterCard
                  approvals={selectedApprovals}
                  nodeRuns={selectedNodeRuns}
                  nodes={runtimeVisualNodes}
                  selectedNodeIndex={selectedRuntimeNodeIndex}
                />
              )
            ) : (
              <WorkflowNodeOutputLedger
                contextValues={selectedContextValues}
                nodes={runtimeVisualNodes}
                outputs={selectedNodeOutputs}
                selectedNodeIndex={selectedRuntimeNodeIndex}
              />
            )}
          </div>
        </section>
      </div>
    );
  }

  const pageKicker = isHistoryMode ? 'Workflows · Operations' : 'Workflows · Start';
  const pageTitle = isHistoryMode ? 'Workflow Operations' : 'Start Workflow';
  const pageSubtitle = isHistoryMode
    ? 'Inspect SkyCommand workflow runs, node outcomes, and the executor ledger.'
    : 'Start approved SkyCommand workflow definitions built from tools, Temporal templates, APIs, agents, and future node types.';

  return (
    <div>
      <PageHeader
        actionClassName={isHistoryMode ? 'sky-dashboard-page-actions' : ''}
        actions={
          isHistoryMode ? (
            <DashboardRefreshActions
              activeLabel="Active runs"
              activeValue={telemetryState.activeRunCount}
              lastRefreshAt={telemetryState.lastSuccessfulAt || telemetryState.lastUpdatedAt}
              loading={loading || Boolean(runActionLoading)}
              onRefresh={() => loadPage()}
              pollingState={telemetryState}
            />
          ) : (
            <button
              className="btn sky-btn-ghost"
              disabled={loading || starting || Boolean(runActionLoading)}
              onClick={() => loadPage()}
              type="button"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          )
        }
        kicker={pageKicker}
        subtitle={pageSubtitle}
        title={pageTitle}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      {isHistoryMode ? (
        renderHistoryView()
      ) : (
        <div className="sky-workflow-start-workspace d-flex flex-column gap-4">
          <section className="sky-card sky-functional-history-browser sky-run-tools-browser sky-workflow-start-browser">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Workflow browser</div>
                <h2 className="h5 mb-0">Available workflows</h2>
                <p className="sky-muted small mb-0">
                  Search and filter the published workflow catalogue, then select a row to review
                  its runtime parameters and launch controls below.
                </p>
              </div>
              <div className="sky-run-tools-filter-grid sky-workflow-start-filter-grid">
                <div className="sky-run-tools-search-filter">
                  <label className="form-label" htmlFor="startWorkflowSearchFilter">
                    Search
                  </label>
                  <input
                    className="form-control sky-form-control"
                    id="startWorkflowSearchFilter"
                    onChange={(event) => updateStartWorkflowFilter('q', event.target.value)}
                    placeholder="Name, code, description..."
                    type="search"
                    value={startWorkflowFilters.q}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="startWorkflowStructureFilter">
                    Structure
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="startWorkflowStructureFilter"
                    onChange={(event) =>
                      updateStartWorkflowFilter('structure', event.target.value)
                    }
                    value={startWorkflowFilters.structure}
                  >
                    <option value="">All structures</option>
                    <option value="single">Single node</option>
                    <option value="sequential">Sequential</option>
                    <option value="branching">Branching</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="startWorkflowParameterFilter">
                    Runtime parameters
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="startWorkflowParameterFilter"
                    onChange={(event) =>
                      updateStartWorkflowFilter('parameterMode', event.target.value)
                    }
                    value={startWorkflowFilters.parameterMode}
                  >
                    <option value="">All workflows</option>
                    <option value="with">With parameters</option>
                    <option value="without">Without parameters</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="startWorkflowNodeScaleFilter">
                    Node count
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="startWorkflowNodeScaleFilter"
                    onChange={(event) =>
                      updateStartWorkflowFilter('nodeScale', event.target.value)
                    }
                    value={startWorkflowFilters.nodeScale}
                  >
                    <option value="">Any size</option>
                    <option value="small">1-5 nodes</option>
                    <option value="medium">6-10 nodes</option>
                    <option value="large">11+ nodes</option>
                  </select>
                </div>
                <div className="sky-run-tools-filter-actions">
                  <button
                    className="btn btn-sm sky-btn-ghost"
                    onClick={clearStartWorkflowFilters}
                    type="button"
                  >
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
                    <th>Structure</th>
                    <th>Nodes</th>
                    <th>Edges</th>
                    <th>Runtime parameters</th>
                    <th>Published version</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStartDefinitions.length === 0 ? (
                    <tr>
                      <td colSpan="7">
                        <div className="sky-empty-state">
                          No workflows match the current filters.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    visibleStartDefinitions.map((definition) => {
                      const selected =
                        selectedDefinition?.workflowCode === definition.workflowCode;

                      return (
                        <tr
                          className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                          key={definition.workflowDefinitionId || definition.workflowCode}
                          onClick={() => handleDefinitionSelect(definition.workflowCode)}
                        >
                          <td>
                            <div className="fw-bold sky-detail-value">
                              {definition.displayName}
                            </div>
                            <div className="small sky-mono sky-muted">
                              {definition.workflowCode}
                            </div>
                          </td>
                          <td>{getDefinitionStructureLabel(definition)}</td>
                          <td>{getDefinitionNodeCount(definition)}</td>
                          <td>{getDefinitionEdgeCount(definition)}</td>
                          <td>{getDefinitionRuntimeParameterCount(definition)}</td>
                          <td>{definition.publishedVersionNumber || '—'}</td>
                          <td>
                            <span className="sky-pill sky-pill-success">
                              {definition.status || 'ACTIVE'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {renderStartWorkflowPagination()}
          </section>

          {selectedDefinition && (
            <>
              <section className="sky-card sky-workflow-start-config-card">
                <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
                  <div>
                    <div className="sky-page-kicker">Workflow configuration</div>
                    <h2 className="h5 mb-1">
                      {selectedDefinitionDetail?.displayName || selectedDefinition.displayName}
                    </h2>
                    <div className="small sky-muted sky-mono">
                      {selectedDefinition.workflowCode}
                    </div>
                  </div>
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <span
                      className={`sky-pill ${statusClass(
                        selectedDefinitionDetail?.status || selectedDefinition.status,
                      )}`}
                    >
                      {selectedDefinitionDetail?.status || selectedDefinition.status || 'ACTIVE'}
                    </span>
                    <span className="sky-pill sky-pill-info">
                      {selectedDefinitionDetail?.nodes?.length ||
                        getDefinitionNodeCount(selectedDefinition)}{' '}
                      node(s)
                    </span>
                    <span className="sky-pill sky-pill-info">
                      {getDefinitionEdgeCount(selectedDefinitionDetail || selectedDefinition)} edge(s)
                    </span>
                    <span className="sky-pill sky-pill-info">
                      {runtimeParameters.length} runtime param(s)
                    </span>
                  </div>
                </div>
                <form className="sky-card-body" onSubmit={handleStartWorkflow}>
                  <div className="sky-run-tool-description mb-4">
                    <div className="sky-detail-label">Purpose</div>
                    <div className="sky-detail-value">
                      {selectedDefinitionDetail?.description ||
                        selectedDefinition.description ||
                        'No workflow description.'}
                    </div>
                  </div>

                  {runtimeParameters.length > 0 ? (
                    <div className="row g-3 mb-3">
                      {runtimeParameters.map((parameter) => {
                        const inputId = `runtime-param-${parameter.key}`;
                        const value = runtimeParameterValues[parameter.key] ?? '';
                        const parameterOptions = getRuntimeParameterOptions(
                          parameter,
                          repositoryOptions,
                        );

                        if (parameter.type === 'boolean') {
                          return (
                            <div className="col-12" key={parameter.key}>
                              <div className="form-check form-switch">
                                <input
                                  checked={Boolean(value)}
                                  className="form-check-input"
                                  id={inputId}
                                  onChange={(event) =>
                                    setRuntimeParameterValues((current) => ({
                                      ...current,
                                      [parameter.key]: event.target.checked,
                                    }))
                                  }
                                  type="checkbox"
                                />
                                <label className="form-check-label" htmlFor={inputId}>
                                  {parameter.label}
                                </label>
                              </div>
                              {parameter.description && (
                                <div className="form-text sky-muted">
                                  {parameter.description}
                                </div>
                              )}
                            </div>
                          );
                        }

                        return (
                          <div className="col-lg-6" key={parameter.key}>
                            <label className="form-label" htmlFor={inputId}>
                              {parameter.label}
                              {parameter.required && (
                                <span className="text-danger ms-1">*</span>
                              )}
                            </label>
                            {parameter.type === 'select' || parameter.type === 'repo' ? (
                              <select
                                className="form-select sky-form-control"
                                id={inputId}
                                onChange={(event) =>
                                  setRuntimeParameterValues((current) => ({
                                    ...current,
                                    [parameter.key]: event.target.value,
                                  }))
                                }
                                required={parameter.required}
                                value={String(value)}
                              >
                                <option value="">
                                  {parameter.prompt || `Select ${parameter.label}`}
                                </option>
                                {parameterOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : parameter.type === 'json' ? (
                              <textarea
                                className="form-control sky-form-control sky-mono"
                                id={inputId}
                                onChange={(event) =>
                                  setRuntimeParameterValues((current) => ({
                                    ...current,
                                    [parameter.key]: event.target.value,
                                  }))
                                }
                                placeholder={parameter.prompt || '{ }'}
                                required={parameter.required}
                                rows={4}
                                value={String(value)}
                              />
                            ) : (
                              <input
                                className="form-control sky-form-control sky-mono"
                                id={inputId}
                                maxLength={parameter.maxLength || undefined}
                                onChange={(event) =>
                                  setRuntimeParameterValues((current) => ({
                                    ...current,
                                    [parameter.key]: event.target.value,
                                  }))
                                }
                                placeholder={parameter.prompt || parameter.key}
                                required={parameter.required}
                                type={
                                  parameter.type === 'number'
                                    ? 'number'
                                    : parameter.type === 'date'
                                      ? 'date'
                                      : 'text'
                                }
                                value={String(value)}
                              />
                            )}
                            <div className="form-text sky-muted">
                              {parameter.description ||
                                `${parameter.type} parameter saved as params.${parameter.key}`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sky-empty-state text-start mb-3">
                      This workflow has no runtime parameter schema. It will run with saved node
                      defaults only.
                    </div>
                  )}

                  {runtimeParameterError && (
                    <div className="alert alert-danger py-2">{runtimeParameterError}</div>
                  )}

                  <button
                    className="btn sky-btn-primary"
                    disabled={starting || !selectedDefinitionDetail || !canStart}
                    type="submit"
                  >
                    {starting ? 'Running workflow...' : 'Start Workflow'}
                  </button>
                  {!canStart && (
                    <div className="small sky-muted mt-2">
                      WORKFLOW_RUN permission is required.
                    </div>
                  )}
                </form>
              </section>

              <div className="sky-workflow-start-detail-stack">
                <WorkflowVisualGraph
                  approvals={selectedApprovals}
                  followActiveNode={followActiveRuntimeNode}
                  headingKicker="Runtime status overlay"
                  headerActionsStandalone
                  inspectorMode="navigation"
                  nodeRuns={selectedNodeRuns}
                  nodes={runtimeVisualNodes}
                  onFollowActiveNodeChange={setFollowActiveRuntimeNode}
                  onApprovalReview={handleApprovalReview}
                  onNodeSelect={handleRuntimeNodeSelect}
                  runStatus={selectedTemporalRuntime?.status || selectedRun?.status || 'NOT_RUN'}
                  runtimeMode
                  selectedNodeIndex={selectedRuntimeNodeIndex}
                  subtitle="Live run overlay for the workflow you start here. The graph uses the same page-width, horizontally scrollable runtime lane as Workflow Operations."
                  temporalRuntime={selectedTemporalRuntime}
                  title="Runtime workflow map"
                />

                {Number.isInteger(selectedRuntimeNodeIndex) &&
                selectedRuntimeNodeIndex >= 0 &&
                selectedRuntimeNodeIndex < runtimeVisualNodes.length ? (
                  isVisualNodeCompleted(
                    runtimeVisualNodes[selectedRuntimeNodeIndex],
                    selectedNodeRuns,
                    selectedApprovals,
                  ) ? (
                    <WorkflowNodeOutputLedger
                      contextValues={selectedContextValues}
                      nodes={runtimeVisualNodes}
                      outputs={selectedNodeOutputs}
                      selectedNodeIndex={selectedRuntimeNodeIndex}
                    />
                  ) : (
                    <WorkflowNodeParameterCard
                      approvals={selectedApprovals}
                      nodeRuns={selectedNodeRuns}
                      nodes={runtimeVisualNodes}
                      selectedNodeIndex={selectedRuntimeNodeIndex}
                    />
                  )
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
      {renderSelectedRunDetailOverlay()}
      <WorkflowApprovalOverlay
        approval={approvalOverlayRequest}
        canDecide={canDecideApproval}
        hasRequiredRole={Boolean(
          approvalOverlayRequest
            && (!approvalOverlayRequest.requiredRoleCode
              || hasRole(approvalOverlayRequest.requiredRoleCode)
              || hasRole('SUPER_ADMIN')),
        )}
        onClose={() => setApprovalOverlayRequest(null)}
        onDecisionComplete={handleApprovalDecisionComplete}
      />
    </div>
  );
}

function WorkflowStart() {
  return <SkyWorkflows mode="start" />;
}

function WorkflowHistory() {
  return <SkyWorkflows mode="history" />;
}

export { WorkflowHistory, WorkflowStart };
export default SkyWorkflows;
