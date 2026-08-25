import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import workflowService from '../services/workflowService.js';
import { getNextSortState, serializeSorts } from '../utils/tableSorting.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const PAGE_SIZE = 10;
const APPROVAL_HISTORY_DEFAULT_SORTS = [{ field: 'requestedAt', direction: 'desc' }];
const DEFAULT_FILTERS = {
  q: '',
  status: 'ALL',
  workflowCode: '',
  requiredRoleCode: '',
  userId: '',
};

const STANDARD_STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'TIMED_OUT', label: 'Timed out' },
  { value: 'CANCELED', label: 'Canceled' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDurationMs(value) {
  const durationMs = Number(value || 0);

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 'No timeout';
  }

  const minutes = durationMs / 60000;

  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  const hours = minutes / 60;

  if (hours < 48) {
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
  }

  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} day(s)`;
}

function formatIdentity(displayName, email, fallback = 'System / unavailable') {
  const name = String(displayName || '').trim();
  const address = String(email || '').trim();

  if (name && address) {
    return `${name} · ${address}`;
  }

  return name || address || fallback;
}

function statusClass(status) {
  const normalized = String(status || '').toUpperCase();

  if (normalized === 'PENDING') {
    return 'sky-pill-warning';
  }

  if (normalized === 'APPROVED') {
    return 'sky-pill-success';
  }

  if (['REJECTED', 'TIMED_OUT', 'CANCELED', 'CANCELLED'].includes(normalized)) {
    return 'sky-pill-danger';
  }

  return 'sky-pill-info';
}

function formatAction(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const labels = {
    CONTINUE: 'Continue workflow',
    FAIL_WORKFLOW: 'Fail workflow',
    STOP_FAILURE: 'Stop workflow as failed',
    STOP_SUCCESS: 'Stop workflow successfully',
    STOP_WORKFLOW: 'Stop workflow',
  };

  if (!normalized) {
    return '—';
  }

  return labels[normalized] || normalized
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function ApprovalDetailField({ label, value, mono = false }) {
  return (
    <div className="sky-node-parameter-preview">
      <div className="sky-page-kicker">{label}</div>
      <div className={`sky-detail-value mt-1 ${mono ? 'sky-mono' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}

