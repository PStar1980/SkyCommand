import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import workerService from '../services/workerService';
import workflowService from '../services/workflowService';

const SCHEDULE_TARGET_TYPE_OPTIONS = [
  { value: 'TOOL', label: 'Tool' },
  { value: 'WORKFLOW', label: 'Workflow' },
];

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'ONCE', label: 'One-time run' },
  { value: 'INTERVAL', label: 'Recurring interval' },
];

const SKY_SERVER_WORKFLOW_START_TOOL_CODE = 'skyserver_workflow_start';

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

const DEFAULT_TIMEZONE = 'America/Toronto';
const SCHEDULER_PAGE_SIZE = 10;
const SCHEDULER_HISTORY_POLL_FAST_MS = 2500;
const SCHEDULER_HISTORY_POLL_IDLE_MS = 15000;
const WORKER_HISTORY_POLL_MS = 10000;

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

function isWorkflowBridgeTool(tool) {
  return tool?.toolCode === SKY_SERVER_WORKFLOW_START_TOOL_CODE;
}

function getDefaultTool(tools = []) {
  return tools.find((tool) => !isWorkflowBridgeTool(tool)) || tools[0] || null;
}

function getDefaultWorkflow(workflows = []) {
  return workflows[0] || null;
}

function getWorkflowCode(workflow) {
  return workflow?.workflowCode || workflow?.workflow_code || '';
}

function getWorkflowDisplayName(workflow) {
  return workflow?.displayName || workflow?.display_name || workflow?.workflowCode || workflow?.workflow_code || '';
}

function buildWorkflowScheduleName(workflow) {
  const displayName = getWorkflowDisplayName(workflow);
  return displayName ? `${displayName} schedule` : 'SkyCommand workflow schedule';
}

