const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const SESSION_TOKEN_KEY = 'skycommand.admin.sessionToken';
const LEGACY_SESSION_TOKEN_KEY = 'skyserver.admin.sessionToken';
const AUTH_EXPIRED_EVENT = 'skycommand:auth-expired';

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

function notifyAuthExpired(message = 'Invalid or expired session.') {
  clearSessionToken();

  window.dispatchEvent(
    new CustomEvent(AUTH_EXPIRED_EVENT, {
      detail: {
        message,
      },
    }),
  );
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

const api = {
  AUTH_EXPIRED_EVENT,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  notifyAuthExpired,
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default api;
