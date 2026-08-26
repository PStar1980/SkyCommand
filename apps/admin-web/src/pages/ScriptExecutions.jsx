import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ToolExecutionOutputPanels from '../components/tools/ToolExecutionOutputPanels.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import adminService from '../services/adminService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const TOOL_HISTORY_DEFAULT_PAGE_SIZE = 10;
const TOOL_HISTORY_PAGE_SIZE_OPTIONS = [10, 25, 50];
const TOOL_HISTORY_DEFAULT_SORTS = [{ field: 'startedAt', direction: 'desc' }];


function getAvailableToolHistoryPageSizes(total) {
  const recordCount = Math.max(0, Number(total) || 0);

  return TOOL_HISTORY_PAGE_SIZE_OPTIONS.filter((size) => {
    if (size === 10) return true;
    if (size === 25) return recordCount >= 11;
    if (size === 50) return recordCount >= 26;
    return false;
  });
}

function normalizeToolHistoryPageSize(pageSize, total) {
  const availablePageSizes = getAvailableToolHistoryPageSizes(total);
  const numericPageSize = Number(pageSize);

  if (availablePageSizes.includes(numericPageSize)) {
    return numericPageSize;
  }

  return availablePageSizes[availablePageSizes.length - 1] || TOOL_HISTORY_DEFAULT_PAGE_SIZE;
}

function serializeSorts(sorts = []) {
  return sorts.map((sort) => `${sort.field}:${sort.direction}`).join(',');
}

function sortStacksMatch(left = [], right = []) {
  return serializeSorts(left) === serializeSorts(right);
}


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

function getToolCode(item) {
  return item?.metadata?.toolCode || item?.scriptName || 'unknown_tool';
}

function getToolLabel(item) {
  return item?.metadata?.toolLabel || item?.scriptName || 'Unknown tool';
}