function getScheduleTargetType(scheduleOrForm) {
  return scheduleOrForm?.toolCode === SKY_SERVER_WORKFLOW_START_TOOL_CODE ? 'WORKFLOW' : 'TOOL';
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

function createBlankScheduleForm({ targetType = 'TOOL', tool = null, workflow = null } = {}) {
  const workflowCode = getWorkflowCode(workflow);
  const toolCode = targetType === 'WORKFLOW' ? SKY_SERVER_WORKFLOW_START_TOOL_CODE : tool?.toolCode || '';
  const parameters = getInitialParameterValues(tool);

  if (targetType === 'WORKFLOW' && workflowCode) {
    parameters.workflowCode = workflowCode;
  }

  return {
    scheduleId: '',
    targetType,
    scheduleCode: buildScheduleCode(targetType === 'WORKFLOW' ? workflowCode || toolCode : tool?.toolCode),
    scheduleName:
      targetType === 'WORKFLOW' ? buildWorkflowScheduleName(workflow) : tool ? `${tool.label} schedule` : '',
    description: '',
    toolCode,
    scheduleType: 'ONCE',
    timezone: DEFAULT_TIMEZONE,
    runAt: getDefaultRunAt(),
    intervalValue: '1',
    intervalUnit: 'HOUR',
    enabled: true,
    maxConcurrentRuns: '1',
    misfirePolicy: 'RUN_ONCE',
    parameters,
  };
}

function createScheduleFormFromRecord(schedule, tools = []) {
  const tool = tools.find((item) => item.toolCode === schedule.toolCode) || null;
  const targetType = getScheduleTargetType(schedule);

  return {
    scheduleId: schedule.scheduleId || '',
    targetType,
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

function getSelectedWorkflow(workflows = [], workflowCode = '') {
  return workflows.find((workflow) => getWorkflowCode(workflow) === workflowCode) || null;
}

function getScheduleTargetLabel(schedule, workflows = []) {
  if (getScheduleTargetType(schedule) === 'WORKFLOW') {
    const workflowCode = schedule.parameters?.workflowCode || '';
    const workflow = getSelectedWorkflow(workflows, workflowCode);
    return workflow ? getWorkflowDisplayName(workflow) : workflowCode || 'SkyCommand workflow';
  }

  return schedule.toolLabel || schedule.toolCode;
}

function getScheduleTargetCode(schedule) {
  if (getScheduleTargetType(schedule) === 'WORKFLOW') {
    return schedule.parameters?.workflowCode || schedule.toolCode;
  }

  return schedule.toolCode;
}


function getJsonPreview(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return '{}';
  }
}

function getSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getStructuredResultEvidence(run) {
  const directEvidence = getSafeObject(run?.structuredResultEvidence);

  if (directEvidence.outputType) {
    return directEvidence;
  }

  const metadataEvidence = getSafeObject(run?.metadata?.toolResult);
  return metadataEvidence.outputType ? metadataEvidence : null;
}

function formatEvidenceBoolean(value) {
  return value === true ? 'Yes' : value === false ? 'No' : '—';
}

function getStructuredEvidenceRows(evidence = {}) {
  const gitRepositoryStatus = getSafeObject(evidence.gitRepositoryStatus);

  if (Object.keys(gitRepositoryStatus).length > 0) {
    return [
      ['Repository', gitRepositoryStatus.repositoryCode || '—'],
      ['Outcome', gitRepositoryStatus.outcome || '—'],
      [
        'Promotion ready',
        formatEvidenceBoolean(gitRepositoryStatus.readyForDevelopmentPromotion),
      ],
      ['Active branch', gitRepositoryStatus.currentBranch || '—'],
      ['Expected branch', gitRepositoryStatus.expectedBranch || '—'],
      [
        'Remote baseline synchronized',
        formatEvidenceBoolean(gitRepositoryStatus.remoteBranchesSynchronized),
      ],
      ['Working-tree changes', formatNumber(gitRepositoryStatus.totalChanges)],
      ['Blockers', formatNumber(gitRepositoryStatus.blockerCount)],
      ['Inspection duration', formatDuration(gitRepositoryStatus.durationMs)],
    ];
  }

  const macroIngestion = getSafeObject(evidence.macroIngestion);

  if (Object.keys(macroIngestion).length > 0) {
    const totals = getSafeObject(macroIngestion.totals);
    return [
      ['Source', macroIngestion.sourceCode || '—'],
      ['Outcome', macroIngestion.outcome || '—'],
      ['Selected indicators', formatNumber(macroIngestion.selectedIndicators)],
      ['Succeeded', formatNumber(totals.indicatorsSucceeded)],
      ['Failed', formatNumber(totals.indicatorsFailed)],
      ['Rows inserted', formatNumber(totals.rowsInserted)],
      ['Duration', formatDuration(macroIngestion.durationMs)],
    ];
  }

  const repositoryPackage = getSafeObject(evidence.repositoryPackage);

  if (Object.keys(repositoryPackage).length > 0) {
    return [
      ['Repository', repositoryPackage.repositoryName || '—'],
      ['Outcome', repositoryPackage.outcome || '—'],
      ['Archive', repositoryPackage.fileName || '—'],
      ['Files included', formatNumber(repositoryPackage.filesIncluded)],
      ['Archive bytes', formatNumber(repositoryPackage.archiveBytes)],
      ['Duration', formatDuration(repositoryPackage.durationMs)],
    ];
  }

  const repositoryMap = getSafeObject(evidence.repositoryMap);

  if (Object.keys(repositoryMap).length > 0) {
    return [
      ['Repository', repositoryMap.repositoryName || '—'],
      ['Outcome', repositoryMap.outcome || '—'],
      ['Map', repositoryMap.fileName || '—'],
      ['Directories documented', formatNumber(repositoryMap.directoriesDocumented)],
      ['Files documented', formatNumber(repositoryMap.filesDocumented)],
      ['Duration', formatDuration(repositoryMap.durationMs)],
    ];
  }

  const gitCommit = getSafeObject(evidence.gitCommit);

  if (Object.keys(gitCommit).length > 0) {
    return [
      ['Repository', gitCommit.repositoryCode || '—'],
      ['Outcome', gitCommit.outcome || '—'],
      ['Branch', gitCommit.branch || '—'],
      ['Commit', gitCommit.commitSha || '—'],
      ['Changed files', formatNumber(gitCommit.changedFiles)],
      ['Duration', formatDuration(gitCommit.durationMs)],
    ];
  }

  const gitBranchSync = getSafeObject(evidence.gitBranchSync);

  if (Object.keys(gitBranchSync).length > 0) {
    return [
      ['Repository', gitBranchSync.repositoryCode || '—'],
      ['Outcome', gitBranchSync.outcome || '—'],
      [
        'Direction',
        gitBranchSync.sourceBranch && gitBranchSync.targetBranch
          ? `${gitBranchSync.sourceBranch} → ${gitBranchSync.targetBranch}`
          : '—',
      ],
      ['Branches synchronized', formatEvidenceBoolean(gitBranchSync.branchesSynchronized)],
      ['Commits applied', formatNumber(gitBranchSync.commitsApplied)],
      ['Synchronized head', gitBranchSync.synchronizedHeadSha || '—'],
      ['Duration', formatDuration(gitBranchSync.durationMs)],
    ];
  }

  return [];
}

function ScheduledToolResultEvidence({ run }) {
  const evidence = getStructuredResultEvidence(run);

  if (!evidence) {
    return null;
  }

  const rows = getStructuredEvidenceRows(evidence);
  const warningCount = Number(evidence.warnings || 0);
  const success = evidence.success !== false;

  return (
    <div className="mb-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div>
          <div className="sky-page-kicker">Structured result evidence</div>
          <div className="small sky-muted">
            Compact workflow-safe proof captured from the scheduled ToolResult contract.
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${success ? 'sky-pill-success' : 'sky-pill-danger'}`}>
            {success ? 'SUCCESS' : 'FAILED'}
          </span>
          <span className="sky-pill sky-pill-info sky-mono">{evidence.outputType}</span>
          {warningCount > 0 && (
            <span className="sky-pill sky-pill-warning">
              {warningCount} warning{warningCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {evidence.message && <p className="sky-muted mb-2">{evidence.message}</p>}

      {rows.length > 0 ? (
        <div className="table-responsive sky-table-card">
          <table className="table sky-table mb-0">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th className="sky-detail-label" scope="row">
                    {label}
                  </th>
                  <td className={label.toLowerCase().includes('commit') ? 'sky-mono' : ''}>
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sky-empty-state py-3">
          Structured evidence was captured for {evidence.outputType}; use metadata below for the
          diagnostic payload.
        </div>
      )}
    </div>
  );
}

function buildStatCards(health, tools) {
  return [
    {
      label: 'Automation status',
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
      label: 'Automation tools',
      value: tools?.length ?? '—',
      help: 'Worker-visible tool manifest',
      status: tools?.length > 0 ? 'CURRENT' : 'INFO',
    },
  ];
}

function SchedulerControl({ view = 'manage' }) {
  const { hasPermission } = useAuth();
  const canCreateSchedules = hasPermission('WORKER_SCHEDULE_CREATE');
  const canChangeSchedules = hasPermission('WORKER_SCHEDULE_CHANGE');
  const canWriteSchedules = canCreateSchedules || canChangeSchedules;
  const canRunSchedules = hasPermission('WORKER_SCHEDULE_RUN_IMMEDIATE');
  const canViewNodes = hasPermission('WORKER_ADMIN');

  const [health, setHealth] = useState(null);
  const [tools, setTools] = useState([]);
  const [activeWorkflows, setActiveWorkflows] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [scheduleTotal, setScheduleTotal] = useState(0);
  const [runs, setRuns] = useState([]);
  const [runTotal, setRunTotal] = useState(0);
  const [nodes, setNodes] = useState([]);
  const [nodeTotal, setNodeTotal] = useState(0);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [formMode, setFormMode] = useState('create');
  const [scheduleForm, setScheduleForm] = useState(createBlankScheduleForm());
  const [scheduleFilters, setScheduleFilters] = useState({
    enabled: '',
    scheduleType: '',
    status: '',
    q: '',
    limit: SCHEDULER_PAGE_SIZE,
    offset: 0,
  });
  const [runFilters, setRunFilters] = useState({
    status: '',
    toolCode: '',
    q: '',
    limit: SCHEDULER_PAGE_SIZE,
    offset: 0,
  });
  const [nodeFilters, setNodeFilters] = useState({
    status: '',
    q: '',
    limit: SCHEDULER_PAGE_SIZE,
    offset: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState(null);

  const workflowBridgeTool = useMemo(
    () => tools.find((tool) => isWorkflowBridgeTool(tool)) || null,
    [tools],
  );
  const workerTools = useMemo(
    () => tools.filter((tool) => !isWorkflowBridgeTool(tool)),
    [tools],
  );
  const selectedTool = useMemo(
    () => getSelectedTool(tools, scheduleForm.toolCode),
    [scheduleForm.toolCode, tools],
  );
  const selectedWorkflowCode = scheduleForm.parameters?.workflowCode || '';
  const selectedWorkflow = useMemo(
    () => getSelectedWorkflow(activeWorkflows, selectedWorkflowCode),
    [activeWorkflows, selectedWorkflowCode],
  );
  const statCards = useMemo(() => buildStatCards(health, tools), [health, tools]);
  const schedulePageCount = Math.max(1, Math.ceil(scheduleTotal / scheduleFilters.limit));
  const currentSchedulePage = Math.min(
    Math.floor(scheduleFilters.offset / scheduleFilters.limit) + 1,
    schedulePageCount,
  );
  const runPageCount = Math.max(1, Math.ceil(runTotal / runFilters.limit));
  const currentRunPage = Math.min(
    Math.floor(runFilters.offset / runFilters.limit) + 1,
    runPageCount,
  );
  const nodePageCount = Math.max(1, Math.ceil(nodeTotal / nodeFilters.limit));
  const currentNodePage = Math.min(
    Math.floor(nodeFilters.offset / nodeFilters.limit) + 1,
    nodePageCount,
  );
  const hasActiveScheduleRuns = Number(health?.runs24h?.active || 0) > 0 || runs.some((run) => ['QUEUED', 'STARTED'].includes(normalizeStatus(run.status)));

  async function loadWorkerTools() {
    const result = await workerService.listTools();
    const nextTools = result.items || [];
    setTools(nextTools);

    setScheduleForm((currentForm) => {
      if (currentForm.toolCode || nextTools.length === 0) {
        return currentForm;
      }

      return createBlankScheduleForm({ tool: getDefaultTool(nextTools) });
    });
  }

  async function loadActiveWorkflows() {
    const result = await workflowService.listDefinitions({
      activeOnly: true,
      enabledOnly: true,
      visibleOnly: true,
      publishedOnly: true,
    });
    setActiveWorkflows(result.items || []);
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

  async function loadNodes(nextFilters = nodeFilters) {
    if (!canViewNodes) {
      setNodes([]);
      setNodeTotal(0);
      setSelectedNode(null);
      return;
    }

    const result = await workerService.listNodes(nextFilters);
    const nextItems = result.items || [];
    setNodes(nextItems);
    setNodeTotal(result.total || 0);
    setSelectedNode((currentSelected) => {
      if (!currentSelected) {
        return nextItems[0] || null;
      }

      return (
        nextItems.find((node) => node.workerNodeId === currentSelected.workerNodeId) ||
        nextItems[0] ||
        null
      );
    });
  }

  async function refreshAll() {
    setLoading(true);
    setError('');

    try {
      await Promise.all([
        loadHealth(),
        loadWorkerTools(),
        loadActiveWorkflows(),
        loadSchedules(),
        loadRuns(),
        loadNodes(),
      ]);
      setLastRefreshAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load worker control data.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshCurrentView({ quiet = false } = {}) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      if (view === 'history') {
        await Promise.all([loadHealth(), loadWorkerTools(), loadRuns(runFilters)]);
      } else if (view === 'worker') {
        await Promise.all([loadHealth(), loadNodes(nodeFilters)]);
      } else if (view === 'create') {
        await Promise.all([loadHealth(), loadWorkerTools(), loadActiveWorkflows()]);
      } else {
        await Promise.all([loadHealth(), loadWorkerTools(), loadActiveWorkflows(), loadSchedules(scheduleFilters)]);
      }
      setLastRefreshAt(new Date());
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to refresh automation data.');
      }
    } finally {
      if (!quiet) {
        setLoading(false);
      }
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

  useEffect(() => {
    if (view !== 'history' && view !== 'worker') {
      return undefined;
    }

    let canceled = false;
    let timerId = null;

    async function poll() {
      await refreshCurrentView({ quiet: true });

      if (canceled) {
        return;
      }

      const hiddenDelay = document.visibilityState === 'hidden' ? 30000 : null;
      const delay = hiddenDelay || (view === 'history'
        ? (hasActiveScheduleRuns ? SCHEDULER_HISTORY_POLL_FAST_MS : SCHEDULER_HISTORY_POLL_IDLE_MS)
        : WORKER_HISTORY_POLL_MS);
      timerId = window.setTimeout(poll, delay);
    }

    const initialDelay = view === 'history'
      ? (hasActiveScheduleRuns ? SCHEDULER_HISTORY_POLL_FAST_MS : SCHEDULER_HISTORY_POLL_IDLE_MS)
      : WORKER_HISTORY_POLL_MS;
    timerId = window.setTimeout(poll, initialDelay);

    return () => {
      canceled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hasActiveScheduleRuns, runFilters, nodeFilters]);

  function updateScheduleFilter(name, value) {
    setScheduleFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
      offset: 0,
    }));
  }

  function updateRunFilter(name, value) {
    setRunFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
      offset: 0,
    }));
  }

  function updateNodeFilter(name, value) {
    setNodeFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
      offset: 0,
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

  async function applyNodeFilters(event) {
    event.preventDefault();
    setError('');

    try {
      await loadNodes(nodeFilters);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load worker nodes.');
    }
  }

  async function clearScheduleFilters() {
    const nextFilters = {
      enabled: '',
      scheduleType: '',
      status: '',
      q: '',
      limit: SCHEDULER_PAGE_SIZE,
      offset: 0,
    };
    setScheduleFilters(nextFilters);
    await loadSchedules(nextFilters);
  }

  async function clearRunFilters() {
    const nextFilters = {
      status: '',
      toolCode: '',
      q: '',
      limit: SCHEDULER_PAGE_SIZE,
      offset: 0,
    };
    setRunFilters(nextFilters);
    await loadRuns(nextFilters);
  }

  async function clearNodeFilters() {
    const nextFilters = {
      status: '',
      q: '',
      limit: SCHEDULER_PAGE_SIZE,
      offset: 0,
    };
    setNodeFilters(nextFilters);
    await loadNodes(nextFilters);
  }

  function resetForm(tool = getDefaultTool(tools)) {
    setFormMode('create');
    setScheduleForm(createBlankScheduleForm({ tool }));
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

  function handleTargetTypeChange(targetType) {
    if (targetType === 'WORKFLOW') {
      const workflow = getDefaultWorkflow(activeWorkflows);
      const workflowCode = getWorkflowCode(workflow);
      const parameters = getInitialParameterValues(workflowBridgeTool);

      if (workflowCode) {
        parameters.workflowCode = workflowCode;
      }

      setScheduleForm((currentForm) => ({
        ...currentForm,
        targetType,
        toolCode: SKY_SERVER_WORKFLOW_START_TOOL_CODE,
        scheduleCode:
          formMode === 'create'
            ? buildScheduleCode(workflowCode || SKY_SERVER_WORKFLOW_START_TOOL_CODE)
            : currentForm.scheduleCode,
        scheduleName:
          formMode === 'create' ? buildWorkflowScheduleName(workflow) : currentForm.scheduleName,
        parameters,
      }));
      return;
    }

    const nextTool = getDefaultTool(tools);

    setScheduleForm((currentForm) => ({
      ...currentForm,
      targetType: 'TOOL',
      toolCode: nextTool?.toolCode || '',
      scheduleCode:
        formMode === 'create' ? buildScheduleCode(nextTool?.toolCode) : currentForm.scheduleCode,
      scheduleName:
        formMode === 'create' && nextTool ? `${nextTool.label} schedule` : currentForm.scheduleName,
      parameters: getInitialParameterValues(nextTool),
    }));
  }

  function handleToolChange(toolCode) {
    const nextTool = getSelectedTool(tools, toolCode);

    setScheduleForm((currentForm) => ({
      ...currentForm,
      targetType: 'TOOL',
      toolCode,
      scheduleCode: formMode === 'create' ? buildScheduleCode(toolCode) : currentForm.scheduleCode,
      scheduleName:
        formMode === 'create' && nextTool ? `${nextTool.label} schedule` : currentForm.scheduleName,
      parameters: getInitialParameterValues(nextTool),
    }));
  }

  function handleWorkflowChange(workflowCode) {
    const workflow = getSelectedWorkflow(activeWorkflows, workflowCode);
    const parameters = getInitialParameterValues(workflowBridgeTool);

    if (workflowCode) {
      parameters.workflowCode = workflowCode;
    }

    setScheduleForm((currentForm) => ({
      ...currentForm,
      targetType: 'WORKFLOW',
      toolCode: SKY_SERVER_WORKFLOW_START_TOOL_CODE,
      scheduleCode: formMode === 'create' ? buildScheduleCode(workflowCode) : currentForm.scheduleCode,
      scheduleName:
        formMode === 'create' ? buildWorkflowScheduleName(workflow) : currentForm.scheduleName,
      parameters,
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

    if (scheduleForm.targetType === 'WORKFLOW') {
      if (!workflowBridgeTool) {
        setError('The Start SkyCommand Workflow scheduler bridge is not configured.');
        return;
      }

      if (!scheduleForm.parameters?.workflowCode) {
        setError('Select an active workflow.');
        return;
      }
    } else if (!scheduleForm.toolCode) {
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

  async function handleQueueNow(schedule) {
    if (!canRunSchedules) {
      setError('WORKER_SCHEDULE_RUN_IMMEDIATE is required to queue a schedule.');
      return;
    }

    setActionLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await workerService.queueScheduleNow(schedule.scheduleId);
      setSelectedSchedule(result.schedule || null);
      setNotice(`Queued schedule ${schedule.scheduleCode} for immediate execution.`);
      await Promise.all([loadHealth(), loadSchedules(), loadRuns()]);
    } catch (runError) {
      setError(runError.message || 'Failed to queue schedule.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUnqueueSchedule(schedule) {
    if (!canChangeSchedules) {
      setError('WORKER_SCHEDULE_CHANGE is required to unqueue a schedule.');
      return;
    }

    setActionLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await workerService.unqueueSchedule(schedule.scheduleId);
      setSelectedSchedule(result.schedule || null);
      setNotice(`Unqueued schedule ${schedule.scheduleCode}.`);
      await Promise.all([loadHealth(), loadSchedules(), loadRuns()]);
    } catch (runError) {
      setError(runError.message || 'Failed to unqueue schedule.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteSchedule(schedule) {
    if (!canChangeSchedules) {
      setError('WORKER_SCHEDULE_CHANGE is required to delete schedules.');
      return;
    }

    const confirmed = window.confirm(
      `Delete schedule ${schedule.scheduleCode}? This archives the schedule so it no longer appears in Active Schedules. Run history is preserved.`,
    );

    if (!confirmed) {
      return;
    }

    setActionLoading(true);
    setError('');
    setNotice('');

    try {
      await workerService.deleteSchedule(schedule.scheduleId, {
        deleteReason: 'Deleted from SkyCommand Admin Scheduler page.',
      });
      setSelectedSchedule(null);
      resetForm();
      setNotice(`Deleted schedule ${schedule.scheduleCode}.`);
      await Promise.all([loadHealth(), loadSchedules(), loadRuns()]);
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete schedule.');
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

  function goToSchedulePage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), schedulePageCount);
    const nextFilters = { ...scheduleFilters, offset: (nextPage - 1) * scheduleFilters.limit };
    setScheduleFilters(nextFilters);
    loadSchedules(nextFilters);
  }

  function goToRunPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), runPageCount);
    const nextFilters = { ...runFilters, offset: (nextPage - 1) * runFilters.limit };
    setRunFilters(nextFilters);
    loadRuns(nextFilters);
  }

  function goToNodePage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), nodePageCount);
    const nextFilters = { ...nodeFilters, offset: (nextPage - 1) * nodeFilters.limit };
    setNodeFilters(nextFilters);
    loadNodes(nextFilters);
  }

  function renderPagination({ currentPage, pageCount, total, label, onPageChange }) {
    const rangeStart = total === 0 ? 0 : (currentPage - 1) * SCHEDULER_PAGE_SIZE + 1;
    const rangeEnd = Math.min(currentPage * SCHEDULER_PAGE_SIZE, total);
    const selectId = `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-page-select`;

    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {rangeStart}-{rangeEnd} of {total} {label}
        </div>
        <div className="sky-pagination-controls" aria-label={`${label} pagination`}>
          <button className="btn btn-sm sky-btn-ghost" disabled={currentPage <= 1} onClick={() => onPageChange(1)} type="button">First</button>
          <button className="btn btn-sm sky-btn-ghost" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} type="button">Back</button>
          <label className="sky-pagination-select-label" htmlFor={selectId}>Page</label>
          <select className="form-select form-select-sm sky-form-control sky-pagination-select" id={selectId} onChange={(event) => onPageChange(event.target.value)} value={currentPage}>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>{page}</option>
            ))}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button className="btn btn-sm sky-btn-ghost" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)} type="button">Next</button>
          <button className="btn btn-sm sky-btn-ghost" disabled={currentPage >= pageCount} onClick={() => onPageChange(pageCount)} type="button">Last</button>
        </div>
      </div>
    );
  }

  const pageMeta = {
    history: {
      kicker: 'Automation · History',
      title: 'Scheduler History',
      subtitle: 'Search scheduled executions, inspect structured results, and follow active worker runs with smart polling.',
      refreshLabel: 'Refresh history',
    },
    manage: {
      kicker: 'Automation · Manage',
      title: 'Manage Schedules',
      subtitle: 'Search, configure, queue, enable, disable, and retire schedules for worker tools and workflows.',
      refreshLabel: 'Refresh schedules',
    },
    create: {
      kicker: 'Automation · Create',
      title: 'Create Schedules',
      subtitle: 'Create a timed or recurring schedule for a worker-visible tool or published SkyCommand workflow.',
      refreshLabel: 'Refresh targets',
    },
    worker: {
      kicker: 'Automation · Workers',
      title: 'Worker History',
      subtitle: 'Inspect registered worker processes, heartbeat freshness, runtime identity, and node metadata with smart polling.',
      refreshLabel: 'Refresh workers',
    },
  }[view] || {};

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">{pageMeta.kicker}</div>
          <h1 className="sky-page-title">{pageMeta.title}</h1>
          <p className="sky-page-subtitle">{pageMeta.subtitle}</p>
        </div>
        <div className="text-md-end">
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={() => refreshCurrentView()}
            type="button"
          >
            {loading ? 'Refreshing...' : pageMeta.refreshLabel}
          </button>
          <div className="small sky-muted mt-2">
            Last refresh: {lastRefreshAt ? formatDate(lastRefreshAt) : '—'}
          </div>
          {(view === 'history' || view === 'worker') && (
            <div className="d-flex flex-wrap justify-content-md-end gap-2 mt-2">
              <span className="sky-pill sky-pill-success">Smart polling live</span>
              <span className="sky-pill sky-pill-info">
                {view === 'history'
                  ? (hasActiveScheduleRuns ? 'Every 2.5 s while active' : 'Every 15 s')
                  : 'Every 10 s'}
              </span>
            </div>
          )}
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {view === 'worker' && (
        <>
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

        </>
      )}

      {(view === 'create' || view === 'manage') && (
      <div className="row g-3 mt-1">
        {(view === 'create' || (view === 'manage' && formMode === 'edit')) && (
          <div className="col-12">
          <section className="sky-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-1">
                  {formMode === 'edit' ? 'Edit schedule' : 'Create schedule'}
                </h2>
                <div className="small sky-muted">
                  Choose whether to schedule a tool or workflow, then define when it should run.
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
                <div className="row g-3">
                  <div className="col-md-5">
                    <label className="form-label" htmlFor="scheduleTargetType">
                      Schedule Type
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWriteSchedules || saving}
                      id="scheduleTargetType"
                      onChange={(event) => handleTargetTypeChange(event.target.value)}
                      value={scheduleForm.targetType || 'TOOL'}
                    >
                      {SCHEDULE_TARGET_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="form-text sky-muted">
                      Tools run worker-visible primitives. Workflows run active SkyCommand workflows.
                    </div>
                  </div>

                  <div className="col-md-7">
                    {scheduleForm.targetType === 'WORKFLOW' ? (
                      <>
                        <label className="form-label" htmlFor="workflowTargetCode">
                          Workflow
                        </label>
                        <select
                          className="form-select sky-form-control"
                          disabled={
                            !canWriteSchedules ||
                            saving ||
                            !workflowBridgeTool ||
                            activeWorkflows.length === 0
                          }
                          id="workflowTargetCode"
                          onChange={(event) => handleWorkflowChange(event.target.value)}
                          required
                          value={selectedWorkflowCode}
                        >
                          <option value="">Select active workflow</option>
                          {activeWorkflows.map((workflow) => (
                            <option key={getWorkflowCode(workflow)} value={getWorkflowCode(workflow)}>
                              {getWorkflowDisplayName(workflow)} ({getWorkflowCode(workflow)})
                            </option>
                          ))}
                        </select>
                        {selectedWorkflow ? (
                          <div className="form-text sky-muted">
                            <span className="sky-pill sky-pill-success">workflow</span>{' '}
                            {selectedWorkflow.description || 'SkyCommand workflow definition'}
                          </div>
                        ) : (
                          <div className="form-text text-warning">
                            {workflowBridgeTool
                              ? 'No active workflows are available.'
                              : 'Start SkyCommand Workflow bridge tool is not configured.'}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <label className="form-label" htmlFor="workerToolCode">
                          Tool
                        </label>
                        <select
                          className="form-select sky-form-control"
                          disabled={!canWriteSchedules || saving || workerTools.length === 0}
                          id="workerToolCode"
                          onChange={(event) => handleToolChange(event.target.value)}
                          required
                          value={scheduleForm.toolCode}
                        >
                          <option value="">Select worker tool</option>
                          {workerTools.map((tool) => (
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
                      </>
                    )}
                  </div>
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
                      Timing
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

                {scheduleForm.targetType !== 'WORKFLOW' && selectedTool?.parameters?.length > 0 && (
                  <div className="mt-4">
                    <div className="sky-page-kicker">Target parameters</div>
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
                    disabled={!canWriteSchedules || saving || (scheduleForm.targetType === 'WORKFLOW' ? !selectedWorkflow : workerTools.length === 0)}
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
        )}

        {view === 'manage' && (
          <div className="col-12">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                  <h2 className="h5 mb-1">Active Schedules</h2>
                  <div className="small sky-muted">
                    Showing {schedules.length} of {scheduleTotal} active schedule definition
                    {scheduleTotal === 1 ? '' : 's'}.
                  </div>
                </div>
                <form className="sky-inline-filter-form" onSubmit={applyScheduleFilters}>
                  <input
                    className="form-control form-control-sm sky-form-control"
                    onChange={(event) => updateScheduleFilter('q', event.target.value)}
                    placeholder="Search schedules"
                    type="search"
                    value={scheduleFilters.q}
                  />
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
                  <select
                    className="form-select form-select-sm sky-form-control"
                    onChange={(event) => updateScheduleFilter('status', event.target.value)}
                    value={scheduleFilters.status}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="btn btn-sm sky-btn-primary" type="submit">Apply filters</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={clearScheduleFilters} type="button">Clear filters</button>
                </form>
              </div>
            </div>

            {loading ? (
              <div className="sky-empty-state">
                <div className="spinner-border text-info" role="status" aria-label="Loading" />
                <div className="mt-3">Loading worker schedules...</div>
              </div>
            ) : schedules.length === 0 ? (
              <div className="sky-empty-state">No active schedules found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>Schedule</th>
                      <th>Target</th>
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
                          <div className="d-flex flex-column gap-1 align-items-start">
                            <span
                              className={`sky-pill ${
                                getScheduleTargetType(schedule) === 'WORKFLOW'
                                  ? 'sky-pill-success'
                                  : 'sky-pill-info'
                              }`}
                            >
                              {getScheduleTargetType(schedule)}
                            </span>
                            <div className="fw-bold sky-detail-value">
                              {getScheduleTargetLabel(schedule, activeWorkflows)}
                            </div>
                            <div className="small sky-muted sky-mono">
                              {getScheduleTargetCode(schedule)}
                            </div>
                          </div>
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
                            {schedule.isQueued ? (
                              <button
                                className="btn btn-sm sky-btn-ghost"
                                disabled={!canChangeSchedules || actionLoading}
                                onClick={() => handleUnqueueSchedule(schedule)}
                                type="button"
                              >
                                Unqueue
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm sky-btn-ghost"
                                disabled={!canRunSchedules || actionLoading || !schedule.enabled}
                                onClick={() => handleQueueNow(schedule)}
                                type="button"
                              >
                                Queue now
                              </button>
                            )}
                            <button
                              className="btn btn-sm sky-btn-ghost"
                              disabled={!canChangeSchedules || actionLoading}
                              onClick={() => handleScheduleStatus(schedule, !schedule.enabled)}
                              type="button"
                            >
                              {schedule.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              className="btn btn-sm sky-btn-ghost text-danger"
                              disabled={!canChangeSchedules || actionLoading}
                              onClick={() => handleDeleteSchedule(schedule)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {renderPagination({
              currentPage: currentSchedulePage,
              pageCount: schedulePageCount,
              total: scheduleTotal,
              label: 'schedule definition(s)',
              onPageChange: goToSchedulePage,
            })}
          </section>
          </div>
        )}
      </div>

      )}

      {(view === 'manage' || view === 'history') && (
      <div className="row g-3 mt-1">
        {view === 'manage' && (
          <div className="col-12">
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

                    <dt className="col-sm-4 sky-detail-label">Target</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      <div className="d-flex flex-column gap-1 align-items-start">
                        <span
                          className={`sky-pill ${
                            getScheduleTargetType(selectedSchedule) === 'WORKFLOW'
                              ? 'sky-pill-success'
                              : 'sky-pill-info'
                          }`}
                        >
                          {getScheduleTargetType(selectedSchedule)}
                        </span>
                        <span>{getScheduleTargetLabel(selectedSchedule, activeWorkflows)}</span>
                        <span className="small sky-muted sky-mono">
                          {getScheduleTargetCode(selectedSchedule)}
                        </span>
                      </div>
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

                    <dt className="col-sm-4 sky-detail-label">Queue request</dt>
                    <dd className="col-sm-8 sky-detail-value">
                      {selectedSchedule.queueRequestedAt
                        ? formatDate(selectedSchedule.queueRequestedAt)
                        : '—'}
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
                    {selectedSchedule.isQueued ? (
                      <button
                        className="btn sky-btn-primary"
                        disabled={!canChangeSchedules || actionLoading}
                        onClick={() => handleUnqueueSchedule(selectedSchedule)}
                        type="button"
                      >
                        Unqueue
                      </button>
                    ) : (
                      <button
                        className="btn sky-btn-primary"
                        disabled={!canRunSchedules || actionLoading || !selectedSchedule.enabled}
                        onClick={() => handleQueueNow(selectedSchedule)}
                        type="button"
                      >
                        Queue now
                      </button>
                    )}
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
                    <button
                      className="btn sky-btn-ghost text-danger"
                      disabled={!canChangeSchedules || actionLoading}
                      onClick={() => handleDeleteSchedule(selectedSchedule)}
                      type="button"
                    >
                      Delete
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
        )}

        {view === 'history' && (
          <div className="col-12">
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
                  <input
                    className="form-control form-control-sm sky-form-control"
                    onChange={(event) => updateRunFilter('q', event.target.value)}
                    placeholder="Search runs"
                    type="search"
                    value={runFilters.q}
                  />
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
                    <option value="">All targets</option>
                    {tools.map((tool) => (
                      <option key={tool.toolCode} value={tool.toolCode}>
                        {tool.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-sm sky-btn-primary" type="submit">Apply filters</button>
                  <button className="btn btn-sm sky-btn-ghost" onClick={clearRunFilters} type="button">Clear filters</button>
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
            {renderPagination({
              currentPage: currentRunPage,
              pageCount: runPageCount,
              total: runTotal,
              label: 'schedule run(s)',
              onPageChange: goToRunPage,
            })}
          </section>
          </div>
        )}
      </div>

      )}

      {(view === 'history' || view === 'worker') && (
      <div className="row g-3 mt-1">
        {view === 'history' && (
          <div className="col-12">
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

                  <ScheduledToolResultEvidence run={selectedRun} />

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
        )}

        {view === 'worker' && (
          <div className="col-12">
          <div className="d-flex flex-column gap-3">
            <section className="sky-card sky-table-card">
              <div className="sky-card-header">
                <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
                  <div>
                    <div className="sky-page-kicker">Worker browser</div>
                    <h2 className="h5 mb-1">Registered worker nodes</h2>
                    <div className="small sky-muted">
                      Heartbeat records refresh automatically while this page remains open.
                    </div>
                  </div>
                  {canViewNodes ? (
                    <form className="sky-inline-filter-form" onSubmit={applyNodeFilters}>
                      <input
                        className="form-control form-control-sm sky-form-control"
                        onChange={(event) => updateNodeFilter('q', event.target.value)}
                        placeholder="Search node, host, version..."
                        type="search"
                        value={nodeFilters.q}
                      />
                      <select
                        className="form-select form-select-sm sky-form-control"
                        onChange={(event) => updateNodeFilter('status', event.target.value)}
                        value={nodeFilters.status}
                      >
                        <option value="">All statuses</option>
                        <option value="ONLINE">Online</option>
                        <option value="ERROR">Error</option>
                        <option value="OFFLINE">Offline</option>
                      </select>
                      <button className="btn btn-sm sky-btn-primary" type="submit">Apply filters</button>
                      <button className="btn btn-sm sky-btn-ghost" onClick={clearNodeFilters} type="button">Clear filters</button>
                    </form>
                  ) : (
                    <span className="sky-pill sky-pill-info">WORKER_ADMIN required</span>
                  )}
                </div>
              </div>

              {canViewNodes ? (
                nodes.length > 0 ? (
                  <div className="table-responsive">
                    <table className="table table-hover sky-table align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Node</th>
                          <th>Status</th>
                          <th>Heartbeat</th>
                          <th>Process</th>
                          <th>Version</th>
                          <th>Started</th>
                          <th className="text-end">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.map((node) => (
                          <tr
                            className={`sky-clickable-row ${selectedNode?.workerNodeId === node.workerNodeId ? 'sky-selected-row' : ''}`}
                            key={node.workerNodeId}
                            onClick={() => setSelectedNode(node)}
                          >
                            <td>
                              <div className="fw-bold sky-detail-value">{node.nodeName}</div>
                              <div className="small sky-muted">{node.hostname || '—'}</div>
                            </td>
                            <td><span className={`sky-pill ${statusClass(node.status)}`}>{node.status}</span></td>
                            <td>
                              <div>{formatDate(node.lastHeartbeatAt)}</div>
                              <div className="small sky-muted">
                                {node.secondsSinceHeartbeat === undefined || node.secondsSinceHeartbeat === null
                                  ? '—'
                                  : `${formatNumber(node.secondsSinceHeartbeat)}s ago`}
                              </div>
                            </td>
                            <td>{node.processId || '—'}</td>
                            <td>{node.appVersion || '—'}</td>
                            <td>{formatDate(node.startedAt)}</td>
                            <td className="text-end">
                              <button
                                className="btn btn-sm sky-btn-ghost"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedNode(node);
                                }}
                                type="button"
                              >
                                {selectedNode?.workerNodeId === node.workerNodeId ? 'Selected' : 'View worker'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="sky-empty-state">No worker nodes match the current filters.</div>
                )
              ) : (
                <div className="sky-empty-state">Worker node visibility requires WORKER_ADMIN.</div>
              )}
              {canViewNodes ? renderPagination({
                currentPage: currentNodePage,
                pageCount: nodePageCount,
                total: nodeTotal,
                label: 'worker node(s)',
                onPageChange: goToNodePage,
              }) : null}
            </section>

            <section className="sky-card">
              <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
                <div>
                  <div className="sky-page-kicker">Selected worker record</div>
                  <h2 className="h5 mb-1">{selectedNode?.nodeName || 'Worker detail'}</h2>
                  <div className="small sky-muted">Runtime identity, heartbeat timing, and registration metadata.</div>
                </div>
                {selectedNode ? <span className={`sky-pill ${statusClass(selectedNode.status)}`}>{selectedNode.status}</span> : null}
              </div>
              <div className="sky-card-body">
                {selectedNode ? (
                  <>
                    <div className="table-responsive sky-table-card mb-3">
                      <table className="table table-sm sky-table align-middle mb-0">
                        <tbody>
                          <tr><th>Node name</th><td>{selectedNode.nodeName || '—'}</td><th>Hostname</th><td>{selectedNode.hostname || '—'}</td></tr>
                          <tr><th>Process ID</th><td>{selectedNode.processId || '—'}</td><th>Application version</th><td>{selectedNode.appVersion || '—'}</td></tr>
                          <tr><th>Started</th><td>{formatDate(selectedNode.startedAt)}</td><th>Last heartbeat</th><td>{formatDate(selectedNode.lastHeartbeatAt)}</td></tr>
                          <tr><th>Heartbeat age</th><td>{selectedNode.secondsSinceHeartbeat == null ? '—' : `${formatNumber(selectedNode.secondsSinceHeartbeat)} seconds`}</td><th>Registered</th><td>{formatDate(selectedNode.createdAt)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                    <details className="sky-details-panel">
                      <summary>Technical identifiers and metadata</summary>
                      <div className="pt-3">
                        <div className="sky-page-kicker">Worker node ID</div>
                        <div className="sky-mono small mb-3">{selectedNode.workerNodeId}</div>
                        <pre className="sky-code-block sky-worker-json-preview mb-0">{getJsonPreview(selectedNode.metadata)}</pre>
                      </div>
                    </details>
                  </>
                ) : (
                  <div className="sky-empty-state">Select a worker row to inspect its heartbeat record.</div>
                )}
              </div>
            </section>
          </div>
          </div>
        )}
      </div>
      )}
    </>
  );
}

export function SchedulerHistory() {
  return <SchedulerControl view="history" />;
}

export function ManageSchedules() {
  return <SchedulerControl view="manage" />;
}

export function CreateSchedule() {
  return <SchedulerControl view="create" />;
}

export function WorkerHistory() {
  return <SchedulerControl view="worker" />;
}

export default ManageSchedules;
