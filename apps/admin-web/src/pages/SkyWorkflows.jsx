import { useEffect, useMemo, useState } from 'react';
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
          <div className="fw-bold">Operational command</div>
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
    return `Started child SkyServer workflow ${output.workflowDisplayName || output.workflowCode || ''}.`.trim();
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
  const [filters, setFilters] = useState({ status: '', limit: '25' });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [runActionLoading, setRunActionLoading] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedRuntimeNodeIndex, setSelectedRuntimeNodeIndex] = useState(null);

  const selectedRun = selectedRunDetail?.run || null;
  const selectedNodeRuns = selectedRunDetail?.nodeRuns || [];
  const selectedApprovals = selectedRunDetail?.approvals || [];
  const selectedTemporalRuntime = getTemporalRuntime(selectedRunDetail);
  const selectedRelations = selectedRunDetail?.relations || {};
  const selectedRunTree = selectedRunDetail?.runTree || selectedRelations.runTree || null;
  const runtimeVisualNodes = selectedRunDetail?.definitionGraph?.nodes?.length
    ? selectedRunDetail.definitionGraph.nodes
    : selectedDefinitionDetail?.nodes?.length
      ? selectedDefinitionDetail.nodes
      : selectedNodeRuns;
  const isHistoryMode = mode === 'history';

  const runStats = useMemo(() => {
    const completed = runs.filter((run) => run.status === 'COMPLETED').length;
    const running = runs.filter((run) => run.status === 'RUNNING' || run.status === 'QUEUED').length;
    const failed = runs.filter((run) => run.status === 'FAILED' || run.status === 'TERMINATED').length;

    return { completed, running, failed };
  }, [runs]);

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
    const result = await workflowService.listRuns(nextFilters);
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

  async function loadRunDetail(workflowRunRecordId) {
    if (!workflowRunRecordId) {
      return;
    }

    setError('');

    try {
      const detail = await workflowService.getRun(workflowRunRecordId);
      setSelectedRunDetail(detail);

      if (detail.run?.workflowCode) {
        const definitionDetail = await workflowService.getDefinition(detail.run.workflowCode);
        setSelectedDefinitionDetail(definitionDetail.definition);
      }
    } catch (loadError) {
      setError(formatApiError(loadError, 'Failed to load workflow run detail.'));
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

    try {
      const result = await workflowService.startWorkflow(selectedDefinitionDetail.workflowCode, {
        input: {
          runSource: 'manual',
          triggerType: 'MANUAL',
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
      setError(formatApiError(startError, 'Failed to start workflow.'));
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
        reason: 'Canceled from SkyServer Workflow History.',
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

    const reason = window.prompt('Terminate this workflow run? Add a cleanup reason:', 'Terminated from SkyServer Workflow History.');

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
    loadRuns(nextFilters, { keepSelection: false });
  }

  useEffect(() => {
    loadPage({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedRuntimeNodeIndex(null);
  }, [selectedRun?.workflowRunRecordId]);

  const pageKicker = isHistoryMode ? 'Workflows · History' : 'Workflows · Start';
  const pageTitle = isHistoryMode ? 'Workflow History' : 'Start Workflow';
  const pageSubtitle = isHistoryMode
    ? 'Inspect SkyServer workflow runs, node outcomes, and the executor ledger.'
    : 'Start approved SkyServer workflow definitions built from tools, Temporal templates, APIs, agents, and future node types.';

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

      <section className="sky-worker-hero mb-4">
        <div>
          <div className="sky-page-kicker">Workflow builder foundation</div>
          <h2 className="h4 mb-2">Composable execution lane</h2>
          <p className="sky-muted mb-3">
            SkyServer workflows compose lower-level primitives. Tools remain first-class building
            blocks, while Temporal templates can be plugged in as one node type instead of turning
            every primitive into a separate workflow.
          </p>
          <div className="sky-worker-command-strip">
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Definitions</div>
              <div className="sky-worker-command-value">{definitions.length}</div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Running</div>
              <div className="sky-worker-command-value">{runStats.running}</div>
            </div>
            <div className="sky-worker-command-card">
              <div className="sky-page-kicker">Failed</div>
              <div className="sky-worker-command-value">{runStats.failed}</div>
            </div>
          </div>
        </div>

        <div className="sky-card">
          <div className="sky-card-header">
            <div className="sky-page-kicker">Selected definition</div>
            <h3 className="h5 mb-0">{selectedDefinitionDetail?.displayName || 'No workflow selected'}</h3>
          </div>
          <div className="sky-card-body">
            <p className="sky-muted mb-3">{selectedDefinitionDetail?.description || 'Select a workflow definition to inspect it.'}</p>
            <div className="row g-2">
              <div className="col-4">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Status</div>
                  <div className="sky-mini-metric-value">{selectedDefinitionDetail?.status || '—'}</div>
                </div>
              </div>
              <div className="col-4">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Nodes</div>
                  <div className="sky-mini-metric-value">{selectedDefinitionDetail?.nodes?.length || 0}</div>
                </div>
              </div>
              <div className="col-4">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Edges</div>
                  <div className="sky-mini-metric-value">{selectedDefinitionDetail?.edges?.length || 0}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="row g-4 sky-workbench-row sky-workbench-row-history">
        <div className="col-xxl-3 col-xl-4 sky-workbench-rail">
          {!isHistoryMode && (
            <section className="sky-card mb-4 sky-sticky-detail-card">
              <div className="sky-card-header">
                <div className="sky-page-kicker">Workflow launcher</div>
                <h2 className="h5 mb-0">Choose workflow</h2>
              </div>
              <div className="sky-card-body">
                {definitions.length > 0 ? (
                  <>
                    <label className="form-label" htmlFor="workflowStartDefinition">Active workflow</label>
                    <select
                      className="form-select sky-form-control mb-3"
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

                    <div className="sky-worker-command-card">
                      <div className="sky-page-kicker">Selected workflow</div>
                      <div className="fw-bold">{selectedDefinitionDetail?.displayName || selectedDefinition?.displayName}</div>
                      <div className="small sky-muted sky-mono mb-2">{selectedDefinition?.workflowCode}</div>
                      <p className="small sky-muted mb-3">{selectedDefinitionDetail?.description || 'No description.'}</p>
                      <div className="d-flex flex-wrap gap-2">
                        <span className="sky-pill sky-pill-success">{selectedDefinitionDetail?.status || 'ACTIVE'}</span>
                        <span className="sky-pill sky-pill-info">{selectedDefinitionDetail?.nodes?.length || 0} node(s)</span>
                        <span className="sky-pill sky-pill-info">{selectedDefinitionDetail?.edges?.length || 0} edge(s)</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="sky-empty-state">No active workflow definitions are available.</div>
                )}
              </div>
            </section>
          )}

          {isHistoryMode && (
            <section className="sky-card sky-sticky-detail-card">
              <div className="sky-card-header">
                <div className="sky-page-kicker">Run detail</div>
                <h2 className="h5 mb-0">Selected workflow</h2>
              </div>
              <div className="sky-card-body">
                {!selectedRun ? (
                  <div className="sky-empty-state py-4">Select a workflow run to inspect it.</div>
                ) : (
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
                      <dt className="col-4 sky-detail-label">Started by</dt>
                      <dd className="col-8 sky-detail-value">{selectedRun.startedByDisplayName || selectedRun.startedByEmail || '—'}</dd>
                      <dt className="col-4 sky-detail-label">Executor</dt>
                      <dd className="col-8 sky-detail-value sky-mono">{selectedRun.metadata?.executor || '—'}</dd>
                      <dt className="col-4 sky-detail-label">Temporal workflow</dt>
                      <dd className="col-8 sky-detail-value sky-mono text-break">{selectedRun.temporalWorkflowId || '—'}</dd>
                      <dt className="col-4 sky-detail-label">Temporal run</dt>
                      <dd className="col-8 sky-detail-value sky-mono text-break">{selectedRun.temporalRunId || '—'}</dd>
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
                )}
              </div>
            </section>
          )}
        </div>

        <div className="col-xxl-9 col-xl-8 sky-workbench-main">
          {!isHistoryMode && (
            <>
              <section className="sky-card mb-4">
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
                    This workflow will run with the node parameter defaults configured in
                    Create Workflow / Manage Workflows. Update the workflow graph to change node
                    inputs before launch.
                  </div>
                  <button
                    className="btn sky-btn-primary"
                    disabled={starting || !selectedDefinitionDetail || !canStart}
                    type="submit"
                  >
                    {starting ? 'Running workflow...' : 'Start workflow'}
                  </button>
                  {!canStart && (
                    <div className="small sky-muted mt-2">
                      TEMPORAL_WORKFLOW_START or WORKER_SCHEDULE_RUN permission is required.
                    </div>
                  )}
                </form>
              </section>
            </>
          )}

          {isHistoryMode && (
            <>
              <section className="sky-card mb-4">
                <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
                  <div>
                    <div className="sky-page-kicker">Recent runs</div>
                    <h2 className="h5 mb-0">SkyServer workflow runs</h2>
                  </div>
                  <div className="sky-inline-filter-form">
                    <select
                      className="form-select sky-form-control"
                      onChange={(event) => updateFilter('status', event.target.value)}
                      value={filters.status}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="form-select sky-form-control"
                      onChange={(event) => updateFilter('limit', event.target.value)}
                      value={filters.limit}
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </div>
                </div>
                <div className="table-responsive sky-table-card">
                  <table className="table table-sm table-hover sky-table align-middle">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Workflow</th>
                        <th>Started</th>
                        <th>Completed</th>
                        <th>Duration</th>
                        <th>Runtime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && (
                        <tr>
                          <td colSpan="6"><div className="sky-empty-state">Loading workflow runs...</div></td>
                        </tr>
                      )}
                      {!loading && runs.length === 0 && (
                        <tr>
                          <td colSpan="6"><div className="sky-empty-state">No workflow runs found.</div></td>
                        </tr>
                      )}
                      {!loading && runs.map((run) => (
                        <tr
                          className={`sky-clickable-row ${selectedRun?.workflowRunRecordId === run.workflowRunRecordId ? 'sky-selected-row' : ''}`}
                          key={run.workflowRunRecordId}
                          onClick={() => loadRunDetail(run.workflowRunRecordId)}
                        >
                          <td><span className={`sky-pill ${statusClass(run.status)}`}>{run.status}</span></td>
                          <td>
                            <div className="fw-bold">{run.workflowDisplayName || run.workflowCode}</div>
                            <div className="small sky-mono sky-muted">{run.workflowCode}</div>
                            <div className="d-flex flex-wrap gap-1 mt-1">
                              {getRunRelationLabel(run) && (
                                <span className="sky-pill sky-pill-warning">{getRunRelationLabel(run)}</span>
                              )}
                              {run.metadata?.parentWorkflowRunRecordId && (
                                <span className="sky-pill sky-pill-info">Has parent</span>
                              )}
                            </div>
                          </td>
                          <td>{formatDate(run.startedAt || run.createdAt)}</td>
                          <td>{formatDate(run.completedAt)}</td>
                          <td>{formatDuration(getRunDurationMs(run))}</td>
                          <td>
                            {run.temporalWorkflowId ? (
                              <span className="sky-pill sky-pill-success">Temporal-backed</span>
                            ) : (
                              <span className="sky-pill sky-pill-info">Inline</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>


              <section className="sky-card mb-4">
                <div className="sky-card-body">
                  {!selectedRun ? (
                    <div className="sky-empty-state">Select a workflow run to view the runtime graph overlay.</div>
                  ) : (
                    <WorkflowVisualGraph
                      approvals={selectedApprovals}
                      headingKicker="Runtime status overlay"
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
            </>
          )}
        </div>
      </div>
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
