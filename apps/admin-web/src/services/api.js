const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const SESSION_TOKEN_KEY = 'skyserver.admin.sessionToken';

function getSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

function setSessionToken(token) {
  if (!token) {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    return;
  }

  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
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
      throw new Error(text || response.statusText);
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

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  return parseResponse(response);
}

const api = {
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
};

export default api;
