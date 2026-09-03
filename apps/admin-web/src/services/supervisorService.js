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

export default {
  getRuntimeStatus,
  startRuntime,
};