function WorkflowApprovals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    q: (searchParams.get('approvalRequestId') || '').trim(),
  }));
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [approvals, setApprovals] = useState([]);
  const [facets, setFacets] = useState({
    roles: [],
    statuses: [],
    users: [],
    workflows: [],
  });
  const [selectedApprovalId, setSelectedApprovalId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sorts, setSorts] = useState(() => APPROVAL_HISTORY_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const requestedApprovalId = (searchParams.get('approvalRequestId') || '').trim();

  useEffect(() => {
    if (!requestedApprovalId) return;
    setFilters((current) =>
      current.q === requestedApprovalId ? current : { ...current, q: requestedApprovalId },
    );
    setPage(1);
    setSelectedApprovalId('');
  }, [requestedApprovalId]);

  const selectedApproval = useMemo(
    () => approvals.find((approval) => approval.approvalRequestId === selectedApprovalId) || null,
    [approvals, selectedApprovalId],
  );
  const pendingCount = useMemo(
    () => Number(
      facets.statuses.find((item) => String(item.status || '').toUpperCase() === 'PENDING')?.count || 0,
    ),
    [facets.statuses],
  );
  const statusOptions = useMemo(() => {
    const known = new Set(STANDARD_STATUS_OPTIONS.map((option) => option.value));
    const dynamic = facets.statuses
      .map((item) => String(item.status || '').toUpperCase())
      .filter((status) => status && !known.has(status))
      .map((status) => ({ value: status, label: status.replace(/_/g, ' ') }));

    return [...STANDARD_STATUS_OPTIONS, ...dynamic];
  }, [facets.statuses]);
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  async function loadApprovals({ preserveSelection = true, nextSorts = sorts } = {}) {
    setLoading(true);
    setError('');

    try {
      const result = await workflowService.listApprovals({
        ...filters,
        page,
        limit: PAGE_SIZE,
        sort: serializeSorts(nextSorts),
      });
      const items = result.items || [];
      const resolvedPageCount = Math.max(1, Number(result.pageCount || 1));

      if (page > resolvedPageCount) {
        setPage(resolvedPageCount);
        return;
      }

      setApprovals(items);
      setTotal(Number(result.total || 0));
      setPageCount(resolvedPageCount);
      setFacets({
        roles: result.facets?.roles || [],
        statuses: result.facets?.statuses || [],
        users: result.facets?.users || [],
        workflows: result.facets?.workflows || [],
      });

      const preservedId = preserveSelection && items.some(
        (approval) => approval.approvalRequestId === selectedApprovalId,
      )
        ? selectedApprovalId
        : '';
      setSelectedApprovalId(preservedId || items[0]?.approvalRequestId || '');
    } catch (loadError) {
      setError(loadError.message || 'Failed to load workflow approval history.');
      setApprovals([]);
      setSelectedApprovalId('');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApprovals({ preserveSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, sorts]);

  function updateFilter(name, value) {
    if (name === 'q' && searchParams.has('approvalRequestId')) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('approvalRequestId');
      setSearchParams(nextSearchParams, { replace: true });
    }

    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  }

  function clearFilters() {
    if (searchParams.has('approvalRequestId')) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('approvalRequestId');
      setSearchParams(nextSearchParams, { replace: true });
    }

    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function applySorting(nextSorts, customized) {
    setSorts(nextSorts);
    setSortingCustomized(customized);
    setPage(1);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: APPROVAL_HISTORY_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(APPROVAL_HISTORY_DEFAULT_SORTS, false);
  }

  function renderSortableHeader(label, field) {
    const activeIndex = sorts.findIndex((sort) => sort.field === field);
    const activeSort = activeIndex >= 0 ? sorts[activeIndex] : null;
    const directionIcon = activeSort?.direction === 'asc' ? '↑' : '↓';
    const sortDescription = activeSort
      ? `${activeSort.direction === 'asc' ? 'ascending' : 'descending'}, priority ${activeIndex + 1}`
      : 'not currently sorted';

    return (
      <th>
        <button
          aria-label={`${label}: ${sortDescription}. Click to sort; Shift+click to add to multi-column sorting.`}
          className={`sky-table-sort-button ${activeSort ? 'is-active' : ''}`}
          onClick={(event) => updateSorting(field, event)}
          title="Click to sort · Shift+click to add sort"
          type="button"
        >
          <span>{label}</span>
          <span className="sky-table-sort-indicator" aria-hidden="true">{activeSort ? directionIcon : '↕'}</span>
          {activeSort && <span className="sky-table-sort-priority" aria-hidden="true">{activeIndex + 1}</span>}
        </button>
      </th>
    );
  }

  function goToPage(nextPage) {
    setPage(Math.min(Math.max(1, Number(nextPage) || 1), pageCount));
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-canonical-operations-pagination-row">
        <div className="small sky-muted sky-canonical-operations-pagination-summary">
          Showing {rangeStart}-{rangeEnd} of {total} approval record(s)
        </div>
        <div className="sky-pagination-controls sky-canonical-operations-pagination-controls" aria-label="Approval history pagination">
          <button aria-label="First page" className="btn btn-sm sky-pagination-nav-button" disabled={page <= 1} onClick={() => goToPage(1)} title="First page" type="button">«</button>
          <button aria-label="Previous page" className="btn btn-sm sky-pagination-nav-button" disabled={page <= 1} onClick={() => goToPage(page - 1)} title="Previous page" type="button">‹</button>
          <label className="sky-pagination-select-label" htmlFor="approvalHistoryPageSelect">Page</label>
          <select className="form-select form-select-sm sky-form-control sky-pagination-select" id="approvalHistoryPageSelect" onChange={(event) => goToPage(event.target.value)} value={page}>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
              <option key={pageNumber} value={pageNumber}>{pageNumber}</option>
            ))}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button aria-label="Next page" className="btn btn-sm sky-pagination-nav-button" disabled={page >= pageCount} onClick={() => goToPage(page + 1)} title="Next page" type="button">›</button>
          <button aria-label="Last page" className="btn btn-sm sky-pagination-nav-button" disabled={page >= pageCount} onClick={() => goToPage(pageCount)} title="Last page" type="button">»</button>
        </div>
        <div className="sky-canonical-operations-pagination-balance" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="sky-page-shell">
      <header className="sky-page-header">
        <div className="sky-page-heading">
          <div className="sky-page-kicker">Workflows · Approval History</div>
          <h1 className="sky-page-title">Approval History</h1>
          <p className="sky-page-subtitle">
            Search every human approval checkpoint across workflows, roles, requesters, and decision makers. Approval decisions are now completed directly from the workflow graph.
          </p>
        </div>
        <div className="sky-page-actions">
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={() => loadApprovals({ preserveSelection: true })}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <section className="sky-card mb-4 sky-functional-history-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Approval browser</div>
            <h2 className="h5 mb-0">Human approval records</h2>
            <p className="sky-muted small mb-0">
              Select a row to inspect the complete request, authorization requirement, and recorded decision below.
            </p>
            <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
              <span className="sky-pill sky-pill-info">{total} record(s)</span>
              {pendingCount > 0 && (
                <span className="sky-pill sky-pill-warning">{pendingCount} pending</span>
              )}
            </div>
          </div>
          <div className="sky-run-tools-filter-grid sky-manage-workflows-filter-grid">
            <div className="sky-run-tools-search-filter">
              <label className="form-label" htmlFor="approvalHistorySearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="approvalHistorySearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Workflow, approval, node, role, user, note..."
                type="search"
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="approvalHistoryStatus">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="approvalHistoryStatus"
                onChange={(event) => updateFilter('status', event.target.value)}
                value={filters.status}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="approvalHistoryWorkflow">
                Workflow
              </label>
              <select
                className="form-select sky-form-control"
                id="approvalHistoryWorkflow"
                onChange={(event) => updateFilter('workflowCode', event.target.value)}
                value={filters.workflowCode}
              >
                <option value="">All workflows</option>
                {facets.workflows.map((workflow) => (
                  <option key={workflow.value} value={workflow.value}>
                    {workflow.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="approvalHistoryRole">
                Required role
              </label>
              <select
                className="form-select sky-form-control"
                id="approvalHistoryRole"
                onChange={(event) => updateFilter('requiredRoleCode', event.target.value)}
                value={filters.requiredRoleCode}
              >
                <option value="">All roles</option>
                {facets.roles.map((roleCode) => (
                  <option key={roleCode} value={roleCode}>
                    {roleCode}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="approvalHistoryUser">
                User
              </label>
              <select
                className="form-select sky-form-control"
                id="approvalHistoryUser"
                onChange={(event) => updateFilter('userId', event.target.value)}
                value={filters.userId}
              >
                <option value="">All users</option>
                {facets.users.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {formatIdentity(user.displayName, user.email, user.userId)}
                  </option>
                ))}
              </select>
            </div>
            <div className="sky-run-tools-filter-actions">
              {sortingCustomized && (
                <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">Clear sorting</button>
              )}
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
          <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
            <thead>
              <tr>
                {renderSortableHeader('Workflow', 'workflow')}
                {renderSortableHeader('Approval', 'approval')}
                {renderSortableHeader('Status', 'status')}
                {renderSortableHeader('Required role', 'requiredRole')}
                {renderSortableHeader('Requested by', 'requestedBy')}
                {renderSortableHeader('Requested', 'requestedAt')}
                {renderSortableHeader('Decided by', 'decidedBy')}
                {renderSortableHeader('Decided', 'decidedAt')}
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9">
                    <div className="sky-empty-state">Loading approval history...</div>
                  </td>
                </tr>
              ) : approvals.length === 0 ? (
                <tr>
                  <td colSpan="9">
                    <div className="sky-empty-state">
                      No approval records match the current filters.
                    </div>
                  </td>
                </tr>
              ) : (
                approvals.map((approval) => {
                  const selected = selectedApprovalId === approval.approvalRequestId;

                  return (
                    <tr
                      className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                      key={approval.approvalRequestId}
                      onClick={() => setSelectedApprovalId(approval.approvalRequestId)}
                    >
                      <td>
                        <div className="fw-bold">
                          {approval.workflowDisplayName || approval.workflowCode}
                        </div>
                        <div className="small sky-muted sky-mono">{approval.workflowCode}</div>
                      </td>
                      <td>
                        <div className="fw-bold">{approval.approvalTitle || approval.nodeDisplayName}</div>
                        <div className="small sky-muted sky-mono">
                          {approval.nodeKey} · {approval.approvalKey}
                        </div>
                      </td>
                      <td>
                        <span className={`sky-pill ${statusClass(approval.status)}`}>
                          {approval.status || 'UNKNOWN'}
                        </span>
                      </td>
                      <td>{approval.requiredRoleCode || 'Any approver'}</td>
                      <td>{formatIdentity(approval.requestedByDisplayName, approval.requestedByEmail)}</td>
                      <td>{formatDate(approval.requestedAt || approval.createdAt)}</td>
                      <td>
                        {formatIdentity(
                          approval.decidedByDisplayName,
                          approval.decidedByEmail,
                          approval.status === 'PENDING' ? 'Awaiting decision' : 'System / unavailable',
                        )}
                      </td>
                      <td>{formatDate(approval.decidedAt)}</td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedApprovalId(approval.approvalRequestId);
                          }}
                          type="button"
                        >
                          {selected ? 'Selected' : 'View result'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </section>

      <section className="sky-card">
        <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">Selected approval record</div>
            <h2 className="h5 mb-0">
              {selectedApproval?.approvalTitle || 'Approval result'}
            </h2>
            {selectedApproval && (
              <div className="small sky-muted mt-1">
                {selectedApproval.workflowDisplayName || selectedApproval.workflowCode} · {selectedApproval.nodeDisplayName || selectedApproval.nodeKey}
              </div>
            )}
          </div>
          {selectedApproval && (
            <div className="d-flex flex-wrap gap-2">
              <span className={`sky-pill ${statusClass(selectedApproval.status)}`}>
                {selectedApproval.status}
              </span>
              <span className="sky-pill sky-pill-info">
                {selectedApproval.requiredRoleCode || 'Any approver'}
              </span>
            </div>
          )}
        </div>
        <div className="sky-card-body">
          {!selectedApproval ? (
            <div className="sky-empty-state">
              Select an approval row to inspect its recorded result.
            </div>
          ) : (
            <div className="d-flex flex-column gap-4">
              <div>
                <div className="sky-page-kicker mb-2">Approval request</div>
                <div className="table-responsive sky-table-card">
                  <table className="table table-sm sky-table align-middle mb-0">
                    <tbody>
                      <tr>
                        <th scope="row">Workflow</th>
                        <td>{selectedApproval.workflowDisplayName || selectedApproval.workflowCode}</td>
                        <th scope="row">Workflow code</th>
                        <td className="sky-mono">{selectedApproval.workflowCode || '—'}</td>
                      </tr>
                      <tr>
                        <th scope="row">Approval step</th>
                        <td>{selectedApproval.nodeDisplayName || selectedApproval.nodeKey || '—'}</td>
                        <th scope="row">Required role</th>
                        <td>
                          <span className="sky-pill sky-pill-info">
                            {selectedApproval.requiredRoleCode || 'Any authorized approver'}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Node key</th>
                        <td className="sky-mono">{selectedApproval.nodeKey || '—'}</td>
                        <th scope="row">Approval key</th>
                        <td className="sky-mono">{selectedApproval.approvalKey || '—'}</td>
                      </tr>
                      <tr>
                        <th scope="row">Requested by</th>
                        <td>
                          {formatIdentity(
                            selectedApproval.requestedByDisplayName,
                            selectedApproval.requestedByEmail,
                          )}
                        </td>
                        <th scope="row">Requested at</th>
                        <td>{formatDate(selectedApproval.requestedAt || selectedApproval.createdAt)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Approval window</th>
                        <td>{formatDurationMs(selectedApproval.timeoutMs)}</td>
                        <th scope="row">Expires at</th>
                        <td>{formatDate(selectedApproval.expiresAt)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Instructions</th>
                        <td colSpan="3">
                          {selectedApproval.instructions || 'No approval instructions were recorded.'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="sky-page-kicker mb-2">Recorded result</div>
                <div className="table-responsive sky-table-card">
                  <table className="table table-sm sky-table align-middle mb-0">
                    <tbody>
                      <tr>
                        <th scope="row">Decision</th>
                        <td>
                          <span className={`sky-pill ${statusClass(selectedApproval.status)}`}>
                            {selectedApproval.status || 'UNKNOWN'}
                          </span>
                        </td>
                        <th scope="row">Decided by</th>
                        <td>
                          {formatIdentity(
                            selectedApproval.decidedByDisplayName,
                            selectedApproval.decidedByEmail,
                            selectedApproval.status === 'PENDING'
                              ? 'Awaiting decision'
                              : 'System / unavailable',
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Decided at</th>
                        <td>{formatDate(selectedApproval.decidedAt)}</td>
                        <th scope="row">Temporal execution</th>
                        <td>
                          {selectedApproval.temporalWorkflowId
                            ? 'Linked to workflow execution'
                            : 'No Temporal execution link recorded'}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">If rejected</th>
                        <td>
                          {selectedApproval.rejectTargetNodeKey
                            ? `Jump to ${selectedApproval.rejectTargetNodeKey}`
                            : formatAction(selectedApproval.onReject)}
                        </td>
                        <th scope="row">If timed out</th>
                        <td>{formatAction(selectedApproval.onTimeout)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Decision note</th>
                        <td colSpan="3">
                          {selectedApproval.decisionNote || (
                            selectedApproval.status === 'PENDING'
                              ? 'No decision has been recorded.'
                              : 'No decision note was provided.'
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <details className="sky-node-parameter-preview">
                <summary className="sky-page-kicker">Technical identifiers and metadata</summary>
                <div className="sky-node-parameter-preview-grid mt-3">
                  <ApprovalDetailField label="Approval request ID" value={selectedApproval.approvalRequestId} mono />
                  <ApprovalDetailField label="Workflow run ID" value={selectedApproval.workflowRunRecordId} mono />
                  <ApprovalDetailField label="Workflow node run ID" value={selectedApproval.workflowNodeRunRecordId} mono />
                  <ApprovalDetailField label="Temporal workflow ID" value={selectedApproval.temporalWorkflowId} mono />
                  <ApprovalDetailField label="Temporal run ID" value={selectedApproval.temporalRunId} mono />
                  <ApprovalDetailField label="Signal name" value={selectedApproval.signalName} mono />
                  <ApprovalDetailField label="Created" value={formatDate(selectedApproval.createdAt)} />
                  <ApprovalDetailField label="Updated" value={formatDate(selectedApproval.updatedAt)} />
                </div>
                <pre className="sky-json-block mt-3 mb-0">
                  {JSON.stringify(selectedApproval.metadata || {}, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default WorkflowApprovals;
