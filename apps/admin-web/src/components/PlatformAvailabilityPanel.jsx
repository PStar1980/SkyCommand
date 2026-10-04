import DismissibleAlert from './ui/DismissibleAlert.jsx';
import ServerStatusPanel from './ui/ServerStatusPanel.jsx';
import StatusPill from './ui/StatusPill.jsx';

function getContainerState(service) {
  if (!service) return { value: 'Unknown', status: 'UNKNOWN' };
  const state = String(service.state || '').trim().toUpperCase();
  const health = String(service.health || '').trim().toUpperCase();
  if (service.running) {
    if (health === 'UNHEALTHY') return { value: 'Unhealthy', status: 'OFFLINE' };
    if (health === 'STARTING' || state === 'RESTARTING') return { value: 'Starting', status: 'PENDING' };
    return { value: 'Online', status: 'ONLINE' };
  }
  if (state === 'NOT_CREATED') return { value: 'Not created', status: 'OFFLINE' };
  if (state === 'EXITED' || state === 'CREATED') return { value: 'Stopped', status: 'OFFLINE' };
  return { value: state ? state.toLowerCase().replaceAll('_', ' ') : 'Unknown', status: 'UNKNOWN' };
}

function getProcessState(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'ONLINE') return { value: 'Online', status: 'ONLINE' };
  if (normalized === 'OFFLINE') return { value: 'Offline', status: 'OFFLINE' };
  if (normalized === 'DISABLED') return { value: 'Disabled', status: 'DISABLED' };
  return { value: 'Unknown', status: 'UNKNOWN' };
}

function getRuntimeActionState(status, action) {
  return Array.isArray(status?.availableActions) && status.availableActions.includes(action);
}

function PlatformAvailabilityPanel({
  runtimeControlStatus = null,
  canControl = false,
  busyAction = '',
  runtimeError = '',
  onAction = () => {},
  onDismissError = () => {},
}) {
  const supervisor = runtimeControlStatus?.supervisor || null;
  const services = new Map((supervisor?.services || []).map((service) => [service.service, service]));
  const hostAgent = runtimeControlStatus?.hostAgent || null;

  const containerCard = (service, label = service) => {
    const state = getContainerState(services.get(service));
    return { service, label, containerQuery: service, ...state };
  };
  const processCard = (service, label, state) => ({
    service,
    label,
    containerQuery: service,
    ...(state || getProcessState(null)),
  });
  const actionButton = (action, label, tone = 'primary') => (
    <button
      className={`btn btn-sm ${tone === 'danger' ? 'sky-btn-danger' : tone === 'ghost' ? 'sky-btn-ghost' : 'sky-btn-primary'}`}
      disabled={!canControl || Boolean(busyAction) || !getRuntimeActionState(runtimeControlStatus, action)}
      onClick={() => onAction(action)}
      type="button"
    >
      {busyAction === action ? 'Working…' : label}
    </button>
  );
  const runtimeControlUnavailable = (
    <StatusPill label="Lifecycle state unknown" status="UNKNOWN" />
  );

  const supervisorAction = getRuntimeActionState(runtimeControlStatus, 'RESTART_SUPERVISOR')
    ? 'RESTART_SUPERVISOR'
    : getRuntimeActionState(runtimeControlStatus, 'START_SUPERVISOR')
      ? 'START_SUPERVISOR'
      : null;
  const hostAgentAction = getRuntimeActionState(runtimeControlStatus, 'RESTART_HOST_AGENT')
    ? 'RESTART_HOST_AGENT'
    : getRuntimeActionState(runtimeControlStatus, 'START_HOST_AGENT')
      ? 'START_HOST_AGENT'
      : null;

  const segments = [
    {
      label: 'Frontend',
      items: [containerCard('web', 'Web frontend')],
      controls: canControl ? actionButton('REBUILD_FRONTEND', 'Rebuild Frontend') : null,
    },
    {
      label: 'Backend',
      items: [
        containerCard('api', 'API'),
        containerCard('postgres', 'PostgreSQL'),
        containerCard('temporal-volume-init', 'Temporal volume init'),
        containerCard('temporal', 'Temporal server'),
        containerCard('temporal-worker', 'Temporal worker'),
        containerCard('browser-worker', 'Browser worker'),
        containerCard('node-worker', 'Node worker'),
      ],
      controls: canControl ? (
        <div className="d-flex flex-wrap justify-content-end gap-2">
          {actionButton('REBUILD_BACKEND', 'Rebuild Backend')}
          {actionButton('RESTART_RUNTIME', 'Restart Runtime', 'ghost')}
          {actionButton('STOP_RUNTIME', 'Stop Runtime', 'danger')}
        </div>
      ) : null,
    },
    {
      label: 'Agent',
      items: [
        processCard('supervisor', 'Supervisor', getProcessState(supervisor?.status)),
        processCard('host-agent', 'Host Agent', getProcessState(hostAgent?.status)),
        containerCard('agent-runtime-worker', 'Agent runtime worker'),
      ],
      controls: canControl ? (
        <div className="d-flex flex-wrap justify-content-end gap-2">
          {supervisorAction
            ? actionButton(supervisorAction, supervisorAction === 'START_SUPERVISOR' ? 'Start Supervisor' : 'Restart Supervisor', 'ghost')
            : runtimeControlUnavailable}
          {hostAgentAction
            ? actionButton(hostAgentAction, hostAgentAction === 'START_HOST_AGENT' ? 'Start Host Agent' : 'Restart Host Agent', 'ghost')
            : runtimeControlUnavailable}
        </div>
      ) : null,
    },
    {
      label: 'Codex',
      items: [
        containerCard('codex-managed-volume-init', 'Managed volume init'),
        containerCard('codex-agent-runtime-worker', 'Codex agent runtime'),
        containerCard('codex-control-bridge', 'Codex control bridge'),
        containerCard('codex-egress-proxy', 'Codex egress proxy'),
        containerCard('codex-mcp-gateway', 'Codex MCP gateway'),
      ],
      controls: null,
    },
  ];

  return (
    <>
      <ServerStatusPanel
        error={runtimeError ? (
          <DismissibleAlert className="mb-3" onDismiss={onDismissError} tone="danger">
            {runtimeError}
          </DismissibleAlert>
        ) : null}
        segments={segments}
      />
    </>
  );
}

export default PlatformAvailabilityPanel;
