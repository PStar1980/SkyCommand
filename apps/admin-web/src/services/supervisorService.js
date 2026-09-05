const SUPERVISOR_BASE_URL = import.meta.env.VITE_SUPERVISOR_BASE_URL || 'http://127.0.0.1:17170';

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || response.statusText || 'SkyCommand Supervisor request failed.');
    error.status = response.status;
    error.code = data?.code || null;
    throw error;
  }
  return data;
}

async function getRuntimeStatus({ signal } = {}) {
  const response = await fetch(`${SUPERVISOR_BASE_URL}/runtime/status`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseResponse(response);
}

async function startRuntime() {
  const response = await fetch(`${SUPERVISOR_BASE_URL}/runtime/start`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-SkyCommand-Bootstrap': 'start',
    },
    body: '{}',
  });
  return parseResponse(response);
}

const CONTROL_PATHS = {
  STOP: 'stop',
  RESTART: 'restart',
  REBUILD_WEB: 'rebuild-web',
};

async function controlRuntime(action, grant) {
  const normalizedAction = String(action || '').trim().toUpperCase();
  const path = CONTROL_PATHS[normalizedAction];
  if (!path) {
    throw new Error(`Unsupported SkyCommand runtime action '${normalizedAction || 'blank'}'.`);
  }
  if (!grant) {
    throw new Error('SkyCommand runtime lifecycle grant is required.');
  }

  const response = await fetch(`${SUPERVISOR_BASE_URL}/runtime/${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-SkyCommand-Supervisor-Grant': grant,
    },
    body: '{}',
  });
  return parseResponse(response);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForOperationCompletion({ action, requestedAt, timeoutMs = 300000 } = {}) {
  const normalizedAction = String(action || '').trim().toUpperCase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getRuntimeStatus();
    const activeAction = String(status?.operation?.action || '').toUpperCase();
    const last = status?.lastOperation || null;
    const lastAction = String(last?.action || '').toUpperCase();

    if (!activeAction && lastAction === normalizedAction && last?.requestedAt === requestedAt) {
      if (String(last.status || '').toUpperCase() === 'FAILED') {
        const error = new Error(last.error || 'SkyCommand Supervisor operation failed.');
        error.code = last.code || 'SKYCOMMAND_SUPERVISOR_OPERATION_FAILED';
        throw error;
      }
      return status;
    }

    await delay(1000);
  }

  const error = new Error('Timed out waiting for the SkyCommand Supervisor operation to finish.');
  error.code = 'SKYCOMMAND_SUPERVISOR_OPERATION_TIMEOUT';
  throw error;
}

export default {
  controlRuntime,
  getRuntimeStatus,
  startRuntime,
  waitForOperationCompletion,
};
