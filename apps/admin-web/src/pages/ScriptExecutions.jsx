import { useEffect, useState } from 'react';
import SmartPollingStatus from '../components/ui/SmartPollingStatus.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import adminService from '../services/adminService';

const TOOL_HISTORY_PAGE_SIZE = 10;

function isActiveExecution(item) {
  return String(item?.status || '').toUpperCase() === 'STARTED';
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

function statusClass(status) {
  if (status === 'SUCCESS') {
    return 'sky-pill-success';
  }

  if (status === 'FAILED') {
    return 'sky-pill-danger';
  }

  if (status === 'STARTED') {
    return 'sky-pill-warning sky-pill-pulse';
  }

  if (status === 'CANCELLED') {
    return 'sky-pill-info';
  }

  return 'sky-pill-info';
}

function getStatusLabel(status) {
  if (status === 'STARTED') {
    return 'RUNNING';
  }

  return status || 'UNKNOWN';
}

function getDisplaySummary(summary, status) {
  if (status === 'STARTED' && !summary) {
    return 'Execution is currently running.';
  }

  if (!summary) {
    return '—';
  }

  const lines = String(summary)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.find((line) => /✅|successfully|connected|complete|completed/i.test(line)) ||
    lines.find((line) => !line.includes('[dotenv')) ||
    lines[0] ||
    String(summary)
  );
}

function formatDuration(item) {
  if (!item) {
    return '—';
  }

  if (item.durationMs !== undefined && item.durationMs !== null) {
    return `${item.durationMs} ms`;
  }

  if (item.status === 'STARTED') {
    return 'Running';
  }

  return '—';
}

function getDurationLabel(item) {
  if (!item) {
    return '—';
  }

  if (item.durationMs !== undefined && item.durationMs !== null) {
    const durationMs = Number(item.durationMs);

    if (Number.isFinite(durationMs) && durationMs >= 1000) {
      return `${(durationMs / 1000).toFixed(1)} s`;
    }
  }

  return formatDuration(item);
}

