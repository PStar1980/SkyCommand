const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const SESSION_TOKEN_KEY = 'skycommand.admin.sessionToken';
const LEGACY_SESSION_TOKEN_KEY = 'skyserver.admin.sessionToken';
const AUTH_EXPIRED_EVENT = 'skycommand:auth-expired';
const AUTH_EXPIRED_NOTICE_KEY = 'skycommand.auth.expiredNotice';
const LOGIN_PATH = '/login';

function getSessionToken() {
  const token =
    localStorage.getItem(SESSION_TOKEN_KEY) || localStorage.getItem(LEGACY_SESSION_TOKEN_KEY);

  if (token && !localStorage.getItem(SESSION_TOKEN_KEY)) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
  }

  return token;
}

function setSessionToken(token) {
  if (!token) {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    return;
  }

  localStorage.setItem(SESSION_TOKEN_KEY, token);
  localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
}

function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
}

function consumeAuthExpiredNotice() {
  const notice = window.sessionStorage.getItem(AUTH_EXPIRED_NOTICE_KEY) || '';
  window.sessionStorage.removeItem(AUTH_EXPIRED_NOTICE_KEY);
  return notice;
}

function redirectToLogin() {
  if (window.location.pathname !== LOGIN_PATH) {
    window.location.replace(LOGIN_PATH);
  }
}

function notifyAuthExpired(message = 'Invalid or expired session.') {
  clearSessionToken();
  window.sessionStorage.setItem(AUTH_EXPIRED_NOTICE_KEY, message);

  window.dispatchEvent(
    new CustomEvent(AUTH_EXPIRED_EVENT, {
      detail: {
        message,
      },
    }),
  );

  // Every Admin-Web refresh path uses this API client. A 401 therefore becomes
  // one application-wide expiry contract for manual refreshes, polling, and
  // ordinary API activity instead of relying on each page to handle it itself.
  redirectToLogin();
}

function buildUrl(path, query = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${normalizedPath}`, window.location.origin);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await response.text();

    if (!response.ok) {
      const error = new Error(text || response.statusText);
      error.status = response.status;
      throw error;
    }

    return text;
  }

  const data = await response.json();

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || response.statusText || 'API request failed.');
    error.status = response.status;
    error.details = data?.details || null;
    error.payload = data;
    throw error;
  }

  return data;
}

async function request(path, options = {}) {
  const token = options.token === undefined ? getSessionToken() : options.token;
  const usesStoredSessionToken = options.token === undefined;
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    return await parseResponse(response);
  } catch (error) {
    if (error.status === 401 && usesStoredSessionToken) {
      notifyAuthExpired(error.message || 'Invalid or expired session.');
    }

    throw error;
  }
}


async function stream(path, options = {}) {
  const token = options.token === undefined ? getSessionToken() : options.token;
  const usesStoredSessionToken = options.token === undefined;
  const headers = {
    Accept: 'text/event-stream',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.lastEventId) {
    headers['Last-Event-ID'] = String(options.lastEventId);
  }

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method: 'GET',
      headers,
      signal: options.signal,
    });

    if (!response.ok) {
      await parseResponse(response);
    }

    if (!response.body) {
      throw new Error('Streaming response body is unavailable.');
    }

    options.onOpen?.(response);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r/g, '');

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex >= 0) {
        const frame = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf('\n\n');

        if (!frame || frame.startsWith(':')) continue;

        let eventName = 'message';
        let eventId = '';
        const dataLines = [];

        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;
          const separatorIndex = line.indexOf(':');
          const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
          let fieldValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
          if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);

          if (field === 'event') eventName = fieldValue || 'message';
          else if (field === 'id') eventId = fieldValue;
          else if (field === 'data') dataLines.push(fieldValue);
        }

        if (dataLines.length === 0) continue;
        const rawData = dataLines.join('\n');
        let data = rawData;

        try {
          data = JSON.parse(rawData);
        } catch {
          // Non-JSON SSE data remains available to the caller as text.
        }

        options.onEvent?.({
          event: eventName,
          id: eventId,
          data,
        });
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    if (error.status === 401 && usesStoredSessionToken) {
      notifyAuthExpired(error.message || 'Invalid or expired session.');
    }

    throw error;
  }
}

const api = {
  AUTH_EXPIRED_EVENT,
  consumeAuthExpiredNotice,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  notifyAuthExpired,
  stream,
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default api;
