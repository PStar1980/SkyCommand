import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';
import infrastructureService from '../services/infrastructureService.js';
import supervisorService from '../services/supervisorService.js';
import DismissibleAlert from './ui/DismissibleAlert.jsx';
import StatusPill from './ui/StatusPill.jsx';

const SUPERVISOR_POLL_MS = 4000;

function getRuntimeStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ONLINE') return 'ONLINE';
  if (['STARTING', 'PARTIAL'].includes(normalized)) return 'WARNING';
  if (['STOPPED', 'UNAVAILABLE', 'DEGRADED'].includes(normalized)) return 'OFFLINE';
  return 'INFO';
}

function confirmationMessage(action) {
  if (action === 'STOP') {
    return 'Stop the SkyCommand backend runtime? The web shell and Supervisor will stay online, but your current session will end and the login page will switch to Runtime Control.';
  }

  if (action === 'REBUILD_WEB') {
    return 'Rebuild the SkyCommand frontend from the current local source? The Supervisor will run docker compose up -d --build web, replace the web shell, and reload this page when the rebuild finishes. The backend runtime will stay online.';
  }

  return 'Restart the SkyCommand backend runtime? The web shell and Supervisor will stay online while PostgreSQL, Temporal, workers, and the API restart. Your current session will end and you will sign in again when the runtime is healthy.';
}

function SkyCommandRuntimeControls({ canControl = false, compact = false, onStatusChange = null }) {
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const refreshStatus = useCallback(async ({ signal } = {}) => {
    try {
      const status = await supervisorService.getRuntimeStatus({ signal });
      setRuntimeStatus(status);
      onStatusChange?.(status);
      setRuntimeError('');
      return status;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      setRuntimeStatus(null);
      onStatusChange?.(null);
      setRuntimeError('SkyCommand Supervisor status is unavailable.');
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
      const authorizationResult = await infrastructureService.authorizeSkyCommandRuntimeControl(action);
      const grant = authorizationResult?.authorization?.grant;
      if (!grant) throw new Error('SkyCommand runtime lifecycle authorization did not return a grant.');

      const accepted = await supervisorService.controlRuntime(action, grant);

      if (action === 'REBUILD_WEB') {
        await supervisorService.waitForOperationCompletion({
          action,
          requestedAt: accepted?.operation?.requestedAt,
        });
        window.setTimeout(() => window.location.reload(), 750);
        return;
      }

      // The API is intentionally part of the controlled runtime. Hand the browser back
      // to the static shell before the current authenticated session becomes invalid.
      window.setTimeout(() => {
        api.clearSessionToken();
        window.location.replace('/login');
      }, 500);
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

  const runtimeState = runtimeStatus?.runtimeStatus || 'UNKNOWN';
  const supervisorState = runtimeStatus ? 'ONLINE' : 'UNKNOWN';
  const runtimeOnline = runtimeState === 'ONLINE';
  const runtimeActive = ['ONLINE', 'STARTING', 'PARTIAL', 'DEGRADED'].includes(runtimeState);

  return (
    <div className={compact ? 'sky-runtime-control-compact' : 'sky-runtime-control-workspace'}>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div>
          <div className="sky-page-kicker">SkyCommand runtime</div>
          <div className="d-flex flex-wrap align-items-center gap-2 mt-1">
            <StatusPill label={`Supervisor ${supervisorState}`} status={supervisorState} />
            <StatusPill label={`Backend ${runtimeState}`} status={getRuntimeStatusTone(runtimeState)} />
            <StatusPill label="Web shell Online" status="ONLINE" />
          </div>
          {!compact && (
            <div className="small sky-muted mt-2">
              Self-lifecycle actions are authorized by the API, handed off through a short-lived signed grant, and executed by the host-native Supervisor so the web shell can survive the backend transition.
            </div>
          )}
        </div>

        <div className="d-flex flex-wrap gap-2">
          {!canControl ? (
            <StatusPill label="Read only" status="INFO" />
          ) : (
            <>
              <button
                className="btn btn-sm sky-btn-primary"
                disabled={Boolean(busyAction) || !runtimeActive}
                onClick={() => controlRuntime('REBUILD_WEB')}
                type="button"
              >
                {busyAction === 'REBUILD_WEB' ? 'Rebuilding…' : 'Rebuild Frontend'}
              </button>
              <button
                className="btn btn-sm sky-btn-ghost"
                disabled={Boolean(busyAction) || !runtimeOnline}
                onClick={() => controlRuntime('RESTART')}
                type="button"
              >
                {busyAction === 'RESTART' ? 'Restarting…' : 'Restart Runtime'}
              </button>
              <button
                className="btn btn-sm sky-btn-danger"
                disabled={Boolean(busyAction) || !runtimeActive}
                onClick={() => controlRuntime('STOP')}
                type="button"
              >
                {busyAction === 'STOP' ? 'Stopping…' : 'Stop Runtime'}
              </button>
            </>
          )}
        </div>
      </div>

      {runtimeStatus?.services?.length > 0 && !compact && (
        <div className="d-flex flex-wrap gap-2 mt-3">
          {runtimeStatus.services.map((service) => (
            <StatusPill
              key={service.service}
              label={`${service.service} ${service.running ? 'running' : service.state || 'stopped'}`}
              status={service.running ? (service.health === 'UNHEALTHY' ? 'ERROR' : 'ONLINE') : 'OFFLINE'}
            />
          ))}
        </div>
      )}

      {runtimeError && (
        <DismissibleAlert className="mt-3 mb-0" onDismiss={() => setRuntimeError('')} tone="danger">
          {runtimeError}
        </DismissibleAlert>
      )}
    </div>
  );
}

export default SkyCommandRuntimeControls;
