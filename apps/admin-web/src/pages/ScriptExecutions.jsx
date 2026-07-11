import { useEffect, useState } from 'react';
import adminService from '../services/adminService';

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
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

function ScriptExecutions() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState({ status: '', limit: 25 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadExecutions(nextFilters = filters) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listScriptExecutions(nextFilters);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setSelectedItem((currentSelected) => {
        if (!currentSelected) {
          return result.items?.[0] || null;
        }

        return (
          result.items?.find((item) => item.executionId === currentSelected.executionId) ||
          result.items?.[0] ||
          null
        );
      });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load script executions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExecutions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    loadExecutions(nextFilters);
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
          onClick={() => loadExecutions()}
          type="button"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-card mb-3">
        <div className="sky-card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
              <label className="form-label" htmlFor="statusFilter">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="statusFilter"
                onChange={(event) => updateFilter('status', event.target.value)}
                value={filters.status}
              >
                <option value="">All</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILED">FAILED</option>
                <option value="STARTED">RUNNING / STARTED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>

            <div className="col-md-4">
              <label className="form-label" htmlFor="limitFilter">
                Limit
              </label>
              <select
                className="form-select sky-form-control"
                id="limitFilter"
                onChange={(event) => updateFilter('limit', event.target.value)}
                value={filters.limit}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </div>

            <div className="col-md-4 text-md-end sky-muted">
              Showing {items.length} of {total}
            </div>
          </div>
        </div>
      </section>

      <div className="row g-3">
        <div className="col-xl-7">
          <section className="sky-card sky-table-card">
            {loading ? (
              <div className="sky-empty-state">
                <div className="spinner-border text-info" role="status" aria-label="Loading" />
                <div className="mt-3">Loading executions...</div>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
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
                        <td>{formatDuration(item)}</td>
                        <td>{formatDate(item.startedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-5">
          <section className="sky-card">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Execution detail</h2>
            </div>
            <div className="sky-card-body">
              {selectedItem ? (
                <>
                  <dl className="row g-2">
                    <dt className="col-sm-4 sky-detail-label">Execution</dt>
                    <dd className="col-sm-8 sky-mono small sky-detail-value">
                      {selectedItem.executionId}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Status</dt>
                    <dd className="col-sm-8">
                      <span className={`sky-pill ${statusClass(selectedItem.status)}`}>
                        {getStatusLabel(selectedItem.status)}
                      </span>
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">User</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {selectedItem.displayName || selectedItem.email || '—'}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Started</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {formatDate(selectedItem.startedAt)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Finished</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {formatDate(selectedItem.finishedAt)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Duration</dt>
                    <dd className="col-sm-8 sky-detail-value">{formatDuration(selectedItem)}</dd>

                    <dt className="col-sm-4 sky-detail-label">Summary</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {getDisplaySummary(selectedItem.summary, selectedItem.status)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Logs</dt>
                    <dd className="col-sm-8">
                      <span className="sky-pill">
                        stdout: {selectedItem.hasStdoutLog ? 'yes' : 'no'}
                      </span>{' '}
                      <span className="sky-pill">
                        stderr: {selectedItem.hasStderrLog ? 'yes' : 'no'}
                      </span>
                    </dd>
                  </dl>

                  <div className="mb-2 sky-detail-label">Execution metadata</div>
                  <pre className="sky-code-block">
                    {JSON.stringify(selectedItem.metadata || {}, null, 2)}
                  </pre>
                </>
              ) : (
                <div className="sky-empty-state">Select an execution to inspect.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default ScriptExecutions;
