import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
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
const HISTORY_LOAD_LIMIT = 200;
const HISTORY_POLL_IDLE_MS = 8000;
const HISTORY_POLL_ACTIVE_MS = 2000;
const HISTORY_POLL_SELECTED_ACTIVE_MS = 1500;
const HISTORY_POLL_HIDDEN_MS = 30000;

const RUNTIME_FILTER_OPTIONS = [
  { value: 'skycommand', label: 'SkyCommand ledger' },
  { value: 'temporal', label: 'Temporal-backed only' },
  { value: 'inline', label: 'Inline/local only' },
];

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
    definition.runtimeParameters
      || config.runtimeParameters
      || parameterSchema.runtimeParameters
      || parameterSchema.parameters,
  );

  return rawParameters
    .map((parameter, index) => {
      const raw = getSafeObject(parameter);
      const key = String(raw.key || raw.parameterName || raw.name || raw.paramName || `param_${index + 1}`)
        .trim()
        .replace(/[^A-Za-z0-9_.:-]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const type = String(raw.type || raw.paramTypeCode || raw.parameterType || 'string').trim().toLowerCase();
      const normalizedType = ['string', 'number', 'boolean', 'select', 'date', 'json'].includes(type) ? type : 'string';

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
        maxLength: Number.isFinite(Number(raw.maxLength)) ? Number(raw.maxLength) : null,
        displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : index * 10 + 10,
      };
    })
    .filter((parameter) => parameter.key)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || a.key.localeCompare(b.key));
}

function getInitialRuntimeParameterValues(parameters = []) {
  return parameters.reduce((accumulator, parameter) => {
    if (parameter.type === 'boolean') {
      accumulator[parameter.key] = parameter.defaultValue === true || parameter.defaultValue === 'true';
    } else if (parameter.type === 'json') {
      accumulator[parameter.key] = parameter.defaultValue && typeof parameter.defaultValue === 'object'
        ? JSON.stringify(parameter.defaultValue, null, 2)
        : String(parameter.defaultValue || '');
    } else {
      accumulator[parameter.key] = parameter.defaultValue ?? '';
    }

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
        accumulator[parameter.key] = typeof rawValue === 'object' ? rawValue : JSON.parse(String(rawValue));
      } catch (error) {
        throw new Error(`${parameter.label || parameter.key} must be valid JSON.`);
      }
      return accumulator;
    }

    const stringValue = String(rawValue);

    if (parameter.maxLength && stringValue.length > parameter.maxLength) {
      throw new Error(`${parameter.label || parameter.key} must be ${parameter.maxLength} characters or less.`);
    }

    accumulator[parameter.key] = stringValue;
    return accumulator;
  }, {});
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

