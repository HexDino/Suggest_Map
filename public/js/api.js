export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const API_BASE = '/functions/v1/app';

function apiPath(path) {
  const suffix = path.startsWith('/api') ? path.slice(4) : path;
  return `${API_BASE}${suffix || '/'}`;
}

export async function getJson(path, params = {}, signal) {
  const url = new URL(apiPath(path), window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new ApiError(data?.error?.code || 'REQUEST_FAILED', response.status);
  }

  return data;
}
