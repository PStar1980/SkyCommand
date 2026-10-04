import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';
import infrastructureService from '../services/infrastructureService.js';
import supervisorService from '../services/supervisorService.js';
import DismissibleAlert from './ui/DismissibleAlert.jsx';
import StatusPill from './ui/StatusPill.jsx';

const SUPERVISOR_POLL_MS = 4000;
const SUPERVISOR_ACTIONS = {
  REBUILD_FRONTEND: 'REBUILD_WEB',
  REBUILD_BACKEND: 'REBUILD_BACKEND',
  RESTART_RUNTIME: 'RESTART',
  STOP_RUNTIME: 'STOP',
};

function getRuntimeStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ONLINE') return 'ONLINE';
  if (['STARTING', 'PARTIAL'].includes(normalized)) return 'WARNING';
  if (['STOPPED', 'UNAVAILABLE', 'DEGRADED', 'OFFLINE'].includes(normalized)) return 'OFFLINE';
  return 'INFO';
}

function confirmationMessage(action) {
  if (action === 'STOP_RUNTIME') {
    return 'Stop the SkyCommand backend runtime? The web shell and Supervisor will stay online, but your current session will end and the login page will switch to Runtime Control.';
  }
  if (action === 'REBUILD_FRONTEND') {
    return 'Rebuild the SkyCommand frontend from the current local source? The Supervisor will rebuild the web service and reload this page when it finishes. The backend runtime will stay online.';
  }
  if (action === 'REBUILD_BACKEND') {
    return 'Rebuild and recreate the SkyCommand API and worker services from the current local source? PostgreSQL, Temporal server, the web shell, and Supervisor will stay online.';
  }
  if (action === 'RESTART_RUNTIME') {
    return 'Restart the SkyCommand backend runtime? Your current session will end and you will sign in again when the runtime is healthy.';
  }
  if (action === 'START_SUPERVISOR') return 'Start the host-native SkyCommand Supervisor through the registered Host Agent lifecycle path?';
  if (action === 'RESTART_SUPERVISOR') return 'Restart the host-native SkyCommand Supervisor through the registered Host Agent lifecycle path?';
  if (action === 'START_HOST_AGENT') return 'Start the host-native SkyCommand Host Agent through the Supervisor lifecycle path?';
  if (action === 'RESTART_HOST_AGENT') return 'Restart the host-native SkyCommand Host Agent through the Supervisor lifecycle path?';
  return 'Run this governed SkyCommand runtime lifecycle action?';
}

function createOperationId() {
  const operationId = globalThis.crypto?.randomUUID?.();
  if (!operationId) throw new Error('A secure runtime-control operation ID could not be generated.');
  return operationId;
}

function SkyCommandRuntimeControls({
  canControl = false,
  compact = false,
  onStatusChange = null,
  children = null,
}) {
  const [runtimeControlStatus, setRuntimeControlStatus] = useState(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const refreshStatus = useCallback(async ({ signal } = {}) => {
    try {
      const status = await infrastructureService.getSkyCommandRuntimeControlStatus({ signal });
      setRuntimeControlStatus(status);
      onStatusChange?.(status);
      setRuntimeError('');
      return status;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      setRuntimeControlStatus(null);
      onStatusChange?.(null);
      setRuntimeError('SkyCommand runtime status is unavailable to this session.');
      return null;
    }
  }, [onStatusChange]);

  useEffect(() => {
    let active = true;
    let timerId = null;
    let controller = null;

    async function poll() {
      controller?.abort();
      controller = new AbortController();
      await refreshStatus({ signal: controller.signal });
      if (active) timerId = window.setTimeout(poll, SUPERVISOR_POLL_MS);
    }

    poll();
    return () => {
      active = false;
      controller?.abort();
      if (timerId) window.clearTimeout(timerId);
    };
  }, [refreshStatus]);

  async function controlRuntime(action) {
    if (!canControl || busyAction) return;
    if (!window.confirm(confirmationMessage(action))) return;

    setBusyAction(action);
    setRuntimeError('');
    try {
      const accepted = await infrastructureService.controlSkyCommandRuntime(action, createOperationId());
      if (['REBUILD_FRONTEND', 'REBUILD_BACKEND'].includes(action)) {
        await supervisorService.waitForOperationCompletion({
          action: SUPERVISOR_ACTIONS[action],
          requestedAt: accepted?.operation?.requestedAt,
        });
        window.location.reload();
        return;
      }
      if (['RESTART_RUNTIME', 'STOP_RUNTIME'].includes(action)) {
        window.setTimeout(() => {
          api.clearSessionToken();
          window.location.replace('/login');
        }, 500);
        return;
      }

      window.setTimeout(async () => {
        await refreshStatus();
        setBusyAction('');
      }, 1500);
    } catch (error) {
      const code = error?.details?.code || error?.code || error?.payload?.details?.code;
      setRuntimeError(
        code
          ? `${code} · ${error.message || 'SkyCommand runtime lifecycle request failed.'}`
          : error.message || 'SkyCommand runtime lifecycle request failed.',
      );
      setBusyAction('');
    }
  }

  if (typeof children === 'function') {
    return children({
      busyAction,
      controlRuntime,
      refreshStatus,
      runtimeControlStatus,
      runtimeError,
      clearRuntimeError: () => setRuntimeError(''),
    });
  }

  const supervisor = runtimeControlStatus?.supervisor || {};
  const runtimeState = supervisor.runtimeStatus || 'UNKNOWN';
  const supervisorState = supervisor.status || 'UNKNOWN';
  const availableActions = runtimeControlStatus?.availableActions || [];
  const button = (action, label, tone = 'primary') => (
    <button
      className={`btn btn-sm ${tone === 'danger' ? 'sky-btn-danger' : tone === 'ghost' ? 'sky-btn-ghost' : 'sky-btn-primary'}`}
      disabled={!canControl || Boolean(busyAction) || !availableActions.includes(action)}
      onClick={() => controlRuntime(action)}
      type="button"
    >
      {busyAction === action ? 'Working…' : label}
    </button>
  );

  return (
    <div className={compact ? 'sky-runtime-control-compact' : 'sky-runtime-control-workspace'}>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">Runtime control</div>
          <div className="d-flex flex-wrap align-items-center gap-2 mt-1">
            <StatusPill label={`Supervisor ${supervisorState}`} status={supervisorState} />
            <StatusPill label={`Backend ${runtimeState}`} status={getRuntimeStatusTone(runtimeState)} />
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {button('REBUILD_FRONTEND', 'Rebuild Frontend')}
          {button('REBUILD_BACKEND', 'Rebuild Backend')}
          {button('RESTART_RUNTIME', 'Restart Runtime', 'ghost')}
          {button('STOP_RUNTIME', 'Stop Runtime', 'danger')}
        </div>
      </div>
      {runtimeError && (
        <DismissibleAlert className="mt-3 mb-0" onDismiss={() => setRuntimeError('')} tone="danger">
          {runtimeError}
        </DismissibleAlert>
      )}
    </div>
  );
}

export default SkyCommandRuntimeControls;