function formatPollingInterval(ms) {
  const value = Number(ms);

  if (!Number.isFinite(value) || value <= 0) {
    return '—';
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  const seconds = value / 1000;
  return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
}

function formatJsonPreview(value, maxLength = 2800) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);

    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}\n\n… output preview truncated`;
  } catch (error) {
    return String(value ?? '');
  }
}

function getWorkflowHistoryPollingDelay({ activeRunCount = 0, hidden = false, selectedRunActive = false } = {}) {
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

  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  return Math.max(0, endDate.getTime() - startDate.getTime());
}

function getRunDurationMs(run) {
  return run?.metadata?.durationMs || getDateDiffMs(run?.startedAt || run?.createdAt, run?.completedAt);
}

function getNodeRunDurationMs(nodeRun) {
  return nodeRun?.metadata?.durationMs || getDateDiffMs(nodeRun?.startedAt || nodeRun?.createdAt, nodeRun?.completedAt);
}

function getTemporalRuntime(runDetail) {
  return runDetail?.temporalRuntime || runDetail?.run?.temporalRuntime || null;
}

function getRunRelationLabel(run) {
  if (!run) {
    return null;
  }

  if (run.parentWorkflowRunRecordId || run.triggerType === 'CHILD_WORKFLOW' || run.runSource === 'child_workflow') {
    return 'CHILD';
  }

  return null;
}

function getChildRunIdFromNodeRun(nodeRun) {
  return nodeRun?.output?.childWorkflowRunRecordId
    || nodeRun?.output?.workflowRunRecordId
    || nodeRun?.metadata?.childWorkflowRunRecordId
    || null;
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

  if (normalized === 'FAILED' || normalized === 'TERMINATED' || normalized === 'REJECTED' || normalized === 'TIMED_OUT') {
    return 'sky-pill-danger';
  }

  if (normalized === 'RUNNING' || normalized === 'QUEUED' || normalized === 'PENDING') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
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
      <div className="sky-mono sky-temporal-id-value" title={value || ''}>{shortenIdentifier(value)}</div>
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

function TemporalEventTable({ emptyText = 'No Temporal event preview available.', events = [], title }) {
  if (!events || events.length === 0) {
    return title ? (
      <div className="mb-3">
        <div className="sky-page-kicker mb-2">{title}</div>
        <div className="sky-empty-state">{emptyText}</div>
      </div>
    ) : <div className="sky-empty-state">{emptyText}</div>;
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
                  <span className={`sky-pill ${eventCategoryClass(event.category)}`}>{event.eventType}</span>
                </td>
                <td>{formatDate(event.eventTime)}</td>
                <td>
                  <div>{event.summary}</div>
                  {event.failureMessage && <div className="small text-danger-emphasis mt-1">{event.failureMessage}</div>}
                  {event.retryState && <div className="small sky-muted mt-1">Retry state: {event.retryState}</div>}
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
            Cancel requests a graceful stop, terminate force-closes the Temporal execution, and retry starts a fresh run from the same workflow input.
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
        <span className="sky-pill sky-pill-info">
          {definition.publishedNodeCount || 0} node(s)
        </span>
        <span className="sky-pill sky-pill-info">
          {definition.publishedEdgeCount || 0} edge(s)
        </span>
      </div>
    </button>
  );
}

function getNodeOutputSummary(output = {}) {
  if (output.summary) {
    return output.summary;
  }

  if (output.kind === 'condition_evaluation') {
    return `Condition ${output.passed ? 'passed' : 'did not pass'}; ${output.onFalse || 'STOP_SUCCESS'}.`;
  }

  if (output.kind === 'temporal_workflow_execution') {
    return output.summary || `Temporal workflow template ${output.workflowDisplayName || output.workflowCode || ''} completed.`.trim();
  }

  if (output.kind === 'temporal_workflow_start') {
    return `Started Temporal workflow ${output.workflowId || output.workflowCode || ''}`.trim();
  }

  if (output.kind === 'api_call') {
    return output.summary || `API ${output.method || ''} ${output.url || ''} returned ${output.statusCode || 'unknown status'}`.trim();
  }

  if (output.kind === 'wait_delay') {
    return output.summary || `Waited ${output.requestedDurationMs || output.actualDurationMs || 0} ms.`;
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
  const approvalsByNodeRunId = new Map(approvals.map((approval) => [approval.workflowNodeRunRecordId, approval]));
  const approvalsByNodeKey = new Map(approvals.map((approval) => [approval.nodeKey, approval]));

  return (
    <div className="d-flex flex-column gap-2">
      {nodes.map((node, index) => {
        const nodeKey = node.nodeKey;
        const nodeRun = runsByNodeKey.get(nodeKey) || (node.status ? node : null);
        const nodeTypeCode = node.nodeTypeCode || nodeRun?.nodeTypeCode || 'NODE';
        const targetCode = node.targetCode || nodeRun?.targetCode || 'No target';
        const displayName = node.displayName || nodeKey || 'Workflow node';
        const description = node.description || getNodeOutputSummary(nodeRun?.output) || 'No description';
        const durationMs = getNodeRunDurationMs(nodeRun);
        const outputSummary = getNodeOutputSummary(nodeRun?.output);
        const approval = nodeRun
          ? approvalsByNodeRunId.get(nodeRun.workflowNodeRunRecordId) || approvalsByNodeKey.get(nodeRun.nodeKey)
          : approvalsByNodeKey.get(nodeKey);

        return (
          <div className="sky-worker-command-card" key={node.workflowNodeId || node.workflowNodeRunRecordId || nodeKey}>
            <div className="d-flex justify-content-between gap-3">
              <div>
                <div className="sky-page-kicker">Node {index + 1} · {nodeTypeCode}</div>
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
                <span className="sky-pill sky-pill-info">Started {formatDate(nodeRun.startedAt || nodeRun.createdAt)}</span>
                <span className="sky-pill sky-pill-info">Duration {formatDuration(durationMs)}</span>
                {nodeRun.metadata?.temporalBacked && (
                  <span className="sky-pill sky-pill-success">Temporal activity</span>
                )}
              </div>
            )}

            {outputSummary && (
              <div className="small sky-muted mt-2">{outputSummary}</div>
            )}
            {approval && (
              <div className="alert alert-secondary mt-3 mb-0 py-2">
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <span className={`sky-pill ${statusClass(approval.status)}`}>{approval.status}</span>
                  <span className="fw-semibold">{approval.approvalTitle}</span>
                  <span className="small sky-muted">Requested {formatDate(approval.requestedAt)}</span>
                  {approval.decidedAt && <span className="small sky-muted">Decided {formatDate(approval.decidedAt)}</span>}
                </div>
                {approval.decisionNote && <div className="small mt-1">Decision note: {approval.decisionNote}</div>}
              </div>
            )}
            {nodeRun?.output?.executionId && (
              <div className="small sky-muted mt-1">
                Execution <span className="sky-mono">{nodeRun.output.executionId}</span>
              </div>
            )}
            {getChildRunIdFromNodeRun(nodeRun) && (
              <div className="small sky-muted mt-2 d-flex flex-wrap align-items-center gap-2">
                <span>Child run <span className="sky-mono">{getChildRunIdFromNodeRun(nodeRun)}</span></span>
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
            {nodeRun?.output?.workflowDisplayName && nodeRun?.output?.kind === 'child_workflow_execution' && (
              <div className="small sky-muted mt-1">
                Child workflow <span className="fw-semibold">{nodeRun.output.workflowDisplayName}</span>
              </div>
            )}
            {nodeRun?.output?.temporalWorkflowId && (
              <div className="small sky-muted mt-1">
                Child Temporal workflow <span className="sky-mono">{nodeRun.output.temporalWorkflowId}</span>
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



function WorkflowNodeOutputLedger({ outputs = [], contextValues = [] }) {
  const hasOutputs = outputs.length > 0;
  const hasContextValues = contextValues.length > 0;

  return (
    <section className="sky-card mb-4">
      <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Node outputs</div>
          <h2 className="h5 mb-0">Structured output ledger</h2>
        </div>
        <div className="d-flex flex-wrap gap-2 small">
          <span className="sky-pill sky-pill-info">{outputs.length} output record(s)</span>
          {hasContextValues && <span className="sky-pill sky-pill-success">{contextValues.length} context value(s)</span>}
        </div>
      </div>
      <div className="sky-card-body">
        {!hasOutputs ? (
          <div className="sky-empty-state">Structured node outputs will appear here after the run records node output persistence.</div>
        ) : (
          <div className="sky-node-output-grid">
            {outputs.map((output) => (
              <article className="sky-worker-command-card" key={output.workflowRunNodeOutputId || `${output.nodeKey}-${output.outputKey}`}>
                <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
                  <div>
                    <div className="sky-page-kicker">{output.nodeTypeCode || 'NODE'} · {output.outputKey || 'result'}</div>
                    <div className="fw-bold">{output.nodeKey || 'Workflow node'}</div>
                    <div className="small sky-muted">{output.targetCode || 'No target'} · {output.outputType || 'object'}</div>
                  </div>
                  <span className={`sky-pill ${statusClass(output.status)}`}>{output.status || 'SAVED'}</span>
                </div>
                <div className="d-flex flex-wrap gap-2 small mb-2">
                  <span className="sky-pill sky-pill-info">Attempt {output.attemptCount ?? 0}</span>
                  <span className="sky-pill sky-pill-info">Saved {formatDate(output.updatedAt || output.createdAt)}</span>
                </div>
                {output.outputSummary && <p className="small sky-muted mb-2">{output.outputSummary}</p>}
                {Object.keys(output.inputSnapshot || {}).length > 0 && (
                  <details className="mb-2">
                    <summary className="small fw-semibold sky-clickable-row">Resolved input</summary>
                    <pre className="sky-json-block mt-2 mb-0">{formatJsonPreview(output.inputSnapshot, 1400)}</pre>
                  </details>
                )}
                <details open>
                  <summary className="small fw-semibold sky-clickable-row">Output JSON</summary>
                  <pre className="sky-json-block mt-2 mb-0">{formatJsonPreview(output.output)}</pre>
                </details>
              </article>
            ))}
          </div>
        )}

        {hasContextValues && (
          <div className="mt-4">
            <div className="sky-page-kicker mb-2">Workflow context</div>
            <div className="sky-node-output-grid">
              {contextValues.map((item) => (
                <article className="sky-worker-command-card" key={item.workflowRunContextValueId || item.contextKey}>
                  <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                    <div>
                      <div className="fw-bold sky-mono">{item.contextKey}</div>
                      <div className="small sky-muted">{item.sourceNodeKey || 'Workflow'} · {item.valueType || 'unknown'}</div>
                    </div>
                    <span className="sky-pill sky-pill-info">Context</span>
                  </div>
                  <pre className="sky-json-block mt-2 mb-0">{formatJsonPreview(item.value, 1600)}</pre>
                </article>
              ))}
            </div>
          </div>
        )}
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
    <div className={`sky-worker-command-card ${run.workflowRunRecordId === selectedRunId ? 'sky-selected-row' : ''}`}>
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
        <div>
          <div className="sky-page-kicker">{node.depth === 0 ? 'Root workflow' : `Child workflow · depth ${node.depth}`}</div>
          <div className="fw-bold">{run.workflowDisplayName || run.workflowCode}</div>
          <div className="small sky-mono sky-muted">{run.workflowCode}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {run.workflowRunRecordId === selectedRunId && <span className="sky-pill sky-pill-info">Selected</span>}
          <span className={`sky-pill ${statusClass(run.status)}`}>{run.status}</span>
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 mt-2 small">
        <span className="sky-pill sky-pill-info">Started {formatDate(run.startedAt || run.createdAt)}</span>
        <span className="sky-pill sky-pill-info">Duration {formatDuration(getRunDurationMs(run))}</span>
        {run.temporalWorkflowId && <span className="sky-pill sky-pill-success">Temporal-backed</span>}
        {run.childWorkflow && <span className="sky-pill sky-pill-warning">Child</span>}
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mt-2 small">
        <span className="sky-muted">Run <span className="sky-mono">{run.workflowRunRecordId}</span></span>
        {run.workflowRunRecordId !== selectedRunId && onOpenRun && (
          <button className="btn btn-sm sky-btn-ghost" onClick={() => onOpenRun(run.workflowRunRecordId)} type="button">
            Open run
          </button>
        )}
      </div>

      {(node.nodeRuns || []).length > 0 && (
        <div className="mt-3 d-flex flex-column gap-2">
          {(node.nodeRuns || []).map((nodeRun, index) => {
            const childNodes = childNodesByParentKey.get(nodeRun.nodeKey) || [];

            return (
              <div className="border rounded p-2" key={nodeRun.workflowNodeRunRecordId || `${run.workflowRunRecordId}-${nodeRun.nodeKey}`}>
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                  <div>
                    <div className="sky-page-kicker">Node {index + 1} · {nodeRun.nodeTypeCode}</div>
                    <div className="fw-semibold">{nodeRun.metadata?.displayName || nodeRun.nodeKey}</div>
                    <div className="small sky-muted">{nodeRun.targetCode || 'No target'}</div>
                  </div>
                  <span className={`sky-pill ${statusClass(nodeRun.status)}`}>{nodeRun.status}</span>
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
          {(node.children || []).filter((child) => !child.parentNodeKey).map((child) => (
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
          <div className="sky-empty-state">Select a workflow run to inspect parent/child relationships.</div>
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
          <div className="sky-empty-state">Select a Temporal-backed run to inspect runtime details.</div>
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
          <span className={`sky-pill ${statusClass(runtime.status || 'UNKNOWN')}`}>{runtime.status || 'UNKNOWN'}</span>
          {(links.workflow || runtime.uiUrl) && (
            <a className="btn btn-sm sky-btn-ghost" href={links.workflow || runtime.uiUrl} rel="noreferrer" target="_blank">
              Open workflow
            </a>
          )}
          {links.history && (
            <a className="btn btn-sm sky-btn-ghost" href={links.history} rel="noreferrer" target="_blank">
              Open history
            </a>
          )}
          {links.query && (
            <a className="btn btn-sm sky-btn-ghost" href={links.query} rel="noreferrer" target="_blank">
              Search Temporal
            </a>
          )}
        </div>
      </div>
      <div className="sky-card-body">
        {runtime.warnings?.length > 0 && (
          <div className="alert alert-warning py-2">
            {runtime.warnings.join(' ')}
          </div>
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
              <div className="sky-mini-metric-value">{history.eventCount || runtime.historyLength || '—'}</div>
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
          <TemporalIdentifierCard label="Workflow ID" href={links.workflow || runtime.uiUrl} value={runtime.workflowId} />
          <TemporalIdentifierCard label="Run ID" href={links.history || links.workflow || runtime.uiUrl} value={runtime.runId} />
          <TemporalIdentifierCard label="Workflow type" value={runtime.workflowType} />
          <TemporalIdentifierCard label="Address" value={runtime.address || diagnostics.address} />
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3 small">
          <span className="sky-pill sky-pill-info">Workflow tasks {workflowTaskCounts.completed || 0}/{workflowTaskCounts.scheduled || 0}</span>
          <span className="sky-pill sky-pill-success">Activities completed {activityCounts.completed || 0}</span>
          {(activityCounts.failed || activityCounts.timedOut || activityCounts.canceled) > 0 && (
            <span className="sky-pill sky-pill-danger">
              Activity issues {(activityCounts.failed || 0) + (activityCounts.timedOut || 0) + (activityCounts.canceled || 0)}
            </span>
          )}
          {Object.keys(signalCounts).map((signalName) => (
            <span className="sky-pill sky-pill-info" key={signalName}>Signal {signalName}: {signalCounts[signalName]}</span>
          ))}
          {history.truncated && <span className="sky-pill sky-pill-warning">History preview truncated</span>}
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
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canStart =
    hasPermission('WORKFLOW_START') ||
    hasPermission('TEMPORAL_WORKFLOW_START') ||
    hasPermission('WORKER_SCHEDULE_RUN');
  const canCancelRun =
    hasPermission('WORKFLOW_CANCEL') ||
    hasPermission('TEMPORAL_WORKFLOW_CANCEL') ||
    hasPermission('WORKER_SCHEDULE_RUN');
  const canTerminateRun =
    hasPermission('WORKFLOW_CANCEL') ||
    hasPermission('TEMPORAL_WORKFLOW_TERMINATE') ||
    hasPermission('WORKER_ADMIN');

  const [definitions, setDefinitions] = useState([]);
  const [selectedDefinition, setSelectedDefinition] = useState(null);
  const [selectedDefinitionDetail, setSelectedDefinitionDetail] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRunDetail, setSelectedRunDetail] = useState(null);
  const [filters, setFilters] = useState(() => ({
    status: '',
    runtime: normalizeRuntimeFilter(searchParams.get('runtime')),
  }));
  const [historyPage, setHistoryPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [runActionLoading, setRunActionLoading] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedRuntimeNodeIndex, setSelectedRuntimeNodeIndex] = useState(null);
  const [runtimeParameterValues, setRuntimeParameterValues] = useState({});
  const [runtimeParameterError, setRuntimeParameterError] = useState('');
  const [runDetailOverlayOpen, setRunDetailOverlayOpen] = useState(false);
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

  const selectedRun = selectedRunDetail?.run || null;
  const selectedNodeRuns = selectedRunDetail?.nodeRuns || [];
  const selectedNodeOutputs = selectedRunDetail?.nodeOutputs || [];
  const selectedContextValues = selectedRunDetail?.contextValues || [];
  const selectedApprovals = selectedRunDetail?.approvals || [];
  const selectedTemporalRuntime = getTemporalRuntime(selectedRunDetail);
  const selectedRelations = selectedRunDetail?.relations || {};
  const selectedRunTree = selectedRunDetail?.runTree || selectedRelations.runTree || null;
  const runtimeParameters = useMemo(
    () => normalizeRuntimeParameterDefinitions(selectedDefinitionDetail || selectedDefinition || {}),
    [selectedDefinition, selectedDefinitionDetail],
  );
  const runtimeVisualNodes = selectedRunDetail?.definitionGraph?.nodes?.length
    ? selectedRunDetail.definitionGraph.nodes
    : selectedDefinitionDetail?.nodes?.length
      ? selectedDefinitionDetail.nodes
      : selectedNodeRuns;
  const isHistoryMode = mode === 'history';

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
    const running = runs.filter((run) => run.status === 'RUNNING' || run.status === 'QUEUED').length;
    const failed = runs.filter((run) => run.status === 'FAILED' || run.status === 'TERMINATED').length;

    return { completed, running, failed };
  }, [runs]);


  const historyRuns = useMemo(
    () => runs.filter((run) => runMatchesRuntimeFilter(run, filters.runtime)),
    [filters.runtime, runs],
  );
  const historyPageCount = Math.max(1, Math.ceil(historyRuns.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const historyPageStart = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pagedHistoryRuns = historyRuns.slice(historyPageStart, historyPageStart + HISTORY_PAGE_SIZE);
  const historyRangeStart = historyRuns.length === 0 ? 0 : historyPageStart + 1;
  const historyRangeEnd = Math.min(historyPageStart + HISTORY_PAGE_SIZE, historyRuns.length);

  async function loadDefinitions({ keepSelection = true } = {}) {
    const result = await workflowService.listDefinitions();
    const items = result.items || [];
    setDefinitions(items);

    const nextSelection =
      (keepSelection && selectedDefinition
        ? items.find((item) => item.workflowCode === selectedDefinition.workflowCode)
        : null) || items[0] || null;

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
        return;
      }
    }

    if (!keepSelection) {
      setSelectedRunDetail(null);
    }
  }

  async function loadPage({ keepSelection = true } = {}) {
    setLoading(true);
    setError('');

    try {
      await loadDefinitions({ keepSelection });
      await loadRuns(filters, { keepSelection });
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

    if (!definition) {
      setSelectedDefinition(null);
      setSelectedDefinitionDetail(null);
      return;
    }

    await loadDefinitionDetail(definition);
  }

  async function loadRunDetail(workflowRunRecordId, { quiet = false, telemetry = isHistoryMode } = {}) {
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
      const visibleRuns = items.filter((run) => runMatchesRuntimeFilter(run, filters.runtime));
      const visiblePageCount = Math.max(1, Math.ceil(visibleRuns.length / HISTORY_PAGE_SIZE));
      const visibleCurrentPage = Math.min(historyPage, visiblePageCount);
      const visiblePageStart = (visibleCurrentPage - 1) * HISTORY_PAGE_SIZE;
      const visiblePageRuns = visibleRuns.slice(visiblePageStart, visiblePageStart + HISTORY_PAGE_SIZE);
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
      const nextIntervalMs = getWorkflowHistoryPollingDelay({
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
        await loadRunDetail(result.run.workflowRunRecordId);
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

    const confirmed = window.confirm('Cancel this workflow run? Temporal will receive a graceful cancellation request when available.');

    if (!confirmed) {
      return;
    }

    setRunActionLoading('cancel');
    setError('');
    setMessage('');

    try {
      const result = await workflowService.cancelRun(selectedRun.workflowRunRecordId, {
        reason: 'Canceled from SkyCommand Workflow History.',
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

    const reason = window.prompt('Terminate this workflow run? Add a cleanup reason:', 'Terminated from SkyCommand Workflow History.');

    if (reason === null) {
      return;
    }

    setRunActionLoading('terminate');
    setError('');
    setMessage('');

    try {
      const result = await workflowService.terminateRun(selectedRun.workflowRunRecordId, { reason });
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

    const confirmed = window.confirm('Retry this workflow run using the same saved input and current published workflow definition?');

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
        await loadRunDetail(result.run.workflowRunRecordId);
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

    if (name === 'runtime') {
      const nextSearchParams = new URLSearchParams(searchParams);

      if (value === 'skycommand') {
        nextSearchParams.delete('runtime');
      } else {
        nextSearchParams.set('runtime', value);
      }

      setSearchParams(nextSearchParams, { replace: true });
      return;
    }

    loadRuns(nextFilters, { keepSelection: false });
  }

  useEffect(() => {
    loadPage({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedRuntimeNodeIndex(null);
  }, [selectedRun?.workflowRunRecordId]);

  useEffect(() => {
    setRuntimeParameterValues(getInitialRuntimeParameterValues(runtimeParameters));
    setRuntimeParameterError('');
  }, [selectedDefinitionDetail?.workflowCode]);


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
      const delay = pollResult?.intervalMs || getWorkflowHistoryPollingDelay({
        activeRunCount: pollResult?.activeRunCount ?? fallbackActiveRunCount,
        hidden: document.visibilityState === 'hidden',
        selectedRunActive: pollResult?.selectedRunActive ?? fallbackSelectedRunActive,
      });

      timerId = window.setTimeout(pollWorkflowHistory, delay);
    }

    const initialDelay = getWorkflowHistoryPollingDelay({
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
  }, [isHistoryMode, filters.status, filters.runtime, selectedRun?.workflowRunRecordId, selectedRun?.status]);

  function renderSelectedRunDetailContent() {
    if (!selectedRun) {
      return <div className="sky-empty-state py-4">Select a workflow run to inspect it.</div>;
    }

    return (
      <>
        <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
          <span className={`sky-pill ${statusClass(selectedRun.status)}`}>{selectedRun.status}</span>
          <span className="small sky-muted">{formatDuration(getRunDurationMs(selectedRun))}</span>
        </div>
        <dl className="row small mb-3">
          <dt className="col-4 sky-detail-label">Workflow</dt>
          <dd className="col-8 sky-detail-value">{selectedRun.workflowDisplayName || selectedRun.workflowCode}</dd>
          <dt className="col-4 sky-detail-label">Run</dt>
          <dd className="col-8 sky-detail-value sky-mono text-break">{selectedRun.workflowRunRecordId}</dd>
          {selectedRelations.parentRun && (
            <>
              <dt className="col-4 sky-detail-label">Parent</dt>
              <dd className="col-8 sky-detail-value">
                <button
                  className="btn btn-link btn-sm p-0 align-baseline"
                  onClick={() => loadRunDetail(selectedRelations.parentRun.workflowRunRecordId)}
                  type="button"
                >
                  {selectedRelations.parentRun.workflowDisplayName || selectedRelations.parentRun.workflowCode}
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
                <span className="sky-pill sky-pill-info">{selectedRelations.childRuns.length} child run(s)</span>
              </dd>
            </>
          )}
          {selectedApprovals.length > 0 && (
            <>
              <dt className="col-4 sky-detail-label">Approvals</dt>
              <dd className="col-8 sky-detail-value">
                <span className="sky-pill sky-pill-warning">
                  {selectedApprovals.filter((approval) => approval.status === 'PENDING').length} pending
                </span>
                <span className="sky-pill sky-pill-info ms-1">{selectedApprovals.length} total</span>
              </dd>
            </>
          )}
          <dt className="col-4 sky-detail-label">Started</dt>
          <dd className="col-8 sky-detail-value">{formatDate(selectedRun.startedAt || selectedRun.createdAt)}</dd>
          <dt className="col-4 sky-detail-label">Completed</dt>
          <dd className="col-8 sky-detail-value">{formatDate(selectedRun.completedAt)}</dd>
          <dt className="col-4 sky-detail-label">Source</dt>
          <dd className="col-8 sky-detail-value sky-mono">{selectedRun.runSource}</dd>
          <dt className="col-4 sky-detail-label">Runtime params</dt>
          <dd className="col-8 sky-detail-value">
            {Object.keys(getSafeObject(selectedRun.input?.params)).length > 0 ? (
              <span className="sky-pill sky-pill-info">{Object.keys(getSafeObject(selectedRun.input.params)).length} parameter(s)</span>
            ) : '—'}
          </dd>
          <dt className="col-4 sky-detail-label">Started by</dt>
          <dd className="col-8 sky-detail-value">{selectedRun.startedByDisplayName || selectedRun.startedByEmail || '—'}</dd>
          <dt className="col-4 sky-detail-label">Executor</dt>
          <dd className="col-8 sky-detail-value sky-mono">{selectedRun.metadata?.executor || '—'}</dd>
          <dt className="col-4 sky-detail-label">Temporal workflow</dt>
          <dd className="col-8 sky-detail-value sky-mono text-break">{selectedRun.temporalWorkflowId || '—'}</dd>
          <dt className="col-4 sky-detail-label">Temporal run</dt>
          <dd className="col-8 sky-detail-value sky-mono text-break">{selectedRun.temporalRunId || '—'}</dd>
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
            <span className={`sky-pill ${statusClass(selectedTemporalRuntime?.status || selectedRun.status)}`}>
              {selectedTemporalRuntime?.status || selectedRun.status || '—'}
            </span>
          </dd>
          <dt className="col-4 sky-detail-label">History events</dt>
          <dd className="col-8 sky-detail-value">{selectedTemporalRuntime?.history?.eventCount || selectedTemporalRuntime?.historyLength || '—'}</dd>
          {selectedTemporalRuntime?.uiUrl && (
            <>
              <dt className="col-4 sky-detail-label">Temporal UI</dt>
              <dd className="col-8 sky-detail-value">
                <a href={selectedTemporalRuntime.uiUrl} rel="noreferrer" target="_blank">Open diagnostics</a>
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
        className="sky-chart-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setRunDetailOverlayOpen(false);
          }
        }}
        role="dialog"
      >
        <section className="sky-chart-modal sky-run-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="sky-chart-modal-header">
            <div>
              <div className="sky-page-kicker sky-chart-modal-kicker">Run detail</div>
              <h2>Selected workflow</h2>
              <p>Review run identity, runtime source, controls, Temporal diagnostics, and raw metadata without compressing the workflow map.</p>
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
          <div className="sky-run-detail-modal-body">
            {renderSelectedRunDetailContent()}
          </div>
        </section>
      </div>,
      document.body,
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
          <label className="sky-pagination-select-label" htmlFor="workflowHistoryPageSelect">Page</label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            id="workflowHistoryPageSelect"
            onChange={(event) => setHistoryPage(Number(event.target.value) || 1)}
            value={currentHistoryPage}
          >
            {Array.from({ length: historyPageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>{page}</option>
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
              <h2 className="h5 mb-0">Workflow history data</h2>
              <p className="sky-muted small mb-0">
                Select the execution surface and status, then inspect a run in the detail workspace below.
              </p>
              <div className="d-flex flex-wrap align-items-center gap-2 mt-2 small">
                <span className={`sky-pill ${telemetryState.error ? 'sky-pill-warning' : telemetryState.warning ? 'sky-pill-info' : 'sky-pill-success'}`}>
                  Smart polling {telemetryState.error ? 'checking' : telemetryState.warning ? 'reconnecting' : 'live'}
                </span>
                <span className="sky-pill sky-pill-info">Every {formatPollingInterval(telemetryState.intervalMs)}</span>
                <span className="sky-pill sky-pill-info">Active runs {telemetryState.activeRunCount}</span>
                {(telemetryState.lastSuccessfulAt || telemetryState.lastUpdatedAt) && (
                  <span className="sky-muted">Updated {formatDate(telemetryState.lastSuccessfulAt || telemetryState.lastUpdatedAt)}</span>
                )}
              </div>
              {telemetryState.warning && !telemetryState.error && (
                <div className="small sky-muted mt-2">Last poll warning: {telemetryState.warning}</div>
              )}
              {telemetryState.error && (
                <div className="small text-warning-emphasis mt-2">{telemetryState.error}</div>
              )}
            </div>
            <div className="sky-history-filter-grid">
              <div>
                <label className="form-label" htmlFor="workflowHistoryRuntime">Runtime source</label>
                <select
                  className="form-select sky-form-control"
                  id="workflowHistoryRuntime"
                  onChange={(event) => updateFilter('runtime', event.target.value)}
                  value={filters.runtime}
                >
                  {RUNTIME_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="workflowHistoryStatus">Status</label>
                <select
                  className="form-select sky-form-control"
                  id="workflowHistoryStatus"
                  onChange={(event) => updateFilter('status', event.target.value)}
                  value={filters.status}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
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
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="6"><div className="sky-empty-state">Loading workflow runs...</div></td>
                  </tr>
                )}
                {!loading && historyRuns.length === 0 && (
                  <tr>
                    <td colSpan="6"><div className="sky-empty-state">No workflow runs found for these filters.</div></td>
                  </tr>
                )}
                {!loading && pagedHistoryRuns.map((run) => (
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
                            <span className="sky-pill sky-pill-warning">{getRunRelationLabel(run)}</span>
                          )}
                          {run.metadata?.parentWorkflowRunRecordId && (
                            <span className="sky-pill sky-pill-info">Has parent</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td><span className={`sky-pill ${statusClass(run.status)}`}>{run.status}</span></td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {renderHistoryPagination()}
        </section>

        <section className="sky-workflow-history-detail-zone">
          <div className="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
            <div>
              <div className="sky-page-kicker">Selected run workspace</div>
              <h2 className="h5 mb-0">Execution detail</h2>
            </div>
            <div className="small sky-muted">Detail panels scroll independently from the run browser.</div>
          </div>

          <div className="sky-workflow-history-detail-stack">
              <section className="sky-card">
                <div className="sky-card-body">
                  {!selectedRun ? (
                    <div className="sky-empty-state">Select a workflow run to view the runtime graph overlay.</div>
                  ) : (
                    <WorkflowVisualGraph
                      approvals={selectedApprovals}
                      headingKicker="Runtime status overlay"
                      headerActions={(
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={!selectedRun}
                          onClick={() => setRunDetailOverlayOpen(true)}
                          type="button"
                        >
                          View details
                        </button>
                      )}
                      nodeRuns={selectedNodeRuns}
                      nodes={runtimeVisualNodes}
                      onNodeSelect={(index) => setSelectedRuntimeNodeIndex(index)}
                      runStatus={selectedTemporalRuntime?.status || selectedRun.status}
                      runtimeMode
                      selectedNodeIndex={selectedRuntimeNodeIndex}
                      subtitle="Read-only execution overlay showing node outcomes, pending approvals, errors, and condition branch decisions for the selected run."
                      temporalRuntime={selectedTemporalRuntime}
                      title="Runtime workflow map"
                    />
                  )}
                </div>
              </section>

              <WorkflowRunTreePanel
                onOpenRun={loadRunDetail}
                selectedRunId={selectedRun?.workflowRunRecordId}
                tree={selectedRunTree}
              />

              <TemporalRuntimePanel runtime={selectedTemporalRuntime} />

              <section className="sky-card">
                <div className="sky-card-header">
                  <div className="sky-page-kicker">Node runs</div>
                  <h2 className="h5 mb-0">Timeline</h2>
                </div>
                <div className="sky-card-body">
                  {selectedNodeRuns.length === 0 ? (
                    <div className="sky-empty-state">Select a run to inspect node outcomes.</div>
                  ) : (
                    <WorkflowNodesTimeline nodes={selectedDefinitionDetail?.nodes || selectedNodeRuns} nodeRuns={selectedNodeRuns} approvals={selectedApprovals} onOpenRun={loadRunDetail} />
                  )}
                </div>
              </section>

              <WorkflowNodeOutputLedger outputs={selectedNodeOutputs} contextValues={selectedContextValues} />
          </div>
        </section>
      </div>
    );
  }

  const pageKicker = isHistoryMode ? 'Workflows · History' : 'Workflows · Start';
  const pageTitle = isHistoryMode ? 'Workflow History' : 'Start Workflow';
  const pageSubtitle = isHistoryMode
    ? 'Inspect SkyCommand workflow runs, node outcomes, and the executor ledger.'
    : 'Start approved SkyCommand workflow definitions built from tools, Temporal templates, APIs, agents, and future node types.';

  return (
    <div>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">{pageKicker}</div>
          <h1 className="sky-page-title">{pageTitle}</h1>
          <p className="sky-page-subtitle">{pageSubtitle}</p>
        </div>
        <button
          className="btn sky-btn-ghost"
          disabled={loading || starting || Boolean(runActionLoading)}
          onClick={() => loadPage()}
          type="button"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      {isHistoryMode ? renderHistoryView() : (
        <div className="d-flex flex-column gap-4">
          <section className="sky-card">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Workflow launcher</div>
              <h2 className="h5 mb-0">Choose workflow</h2>
            </div>
            <div className="sky-card-body">
              {definitions.length > 0 ? (
                <div className="row g-3 align-items-end">
                  <div className="col-xl-7">
                    <label className="form-label" htmlFor="workflowStartDefinition">Active workflow</label>
                    <select
                      className="form-select sky-form-control"
                      id="workflowStartDefinition"
                      onChange={(event) => handleDefinitionSelect(event.target.value)}
                      value={selectedDefinition?.workflowCode || ''}
                    >
                      {definitions.map((definition) => (
                        <option key={definition.workflowCode} value={definition.workflowCode}>
                          {definition.displayName} ({definition.workflowCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-xl-5">
                    <div className="sky-worker-command-card h-100">
                      <div className="d-flex flex-wrap justify-content-between gap-2">
                        <div>
                          <div className="sky-page-kicker">Selected workflow</div>
                          <div className="fw-bold">{selectedDefinitionDetail?.displayName || selectedDefinition?.displayName}</div>
                          <div className="small sky-muted sky-mono">{selectedDefinition?.workflowCode}</div>
                        </div>
                        <span className="sky-pill sky-pill-success">{selectedDefinitionDetail?.status || 'ACTIVE'}</span>
                      </div>
                      <p className="small sky-muted my-2">{selectedDefinitionDetail?.description || 'No description.'}</p>
                      <div className="d-flex flex-wrap gap-2">
                        <span className="sky-pill sky-pill-info">{selectedDefinitionDetail?.nodes?.length || 0} node(s)</span>
                        <span className="sky-pill sky-pill-info">{selectedDefinitionDetail?.edges?.length || 0} edge(s)</span>
                        <span className="sky-pill sky-pill-info">{runtimeParameters.length} runtime param(s)</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="sky-empty-state">No active workflow definitions are available.</div>
              )}
            </div>
          </section>

          <section className="sky-card">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Execution plan</div>
              <h2 className="h5 mb-0">Node timeline</h2>
            </div>
            <div className="sky-card-body">
              <WorkflowNodesTimeline nodes={selectedDefinitionDetail?.nodes || []} />
            </div>
          </section>

          <section className="sky-card">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Manual start</div>
              <h2 className="h5 mb-0">Run selected workflow</h2>
            </div>
            <form className="sky-card-body" onSubmit={handleStartWorkflow}>
              <div className="sky-empty-state text-start mb-3">
                Runtime values are saved into workflow context as <code>params</code>.
                Configure workflow-level parameter definitions in Create Workflow / Manage Workflows, then reference them inside node defaults with <code>{'{{ params.example }}'}</code>.
              </div>

              {runtimeParameters.length > 0 ? (
                <div className="row g-3 mb-3">
                  {runtimeParameters.map((parameter) => {
                    const inputId = `runtime-param-${parameter.key}`;
                    const value = runtimeParameterValues[parameter.key] ?? '';

                    if (parameter.type === 'boolean') {
                      return (
                        <div className="col-12" key={parameter.key}>
                          <div className="form-check form-switch">
                            <input
                              checked={Boolean(value)}
                              className="form-check-input"
                              id={inputId}
                              onChange={(event) => setRuntimeParameterValues((current) => ({ ...current, [parameter.key]: event.target.checked }))}
                              type="checkbox"
                            />
                            <label className="form-check-label" htmlFor={inputId}>
                              {parameter.label}
                            </label>
                          </div>
                          {parameter.description && <div className="form-text sky-muted">{parameter.description}</div>}
                        </div>
                      );
                    }

                    return (
                      <div className="col-lg-6" key={parameter.key}>
                        <label className="form-label" htmlFor={inputId}>
                          {parameter.label}
                          {parameter.required && <span className="text-danger ms-1">*</span>}
                        </label>
                        {parameter.type === 'select' ? (
                          <select
                            className="form-select sky-form-control"
                            id={inputId}
                            onChange={(event) => setRuntimeParameterValues((current) => ({ ...current, [parameter.key]: event.target.value }))}
                            required={parameter.required}
                            value={String(value)}
                          >
                            <option value="">{parameter.prompt || `Select ${parameter.label}`}</option>
                            {parameter.options.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : parameter.type === 'json' ? (
                          <textarea
                            className="form-control sky-form-control sky-mono"
                            id={inputId}
                            onChange={(event) => setRuntimeParameterValues((current) => ({ ...current, [parameter.key]: event.target.value }))}
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
                            onChange={(event) => setRuntimeParameterValues((current) => ({ ...current, [parameter.key]: event.target.value }))}
                            placeholder={parameter.prompt || parameter.key}
                            required={parameter.required}
                            type={parameter.type === 'number' ? 'number' : parameter.type === 'date' ? 'date' : 'text'}
                            value={String(value)}
                          />
                        )}
                        <div className="form-text sky-muted">
                          {parameter.description || `${parameter.type} parameter saved as params.${parameter.key}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="sky-empty-state text-start mb-3">
                  This workflow has no runtime parameter schema yet. It will run with saved node defaults only.
                </div>
              )}

              {runtimeParameterError && <div className="alert alert-danger py-2">{runtimeParameterError}</div>}

              <button
                className="btn sky-btn-primary"
                disabled={starting || !selectedDefinitionDetail || !canStart}
                type="submit"
              >
                {starting ? 'Running workflow...' : runtimeParameters.length > 0 ? 'Start workflow with parameters' : 'Start workflow'}
              </button>
              {!canStart && (
                <div className="small sky-muted mt-2">
                  TEMPORAL_WORKFLOW_START or WORKER_SCHEDULE_RUN permission is required.
                </div>
              )}
            </form>
          </section>
        </div>
      )}
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