function getCategoryLabel(item) {
  const category = String(item?.metadata?.categoryLabel || item?.category || '').trim();

  if (!category) {
    return 'Uncategorized';
  }

  if (/\s/.test(category)) {
    return category;
  }

  return category
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedExecutionId = (searchParams.get('executionId') || '').trim();
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailRequestId = useRef(0);
  const browserCardRef = useRef(null);
  const [filters, setFilters] = useState(() => ({
    q: requestedExecutionId,
    category: '',
    scriptName: '',
    status: '',
  }));
  const [filterOptions, setFilterOptions] = useState({ categories: [], tools: [] });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(TOOL_HISTORY_DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);
  const [sorts, setSorts] = useState(() => TOOL_HISTORY_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);

  useEffect(() => {
    if (!requestedExecutionId) return;
    setFilters((current) =>
      current.q === requestedExecutionId ? current : { ...current, q: requestedExecutionId },
    );
    setCurrentPage(1);
    setSelectedItem(null);
    setSelectedDetail(null);
    setDetailsOpen(false);
  }, [requestedExecutionId]);

  const availablePageSizes = useMemo(() => getAvailableToolHistoryPageSizes(total), [total]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart = total === 0 || items.length === 0
    ? 0
    : (safeCurrentPage - 1) * pageSize + 1;
  const rangeEnd = rangeStart === 0
    ? 0
    : Math.min(rangeStart + items.length - 1, total);
  const visibleToolOptions = useMemo(
    () =>
      (filterOptions.tools || []).filter(
        (tool) => !filters.category || tool.category === filters.category,
      ),
    [filterOptions.tools, filters.category],
  );

  async function loadFilterOptions() {
    try {
      const result = await adminService.getScriptExecutionOptions();
      setFilterOptions({
        categories: result.categories || [],
        tools: result.tools || [],
      });
    } catch (loadError) {
      console.warn('[SkyCommand Tool Operations] Filter options failed to load:', loadError);
    }
  }

  async function loadExecutionDetail(executionId, { quiet = false } = {}) {
    const requestId = detailRequestId.current + 1;
    detailRequestId.current = requestId;

    if (!executionId) {
      setSelectedDetail(null);
      return null;
    }

    if (!quiet) {
      setDetailLoading(true);
      setDetailError('');
    }

    try {
      const result = await adminService.getScriptExecutionDetail(executionId);

      if (detailRequestId.current !== requestId) {
        return null;
      }

      setSelectedDetail(result);
      return result;
    } catch (loadError) {
      if (detailRequestId.current !== requestId) {
        return null;
      }

      setSelectedDetail(null);
      if (!quiet) {
        setDetailError(loadError.message || 'Failed to load execution output.');
      }
      return null;
    } finally {
      if (!quiet && detailRequestId.current === requestId) {
        setDetailLoading(false);
      }
    }
  }

  function selectExecution(item, { openDetails = false } = {}) {
    setSelectedItem(item);
    setSelectedDetail(null);
    setDetailError('');
    loadExecutionDetail(item?.executionId);
    setDetailsOpen(openDetails);
  }

  async function loadExecutions(
    nextFilters = filters,
    nextPage = currentPage,
    {
      keepSelection = true,
      quiet = false,
      nextSorts = sorts,
      nextPageSize = pageSize,
    } = {},
  ) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    const safePage = Math.max(1, Number(nextPage) || 1);
    const requestedPageSize = TOOL_HISTORY_PAGE_SIZE_OPTIONS.includes(Number(nextPageSize))
      ? Number(nextPageSize)
      : TOOL_HISTORY_DEFAULT_PAGE_SIZE;
    const query = {
      ...nextFilters,
      sort: serializeSorts(nextSorts),
      limit: requestedPageSize,
      offset: (safePage - 1) * requestedPageSize,
    };

    try {
      const result = await adminService.listScriptExecutions(query);
      const resultItems = result.items || [];
      const resultTotal = result.total || 0;
      const resolvedPageSize = normalizeToolHistoryPageSize(requestedPageSize, resultTotal);
      const resultPageCount = Math.max(1, Math.ceil(resultTotal / resolvedPageSize));

      if (resultTotal > 0 && safePage > resultPageCount) {
        setCurrentPage(resultPageCount);
        setPageSize(resolvedPageSize);
        await loadExecutions(nextFilters, resultPageCount, {
          keepSelection: false,
          quiet,
          nextSorts,
          nextPageSize: resolvedPageSize,
        });
        return;
      }

      setItems(resultItems);
      setTotal(resultTotal);
      setPageSize(resolvedPageSize);
      setCurrentPage(safePage);
      setRefreshingAt(new Date());
      const nextSelected =
        !keepSelection || !selectedItem
          ? resultItems[0] || null
          : resultItems.find((item) => item.executionId === selectedItem.executionId) ||
            resultItems[0] ||
            null;
      setSelectedItem(nextSelected);

      if (nextSelected) {
        await loadExecutionDetail(nextSelected.executionId, { quiet });
      } else {
        setSelectedDetail(null);
      }

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
    loadFilterOptions();
    loadExecutions(filters, 1, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detailsOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setDetailsOpen(false);
      }
    }

    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [detailsOpen]);

  const pollingState = useSmartPolling({
    dependencies: [
      filters.q,
      filters.category,
      filters.scriptName,
      filters.status,
      serializeSorts(sorts),
      pageSize,
      safeCurrentPage,
      selectedItem?.executionId,
    ],
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
    if (name === 'q' && searchParams.has('executionId')) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('executionId');
      setSearchParams(nextSearchParams, { replace: true });
    }

    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    loadExecutions(nextFilters, 1, { keepSelection: false });
  }

  function updateCategoryFilter(value) {
    const nextFilters = {
      ...filters,
      category: value,
      scriptName: '',
    };

    setFilters(nextFilters);
    loadExecutions(nextFilters, 1, { keepSelection: false });
  }

  function clearFilters() {
    if (searchParams.has('executionId')) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('executionId');
      setSearchParams(nextSearchParams, { replace: true });
    }

    const nextFilters = { q: '', category: '', scriptName: '', status: '' };
    setFilters(nextFilters);
    loadExecutions(nextFilters, 1, { keepSelection: false });
  }

  function applySorting(nextSorts, customized) {
    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(1);
    loadExecutions(filters, 1, {
      keepSelection: false,
      nextSorts,
    });
  }

  function updateSorting(field, event) {
    const currentSorts = sorts.length > 0 ? sorts : TOOL_HISTORY_DEFAULT_SORTS;
    const activeIndex = currentSorts.findIndex((sort) => sort.field === field);
    const shiftPressed = Boolean(event?.shiftKey);

    if (shiftPressed) {
      if (activeIndex < 0) {
        applySorting([...currentSorts, { field, direction: 'asc' }], true);
        return;
      }

      const activeSort = currentSorts[activeIndex];

      if (!sortingCustomized && sortStacksMatch(currentSorts, TOOL_HISTORY_DEFAULT_SORTS)) {
        const nextSorts = [...currentSorts];
        nextSorts[activeIndex] = { field, direction: 'asc' };
        applySorting(nextSorts, true);
        return;
      }

      if (activeSort.direction === 'asc') {
        const nextSorts = [...currentSorts];
        nextSorts[activeIndex] = { ...activeSort, direction: 'desc' };
        applySorting(nextSorts, true);
        return;
      }

      const nextSorts = currentSorts.filter((_, index) => index !== activeIndex);
      const normalizedSorts = nextSorts.length > 0 ? nextSorts : TOOL_HISTORY_DEFAULT_SORTS;
      applySorting(
        normalizedSorts,
        !sortStacksMatch(normalizedSorts, TOOL_HISTORY_DEFAULT_SORTS),
      );
      return;
    }

    if (currentSorts.length > 1) {
      const nextPrimarySort =
        activeIndex >= 0 ? { ...currentSorts[activeIndex] } : { field, direction: 'asc' };
      applySorting([nextPrimarySort], true);
      return;
    }

    if (activeIndex < 0) {
      applySorting([{ field, direction: 'asc' }], true);
      return;
    }

    const activeSort = currentSorts[0];

    if (!sortingCustomized && sortStacksMatch(currentSorts, TOOL_HISTORY_DEFAULT_SORTS)) {
      applySorting([{ field, direction: 'asc' }], true);
      return;
    }

    if (activeSort.direction === 'asc') {
      applySorting([{ field, direction: 'desc' }], true);
      return;
    }

    applySorting(TOOL_HISTORY_DEFAULT_SORTS, false);
  }

  function clearSorting() {
    applySorting(TOOL_HISTORY_DEFAULT_SORTS, false);
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
          <span className="sky-table-sort-indicator" aria-hidden="true">
            {activeSort ? directionIcon : '↕'}
          </span>
          {activeSort && (
            <span className="sky-table-sort-priority" aria-hidden="true">
              {activeIndex + 1}
            </span>
          )}
        </button>
      </th>
    );
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    loadExecutions(filters, nextPage, { keepSelection: false });
  }

  function scrollBrowserToTop() {
    window.requestAnimationFrame(() => {
      browserCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function changePageSize(value) {
    const nextPageSize = Number(value);

    if (!TOOL_HISTORY_PAGE_SIZE_OPTIONS.includes(nextPageSize) || nextPageSize === pageSize) {
      return;
    }

    const selectedIndex = selectedItem
      ? items.findIndex((item) => item.executionId === selectedItem.executionId)
      : -1;
    const absoluteSelectedIndex = selectedIndex >= 0
      ? (safeCurrentPage - 1) * pageSize + selectedIndex
      : 0;
    const nextPage = Math.floor(absoluteSelectedIndex / nextPageSize) + 1;

    scrollBrowserToTop();
    loadExecutions(filters, nextPage, {
      keepSelection: selectedIndex >= 0,
      nextPageSize,
    });
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-tool-operations-pagination-row">
        <div className="small sky-muted sky-tool-operations-pagination-summary">
          Showing {rangeStart}–{rangeEnd} of {total} tool execution(s)
        </div>
        <div
          className="sky-pagination-controls sky-tool-operations-pagination-controls"
          aria-label="Tool operations pagination"
        >
          <button
            aria-label="First page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(1)}
            title="First page"
            type="button"
          >
            «
          </button>
          <button
            aria-label="Previous page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(safeCurrentPage - 1)}
            title="Previous page"
            type="button"
          >
            ‹
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
            aria-label="Next page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(safeCurrentPage + 1)}
            title="Next page"
            type="button"
          >
            ›
          </button>
          <button
            aria-label="Last page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(pageCount)}
            title="Last page"
            type="button"
          >
            »
          </button>
        </div>
        <div className="sky-tool-operations-rows-control">
          <label className="sky-pagination-select-label" htmlFor="toolHistoryRowsSelect">
            Rows
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select sky-tool-operations-rows-select"
            disabled={loading}
            id="toolHistoryRowsSelect"
            onChange={(event) => changePageSize(event.target.value)}
            value={pageSize}
          >
            {availablePageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Running tools"
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadExecutions(filters, safeCurrentPage)}
            pollingState={pollingState}
          />
        }
        kicker="Tools · Operations"
        subtitle="Read-only trace of tools launched through the API, Admin-Web, CLI-adjacent workflows, and workers."
        title="Tool Operations"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <div className="sky-functional-history-shell sky-tool-history-shell">
        <section
          className="sky-card mb-4 sky-functional-history-browser sky-tool-operations-browser-anchor"
          ref={browserCardRef}
        >
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Execution browser</div>
              <h2 className="h5 mb-0">Tool operations data</h2>
              <p className="sky-muted small mb-0">
                Filter the operational tool ledger, then inspect the selected execution in the
                detail workspace below.
              </p>
            </div>
            <div className="sky-run-tools-filter-grid sky-tool-history-filter-grid">
              <div className="sky-run-tools-search-filter">
                <label className="form-label" htmlFor="toolHistorySearchFilter">
                  Search
                </label>
                <input
                  className="form-control sky-form-control"
                  id="toolHistorySearchFilter"
                  onChange={(event) => updateFilter('q', event.target.value)}
                  placeholder="Tool, category, user, summary..."
                  type="search"
                  value={filters.q}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="toolHistoryCategoryFilter">
                  Category
                </label>
                <select
                  className="form-select sky-form-control"
                  id="toolHistoryCategoryFilter"
                  onChange={(event) => updateCategoryFilter(event.target.value)}
                  value={filters.category}
                >
                  <option value="">All categories</option>
                  {(filterOptions.categories || []).map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="toolHistoryToolFilter">
                  Tool
                </label>
                <select
                  className="form-select sky-form-control"
                  id="toolHistoryToolFilter"
                  onChange={(event) => updateFilter('scriptName', event.target.value)}
                  value={filters.scriptName}
                >
                  <option value="">All tools</option>
                  {visibleToolOptions.map((tool) => (
                    <option key={`${tool.category}:${tool.scriptName}`} value={tool.scriptName}>
                      {tool.scriptName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="toolHistoryStatusFilter">
                  Status
                </label>
                <select
                  className="form-select sky-form-control"
                  id="toolHistoryStatusFilter"
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
              <div className="sky-run-tools-filter-actions">
                {sortingCustomized && (
                  <button
                    className="btn btn-sm sky-btn-ghost"
                    onClick={clearSorting}
                    type="button"
                  >
                    Clear sorting
                  </button>
                )}
                <button
                  className="btn btn-sm sky-btn-ghost"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            </div>
          </div>

          <div className="table-responsive sky-table-card sky-functional-history-table-card sky-tool-operations-table-frame">
            <table className="table table-sm table-hover sky-table sky-tool-operations-table align-middle">
              <thead>
                <tr>
                  {renderSortableHeader('Tool', 'tool')}
                  {renderSortableHeader('Category', 'category')}
                  {renderSortableHeader('Status', 'status')}
                  {renderSortableHeader('Started', 'startedAt')}
                  {renderSortableHeader('Duration', 'durationMs')}
                  {renderSortableHeader('Completed', 'finishedAt')}
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="7">
                      <div className="sky-empty-state">Loading executions...</div>
                    </td>
                  </tr>
                )}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan="7">
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
                      onClick={() => selectExecution(item)}
                    >
                      <td>
                        <div className="fw-bold sky-detail-value">{getToolLabel(item)}</div>
                        <div className="small sky-muted sky-mono">{getToolCode(item)}</div>
                      </td>
                      <td>{getCategoryLabel(item)}</td>
                      <td>
                        <span className={`sky-pill ${statusClass(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                      <td>{formatDate(item.startedAt)}</td>
                      <td>{formatDuration(item)}</td>
                      <td>{formatDate(item.finishedAt)}</td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            selectExecution(item, { openDetails: true });
                          }}
                          type="button"
                        >
                          Tool Details
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {renderPagination()}
        </section>

        <section className="sky-card sky-tool-history-workspace-card">
          <div className="sky-card-header sky-tool-history-workspace-header">
            <div>
              <div className="sky-page-kicker">Selected execution workspace</div>
              <h2 className="h5 mb-0">Tool output</h2>
              <div className="small sky-muted mt-1">
                {selectedItem
                  ? `${selectedItem.scriptName} · ${selectedItem.category || 'Uncategorized'}`
                  : 'Select a tool execution from the browser above.'}
              </div>
            </div>
            {selectedItem && (
              <span className={`sky-pill ${statusClass(selectedItem.status)}`}>
                {getStatusLabel(selectedItem.status)}
              </span>
            )}
          </div>
          <div className="sky-card-body">
            {selectedItem ? (
              <>
                <div className="sky-tool-history-output-summary mb-3">
                  <div>
                    <div className="sky-detail-label">Summary</div>
                    <div className="sky-detail-value">
                      {getDisplaySummary(selectedItem.summary, selectedItem.status)}
                    </div>
                  </div>
                  <div>
                    <div className="sky-detail-label">Execution</div>
                    <div className="sky-mono small sky-detail-value">
                      {selectedItem.executionId}
                    </div>
                  </div>
                </div>

                {detailError && <DismissibleAlert tone="danger">{detailError}</DismissibleAlert>}

                <ToolExecutionOutputPanels
                  loading={detailLoading}
                  stderr={selectedDetail?.stderr || ''}
                  stdout={selectedDetail?.stdout || ''}
                  structuredOutputExpected={Boolean(
                    selectedDetail?.structuredOutputExpected ||
                      selectedItem.metadata?.toolResultAvailable,
                  )}
                  toolResult={selectedDetail?.structuredResult || null}
                  toolResultContract={
                    selectedDetail?.toolResultContract ||
                    selectedItem.metadata?.toolResultContract ||
                    null
                  }
                />

                {selectedDetail?.outputAvailability?.warnings?.length > 0 && (
                  <div className="alert alert-warning mt-3 mb-0">
                    {selectedDetail.outputAvailability.warnings.join(' · ')}
                  </div>
                )}
              </>
            ) : (
              <div className="sky-empty-state">Select an execution to inspect its output.</div>
            )}
          </div>
        </section>
      </div>

      {detailsOpen && selectedItem && (
        <div
          aria-label="Tool execution details"
          aria-modal="true"
          className="sky-chart-modal-backdrop sky-tool-details-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDetailsOpen(false);
            }
          }}
          role="dialog"
        >
          <section className="sky-chart-modal sky-tool-details-modal">
            <div className="sky-chart-modal-header">
              <div>
                <div className="sky-page-kicker sky-chart-modal-kicker">Tool details</div>
                <h2>{selectedItem.scriptName}</h2>
                <p>{selectedItem.category || 'Uncategorized'} · {selectedItem.executionId}</p>
              </div>
              <button
                aria-label="Close tool details"
                className="sky-chart-modal-close"
                onClick={() => setDetailsOpen(false)}
                type="button"
              >
                <svg aria-hidden="true" className="sky-chart-modal-close-icon" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="sky-tool-details-modal-body">
              <div className="sky-execution-metric-grid">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Status</div>
                  <span className={`sky-pill ${statusClass(selectedItem.status)}`}>
                    {getStatusLabel(selectedItem.status)}
                  </span>
                </div>
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Duration</div>
                  <div className="sky-mini-metric-value">{getDurationLabel(selectedItem)}</div>
                </div>
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Started</div>
                  <div className="sky-detail-value">{formatDate(selectedItem.startedAt)}</div>
                </div>
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Completed</div>
                  <div className="sky-detail-value">{formatDate(selectedItem.finishedAt)}</div>
                </div>
              </div>

              <section className="sky-card mb-3">
                <div className="sky-card-header">
                  <h3 className="h5 mb-0">Execution identity</h3>
                </div>
                <div className="sky-card-body">
                  <dl className="row g-2 mb-0">
                    <dt className="col-md-3 sky-detail-label">Execution</dt>
                    <dd className="col-md-9 sky-mono small sky-detail-value">
                      {selectedItem.executionId}
                    </dd>
                    <dt className="col-md-3 sky-detail-label">User</dt>
                    <dd className="col-md-9 sky-detail-value">
                      {selectedItem.displayName || selectedItem.email || '—'}
                    </dd>
                    <dt className="col-md-3 sky-detail-label">Exit code</dt>
                    <dd className="col-md-9 sky-detail-value">{selectedItem.exitCode ?? '—'}</dd>
                    <dt className="col-md-3 sky-detail-label">Summary</dt>
                    <dd className="col-md-9 sky-detail-value">
                      {getDisplaySummary(selectedItem.summary, selectedItem.status)}
                    </dd>
                  </dl>
                </div>
              </section>

              <section className="sky-card mb-3">
                <div className="sky-card-header">
                  <div>
                    <div className="sky-page-kicker">Execution input</div>
                    <h3 className="h5 mb-0">Parameters</h3>
                  </div>
                </div>
                <div className="sky-card-body">
                  <pre className="sky-code-block sky-tool-history-metadata-block">
                    {JSON.stringify(selectedItem.parameters || {}, null, 2)}
                  </pre>
                </div>
              </section>

              <section className="sky-card">
                <div className="sky-card-header">
                  <div>
                    <div className="sky-page-kicker">Execution evidence</div>
                    <h3 className="h5 mb-0">Metadata</h3>
                  </div>
                </div>
                <div className="sky-card-body">
                  <pre className="sky-code-block sky-tool-history-metadata-block">
                    {JSON.stringify(selectedItem.metadata || {}, null, 2)}
                  </pre>
                </div>
              </section>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default ScriptExecutions;
