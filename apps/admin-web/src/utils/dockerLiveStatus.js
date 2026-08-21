function normalizeStatus(value, fallback) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || fallback;
}

export function getDockerLiveLaneState({ connectionStatus, sourceStatus } = {}) {
  const connection = normalizeStatus(connectionStatus, 'CONNECTING');
  const source = normalizeStatus(sourceStatus, 'WAITING');

  if (connection !== 'CONNECTED') {
    return {
      live: false,
      label: connection,
      status: connection === 'DISCONNECTED' ? 'OFFLINE' : 'WARNING',
    };
  }

  if (source === 'ONLINE') {
    return { live: true, label: 'LIVE', status: 'ONLINE' };
  }

  if (source === 'OFFLINE' || source === 'ERROR') {
    return { live: false, label: source, status: 'ERROR' };
  }

  if (source === 'STALE' || source === 'DEGRADED') {
    return { live: false, label: source, status: source };
  }

  return { live: false, label: source, status: 'WARNING' };
}

export function buildDockerStaleDataMessage({
  noun = 'Docker live data',
  sourceErrorCode = '',
  sourceStatus = 'WAITING',
} = {}) {
  const status = normalizeStatus(sourceStatus, 'WAITING');
  const code = String(sourceErrorCode || '').trim();
  const suffix = code ? ` (${code})` : '';

  if (status === 'ONLINE') return '';
  if (status === 'STALE') {
    return `${noun} is stale${suffix}; the last received values remain visible for diagnosis.`;
  }
  if (status === 'ERROR' || status === 'OFFLINE') {
    return `${noun} is unavailable${suffix}; the last received values remain visible for diagnosis.`;
  }
  if (status === 'DEGRADED') {
    return `${noun} is degraded${suffix}; SkyCommand is retrying automatically.`;
  }
  return `${noun} is waiting for the Host Agent source${suffix}.`;
}