function ScriptExecutions() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState({ status: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const pageCount = Math.max(1, Math.ceil(total / TOOL_HISTORY_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart = total === 0 ? 0 : (safeCurrentPage - 1) * TOOL_HISTORY_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * TOOL_HISTORY_PAGE_SIZE, total);

  async function loadExecutions(
    nextFilters = filters,
    nextPage = currentPage,
    { keepSelection = true, quiet = false } = {},
  ) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    const safePage = Math.max(1, Number(nextPage) || 1);
    const query = {
      ...nextFilters,
      limit: TOOL_HISTORY_PAGE_SIZE,
      offset: (safePage - 1) * TOOL_HISTORY_PAGE_SIZE,
    };

    try {
      const result = await adminService.listScriptExecutions(query);
      const resultItems = result.items || [];
      const resultTotal = result.total || 0;
      const resultPageCount = Math.max(1, Math.ceil(resultTotal / TOOL_HISTORY_PAGE_SIZE));

      if (resultTotal > 0 && safePage > resultPageCount) {
        setCurrentPage(resultPageCount);
        await loadExecutions(nextFilters, resultPageCount, { keepSelection: false, quiet });
        return;
      }

      setItems(resultItems);
      setTotal(resultTotal);
      setCurrentPage(safePage);
      setSelectedItem((currentSelected) => {
        if (!keepSelection || !currentSelected) {
          return resultItems[0] || null;
        }

        return (
          resultItems.find((item) => item.executionId === currentSelected.executionId) ||
          resultItems[0] ||
          null
        );
      });

      return {
        activeCount: resultItems.filter(isActiveExecution).length,
        selectedActive: resultItems.some(
          (item) => item.executionId === selectedItem?.executionId && isActiveExecution(item),
        ),
      };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load script executions.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadExecutions(filters, 1, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollingState = useSmartPolling({
    dependencies: [filters.status, safeCurrentPage, selectedItem?.executionId],
    getDelay: ({ activeCount = 0, hidden = false, selectedActive = false } = {}) =>
      getSmartPollingDelay({
        activeCount,
        activeMs: SMART_POLLING_INTERVALS.ACTIVE,
        hidden,
        idleMs: SMART_POLLING_INTERVALS.IDLE,
        selectedActive,
        selectedActiveMs: SMART_POLLING_INTERVALS.SELECTED_ACTIVE,
      }),
    initialIntervalMs: SMART_POLLING_INTERVALS.IDLE,
    onPoll: () => loadExecutions(filters, safeCurrentPage, { keepSelection: true, quiet: true }),
  });

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    loadExecutions(nextFilters, 1, { keepSelection: false });
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    loadExecutions(filters, nextPage, { keepSelection: false });
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {rangeStart}-{rangeEnd} of {total} tool execution(s)
        </div>
        <div className="sky-pagination-controls" aria-label="Tool history pagination">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(1)}
            type="button"
          >
            First
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(safeCurrentPage - 1)}
            type="button"
          >
            Back
          </button>
          <label className="sky-pagination-select-label" htmlFor="toolHistoryPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="toolHistoryPageSelect"
            onChange={(event) => goToPage(event.target.value)}
            value={safeCurrentPage}
          >
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(safeCurrentPage + 1)}
            type="button"
          >
            Next
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(pageCount)}
            type="button"
          >
            Last
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Tools · History</div>
          <h1 className="sky-page-title">Tool History</h1>
          <p className="sky-page-subtitle">
            Read-only trace of tools launched through the API, Admin-Web, CLI-adjacent workflows,
            and workers.
          </p>
        </div>
        <button
          className="btn sky-btn-ghost"
          disabled={loading}
          onClick={() => loadExecutions(filters, safeCurrentPage)}
          type="button"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="sky-functional-history-shell sky-tool-history-shell">
        <section className="sky-card mb-4 sky-functional-history-browser">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Execution browser</div>
              <h2 className="h5 mb-0">Tool history data</h2>
              <p className="sky-muted small mb-0">
                Filter the operational tool ledger, then inspect the selected execution in the
                detail workspace below.
              </p>
              <SmartPollingStatus
                activeLabel="Running tools"
                className="mt-2"
                state={pollingState}
              />
            </div>
            <div className="sky-history-filter-grid sky-history-filter-grid-single">
              <div>
                <label className="form-label" htmlFor="statusFilter">
                  Status
                </label>
                <select
                  className="form-select sky-form-control"
                  id="statusFilter"
                  onChange={(event) => updateFilter('status', event.target.value)}
                  value={filters.status}
                >
                  <option value="">All statuses</option>
                  <option value="SUCCESS">SUCCESS</option>
                  <option value="FAILED">FAILED</option>
                  <option value="STARTED">RUNNING / STARTED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card">
            <table className="table table-sm table-hover sky-table align-middle">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="5">
                      <div className="sky-empty-state">Loading executions...</div>
                    </td>
                  </tr>
                )}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan="5">
                      <div className="sky-empty-state">
                        No tool executions found for this filter.
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  items.map((item) => (
                    <tr
                      className={`sky-clickable-row ${
                        selectedItem?.executionId === item.executionId ? 'sky-selected-row' : ''
                      }`}
                      key={item.executionId}
                      onClick={() => setSelectedItem(item)}
                    >
                      <td>
                        <div className="fw-bold sky-detail-value">{item.scriptName}</div>
                        <div className="small sky-muted">{item.category}</div>
                      </td>
                      <td>
                        <span className={`sky-pill ${statusClass(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                      <td>{formatDate(item.startedAt)}</td>
                      <td>{formatDuration(item)}</td>
                      <td>{formatDate(item.finishedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {renderPagination()}
        </section>

        <section className="sky-functional-history-detail-zone">
          <div className="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
            <div>
              <div className="sky-page-kicker">Selected execution workspace</div>
              <h2 className="h5 mb-0">Execution detail</h2>
            </div>
            <div className="small sky-muted">Execution metadata scrolls independently.</div>
          </div>

          <section className="sky-card sky-tool-history-detail-card">
            <div className="sky-card-body">
              {selectedItem ? (
                <div className="sky-execution-detail-layout">
                  <div className="sky-execution-detail-summary">
                    <div className="sky-execution-detail-title-row">
                      <div>
                        <div className="sky-page-kicker">Selected tool</div>
                        <h3 className="h5 mb-1">{selectedItem.scriptName}</h3>
                        <div className="small sky-muted">
                          {selectedItem.category || 'Uncategorized'}
                        </div>
                      </div>
                      <span className={`sky-pill ${statusClass(selectedItem.status)}`}>
                        {getStatusLabel(selectedItem.status)}
                      </span>
                    </div>

                    <div className="sky-execution-metric-grid">
                      <div className="sky-mini-metric">
                        <div className="sky-page-kicker">Duration</div>
                        <div className="sky-mini-metric-value">
                          {getDurationLabel(selectedItem)}
                        </div>
                      </div>
                      <div className="sky-mini-metric">
                        <div className="sky-page-kicker">Started</div>
                        <div className="sky-detail-value">{formatDate(selectedItem.startedAt)}</div>
                      </div>
                      <div className="sky-mini-metric">
                        <div className="sky-page-kicker">Completed</div>
                        <div className="sky-detail-value">
                          {formatDate(selectedItem.finishedAt)}
                        </div>
                      </div>
                      <div className="sky-mini-metric">
                        <div className="sky-page-kicker">Logs</div>
                        <div className="d-flex flex-wrap gap-1">
                          <span className="sky-pill">
                            stdout: {selectedItem.hasStdoutLog ? 'yes' : 'no'}
                          </span>
                          <span className="sky-pill">
                            stderr: {selectedItem.hasStderrLog ? 'yes' : 'no'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <dl className="row g-2 mb-0">
                      <dt className="col-md-3 sky-detail-label">Execution</dt>
                      <dd className="col-md-9 sky-mono small sky-detail-value">
                        {selectedItem.executionId}
                      </dd>

                      <dt className="col-md-3 sky-detail-label">User</dt>
                      <dd className="col-md-9 sky-detail-value">
                        {selectedItem.displayName || selectedItem.email || '—'}
                      </dd>

                      <dt className="col-md-3 sky-detail-label">Summary</dt>
                      <dd className="col-md-9 sky-detail-value">
                        {getDisplaySummary(selectedItem.summary, selectedItem.status)}
                      </dd>
                    </dl>
                  </div>

                  <div className="sky-execution-detail-metadata">
                    <div className="mb-2 sky-detail-label">Execution metadata</div>
                    <pre className="sky-code-block sky-tool-history-metadata-block">
                      {JSON.stringify(selectedItem.metadata || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="sky-empty-state">Select an execution to inspect.</div>
              )}
            </div>
          </section>
        </section>
      </div>
    </>
  );
}

export default ScriptExecutions;
