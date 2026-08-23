import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import workerService from '../services/workerService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const SCHEDULE_TYPE_OPTIONS = [
  { value: 'ONCE', label: 'One-time run' },
  { value: 'INTERVAL', label: 'Recurring interval' },
];

const INTERVAL_UNIT_OPTIONS = [
  { value: 'MINUTE', label: 'Minute(s)' },
  { value: 'HOUR', label: 'Hour(s)' },
  { value: 'DAY', label: 'Day(s)' },
  { value: 'WEEK', label: 'Week(s)' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'STARTED', label: 'Running' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'SKIPPED', label: 'Skipped' },
];

const LISTENER_TYPE_OPTIONS = [
  { value: '', label: 'All listener types' },
  { value: 'FILE_DROP', label: 'File drop' },
  { value: 'DB_POLL', label: 'Database poll' },
  { value: 'WEBHOOK', label: 'Webhook' },
];

const DEFAULT_TIMEZONE = 'America/Toronto';

function getDefaultRunAt() {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  return toDateTimeLocalValue(date);
}

function toDateTimeLocalValue(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoDateTime(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function formatDuration(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  const milliseconds = Number(value);

  if (!Number.isFinite(milliseconds)) {
    return '—';
  }

  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${totalSeconds} s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return '—';
  }

  return new Intl.NumberFormat().format(numberValue);
}

function normalizeStatus(value) {
  return String(value || 'UNKNOWN').toUpperCase();
}

function statusClass(status) {
  const normalizedStatus = normalizeStatus(status);

  if (
    normalizedStatus === 'CURRENT' ||
    normalizedStatus === 'ONLINE' ||
    normalizedStatus === 'SUCCESS'
  ) {
    return 'sky-pill-success';
  }

  if (
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'ERROR' ||
    normalizedStatus === 'OFFLINE'
  ) {
    return 'sky-pill-danger';
  }

  if (
    normalizedStatus === 'WARNING' ||
    normalizedStatus === 'QUEUED' ||
    normalizedStatus === 'STARTED' ||
    normalizedStatus === 'RUNNING' ||
    normalizedStatus === 'STOPPING'
  ) {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function dotClass(status) {
  const normalizedStatus = normalizeStatus(status);

  if (
    normalizedStatus === 'CURRENT' ||
    normalizedStatus === 'ONLINE' ||
    normalizedStatus === 'SUCCESS'
  ) {
    return 'sky-status-dot-success';
  }

  if (
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'ERROR' ||
    normalizedStatus === 'OFFLINE'
  ) {
    return 'sky-status-dot-danger';
  }

  if (
    normalizedStatus === 'WARNING' ||
    normalizedStatus === 'QUEUED' ||
    normalizedStatus === 'STARTED' ||
    normalizedStatus === 'RUNNING'
  ) {
    return 'sky-status-dot-warning';
  }

  return 'sky-status-dot-info';
}

function getStatusLabel(status) {
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus === 'STARTED' ? 'RUNNING' : normalizedStatus;
}

function riskClass(riskCode) {
  const risk = String(riskCode || '').toLowerCase();

  if (risk === 'low') {
    return 'sky-pill-success';
  }

  if (risk === 'medium') {
    return 'sky-pill-warning';
  }

  if (risk === 'high') {
    return 'sky-pill-danger';
  }

  return 'sky-pill-info';
}

function getBooleanValue(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function getInputType(parameter) {
  if (parameter.paramTypeCode === 'number') {
    return 'number';
  }

  if (parameter.paramTypeCode === 'date') {
    return 'date';
  }

  return 'text';
}

function shouldRenderSelect(parameter) {
  return (
    parameter.paramTypeCode === 'repo' ||
    parameter.paramTypeCode === 'select' ||
    (parameter.options || []).length > 0
  );
}

function getParameterHelpText(parameter) {
  const type = parameter.paramTypeCode || 'string';

  if (parameter.optionSourceCode) {
    return `${type} parameter · source: ${parameter.optionSourceCode}`;
  }

  return `${type} parameter`;
}

function buildScheduleCode(toolCode) {
  const safeToolCode = String(toolCode || 'worker_tool')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);

  return `${safeToolCode}_${timestamp}`;
}

function getInitialParameterValues(tool) {
  return (tool?.parameters || []).reduce((accumulator, parameter) => {
    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) {
      accumulator[parameter.parameterName] = parameter.defaultValue;
      return accumulator;
    }

    if (parameter.paramTypeCode === 'boolean') {
      accumulator[parameter.parameterName] = false;
      return accumulator;
    }

    accumulator[parameter.parameterName] = '';
    return accumulator;
  }, {});
}

function cleanParameterValues(values = {}, tool = null) {
  const parameterMap = new Map(
    (tool?.parameters || []).map((parameter) => [parameter.parameterName, parameter]),
  );

  return Object.fromEntries(
    Object.entries(values || {}).filter(([name, value]) => {
      const parameter = parameterMap.get(name);

      if (parameter?.paramTypeCode === 'boolean') {
        return true;
      }

      return value !== undefined && value !== null && value !== '';
    }),
  );
}

function createBlankScheduleForm(tool = null) {
  return {
    scheduleId: '',
    scheduleCode: buildScheduleCode(tool?.toolCode),
    scheduleName: tool ? `${tool.label} schedule` : '',
    description: '',
    toolCode: tool?.toolCode || '',
    scheduleType: 'ONCE',
    timezone: DEFAULT_TIMEZONE,
    runAt: getDefaultRunAt(),
    intervalValue: '1',
    intervalUnit: 'HOUR',
    enabled: true,
    maxConcurrentRuns: '1',
    misfirePolicy: 'RUN_ONCE',
    parameters: getInitialParameterValues(tool),
  };
}

function createScheduleFormFromRecord(schedule, tools = []) {
  const tool = tools.find((item) => item.toolCode === schedule.toolCode) || null;

  return {
    scheduleId: schedule.scheduleId || '',
    scheduleCode: schedule.scheduleCode || '',
    scheduleName: schedule.scheduleName || '',
    description: schedule.description || '',
    toolCode: schedule.toolCode || '',
    scheduleType: schedule.scheduleType || 'ONCE',
    timezone: schedule.timezone || DEFAULT_TIMEZONE,
    runAt: toDateTimeLocalValue(schedule.runAt),
    intervalValue: schedule.intervalValue || '1',
    intervalUnit: schedule.intervalUnit || 'HOUR',
    enabled: getBooleanValue(schedule.enabled),
    maxConcurrentRuns: schedule.maxConcurrentRuns || '1',
    misfirePolicy: schedule.misfirePolicy || 'RUN_ONCE',
    parameters: {
      ...getInitialParameterValues(tool),
      ...(schedule.parameters || {}),
    },
  };
}

function getSelectedTool(tools, toolCode) {
  return tools.find((tool) => tool.toolCode === toolCode) || null;
}

function getJsonPreview(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return '{}';
  }
}

function buildStatCards(health, tools) {
  return [
    {
      label: 'Worker status',
      value: health?.overallStatus || '—',
      help: health?.generatedAt
        ? `Generated ${formatDate(health.generatedAt)}`
        : 'Live worker rollup',
      status: health?.overallStatus,
    },
    {
      label: 'Nodes online',
      value: health?.nodes?.online ?? '—',
      help: `${health?.nodes?.total ?? 0} registered / ${health?.nodes?.error ?? 0} error`,
      status: Number(health?.nodes?.online || 0) > 0 ? 'ONLINE' : 'WARNING',
    },
    {
      label: 'Schedules',
      value: health?.schedules?.total ?? '—',
      help: `${health?.schedules?.enabled ?? 0} enabled / ${health?.schedules?.due ?? 0} due`,
      status: Number(health?.schedules?.failed || 0) > 0 ? 'WARNING' : 'CURRENT',
    },
    {
      label: 'Next run',
      value: health?.schedules?.nextRunAt ? formatDate(health.schedules.nextRunAt) : '—',
      help: 'Nearest enabled schedule',
      status: health?.schedules?.nextRunAt ? 'CURRENT' : 'INFO',
    },
    {
      label: 'Runs 24h',
      value: health?.runs24h?.total ?? '—',
      help: `${health?.runs24h?.success ?? 0} success / ${health?.runs24h?.failed ?? 0} failed`,
      status: Number(health?.runs24h?.failed || 0) > 0 ? 'WARNING' : 'CURRENT',
    },
    {
      label: 'Worker tools',
      value: tools?.length ?? '—',
      help: 'Worker-visible tool manifest',
      status: tools?.length > 0 ? 'CURRENT' : 'INFO',
    },
  ];
}

function WorkerControl() {
  const { hasPermission } = useAuth();
  const canCreateSchedules = hasPermission('WORKER_SCHEDULE_CREATE');
  const canChangeSchedules = hasPermission('WORKER_SCHEDULE_CHANGE');
  const canWriteSchedules = canCreateSchedules || canChangeSchedules;
  const canRunSchedules = hasPermission('WORKER_SCHEDULE_RUN_IMMEDIATE');
  const canViewNodes = hasPermission('WORKER_ADMIN');
  const canViewListeners = hasPermission('WORKER_LISTENER_READ');
  const canViewListenerEvents = hasPermission('WORKER_EVENT_READ');

  const [health, setHealth] = useState(null);
  const [tools, setTools] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [scheduleTotal, setScheduleTotal] = useState(0);
  const [runs, setRuns] = useState([]);
  const [runTotal, setRunTotal] = useState(0);
  const [nodes, setNodes] = useState([]);
  const [listeners, setListeners] = useState([]);
  const [listenerEvents, setListenerEvents] = useState([]);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [formMode, setFormMode] = useState('create');
  const [scheduleForm, setScheduleForm] = useState(createBlankScheduleForm());
  const [scheduleFilters, setScheduleFilters] = useState({
    enabled: '',
    scheduleType: '',
    status: '',
    q: '',
    limit: 50,
  });
  const [runFilters, setRunFilters] = useState({
    status: '',
    toolCode: '',
    limit: 25,
  });
  const [listenerFilters, setListenerFilters] = useState({
    enabled: '',
    listenerType: '',
    limit: 25,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState(null);

  const selectedTool = useMemo(
    () => getSelectedTool(tools, scheduleForm.toolCode),
    [scheduleForm.toolCode, tools],
  );
  const statCards = useMemo(() => buildStatCards(health, tools), [health, tools]);

  async function loadWorkerTools() {
    const result = await workerService.listTools();
    const nextTools = result.items || [];
    setTools(nextTools);

    setScheduleForm((currentForm) => {
      if (currentForm.toolCode || nextTools.length === 0) {
        return currentForm;
      }

      return createBlankScheduleForm(nextTools[0]);
    });
  }

  async function loadHealth() {
    const result = await workerService.getHealth();
    setHealth(result);
  }

  async function loadSchedules(nextFilters = scheduleFilters) {
    const result = await workerService.listSchedules(nextFilters);
    const nextItems = result.items || [];
    setSchedules(nextItems);
    setScheduleTotal(result.total || 0);

    setSelectedSchedule((currentSelected) => {
      if (!currentSelected) {
        return nextItems[0] || null;
      }

      return (
        nextItems.find((schedule) => schedule.scheduleId === currentSelected.scheduleId) ||
        nextItems[0] ||
        null
      );
    });
  }

  async function loadRuns(nextFilters = runFilters) {
    const result = await workerService.listRuns(nextFilters);
    const nextItems = result.items || [];
    setRuns(nextItems);
    setRunTotal(result.total || 0);
    setSelectedRun((currentSelected) => {
      if (!currentSelected) {
        return nextItems[0] || null;
      }

      return (
        nextItems.find((run) => run.scheduleRunId === currentSelected.scheduleRunId) ||
        nextItems[0] ||
        null
      );
    });
  }

  async function loadNodes() {
    if (!canViewNodes) {
      setNodes([]);
      return;
    }

    const result = await workerService.listNodes({ limit: 25 });
    setNodes(result.items || []);
  }

  async function loadListeners(nextFilters = listenerFilters) {
    if (!canViewListeners) {
      setListeners([]);
      return;
    }

    const result = await workerService.listListeners(nextFilters);
    setListeners(result.items || []);
  }

  async function loadListenerEvents() {
    if (!canViewListenerEvents) {
      setListenerEvents([]);
      return;
    }

    const result = await workerService.listListenerEvents({ limit: 10 });
    setListenerEvents(result.items || []);
  }

  async function refreshAll() {
    setLoading(true);
    setError('');

    try {
      await Promise.all([
        loadHealth(),
        loadWorkerTools(),
        loadSchedules(),
        loadRuns(),
        loadNodes(),
        loadListeners(),
        loadListenerEvents(),
      ]);
      setLastRefreshAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load worker control data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      await refreshAll();

      if (!active) {
        return;
      }
    }

    loadInitialData();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateScheduleFilter(name, value) {
    setScheduleFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  function updateRunFilter(name, value) {
    setRunFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  function updateListenerFilter(name, value) {
    setListenerFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  async function applyScheduleFilters(event) {
    event.preventDefault();
    setError('');

    try {
      await loadSchedules(scheduleFilters);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load schedules.');
    }
  }

  async function applyRunFilters(event) {
    event.preventDefault();
    setError('');

    try {
      await loadRuns(runFilters);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load schedule runs.');
    }
  }

  async function applyListenerFilters(event) {
    event.preventDefault();
    setError('');

    try {
      await loadListeners(listenerFilters);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load listeners.');
    }
  }

  function resetForm(tool = tools[0] || null) {
    setFormMode('create');
    setScheduleForm(createBlankScheduleForm(tool));
    setNotice('');
    setError('');
  }

  function editSchedule(schedule) {
    setFormMode('edit');
    setScheduleForm(createScheduleFormFromRecord(schedule, tools));
    setSelectedSchedule(schedule);
    setNotice('');
    setError('');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateFormField(name, value) {
    setScheduleForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function updateParameter(parameterName, value) {
    setScheduleForm((currentForm) => ({
      ...currentForm,
      parameters: {
        ...(currentForm.parameters || {}),
        [parameterName]: value,
      },
    }));
  }

  function handleToolChange(toolCode) {
    const nextTool = getSelectedTool(tools, toolCode);

    setScheduleForm((currentForm) => ({
      ...currentForm,
      toolCode,
      scheduleCode: formMode === 'create' ? buildScheduleCode(toolCode) : currentForm.scheduleCode,
      scheduleName:
        formMode === 'create' && nextTool ? `${nextTool.label} schedule` : currentForm.scheduleName,
      parameters: getInitialParameterValues(nextTool),
    }));
  }

  function buildSchedulePayload() {
    const payload = {
      scheduleCode: scheduleForm.scheduleCode.trim(),
      scheduleName: scheduleForm.scheduleName.trim(),
      description: scheduleForm.description.trim() || null,
      toolCode: scheduleForm.toolCode,
      scheduleType: scheduleForm.scheduleType,
      timezone: scheduleForm.timezone || DEFAULT_TIMEZONE,
      runAt: toIsoDateTime(scheduleForm.runAt),
      parameters: cleanParameterValues(scheduleForm.parameters, selectedTool),
      enabled: getBooleanValue(scheduleForm.enabled),
      maxConcurrentRuns: Number.parseInt(scheduleForm.maxConcurrentRuns, 10) || 1,
      misfirePolicy: scheduleForm.misfirePolicy || 'RUN_ONCE',
    };

    if (scheduleForm.scheduleType === 'INTERVAL') {
      payload.intervalValue = Number.parseInt(scheduleForm.intervalValue, 10) || 1;
      payload.intervalUnit = scheduleForm.intervalUnit || 'HOUR';
    }

    return payload;
  }

  async function handleScheduleSubmit(event) {
    event.preventDefault();

    const canSaveSchedule = formMode === 'edit' ? canChangeSchedules : canCreateSchedules;

    if (!canSaveSchedule) {
      setError(
        formMode === 'edit'
          ? 'WORKER_SCHEDULE_CHANGE is required to update schedules.'
          : 'WORKER_SCHEDULE_CREATE is required to create schedules.',
      );
      return;
    }

    if (!scheduleForm.toolCode) {
      setError('Select a worker-visible tool.');
      return;
    }

    if (scheduleForm.scheduleType === 'ONCE' && !scheduleForm.runAt) {
      setError('Run at is required for one-time schedules.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const payload = buildSchedulePayload();
      const result =
        formMode === 'edit' && scheduleForm.scheduleId
          ? await workerService.updateSchedule(scheduleForm.scheduleId, payload)
          : await workerService.createSchedule(payload);

      setSelectedSchedule(result.schedule || null);
      setNotice(
        formMode === 'edit'
          ? `Updated schedule ${payload.scheduleCode}.`
          : `Created schedule ${payload.scheduleCode}.`,
      );
      setFormMode('edit');
      setScheduleForm(createScheduleFormFromRecord(result.schedule || payload, tools));
      await Promise.all([loadHealth(), loadSchedules(), loadRuns()]);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save schedule.');
    } finally {
      setSaving(false);
    }
  }

  async function handleScheduleStatus(schedule, enabled) {
    if (!canChangeSchedules) {
      setError('WORKER_SCHEDULE_CHANGE is required to change schedule status.');
      return;
    }

    setActionLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await workerService.updateScheduleStatus(schedule.scheduleId, enabled);
      setSelectedSchedule(result.schedule || null);
      setNotice(`${enabled ? 'Enabled' : 'Disabled'} schedule ${schedule.scheduleCode}.`);
      await Promise.all([loadHealth(), loadSchedules(), loadRuns()]);
    } catch (statusError) {
      setError(statusError.message || 'Failed to update schedule status.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRunNow(schedule) {
    if (!canRunSchedules) {
      setError('WORKER_SCHEDULE_RUN_IMMEDIATE is required to queue a schedule.');
      return;
    }

    setActionLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await workerService.runScheduleNow(schedule.scheduleId);
      setSelectedSchedule(result.schedule || null);
      setNotice(`Queued schedule ${schedule.scheduleCode} for immediate execution.`);
      await Promise.all([loadHealth(), loadSchedules(), loadRuns()]);
    } catch (runError) {
      setError(runError.message || 'Failed to queue schedule.');
    } finally {
      setActionLoading(false);
    }
  }

  function renderParameterInput(parameter) {
    const parameterName = parameter.parameterName;
    const value = scheduleForm.parameters?.[parameterName] ?? '';
    const options = parameter.options || [];

    if (parameter.paramTypeCode === 'boolean') {
      return (
        <div className="form-check form-switch">
          <input
            checked={getBooleanValue(value)}
            className="form-check-input"
            disabled={!canWriteSchedules || saving}
            id={`workerParam-${parameterName}`}
            onChange={(event) => updateParameter(parameterName, event.target.checked)}
            type="checkbox"
          />
          <label className="form-check-label sky-muted" htmlFor={`workerParam-${parameterName}`}>
            {parameter.prompt || parameter.label}
          </label>
        </div>
      );
    }

    if (shouldRenderSelect(parameter)) {
      return (
        <>
          <select
            className="form-select sky-form-control"
            disabled={!canWriteSchedules || saving}
            id={`workerParam-${parameterName}`}
            onChange={(event) => updateParameter(parameterName, event.target.value)}
            required={parameter.required}
            value={String(value)}
          >
            <option value="">{parameter.prompt || `Select ${parameter.label}`}</option>
            {options.map((option) => (
              <option key={option.optionId || option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {options.length === 0 && (
            <div className="form-text text-warning">
              No options were returned for this parameter.
            </div>
          )}
        </>
      );
    }

    return (
      <input
        className="form-control sky-form-control sky-mono"
        disabled={!canWriteSchedules || saving}
        id={`workerParam-${parameterName}`}
        onChange={(event) => updateParameter(parameterName, event.target.value)}
        placeholder={parameter.prompt || parameterName}
        required={parameter.required}
        type={getInputType(parameter)}
        value={String(value)}
      />
    );
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Worker operations</div>
          <h1 className="sky-page-title">Worker</h1>
          <p className="sky-page-subtitle">
            Schedule worker-visible tools, queue immediate runs, monitor worker nodes, and inspect
            schedule execution history from SkyCommand Admin.
          </p>
        </div>
        <div className="text-md-end">
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={refreshAll}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh worker'}
          </button>
          <div className="small sky-muted mt-2">
            Last refresh: {lastRefreshAt ? formatDate(lastRefreshAt) : '—'}
          </div>
        </div>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {notice && <DismissibleAlert tone="success">{notice}</DismissibleAlert>}

      <section className="sky-worker-hero mb-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className={`sky-status-dot ${dotClass(health?.overallStatus)}`} />
            <span className={`sky-pill ${statusClass(health?.overallStatus)}`}>
              {getStatusLabel(health?.overallStatus)}
            </span>
          </div>
          <h2 className="h4 mb-2">Background heartbeat</h2>
          <p className="sky-muted mb-0">
            Nodes {health?.nodes?.online ?? 0} online · Schedules {health?.schedules?.enabled ?? 0}
            enabled · Runs {health?.runs24h?.total ?? 0} in the last 24 hours
          </p>
        </div>

        <div className="sky-worker-command-strip">
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Next run</div>
            <div className="sky-worker-command-value">
              {health?.schedules?.nextRunAt ? formatDate(health.schedules.nextRunAt) : '—'}
            </div>
          </div>
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Active runs</div>
            <div className="sky-worker-command-value">{health?.runs24h?.active ?? 0}</div>
          </div>
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Failed schedules</div>
            <div className="sky-worker-command-value">{health?.schedules?.failed ?? 0}</div>
          </div>
        </div>
      </section>

      <div className="row g-3">
        {statCards.map((card) => (
          <div className="col-md-6 col-xl-2" key={card.label}>
            <section className="sky-card sky-stat-card sky-worker-stat-card">
              <div className="sky-card-body">
                <div className="d-flex align-items-start justify-content-between gap-2">
                  <div className="sky-page-kicker mb-0">{card.label}</div>
                  {card.status && <span className={`sky-status-dot ${dotClass(card.status)}`} />}
                </div>
                <div className="sky-stat-value sky-worker-stat-value">
                  {loading ? '—' : card.value}
                </div>
                <div className="sky-muted small">{card.help}</div>
              </div>
            </section>
          </div>
        ))}
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-4">
          <section className="sky-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-1">
                  {formMode === 'edit' ? 'Edit schedule' : 'Create schedule'}
                </h2>
                <div className="small sky-muted">
                  Choose a worker-visible tool and define when it should run.
                </div>
              </div>
              <button
                className="btn btn-sm sky-btn-ghost"
                disabled={saving}
                onClick={() => resetForm()}
                type="button"
              >
                New
              </button>
            </div>

            <div className="sky-card-body">
              {!canWriteSchedules && (
                <div className="alert alert-danger">
                  WORKER_SCHEDULE_CREATE or WORKER_SCHEDULE_CHANGE is required to create or edit schedules.
                </div>
              )}

              <form onSubmit={handleScheduleSubmit}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="workerToolCode">
                    Worker tool
                  </label>
                  <select
                    className="form-select sky-form-control"
                    disabled={!canWriteSchedules || saving || tools.length === 0}
                    id="workerToolCode"
                    onChange={(event) => handleToolChange(event.target.value)}
                    required
                    value={scheduleForm.toolCode}
                  >
                    <option value="">Select worker tool</option>
                    {tools.map((tool) => (
                      <option key={tool.toolId || tool.toolCode} value={tool.toolCode}>
                        {tool.label} ({tool.toolCode})
                      </option>
                    ))}
                  </select>
                  {selectedTool && (
                    <div className="form-text sky-muted">
                      <span className={`sky-pill ${riskClass(selectedTool.riskCode)}`}>
                        {selectedTool.riskCode || 'risk'}
                      </span>{' '}
                      {selectedTool.description}
                    </div>
                  )}
                </div>

                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label" htmlFor="scheduleCode">
                      Schedule Code <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control sky-form-control sky-mono"
                      disabled={!canWriteSchedules || saving}
                      id="scheduleCode"
                      onChange={(event) => updateFormField('scheduleCode', event.target.value)}
                      required
                      type="text"
                      value={scheduleForm.scheduleCode}
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label" htmlFor="scheduleName">
                      Schedule Name <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control sky-form-control"
                      disabled={!canWriteSchedules || saving}
                      id="scheduleName"
                      onChange={(event) => updateFormField('scheduleName', event.target.value)}
                      required
                      type="text"
                      value={scheduleForm.scheduleName}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="form-label" htmlFor="scheduleDescription">
                    Description
                  </label>
                  <textarea
                    className="form-control sky-form-control"
                    disabled={!canWriteSchedules || saving}
                    id="scheduleDescription"
                    onChange={(event) => updateFormField('description', event.target.value)}
                    rows="2"
                    value={scheduleForm.description}
                  />
                </div>

                <div className="row g-3 mt-1">
                  <div className="col-md-6">
                    <label className="form-label" htmlFor="scheduleType">
                      Schedule Type
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWriteSchedules || saving}
                      id="scheduleType"
                      onChange={(event) => updateFormField('scheduleType', event.target.value)}
                      value={scheduleForm.scheduleType}
                    >
                      {SCHEDULE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label" htmlFor="runAt">
                      Run At{' '}
                      {scheduleForm.scheduleType === 'ONCE' && (
                        <span className="text-danger">*</span>
                      )}
                    </label>
                    <input
                      className="form-control sky-form-control"
                      disabled={!canWriteSchedules || saving}
                      id="runAt"
                      onChange={(event) => updateFormField('runAt', event.target.value)}
                      required={scheduleForm.scheduleType === 'ONCE'}
                      type="datetime-local"
                      value={scheduleForm.runAt}
                    />
                    {scheduleForm.scheduleType === 'INTERVAL' && (
                      <div className="form-text sky-muted">
                        Optional anchor time. Blank starts from now.
                      </div>
                    )}
                  </div>
                </div>

                {scheduleForm.scheduleType === 'INTERVAL' && (
                  <div className="row g-3 mt-1">
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="intervalValue">
                        Repeat Every
                      </label>
                      <input
                        className="form-control sky-form-control"
                        disabled={!canWriteSchedules || saving}
                        id="intervalValue"
                        min="1"
                        onChange={(event) => updateFormField('intervalValue', event.target.value)}
                        required
                        type="number"
                        value={scheduleForm.intervalValue}
                      />
                    </div>

                    <div className="col-md-6">
                      <label className="form-label" htmlFor="intervalUnit">
                        Unit
                      </label>
                      <select
                        className="form-select sky-form-control"
                        disabled={!canWriteSchedules || saving}
                        id="intervalUnit"
                        onChange={(event) => updateFormField('intervalUnit', event.target.value)}
                        value={scheduleForm.intervalUnit}
                      >
                        {INTERVAL_UNIT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="row g-3 mt-1">
                  <div className="col-md-6">
                    <label className="form-label" htmlFor="timezone">
                      Timezone
                    </label>
                    <input
                      className="form-control sky-form-control sky-mono"
                      disabled={!canWriteSchedules || saving}
                      id="timezone"
                      onChange={(event) => updateFormField('timezone', event.target.value)}
                      type="text"
                      value={scheduleForm.timezone}
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label" htmlFor="maxConcurrentRuns">
                      Max Concurrent Runs
                    </label>
                    <input
                      className="form-control sky-form-control"
                      disabled={!canWriteSchedules || saving}
                      id="maxConcurrentRuns"
                      min="1"
                      max="25"
                      onChange={(event) => updateFormField('maxConcurrentRuns', event.target.value)}
                      type="number"
                      value={scheduleForm.maxConcurrentRuns}
                    />
                  </div>
                </div>

                <div className="form-check form-switch mt-3">
                  <input
                    checked={getBooleanValue(scheduleForm.enabled)}
                    className="form-check-input"
                    disabled={!canWriteSchedules || saving}
                    id="scheduleEnabled"
                    onChange={(event) => updateFormField('enabled', event.target.checked)}
                    type="checkbox"
                  />
                  <label className="form-check-label sky-muted" htmlFor="scheduleEnabled">
                    Enabled
                  </label>
                </div>

                {selectedTool?.parameters?.length > 0 && (
                  <div className="mt-4">
                    <div className="sky-page-kicker">Tool parameters</div>
                    <div className="sky-worker-param-grid">
                      {selectedTool.parameters.map((parameter) => (
                        <div key={parameter.parameterId || parameter.parameterName}>
                          <label
                            className="form-label"
                            htmlFor={`workerParam-${parameter.parameterName}`}
                          >
                            {parameter.label || parameter.parameterName}{' '}
                            {parameter.required && <span className="text-danger">*</span>}
                          </label>
                          {renderParameterInput(parameter)}
                          <div className="form-text sky-muted">
                            {getParameterHelpText(parameter)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="d-flex flex-wrap gap-2 mt-4">
                  <button
                    className="btn sky-btn-primary"
                    disabled={!canWriteSchedules || saving || tools.length === 0}
                    type="submit"
                  >
                    {saving
                      ? 'Saving...'
                      : formMode === 'edit'
                        ? 'Save schedule'
                        : 'Create schedule'}
                  </button>
                  <button
                    className="btn sky-btn-ghost"
                    disabled={saving}
                    onClick={() => resetForm()}
                    type="button"
                  >
                    Reset
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>

        <div className="col-xl-8">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                  <h2 className="h5 mb-1">Schedules</h2>
                  <div className="small sky-muted">
                    Showing {schedules.length} of {scheduleTotal} configured worker schedule
                    {scheduleTotal === 1 ? '' : 's'}.
                  </div>
                </div>
                <form className="sky-inline-filter-form" onSubmit={applyScheduleFilters}>
                  <select
                    className="form-select form-select-sm sky-form-control"
                    onChange={(event) => updateScheduleFilter('enabled', event.target.value)}
                    value={scheduleFilters.enabled}
                  >
                    <option value="">All states</option>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                  <select
                    className="form-select form-select-sm sky-form-control"
                    onChange={(event) => updateScheduleFilter('scheduleType', event.target.value)}
                    value={scheduleFilters.scheduleType}
                  >
                    <option value="">All types</option>
                    <option value="ONCE">ONCE</option>
                    <option value="INTERVAL">INTERVAL</option>
                  </select>
                  <input
                    className="form-control form-control-sm sky-form-control"
                    onChange={(event) => updateScheduleFilter('q', event.target.value)}
                    placeholder="Search schedules"
                    type="search"
                    value={scheduleFilters.q}
                  />
                  <button className="btn btn-sm sky-btn-primary" type="submit">
                    Apply
                  </button>
                </form>
              </div>
            </div>

            {loading ? (
              <div className="sky-empty-state">
                <div className="spinner-border text-info" role="status" aria-label="Loading" />
                <div className="mt-3">Loading worker schedules...</div>
              </div>
            ) : schedules.length === 0 ? (
              <div className="sky-empty-state">No worker schedules found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>Schedule</th>
                      <th>Tool</th>
                      <th>Type</th>
                      <th>Next Run</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedSchedule?.scheduleId === schedule.scheduleId
                            ? 'sky-selected-row'
                            : ''
                        }`}
                        key={schedule.scheduleId}
                        onClick={() => setSelectedSchedule(schedule)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value">{schedule.scheduleName}</div>
                          <div className="small sky-muted sky-mono">{schedule.scheduleCode}</div>
                        </td>
                        <td>
                          <div className="fw-bold sky-detail-value">
                            {schedule.toolLabel || schedule.toolCode}
                          </div>
                          <div className="small sky-muted sky-mono">{schedule.toolCode}</div>
                        </td>
                        <td>{schedule.scheduleType}</td>
                        <td>{formatDate(schedule.nextRunAt)}</td>
                        <td>
                          <div className="d-flex flex-column gap-1 align-items-start">
                            <span
                              className={`sky-pill ${schedule.enabled ? 'sky-pill-success' : 'sky-pill-info'}`}
                            >
                              {schedule.enabled ? 'ENABLED' : 'DISABLED'}
                            </span>
                            {schedule.lastStatus && (
                              <span className={`sky-pill ${statusClass(schedule.lastStatus)}`}>
                                {getStatusLabel(schedule.lastStatus)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div
                            className="d-flex flex-wrap gap-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              className="btn btn-sm sky-btn-ghost"
                              disabled={!canChangeSchedules || actionLoading}
                              onClick={() => editSchedule(schedule)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-sm sky-btn-ghost"
                              disabled={!canRunSchedules || actionLoading || !schedule.enabled}
                              onClick={() => handleRunNow(schedule)}
                              type="button"
                            >
                              Run now
                            </button>
                            <button
                              className="btn btn-sm sky-btn-ghost"
                              disabled={!canChangeSchedules || actionLoading}
                              onClick={() => handleScheduleStatus(schedule, !schedule.enabled)}
                              type="button"
                            >
                              {schedule.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-5">
          <section className="sky-card sky-sticky-detail-card">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-1">Schedule detail</h2>
                <div className="small sky-muted">Selected schedule control and metadata.</div>
              </div>
              {selectedSchedule && (
                <span
                  className={`sky-pill ${selectedSchedule.enabled ? 'sky-pill-success' : 'sky-pill-info'}`}
                >
                  {selectedSchedule.enabled ? 'ENABLED' : 'DISABLED'}
                </span>
              )}
            </div>
            <div className="sky-card-body">
              {selectedSchedule ? (
                <>
                  <dl className="row g-2">
                    <dt className="col-sm-4 sky-detail-label">Schedule</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      <div className="fw-bold">{selectedSchedule.scheduleName}</div>
                      <div className="small sky-muted sky-mono">
                        {selectedSchedule.scheduleCode}
                      </div>
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Tool</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {selectedSchedule.toolLabel || selectedSchedule.toolCode}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Type</dt>
                    <dd className="col-sm-8 sky-detail-value">{selectedSchedule.scheduleType}</dd>

                    <dt className="col-sm-4 sky-detail-label">Run at</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {formatDate(selectedSchedule.runAt)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Interval</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {selectedSchedule.scheduleType === 'INTERVAL'
                        ? `${selectedSchedule.intervalValue} ${selectedSchedule.intervalUnit}`
                        : '—'}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Next run</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {formatDate(selectedSchedule.nextRunAt)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Last run</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {formatDate(selectedSchedule.lastRunAt)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Last status</dt>
                    <dd className="col-sm-8">
                      <span className={`sky-pill ${statusClass(selectedSchedule.lastStatus)}`}>
                        {getStatusLabel(selectedSchedule.lastStatus)}
                      </span>
                    </dd>
                  </dl>

                  <div className="d-flex flex-wrap gap-2 mt-3">
                    <button
                      className="btn sky-btn-ghost"
                      disabled={!canChangeSchedules || actionLoading}
                      onClick={() => editSchedule(selectedSchedule)}
                      type="button"
                    >
                      Edit schedule
                    </button>
                    <button
                      className="btn sky-btn-primary"
                      disabled={!canRunSchedules || actionLoading || !selectedSchedule.enabled}
                      onClick={() => handleRunNow(selectedSchedule)}
                      type="button"
                    >
                      Run now
                    </button>
                    <button
                      className="btn sky-btn-ghost"
                      disabled={!canChangeSchedules || actionLoading}
                      onClick={() =>
                        handleScheduleStatus(selectedSchedule, !selectedSchedule.enabled)
                      }
                      type="button"
                    >
                      {selectedSchedule.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>

                  <hr />

                  <div className="sky-page-kicker">Parameters</div>
                  <pre className="sky-code-block sky-worker-json-preview">
                    {getJsonPreview(selectedSchedule.parameters)}
                  </pre>
                </>
              ) : (
                <div className="sky-empty-state">Select a schedule to inspect it.</div>
              )}
            </div>
          </section>
        </div>

        <div className="col-xl-7">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                  <h2 className="h5 mb-1">Schedule runs</h2>
                  <div className="small sky-muted">
                    Showing {runs.length} of {runTotal} worker run record{runTotal === 1 ? '' : 's'}
                    .
                  </div>
                </div>
                <form className="sky-inline-filter-form" onSubmit={applyRunFilters}>
                  <select
                    className="form-select form-select-sm sky-form-control"
                    onChange={(event) => updateRunFilter('status', event.target.value)}
                    value={runFilters.status}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="form-select form-select-sm sky-form-control"
                    onChange={(event) => updateRunFilter('toolCode', event.target.value)}
                    value={runFilters.toolCode}
                  >
                    <option value="">All tools</option>
                    {tools.map((tool) => (
                      <option key={tool.toolCode} value={tool.toolCode}>
                        {tool.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-sm sky-btn-primary" type="submit">
                    Apply
                  </button>
                </form>
              </div>
            </div>

            {loading ? (
              <div className="sky-empty-state">Loading worker run history...</div>
            ) : runs.length === 0 ? (
              <div className="sky-empty-state">No worker runs found yet.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>Schedule</th>
                      <th>Status</th>
                      <th>Node</th>
                      <th>Queued</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedRun?.scheduleRunId === run.scheduleRunId ? 'sky-selected-row' : ''
                        }`}
                        key={run.scheduleRunId}
                        onClick={() => setSelectedRun(run)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value">
                            {run.scheduleName || run.scheduleCode}
                          </div>
                          <div className="small sky-muted sky-mono">{run.toolCode}</div>
                        </td>
                        <td>
                          <span className={`sky-pill ${statusClass(run.status)}`}>
                            {getStatusLabel(run.status)}
                          </span>
                        </td>
                        <td>{run.nodeName || '—'}</td>
                        <td>{formatDate(run.queuedAt)}</td>
                        <td>{formatDuration(run.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-5">
          <section className="sky-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-1">Run detail</h2>
              <div className="small sky-muted">Execution linkage and result metadata.</div>
            </div>
            <div className="sky-card-body">
              {selectedRun ? (
                <>
                  <dl className="row g-2">
                    <dt className="col-sm-4 sky-detail-label">Run</dt>
                    <dd className="col-sm-8 sky-mono small sky-detail-value">
                      {selectedRun.scheduleRunId}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Execution</dt>
                    <dd className="col-sm-8 sky-mono small sky-detail-value">
                      {selectedRun.executionId || '—'}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Status</dt>
                    <dd className="col-sm-8">
                      <span className={`sky-pill ${statusClass(selectedRun.status)}`}>
                        {getStatusLabel(selectedRun.status)}
                      </span>
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Started</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {formatDate(selectedRun.startedAt)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Finished</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {formatDate(selectedRun.finishedAt)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Exit code</dt>
                    <dd className="col-sm-8 sky-detail-value">{selectedRun.exitCode ?? '—'}</dd>
                  </dl>

                  <hr />
                  <div className="sky-page-kicker">Message</div>
                  <p className="sky-muted mb-3">
                    {selectedRun.message || selectedRun.executionSummary || '—'}
                  </p>

                  <div className="sky-page-kicker">Metadata</div>
                  <pre className="sky-code-block sky-worker-json-preview">
                    {getJsonPreview(selectedRun.metadata)}
                  </pre>
                </>
              ) : (
                <div className="sky-empty-state">Select a run to inspect it.</div>
              )}
            </div>
          </section>
        </div>

        <div className="col-xl-7">
          <section className="sky-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-1">Worker nodes</h2>
                <div className="small sky-muted">
                  Registered daemon processes and heartbeat state.
                </div>
              </div>
              {!canViewNodes && (
                <span className="sky-pill sky-pill-info">WORKER_ADMIN required</span>
              )}
            </div>

            {canViewNodes ? (
              nodes.length > 0 ? (
                <div className="table-responsive">
                  <table className="table sky-table">
                    <thead>
                      <tr>
                        <th>Node</th>
                        <th>Status</th>
                        <th>Heartbeat</th>
                        <th>PID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nodes.map((node) => (
                        <tr key={node.workerNodeId}>
                          <td>
                            <div className="fw-bold sky-detail-value">{node.nodeName}</div>
                            <div className="small sky-muted">{node.hostname || '—'}</div>
                          </td>
                          <td>
                            <span className={`sky-pill ${statusClass(node.status)}`}>
                              {node.status}
                            </span>
                          </td>
                          <td>
                            <div>{formatDate(node.lastHeartbeatAt)}</div>
                            <div className="small sky-muted">
                              {node.secondsSinceHeartbeat === undefined ||
                              node.secondsSinceHeartbeat === null
                                ? '—'
                                : `${formatNumber(node.secondsSinceHeartbeat)}s ago`}
                            </div>
                          </td>
                          <td>{node.processId || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="sky-empty-state">
                  No worker nodes registered yet. Start the daemon with npm run worker.
                </div>
              )
            ) : (
              <div className="sky-empty-state">Worker node visibility requires WORKER_ADMIN.</div>
            )}
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-6">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                  <h2 className="h5 mb-1">Listeners</h2>
                  <div className="small sky-muted">
                    Event-driven worker definitions. Runtime is reserved for the next listener
                    slice.
                  </div>
                </div>
                {canViewListeners && (
                  <form className="sky-inline-filter-form" onSubmit={applyListenerFilters}>
                    <select
                      className="form-select form-select-sm sky-form-control"
                      onChange={(event) => updateListenerFilter('enabled', event.target.value)}
                      value={listenerFilters.enabled}
                    >
                      <option value="">All states</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                    <select
                      className="form-select form-select-sm sky-form-control"
                      onChange={(event) => updateListenerFilter('listenerType', event.target.value)}
                      value={listenerFilters.listenerType}
                    >
                      {LISTENER_TYPE_OPTIONS.map((option) => (
                        <option key={option.value || 'all'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm sky-btn-primary" type="submit">
                      Apply
                    </button>
                  </form>
                )}
              </div>
            </div>

            {canViewListeners ? (
              listeners.length > 0 ? (
                <div className="table-responsive">
                  <table className="table sky-table">
                    <thead>
                      <tr>
                        <th>Listener</th>
                        <th>Type</th>
                        <th>Tool</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listeners.map((listener) => (
                        <tr key={listener.listenerId}>
                          <td>
                            <div className="fw-bold sky-detail-value">{listener.listenerName}</div>
                            <div className="small sky-muted sky-mono">{listener.listenerCode}</div>
                          </td>
                          <td>{listener.listenerType}</td>
                          <td>{listener.toolLabel || listener.toolCode}</td>
                          <td>
                            <span
                              className={`sky-pill ${listener.enabled ? 'sky-pill-success' : 'sky-pill-info'}`}
                            >
                              {listener.enabled ? 'ENABLED' : 'DISABLED'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="sky-empty-state">No listeners configured yet.</div>
              )
            ) : (
              <div className="sky-empty-state">
                Listener visibility requires WORKER_LISTENER_READ.
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-6">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-1">Listener events</h2>
              <div className="small sky-muted">
                Recent detected events from future listener runtimes.
              </div>
            </div>

            {canViewListenerEvents ? (
              listenerEvents.length > 0 ? (
                <div className="table-responsive">
                  <table className="table sky-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Listener</th>
                        <th>Status</th>
                        <th>Detected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listenerEvents.map((event) => (
                        <tr key={event.listenerEventId}>
                          <td className="sky-mono small">{event.eventKey}</td>
                          <td>{event.listenerName || event.listenerCode}</td>
                          <td>
                            <span className={`sky-pill ${statusClass(event.status)}`}>
                              {getStatusLabel(event.status)}
                            </span>
                          </td>
                          <td>{formatDate(event.detectedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="sky-empty-state">No listener events recorded yet.</div>
              )
            ) : (
              <div className="sky-empty-state">
                Listener event visibility requires WORKER_EVENT_READ.
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

export default WorkerControl;
